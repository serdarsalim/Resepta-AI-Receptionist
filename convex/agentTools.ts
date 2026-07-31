// The data layer behind the MCP surface. Every function here takes orgId and
// the acting person EXPLICITLY, because the MCP door has no session: the
// workspace and the user come off the key (see mcpKeys.verify, which re-checks
// membership), not from requireOrg.
//
// That is the one structural difference from the rest of the backend, and it is
// why these live apart from customers.ts / appointments.ts rather than being
// extra args on the mutations already there. Mixing "trust the cookie" and
// "trust the key" inside one function is how a scoping bug gets written.
//
// Two rules, same as the Nudge side:
//   1. before/after capture ONLY the keys a tool wrote. A whole-document
//      snapshot means an undo silently reverts a stylist's edit made in between.
//   2. Undo goes forward through the same write path, never a raw patch.

import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { recordActivity } from "./lib/activity";

const scope = {
  orgId: v.id("orgs"),
  userId: v.id("users"),
  connectionId: v.id("mcpConnections"),
} as const;

// Every read and write goes through this. Fetching by id and THEN comparing the
// org is the whole guard: without it a customer id from another salon would
// resolve happily, and the tool would answer questions about a business the
// caller has nothing to do with.
async function customerInOrg(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  customerId: string,
): Promise<Doc<"customers">> {
  const row = await ctx.db.get(customerId as Id<"customers">).catch(() => null);
  if (!row || row.orgId !== orgId) throw new Error("No customer with that id.");
  return row;
}

function fullName(c: Doc<"customers">): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.phone;
}

async function journal(
  ctx: MutationCtx,
  a: {
    orgId: Id<"orgs">;
    connectionId: Id<"mcpConnections">;
    userId: Id<"users">;
    tool: string;
    args: unknown;
    targetTable: string;
    targetId: string;
    before: unknown;
    after: unknown;
    reversible: boolean;
  },
): Promise<Id<"agentActions">> {
  return await ctx.db.insert("agentActions", {
    orgId: a.orgId,
    connectionId: a.connectionId,
    userId: a.userId,
    tool: a.tool,
    args: JSON.stringify(a.args),
    targetTable: a.targetTable,
    targetId: a.targetId,
    before: JSON.stringify(a.before),
    after: JSON.stringify(a.after),
    at: Date.now(),
    reversible: a.reversible,
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

export const searchCustomers = internalQuery({
  args: { orgId: v.id("orgs"), query: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { orgId, query, limit }) => {
    const take = Math.min(Math.max(limit ?? 20, 1), 50);
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const needle = query?.trim().toLowerCase();
    // Diacritics fold, because a salon's book is full of names a phone keyboard
    // will not reproduce exactly — searching "gul" has to find "Gül".
    const fold = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const matched = needle
      ? rows.filter((c) => {
          const hay = fold(`${c.firstName} ${c.lastName ?? ""} ${c.phone} ${c.email ?? ""}`);
          return hay.includes(fold(needle));
        })
      : rows;
    return {
      count: Math.min(matched.length, take),
      totalMatches: matched.length,
      customers: matched.slice(0, take).map((c) => ({
        id: c._id,
        name: fullName(c),
        phone: c.phone,
        email: c.email ?? null,
        muted: !!c.mutedAt,
      })),
    };
  },
});

export const getCustomer = internalQuery({
  args: { orgId: v.id("orgs"), customerId: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, customerId }) => {
    const c = await ctx.db.get(customerId as Id<"customers">).catch(() => null);
    if (!c || c.orgId !== orgId) throw new Error("No customer with that id.");
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_customer", (q) => q.eq("customerId", c._id))
      .order("desc")
      .take(10);
    const appts = await ctx.db
      .query("appointments")
      .withIndex("by_customer", (q) => q.eq("customerId", c._id))
      .order("desc")
      .take(10);
    return {
      id: c._id,
      name: fullName(c),
      firstName: c.firstName,
      lastName: c.lastName ?? null,
      phone: c.phone,
      email: c.email ?? null,
      language: c.language ?? null,
      muted: !!c.mutedAt,
      custom: c.custom ?? {},
      notes: notes.map((n) => ({
        id: n._id,
        body: n.body,
        at: new Date(n._creationTime).toISOString(),
        edited: !!n.editedAt,
      })),
      appointments: appts.map((a) => ({
        id: a._id,
        startAt: new Date(a.startAt).toISOString(),
        status: a.status,
        durationMinutes: a.durationMinutes ?? null,
        services: (a.items ?? []).map((i) => i.name),
      })),
    };
  },
});

export const schedule = internalQuery({
  args: { orgId: v.id("orgs"), days: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { orgId, days }) => {
    const span = Math.min(Math.max(days ?? 7, 1), 60);
    const now = Date.now();
    const until = now + span * 86_400_000;
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startAt", now).lte("startAt", until),
      )
      .collect();
    const customerIds = [...new Set(rows.map((r) => r.customerId))];
    const names = new Map(
      (await Promise.all(customerIds.map((id) => ctx.db.get(id)))).flatMap((c) =>
        c ? [[c._id, fullName(c)] as const] : [],
      ),
    );
    // Counted here rather than handed over as rows to tally. Same reason as the
    // Nudge reports: a model asked to count a list it can only partly see will
    // produce a number, and the number will be wrong.
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return {
      from: new Date(now).toISOString(),
      days: span,
      total: rows.length,
      byStatus,
      appointments: rows
        .sort((a, b) => a.startAt - b.startAt)
        .slice(0, 100)
        .map((a) => ({
          id: a._id,
          customer: names.get(a.customerId) ?? "(deleted)",
          customerId: a.customerId,
          startAt: new Date(a.startAt).toISOString(),
          status: a.status,
          services: (a.items ?? []).map((i) => i.name),
        })),
      ...(rows.length > 100
        ? { truncated: `Showing the first 100 of ${rows.length}; narrow the window.` }
        : {}),
    };
  },
});

// ── Writes ───────────────────────────────────────────────────────────────────

export const addNote = internalMutation({
  args: { ...scope, customerId: v.string(), body: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, customerId, body }) => {
    const text = body.trim();
    if (!text) throw new Error("The note is empty.");
    const customer = await customerInOrg(ctx, orgId, customerId);
    const noteId = await ctx.db.insert("notes", {
      orgId,
      customerId: customer._id,
      body: text,
      authorId: userId,
    });
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "add_note",
      args: { customerId, body: text },
      targetTable: "notes",
      targetId: noteId,
      // The note did not exist. That is a real prior state, not a missing one.
      before: null,
      after: { body: text },
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "note_added",
      customerId: customer._id,
      detail: text.length > 120 ? `${text.slice(0, 117)}…` : text,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { noteId, actionId, customerName: fullName(customer) };
  },
});

const EDITABLE = ["firstName", "lastName", "phone", "email", "language"] as const;
type Editable = (typeof EDITABLE)[number];

export const updateCustomer = internalMutation({
  args: { ...scope, customerId: v.string(), fields: v.record(v.string(), v.string()) },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, customerId, fields }) => {
    const customer = await customerInOrg(ctx, orgId, customerId);
    const before: Record<string, string | null> = {};
    const after: Record<string, string> = {};
    for (const [rawKey, rawVal] of Object.entries(fields)) {
      const key = rawKey.trim() as Editable;
      if (!EDITABLE.includes(key)) {
        throw new Error(
          `"${rawKey}" is not editable here. Editable: ${EDITABLE.join(", ")}.`,
        );
      }
      const value = rawVal.trim();
      const prior = (customer[key] ?? "") as string;
      if (prior === value) continue;
      // A customer with no phone cannot be messaged, and messaging is the whole
      // product. Refusing beats writing a row the reminder job will skip
      // forever without telling anyone.
      if (key === "phone" && !value) throw new Error("A customer must keep a phone number.");
      if (key === "firstName" && !value) throw new Error("A customer must keep a first name.");
      before[key] = prior || null;
      after[key] = value;
    }
    const changed = Object.keys(after);
    if (changed.length === 0) {
      throw new Error("Nothing to change — those are the values it already has.");
    }
    await ctx.db.patch(customer._id, after as Partial<Doc<"customers">>);
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "update_customer",
      args: { customerId, fields: after },
      targetTable: "customers",
      targetId: customer._id,
      before,
      after,
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "customer_updated",
      customerId: customer._id,
      detail: `Updated ${changed.join(", ")}`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { actionId, customerName: fullName(customer), changed };
  },
});

// ── Undo ─────────────────────────────────────────────────────────────────────

export const undo = internalMutation({
  args: { ...scope, actionId: v.string() },
  returns: v.object({ summary: v.string() }),
  handler: async (ctx, { orgId, userId, connectionId, actionId }) => {
    const action = await ctx.db.get(actionId as Id<"agentActions">).catch(() => null);
    if (!action || action.orgId !== orgId) throw new Error("No such action.");
    if (action.undoneAt) throw new Error("That action was already undone.");
    if (!action.reversible) {
      throw new Error(
        `${action.tool} cannot be undone — it already left the building. Nothing was changed.`,
      );
    }

    const before = JSON.parse(action.before) as Record<string, string | null> | null;
    const after = JSON.parse(action.after) as Record<string, string>;
    let summary: string;

    if (action.tool === "add_note") {
      const note = await ctx.db.get(action.targetId as Id<"notes">).catch(() => null);
      if (!note || note.orgId !== orgId) throw new Error("That note is already gone.");
      await ctx.db.delete(note._id);
      summary = "Removed the note.";
    } else if (action.tool === "update_customer") {
      const customer = await customerInOrg(ctx, orgId, action.targetId);
      // The drift check. If a stylist edited the same field after the agent
      // did, restoring would throw THEIR work away — so refuse and name what
      // moved. Undo takes back your own change; it does not win races.
      const drifted = Object.entries(after).filter(
        ([k, wrote]) => ((customer[k as Editable] ?? "") as string) !== wrote,
      );
      if (drifted.length > 0) {
        throw new Error(
          `Refusing to undo: ${drifted
            .map(([k, wrote]) => `"${k}" now reads "${customer[k as Editable] ?? ""}", not "${wrote}"`)
            .join("; ")}. Someone changed it after this action, and undoing would discard their edit.`,
        );
      }
      // null in the journal means the field was UNSET, not empty. Restoring it
      // as "" would leave a customer whose email is an empty string rather than
      // absent — which reads the same in the UI and differently everywhere that
      // checks `if (customer.email)`. Patching undefined removes the field, so
      // undo puts the row back exactly as it was.
      const restore: Record<string, string | undefined> = {};
      for (const [k, prior] of Object.entries(before ?? {})) {
        restore[k] = prior === null ? undefined : prior;
      }
      await ctx.db.patch(customer._id, restore as Partial<Doc<"customers">>);
      summary = `Restored ${Object.keys(restore).join(", ")} on ${fullName(customer)}.`;
    } else {
      throw new Error(`No undo is implemented for ${action.tool}.`);
    }

    const undoActionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "undo",
      args: { actionId },
      targetTable: action.targetTable,
      targetId: action.targetId,
      before: after,
      after: before,
      reversible: false,
    });
    // Marked, never deleted: "changed, then put back" is the honest history,
    // and erasing half of it lies to whoever reads the feed next.
    await ctx.db.patch(action._id, {
      undoneAt: Date.now(),
      undoneByActionId: undoActionId,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "agent_undo",
      detail: summary,
      agent: { actorId: userId, connectionId, agentActionId: undoActionId },
    });
    return { summary };
  },
});

export const listRecent = internalQuery({
  args: {
    orgId: v.id("orgs"),
    connectionId: v.optional(v.id("mcpConnections")),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, connectionId, limit }) => {
    const take = Math.min(Math.max(limit ?? 20, 1), 100);
    const rows = connectionId
      ? await ctx.db
          .query("agentActions")
          .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
          .order("desc")
          .take(take)
      : await ctx.db
          .query("agentActions")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .order("desc")
          .take(take);
    return rows.map((r) => ({
      actionId: r._id,
      tool: r.tool,
      at: new Date(r.at).toISOString(),
      args: JSON.parse(r.args),
      canUndo: r.reversible && !r.undoneAt,
      undone: !!r.undoneAt,
    }));
  },
});
