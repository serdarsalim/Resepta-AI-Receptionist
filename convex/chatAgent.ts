import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOrg } from "./lib/orgAuth";
import { monthKey } from "./lib/usage";

import { platformValue, resolveWaAccount } from "./lib/platformConfig";
import {
  DEFAULT_MONTHLY_BUDGET_MICRO_USD,
  appendToolRound,
  chatComplete,
  costMicroUsd,
  textMessage,
  type LlmProvider,
  type ProviderMessage,
} from "./lib/llm";
import { resolveChatLlm } from "./lib/chatLlm";
import { applyWalletDebit } from "./wallet";
import {
  CHAT_AGENT_TEMPLATE_VERSION,
  MAX_REPLIES_PER_CUSTOMER_PER_HOUR,
  MAX_TOOL_ROUNDS,
  chatAgentSystemPrompt,
  chatAgentTools,
  disclosureLine,
} from "./lib/chatAgentTemplate";
import { conversationAgentMode, type SettableAgentMode } from "./lib/agentMode";
import {
  pendingSuggestionsFor,
  supersedePendingSuggestions,
} from "./lib/agentDrafts";
import { builtinAgentVariables } from "./lib/agentVariables";
import { codePrompt, type VoiceAgentLanguage } from "./lib/voiceAgentTemplate";
import {
  hasBusinessHours,
  isWithinActiveWindow,
  localDayRangeUtc,
  localWallTimeToUtcMs,
  openHoursForAgent,
  parseLocalStart,
  suggestFreeSlots,
  todayInZone,
} from "./lib/businessHours";
import { formatAppointmentTime } from "./lib/format";
import {
  cancelBooking,
  createBooking,
  getAvailableSlots,
  rescheduleBooking,
} from "./lib/calcomApi";
import { laneAvailability, laneForReply, loadEvolutionCreds } from "./lib/waLane";
import { sendWaCloudText } from "./lib/waCloud";
import { sendEvolutionText } from "./lib/evolution";
import { nextUpcomingOf } from "./appointments";
import {
  applyVoiceContactValues,
  contactUpdateFailure,
  contactUpdateResult,
} from "./retell";
import { voiceValuesFromToolArgs } from "./lib/voicePayload";

// The WhatsApp chat agent's runtime (docs/chat-agent.md). One inbound
// customer message → one TURN: guards, context, a bounded tool loop against
// the LLM seam, a session-text reply out the lane the message came in on, and
// a flight-recorder row whatever happened. The webhook schedules `respond`
// exactly like it schedules the away-reply; everything else lives here.
//
// THE ISOLATION INVARIANT (spec §4): every tool below is executed bound to
// the (orgId, customerId) the WEBHOOK resolved. The model chooses arguments,
// never identities. There is no tool that reads another customer, and no
// prompt text is load-bearing for safety.

// ── Context ─────────────────────────────────────────────────────────────────

// Everything one turn needs, in one read. `skip` is the query's verdict on
// whether the turn may run at all — computed here where the data is, enacted
// in the action, recorded either way so the flight recorder shows refusals.
export const loadTurnContext = internalQuery({
  args: {
    customerId: v.id("customers"),
    // The message this turn was scheduled for. Optional because the "Try it"
    // and any future manual invocation have no inbound; when present it is
    // what the debounce check compares against.
    inboundMessageId: v.optional(v.id("messages")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    const org = await ctx.db.get(customer.orgId);
    if (!org) return null;

    // Who answers this conversation — the org's lifecycle, its default and
    // this thread's own disagreement, resolved in the one place that knows
    // the rule. A conversation a human took over resolves to "off" here,
    // which is why there is no separate takeover guard below any more.
    const who = conversationAgentMode(org, customer);
    const mode = who.effective;
    const now = Date.now();

    // Guards, cheapest first. One verdict: the FIRST reason not to run.
    let skip: string | null = null;
    if (mode === "off") skip = "agent-off";
    else if (org.demoMode) skip = "demo-org";
    else if ((org.status ?? "active") === "suspended") skip = "org-suspended";
    else if ((await platformValue(ctx, "chatAgentDisabled")) === "true")
      skip = "platform-kill-switch";

    // The thread, newest first — read ONCE and used twice: for the
    // human-answered check below and for the prompt's history after it. Two
    // `take(30)` calls on the same index for the same rows is a read the turn
    // pays for on every single message.
    const rawMessages = await ctx.db
      .query("messages")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(30);

    // The debounce (lib/chatAgentTemplate REPLY_DEBOUNCE_MS): every eligible
    // inbound scheduled its own turn, and only the last one to do so may
    // answer. The rest stand down here, before a single token is spent, and —
    // like agent-off — write no row: a fragmented sentence is a normal way to
    // type, not an event worth four entries in the flight recorder.
    //
    // Compared against the marker the WEBHOOK stamps when it schedules, never
    // against the newest inbound row. See customers.agentTurnScheduledFor:
    // media, a Confirm tap and an inbound email all write newer inbound rows
    // WITHOUT scheduling anything, so the newest-row test would retire a live
    // turn in favour of nothing and say nothing about it.
    if (
      !skip &&
      args.inboundMessageId &&
      customer.agentTurnScheduledFor !== undefined &&
      customer.agentTurnScheduledFor !== args.inboundMessageId
    ) {
      skip = "superseded";
    }

    // A HUMAN GOT THERE FIRST. Every turn sits for REPLY_DEBOUNCE_MS before it
    // runs, and a staff member with the thread open can answer inside that
    // window — reading the customer's message is, after all, what they were
    // doing. Without this, the turn carries on and hands them a draft
    // proposing an answer to the message they answered themselves twenty
    // seconds ago: the same stale proposal messages.applySendResult retires,
    // written a moment too late for it to catch.
    //
    // SUGGEST ONLY, and each of the other two for its own reason. LIVE is
    // already handled — the composer's send pins the conversation off
    // (pauseForCustomer) and the turn stops at "agent-off" above. SHADOW is
    // deliberately left running: it sends nothing and offers nothing, so
    // there is no stale proposal to prevent, and an org in shadow has humans
    // answering EVERYTHING by hand — standing down whenever one of them is
    // quick would eat the pre-launch corpus that is the whole point of it.
    //
    // "session" is the composer's own kind, the one applySendResult retires
    // drafts on. The agent's own replies are "chat_agent" and an away-reply is
    // a template send; neither is a person deciding to answer. A send SCHEDULED
    // for later is skipped on the same terms the history below skips it: its
    // row exists from the moment it is composed, and a message going out on
    // Tuesday does not answer a question asked today.
    //
    // Scanned, not queried: rawMessages is already newest-first, so the rows
    // BEFORE the inbound are exactly the ones that landed after it. A turn
    // whose inbound has fallen out of that window is left alone — thirty
    // messages on, the debounce above has the better answer.
    if (!skip && mode === "suggest" && args.inboundMessageId) {
      for (const m of rawMessages) {
        if (m._id === args.inboundMessageId) break;
        if (
          m.direction === "out" &&
          m.kind === "session" &&
          m.status !== "failed" &&
          !(m.scheduledFor && m.scheduledFor > now)
        ) {
          skip = "human-answered";
          break;
        }
      }
    }

    // Which model, whose dialect, whose key — ONE resolution shared with the
    // admin panel (lib/chatLlm.ts), so the health fact and the runtime can
    // never disagree.
    const llm = await resolveChatLlm(ctx, customer.orgId);
    if (!skip && !llm.apiKey) skip = "llm-not-configured";

    // Rate limit: generated turns (sent or shadowed) in the last hour. A
    // skipped turn does not count, or the limit would extend itself.
    if (!skip) {
      const recent = await ctx.db
        .query("chatAgentTurns")
        .withIndex("by_customer_at", (q) =>
          q.eq("customerId", args.customerId).gt("at", now - 3600_000),
        )
        .collect();
      const generated = recent.filter(
        (t) =>
          t.status === "sent" || t.status === "shadow" || t.status === "suggested",
      ).length;
      if (generated >= MAX_REPLIES_PER_CUSTOMER_PER_HOUR) skip = "rate-limited";
    }

    // Budget: the month so far against the org's cap. Checked BEFORE the turn
    // runs, so the cap can be exceeded by at most one turn's cost.
    const month = monthKey(now, org.timezone);
    const usage = await ctx.db
      .query("usageMonthly")
      .withIndex("by_org_month", (q) =>
        q.eq("orgId", customer.orgId).eq("month", month),
      )
      .unique();
    const budget =
      org.chatAgentMonthlyBudgetMicroUsd ?? DEFAULT_MONTHLY_BUDGET_MICRO_USD;
    if (!skip && (usage?.llmCostMicroUsd ?? 0) >= budget) skip = "budget-exhausted";

    // The send lane, resolved the way every reply resolves it. Checked even
    // for shadow so a shadow week surfaces "this org cannot actually send"
    // before going live does.
    // Resolved before the lane decision: a row riding the platform token IS
    // a working Cloud lane, and a row with no token anywhere is not one.
    const waAccount = await resolveWaAccount(
      ctx,
      await ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .unique(),
    );
    const evolution = await loadEvolutionCreds(ctx, customer.orgId, org.evolutionInstance);
    const lane = laneForReply(
      laneAvailability({ org, waAccount, evolutionConfigured: Boolean(evolution) }),
      customer,
    );
    if (!skip && !lane) skip = "wa-not-configured";

    // Conversation history: the WhatsApp thread only, ascending, capped —
    // filtered out of the rows already read above. The trigger message is
    // already logged, so it arrives as the last user turn.
    const history = rawMessages
      .filter(
        (m) =>
          !m.kind.startsWith("email_") &&
          !m.kind.startsWith("form_") &&
          m.status !== "failed" &&
          !(m.scheduledFor && m.scheduledFor > now) &&
          (m.body ?? "").trim(),
      )
      .reverse()
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        text: (m.body ?? "").slice(0, 1000),
      }));

    // Structured business context (spec: prose can never contradict the
    // calendar, because the calendar is read from the tables). Contact fields
    // and the org's voice agents joined the list with template v4: the fields
    // feed {{contact}}, the agents carry the Talimat mirror.
    const [services, staff, knowledge, fields, agents] = await Promise.all([
      ctx.db
        .query("services")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .collect(),
      ctx.db
        .query("staff")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .collect(),
      ctx.db
        .query("knowledge")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .collect(),
      ctx.db
        .query("contactFields")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .collect(),
      ctx.db
        .query("retellAgents")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .collect(),
    ]);

    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect();
    const upcoming = appointments
      .filter(
        (a) =>
          (a.status === "scheduled" || a.status === "confirmed") &&
          a.startAt + (a.durationMinutes ?? 30) * 60_000 > now,
      )
      .sort((a, b) => a.startAt - b.startAt)
      .slice(0, 5);

    const calls = await ctx.db
      .query("calls")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(3);

    // Continuity (spec §1): the customer's calls ride into the prompt, so a
    // reply to a voice booking's confirmation knows about the call.
    const language = customer.language ?? org.language;
    // Has this customer ever received a message from the agent? A DRAFT a
    // human approved counts — the disclosure line was prepended when it was
    // generated and went out with it, so disclosing again would be the second
    // introduction to the same person.
    const disclosed = (
      await ctx.db
        .query("chatAgentTurns")
        .withIndex("by_customer_at", (q) => q.eq("customerId", args.customerId))
        .collect()
    ).some(
      (t) =>
        t.status === "sent" ||
        (t.status === "suggested" && t.suggestionOutcome === "sent"),
    );

    // ONE assistant, two lanes (docs/agent-core.md, template v4): the chat
    // system prompt composes over the salon's own Talimat — the mirror of
    // what their voice agent runs. WHICH agent is the owner's explicit
    // choice, the chat toggle on the assistants table (retellAgents
    // .chatEnabled, a radio — retell.update). An org that HAS assistants but
    // has pointed chat at none of them skips with a visible reason rather
    // than guessing: the toggle is the activation, and an agent nobody chose
    // answering customers is worse than a silence the flight recorder
    // explains. An org with NO assistants at all (chat-only) runs the code
    // template in the org's language — the same document a voice agent would
    // be born with, and nothing to select between. The Talimat is read PER
    // MESSAGE, which is the whole point: an owner's edit reaches the next
    // WhatsApp reply with no sync and no publish.
    const voiceAgent = agents.find((a) => a.chatEnabled === true) ?? null;
    if (!skip && agents.length > 0 && !voiceAgent) skip = "chat-agent-not-selected";
    const voiceLanguage: VoiceAgentLanguage =
      org.language === "tr" ? "tr-TR" : org.language === "de" ? "de-DE" : "en-US";
    const voicePrompt =
      voiceAgent?.generalPrompt?.trim() || codePrompt(voiceLanguage).general;

    // The same built-ins the voice lane injects at ring time, rendered for a
    // screen instead of a mouth (lib/agentVariables). personaName is empty BY
    // DECISION, not omission: the chat assistant is nameless (Serdar,
    // 2026-08-26 — the robot, not the persona), and the Talimat's own line
    // says what an empty {{agent_name}} means. Giving chat the persona later
    // is this one string.
    const next = nextUpcomingOf(appointments, now, ["scheduled", "confirmed"]);
    const variables = builtinAgentVariables({
      style: "written",
      org,
      personaName: "",
      customer,
      nextAppointmentAt: next ? next.startAt : null,
      staffRows: staff,
      services,
      knowledgeRows: knowledge,
      contactFields: fields,
    });

    return {
      skip,
      orgId: customer.orgId,
      org: {
        name: org.name,
        timezone: org.timezone,
        language: org.language,
        businessHours: org.businessHours ?? null,
        calcomApiKey: org.calcomApiKey ?? null,
        calcomEventTypeId: org.calcomEventTypeId ?? null,
        mode,
        // Whether asking for a person ENDS the agent's involvement in this
        // conversation or just marks it (schema orgs.chatAgentStopOnHandover).
        // Unset means keep answering.
        //
        // AND-ed with live, because only live can stop. The escalate tool
        // writes nothing in shadow or suggest — a person is already reading
        // everything the agent produces there — so a business set to "hand the
        // chat over" would otherwise have the tool description promise the
        // model it was leaving, the model write the goodbye, and the next
        // customer message get drafted anyway. That is the exact failure the
        // policy-dependent description exists to prevent, one mode over.
        //
        // Derived ONCE here because three things read it — the tool
        // description, the branch that writes, and the fact the tool returns
        // — and three copies of this AND is how they start telling the model
        // three different stories.
        stopOnHandover: mode === "live" && (org.chatAgentStopOnHandover ?? false),
        currency: org.currency ?? "TRY",
        priceDecimals: org.priceDecimals ?? false,
        // Product handover (schema orgs.pickupEnabled / deliveryEnabled).
        // Unset means on, resolved here so the prompt reads plain booleans.
        pickup: org.pickupEnabled ?? true,
        delivery: org.deliveryEnabled ?? true,
        // A service row with no duration is a GOOD — the schema's own rule.
        // Read off the list already loaded above rather than a second query.
        sellsGoods: services.some(
          (row) => row.active && row.durationMinutes === undefined,
        ),
      },
      customer: {
        _id: customer._id,
        phone: customer.phone,
        firstName: customer.firstName,
        lastName: customer.lastName ?? null,
        language,
        // So the escalate tool can be told it has already announced a
        // colleague, rather than announcing one every turn.
        alreadyFlagged: customer.agentFlaggedAt !== undefined,
      },
      llm,
      lane,
      waAccount: waAccount
        ? { accessToken: waAccount.accessToken, phoneNumberId: waAccount.phoneNumberId }
        : null,
      evolution,
      month,
      history,
      needsDisclosure: !disclosed,
      // The business context now travels as the SUBSTITUTED variables and
      // the Talimat itself, not as separate lists — one rendering, shared
      // with the voice lane (lib/agentVariables applies the noteText
      // doctrine to knowledge on both).
      voicePrompt,
      voicePromptVersion: voiceAgent?.generalPrompt?.trim()
        ? (voiceAgent.promptVersion ?? null)
        : null,
      variables,
      upcoming: upcoming.map((a) => ({
        spoken: formatAppointmentTime(a.startAt, org.timezone, language),
        service: a.items?.map((i) => i.name).join(", ") || undefined,
      })),
      recentCalls: calls
        .filter((c) => c.summary)
        .map((c) => ({
          when: formatAppointmentTime(c.startedAt, org.timezone, language),
          summary: (c.summary ?? "").slice(0, 300),
        })),
    };
  },
});

// Which inbound message the agent is currently meant to be answering, read
// fresh. Cheap enough to ask twice a turn — once before spending tokens, once
// before the reply leaves.
export const currentTurnMessage = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.union(v.id("messages"), v.null()),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    return customer?.agentTurnScheduledFor ?? null;
  },
});

// ── The flight recorder + ledger write (spec §5, §6) ────────────────────────
// One mutation writes the turn AND bumps the month's counters, so the two can
// never drift. Every terminal path in `respond` lands here exactly once.
export const recordTurn = internalMutation({
  args: {
    orgId: v.id("orgs"),
    customerId: v.id("customers"),
    inboundMessageId: v.optional(v.id("messages")),
    sentMessageId: v.optional(v.id("messages")),
    status: v.union(
      v.literal("sent"),
      v.literal("shadow"),
      v.literal("suggested"),
      v.literal("skipped"),
      v.literal("error"),
    ),
    reply: v.optional(v.string()),
    toolCalls: v.optional(v.string()),
    model: v.string(),
    // The Talimat generation this turn composed over (schema note on
    // chatAgentTurns.voicePromptVersion). Absent = the code template.
    voicePromptVersion: v.optional(v.number()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costMicroUsd: v.number(),
    latencyMs: v.optional(v.number()),
    error: v.optional(v.string()),
    month: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const at = Date.now();
    // The org's price per AI reply (schema: orgs.chatRateMicroUsdPerTurn),
    // resolved the way the voice meter resolves its rate — org override, then
    // the platform default, then zero — and frozen onto the turn. Only a SENT
    // turn is billed: shadow, skipped and error turns spend the platform's
    // tokens but sell the org nothing.
    const org = await ctx.db.get(args.orgId);
    const rate =
      args.status === "sent" && org
        ? (org.chatRateMicroUsdPerTurn ??
          Math.max(
            0,
            Math.round(
              Number(await platformValue(ctx, "chatRateMicroUsdPerTurn")) || 0,
            ),
          ))
        : 0;
    const billedMicroUsd = args.status === "sent" ? rate : undefined;
    // Retire any draft still waiting on this conversation, in the SAME
    // transaction as the insert below. Two consequences, both required: the
    // thread can never render two drafts, and nobody can send one written for
    // a message the customer has already followed up on. It runs for skipped
    // turns too — a draft the rate limiter stopped us from replacing is still
    // a draft answering a stale message, and a stale draft that looks current
    // is worse than none.
    await supersedePendingSuggestions(ctx, args.customerId);
    await ctx.db.insert("chatAgentTurns", {
      orgId: args.orgId,
      customerId: args.customerId,
      inboundMessageId: args.inboundMessageId,
      sentMessageId: args.sentMessageId,
      status: args.status,
      reply: args.reply,
      toolCalls: args.toolCalls,
      model: args.model,
      templateVersion: CHAT_AGENT_TEMPLATE_VERSION,
      voicePromptVersion: args.voicePromptVersion,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costMicroUsd: args.costMicroUsd,
      billedMicroUsd,
      latencyMs: args.latencyMs,
      error: args.error,
      at,
    });
    // Nothing consumed, nothing counted — a skipped turn must not creep the
    // month toward its own budget cap.
    if (args.inputTokens === 0 && args.outputTokens === 0) return null;
    const usage = await ctx.db
      .query("usageMonthly")
      .withIndex("by_org_month", (q) =>
        q.eq("orgId", args.orgId).eq("month", args.month),
      )
      .unique();
    if (usage) {
      await ctx.db.patch(usage._id, {
        llmTurns: usage.llmTurns + 1,
        llmInputTokens: usage.llmInputTokens + args.inputTokens,
        llmOutputTokens: usage.llmOutputTokens + args.outputTokens,
        llmCostMicroUsd: usage.llmCostMicroUsd + args.costMicroUsd,
        llmBilledMicroUsd: (usage.llmBilledMicroUsd ?? 0) + (billedMicroUsd ?? 0),
        llmBilledTurns:
          (usage.llmBilledTurns ?? 0) + (billedMicroUsd === undefined ? 0 : 1),
        updatedAt: at,
      });
    } else {
      await ctx.db.insert("usageMonthly", {
        orgId: args.orgId,
        month: args.month,
        llmTurns: 1,
        llmInputTokens: args.inputTokens,
        llmOutputTokens: args.outputTokens,
        llmCostMicroUsd: args.costMicroUsd,
        llmBilledMicroUsd: billedMicroUsd ?? 0,
        llmBilledTurns: billedMicroUsd === undefined ? 0 : 1,
        updatedAt: at,
      });
    }
    // The prepaid drawdown, same mutation as the stamp (the meterCall rule,
    // via the shared debit path). A rate of zero writes no debit.
    if (org && (billedMicroUsd ?? 0) > 0 && org.billingMode === "prepaid") {
      await applyWalletDebit(ctx, org, billedMicroUsd ?? 0);
    }
    return null;
  },
});

// ── Takeover (spec §5) ──────────────────────────────────────────────────────

// A human took this conversation over. Called by wa.sendSession on every
// composer send, and by the escalate tool.
//
// Without `force` it fires ONLY when the agent was answering live, and that is
// the judgement, not an optimisation: in suggest mode a person is already
// reading every draft, so typing means they are working the thread the way the
// mode intends — silencing the agent there would turn "I sent one myself" into
// "the drafts stopped and nobody said why". It also asks the RESOLVER rather
// than the org, so it fires on a thread pinned to live inside a business whose
// default is drafts.
//
// It writes the override, not just the stamp: the stamp is the "since when",
// the override is the decision. Idempotent — every send calls it.
export const pauseForCustomer = internalMutation({
  args: { customerId: v.id("customers"), force: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    const org = await ctx.db.get(customer.orgId);
    if (!org) return null;
    const who = conversationAgentMode(org, customer);
    // The flag goes whatever the mode, and before the live check below: it
    // asks a different question from the pause, and "this one needs a person"
    // was answered the moment a person wrote in the thread.
    //
    // The pending DRAFT is deliberately not touched here. This runs before
    // the send, not after it — a closed session window, a missing consent, a
    // Meta 5xx — and retiring the draft on the way past would mean a staff
    // member whose message did not go out loses the fallback text too. The
    // draft is retired from messages.applySendResult instead, where a send is
    // known to have landed.
    if (customer.agentFlaggedAt !== undefined) {
      await ctx.db.patch(args.customerId, { agentFlaggedAt: undefined });
    }
    if (!args.force && who.effective !== "live") return null;
    if (who.override === "off" && customer.agentPausedAt !== undefined) return null;
    await ctx.db.patch(args.customerId, {
      agentModeOverride: "off",
      agentPausedAt: Date.now(),
    });
    return null;
  },
});

// The agent's "this one needs a person" stamp, and its clearing. Display only:
// nothing reads agentFlaggedAt to decide whether the agent runs.
export const flagForCustomer = internalMutation({
  args: { customerId: v.id("customers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.agentFlaggedAt !== undefined) return null;
    await ctx.db.patch(args.customerId, { agentFlaggedAt: Date.now() });
    return null;
  },
});

export const clearFlagForCustomer = internalMutation({
  args: { customerId: v.id("customers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.agentFlaggedAt === undefined) return null;
    await ctx.db.patch(args.customerId, { agentFlaggedAt: undefined });
    return null;
  },
});

// ── The conversation's own choice ───────────────────────────────────────────

// What the thread's control writes. There is no fourth "follow the business"
// pill to explain, because choosing the value the business already has IS
// following it: an override is STORED only when it differs from the default
// and CLEARED when it matches. So a conversation nobody has touched moves with
// the business when the owner changes the default, a conversation somebody
// decided keeps its decision, and undoing that decision costs one click.
export const setConversationMode = mutation({
  args: {
    customerId: v.id("customers"),
    mode: v.union(v.literal("off"), v.literal("suggest"), v.literal("live")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("not-found");
    const who = conversationAgentMode(org, customer);
    // The operator has the org off or in shadow. There is no control on screen
    // in that state, so reaching here is a stale client, not a choice.
    if (!who.settable) throw new Error("agent-not-enabled");
    // Any draft waiting on this thread was written under the old arrangement,
    // so it goes with it. Leaving one would also hand the takeover rule a
    // contradiction to resolve: a draft accepted while the thread is set to
    // "answers" sends through the composer's own path, which reads a human
    // sending in a live thread as a takeover — and the pills a staff member
    // had just set to Answers would flip themselves to Off.
    if (args.mode !== who.effective) {
      await supersedePendingSuggestions(ctx, args.customerId);
    }
    const pin = args.mode !== who.orgDefault;
    await ctx.db.patch(args.customerId, {
      agentModeOverride: pin ? args.mode : undefined,
      // Only an "off" that is actually pinned carries a takeover time. When
      // "off" IS the business default the thread is simply following it, and
      // stamping a takeover would put "you took this over" on a conversation
      // nobody touched.
      agentPausedAt: pin && args.mode === "off" ? Date.now() : undefined,
      // Whatever the flag was asking for, a human just answered it by making
      // a decision about this thread.
      agentFlaggedAt: undefined,
    });
    return null;
  },
});

// The thread's control, and the draft under it, in one read — so the panel
// cannot render a mode from one moment and a draft from another.
//
// It answers even when the conversation follows the business and even when the
// business default is "off": a control that disappears at "off" is one you
// cannot use to switch a single conversation ON, which is half of what a
// per-conversation override is for. It returns null only when the org has no
// agent at all, which is the one case with nothing to say.
export const stateForCustomer = query({
  args: { customerId: v.id("customers") },
  returns: v.union(
    v.null(),
    v.object({
      orgDefault: v.union(v.literal("off"), v.literal("suggest"), v.literal("live")),
      override: v.union(
        v.null(),
        v.union(v.literal("off"), v.literal("suggest"), v.literal("live")),
      ),
      effective: v.union(
        v.literal("off"),
        v.literal("suggest"),
        v.literal("live"),
      ),
      pausedAt: v.optional(v.number()),
      flaggedAt: v.optional(v.number()),
      pending: v.union(
        v.null(),
        v.object({
          turnId: v.id("chatAgentTurns"),
          reply: v.string(),
          at: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) return null;
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    const who = conversationAgentMode(org, customer);
    // Off means the org does not have the agent; shadow is a state the tenant
    // is deliberately not shown. Either way there is no control to draw.
    if (!who.settable) return null;
    // Drafts are surfaced only while this thread is actually on drafts. An
    // owner flipping the business from "suggests" to "answers" leaves drafts
    // pending across every open conversation, and offering one there would
    // send it down the composer's path — which reads a human sending into a
    // live thread as a takeover, silently pinning that conversation off.
    // Their rows stay in the log; they just stop being on offer.
    const pending =
      who.effective === "suggest"
        ? ((await pendingSuggestionsFor(ctx, args.customerId))[0] ?? null)
        : null;
    return {
      orgDefault: who.orgDefault,
      override: who.override,
      // Narrowed for the client: settable orgs can never resolve to shadow.
      effective: who.effective as SettableAgentMode,
      pausedAt: customer.agentPausedAt,
      flaggedAt: customer.agentFlaggedAt,
      pending:
        pending && pending.reply
          ? { turnId: pending._id, reply: pending.reply, at: pending.at }
          : null,
    };
  },
});

// ── Accepting or discarding a draft ─────────────────────────────────────────

// Take the draft off the queue before anything is sent. Serializable, so two
// people looking at the same thread cannot both win: the second gets `null`
// and their click does nothing rather than sending the same message twice.
export const claimSuggestion = internalMutation({
  args: { customerId: v.id("customers"), turnId: v.id("chatAgentTurns") },
  // The disclosure line this customer is still owed, or null when they have
  // already had one. Returned from the claim rather than looked up separately
  // so the check and the decision are the same transaction.
  returns: v.object({ ok: v.boolean(), disclosure: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    // Org-scoped even though it is internal, and even though the send it
    // precedes checks again: this runs FIRST and it WRITES. Without the check
    // a crafted call could mark another org's draft as sent — the send would
    // then fail, but their draft would be gone from their thread.
    const { orgId } = await requireOrg(ctx);
    const turn = await ctx.db.get(args.turnId);
    const refused = { ok: false, disclosure: null };
    if (!turn || turn.orgId !== orgId || turn.customerId !== args.customerId) {
      return refused;
    }
    if (turn.status !== "suggested" || turn.suggestionOutcome !== undefined) {
      return refused;
    }
    await ctx.db.patch(args.turnId, { suggestionOutcome: "sent" });

    // Whether this customer still has to be told they are talking to an
    // assistant. The line is prepended mechanically when a draft is
    // GENERATED, but a draft is a textarea — a staff member who finds the
    // sentence clumsy can delete it and send, and the turn would then be
    // recorded as the disclosed one. The obligation (WhatsApp's AI policy,
    // EU AI Act Art. 50) would be discharged by a message that never carried
    // it, once, permanently. So the send re-checks and re-prepends.
    const customer = await ctx.db.get(args.customerId);
    const org = customer ? await ctx.db.get(customer.orgId) : null;
    if (!customer || !org) return { ok: true, disclosure: null };
    const already = (
      await ctx.db
        .query("chatAgentTurns")
        .withIndex("by_customer_at", (q) => q.eq("customerId", args.customerId))
        .collect()
    ).some(
      (t) =>
        t._id !== args.turnId &&
        (t.status === "sent" ||
          (t.status === "suggested" && t.suggestionOutcome === "sent")),
    );
    return {
      ok: true,
      disclosure: already
        ? null
        : disclosureLine(customer.language ?? org.language, org.name),
    };
  },
});

// Put a claimed draft back, for the one case that reaches here: the send
// failed, so nothing arrived and the draft is still the best text anybody has.
// Without this a WhatsApp outage would quietly eat every draft it prevented.
export const releaseSuggestion = internalMutation({
  args: { turnId: v.id("chatAgentTurns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    // Only ever undoes OUR claim. Nothing else writes "sent" onto a draft, so
    // this cannot resurrect one a person deliberately discarded.
    if (turn?.status !== "suggested" || turn.suggestionOutcome !== "sent") {
      return null;
    }
    // Unless the world moved while the send was in flight. A customer message
    // arriving mid-send produces a newer draft, and restoring this one on top
    // of it would leave TWO pending — with the thread showing whichever the
    // list happened to hand it. The newer draft answers the newer message, so
    // this one is simply late.
    const newer = (await pendingSuggestionsFor(ctx, turn.customerId)).length > 0;
    await ctx.db.patch(args.turnId, {
      suggestionOutcome: newer ? "superseded" : undefined,
    });
    return null;
  },
});

export const discardSuggestion = mutation({
  args: { customerId: v.id("customers"), turnId: v.id("chatAgentTurns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const turn = await ctx.db.get(args.turnId);
    if (!turn || turn.orgId !== orgId || turn.customerId !== args.customerId) {
      throw new Error("not-found");
    }
    if (turn.status === "suggested" && turn.suggestionOutcome === undefined) {
      await ctx.db.patch(args.turnId, { suggestionOutcome: "discarded" });
    }
    return null;
  },
});

// Send a draft, as written or as edited. The text is whatever is in the box
// when the button is pressed, and an edited send still records as "sent" —
// the acceptance rate is asking "was this worth sending", not "did the model
// get every word right", and a rate that only counted untouched drafts would
// punish the edit that made one usable.
//
// The send goes out through wa.sendSession, the same path the composer uses,
// so lane choice, the 24-hour session window and the scheduling rules are the
// ones already in force rather than a second implementation of them. That also
// means the human's send is attributed as a human's, which it is: they read it
// and decided.
//
// NOT superseded-checked on the way out. A newer message may have arrived
// while they were reading, but a person just looked at this thread and chose
// to send this — that judgement outranks the machine's freshness rule.
export const sendSuggestion = action({
  args: {
    customerId: v.id("customers"),
    turnId: v.id("chatAgentTurns"),
    body: v.string(),
  },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const body = args.body.trim();
    if (!body) return { ok: false, reason: "empty" };
    const claimed = await ctx.runMutation(internal.chatAgent.claimSuggestion, {
      customerId: args.customerId,
      turnId: args.turnId,
    });
    if (!claimed.ok) return { ok: false, reason: "already-decided" };
    // Put the disclosure back if the reader took it out. It is the one part
    // of the draft that is not theirs to edit away — see claimSuggestion.
    const withDisclosure =
      claimed.disclosure && !body.includes(claimed.disclosure)
        ? `${claimed.disclosure}\n${body}`
        : body;
    const sent = await ctx.runAction(api.wa.sendSession, {
      customerId: args.customerId,
      body: withDisclosure,
    });
    if (!sent.ok) {
      await ctx.runMutation(internal.chatAgent.releaseSuggestion, {
        turnId: args.turnId,
      });
    }
    return sent;
  },
});

// ── Tool lookups the action needs mid-loop ──────────────────────────────────

// Fresh at execution time, not from the turn's opening context: a booking the
// agent itself just made must be visible to the cancel that follows it.
export const nextForCustomer = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.union(
    v.null(),
    v.object({
      appointmentId: v.id("appointments"),
      externalUid: v.optional(v.string()),
      startAt: v.number(),
      service: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect();
    const next = nextUpcomingOf(appointments, Date.now(), [
      "scheduled",
      "confirmed",
    ]);
    if (!next) return null;
    return {
      appointmentId: next._id,
      externalUid: next.externalUid,
      startAt: next.startAt,
      service: next.items?.map((i) => i.name).join(", ") || undefined,
    };
  },
});

// The chat lane's pen — save_customer_details, bound to the customer the
// WEBHOOK resolved (the isolation invariant: the model picks values, never
// identities). Thin on purpose: every rule about WHAT may be written — the
// identity trio, locked keys, staff-only fields, type coercion — lives in
// retell.applyVoiceContactValues, the one gate both lanes share, so voice and
// chat can never disagree about what a field accepts. No voiceAgentVariables
// aliases here: chat's Talimat lists the canonical keys ({{information}}),
// which is exactly the vocabulary the gate speaks.
export const saveCustomerDetails = internalMutation({
  args: {
    customerId: v.id("customers"),
    values: v.record(v.string(), v.string()),
  },
  returns: contactUpdateResult,
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return contactUpdateFailure("no-such-customer");
    return await applyVoiceContactValues(ctx, {
      orgId: customer.orgId,
      phone: customer.phone,
      values: args.values,
      identity: {
        firstname: { field: "firstName", label: "firstname" },
        lastname: { field: "lastName", label: "lastname" },
        email: { field: "email", label: "email" },
      },
    });
  },
});

// ── The turn ────────────────────────────────────────────────────────────────

type ToolCallLog = { name: string; args: unknown; result: unknown };

export const respond = internalAction({
  args: {
    customerId: v.id("customers"),
    inboundMessageId: v.optional(v.id("messages")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const started = Date.now();
    const context = await ctx.runQuery(internal.chatAgent.loadTurnContext, {
      customerId: args.customerId,
      inboundMessageId: args.inboundMessageId,
    });
    if (!context) return null;

    // Blue-tick the customer's message and show "typing…" before the model
    // starts thinking (Serdar, 2026-08-27: "make the agent more human like").
    // One Meta call carries both, and the indicator holds until our reply
    // lands (25s cap, far above any turn). Live cloud lane only: shadow must
    // not promise a reply nobody sends, and Evolution's handset owns its own
    // read state. Scheduled, not awaited, so the model round-trip and the
    // receipt travel in parallel; a receipt that fails costs a grey tick,
    // not the reply.
    if (
      context.org.mode === "live" &&
      context.lane !== "evolution" &&
      context.waAccount
    ) {
      const wamid = await ctx.runQuery(internal.wa.newestInboundWamid, {
        customerId: args.customerId,
      });
      if (wamid) {
        await ctx.scheduler.runAfter(0, internal.wa.sendReadReceipt, {
          customerId: args.customerId,
          wamid,
          typing: true,
        });
      }
    }
    const llm = context.llm as {
      provider: LlmProvider;
      model: string;
      apiKey: string | null;
    };
    const model = llm.model;

    const record = (fields: {
      status: "sent" | "shadow" | "suggested" | "skipped" | "error";
      reply?: string;
      toolCalls?: ToolCallLog[];
      sentMessageId?: Id<"messages">;
      inputTokens?: number;
      outputTokens?: number;
      error?: string;
    }) =>
      ctx.runMutation(internal.chatAgent.recordTurn, {
        orgId: context.orgId,
        customerId: args.customerId,
        inboundMessageId: args.inboundMessageId,
        sentMessageId: fields.sentMessageId,
        status: fields.status,
        reply: fields.reply,
        toolCalls: fields.toolCalls?.length
          ? JSON.stringify(fields.toolCalls)
          : undefined,
        model,
        voicePromptVersion: context.voicePromptVersion ?? undefined,
        inputTokens: fields.inputTokens ?? 0,
        outputTokens: fields.outputTokens ?? 0,
        costMicroUsd: costMicroUsd(
          model,
          fields.inputTokens ?? 0,
          fields.outputTokens ?? 0,
        ),
        latencyMs: Date.now() - started,
        error: fields.error,
        month: context.month,
      });

    if (context.skip) {
      // Two skips write no row at all, because both are normal and both would
      // grow the table with the product's traffic instead of the feature's
      // use. "agent-off" means the mode changed between scheduling and
      // running. "superseded" means the customer was still typing — the turn
      // the next fragment scheduled is the one that answers.
      //
      // "human-answered" is NOT one of them, though it stands down for much
      // the same reason. It fires in suggest mode only, so it is rare — and it
      // is the number that says whether drafts are reaching staff before staff
      // reach the thread, which is the whole question suggest mode is asking.
      if (context.skip !== "agent-off" && context.skip !== "superseded") {
        await record({ status: "skipped", error: context.skip });
      }
      return null;
    }

    // History must end on the customer or there is nothing to answer. Merged
    // to alternate roles because the Messages API requires it, and two
    // customer texts in a row are one thought anyway.
    const merged: { role: "user" | "assistant"; text: string }[] = [];
    for (const m of context.history as { role: "user" | "assistant"; text: string }[]) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) last.text += `\n${m.text}`;
      else merged.push({ ...m });
    }
    while (merged.length && merged[0].role === "assistant") merged.shift();
    if (!merged.length || merged[merged.length - 1].role !== "user") {
      await record({ status: "skipped", error: "nothing-to-answer" });
      return null;
    }

    const openness = openHoursForAgent(context.org.businessHours);
    // Template v4: the adapter over the salon's own Talimat, with the shared
    // built-ins rendered for text. Services, team, knowledge, the clock and
    // the customer card all arrive through the substituted {{variables}} —
    // one rendering, shared with the voice lane.
    const system = chatAgentSystemPrompt({
      businessName: context.org.name,
      language: context.customer.language,
      openHours: openness.open_hours,
      closedDays: openness.closed_days,
      voicePrompt: context.voicePrompt,
      variables: context.variables,
      appointments: context.upcoming,
      recentCalls: context.recentCalls,
      sellsGoods: context.org.sellsGoods,
      pickup: context.org.pickup,
      delivery: context.org.delivery,
    });

    // The skip verdict already refused a missing key; this narrows the type
    // and stands guard against a future reordering of those checks.
    const apiKey = llm.apiKey;
    if (!apiKey) {
      await record({ status: "skipped", error: "llm-not-configured" });
      return null;
    }

    const messages: ProviderMessage[] = merged.map((m) =>
      textMessage(m.role, m.text),
    );
    const tools = chatAgentTools(context.org.stopOnHandover);
    const toolLog: ToolCallLog[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let finalText = "";

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const result = await chatComplete({
        provider: llm.provider,
        apiKey,
        model,
        system,
        messages,
        tools,
      });
      if (!result.ok) {
        await record({
          status: "error",
          toolCalls: toolLog,
          inputTokens,
          outputTokens,
          error: result.error,
        });
        return null;
      }
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      finalText = result.text || finalText;
      if (result.toolUses.length === 0) break;
      if (round === MAX_TOOL_ROUNDS) {
        // The model is still asking for tools at the cap. Whatever text it
        // produced stands; an unfinished plan must not loop the budget away.
        break;
      }
      // Execute every requested tool, then hand the results back in the
      // provider's own dialect — appendToolRound owns that asymmetry.
      const toolResults: { id: string; content: string }[] = [];
      for (const use of result.toolUses) {
        const toolResult = await executeTool(ctx, context, use.name, use.input);
        toolLog.push({ name: use.name, args: use.input, result: toolResult });
        toolResults.push({ id: use.id, content: JSON.stringify(toolResult) });
      }
      appendToolRound(llm.provider, messages, result, toolResults);
    }

    if (!finalText.trim()) {
      await record({
        status: "error",
        toolCalls: toolLog,
        inputTokens,
        outputTokens,
        error: "empty-reply",
      });
      return null;
    }

    // The disclosure is mechanical, never the model's job (spec §5): first
    // SENT message to this customer carries it, whatever the model wrote.
    const body = context.needsDisclosure
      ? `${disclosureLine(context.customer.language, context.org.name)}\n${finalText.trim()}`
      : finalText.trim();

    if (context.org.mode === "shadow") {
      await record({
        status: "shadow",
        reply: body,
        toolCalls: toolLog,
        inputTokens,
        outputTokens,
      });
      return null;
    }

    // Suggest: the same turn, the same cost, stopping one step short of the
    // customer. The row lands as a pending draft and the thread picks it up;
    // recordTurn has already retired whatever was pending before it, in the
    // same transaction, so there is exactly one.
    //
    // No human pacing here and no typing indicator above — both exist to make
    // a machine's reply feel like a person's, and there is a person.
    if (context.org.mode === "suggest") {
      await record({
        status: "suggested",
        reply: body,
        toolCalls: toolLog,
        inputTokens,
        outputTokens,
      });
      return null;
    }

    // A person reads, then types. The model often answers a one-line
    // question in under two seconds, and an instant reply reads as the
    // machine it is — so the send waits until the turn has taken as long as
    // a human plausibly would: a beat to read plus typing time scaled to the
    // reply, capped where patience runs out. The model's own latency counts
    // toward it, so slow turns wait nothing extra and the ceiling stays what
    // it always was.
    //
    // Both parts jittered (Serdar, 2026-08-28): the fixed 1500ms floor meant
    // every short exchange replied at exactly the same beat, and a metronome
    // is its own tell. The reading beat lands anywhere in 1–4.5s, typing
    // speed drifts ±20% around 35ms a character.
    const readMs = 1000 + Math.random() * 3500;
    const typeMs = body.length * 35 * (0.8 + Math.random() * 0.4);
    const humanPaceMs = Math.min(9000, readMs + typeMs);
    const paceRemaining = humanPaceMs - (Date.now() - started);
    if (paceRemaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, paceRemaining));
    }

    // Last look before it becomes the customer's problem. The debounce test
    // ran at context load, and everything since — the model round trip, the
    // tool rounds, the human pacing above — is time the customer could have
    // spent typing. Without this, "merhaba" at 15s gets its own useless reply
    // at 24s while the real question, sent at 20s, gets a second one at 35s:
    // two messages, the first answering a thread that had already moved on.
    //
    // A query rather than a guard inside the insert, so the residual window is
    // one round trip instead of the twenty seconds it replaces. Worth being
    // plain about: this narrows the race, it does not close it.
    if (args.inboundMessageId) {
      const current = await ctx.runQuery(internal.chatAgent.currentTurnMessage, {
        customerId: args.customerId,
      });
      if (current && current !== args.inboundMessageId) {
        await record({
          status: "skipped",
          reply: body,
          toolCalls: toolLog,
          inputTokens,
          outputTokens,
          error: "superseded-after-generation",
        });
        return null;
      }
    }

    // Live: log the row, send on the resolved lane, land the outcome in the
    // one place send outcomes are decided.
    const messageId = (await ctx.runMutation(internal.messages.logOutQueued, {
      orgId: context.orgId,
      customerId: args.customerId,
      kind: "chat_agent",
      body,
      lane: context.lane ?? undefined,
    })) as Id<"messages">;
    const sent =
      context.lane === "evolution" && context.evolution
        ? await sendEvolutionText({
            baseUrl: context.evolution.baseUrl,
            apiKey: context.evolution.apiKey,
            instance: context.evolution.instance,
            to: context.customer.phone,
            body,
          }).then((r) => ({ ok: r.ok, wamid: r.ok ? r.messageId : undefined, reason: r.ok ? undefined : r.reason }))
        : context.waAccount
          ? await sendWaCloudText({
              accessToken: context.waAccount.accessToken,
              phoneNumberId: context.waAccount.phoneNumberId,
              to: context.customer.phone,
              body,
            }).then((r) => ({ ok: r.ok, wamid: r.ok ? r.wamid : undefined, reason: r.ok ? undefined : r.reason }))
          : { ok: false as const, wamid: undefined, reason: "wa-not-configured" };
    await ctx.runMutation(internal.messages.applySendResult, {
      messageId,
      ok: sent.ok,
      wamid: sent.wamid,
      error: sent.reason,
    });
    await record({
      status: sent.ok ? "sent" : "error",
      reply: body,
      toolCalls: toolLog,
      sentMessageId: messageId,
      inputTokens,
      outputTokens,
      error: sent.ok ? undefined : (sent.reason ?? "send-failed"),
    });
    return null;
  },
});

// ── Tool execution ──────────────────────────────────────────────────────────
// Mirrors the voice endpoints in convex/http.ts deliberately, result shapes
// included: two agents answering the same question the same way, and the
// voice comments explaining each guard apply here unchanged.

type TurnContext = {
  orgId: Id<"orgs">;
  org: {
    name: string;
    timezone: string;
    language: string;
    businessHours: { activeDays?: number[]; startMinute?: number; endMinute?: number } | null;
    priceDecimals: boolean;
    calcomApiKey: string | null;
    calcomEventTypeId: string | null;
    mode: string;
    stopOnHandover: boolean;
    currency: string;
    // Which ways this business hands a PRODUCT over (schema
    // orgs.pickupEnabled / deliveryEnabled), already resolved to plain
    // booleans. Read by book_appointment, not just by the prompt: a shop that
    // does exactly one of them needs no answer from the customer.
    pickup: boolean;
    delivery: boolean;
  };
  customer: {
    _id: Id<"customers">;
    phone: string;
    firstName: string;
    lastName: string | null;
    language: string;
    alreadyFlagged: boolean;
  };
};

async function executeTool(
  // Only the two members the tools actually use, picked off the real ActionCtx
  // so the call sites keep their full types.
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  context: TurnContext,
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { org, customer } = context;
  const spokenOf = (at: number) =>
    formatAppointmentTime(at, org.timezone, customer.language);
  try {
    if (name === "check_availability") {
      const today = todayInZone(org.timezone);
      const dayIso = String(input.date ?? today);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) {
        return { error: "date-must-be-yyyy-mm-dd", today, timezone: org.timezone };
      }
      const { startIso, endIso } = localDayRangeUtc(dayIso, org.timezone);
      if (!org.calcomApiKey || !org.calcomEventTypeId) {
        const booked = await ctx.runQuery(internal.retell.bookedBetween, {
          orgId: context.orgId,
          startMs: Date.parse(startIso),
          endMs: Date.parse(endIso),
        });
        const openness = openHoursForAgent(org.businessHours);
        const suggested = suggestFreeSlots({
          dayIso,
          tz: org.timezone,
          hours: org.businessHours,
          full: booked.full,
          nowMs: Date.now(),
        });
        // The customer asked for a SPECIFIC time: answer it here, as a fact,
        // instead of hoping the model derives it. Found live on Bella
        // (2026-08-28): gpt-4.1-mini read the free-slot examples as an
        // exhaustive list and told a customer 11:00 was taken on an empty
        // Friday.
        let requestedTime: Record<string, unknown> | undefined;
        const timeRaw = typeof input.time === "string" ? input.time.trim() : "";
        const timeMatch = timeRaw.match(/^(\d{1,2}):(\d{2})$/);
        if (timeMatch) {
          const [y, m, d] = dayIso.split("-").map(Number);
          const askedMs = localWallTimeToUtcMs(
            y,
            m - 1,
            d,
            Number(timeMatch[1]),
            Number(timeMatch[2]),
            org.timezone,
          );
          const conflict = booked.full.find(
            (slot: { startAt: number; durationMinutes: number | null }) => {
              const end = slot.startAt + (slot.durationMinutes ?? 30) * 60_000;
              return askedMs >= slot.startAt && askedMs < end;
            },
          );
          const withinHours = isWithinActiveWindow(
            askedMs,
            org.timezone,
            org.businessHours ?? {},
          );
          const inPast = askedMs < Date.now();
          requestedTime = {
            time: spokenOf(askedMs),
            available: !conflict && withinHours && !inPast,
            ...(conflict
              ? { reason: "already-booked" }
              : !withinHours
                ? { reason: "outside-open-hours" }
                : inPast
                  ? { reason: "in-the-past" }
                  : {}),
          };
        }
        return {
          date: dayIso,
          ...(requestedTime ? { requested_time: requestedTime } : {}),
          booked_slots: booked.full.map(
            (slot: { startAt: number; durationMinutes: number | null }) => ({
              start: spokenOf(slot.startAt),
              duration_minutes: slot.durationMinutes ?? 30,
            }),
          ),
          // "example", not "suggested": the old name read as the list of
          // open slots, and a mini model answered from it as if it were.
          ...(suggested.length > 0
            ? { example_free_times: suggested.map((at) => spokenOf(at)) }
            : {}),
          ...openness,
          note:
            "EVERY time inside open_hours is available unless it overlaps booked_slots" +
            (openness.closed_days ? " or falls on closed_days" : "") +
            ". " +
            (requestedTime
              ? "requested_time answers the customer's asked time; trust it. "
              : "") +
            (suggested.length > 0
              ? "example_free_times are examples to offer, NOT the only free times. Offer two or three as concrete times; never answer by reciting the opening hours."
              : ""),
        };
      }
      const result = await getAvailableSlots({
        apiKey: org.calcomApiKey,
        eventTypeId: org.calcomEventTypeId,
        startIso,
        endIso,
      });
      if (!result.ok) return { error: result.reason };
      return {
        available_slots: result.slots.slice(0, 10).map((iso: string) => ({
          start: iso,
          spoken: spokenOf(Date.parse(iso)),
        })),
      };
    }

    if (name === "book_appointment") {
      const customerName =
        String(input.name ?? "").trim() ||
        `${customer.firstName} ${customer.lastName ?? ""}`.trim();
      if (!customerName || customerName === customer.phone) {
        return { error: "missing-name", note: "Ask the customer for their name first." };
      }
      // Plural now, with the same tolerance the voice handler has: a
      // model that packs "saç kesimi, sakal" into one entry gets it split
      // rather than matched against nothing. `service` stays accepted
      // because nothing stops an older conversation mid-flight from
      // having already been handed the previous tool shape.
      //
      // READ BEFORE THE CLOCK now, because whether this is a product order
      // decides whether there is a time to check at all.
      const spokenServices = Array.isArray(input.services)
        ? input.services
            .flatMap((one) => String(one ?? "").split(","))
            .map((one) => one.trim())
            .filter(Boolean)
        : undefined;
      const spokenService = String(input.service ?? "").trim() || undefined;
      const spoken = spokenServices ?? (spokenService ? [spokenService] : []);
      const now = Date.now();
      const askedKind =
        input.fulfillment === "pickup" || input.fulfillment === "delivery"
          ? input.fulfillment
          : undefined;
      const askedAsap = input.asap === true;
      const hasCalcom = Boolean(org.calcomApiKey && org.calcomEventTypeId);
      // One classification, shared by both readers of it: cal.com routing (a
      // goods-only order stays local) and the product-order path below. Only
      // asked for when something actually turns on the answer.
      const goodsOnly =
        askedKind || askedAsap || hasCalcom
          ? (
              await ctx.runQuery(internal.retell.classifyServices, {
                orgId: context.orgId,
                spoken,
              })
            ).goodsOnly
          : false;
      if ((askedKind || askedAsap) && !goodsOnly) {
        // The agent reached for the product path on a visit. Named rather
        // than shrugged at: silently dropping it would book a haircut whose
        // customer was just told it would be delivered.
        return {
          error: "not-a-product-order",
          note: "pickup, delivery and asap are for PRODUCTS only. A service is done here at a booked time — confirm a time and call again without them.",
        };
      }
      // ASAP IS A PROPERTY OF A HANDOVER, not a flag of its own. It lives
      // inside the appointment's `fulfillment` (schema
      // appointments.fulfillment) and the booking page cannot express one
      // without the other, because "as soon as we can" is a promise about
      // getting the thing to somebody — there is no asap in the abstract.
      //
      // The tool spells the two as separate flat parameters, so the model can
      // and does send asap alone. Taken at face value that writes an order
      // with no handover recorded at all, while the reply tells the customer
      // it is being dealt with right away: the promise reaches them and
      // nothing behind the counter carries it.
      //
      // Inferred when the business does exactly one of the two — asking
      // "collect or delivered?" on behalf of a shop that only collects is a
      // question with one answer — and refused when both are on offer, where
      // guessing would be choosing for the customer.
      const kind =
        askedKind ??
        (!askedAsap
          ? undefined
          : org.pickup && !org.delivery
            ? ("pickup" as const)
            : org.delivery && !org.pickup
              ? ("delivery" as const)
              : undefined);
      if (askedAsap && !kind) {
        return {
          error: "missing-fulfillment",
          note: "An asap order still has to reach them somehow. Ask whether they want to collect it or have it delivered, then call again with fulfillment set.",
        };
      }
      // ASAP has no time to check: the order is placed now and the business
      // fills it as soon as it can, which is what the customer asked for.
      // The booking page's own rule (convex/booking.ts), kept identical so
      // one product does not answer the same request two ways. Lead time
      // still binds — voiceBook refuses it with a sentence naming the item.
      const startAt = askedAsap
        ? now
        : parseLocalStart(String(input.start ?? ""), org.timezone);
      if (!askedAsap) {
        if (Number.isNaN(startAt)) return { error: "missing-or-bad-start" };
        if (startAt < now - 5 * 60_000) return { error: "start-is-in-the-past" };
        if (startAt > now + 400 * 24 * 60 * 60_000) {
          return { error: "start-is-too-far-ahead" };
        }
        const hours = org.businessHours;
        if (
          hours &&
          hasBusinessHours(hours) &&
          !isWithinActiveWindow(startAt, org.timezone, hours)
        ) {
          return {
            error: "outside-open-hours",
            attempted: spokenOf(startAt),
            ...openHoursForAgent(hours),
            note: "The business is CLOSED then, so this was not booked. Offer the nearest time inside open_hours.",
          };
        }
      }
      let externalUid: string | undefined;
      // The pair again rather than hasCalcom: this branch passes both to
      // createBooking, and only the direct test narrows them off null.
      if (org.calcomApiKey && org.calcomEventTypeId) {
        // Same rule as the voice webhook: a goods-only order stays local.
        // cal.com has nothing zero-length, and an externalUid would skip
        // voiceBook's guards — lead time included.
        if (!goodsOnly) {
          const booking = await createBooking({
            apiKey: org.calcomApiKey,
            eventTypeId: org.calcomEventTypeId,
            startIso: new Date(startAt).toISOString(),
            name: customerName,
            phone: customer.phone,
            timeZone: org.timezone,
            language: org.language,
          });
          if (!booking.ok) return { error: booking.reason };
          externalUid = booking.uid;
        }
      }
      try {
        const booking = await ctx.runMutation(internal.retell.voiceBook, {
          orgId: context.orgId,
          name: customerName,
          phone: customer.phone,
          startAt,
          externalUid,
          services: spokenServices,
          service: spokenService,
          source: "chat",
          ...(kind
            ? {
                fulfillment: {
                  kind,
                  ...(askedAsap ? { asap: true } : {}),
                  ...(kind === "delivery" && String(input.address ?? "").trim()
                    ? { address: String(input.address).trim() }
                    : {}),
                },
              }
            : {}),
        });
        return {
          booked: true,
          // An ASAP order has no promised minute, and handing the agent one
          // is how it reads a time back that nobody agreed to.
          ...(askedAsap ? { asap: true } : { spoken_time: spokenOf(startAt) }),
          // The RESOLVED way, not the asked one: where the shop does only
          // pickup the model may never have named it, and it still has to
          // read the right thing back rather than invent the other half.
          ...(kind ? { fulfillment: kind } : {}),
          service: booking.serviceName,
          // The whole visit, so the confirmation names everything booked and
          // a short list tells the agent the rest matched nothing.
          services: booking.serviceNames,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "book-failed" };
      }
    }

    if (name === "my_appointments") {
      const next = await ctx.runQuery(internal.chatAgent.nextForCustomer, {
        customerId: customer._id,
      });
      return next
        ? {
            found: true,
            next: { spoken_time: spokenOf(next.startAt), service: next.service },
          }
        : { found: false };
    }

    if (name === "cancel_appointment" || name === "reschedule_appointment") {
      const found = await ctx.runQuery(internal.chatAgent.nextForCustomer, {
        customerId: customer._id,
      });
      if (!found) return { error: "no-upcoming-appointment" };
      if (found.externalUid && !org.calcomApiKey) {
        return { error: "no-calendar-connected" };
      }
      if (name === "cancel_appointment") {
        if (found.externalUid && org.calcomApiKey) {
          const result = await cancelBooking({
            apiKey: org.calcomApiKey,
            uid: found.externalUid,
            reason: "Cancelled by chat",
          });
          if (!result.ok) return { cancelled: false, error: result.reason };
        }
        await ctx.runMutation(internal.appointments.markCancelled, {
          appointmentId: found.appointmentId,
        });
        return { cancelled: true };
      }
      const startAt = parseLocalStart(String(input.start ?? ""), org.timezone);
      if (Number.isNaN(startAt)) return { error: "missing-or-bad-start" };
      let newUid: string | undefined;
      if (found.externalUid && org.calcomApiKey) {
        const result = await rescheduleBooking({
          apiKey: org.calcomApiKey,
          uid: found.externalUid,
          startIso: new Date(startAt).toISOString(),
          reason: "Rescheduled by chat",
        });
        if (!result.ok) return { rescheduled: false, error: result.reason };
        newUid = result.uid;
      }
      await ctx.runMutation(internal.appointments.markRescheduled, {
        appointmentId: found.appointmentId,
        startAt,
        externalUid: newUid,
      });
      return { rescheduled: true, spoken_time: spokenOf(startAt) };
    }

    if (name === "save_customer_details") {
      // Same normaliser as the voice endpoint: models nest the map under
      // values/properties/fields or spread it flat, and both lanes should
      // read every shape the same way.
      const values = voiceValuesFromToolArgs(input);
      if (Object.keys(values).length === 0) {
        return { saved: false, note: "Nothing to save." };
      }
      const result = await ctx.runMutation(internal.chatAgent.saveCustomerDetails, {
        customerId: customer._id,
        values,
      });
      return {
        saved: result.updated.length > 0,
        updated: result.updated,
        // The buckets the gate reports, under names a model reads cold: keys
        // this org has no field for, fields a person owns, values that did
        // not survive their type.
        ignored: result.ignored,
        staff_only: result.notForVoice,
        rejected: result.rejected,
      };
    }

    if (name === "escalate_to_staff") {
      // Two genuinely different products, and the business chose which one
      // (schema orgs.chatAgentStopOnHandover):
      //
      //   keep answering — "a person needs to answer THIS." Says so once,
      //     flags the thread, and carries on. Not being able to quote a price
      //     is no reason to stop answering the opening hours.
      //   stop — "a person needs this CONVERSATION." Says so once, then goes
      //     genuinely quiet. force, because the assistant asking for a human
      //     is a later and more specific statement than whoever pinned this
      //     thread to live; without it, pinning a chat to live would silently
      //     mean "and it can never hand over".
      //
      // Either way the current reply still goes out, which is what lets the
      // model say a colleague will follow up and mean it.
      //
      // WRITES ONLY IN LIVE. In suggest there is nothing to stop and nothing
      // to flag — a person is reading every draft already — and stamping here
      // would quietly switch off an agent nobody took over. context.org
      // .stopOnHandover is already false outside live for the same reason, so
      // what the model was TOLD this tool does (its description) and what it
      // is told afterwards (keepAnswering below) match what actually happened.
      if (context.org.mode === "live") {
        if (context.org.stopOnHandover) {
          await ctx.runMutation(internal.chatAgent.pauseForCustomer, {
            customerId: customer._id,
            force: true,
          });
        } else {
          await ctx.runMutation(internal.chatAgent.flagForCustomer, {
            customerId: customer._id,
          });
        }
      }
      // A FACT, never a sentence. The old version returned "Tell the customer
      // the team will follow up." and the model wrote that line verbatim every
      // time it escalated — the same words, in the customer's language or not,
      // however the conversation had been going. What to say is the model's
      // job; whether a colleague is now involved is ours.
      return {
        handedOver: true,
        keepAnswering: !context.org.stopOnHandover,
        alreadyFlagged: context.customer.alreadyFlagged,
      };
    }

    return { error: `unknown-tool-${name}` };
  } catch (err) {
    // A tool that throws is a result the model can read, not a dead turn: it
    // apologises and escalates instead of leaving the customer on silence.
    return { error: err instanceof Error ? err.message : "tool-failed" };
  }
}



