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

const PROCESS_BACKOFF = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];
const ANALYSIS_BACKOFF = [2 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

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
    await ctx.db.patch(eventId, {
      status: "processed",
      processedAt: now,
      processingAt: undefined,
      nextAttemptAt: undefined,
      error: undefined,
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
      const beforeValues =
        (call.retell_llm_dynamic_variables as Record<string, unknown> | undefined) ?? {};
      const duringValues =
        (call.collected_dynamic_variables as Record<string, unknown> | undefined) ?? {};
      const afterValues =
        (analysis.custom_analysis_data as Record<string, unknown> | undefined) ?? {};
      // Confirmed live values win over transcript inference. Pre-call context
      // remains on the call record but is the weakest source.
      const collected = { ...beforeValues, ...afterValues, ...duringValues };

      await ctx.runMutation(internal.retell.recordCall, {
        retellAgentId: row.retellAgentId,
        retellCallId: row.retellCallId,
        fromNumber: String(call.from_number ?? "") || undefined,
        startedAt,
        durationSec:
          endedAt > startedAt ? Math.round((endedAt - startedAt) / 1000) : undefined,
        outcome: String(analysis.call_successful ?? "") || undefined,
        summary: String(analysis.call_summary ?? "") || undefined,
        transcript: String(call.transcript ?? "") || undefined,
        recordingUrl: String(call.recording_url ?? "") || undefined,
        collected: Object.keys(collected).length > 0 ? collected : undefined,
      });

      const phone = String(call.from_number ?? "");
      const inferred = coerceVoiceValues(afterValues);
      const confirmed = coerceVoiceValues(duringValues);
      if (phone && Object.keys(inferred).length > 0) {
        await ctx.runMutation(internal.retell.updateContactFromVoice, {
          retellAgentId: row.retellAgentId,
          phone,
          values: inferred,
          fillOnlyMissing: true,
        });
      }
      if (phone && Object.keys(confirmed).length > 0) {
        await ctx.runMutation(internal.retell.updateContactFromVoice, {
          retellAgentId: row.retellAgentId,
          phone,
          values: confirmed,
        });
      }

      await ctx.runMutation(internal.voiceEvents.complete, { eventId });
      if (row.eventType === "call_ended") {
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
    const context = await ctx.runQuery(internal.voiceEvents.recoveryContext, args);
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
    const [agents, events] = await Promise.all([
      ctx.db.query("retellAgents").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db
        .query("voiceEvents")
        .withIndex("by_org_received", (q) => q.eq("orgId", orgId))
        .order("desc")
        .take(200),
    ]);
    return agents.map((agent) => {
      const own = events.filter((event) => event.retellAgentId === agent.retellAgentId);
      const failed = own.filter((event) => event.status === "failed").length;
      const retrying = own.filter(
        (event) => event.status === "retrying" || event.status === "processing",
      ).length;
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
