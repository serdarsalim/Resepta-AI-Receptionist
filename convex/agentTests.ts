import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwner, requireOwnerOrDemoReader } from "./lib/orgAuth";
import { isDeleting } from "./lib/customerDeletion";
import { callVerdict } from "./schema";

// Browser tests of a voice agent (P8 of the Nudge port, 2026-10-17; Nudge's
// agentTests.ts and the divert in its processCallAnalyzed).
//
// A test is a WEB call from the agent page, so no phone rings. It costs the
// same provider minutes as a call and is billed like one, through the same
// meter, and it changes nothing anywhere else: no calls row, no thread entry,
// no inbox, no customer field, no appointment, no message. The agent's tools
// answer it dry (http.ts /retell/functions, `testOfCall`), acting as the
// customer the owner picked to "call as" and writing down what they WOULD
// have done here instead.
//
// Every read by call id asserts the org afterwards: the webhook and the
// transcript poll arrive without a session, and a call id is not a secret.

export const MAX_ACTIONS = 20;

const direction = v.union(v.literal("outbound"), v.literal("inbound"));

// The log row, written once the provider has minted the web call.
export const record = internalMutation({
  args: {
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    callId: v.string(),
    direction,
    agentVersion: v.union(v.number(), v.null()),
    draft: v.boolean(),
    customerId: v.optional(v.id("customers")),
    startedByUserId: v.optional(v.id("users")),
  },
  returns: v.id("agentTests"),
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent || agent.orgId !== args.orgId) throw new Error("no-such-agent");
    return await ctx.db.insert("agentTests", { ...args, startedAt: Date.now() });
  },
});

// The customer a test calls as: this org's, and not being deleted. The phone
// is what the ring-time variables are built from.
export const testCustomer = internalQuery({
  args: { orgId: v.id("orgs"), customerId: v.id("customers") },
  returns: v.union(v.null(), v.object({ phone: v.string(), name: v.string() })),
  handler: async (ctx, { orgId, customerId }) => {
    const customer = await ctx.db.get(customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
    return {
      phone: customer.phone,
      name: [customer.firstName, customer.lastName].filter(Boolean).join(" "),
    };
  },
});

// Whether a call is a test of this org, and as whom. The tools ask this on
// every function call that carries our test marker; null means "not a test
// of this org", and the caller then treats it as a test with nobody on the
// line rather than as a real call (a marked call must never write).
export const testOfCall = internalQuery({
  args: { orgId: v.id("orgs"), callId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      customerId: v.union(v.id("customers"), v.null()),
      phone: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { orgId, callId }) => {
    const row = await ctx.db
      .query("agentTests")
      .withIndex("by_call", (q) => q.eq("callId", callId))
      .first();
    if (!row || row.orgId !== orgId) return null;
    if (!row.customerId) return { customerId: null, phone: null };
    const customer = await ctx.db.get(row.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      return { customerId: null, phone: null };
    }
    return { customerId: customer._id, phone: customer.phone };
  },
});

// What a tool WOULD have done on a test call, appended in order.
export const noteAction = internalMutation({
  args: {
    orgId: v.id("orgs"),
    callId: v.string(),
    tool: v.string(),
    detail: v.string(),
    ok: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, callId, tool, detail, ok }) => {
    const row = await ctx.db
      .query("agentTests")
      .withIndex("by_call", (q) => q.eq("callId", callId))
      .first();
    if (!row || row.orgId !== orgId) return null;
    const actions = row.actions ?? [];
    if (actions.length >= MAX_ACTIONS) return null;
    await ctx.db.patch(row._id, {
      actions: [...actions, { tool, detail: detail.slice(0, 200), ok, at: Date.now() }],
    });
    return null;
  },
});

const testRow = v.object({
  _id: v.id("agentTests"),
  callId: v.string(),
  retellAgentId: v.string(),
  direction,
  agentVersion: v.union(v.number(), v.null()),
  draft: v.boolean(),
  customerId: v.union(v.id("customers"), v.null()),
  startedAt: v.number(),
  endedAt: v.union(v.number(), v.null()),
  durationSec: v.union(v.number(), v.null()),
  outcome: v.union(v.string(), v.null()),
  summary: v.union(v.string(), v.null()),
  collected: v.union(v.record(v.string(), v.any()), v.null()),
  recordingUrl: v.union(v.string(), v.null()),
  actions: v.array(
    v.object({ tool: v.string(), detail: v.string(), ok: v.boolean(), at: v.number() }),
  ),
  billedMicroUsd: v.union(v.number(), v.null()),
  note: v.union(v.string(), v.null()),
  verdict: v.union(callVerdict, v.null()),
});

// Every field named, none spread: the row carries columns (the provider's
// cost, who started it) the page has no business reading.
function shapeRow(row: Doc<"agentTests">) {
  return {
    _id: row._id,
    callId: row.callId,
    retellAgentId: row.retellAgentId,
    direction: row.direction,
    agentVersion: row.agentVersion,
    draft: row.draft,
    customerId: row.customerId ?? null,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? null,
    durationSec: row.durationSec ?? null,
    outcome: row.outcome ?? null,
    summary: row.summary ?? null,
    collected: row.collected ?? null,
    recordingUrl: row.recordingUrl ?? null,
    actions: row.actions ?? [],
    billedMicroUsd: row.billedMicroUsd ?? null,
    note: row.note ?? null,
    verdict: row.verdict ?? null,
  };
}

// The agent page's test log, newest first. Owner-only like the rest of the
// agent page, and this org's rows only.
export const listForAgent = query({
  args: { retellAgentId: v.string() },
  returns: v.array(
    v.object({
      test: testRow,
      customerName: v.union(v.string(), v.null()),
      // Who signs the review: who wrote it first and, when someone else
      // changed it since, who did (the call card's signature).
      noteBy: v.union(v.string(), v.null()),
      noteEditedBy: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { retellAgentId }) => {
    const { orgId } = await requireOwnerOrDemoReader(ctx);
    const rows = await ctx.db
      .query("agentTests")
      .withIndex("by_org_agent_started", (q) =>
        q.eq("orgId", orgId).eq("retellAgentId", retellAgentId),
      )
      .order("desc")
      .take(20);
    const names = new Map<string, string | null>();
    const nameOf = async (id: Id<"users"> | undefined) => {
      if (!id) return null;
      if (!names.has(id)) {
        const user = await ctx.db.get(id);
        names.set(id, user?.name ?? user?.email ?? null);
      }
      return names.get(id) ?? null;
    };
    // Who it called as, by name, from this org's own customers. A customer
    // since deleted reads as nobody.
    return await Promise.all(
      rows.map(async (row) => {
        const customer = row.customerId ? await ctx.db.get(row.customerId) : null;
        const customerName =
          customer && customer.orgId === orgId && !isDeleting(customer)
            ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.phone
            : null;
        const reviewed = !!(row.note || row.verdict);
        return {
          test: shapeRow(row),
          customerName,
          noteBy: reviewed ? await nameOf(row.noteCreatedBy) : null,
          noteEditedBy:
            reviewed && row.noteUpdatedBy && row.noteUpdatedBy !== row.noteCreatedBy
              ? await nameOf(row.noteUpdatedBy)
              : null,
        };
      }),
    );
  },
});

// One test of the caller's org, for the transcript poll. Carries the
// signed-in owner's check, so an action reaching it through runQuery cannot
// read another business's test by naming its call id.
export const ownedTest = internalQuery({
  args: { callId: v.string() },
  returns: v.union(v.null(), testRow),
  handler: async (ctx, { callId }) => {
    const { orgId } = await requireOwnerOrDemoReader(ctx);
    const row = await ctx.db
      .query("agentTests")
      .withIndex("by_call", (q) => q.eq("callId", callId))
      .first();
    if (!row || row.orgId !== orgId) return null;
    return shapeRow(row);
  },
});

// The owner's note and verdict on a test, saved as they are typed (on blur)
// and on every verdict click, from the opened row and from the Notes tab.
// Owner-only like the rest of the agent page, and this org's rows only. The
// same contract as calls.setReview: whichever half changed, `verdict: null`
// takes the verdict back, whitespace is not a note, and the note* stamps sign
// the review (who wrote first, who changed it last) and go when it is
// emptied.
export const setReview = mutation({
  args: {
    id: v.id("agentTests"),
    note: v.optional(v.string()),
    verdict: v.optional(v.union(callVerdict, v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { id, note: noteArg, verdict: verdictArg }) => {
    const { orgId, user } = await requireOwner(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("no-such-test");
    const note = noteArg === undefined ? row.note : noteArg.trim() || undefined;
    const verdict = verdictArg === undefined ? row.verdict : (verdictArg ?? undefined);
    if (note === row.note && verdict === row.verdict) return null;
    // Every field named, the absent ones as an explicit undefined, which in a
    // patch DELETES the field.
    const patch: Partial<Doc<"agentTests">> = { note, verdict };
    if (note === undefined && verdict === undefined) {
      patch.noteCreatedBy = undefined;
      patch.noteUpdatedBy = undefined;
      patch.noteUpdatedAt = undefined;
    } else {
      patch.noteUpdatedBy = user._id;
      patch.noteUpdatedAt = Date.now();
      if (!row.noteCreatedBy) patch.noteCreatedBy = user._id;
    }
    await ctx.db.patch(id, patch);
    return null;
  },
});
