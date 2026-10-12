import { v, type Infer } from "convex/values";
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
  isPricedModel,
  textMessage,
  type LlmProvider,
  type ProviderMessage,
} from "./lib/llm";
import { resolveChatLlm } from "./lib/chatLlm";
import { applyWalletDebit } from "./wallet";
import {
  AUTO_SEND_GRACE_MS,
  CHAT_AGENT_TEMPLATE_VERSION,
  MAX_REPLIES_PER_CUSTOMER_PER_HOUR,
  MAX_TOOL_ROUNDS,
  chatAgentSystemPrompt,
  chatAgentTools,
  disclosureLine,
} from "./lib/chatAgentTemplate";
import {
  agentAnswersCustomer,
  conversationAgentMode,
  type AgentMode,
  type SettableAgentMode,
} from "./lib/agentMode";
import {
  pendingSuggestionsFor,
  supersedePendingSuggestions,
} from "./lib/agentDrafts";
import { builtinAgentVariables } from "./lib/agentVariables";
import { codePrompt, type VoiceAgentLanguage } from "./lib/voiceAgentTemplate";
import {
  type ActiveWindow,
  closureBlocks,
  getLocalPartsSafe,
  hasBusinessHours,
  isWithinActiveWindow,
  judgeRequestedTime,
  localDayRangeUtc,
  localMinuteIso,
  openHoursForAgent,
  sameMinute,
  parseLocalStart,
  suggestFreeSlots,
  todayInZone,
} from "./lib/businessHours";
import { formatAppointmentTime } from "./lib/format";
import { createBooking, getAvailableSlots } from "./lib/calcomApi";
import { laneAvailability, laneForReply, loadEvolutionCreds } from "./lib/waLane";
import { sendWaCloudText } from "./lib/waCloud";
import { sendEvolutionText } from "./lib/evolution";
import { nextUpcomingOf } from "./appointments";
import { rulesForOrg } from "./messageRules";
import {
  applyVoiceContactValues,
  contactUpdateFailure,
  contactUpdateResult,
} from "./retell";
import { voiceValuesFromToolArgs } from "./lib/voicePayload";
import { answerOrEmpty } from "./lib/nonAnswer";
import {
  CHANGES_PER_DAY,
  NEAREST_FREE_NOTE,
  agentIntentValidator,
  approvalFailureOf,
  changeRefusalNote,
  isChangeRefusal,
  isTimeRefusal,
  type AgentIntent,
  type ApprovalFailure,
} from "./lib/agentChange";
import { writeOwnChange } from "./agentAppointments";

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

    // The freshness check: every eligible inbound schedules its own turn (at
    // zero delay since 2026-08-31), and only the last one to do so may
    // answer. A turn that finds a newer marker stands down here, before a
    // single token is spent, and — like agent-off — writes no row: a
    // fragmented sentence is a normal way to type, not an event worth four
    // entries in the flight recorder.
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

    // A HUMAN GOT THERE FIRST. A staff member with the thread open can answer
    // in the seconds the model spends thinking — reading the customer's
    // message is, after all, what they were doing. Without this, the turn
    // carries on and hands them a draft proposing an answer to the message
    // they answered themselves moments ago: the same stale proposal
    // messages.applySendResult retires, written a moment too late for it to
    // catch.
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
    // A model the price table does not know fails CLOSED (2026-10-13): its
    // turns would meter at nothing, nothing never reaches the budget below,
    // and the cap would be off for exactly the model nobody checked. /admin
    // names the model as unpriced beside this skip.
    if (!skip && !isPricedModel(llm.model)) skip = "model-unpriced";

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

    // Whether an automation already speaks for the booking events. A live
    // rule on the booking or cancellation trigger sends its own WhatsApp
    // message the moment the tool writes the row (appointments.
    // scheduleLifecycleMessages, runAfter 0) — the action reads this pair to
    // stand down instead of texting the customer the same news twice.
    const rules = await rulesForOrg(ctx, customer.orgId);
    const automations = {
      booking: rules.some((r) => r.trigger === "booking" && !r.paused),
      cancellation: rules.some((r) => r.trigger === "cancellation" && !r.paused),
    };

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
      automations,
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
    // Set on a LIVE turn: when fireAutoSend will send this reply unless a
    // person or a newer message stops it.
    autoSendAt: v.optional(v.number()),
    // The changes a suggest or shadow turn recorded instead of making.
    intents: v.optional(v.array(agentIntentValidator)),
  },
  // The inserted turn's id, so the live path can schedule its own fire.
  returns: v.id("chatAgentTurns"),
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
    const turnId = await ctx.db.insert("chatAgentTurns", {
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
      autoSendAt: args.autoSendAt,
      intents: args.intents,
      at,
    });
    // Nothing consumed, nothing counted — a skipped turn must not creep the
    // month toward its own budget cap.
    if (args.inputTokens === 0 && args.outputTokens === 0) return turnId;
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
    return turnId;
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

// One line of "sending this will also…", in the shape the composer draws: the
// times and names a person needs to judge the change, none of the ids.
const changeLineValidator = v.union(
  v.object({
    kind: v.literal("book"),
    at: v.number(),
    asap: v.optional(v.boolean()),
    services: v.array(v.string()),
  }),
  v.object({ kind: v.literal("move"), from: v.number(), to: v.number() }),
  v.object({ kind: v.literal("cancel"), at: v.number() }),
  v.object({ kind: v.literal("save"), labels: v.array(v.string()) }),
);

function changeLines(intents: AgentIntent[]): Infer<typeof changeLineValidator>[] {
  return intents.map((intent) =>
    intent.kind === "book"
      ? {
          kind: "book" as const,
          at: intent.start,
          ...(intent.asap ? { asap: true } : {}),
          services: intent.serviceNames,
        }
      : intent.kind === "move"
        ? { kind: "move" as const, from: intent.from, to: intent.to }
        : intent.kind === "cancel"
          ? { kind: "cancel" as const, at: intent.from }
          : { kind: "save" as const, labels: intent.labels },
  );
}

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
      // The business's zone, for the times in `pending.changes`.
      timezone: v.string(),
      pending: v.union(
        v.null(),
        v.object({
          turnId: v.id("chatAgentTurns"),
          reply: v.string(),
          at: v.number(),
          // Present on a live thread's pending reply: the moment it fires
          // unless somebody cancels. The composer counts down to it.
          autoSendAt: v.optional(v.number()),
          // What sending this draft will ALSO do, drawn above the composer so
          // the person approving can see it: a draft that books, moves,
          // cancels or saves only does so when it is sent. Absent once a
          // send has made them (a failed send puts the words back alone).
          changes: v.optional(v.array(changeLineValidator)),
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
    // Drafts surface on suggest threads AND live ones — a live thread's
    // pending row is the reply counting down to its own send, and hiding it
    // was the whole complaint (Serdar, 2026-08-31: "auto responses should
    // show in the ui immediately"). Only "off" hides them: with the agent
    // off there is no draft anybody should act on, and the rows stay in the
    // log. Sending one from a live thread goes down the composer's accept
    // path, whose takeover pin is visible in the pills — a deliberate click,
    // not the silent flip the old guard protected against.
    //
    // A live pending whose autoSendAt slipped into the past without firing —
    // a mid-deploy loss of the scheduled job — is offered WITHOUT the
    // deadline: a countdown stuck at zero claims a send that is not coming,
    // while a plain draft is simply true.
    const pending =
      who.effective !== "off"
        ? ((await pendingSuggestionsFor(ctx, args.customerId))[0] ?? null)
        : null;
    const autoSendAt =
      pending?.autoSendAt !== undefined && pending.autoSendAt > Date.now() - 2_000
        ? pending.autoSendAt
        : undefined;
    const changes =
      pending?.intents?.length && pending.intentsAppliedAt === undefined
        ? changeLines(pending.intents)
        : undefined;
    return {
      orgDefault: who.orgDefault,
      override: who.override,
      // Narrowed for the client: settable orgs can never resolve to shadow.
      effective: who.effective as SettableAgentMode,
      pausedAt: customer.agentPausedAt,
      flaggedAt: customer.agentFlaggedAt,
      timezone: org.timezone,
      pending:
        pending && pending.reply
          ? {
              turnId: pending._id,
              reply: pending.reply,
              at: pending.at,
              autoSendAt,
              ...(changes ? { changes } : {}),
            }
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
  //
  // And the changes the draft recorded instead of making (suggest mode), with
  // whether an earlier send already made them: claimed in the same
  // transaction, so two people pressing Send cannot both make them.
  returns: v.object({
    ok: v.boolean(),
    disclosure: v.union(v.string(), v.null()),
    intents: v.array(agentIntentValidator),
    intentsApplied: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Org-scoped even though it is internal, and even though the send it
    // precedes checks again: this runs FIRST and it WRITES. Without the check
    // a crafted call could mark another org's draft as sent — the send would
    // then fail, but their draft would be gone from their thread.
    const { orgId } = await requireOrg(ctx);
    const turn = await ctx.db.get(args.turnId);
    const refused = {
      ok: false,
      disclosure: null,
      intents: [],
      intentsApplied: false,
    };
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
    const changes = {
      intents: turn.intents ?? [],
      intentsApplied: turn.intentsAppliedAt !== undefined,
    };
    const customer = await ctx.db.get(args.customerId);
    const org = customer ? await ctx.db.get(customer.orgId) : null;
    if (!customer || !org) return { ok: true, disclosure: null, ...changes };
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
      ...changes,
    };
  },
});

// A claimed draft whose changes the calendar refused at send time. Its text
// describes something that did not happen ("booked for 14:00"), so it is not
// put back for anyone to send: it is retired, with the reason on the row for
// the flight recorder. Only ever undoes OUR claim, like releaseSuggestion.
export const refuseSuggestion = internalMutation({
  args: { turnId: v.id("chatAgentTurns"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (turn?.status !== "suggested" || turn.suggestionOutcome !== "sent") {
      return null;
    }
    await ctx.db.patch(args.turnId, {
      suggestionOutcome: "discarded",
      error: `change-refused: ${args.error}`.slice(0, 500),
    });
    return null;
  },
});

// The draft's changes are made. Stamped BEFORE the reply goes out: a send
// that then fails puts the draft back (releaseSuggestion), and the next try
// must send the words without making the changes a second time.
export const markIntentsApplied = internalMutation({
  args: { turnId: v.id("chatAgentTurns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (turn && turn.intentsAppliedAt === undefined) {
      await ctx.db.patch(args.turnId, { intentsAppliedAt: Date.now() });
    }
    return null;
  },
});

// What making a drafted change needs to know about the business and the
// customer, in the shape the tools take (TurnContext). Internal and keyed on
// the customer: the only caller is sendSuggestion, AFTER claimSuggestion has
// checked the draft belongs to the signed-in member's org and to this
// customer. The mode reads "live" because this is the change being made for
// real, by a person.
export const approvalContext = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    const org = await ctx.db.get(customer.orgId);
    if (!org) return null;
    const context: TurnContext = {
      orgId: customer.orgId,
      org: {
        name: org.name,
        timezone: org.timezone,
        language: org.language,
        businessHours: org.businessHours ?? null,
        priceDecimals: org.priceDecimals ?? false,
        calcomApiKey: org.calcomApiKey ?? null,
        calcomEventTypeId: org.calcomEventTypeId ?? null,
        mode: "live",
        stopOnHandover: false,
        currency: org.currency ?? "TRY",
        pickup: org.pickupEnabled ?? true,
        delivery: org.deliveryEnabled ?? true,
      },
      customer: {
        _id: customer._id,
        phone: customer.phone,
        firstName: customer.firstName,
        lastName: customer.lastName ?? null,
        language: customer.language ?? org.language,
        alreadyFlagged: customer.agentFlaggedAt !== undefined,
      },
      automations: { booking: false, cancellation: false },
    };
    return context;
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
    // THE CHANGE FIRST, THEN THE WORDS (Nudge's approveMeetings). A draft that
    // books, moves, cancels or saves recorded those changes instead of making
    // them; sending is the approval, so they are made now, each re-checked at
    // this moment, and the reply goes only if every one of them took. A
    // "you're booked" with nothing booked is the one reply worse than none.
    if (claimed.intents.length > 0 && !claimed.intentsApplied) {
      // A throw is a refusal too: the draft is claimed, and leaving it
      // claimed with nothing sent would make it vanish without a word.
      const applied = await applyIntents(ctx, args.customerId, claimed.intents).catch(
        (err: unknown) => ({
          ok: false as const,
          reason: "change-failed" as const,
          error: err instanceof Error ? err.message : "apply-failed",
        }),
      );
      if (!applied.ok) {
        await ctx.runMutation(internal.chatAgent.refuseSuggestion, {
          turnId: args.turnId,
          error: applied.error,
        });
        return { ok: false, reason: applied.reason };
      }
      await ctx.runMutation(internal.chatAgent.markIntentsApplied, {
        turnId: args.turnId,
      });
    }
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
      // The calendar changed and the words did not go: say exactly that, or
      // the person reads a send error and believes nothing happened.
      if (claimed.intents.length > 0) {
        return { ok: false, reason: "changed-not-sent" satisfies ApprovalFailure };
      }
    }
    return sent;
  },
});

// Make the changes a suggested reply recorded, in the order the model made
// them, each re-checked NOW (Nudge's executeMeetingIntent). The first refusal
// stops it: nothing after it is attempted and the reply is not sent. A move
// or a cancel acts only while the appointment is still the customer's next
// one at the time the draft named; a booking runs the whole booking path
// again. Saves go last and never stop a send: they pass the same gate again
// when written, and a field made staff-only a minute ago is not a reason to
// withhold the reply.
async function applyIntents(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  customerId: Id<"customers">,
  intents: AgentIntent[],
): Promise<{ ok: true } | { ok: false; reason: ApprovalFailure; error: string }> {
  const context = (await ctx.runQuery(internal.chatAgent.approvalContext, {
    customerId,
  })) as TurnContext | null;
  if (!context) return { ok: false, reason: "change-failed", error: "no-context" };
  const { org } = context;
  const fail = (error: string) => ({
    ok: false as const,
    reason: approvalFailureOf(error),
    error,
  });
  for (const intent of intents) {
    if (intent.kind === "save") continue;
    if (intent.kind === "book") {
      // An asap order is placed when it is approved, not when it was drafted.
      const startAt = intent.asap ? Date.now() : intent.start;
      if (!intent.asap) {
        const refusal = await startRefusal(ctx, context, startAt, "booked");
        if (refusal) return fail(String(refusal.error ?? "outside-open-hours"));
      }
      const goodsOnly =
        org.calcomApiKey && org.calcomEventTypeId
          ? (
              await ctx.runQuery(internal.retell.classifyServices, {
                orgId: context.orgId,
                spoken: intent.services,
              })
            ).goodsOnly
          : false;
      const result = await commitBooking(ctx, context, {
        name: intent.name,
        startAt,
        asap: intent.asap === true,
        spokenServices: intent.services,
        goodsOnly,
        ...(intent.fulfillment ? { fulfillment: intent.fulfillment } : {}),
      });
      if (result.booked !== true) return fail(String(result.error ?? "book-failed"));
      continue;
    }
    // The appointment the draft was written about, and nothing else: the
    // customer's own open one at the start the draft named. The write finds
    // it by that start and refuses if it is gone.
    const own = await ctx.runQuery(internal.agentAppointments.ownNext, {
      orgId: context.orgId,
      customerId,
    });
    if (own.changesToday >= CHANGES_PER_DAY) return fail("too-many-changes");
    const done = await writeOwnChange(ctx, {
      target: { orgId: context.orgId, customerId, from: intent.from },
      calcomApiKey: org.calcomApiKey ?? undefined,
      change: intent.kind === "cancel" ? { kind: "cancel" } : { kind: "move", to: intent.to },
      via: "chat",
    });
    if (!done.ok) return fail(done.reason);
  }
  for (const intent of intents) {
    if (intent.kind !== "save") continue;
    try {
      await ctx.runMutation(internal.chatAgent.saveCustomerDetails, {
        customerId,
        values: intent.values,
      });
    } catch (err) {
      console.warn("drafted save failed", err instanceof Error ? err.message : err);
    }
  }
  return { ok: true };
}

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
    // A suggest or shadow turn: what WOULD be saved, nothing written. Runs as
    // a mutation that writes nothing, because the gate is a mutation-side
    // function and a second, query-side copy of it is how two copies drift.
    dryRun: v.optional(v.boolean()),
  },
  returns: contactUpdateResult,
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return contactUpdateFailure("no-such-customer");
    return await applyVoiceContactValues(ctx, {
      orgId: customer.orgId,
      phone: customer.phone,
      values: args.values,
      dryRun: args.dryRun,
      identity: {
        firstname: { field: "firstName", label: "firstname" },
        lastname: { field: "lastName", label: "lastname" },
        email: { field: "email", label: "email" },
      },
    });
  },
});

// ── The turn ────────────────────────────────────────────────────────────────

// `dry`: the call recorded a change instead of making it (suggest, shadow).
type ToolCallLog = { name: string; args: unknown; result: unknown; dry?: boolean };

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
    // lands (25s cap, far above any turn). Live cloud lane only: the tick and
    // the dots are the customer's, so they may only appear where the customer
    // is actually about to be answered — shadow and suggest must not promise a
    // reply nobody is sending. Evolution's handset owns its own read state.
    // Scheduled, not awaited, so the model round-trip and the receipt travel
    // in parallel; a receipt that fails costs a grey tick, not the reply.
    if (
      agentAnswersCustomer(context.org.mode) &&
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

    // SUGGEST AND SHADOW CHANGE NOTHING (2026-10-13). Their tools used to book,
    // move, cancel and save for real, so a reply nobody had approved (or one
    // shadow would never send) had already changed the calendar. In both
    // modes the write tools now run every check, write nothing and record the
    // change here; it lands on the turn row, and a suggested reply's changes
    // are made only when a person sends it (sendSuggestion). Live writes as it
    // goes: a live reply IS the business answering.
    const intents: AgentIntent[] = [];
    const dry =
      context.org.mode === "live"
        ? undefined
        : (intent: AgentIntent) => addIntent(intents, intent);

    // Priced per completion as each one returns, then summed, because a
    // long-prompt rate (lib/llm MODELS) is decided per request: pricing the
    // turn's summed tokens once would put a five-round turn on the long rate
    // when no single request was long.
    let meteredMicroUsd = 0;

    const record = (fields: {
      status: "sent" | "shadow" | "suggested" | "skipped" | "error";
      reply?: string;
      toolCalls?: ToolCallLog[];
      sentMessageId?: Id<"messages">;
      inputTokens?: number;
      outputTokens?: number;
      error?: string;
      autoSendAt?: number;
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
        costMicroUsd: meteredMicroUsd,
        latencyMs: Date.now() - started,
        error: fields.error,
        month: context.month,
        autoSendAt: fields.autoSendAt,
        ...(intents.length > 0 ? { intents } : {}),
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

    // The shut hours reach the system prompt too, not only the tools: a
    // customer who asks "are you open Sunday" is answered from the prompt, and
    // an agent that only learns about the lunch break when a booking is
    // refused has already told somebody it was free.
    const promptClosures = await ctx.runQuery(internal.closures.forOrg, {
      orgId: context.orgId,
    });
    const openness = openHoursForAgent(context.org.businessHours, {
      closures: promptClosures,
      todayIso: todayInZone(context.org.timezone),
    });
    // Template v4: the adapter over the salon's own Talimat, with the shared
    // built-ins rendered for text. Services, team, knowledge, the clock and
    // the customer card all arrive through the substituted {{variables}} —
    // one rendering, shared with the voice lane.
    const system = chatAgentSystemPrompt({
      businessName: context.org.name,
      language: context.customer.language,
      openHours: openness.open_hours,
      closedDays: openness.closed_days,
      closedTimes: openness.closed_times,
      upcomingClosures: openness.upcoming_closures,
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
    // Whether a round came back with no tool call: the only kind of round
    // whose text is a reply.
    let answered = false;

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
      meteredMicroUsd += costMicroUsd(model, result.inputTokens, result.outputTokens);
      // Only a round that calls no tool is an ANSWER (2026-10-13, Nudge's
      // chatEngine rule: "a respond written beside a tool call is not sent").
      // Text the model writes in the same breath as a tool call was written
      // before the tool replied: "let me check" at best, "you're booked" for
      // a booking the tool then refused at worst. It used to become the reply
      // whenever no later round wrote anything.
      if (result.toolUses.length === 0) {
        finalText = result.text;
        answered = true;
        break;
      }
      if (round === MAX_TOOL_ROUNDS) {
        // Still asking for tools at the cap, so there is no answer, and this
        // round's text was written blind like any other. Recorded below as
        // tool-limit, never sent; an unfinished plan must not loop the
        // budget away either.
        break;
      }
      // Execute every requested tool, then hand the results back in the
      // provider's own dialect — appendToolRound owns that asymmetry.
      const toolResults: { id: string; content: string }[] = [];
      for (const use of result.toolUses) {
        const toolResult = await executeTool(ctx, context, use.name, use.input, dry);
        toolLog.push({
          name: use.name,
          args: use.input,
          result: toolResult,
          // The flight recorder must not read a dry "booked: true" as a booking.
          ...(dry && WRITE_TOOLS.has(use.name) ? { dry: true } : {}),
        });
        toolResults.push({ id: use.id, content: JSON.stringify(toolResult) });
      }
      appendToolRound(llm.provider, messages, result, toolResults);
    }

    if (!answered || !finalText.trim()) {
      await record({
        status: "error",
        toolCalls: toolLog,
        inputTokens,
        outputTokens,
        error: answered ? "empty-reply" : "tool-limit",
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

    // Last look before the reply lands anywhere. The freshness test ran at
    // context load, and everything since — the model round trip, the tool
    // rounds — is time the customer could have spent typing. Without this a
    // slow turn for "merhaba" could record AFTER the fast turn for the real
    // question and retire the fresh draft in favour of the stale one
    // (recordTurn supersedes whatever is pending, whoever writes last).
    //
    // A query rather than a guard inside the insert, so the residual window
    // is one round trip. Worth being plain about: this narrows the race, it
    // does not close it.
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

    // THE AUTOMATION ALREADY ANSWERED. A successful book, cancel or
    // reschedule fires the org's lifecycle rules from the mutation itself
    // (appointments.scheduleLifecycleMessages) — the customer's WhatsApp
    // confirmation is on its way before this reply even exists. The model's
    // own text after a booking is an echo of that confirmation, so where a
    // live rule covers the event the agent stands down: no second message.
    // Recorded, not silent — the flight recorder keeps the reply it would
    // have sent. Shadow returned above untouched: it sends nothing, so it has
    // nothing to duplicate, and the pre-launch corpus stays whole.
    //
    // LIVE ONLY since 2026-10-13. In suggest nothing has been booked yet and
    // no rule has fired: the draft carries the change, sending it makes the
    // change and fires the rule, and the dry tool told the model to keep its
    // reply short where a rule will speak (AUTOMATION_SPEAKS). Standing down
    // here would drop the customer's request with nothing to approve.
    //
    // And only when the write ACTUALLY scheduled that message
    // (confirmation_sent, from scheduleLifecycleMessages' count), never on
    // "a rule exists" (review, same day). A booking the customer already
    // held, a repeated cancel and a move to the time it already had schedule
    // nothing, and standing down on them left the customer with no answer.
    const automationAnswered = context.org.mode === "live" && toolLog.some((call) => {
      const result = call.result as Record<string, unknown> | null;
      return Boolean(
        result && typeof result === "object" && result.confirmation_sent === true,
      );
    });
    if (automationAnswered) {
      await record({
        status: "skipped",
        reply: body,
        toolCalls: toolLog,
        inputTokens,
        outputTokens,
        error: "automation-answered",
      });
      return null;
    }

    // Suggest: the same turn, the same cost, stopping one step short of the
    // customer. The row lands as a pending draft and the thread picks it up;
    // recordTurn has already retired whatever was pending before it, in the
    // same transaction, so there is exactly one.
    //
    // No typing indicator above — it exists to make a machine's reply feel
    // like a person's, and there is a person.
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

    // Live: the reply goes on screen NOW and to the customer in
    // AUTO_SEND_GRACE_MS, and the gap belongs to the owner — cancel, edit, or
    // let it fire (Serdar, 2026-08-31). The grace replaced the jittered
    // "human pacing" sleep: fifteen seconds on top of real model latency
    // varies plenty on its own, and unlike the sleep it buys something.
    //
    // Recorded as "suggested" + autoSendAt rather than a status of its own:
    // a pending live reply IS a draft — same queue, same supersede rules,
    // same discard — with a deadline attached. The fire is a durable
    // scheduled job, not a sleep in this action, so a deploy mid-grace
    // delays nothing and loses nothing.
    const turnId = await record({
      status: "suggested",
      reply: body,
      toolCalls: toolLog,
      inputTokens,
      outputTokens,
      autoSendAt: Date.now() + AUTO_SEND_GRACE_MS,
    });
    await ctx.scheduler.runAfter(AUTO_SEND_GRACE_MS, internal.chatAgent.fireAutoSend, {
      turnId,
      customerId: args.customerId,
    });
    return null;
  },
});

// ── The live reply's fuse ───────────────────────────────────────────────────

// Claim the pending auto-send, exactly once. Everything that should stop the
// send already expressed itself as suggestionOutcome: a newer inbound's turn
// wrote "superseded", a human's own reply wrote "superseded"
// (messages.applySendResult), a cancel cleared autoSendAt, a discard wrote
// "discarded". So the claim is one test: still pending, still fused.
export const claimAutoSend = internalMutation({
  args: { turnId: v.id("chatAgentTurns") },
  returns: v.union(
    v.null(),
    v.object({
      orgId: v.id("orgs"),
      customerId: v.id("customers"),
      body: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (
      !turn ||
      turn.status !== "suggested" ||
      turn.suggestionOutcome !== undefined ||
      turn.autoSendAt === undefined ||
      !turn.reply
    ) {
      return null;
    }
    await ctx.db.patch(args.turnId, { suggestionOutcome: "sent" });
    return { orgId: turn.orgId, customerId: turn.customerId, body: turn.reply };
  },
});

// The ledger's second half for an auto-sent turn. recordTurn ran at
// generation time with status "suggested" and billed nothing; the send is
// what the org pays for, so the bill lands here, when it happened — the same
// rate resolution recordTurn uses, the same usage row, the same wallet.
export const applyAutoSendOutcome = internalMutation({
  args: {
    turnId: v.id("chatAgentTurns"),
    messageId: v.id("messages"),
    ok: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (!turn) return null;
    if (!args.ok) {
      // The send failed, so nothing arrived and the text is still the best
      // anybody has. Back to a plain pending draft (fuse removed) for the
      // owner to send by hand — unless the thread has already moved on to a
      // newer draft, in which case this one is simply late. The mirror of
      // releaseSuggestion.
      const newer = (await pendingSuggestionsFor(ctx, turn.customerId)).some(
        (t) => t._id !== args.turnId,
      );
      await ctx.db.patch(args.turnId, {
        suggestionOutcome: newer ? "superseded" : undefined,
        autoSendAt: undefined,
        error: args.reason ?? "send-failed",
      });
      return null;
    }
    const org = await ctx.db.get(turn.orgId);
    const rate = org
      ? (org.chatRateMicroUsdPerTurn ??
        Math.max(
          0,
          Math.round(
            Number(await platformValue(ctx, "chatRateMicroUsdPerTurn")) || 0,
          ),
        ))
      : 0;
    await ctx.db.patch(args.turnId, {
      status: "sent",
      sentMessageId: args.messageId,
      billedMicroUsd: rate,
    });
    const month = monthKey(Date.now(), org?.timezone ?? "UTC");
    const usage = await ctx.db
      .query("usageMonthly")
      .withIndex("by_org_month", (q) =>
        q.eq("orgId", turn.orgId).eq("month", month),
      )
      .unique();
    if (usage) {
      await ctx.db.patch(usage._id, {
        llmBilledMicroUsd: (usage.llmBilledMicroUsd ?? 0) + rate,
        llmBilledTurns: (usage.llmBilledTurns ?? 0) + 1,
        updatedAt: Date.now(),
      });
    }
    if (org && rate > 0 && org.billingMode === "prepaid") {
      await applyWalletDebit(ctx, org, rate);
    }
    return null;
  },
});

// The send half of a fired fuse, resolved without a session: the fire runs
// from the scheduler, where wa.loadSessionContext's requireOrg has nobody to
// ask. Same resolution, internal trust — the customerId came from our own
// scheduled job, not a client.
export const loadAutoSendContext = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    const org = await ctx.db.get(customer.orgId);
    if (!org || (org.status ?? "active") === "suspended") return null;
    const waAccount = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
      .unique()
      .then((row) => resolveWaAccount(ctx, row));
    const evolution = await loadEvolutionCreds(
      ctx,
      customer.orgId,
      org.evolutionInstance,
    );
    const available = laneAvailability({
      org,
      waAccount,
      evolutionConfigured: Boolean(evolution),
    });
    return {
      phone: customer.phone,
      lane: laneForReply(available, customer),
      waAccount,
      evolution,
    };
  },
});

// The scheduled send itself. Runs AUTO_SEND_GRACE_MS after the reply was
// generated; the claim above decides whether the world still wants it.
//
// The lane is resolved fresh rather than carried from the turn: credentials
// rotate, and the refetch costs one query and can never be stale.
// Deliberately NOT wa.sendSession: that path is a human's send — it renders
// tokens, pins the thread off as a takeover, and refuses shut session
// windows. The agent's reply is none of those; it is answering a message
// that just arrived, on the same terms the old inline live send did.
export const fireAutoSend = internalAction({
  args: { turnId: v.id("chatAgentTurns"), customerId: v.id("customers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.chatAgent.claimAutoSend, {
      turnId: args.turnId,
    });
    if (!claimed) return null;
    const context = (await ctx.runQuery(internal.chatAgent.loadAutoSendContext, {
      customerId: args.customerId,
    })) as {
      phone: string;
      lane: "cloud" | "evolution" | null;
      waAccount: { accessToken: string; phoneNumberId: string } | null;
      evolution: { baseUrl: string; apiKey: string; instance: string } | null;
    } | null;
    if (!context) return null;
    const { phone, lane, waAccount, evolution } = context;
    const messageId = (await ctx.runMutation(internal.messages.logOutQueued, {
      orgId: claimed.orgId,
      customerId: args.customerId,
      kind: "chat_agent",
      body: claimed.body,
      lane: lane ?? undefined,
    })) as Id<"messages">;
    const sent =
      lane === "evolution" && evolution
        ? await sendEvolutionText({
            baseUrl: evolution.baseUrl,
            apiKey: evolution.apiKey,
            instance: evolution.instance,
            to: phone,
            body: claimed.body,
          }).then((r) => ({ ok: r.ok, wamid: r.ok ? r.messageId : undefined, reason: r.ok ? undefined : r.reason }))
        : waAccount
          ? await sendWaCloudText({
              accessToken: waAccount.accessToken,
              phoneNumberId: waAccount.phoneNumberId,
              to: phone,
              body: claimed.body,
            }).then((r) => ({ ok: r.ok, wamid: r.ok ? r.wamid : undefined, reason: r.ok ? undefined : r.reason }))
          : { ok: false as const, wamid: undefined, reason: "wa-not-configured" };
    await ctx.runMutation(internal.messages.applySendResult, {
      messageId,
      ok: sent.ok,
      wamid: sent.wamid,
      error: sent.reason,
    });
    await ctx.runMutation(internal.chatAgent.applyAutoSendOutcome, {
      turnId: args.turnId,
      messageId,
      ok: sent.ok,
      reason: sent.reason,
    });
    return null;
  },
});

// The owner's hand on the fuse. Clearing autoSendAt turns the counting-down
// reply into an ordinary pending draft — still in the composer, still
// sendable through the accept path, no longer going anywhere on its own.
// Called from the Cancel control and from the composer's first keystroke:
// an edited reply must never fire in its unedited form.
export const cancelAutoSend = mutation({
  args: { customerId: v.id("customers"), turnId: v.id("chatAgentTurns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const turn = await ctx.db.get(args.turnId);
    if (!turn || turn.orgId !== orgId || turn.customerId !== args.customerId) {
      throw new Error("not-found");
    }
    if (
      turn.status === "suggested" &&
      turn.suggestionOutcome === undefined &&
      turn.autoSendAt !== undefined
    ) {
      await ctx.db.patch(args.turnId, { autoSendAt: undefined });
    }
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
    // The WHOLE shape, `days` included. Narrowing it here silently dropped the
    // per-weekday hours on the way into the tools, and windowForWeekday would
    // then have fallen back to the legacy fields — a chat agent offering
    // Saturday morning at a business that opens Saturday at ten.
    businessHours: ActiveWindow | null;
    priceDecimals: boolean;
    calcomApiKey: string | null;
    calcomEventTypeId: string | null;
    // The resolved mode for THIS conversation, not the org's lifecycle. Named
    // rather than `string` so the questions asked of it (agentAnswersCustomer)
    // and the literals compared against it are checked against the four that
    // exist.
    mode: AgentMode;
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
  // Whether a live rule of the business's own already tells the customer
  // about a booking or a cancellation (loadTurnContext).
  automations: { booking: boolean; cancellation: boolean };
};

async function executeTool(
  // Only the two members the tools actually use, picked off the real ActionCtx
  // so the call sites keep their full types.
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  context: TurnContext,
  name: string,
  input: Record<string, unknown>,
  // Present when the reply only suggests (suggest) or is never sent
  // (shadow): every write tool runs its checks, writes NOTHING, hands its
  // change here, and answers as though it had made it. See AgentIntent.
  dry?: (intent: AgentIntent) => void,
): Promise<Record<string, unknown>> {
  const { org, customer } = context;
  const spokenOf = (at: number) =>
    formatAppointmentTime(at, org.timezone, customer.language);
  // The free times nearest one that is taken or shut, so a "no" arrives with
  // something to say yes to (retell.nearestFreeTimes, the booking page's own
  // slot rules). Only on refusals.
  const nearestFree = async (a: {
    at: number;
    services?: string[];
    // A move: the start of the customer's appointment being moved.
    moving?: number;
  }): Promise<{ nearest_free?: string[] }> => {
    if (!Number.isFinite(a.at)) return {};
    const near: number[] = await ctx.runQuery(internal.retell.nearestFreeTimes, {
      orgId: context.orgId,
      at: a.at,
      customerId: customer._id,
      ...(a.moving !== undefined ? { moving: a.moving } : {}),
      ...(a.services && a.services.length > 0 ? { services: a.services } : {}),
    });
    return near.length > 0 ? { nearest_free: near.map((ms) => spokenOf(ms)) } : {};
  };
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
        const closures = await ctx.runQuery(internal.closures.forOrg, {
          orgId: context.orgId,
        });
        const openness = openHoursForAgent(org.businessHours, {
          closures,
          todayIso: today,
        });
        const suggested = suggestFreeSlots({
          dayIso,
          tz: org.timezone,
          hours: org.businessHours,
          full: booked.full,
          closures,
          nowMs: Date.now(),
        });
        // The customer asked for a SPECIFIC time: answer it here, as a fact,
        // instead of hoping the model derives it. Found live on Bella
        // (2026-08-28): gpt-4.1-mini read the free-slot examples as an
        // exhaustive list and told a customer 11:00 was taken on an empty
        // Friday. One verdict for both lanes since 2026-10-13
        // (judgeRequestedTime), and a taken time comes back with the nearest
        // free ones either side.
        const asked =
          typeof input.time === "string"
            ? judgeRequestedTime({
                dayIso,
                time: input.time,
                tz: org.timezone,
                hours: org.businessHours,
                full: booked.full,
                closures,
                nowMs: Date.now(),
              })
            : null;
        const requestedTime = asked
          ? {
              time: spokenOf(asked.at),
              available: asked.available,
              ...(asked.reason ? { reason: asked.reason } : {}),
              ...(asked.available ? {} : await nearestFree({ at: asked.at })),
            }
          : undefined;
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
            (openness.closed_days ? ", falls on closed_days" : "") +
            // Same correction as the voice lane: this sentence claims to list
            // every exception, so it has to list the closures shipped beside
            // it or it tells the model they do not matter.
            (openness.closed_times ? ", falls inside closed_times" : "") +
            (openness.upcoming_closures
              ? ", or falls on a date in upcoming_closures"
              : "") +
            ". " +
            (requestedTime
              ? "requested_time answers the customer's asked time; trust it." +
                (requestedTime.available ? " " : ` ${NEAREST_FREE_NOTE} `)
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

    // The start instant's own checks (startRefusal, below executeTool).
    const refuseStart = (startAt: number, did: "booked" | "moved") =>
      startRefusal(ctx, context, startAt, did);

    if (name === "book_appointment") {
      // A placeholder is no name (lib/nonAnswer), whether the model wrote it
      // or an old call stored it on the card: either reads as missing.
      const customerName =
        answerOrEmpty(String(input.name ?? "").trim(), "name") ||
        [
          answerOrEmpty(customer.firstName, "name"),
          answerOrEmpty(customer.lastName, "name"),
        ]
          .filter(Boolean)
          .join(" ")
          .trim();
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
        const refusal = await refuseStart(startAt, "booked");
        if (refusal) {
          return {
            ...refusal,
            ...(refusal.error === "outside-open-hours"
              ? await nearestFree({ at: startAt, services: spoken })
              : {}),
          };
        }
      }
      const address = String(input.address ?? "").trim();
      const plan: BookingPlan = {
        name: customerName,
        startAt,
        asap: askedAsap,
        spokenServices,
        spokenService,
        goodsOnly,
        ...(kind
          ? {
              fulfillment: {
                kind,
                ...(kind === "delivery" && address ? { address } : {}),
              },
            }
          : {}),
      };
      // A taken time or the customer's own clash: the nearest free times
      // either side, so the assistant counters instead of stalling.
      const bookingRefused = async (error: string) => {
        // Past the day's change cap: a person takes it from here, through
        // escalate_to_staff and the business's handover setting.
        if (error === "too-many-changes") {
          return {
            booked: false,
            error,
            note: changeRefusalNote("too-many-changes", "booked", "chat"),
          };
        }
        const near = /^(slot-taken|customer-busy)/.test(error)
          ? await nearestFree({ at: startAt, services: spoken })
          : {};
        return {
          error,
          ...near,
          ...(near.nearest_free ? { note: NEAREST_FREE_NOTE } : {}),
        };
      };
      if (dry) {
        // Every check the booking would face, nothing written: the draft may
        // promise only what the approval can then make (see AgentIntent).
        const preview = await ctx.runQuery(internal.retell.previewBook, {
          orgId: context.orgId,
          customerId: customer._id,
          startAt,
          services: spokenServices,
          service: spokenService,
          providerHeld: Boolean(org.calcomApiKey && org.calcomEventTypeId && !goodsOnly),
          ...(plan.fulfillment
            ? {
                fulfillment: {
                  ...plan.fulfillment,
                  ...(askedAsap ? { asap: true } : {}),
                },
              }
            : {}),
        });
        if (!preview.ok) return await bookingRefused(preview.error);
        // Already held: approving would make nothing, so nothing is recorded.
        if ("existing" in preview && preview.existing) {
          return bookedAnswer(context, plan, preview);
        }
        dry({
          kind: "book",
          name: customerName,
          start: startAt,
          ...(askedAsap ? { asap: true } : {}),
          services: spoken,
          serviceNames: preview.serviceNames ?? [],
          ...(plan.fulfillment ? { fulfillment: plan.fulfillment } : {}),
        });
        return {
          ...bookedAnswer(context, plan, preview),
          ...(context.automations.booking ? { note: AUTOMATION_SPEAKS.booking } : {}),
        };
      }
      const made = await commitBooking(ctx, context, plan);
      return typeof made.error === "string" ? await bookingRefused(made.error) : made;
    }

    // Existing appointments, through the module the phone agent uses too
    // (agentAppointments.ts), so both lanes apply one rule about whose
    // appointment they may touch, which one (the start the assistant read
    // back from my_appointments, exactly), what a move must clear at the
    // moment of the change, and the daily cap.
    if (name === "my_appointments") {
      const own = await ctx.runQuery(internal.agentAppointments.ownNext, {
        orgId: context.orgId,
        customerId: customer._id,
      });
      if (!own.next) return { found: false };
      return {
        found: true,
        next: {
          spoken_time: spokenOf(own.next.startAt),
          appointment_start: localMinuteIso(own.next.startAt, org.timezone),
          service: own.next.services.join(", ") || undefined,
        },
        ...(own.later > 0 ? { later_appointments: own.later } : {}),
        note:
          (own.later > 0
            ? `They have ${own.later} more appointment${own.later === 1 ? "" : "s"} after this one. Only this next one can be moved or cancelled here. `
            : "") +
          "To move or cancel it, pass its appointment_start exactly as given here.",
      };
    }

    if (name === "cancel_appointment" || name === "reschedule_appointment") {
      // WHICH: the start the assistant read back, never "whatever is next
      // now". A repeat then finds the appointment already cancelled or moved
      // and says so, instead of acting on the one after it (review, same day).
      const from =
        typeof input.appointment_start === "string"
          ? parseLocalStart(input.appointment_start, org.timezone)
          : Number.NaN;
      if (!Number.isFinite(from)) {
        return {
          error: "missing-appointment-start",
          note: "Call my_appointments, name the appointment it returns, get a clear yes, then call this again with its appointment_start.",
        };
      }
      const own = await ctx.runQuery(internal.agentAppointments.ownNext, {
        orgId: context.orgId,
        customerId: customer._id,
      });
      const target = { orgId: context.orgId, customerId: customer._id, from };
      const did = name === "cancel_appointment" ? "cancelled" : "moved";
      const outcome = did === "cancelled" ? "cancelled" : "rescheduled";
      // A change the assistant cannot make, answered as a fact it can act on.
      // "A person will take care of it" goes through escalate_to_staff, so
      // the business's own handover setting decides what that means here.
      const refuse = async (
        reason: string,
        providerError?: string,
        at?: number,
      ): Promise<Record<string, unknown>> => {
        const known = isChangeRefusal(reason) ? reason : "calendar-error";
        const near =
          at !== undefined && isTimeRefusal(known)
            ? await nearestFree({ at, moving: from })
            : {};
        return {
          [outcome]: false,
          error: known,
          ...(known === "outside-open-hours"
            ? openHoursForAgent(org.businessHours, {
                closures: await ctx.runQuery(internal.closures.forOrg, {
                  orgId: context.orgId,
                }),
                todayIso: todayInZone(org.timezone),
              })
            : {}),
          ...(providerError ? { provider_error: providerError } : {}),
          ...near,
          note:
            changeRefusalNote(known, did, "chat") +
            (near.nearest_free ? ` ${NEAREST_FREE_NOTE}` : ""),
        };
      };
      // The cap answers first, before cal.com is asked anything. Asked in a
      // dry run too: a draft must not promise a change its approval will
      // refuse for a reason the draft could already see.
      if (own.changesToday >= CHANGES_PER_DAY) return await refuse("too-many-changes");
      const write = (change: { kind: "cancel" } | { kind: "move"; to: number }) =>
        writeOwnChange(ctx, {
          target,
          calcomApiKey: org.calcomApiKey ?? undefined,
          change,
          via: "chat",
        });

      if (name === "cancel_appointment") {
        if (dry) {
          // There must be an open appointment of theirs at that start.
          const at = await ctx.runQuery(internal.agentAppointments.ownAt, target);
          if (!at) return await refuse("appointment-changed");
          dry({ kind: "cancel", appointmentId: at.appointmentId, from });
          return {
            cancelled: true,
            spoken_time: spokenOf(from),
            ...(context.automations.cancellation
              ? { note: AUTOMATION_SPEAKS.cancellation }
              : {}),
          };
        }
        const done = await write({ kind: "cancel" });
        if (!done.ok) return await refuse(done.reason, done.providerError);
        return {
          cancelled: true,
          spoken_time: spokenOf(from),
          ...(done.noop
            ? {
                already_cancelled: true,
                note: "It was already cancelled; nothing else was changed. Tell the customer it is cancelled, once.",
              }
            : {}),
          ...(done.notified ? { confirmation_sent: true } : {}),
        };
      }

      const startAt = parseLocalStart(String(input.start ?? ""), org.timezone);
      // The start instant first, for the rich refusal. moveOwn then judges
      // the whole span, capacity and the customer's other bookings in the
      // transaction that writes.
      const refusal = await refuseStart(startAt, "moved");
      if (refusal) {
        return {
          ...refusal,
          ...(refusal.error === "outside-open-hours"
            ? await nearestFree({ at: startAt, moving: from })
            : {}),
        };
      }
      if (dry) {
        // The whole judgement a move faces, now; the approval asks again.
        const check = await ctx.runQuery(internal.agentAppointments.checkMove, {
          ...target,
          to: startAt,
        });
        if (!check.ok) return await refuse(check.reason, undefined, startAt);
        if (!check.noop) {
          const at = await ctx.runQuery(internal.agentAppointments.ownAt, target);
          dry({
            kind: "move",
            ...(at ? { appointmentId: at.appointmentId } : {}),
            from,
            to: startAt,
          });
        }
        return {
          rescheduled: true,
          spoken_time: spokenOf(startAt),
          ...(check.noop ? { already_moved: true } : {}),
          // A move re-sends the booking confirmation (markRescheduled), so
          // it reads the booking switch.
          ...(context.automations.booking && !check.noop
            ? { note: AUTOMATION_SPEAKS.booking }
            : {}),
        };
      }
      const done = await write({ kind: "move", to: startAt });
      if (!done.ok) return await refuse(done.reason, done.providerError, startAt);
      return {
        rescheduled: true,
        spoken_time: spokenOf(startAt),
        ...(done.noop
          ? {
              already_moved: true,
              note: "It is already booked at that time; nothing else was changed. Tell the customer, once.",
            }
          : {}),
        ...(done.notified ? { confirmation_sent: true } : {}),
      };
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
        ...(dry ? { dryRun: true } : {}),
      });
      if (dry && result.updated.length > 0) {
        // Only what the gate accepted is kept for the approval, which runs
        // the gate again before writing.
        const byKey = new Map(
          Object.entries(values).map(([key, value]) => [key.trim(), value]),
        );
        dry({
          kind: "save",
          values: Object.fromEntries(
            result.updated.map((key) => [key, byKey.get(key) ?? ""]),
          ),
          labels: result.updatedLabels,
        });
      }
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

// ── Drafted changes ─────────────────────────────────────────────────────────

const WRITE_TOOLS = new Set([
  "book_appointment",
  "cancel_appointment",
  "reschedule_appointment",
  "save_customer_details",
]);

// One change per target, the model's last word winning: moving the same
// appointment twice in one turn is one move, a cancel after a move is a
// cancel, and two saves are one save. Targets are named by their start
// (`from`), so that is what is compared. A move or cancel of a booking this
// same draft makes is folded into the booking: cancelling it drops both,
// moving it moves the booking, so sending never books and unbooks in one go.
function addIntent(list: AgentIntent[], intent: AgentIntent): void {
  if (intent.kind === "move" || intent.kind === "cancel") {
    const drafted = list.findIndex(
      (prior) => prior.kind === "book" && !prior.asap && sameMinute(prior.start, intent.from),
    );
    if (drafted >= 0) {
      const booking = list[drafted];
      if (intent.kind === "cancel") list.splice(drafted, 1);
      else if (booking.kind === "book") booking.start = intent.to;
      return;
    }
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const prior = list[i];
      if (
        (prior.kind === "move" || prior.kind === "cancel") &&
        sameMinute(prior.from, intent.from)
      ) {
        list.splice(i, 1);
      }
    }
  }
  if (intent.kind === "save") {
    const prior = list.find((item) => item.kind === "save");
    if (prior && prior.kind === "save") {
      prior.values = { ...prior.values, ...intent.values };
      prior.labels = [...new Set([...prior.labels, ...intent.labels])];
      return;
    }
  }
  list.push(intent);
}

// What a dry booking, move or cancel tells the model when one of the
// business's own rules already tells the customer about it. That message
// goes out when the change is made, which is when a person sends this reply,
// so the reply itself should not say it all a second time. Live turns stand
// down entirely in the same case (automationAnswered); a draft cannot,
// because nothing has happened yet.
const AUTOMATION_SPEAKS = {
  booking:
    "Once this reply is sent, the appointment is made and the business's own confirmation message goes to the customer with the details. Keep your reply short and do not repeat the date, time or services.",
  cancellation:
    "Once this reply is sent, the appointment is cancelled and the business's own cancellation message goes to the customer. Keep your reply short.",
};

// A booking, resolved enough to make: the live tool makes it at once, a dry
// one records it as an AgentIntent, and the approval rebuilds it from that.
type BookingPlan = {
  name: string;
  startAt: number;
  asap: boolean;
  spokenServices?: string[];
  spokenService?: string;
  // Goods only: cal.com never holds it (see book_appointment).
  goodsOnly: boolean;
  fulfillment?: { kind: "pickup" | "delivery"; address?: string };
};

function bookedAnswer(
  context: TurnContext,
  plan: BookingPlan,
  booking: {
    serviceName?: string;
    serviceNames?: string[];
    existing?: boolean;
    notified?: boolean;
  },
): Record<string, unknown> {
  return {
    // A retried call or a repeated yes (retell.voiceBook): they already held
    // exactly this, and the reply should say so rather than book "again".
    ...(booking.existing
      ? {
          already_booked: true,
          note: "They already had exactly this booked, so nothing new was made. Confirm the booking they have, once.",
        }
      : {}),
    // The business's own confirmation is on its way to them (and the live
    // turn stands down on exactly this; see automationAnswered).
    ...(booking.notified ? { confirmation_sent: true } : {}),
    booked: true,
    // An ASAP order has no promised minute, and handing the agent one is how
    // it reads a time back that nobody agreed to.
    ...(plan.asap
      ? { asap: true }
      : {
          spoken_time: formatAppointmentTime(
            plan.startAt,
            context.org.timezone,
            context.customer.language,
          ),
        }),
    // The RESOLVED way, not the asked one: where the shop does only pickup
    // the model may never have named it, and it still has to read the right
    // thing back rather than invent the other half.
    ...(plan.fulfillment ? { fulfillment: plan.fulfillment.kind } : {}),
    service: booking.serviceName,
    // The whole visit, so the confirmation names everything booked and a
    // short list tells the agent the rest matched nothing.
    services: booking.serviceNames,
  };
}

// The booking itself: cal.com first when it holds the inventory, then
// voiceBook, which runs every guard again (bookingProblem) inside its own
// transaction. Shared by the live tool and the approval of a drafted booking.
async function commitBooking(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  context: TurnContext,
  plan: BookingPlan,
): Promise<Record<string, unknown>> {
  const { org, customer } = context;
  let externalUid: string | undefined;
  // The pair rather than a flag: this branch passes both to createBooking,
  // and only the direct test narrows them off null. A goods-only order stays
  // local, the voice webhook's rule: cal.com has nothing zero-length, and an
  // externalUid would skip voiceBook's guards, lead time included.
  if (org.calcomApiKey && org.calcomEventTypeId && !plan.goodsOnly) {
    const booking = await createBooking({
      apiKey: org.calcomApiKey,
      eventTypeId: org.calcomEventTypeId,
      startIso: new Date(plan.startAt).toISOString(),
      name: plan.name,
      phone: customer.phone,
      timeZone: org.timezone,
      language: org.language,
    });
    if (!booking.ok) return { error: booking.reason };
    externalUid = booking.uid;
  }
  try {
    const booking = await ctx.runMutation(internal.retell.voiceBook, {
      orgId: context.orgId,
      name: plan.name,
      phone: customer.phone,
      startAt: plan.startAt,
      externalUid,
      services: plan.spokenServices,
      service: plan.spokenService,
      source: "chat",
      ...(plan.fulfillment
        ? {
            fulfillment: {
              kind: plan.fulfillment.kind,
              ...(plan.asap ? { asap: true } : {}),
              ...(plan.fulfillment.address
                ? { address: plan.fulfillment.address }
                : {}),
            },
          }
        : {}),
    });
    return bookedAnswer(context, plan, booking);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "book-failed" };
  }
}

// The voice lane's startRefusal, ported. It lived there and not here, which
// meant the chat agent's reschedule wrote ANY instant it was handed — into
// the past, onto a closed day, straight through a holiday. One copy, used by
// both write branches and by the approval of a drafted booking, because two
// copies is how the second one ended up with none of the checks.
//
// `did` is the verb the agent repeats to the customer, so it has to match
// what was actually refused.
async function startRefusal(
  ctx: Pick<ActionCtx, "runQuery">,
  context: TurnContext,
  startAt: number,
  did: "booked" | "moved",
): Promise<Record<string, unknown> | null> {
  const { org } = context;
  if (Number.isNaN(startAt)) return { error: "missing-or-bad-start" };
  // Read at call time: the tool and an approval minutes later each need
  // their own "now".
  const now = Date.now();
  if (startAt < now - 5 * 60_000) return { error: "start-is-in-the-past" };
  if (startAt > now + 400 * 24 * 60 * 60_000) {
    return { error: "start-is-too-far-ahead" };
  }
  const hours = org.businessHours;
  const guardClosures = await ctx.runQuery(internal.closures.forOrg, {
    orgId: context.orgId,
  });
  // Independent of hasBusinessHours, exactly as in the voice lane: an org
  // with a holiday and no stated opening hours must still refuse the
  // holiday.
  const localAt = getLocalPartsSafe(startAt, org.timezone);
  const shut = closureBlocks(
    guardClosures,
    localAt,
    localAt.minutesOfDay,
    localAt.minutesOfDay,
  );
  if (
    shut ||
    (hours &&
      hasBusinessHours(hours) &&
      !isWithinActiveWindow(startAt, org.timezone, hours, guardClosures))
  ) {
    return {
      error: "outside-open-hours",
      attempted: formatAppointmentTime(startAt, org.timezone, context.customer.language),
      ...openHoursForAgent(hours, {
        closures: guardClosures,
        todayIso: todayInZone(org.timezone),
      }),
      note:
        `The business is CLOSED then, so this was not ${did}. Offer the` +
        " nearest time inside open_hours, avoiding closed_times and" +
        " upcoming_closures. If one of those names a reason, say it —" +
        " going quiet about why reads as a fault.",
    };
  }
  return null;
}
