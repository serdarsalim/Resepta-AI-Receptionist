import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
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
import {
  CHAT_AGENT_TEMPLATE_VERSION,
  MAX_REPLIES_PER_CUSTOMER_PER_HOUR,
  MAX_TOOL_ROUNDS,
  chatAgentSystemPrompt,
  chatAgentTools,
  disclosureLine,
} from "./lib/chatAgentTemplate";
import { builtinAgentVariables } from "./lib/agentVariables";
import { codePrompt, type VoiceAgentLanguage } from "./lib/voiceAgentTemplate";
import {
  hasBusinessHours,
  isWithinActiveWindow,
  localDayRangeUtc,
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
  args: { customerId: v.id("customers") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    const org = await ctx.db.get(customer.orgId);
    if (!org) return null;

    const mode = org.chatAgentMode ?? "off";
    const now = Date.now();

    // Guards, cheapest first. One verdict: the FIRST reason not to run.
    let skip: string | null = null;
    if (mode === "off") skip = "agent-off";
    else if (org.demoMode) skip = "demo-org";
    else if ((org.status ?? "active") === "suspended") skip = "org-suspended";
    else if (customer.agentPausedAt !== undefined) skip = "conversation-taken-over";
    else if ((await platformValue(ctx, "chatAgentDisabled")) === "true")
      skip = "platform-kill-switch";

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
        (t) => t.status === "sent" || t.status === "shadow",
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

    // Conversation history: the WhatsApp thread only, ascending, capped. The
    // trigger message is already logged, so it arrives as the last user turn.
    const rawMessages = await ctx.db
      .query("messages")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(30);
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
    const disclosed = (
      await ctx.db
        .query("chatAgentTurns")
        .withIndex("by_customer_at", (q) => q.eq("customerId", args.customerId))
        .collect()
    ).some((t) => t.status === "sent");

    // ONE assistant, two lanes (docs/agent-core.md, template v4): the chat
    // system prompt composes over the salon's own Talimat — the mirror of
    // what their voice agent runs. Freshest mirror wins, an enabled agent
    // beats a disabled one, and an org with no mirror at all (chat-only, or
    // an agent connected rather than born here) runs the code template in
    // the org's language: the same document a voice agent would be born
    // with. Read PER MESSAGE, which is the whole point — an owner's edit
    // reaches the next WhatsApp reply with no sync and no publish.
    const mirrored = agents
      .filter((a) => (a.generalPrompt ?? "").trim())
      .sort((a, b) => (b.promptMirroredAt ?? 0) - (a.promptMirroredAt ?? 0));
    const voiceAgent = mirrored.find((a) => a.enabled) ?? mirrored[0] ?? null;
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
        currency: org.currency ?? "TRY",
        priceDecimals: org.priceDecimals ?? false,
      },
      customer: {
        _id: customer._id,
        phone: customer.phone,
        firstName: customer.firstName,
        lastName: customer.lastName ?? null,
        language,
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
        updatedAt: at,
      });
    }
    return null;
  },
});

// ── Takeover (spec §5) ──────────────────────────────────────────────────────

// Stamped by wa.sendSession the moment a human sends in a conversation, and
// by the escalate tool. Idempotent on purpose: every composer send calls it.
export const pauseForCustomer = internalMutation({
  args: { customerId: v.id("customers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    if (customer.agentPausedAt === undefined) {
      await ctx.db.patch(args.customerId, { agentPausedAt: Date.now() });
    }
    return null;
  },
});

// The hand-back (and a manual pause), from the conversation UI. Org-scoped
// like every public mutation.
export const setPaused = mutation({
  args: { customerId: v.id("customers"), paused: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    await ctx.db.patch(args.customerId, {
      agentPausedAt: args.paused ? Date.now() : undefined,
    });
    return null;
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
    });
    if (!context) return null;
    const llm = context.llm as {
      provider: LlmProvider;
      model: string;
      apiKey: string | null;
    };
    const model = llm.model;

    const record = (fields: {
      status: "sent" | "shadow" | "skipped" | "error";
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
      // "agent-off" is not worth a row — the webhook only schedules for
      // shadow/live, so reaching it means a race with the operator flipping
      // the mode, which is noise. Everything else is a refusal the operator
      // should be able to see happening.
      if (context.skip !== "agent-off") {
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
    const tools = chatAgentTools();
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
    currency: string;
  };
  customer: {
    _id: Id<"customers">;
    phone: string;
    firstName: string;
    lastName: string | null;
    language: string;
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
        return {
          date: dayIso,
          booked_slots: booked.full.map(
            (slot: { startAt: number; durationMinutes: number | null }) => ({
              start: spokenOf(slot.startAt),
              duration_minutes: slot.durationMinutes ?? 30,
            }),
          ),
          ...(suggested.length > 0
            ? { suggested_slots: suggested.map((at) => spokenOf(at)) }
            : {}),
          ...openness,
          note:
            (suggested.length > 0
              ? "Offer two or three of suggested_slots as concrete times." +
                " Never answer by reciting the opening hours. "
              : "") +
            "These times are FULL — everything else is free. Offer times that avoid them" +
            (openness.open_hours ? ", stay inside open_hours" : "") +
            (openness.closed_days ? ", never offer a date on closed_days" : "") +
            ".",
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
      const startAt = parseLocalStart(String(input.start ?? ""), org.timezone);
      const customerName =
        String(input.name ?? "").trim() ||
        `${customer.firstName} ${customer.lastName ?? ""}`.trim();
      if (Number.isNaN(startAt)) return { error: "missing-or-bad-start" };
      if (!customerName || customerName === customer.phone) {
        return { error: "missing-name", note: "Ask the customer for their name first." };
      }
      const now = Date.now();
      if (startAt < now - 5 * 60_000) return { error: "start-is-in-the-past" };
      if (startAt > now + 400 * 24 * 60 * 60_000) return { error: "start-is-too-far-ahead" };
      const hours = org.businessHours;
      if (hours && hasBusinessHours(hours) && !isWithinActiveWindow(startAt, org.timezone, hours)) {
        return {
          error: "outside-open-hours",
          attempted: spokenOf(startAt),
          ...openHoursForAgent(hours),
          note: "The business is CLOSED then, so this was not booked. Offer the nearest time inside open_hours.",
        };
      }
      // Plural now, with the same tolerance the voice handler has: a
      // model that packs "saç kesimi, sakal" into one entry gets it split
      // rather than matched against nothing. `service` stays accepted
      // because nothing stops an older conversation mid-flight from
      // having already been handed the previous tool shape.
      const spokenServices = Array.isArray(input.services)
        ? input.services
            .flatMap((one) => String(one ?? "").split(","))
            .map((one) => one.trim())
            .filter(Boolean)
        : undefined;
      const spokenService = String(input.service ?? "").trim() || undefined;
      let externalUid: string | undefined;
      if (org.calcomApiKey && org.calcomEventTypeId) {
        // Same rule as the voice webhook: a goods-only order stays local.
        // cal.com has nothing zero-length, and an externalUid would skip
        // voiceBook's guards — lead time included.
        const { goodsOnly } = await ctx.runQuery(internal.retell.classifyServices, {
          orgId: context.orgId,
          spoken: spokenServices ?? (spokenService ? [spokenService] : []),
        });
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
        });
        return {
          booked: true,
          spoken_time: spokenOf(startAt),
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
      // The stamp silences the agent for this conversation from the NEXT
      // message on; the current reply still goes out, which is what lets the
      // model say "the team will follow up" and mean it.
      await ctx.runMutation(internal.chatAgent.pauseForCustomer, {
        customerId: customer._id,
      });
      return { escalated: true, note: "Tell the customer the team will follow up." };
    }

    return { error: `unknown-tool-${name}` };
  } catch (err) {
    // A tool that throws is a result the model can read, not a dead turn: it
    // apologises and escalates instead of leaving the customer on silence.
    return { error: err instanceof Error ? err.message : "tool-failed" };
  }
}



