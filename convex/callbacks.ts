// Requested callbacks (2026-10-18, P36 of the Nudge port; Serdar approved it
// knowing it dials real phones). A customer on a call says "call me back
// tomorrow at four", the agent's post-call analysis writes the time down
// (template v16, CALLBACK_TIME_FIELD), and Resepta rings them once, then.
//
// Nudge does this with trigger rules over a call_back_time field. Resepta has
// no triggers, so it is one built-in behaviour with one table, and the rules
// a bulk call obeys (AGENTS.md "A bulk call rings only when it should") are
// obeyed here, in the transaction that claims, for the same reason: a guard
// kept anywhere else is a guard a retry or a sweep dials straight through.
//
//   requestFromCall  the post-call analysis heard a time on an ANSWERED call
//   dial / claim     at dueAt: open hours, consent, No AI calls, the
//                    platform's limit, a line, the published version
//   finishByCallId   the call_ended webhook says what the call came to
//   cancel paths     a real conversation since the request (retell.ts
//                    stampCallClocks), a person's own dial (testCall), the
//                    record's Cancel, the customer's deletion
//   sweep            the cron's backstop for a lost wake-up or a stuck dial
//
// NOT the bulk run's "already called today" skip: this call was asked for.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireOrg } from "./lib/orgAuth";
import { isDemo } from "./demo";
import { callErased, isDeleting } from "./lib/customerDeletion";
import { isNonAnswer } from "./lib/nonAnswer";
import { judgeCallbackTime } from "./lib/callbackTime";
import { nextOpenAt, parseLocalStart } from "./lib/businessHours";
import { loadClosures } from "./lib/closureRows";
import { bulkCallLimit } from "./lib/platformConfig";
import { cleanError } from "./lib/mcpProtocol";
import {
  callOutcome,
  isAccountRefusal,
  isRetryableCallEnd,
  isRetryableDialError,
  reachedPhone,
} from "./lib/callOutcome";
import { callHoursFor, callWindowAt, skipReason } from "./bulkRuns";

// A refused dial (no free line, the provider's own fault) goes back in line
// this many times, one minute longer per try: the bulk queue's numbers.
const MAX_DIAL_ATTEMPTS = 6;
const DIAL_RETRY_STEP_MS = 60_000;
// The platform's limit on automated calls at once is full: look again soon.
const PLATFORM_LIMIT_WAIT_MS = 30_000;
// Another automated call to this customer is ringing right now.
const BUSY_CUSTOMER_WAIT_MS = 2 * 60_000;
// A dial whose call_ended never came. The bulk queue's threshold.
const CALL_STUCK_MS = 20 * 60_000;
// The sweep looks for queued rows due this long ago and still waiting, which
// only a lost wake-up leaves behind; a wake-up running on time is never
// raced.
const SWEEP_GRACE_MS = 2 * 60_000;

type CallbackDoc = Doc<"callbacks">;

// Every queued callback for this customer, cancelled with one reason. The
// helper the cancel paths share, so "why did it not ring" always has an
// answer on the row. `before` keeps a callback asked for at or after that
// instant (the conversation that cancels must come AFTER the request).
export async function cancelQueuedCallbacks(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    customerId: Id<"customers">;
    reason: string;
    before?: number;
    by?: Id<"users">;
  },
): Promise<number> {
  const rows = await ctx.db
    .query("callbacks")
    .withIndex("by_org_customer_status", (q) =>
      q.eq("orgId", args.orgId).eq("customerId", args.customerId).eq("status", "queued"),
    )
    .take(20);
  let cancelled = 0;
  for (const row of rows) {
    if (args.before !== undefined && row.requestedAt >= args.before) continue;
    await ctx.db.patch(row._id, {
      status: "cancelled",
      reason: args.reason,
      ...(args.by ? { cancelledBy: args.by } : {}),
    });
    cancelled++;
  }
  return cancelled;
}

// ── Asked for on a call ──────────────────────────────────────────────────────

// The analysis of a call heard a callback time (voiceEvents.process lifts
// CALLBACK_TIME_FIELD out of the analysis bag and hands it here). Resolved
// like every other webhook write: the org from the agent row, the customer
// from the calls row recordCall wrote earlier in the same pass, never from
// the payload. Refused, quietly, for the demo org, an erased call, a call
// nobody answered (a voicemail greeting cannot ask for anything), a customer
// being deleted, and anyone a bulk call would not ring (no consent, No AI
// calls). A browser test never gets here: its webhook stops before
// voiceEvents.
export const requestFromCall = internalMutation({
  args: { retellAgentId: v.string(), retellCallId: v.string(), raw: v.string() },
  // The queued row, or why nothing was queued.
  returns: v.union(
    v.object({ ok: v.literal(true), callbackId: v.id("callbacks") }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const refuse = (reason: string) => ({ ok: false as const, reason });
    if (isNonAnswer(args.raw)) return refuse("no-time");
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent) return refuse("unknown-agent");
    const org = await ctx.db.get(agent.orgId);
    if (!org || isDemo(org)) return refuse("demo");
    if (await callErased(ctx, agent.orgId, args.retellCallId)) return refuse("erased");

    // A retried webhook, or the analysis arriving twice: the row it already
    // made answers it.
    const already = await ctx.db
      .query("callbacks")
      .withIndex("by_source_call", (q) => q.eq("sourceRetellCallId", args.retellCallId))
      .first();
    if (already && already.orgId === agent.orgId) {
      return { ok: true as const, callbackId: already._id };
    }

    const call = await ctx.db
      .query("calls")
      .withIndex("by_retell_call", (q) => q.eq("retellCallId", args.retellCallId))
      .unique();
    if (!call || call.orgId !== agent.orgId || !call.customerId) return refuse("no-call");
    // Answered: the provider's own judgement that a conversation happened,
    // or a disconnect code that says the line was picked up.
    const answered =
      call.outcome === "true" ||
      callOutcome(call.disconnectionReason, call.durationSec) === "answered";
    if (!answered) return refuse("not-answered");

    const customer = await ctx.db.get(call.customerId);
    if (!customer || customer.orgId !== agent.orgId) return refuse("no-customer");
    const skip = skipReason(customer, "call");
    if (skip) return refuse(skip);

    const now = Date.now();
    const closures = await loadClosures(ctx, org._id);
    const hours = callHoursFor(org);
    const verdict = judgeCallbackTime(args.raw, now, {
      parse: (text) => parseLocalStart(text, org.timezone),
      openAt: (ms) => nextOpenAt(ms, org.timezone, hours, closures),
    });
    if (!verdict.ok) return refuse(verdict.reason);

    // One queued callback per customer: the newer request is the one they
    // meant.
    await cancelQueuedCallbacks(ctx, {
      orgId: agent.orgId,
      customerId: customer._id,
      reason: "replaced",
    });
    const callbackId = await ctx.db.insert("callbacks", {
      orgId: agent.orgId,
      customerId: customer._id,
      retellAgentId: args.retellAgentId,
      requestedAt: call.startedAt,
      sourceRetellCallId: args.retellCallId,
      askedFor: verdict.askedFor,
      dueAt: verdict.dueAt,
      ...(verdict.moved ? { moved: true } : {}),
      status: "queued",
    });
    await ctx.db.patch(call._id, { callbackRequestedFor: verdict.dueAt });
    await ctx.scheduler.runAt(verdict.dueAt, internal.callbacks.dial, { callbackId });
    return { ok: true as const, callbackId };
  },
});

// ── Ringing it ───────────────────────────────────────────────────────────────

// How many automated calls are ringing now, across every business, up to
// `limit`: bulk run items and callbacks both. The bulk queue counts the same
// two (bulkRuns.claimNextCall), so the operator's one number covers both.
export async function liveAutomatedCalls(ctx: MutationCtx, limit: number): Promise<number> {
  const bulk = await ctx.db
    .query("bulkRunItems")
    .withIndex("by_status", (q) => q.eq("status", "dialing"))
    .take(limit);
  if (bulk.length >= limit) return bulk.length;
  const callbacks = await ctx.db
    .query("callbacks")
    .withIndex("by_status_due", (q) => q.eq("status", "dialing"))
    .take(limit - bulk.length);
  return bulk.length + callbacks.length;
}

// Puts a callback back to wait until `until`, with its wake-up.
async function waitUntil(
  ctx: MutationCtx,
  row: CallbackDoc,
  until: number,
  reason?: string,
): Promise<void> {
  await ctx.db.patch(row._id, {
    status: "queued",
    dueAt: until,
    ...(reason ? { reason } : {}),
  });
  await ctx.scheduler.runAt(until, internal.callbacks.dial, { callbackId: row._id });
}

// Every guard, in the transaction that claims (the bulk queue's
// claimNextCall, for one call). A claimed row is "dialing"; anything else
// says why not.
export const claim = internalMutation({
  args: { callbackId: v.id("callbacks") },
  returns: v.union(
    v.object({
      state: v.literal("claimed"),
      orgId: v.id("orgs"),
      retellAgentId: v.string(),
      fromNumber: v.string(),
      toNumber: v.string(),
    }),
    v.object({ state: v.literal("not-now") }),
  ),
  handler: async (ctx, { callbackId }) => {
    const notNow = { state: "not-now" as const };
    const row = await ctx.db.get(callbackId);
    if (!row || row.status !== "queued") return notNow;
    const now = Date.now();
    // An early wake-up (a sweep, or the time moved since this one was
    // scheduled): the wake-up at dueAt is still coming.
    if (row.dueAt > now + 1000) return notNow;
    const end = async (status: "cancelled" | "failed", reason: string) => {
      await ctx.db.patch(row._id, { status, reason });
      return notNow;
    };

    const org = await ctx.db.get(row.orgId);
    if (!org) return await end("cancelled", "missing-org");
    // The showroom never dials, before anything else is looked at.
    if (isDemo(org)) return await end("cancelled", "demo");
    const customer = await ctx.db.get(row.customerId);
    if (!customer || customer.orgId !== row.orgId || isDeleting(customer)) {
      return await end("cancelled", "customer-deleted");
    }
    // Consent and No AI calls, read again at the moment it would ring: either
    // can change in the hours it waited.
    const skip = skipReason(customer, "call");
    if (skip) return await end("cancelled", skip);

    // Open hours in the business's timezone, the bulk queue's own reading.
    const window = await callWindowAt(ctx, org, now);
    if (!window.open) {
      await waitUntil(ctx, row, window.until, window.reason);
      return notNow;
    }

    // Another automated call to them is ringing right now (a bulk run):
    // let it finish, then look again.
    const ringing = await ctx.db
      .query("bulkRunItems")
      .withIndex("by_org_customer", (q) =>
        q.eq("orgId", row.orgId).eq("customerId", row.customerId),
      )
      .take(100);
    if (ringing.some((item) => item.status === "dialing")) {
      await waitUntil(ctx, row, now + BUSY_CUSTOMER_WAIT_MS);
      return notNow;
    }

    // The operator's limit on automated calls at once (platformConfig
    // bulkCallConcurrency), counted here so two claims conflict.
    const limit = await bulkCallLimit(ctx);
    if (limit !== null && (await liveAutomatedCalls(ctx, limit)) >= limit) {
      await waitUntil(ctx, row, now + PLATFORM_LIMIT_WAIT_MS, "busy");
      return notNow;
    }

    // The agent that took the call, still this business's and switched on,
    // and a line to ring from: its own outbound line, else its inbound
    // number, bulkRuns.callLineFor's ladder. Never "the first number on the
    // account": every business shares one provider account.
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", row.retellAgentId))
      .unique();
    if (!agent || agent.orgId !== row.orgId) return await end("failed", "agent-not-found");
    if (!agent.enabled) return await end("failed", "agent-disabled");
    const lines = await ctx.db
      .query("agentLines")
      .withIndex("by_org", (q) => q.eq("orgId", row.orgId))
      .collect();
    const fromNumber =
      lines.find((line) => line.outboundAgentId === row.retellAgentId)?.number ??
      agent.inboundNumber;
    if (!fromNumber) return await end("failed", "no-outbound-line");
    if (!/^\+[1-9]\d{6,14}$/.test(customer.phone)) return await end("failed", "bad-phone");

    await ctx.db.patch(row._id, {
      status: "dialing",
      dialedAt: now,
      attempts: (row.attempts ?? 0) + 1,
    });
    return {
      state: "claimed" as const,
      orgId: row.orgId,
      retellAgentId: row.retellAgentId,
      fromNumber,
      toNumber: customer.phone,
    };
  },
});

export const stampCallId = internalMutation({
  args: { callbackId: v.id("callbacks"), retellCallId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.callbackId, { retellCallId: args.retellCallId });
    return null;
  },
});

// A refusal a later try can pass: nothing rang, so back in line one step
// longer per try, until the tries run out.
async function requeueRefused(ctx: MutationCtx, row: CallbackDoc, reason: string) {
  const attempts = row.attempts ?? 1;
  if (attempts >= MAX_DIAL_ATTEMPTS) {
    await ctx.db.patch(row._id, { status: "failed", reason });
    return;
  }
  await ctx.db.patch(row._id, { retellCallId: undefined });
  await waitUntil(ctx, row, Date.now() + attempts * DIAL_RETRY_STEP_MS, reason);
}

// The dial's outcome when it never became a call: back in line for a
// refusal worth retrying, failed for anything else. A thrown fetch is never
// re-dialled (isRetryableDialError says no), since that call may be ringing.
export const dialFailed = internalMutation({
  args: { callbackId: v.id("callbacks"), reason: v.string(), retry: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.callbackId);
    if (!row || row.status !== "dialing") return null;
    if (args.retry) await requeueRefused(ctx, row, args.reason);
    else await ctx.db.patch(row._id, { status: "failed", reason: args.reason });
    return null;
  },
});

// Places the one call, then gets out of the way. Scheduled at dueAt by
// requestFromCall and by every wait; the claim decides whether it may ring.
export const dial = internalAction({
  args: { callbackId: v.id("callbacks") },
  returns: v.null(),
  handler: async (ctx, { callbackId }): Promise<null> => {
    const claimed = await ctx.runMutation(internal.callbacks.claim, { callbackId });
    if (claimed.state !== "claimed") return null;
    // The org-level gate (agent off, business suspended, wallet empty) and
    // the call's ring-time variables in one read, as the bulk queue does. As
    // a call WE place, the first sentence follows what happened before (P34):
    // the conversation they asked on makes it "we spoke [when]".
    const before = (await ctx.runQuery(internal.retell.beforeCallContext, {
      retellAgentId: claimed.retellAgentId,
      phone: claimed.toNumber,
      direction: "outbound",
    })) as { dynamicVariables: Record<string, string> } | null;
    if (!before) {
      await ctx.runMutation(internal.callbacks.dialFailed, {
        callbackId,
        reason: "org-gate",
        retry: false,
      });
      return null;
    }
    try {
      // Pinned to the published version inside placeCall, and refused there
      // for the demo org and a business with no provider key.
      const callId = await ctx.runAction(internal.retellAgent.placeCall, {
        orgId: claimed.orgId,
        retellAgentId: claimed.retellAgentId,
        fromNumber: claimed.fromNumber,
        toNumber: claimed.toNumber,
        dynamicVariables: before.dynamicVariables,
      });
      await ctx.runMutation(internal.callbacks.stampCallId, {
        callbackId,
        retellCallId: callId,
      });
    } catch (error) {
      const message = cleanError(error);
      await ctx.runMutation(internal.callbacks.dialFailed, {
        callbackId,
        reason: message.slice(0, 200),
        retry: isRetryableDialError(message),
      });
    }
    return null;
  },
});

// Called from voiceEvents.process on call_ended, after recordCall wrote the
// calls row, beside the bulk queue's own finish. Idempotent: only a
// "dialing" row moves.
export const finishByCallId = internalMutation({
  args: { retellCallId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("callbacks")
      .withIndex("by_retell_call", (q) => q.eq("retellCallId", args.retellCallId))
      .unique();
    if (!row || row.status !== "dialing") return null;
    const call = await ctx.db
      .query("calls")
      .withIndex("by_retell_call", (q) => q.eq("retellCallId", args.retellCallId))
      .unique();
    const ended = call?.disconnectionReason;
    if (isRetryableCallEnd(ended)) {
      await requeueRefused(ctx, row, ended!);
      return null;
    }
    if (call && call.orgId === row.orgId) {
      await ctx.db.patch(call._id, { requestedCallback: true });
    }
    if (isAccountRefusal(ended)) {
      await ctx.db.patch(row._id, { status: "failed", reason: ended });
      return null;
    }
    // What the call came to, from the disconnect code: one that reached the
    // phone is the promise kept, whatever happened next (the call card says
    // whether they picked up); one that never did failed, with its code.
    const outcome = callOutcome(ended, call?.durationSec);
    const reached = outcome === undefined || reachedPhone(outcome);
    await ctx.db.patch(row._id, {
      status: reached ? "done" : "failed",
      reason: reached ? undefined : (ended ?? "call-failed"),
    });
    return null;
  },
});

// ── The safety net ───────────────────────────────────────────────────────────

// Every five minutes (crons.ts). Two ways the chain breaks with nobody
// watching, the bulk queue's two: a wake-up lost to a deploy, which leaves a
// queued row past its time, and a call_ended the provider never sent, which
// leaves a row "dialing" forever. Two index ranges, both empty on a healthy
// deployment.
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const late = await ctx.db
      .query("callbacks")
      .withIndex("by_status_due", (q) =>
        q.eq("status", "queued").lte("dueAt", now - SWEEP_GRACE_MS),
      )
      .take(25);
    for (const row of late) {
      await ctx.scheduler.runAfter(0, internal.callbacks.dial, { callbackId: row._id });
    }
    const dialing = await ctx.db
      .query("callbacks")
      .withIndex("by_status_due", (q) => q.eq("status", "dialing"))
      .take(50);
    for (const row of dialing) {
      if (now - (row.dialedAt ?? 0) < CALL_STUCK_MS) continue;
      await ctx.db.patch(row._id, { status: "failed", reason: "dial-timeout" });
    }
    return null;
  },
});

// ── A person's dial ──────────────────────────────────────────────────────────

// Somebody at the business rang the customer themselves (the record's Place
// call): the callback they asked for is now theirs to keep, and a second
// call at four would be the machine not knowing what a colleague did.
// retellAgent.testCall calls this after the provider accepted the dial.
export const cancelForPersonDial = internalMutation({
  args: { orgId: v.id("orgs"), phone: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) => q.eq("orgId", args.orgId).eq("phone", args.phone))
      .first();
    if (!customer) return null;
    await cancelQueuedCallbacks(ctx, {
      orgId: args.orgId,
      customerId: customer._id,
      reason: "person-called",
    });
    return null;
  },
});

// ── The record ───────────────────────────────────────────────────────────────

const callbackCardValidator = v.object({
  id: v.id("callbacks"),
  status: v.union(v.literal("queued"), v.literal("dialing")),
  dueAt: v.number(),
  askedFor: v.number(),
  moved: v.boolean(),
  requestedAt: v.number(),
  agentName: v.optional(v.string()),
  // A refusal a retry is carrying ("busy", or the provider's words).
  waiting: v.optional(v.string()),
});

// The callback this customer is waiting for, if any: queued, or ringing now.
// Two point reads on the record's own index, so the card costs nothing on a
// customer who never asked.
export const forCustomer = query({
  args: { customerId: v.id("customers") },
  returns: v.union(callbackCardValidator, v.null()),
  handler: async (ctx, { customerId }) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
    const pick = async (status: "queued" | "dialing") =>
      await ctx.db
        .query("callbacks")
        .withIndex("by_org_customer_status", (q) =>
          q.eq("orgId", orgId).eq("customerId", customerId).eq("status", status),
        )
        .first();
    const row = (await pick("dialing")) ?? (await pick("queued"));
    if (!row) return null;
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", row.retellAgentId))
      .unique();
    return {
      id: row._id,
      status: row.status === "dialing" ? ("dialing" as const) : ("queued" as const),
      dueAt: row.dueAt,
      askedFor: row.askedFor,
      moved: row.moved === true,
      requestedAt: row.requestedAt,
      ...(agent && agent.orgId === orgId ? { agentName: agent.name } : {}),
      ...(row.status === "queued" && row.reason ? { waiting: row.reason } : {}),
    };
  },
});

// The record's Cancel. Any member: cancelling a call is never the risky
// direction, and whoever is on shift is who the customer just told.
export const cancel = mutation({
  args: { callbackId: v.id("callbacks") },
  returns: v.boolean(),
  handler: async (ctx, { callbackId }) => {
    const { orgId, user } = await requireOrg(ctx);
    const row = await ctx.db.get(callbackId);
    if (!row || row.orgId !== orgId || row.status !== "queued") return false;
    await ctx.db.patch(row._id, {
      status: "cancelled",
      reason: "cancelled-by-person",
      cancelledBy: user._id,
    });
    return true;
  },
});
