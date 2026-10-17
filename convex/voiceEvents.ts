import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { connectionField } from "./lib/connections";
import { requireOrg } from "./lib/orgAuth";
import { coerceVoiceValues } from "./lib/voicePayload";
import { withoutNonAnswers } from "./lib/nonAnswer";
import { NO_AI_CALLS_FIELD, VOICE_SUMMARY_FIELD } from "./lib/voiceAgentTemplate";
import { callErased, erasedCallMarker } from "./lib/customerDeletion";
import { placedByOf } from "./lib/browserTest";
import { callOutcome } from "./lib/callOutcome";
import { customerSpokenText, detectTextLanguage } from "./lib/textLanguage";

// A boolean analysis field arrives as a JSON boolean; a stringified one is
// read the same way rather than dropped.
function isYes(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const answer = value.trim().toLowerCase();
  return answer === "true" || answer === "yes";
}

const PROCESS_BACKOFF = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];
const ANALYSIS_BACKOFF = [2 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
// How many open (failed / retrying / processing) rows `health` will read per
// status. A number, not a signal: past it the card says "needs attention"
// either way, and the operator's org page is where the individual rows are.
const HEALTH_CAP = 100;

type StoredEvent = {
  _id: Id<"voiceEvents">;
  orgId: Id<"orgs">;
  retellAgentId: string;
  retellCallId: string;
  eventType: "call_ended" | "call_analyzed" | "analysis_recovery";
  payload: unknown;
  attempts: number;
};

// HTTP handlers call only this mutation. A successful response therefore
// means the exact provider payload is durable, not merely that we attempted to
// update a customer before the request timed out.
export const enqueue = internalMutation({
  args: {
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    retellCallId: v.string(),
    eventType: v.union(v.literal("call_ended"), v.literal("call_analyzed")),
    payload: v.any(),
  },
  returns: v.id("voiceEvents"),
  handler: async (ctx, args): Promise<Id<"voiceEvents">> => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent || agent.orgId !== args.orgId) throw new Error("unknown-agent");

    // A call erased with its customer stays erased. A late analysis, a retry
    // of the first webhook or the analysis recovery lands here and stops,
    // before it can write the call back with a new customer built from the
    // transcript (lib/customerDeletion).
    const erased = await erasedCallMarker(ctx, args.orgId, args.retellCallId);
    if (erased) return erased._id;

    const eventKey = `${args.retellCallId}:${args.eventType}`;
    const existing = await ctx.db
      .query("voiceEvents")
      .withIndex("by_org_event_key", (q) =>
        q.eq("orgId", args.orgId).eq("eventKey", eventKey),
      )
      .unique();
    if (existing) {
      // A retry may carry more complete data. Keep the newest body until the
      // event is processed; a processed event already updated the call row.
      if (existing.status !== "processed") {
        await ctx.db.patch(existing._id, {
          payload: args.payload,
          status: "queued",
          attempts: existing.status === "failed" ? 0 : existing.attempts,
          receivedAt: Date.now(),
          error: undefined,
          nextAttemptAt: undefined,
        });
        await ctx.scheduler.runAfter(0, internal.voiceEvents.process, {
          eventId: existing._id,
        });
      }
      return existing._id;
    }

    const eventId = await ctx.db.insert("voiceEvents", {
      orgId: args.orgId,
      retellAgentId: args.retellAgentId,
      retellCallId: args.retellCallId,
      eventType: args.eventType,
      eventKey,
      payload: args.payload,
      status: "queued",
      attempts: 0,
      receivedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.voiceEvents.process, { eventId });
    return eventId;
  },
});

export const claim = internalMutation({
  args: { eventId: v.id("voiceEvents") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, { eventId }): Promise<StoredEvent | null> => {
    const row = await ctx.db.get(eventId);
    if (!row || row.status === "processed" || row.status === "failed") return null;
    // The erased-call marker is written processed and is never work; named
    // here so the row below is a provider event by type as well as by status.
    if (row.eventType === "customer_deleted") return null;
    // A duplicate scheduler job stands down while another worker owns the row.
    // A claim older than two minutes is considered abandoned and may be taken.
    if (
      row.status === "processing" &&
      row.processingAt &&
      row.processingAt > Date.now() - 2 * 60_000
    ) {
      return null;
    }
    const attempts = row.attempts + 1;
    await ctx.db.patch(eventId, {
      status: "processing",
      attempts,
      processingAt: Date.now(),
      nextAttemptAt: undefined,
    });
    return {
      _id: row._id,
      orgId: row.orgId,
      retellAgentId: row.retellAgentId,
      retellCallId: row.retellCallId,
      eventType: row.eventType,
      payload: row.payload,
      attempts,
    };
  },
});

export const complete = internalMutation({
  args: { eventId: v.id("voiceEvents") },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    const row = await ctx.db.get(eventId);
    if (!row) return null;
    const now = Date.now();
    // The payload goes with the status. It is Retell's whole webhook body —
    // transcript, analysis, cost — and once processed every fact in it lives
    // on the calls row. Kept, it made this table the heaviest thing on the
    // deployment to READ: `health` and the operator's org page both scan an
    // agent's recent events, and each re-run of those live queries pulled 200
    // full transcripts back off disk for the sake of a status column. A row
    // that fails keeps its payload, because a retry has to replay it.
    await ctx.db.patch(eventId, {
      status: "processed",
      processedAt: now,
      processingAt: undefined,
      nextAttemptAt: undefined,
      error: undefined,
      payload: null,
    });
    // The provider may deliver its analysis after our recovery window. A real
    // analyzed event supersedes that earlier warning for the same call.
    if (row.eventType === "call_analyzed") {
      const sameCall = await ctx.db
        .query("voiceEvents")
        .withIndex("by_org_call", (q) =>
          q.eq("orgId", row.orgId).eq("retellCallId", row.retellCallId),
        )
        .collect();
      for (const superseded of sameCall) {
        if (superseded.eventType === "call_analyzed" || superseded.status === "processed") continue;
        await ctx.db.patch(superseded._id, {
          status: "processed",
          processedAt: now,
          processingAt: undefined,
          nextAttemptAt: undefined,
          error: undefined,
          payload: null,
        });
      }
    }
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", row.retellAgentId))
      .unique();
    if (agent && agent.orgId === row.orgId) {
      await ctx.db.patch(agent._id, {
        lastCallEventAt: now,
        ...(row.eventType === "call_analyzed" ? { lastAnalyzedEventAt: now } : {}),
        lastEventError: undefined,
        lastEventErrorAt: undefined,
      });
    }
    return null;
  },
});

export const fail = internalMutation({
  args: { eventId: v.id("voiceEvents"), error: v.string() },
  returns: v.object({ retry: v.boolean(), delayMs: v.number() }),
  handler: async (ctx, { eventId, error }) => {
    const row = await ctx.db.get(eventId);
    if (!row) return { retry: false, delayMs: 0 };
    const retry = row.attempts <= PROCESS_BACKOFF.length;
    const delayMs = retry ? (PROCESS_BACKOFF[row.attempts - 1] ?? 0) : 0;
    await ctx.db.patch(eventId, {
      status: retry ? "retrying" : "failed",
      processingAt: undefined,
      nextAttemptAt: retry ? Date.now() + delayMs : undefined,
      error: error.slice(0, 500),
    });
    if (!retry) {
      const agent = await ctx.db
        .query("retellAgents")
        .withIndex("by_agent", (q) => q.eq("retellAgentId", row.retellAgentId))
        .unique();
      if (agent && agent.orgId === row.orgId) {
        await ctx.db.patch(agent._id, {
          lastEventErrorAt: Date.now(),
          lastEventError: error.slice(0, 500),
        });
      }
    }
    return { retry, delayMs };
  },
});

export const process = internalAction({
  args: { eventId: v.id("voiceEvents") },
  returns: v.null(),
  handler: async (ctx, { eventId }): Promise<null> => {
    const row = (await ctx.runMutation(internal.voiceEvents.claim, {
      eventId,
    })) as StoredEvent | null;
    if (!row) return null;
    try {
      const payload = row.payload as Record<string, unknown>;
      const call = ((payload.call ?? payload) || {}) as Record<string, unknown>;
      const analysis = (call.call_analysis ?? {}) as Record<string, unknown>;
      const startedAt = Number(call.start_timestamp ?? Date.now());
      const endedAt = Number(call.end_timestamp ?? 0);
      const duringValues =
        (call.collected_dynamic_variables as Record<string, unknown> | undefined) ?? {};
      const afterValues = {
        ...((analysis.custom_analysis_data as Record<string, unknown> | undefined) ?? {}),
      };
      // Our summary rides in on the custom-analysis bag because that is the
      // only channel Retell offers, but it is not something the caller told
      // us, so it is lifted out before the rest becomes "what was collected".
      // Left in, every call card would show the whole summary a second time as
      // an unnamed collected value.
      const localizedSummary = String(afterValues[VOICE_SUMMARY_FIELD] ?? "");
      delete afterValues[VOICE_SUMMARY_FIELD];
      // The "don't call me again" flag (template v15) is ours too, and a
      // request rather than an answer: lifted out so it never lands as a
      // contact field, and written below only when it is a yes.
      const askedNoAiCalls = isYes(afterValues[NO_AI_CALLS_FIELD]);
      delete afterValues[NO_AI_CALLS_FIELD];
      // Confirmed live values win over transcript inference.
      //
      // beforeValues is deliberately NOT merged in. It is Retell's whole
      // pre-call bag, and over a Twilio SIP trunk that bag carries the
      // transport's own headers — Diversion, P-Asserted-Identity, Lk-Real-Ip,
      // Twilio-Callsid. Merging it filed all of that under "what the agent
      // collected", so a discovery call's card read as six answers buried in
      // eight lines of SIP plumbing. What we injected is not something the
      // caller told us, and this record only claims the latter.
      //
      // Nor is a non-answer ("Belirtilmedi", "Not specified", lib/nonAnswer).
      // Dropped from each bag BEFORE they merge, so a placeholder from the
      // live extraction cannot hide a real value the analysis recovered.
      const collected = {
        ...withoutNonAnswers(afterValues),
        ...withoutNonAnswers(duringValues),
      };

      // Retell prices the call in USD cents on call_cost.combined_cost, and
      // only the call_analyzed event carries it. Converted to micro-USD here
      // so the meter (retell.meterCall) speaks the ledger's one unit.
      const combinedCostCents = Number(
        ((call.call_cost ?? {}) as Record<string, unknown>).combined_cost,
      );

      // Retell reports outbound legs (test calls, campaigns) with the agent's
      // own line in from_number; recordCall branches on direction to pick the
      // customer's leg. A web call carries no direction and no numbers, and
      // defaults to inbound.
      const direction =
        String(call.direction ?? "") === "outbound" ? ("outbound" as const) : ("inbound" as const);

      await ctx.runMutation(internal.retell.recordCall, {
        retellAgentId: row.retellAgentId,
        retellCallId: row.retellCallId,
        direction,
        fromNumber: String(call.from_number ?? "") || undefined,
        toNumber: String(call.to_number ?? "") || undefined,
        startedAt,
        durationSec:
          endedAt > startedAt ? Math.round((endedAt - startedAt) / 1000) : undefined,
        outcome: String(analysis.call_successful ?? "") || undefined,
        // Ours first, Retell's built-in as the fallback. The fallback is what
        // an agent provisioned before the field existed still sends, and what
        // arrives if the analysis pass skipped the field.
        summary: localizedSummary || String(analysis.call_summary ?? "") || undefined,
        transcript: String(call.transcript ?? "") || undefined,
        recordingUrl: String(call.recording_url ?? "") || undefined,
        collected: Object.keys(collected).length > 0 ? collected : undefined,
        // Only call_ended carries it; call_analyzed arrives without one and
        // recordCall's fill-don't-overwrite patch keeps the first value.
        disconnectionReason: String(call.disconnection_reason ?? "") || undefined,
        retellCostMicroUsd: Number.isFinite(combinedCostCents)
          ? Math.round(combinedCostCents * 10_000)
          : undefined,
        placedBy: placedByOf(call),
      });

      // The customer's leg, same branch as recordCall. updateContactFromVoice
      // normalizes it and refuses the org's own lines.
      const phone = String(
        (direction === "outbound" ? call.to_number : call.from_number) ?? "",
      );
      const inferred = coerceVoiceValues(afterValues);
      const confirmed = coerceVoiceValues(duringValues);
      if (phone && Object.keys(inferred).length > 0) {
        await ctx.runMutation(internal.retell.updateContactFromVoice, {
          retellAgentId: row.retellAgentId,
          phone,
          values: inferred,
          fillOnlyMissing: true,
          retellCallId: row.retellCallId,
        });
      }
      if (phone && Object.keys(confirmed).length > 0) {
        await ctx.runMutation(internal.retell.updateContactFromVoice, {
          retellAgentId: row.retellAgentId,
          phone,
          values: confirmed,
          retellCallId: row.retellCallId,
        });
      }
      // "Don't call me again": only a yes reaches the record, through a
      // one-way mutation, so a later call analysed as a no never clears it.
      if (phone && askedNoAiCalls) {
        await ctx.runMutation(internal.retell.markNoAiCallsFromCall, {
          retellAgentId: row.retellAgentId,
          phone,
          retellCallId: row.retellCallId,
        });
      }

      // The language they spoke replaces the business's as their guess
      // (P30). Only on an event that SAYS the call was answered: the
      // analysis event carries no disconnect code, and its duration alone
      // cannot tell a person from a voicemail greeting, whose language is the
      // phone network's.
      const spoken =
        callOutcome(String(call.disconnection_reason ?? "") || undefined) === "answered"
          ? detectTextLanguage(customerSpokenText(call.transcript_object, call.transcript))
          : null;
      if (phone && spoken) {
        await ctx.runMutation(internal.retell.learnLanguageFromCall, {
          retellAgentId: row.retellAgentId,
          phone,
          retellCallId: row.retellCallId,
          language: spoken,
        });
      }

      await ctx.runMutation(internal.voiceEvents.complete, { eventId });
      if (row.eventType === "call_ended") {
        // The bulk call queue's continuation, and the ONLY thing that
        // advances it in the normal case (convex/bulkRuns.ts). The queue dials
        // strictly one at a time, and the item it is holding stays "dialing"
        // until this line releases it — so a run whose calls end here is a run
        // that keeps going, and one whose webhook never arrives waits for the
        // reaper instead.
        //
        // call_ended rather than call_analyzed on purpose. Both events reach
        // this handler, and call_ended already carries the duration and the
        // disconnection reason the queue records; waiting for the analysis
        // would insert one to three minutes of dead air between every call in
        // the run, for a fact the queue does not use. The analysis still lands
        // afterwards through recoverAnalysis below and enriches the calls row
        // the item points at.
        //
        // Placed after complete() so a failure here cannot re-run the whole
        // event; idempotent regardless, because enqueue dedupes on
        // (call, eventType) and finishByCallId only ever moves a "dialing"
        // row.
        await ctx.runMutation(internal.bulkRuns.finishByCallId, {
          retellCallId: row.retellCallId,
        });
        await ctx.scheduler.runAfter(ANALYSIS_BACKOFF[0], internal.voiceEvents.recoverAnalysis, {
          orgId: row.orgId,
          retellAgentId: row.retellAgentId,
          retellCallId: row.retellCallId,
          attempt: 0,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result = await ctx.runMutation(internal.voiceEvents.fail, {
        eventId,
        error: message,
      });
      if (result.retry) {
        await ctx.scheduler.runAfter(result.delayMs, internal.voiceEvents.process, { eventId });
      }
    }
    return null;
  },
});

export const recoveryContext = internalQuery({
  args: {
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    retellCallId: v.string(),
  },
  returns: v.union(
    v.object({ analyzed: v.boolean(), apiKey: v.union(v.string(), v.null()) }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent || agent.orgId !== args.orgId) return null;
    // Nothing to recover for a call erased with its customer, and no reason
    // to ask the provider for it again.
    if (await callErased(ctx, args.orgId, args.retellCallId)) return null;
    const rows = await ctx.db
      .query("voiceEvents")
      .withIndex("by_org_call", (q) =>
        q.eq("orgId", args.orgId).eq("retellCallId", args.retellCallId),
      )
      .collect();
    return {
      analyzed: rows.some(
        (row) => row.eventType === "call_analyzed" && row.status === "processed",
      ),
      apiKey: await connectionField(ctx, args.orgId, "retell", "apiKey"),
    };
  },
});

export const markRecoveryFailed = internalMutation({
  args: {
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    retellCallId: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const eventKey = `${args.retellCallId}:analysis_recovery`;
    const existing = await ctx.db
      .query("voiceEvents")
      .withIndex("by_org_event_key", (q) =>
        q.eq("orgId", args.orgId).eq("eventKey", eventKey),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "failed",
        attempts: existing.attempts + 1,
        error: args.error.slice(0, 500),
      });
    } else {
      await ctx.db.insert("voiceEvents", {
        orgId: args.orgId,
        retellAgentId: args.retellAgentId,
        retellCallId: args.retellCallId,
        eventType: "analysis_recovery",
        eventKey,
        payload: {},
        status: "failed",
        attempts: ANALYSIS_BACKOFF.length,
        receivedAt: Date.now(),
        error: args.error.slice(0, 500),
      });
    }
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (agent && agent.orgId === args.orgId) {
      await ctx.db.patch(agent._id, {
        lastEventErrorAt: Date.now(),
        lastEventError: args.error.slice(0, 500),
      });
    }
    return null;
  },
});

export const recoverAnalysis = internalAction({
  args: {
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    retellCallId: v.string(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // Named fields, not `args`. Forwarding the whole bag sent `attempt` to a
    // validator that declares three fields, and Convex rejects an undeclared
    // property — so this action threw on its first statement, every time, and
    // the entire analysis-recovery path was dead: no re-enqueue, no
    // markRecoveryFailed, lastEventError left clear so health reported green,
    // and no retellCostMicroUsd reaching the meter. TypeScript could not see
    // it because `args` is a variable, so excess-property checking never ran.
    const context = await ctx.runQuery(internal.voiceEvents.recoveryContext, {
      orgId: args.orgId,
      retellAgentId: args.retellAgentId,
      retellCallId: args.retellCallId,
    });
    if (!context || context.analyzed) return null;
    let reason = "Call analysis did not arrive.";
    if (context.apiKey) {
      try {
        const response = await fetch(
          `https://api.retellai.com/v2/get-call/${encodeURIComponent(args.retellCallId)}`,
          { headers: { authorization: `Bearer ${context.apiKey}` } },
        );
        if (!response.ok) throw new Error(`get-call-http-${response.status}`);
        const call = (await response.json()) as Record<string, unknown>;
        const analysis = call.call_analysis;
        if (analysis && typeof analysis === "object" && Object.keys(analysis).length > 0) {
          await ctx.runMutation(internal.voiceEvents.enqueue, {
            orgId: args.orgId,
            retellAgentId: args.retellAgentId,
            retellCallId: args.retellCallId,
            eventType: "call_analyzed",
            payload: { event: "call_analyzed", call },
          });
          return null;
        }
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
    } else {
      reason = "No provider connection is available for analysis recovery.";
    }

    const nextAttempt = args.attempt + 1;
    const delay = ANALYSIS_BACKOFF[nextAttempt];
    if (delay !== undefined) {
      await ctx.scheduler.runAfter(delay, internal.voiceEvents.recoverAnalysis, {
        ...args,
        attempt: nextAttempt,
      });
    } else {
      await ctx.runMutation(internal.voiceEvents.markRecoveryFailed, {
        orgId: args.orgId,
        retellAgentId: args.retellAgentId,
        retellCallId: args.retellCallId,
        error: reason,
      });
    }
    return null;
  },
});

// Customer UI consumes only the symptom. Raw provider errors remain in the
// platform console, while a normal healthy agent renders no extra noise.
export const health = query({
  args: {},
  returns: v.array(
    v.object({
      retellAgentId: v.string(),
      runtimeConnected: v.boolean(),
      needsAttention: v.boolean(),
      retrying: v.number(),
      failed: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const agents = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    // Only the rows that can change the answer. This used to read the org's
    // 200 newest events whatever their state, which meant two things at once:
    // every execution carried 200 provider payloads, and the subscription
    // re-ran on every one of the three or four writes each call produces,
    // because each of them landed inside that window. On a healthy
    // deployment these three ranges are EMPTY, so the query reads the agents
    // and nothing else, and a call being processed normally touches only the
    // "processing" range for the seconds it is in flight.
    const open = (
      await Promise.all(
        (["failed", "retrying", "processing"] as const).map((status) =>
          ctx.db
            .query("voiceEvents")
            .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", status))
            .take(HEALTH_CAP),
        ),
      )
    ).flat();
    return agents.map((agent) => {
      const own = open.filter((event) => event.retellAgentId === agent.retellAgentId);
      const failed = own.filter((event) => event.status === "failed").length;
      const retrying = own.length - failed;
      return {
        retellAgentId: agent.retellAgentId,
        runtimeConnected: agent.runtimeConnectedAt !== undefined,
        needsAttention: failed > 0,
        retrying,
        failed,
      };
    });
  },
});

// One-off, and safe to re-run: null the payload on every event that is already
// processed. `complete` has done this on the way through since 2026-09-03;
// this is for the rows that were processed before it did. Pages itself
// through the table 50 rows at a time — the rows it is here to shrink are the
// heavy ones, so a page is kept well under the transaction's read budget.
//
//   npx convex run voiceEvents:stripProcessedPayloads --prod
export const stripProcessedPayloads = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ stripped: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("voiceEvents")
      .paginate({ cursor: args.cursor ?? null, numItems: 50 });
    let stripped = 0;
    for (const row of page.page) {
      if (row.status !== "processed" || row.payload === null) continue;
      await ctx.db.patch(row._id, { payload: null });
      stripped += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.voiceEvents.stripProcessedPayloads, {
        cursor: page.continueCursor,
      });
    }
    return { stripped, done: page.isDone };
  },
});
