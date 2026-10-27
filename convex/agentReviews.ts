import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwner, requireOwnerOrDemoReader } from "./lib/orgAuth";
import { isDeleting } from "./lib/customerDeletion";
import { callVerdict } from "./schema";

// The agent page's Notes tab (2026-10-21; Nudge's Analysis tab, built there
// 2026-10-09 and settled on a working mock with Serdar). A work queue of this
// agent's reviewed calls and browser tests: the one question it answers is
// what is still open on this agent, and what was done about the rest.
//
// A review is the note and verdict a call card (calls.setReview) or an opened
// test (agentTests.setReview) already carries. This adds what was done about
// it, open or done (setAction), on the same row: one per call or test, and it
// goes with the row, so deleting a customer takes it too and no table needs
// a place in the deletion sweep.
//
// Owner-only like the rest of the agent page. Every read is this org's: the
// indexes start with orgId, and an agent id from another business finds
// nothing. Bounded: the newest CAP reviews of each kind, and the list says
// when it stopped there.

const CAP = 200;

const kind = v.union(v.literal("call"), v.literal("test"));
const direction = v.union(v.literal("inbound"), v.literal("outbound"));

const item = v.object({
  kind,
  id: v.string(),
  // The customer, else the number that rang; null for a test run as a
  // stranger, which the page names by its direction.
  name: v.union(v.string(), v.null()),
  direction,
  // When the call or the test happened: the list's order, newest first.
  at: v.number(),
  verdict: v.union(callVerdict, v.null()),
  note: v.union(v.string(), v.null()),
  noteBy: v.union(v.string(), v.null()),
  action: v.union(v.string(), v.null()),
  actionBy: v.union(v.string(), v.null()),
  done: v.boolean(),
});

const signature = v.object({
  by: v.union(v.string(), v.null()),
  editedBy: v.union(v.string(), v.null()),
  at: v.union(v.number(), v.null()),
});

const detail = v.object({
  kind,
  id: v.string(),
  name: v.union(v.string(), v.null()),
  direction,
  at: v.number(),
  durationSec: v.union(v.number(), v.null()),
  disconnectionReason: v.union(v.string(), v.null()),
  // A call: the customer's leg, as the call carried it.
  number: v.union(v.string(), v.null()),
  // Who pressed Call (a call a person placed), or who ran the test.
  placedBy: v.union(v.string(), v.null()),
  summary: v.union(v.string(), v.null()),
  // A call's stored transcript. A test's words are the provider's, fetched
  // by `callId` (retellAgent.browserTestResult), never stored.
  transcript: v.union(v.string(), v.null()),
  recordingUrl: v.union(v.string(), v.null()),
  collected: v.union(v.record(v.string(), v.any()), v.null()),
  // Test-only.
  callId: v.union(v.string(), v.null()),
  draft: v.union(v.boolean(), v.null()),
  agentVersion: v.union(v.number(), v.null()),
  toolActions: v.array(
    v.object({ tool: v.string(), detail: v.string(), ok: v.boolean(), at: v.number() }),
  ),
  // The review and what was done about it, each signed.
  verdict: v.union(callVerdict, v.null()),
  note: v.union(v.string(), v.null()),
  noteSigned: signature,
  action: v.union(v.string(), v.null()),
  actionSigned: signature,
  done: v.boolean(),
  doneBy: v.union(v.string(), v.null()),
  doneAt: v.union(v.number(), v.null()),
});

// A person's name, read once per person per query.
function namer(ctx: QueryCtx) {
  const names = new Map<string, string | null>();
  return async (id: Id<"users"> | undefined): Promise<string | null> => {
    if (!id) return null;
    if (!names.has(id)) {
      const user = await ctx.db.get(id);
      names.set(id, user?.name ?? user?.email ?? null);
    }
    return names.get(id) ?? null;
  };
}

// Who a row is about. `gone` is a customer being deleted: they are gone to
// every reader, so their calls and tests leave the queue too.
async function subjectOf(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  customerId: Id<"customers"> | undefined,
  number: string | undefined,
): Promise<{ gone: boolean; name: string | null }> {
  if (!customerId) return { gone: false, name: number ?? null };
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.orgId !== orgId) return { gone: false, name: number ?? null };
  if (isDeleting(customer)) return { gone: true, name: null };
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
  return { gone: false, name: name || customer.phone || number || null };
}

type Reviewed = Doc<"calls"> | Doc<"agentTests">;

async function signed(
  nameOf: (id: Id<"users"> | undefined) => Promise<string | null>,
  createdBy: Id<"users"> | undefined,
  updatedBy: Id<"users"> | undefined,
  at: number | undefined,
) {
  return {
    by: await nameOf(createdBy),
    editedBy: updatedBy && updatedBy !== createdBy ? await nameOf(updatedBy) : null,
    at: at ?? null,
  };
}

export const list = query({
  args: { retellAgentId: v.string() },
  returns: v.object({ items: v.array(item), capped: v.boolean() }),
  handler: async (ctx, { retellAgentId }) => {
    const { orgId } = await requireOwnerOrDemoReader(ctx);
    const nameOf = namer(ctx);
    const [calls, tests] = await Promise.all([
      ctx.db
        .query("calls")
        .withIndex("by_org_agent_reviewed", (q) =>
          q.eq("orgId", orgId).eq("retellAgentId", retellAgentId).gt("noteUpdatedAt", 0),
        )
        .order("desc")
        .take(CAP),
      ctx.db
        .query("agentTests")
        .withIndex("by_org_agent_reviewed", (q) =>
          q.eq("orgId", orgId).eq("retellAgentId", retellAgentId).gt("noteUpdatedAt", 0),
        )
        .order("desc")
        .take(CAP),
    ]);
    const shape = async (
      row: Reviewed,
      kindOf: "call" | "test",
      subject: { name: string | null },
      at: number,
    ) => ({
      kind: kindOf,
      id: row._id as string,
      name: subject.name,
      direction: row.direction,
      at,
      verdict: row.verdict ?? null,
      note: row.note ?? null,
      noteBy: await nameOf(row.noteCreatedBy),
      action: row.action ?? null,
      actionBy: await nameOf(row.actionCreatedBy),
      done: row.doneAt !== undefined,
    });
    const items: Awaited<ReturnType<typeof shape>>[] = [];
    for (const call of calls) {
      const subject = await subjectOf(ctx, orgId, call.customerId, call.fromNumber);
      if (!subject.gone) items.push(await shape(call, "call", subject, call.startedAt));
    }
    for (const test of tests) {
      const subject = await subjectOf(ctx, orgId, test.customerId, undefined);
      if (!subject.gone) items.push(await shape(test, "test", subject, test.startedAt));
    }
    items.sort((a, b) => b.at - a.at);
    return { items, capped: calls.length === CAP || tests.length === CAP };
  },
});

// A reviewed call or test of this org, or null. A customer being deleted
// reads as null too.
async function loadReviewed(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">,
  kindOf: "call" | "test",
  id: string,
): Promise<
  | { kind: "call"; row: Doc<"calls">; name: string | null }
  | { kind: "test"; row: Doc<"agentTests">; name: string | null }
  | null
> {
  if (kindOf === "call") {
    const callId = ctx.db.normalizeId("calls", id);
    const row = callId ? await ctx.db.get(callId) : null;
    if (!row || row.orgId !== orgId) return null;
    const subject = await subjectOf(ctx, orgId, row.customerId, row.fromNumber);
    return subject.gone ? null : { kind: "call", row, name: subject.name };
  }
  const testId = ctx.db.normalizeId("agentTests", id);
  const row = testId ? await ctx.db.get(testId) : null;
  if (!row || row.orgId !== orgId) return null;
  const subject = await subjectOf(ctx, orgId, row.customerId, undefined);
  return subject.gone ? null : { kind: "test", row, name: subject.name };
}

// One review's page: the review, what was done, and the call or test it is
// about, everything but a test's words (fetched from the provider).
export const get = query({
  args: { kind, id: v.string() },
  returns: v.union(v.null(), detail),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwnerOrDemoReader(ctx);
    const found = await loadReviewed(ctx, orgId, args.kind, args.id);
    if (!found) return null;
    const nameOf = namer(ctx);
    const row = found.row;
    const shared = {
      kind: found.kind,
      id: args.id,
      name: found.name,
      direction: row.direction,
      at: row.startedAt,
      durationSec: row.durationSec ?? null,
      disconnectionReason: row.disconnectionReason ?? null,
      summary: row.summary ?? null,
      recordingUrl: row.recordingUrl ?? null,
      collected: row.collected ?? null,
      verdict: row.verdict ?? null,
      note: row.note ?? null,
      noteSigned: await signed(nameOf, row.noteCreatedBy, row.noteUpdatedBy, row.noteUpdatedAt),
      action: row.action ?? null,
      actionSigned: await signed(
        nameOf,
        row.actionCreatedBy,
        row.actionUpdatedBy,
        row.actionUpdatedAt,
      ),
      done: row.doneAt !== undefined,
      doneBy: await nameOf(row.doneBy),
      doneAt: row.doneAt ?? null,
    };
    if (found.kind === "call") {
      const call = found.row;
      return {
        ...shared,
        number: call.fromNumber ?? null,
        placedBy: await nameOf(call.placedByUserId),
        transcript: call.transcript ?? null,
        callId: null,
        draft: null,
        agentVersion: null,
        toolActions: [],
      };
    }
    const test = found.row;
    return {
      ...shared,
      number: null,
      placedBy: await nameOf(test.startedByUserId),
      transcript: null,
      callId: test.callId,
      draft: test.draft,
      agentVersion: test.agentVersion,
      toolActions: test.actions ?? [],
    };
  },
});

// What was done about a review, and whether it is done: either half, the
// other left alone. Signed like the note (who wrote first, who changed it
// last); emptied words drop their signature. Done is stamped with who and
// when, and Reopen takes both back.
export const setAction = mutation({
  args: {
    kind,
    id: v.string(),
    text: v.optional(v.string()),
    done: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId, user } = await requireOwner(ctx);
    const found = await loadReviewed(ctx, orgId, args.kind, args.id);
    if (!found) throw new Error("not-found");
    const row = found.row;
    const patch: {
      action?: string;
      actionCreatedBy?: Id<"users">;
      actionUpdatedBy?: Id<"users">;
      actionUpdatedAt?: number;
      doneAt?: number;
      doneBy?: Id<"users">;
    } = {};
    const now = Date.now();
    // Whitespace is not an action.
    const text = args.text === undefined ? row.action : args.text.trim() || undefined;
    if (text !== row.action) {
      // Named as undefined, which in a patch deletes the field.
      patch.action = text;
      if (text === undefined) {
        patch.actionCreatedBy = undefined;
        patch.actionUpdatedBy = undefined;
        patch.actionUpdatedAt = undefined;
      } else {
        patch.actionUpdatedBy = user._id;
        patch.actionUpdatedAt = now;
        if (!row.actionCreatedBy) patch.actionCreatedBy = user._id;
      }
    }
    if (args.done !== undefined && args.done !== (row.doneAt !== undefined)) {
      patch.doneAt = args.done ? now : undefined;
      patch.doneBy = args.done ? user._id : undefined;
    }
    if (Object.keys(patch).length === 0) return null;
    if (found.kind === "call") await ctx.db.patch(found.row._id, patch);
    else await ctx.db.patch(found.row._id, patch);
    return null;
  },
});
