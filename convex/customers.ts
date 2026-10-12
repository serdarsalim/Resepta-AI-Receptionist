import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { assertE164, requireOrg, requireOwner } from "./lib/orgAuth";
import { recordCustomerCreated } from "./lib/newCustomer";
import { summariseThread, threadValidator } from "./lib/thread";
import { retryConfirmationsAwaitingEmail } from "./appointments";
import { isDeleting } from "./lib/customerDeletion";
import {
  beginCustomerDeletion,
  customerFootprint,
  footprintValidator,
} from "./customerDeletion";

// The row as stored. Built from a plain field map so the list validator can
// extend it by one key without a second copy of nineteen columns drifting from
// this one.
const customerFields = {
  _id: v.id("customers"),
  _creationTime: v.number(),
  orgId: v.id("orgs"),
  firstName: v.string(),
  lastName: v.optional(v.string()),
  phone: v.string(),
  email: v.optional(v.string()),
  language: v.optional(v.string()),
  notes: v.optional(v.string()),
  consentAt: v.optional(v.number()),
  lastInboundAt: v.optional(v.number()),
  custom: v.optional(v.record(v.string(), v.string())),
  // When someone last cleared this customer's dot in the inbox. Convex
  // validates RETURNS as strictly as arguments, so a column added to the
  // schema and not added here makes every read of the table throw.
  attentionClearedAt: v.optional(v.number()),
  arrivedAt: v.optional(v.number()),
  mutedAt: v.optional(v.number()),
  // Chat-agent takeover stamp (docs/chat-agent.md §5) — when a human took
  // this conversation over. Display only now; agentModeOverride decides.
  agentPausedAt: v.optional(v.number()),
  // This conversation's own answer to off/suggest/live, when it disagrees
  // with the business default, and the agent's "needs a person" flag.
  agentModeOverride: v.optional(
    v.union(v.literal("off"), v.literal("suggest"), v.literal("live")),
  ),
  agentFlaggedAt: v.optional(v.number()),
  // The assistants' daily change cap counter (schema customers.agentChangesAt).
  agentChangesAt: v.optional(v.array(v.number())),
  agentTurnScheduledFor: v.optional(v.id("messages")),
  // The three columns the warning above is about, found MISSING while adding
  // agentPausedAt: each is stamped by the message lanes (webhook.ts, wa.ts),
  // so a customer who wrote in or got an away-reply made every raw-doc read
  // here fail validation.
  lastInboundLane: v.optional(v.union(v.literal("cloud"), v.literal("evolution"))),
  lastAutoReplyAt: v.optional(v.number()),
  lastEmailAutoReplyAt: v.optional(v.number()),
  // And it HAPPENED AGAIN with read receipts (2026-08-26): the blue-tick
  // high-water mark reached the schema without reaching this mirror, so the
  // first customer whose thread was read with receipts live — one row in
  // prod — crashed `get` and `list` for everyone who opened him. The
  // validator throw took the whole tab down, which is how a one-field drift
  // presented as "the app crashes on this person's profile".
  lastReadReceiptWamid: v.optional(v.string()),
  // The conversation summary the write paths keep (lib/thread.ts). Read here
  // for the dot; the inbox reads it through its own indexes.
  thread: v.optional(threadValidator),
  // The deletion mark (schema customers.deletingAt). Every read here drops a
  // row that carries it, so these never reach a client; declared anyway,
  // because a column the schema has and this mirror lacks is the read that
  // throws (see above).
  deletingAt: v.optional(v.number()),
  deletingPhone: v.optional(v.string()),
};

// The row plus the dot, which both the list and the record page carry.
const customerRow = v.object({
  ...customerFields,
  // Resolved server-side rather than shipped as three raw timestamps for the
  // table to compare: the inbox already decides this exact question, and two
  // places deciding it independently is how one dot becomes two answers.
  needsAttention: v.boolean(),
});

// ONE dot, one meaning: nobody has looked at this person yet. It lights for an
// unread message — the same arithmetic the inbox runs, imported rather than
// reimplemented — and for somebody who arrived through the door on their own.
// The second half is not redundant: a voice booking creates a customer and no
// message at all, so an inbox-only dot leaves the arrivals most worth noticing
// invisible everywhere.
function resolveAttention(customer: Doc<"customers">): boolean {
  // Mute answers first, and answers for every caller: the table, the record
  // page, and anything else that ever asks. A muted customer cannot light the
  // dot, which is the whole of what mute means.
  if (customer.mutedAt) return false;
  // From the row's own summary, so the Contacts table costs the customers it
  // shows and nothing more. It used to scan the org's 700 newest messages
  // and calls per execution to answer this for each row.
  const messageAttentionAt = customer.thread
    ? summariseThread(customer.thread).attentionAt
    : 0;
  const wants = Math.max(messageAttentionAt, customer.arrivedAt ?? 0);
  return wants > 0 && wants > (customer.attentionClearedAt ?? 0);
}

export const get = query({
  args: { customerId: v.id("customers") },
  returns: v.union(customerRow, v.null()),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    // A customer being deleted is already gone as far as any screen is
    // concerned: the row is blank and a sweep is emptying it out.
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
    // The record page carries the dot too, so it has to answer the same
    // question the table does — and answer it the same way, through
    // resolveAttention, rather than by looking at two of the three timestamps
    // and guessing at the third.
    return { ...customer, needsAttention: resolveAttention(customer) };
  },
});

// Contact data is daily staff work — org-scoped, not owner-gated.
export const setCustomValue = mutation({
  args: { customerId: v.id("customers"), key: v.string(), value: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      throw new Error("not-found");
    }
    const custom = { ...(customer.custom ?? {}) };
    if (args.value.trim()) custom[args.key] = args.value.trim();
    else delete custom[args.key];
    await ctx.db.patch(args.customerId, { custom });
    return null;
  },
});

// The header's jump list (CustomerJump): enough of a match to pick a person,
// nothing more. Same fold as the table's own search (useTableState.foldSearch
// — İ/ı and ß included, "gul" finds "Gül"), so the box and the jump list
// never disagree about who matches. Collect-and-filter like everything else
// at salon scale; take 8 keeps it a picker rather than a result page.
export const quickSearch = query({
  args: { q: v.string() },
  returns: v.array(
    v.object({
      id: v.id("customers"),
      name: v.string(),
      phone: v.string(),
    }),
  ),
  handler: async (ctx, { q }) => {
    const { orgId } = await requireOrg(ctx);
    const fold = (value: string) =>
      value
        .replace(/[İIı]/g, "i")
        .replace(/ß/g, "ss")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
    const needle = fold(q.trim());
    // Below two characters most of the book matches and the list is noise.
    // The component applies the same floor; this one holds if it ever slips.
    if (needle.length < 2) return [];
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_org", (index) => index.eq("orgId", orgId))
      .collect();
    const out: Array<{ id: Doc<"customers">["_id"]; name: string; phone: string }> = [];
    for (const c of rows) {
      if (isDeleting(c)) continue;
      const hay = fold(`${c.firstName} ${c.lastName ?? ""} ${c.phone} ${c.email ?? ""}`);
      if (!hay.includes(needle)) continue;
      out.push({
        id: c._id,
        name: `${c.firstName} ${c.lastName ?? ""}`.trim(),
        phone: c.phone,
      });
      if (out.length >= 8) break;
    }
    return out;
  },
});

export const list = query({
  args: {},
  returns: v.array(customerRow),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(1000);
    // mutedAt ships raw and the table decides where muted rows land. Nudge
    // sinks them server-side, through a second query and a by_muted index,
    // because its Contacts table is paginated: a muted row can only sort late
    // within the page it happens to land in, so the tail has to be assembled
    // before the page is. This list is one unpaginated take that the table
    // re-sorts by whichever column is active, so a server-side order would be
    // thrown away on arrival. One place decides, and it is the sort.
    return rows
      .filter((row) => !isDeleting(row))
      .map((row) => ({
        ...row,
        needsAttention: resolveAttention(row),
      }));
  },
});

// Name and number, nothing else. The booking sheet's customer picker needs to
// answer "who is this" and no more, and list() pays for a scan of the org's
// recent messages to resolve the attention dot that a dropdown never draws.
// That is the right price for the Contacts table and the wrong one for opening
// a modal.
export const options = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("customers"),
      firstName: v.string(),
      lastName: v.optional(v.string()),
      phone: v.string(),
      // Whether they can be messaged at all. Booking somebody without consent
      // is allowed and sometimes right, but under KVKK it means they will get
      // no reminder and no confirmation, so the sheet says it at the moment
      // the choice is made rather than leaving it to be discovered later.
      consented: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(1000);
    return rows.filter((row) => !isDeleting(row)).map((row) => ({
      _id: row._id,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      consented: row.consentAt !== undefined,
    }));
  },
});

export const create = mutation({
  args: {
    firstName: v.string(),
    lastName: v.optional(v.string()),
    phone: v.string(),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    consent: v.boolean(),
  },
  returns: v.id("customers"),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const firstName = args.firstName.trim();
    if (!firstName) throw new Error("first-name-required");
    const phone = assertE164(args.phone);
    const dupe = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
      .unique();
    if (dupe) throw new Error("phone-exists");
    const customerId = await ctx.db.insert("customers", {
      orgId,
      firstName,
      lastName: args.lastName?.trim() || undefined,
      phone,
      email: args.email?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      consentAt: args.consent ? Date.now() : undefined,
    });
    await recordCustomerCreated(ctx, { orgId, customerId, source: "staff" });
    return customerId;
  },
});

export const update = mutation({
  args: {
    customerId: v.id("customers"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    consent: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      throw new Error("not-found");
    }
    const patch: Record<string, unknown> = {};
    if (args.firstName !== undefined && args.firstName.trim()) {
      patch.firstName = args.firstName.trim();
    }
    if (args.lastName !== undefined) patch.lastName = args.lastName.trim() || undefined;
    if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined;
    if (args.email !== undefined) patch.email = args.email.trim() || undefined;
    if (args.phone !== undefined) {
      const phone = assertE164(args.phone);
      if (phone !== customer.phone) {
        const dupe = await ctx.db
          .query("customers")
          .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
          .unique();
        if (dupe) throw new Error("phone-exists");
        patch.phone = phone;
      }
    }
    if (args.consent !== undefined) {
      // Re-consenting refreshes the stamp; revoking clears it and blocks sends.
      patch.consentAt = args.consent ? (customer.consentAt ?? Date.now()) : undefined;
    }
    await ctx.db.patch(args.customerId, patch);
    // Staff typing in a missing email repays the same debt the voice path
    // does: a confirmation that failed no-email-address is re-fired for
    // future bookings the moment the address exists.
    if (typeof patch.email === "string" && !customer.email) {
      await retryConfirmationsAwaitingEmail(ctx, args.customerId);
    }
    return null;
  },
});

// Mute / unmute. Deliberately its own mutation rather than a flag on update():
// update() is the identity form saving a batch of edited fields, and mute is a
// switch somebody flips on its own and expects to take effect immediately.
// Folding it in would also mean every save of a phone number had to have an
// opinion about mute.
export const setMuted = mutation({
  args: { customerId: v.id("customers"), muted: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      throw new Error("not-found");
    }
    await ctx.db.patch(args.customerId, {
      mutedAt: args.muted ? Date.now() : undefined,
    });
    return null;
  },
});

// What deleting this customer would remove, per kind: the counts the customer
// page's delete sheet shows before anything goes, from the same FOOTPRINT list
// the sweep empties (customerDeletion.ts), so what the owner is shown is what
// goes. Owner-only like the delete itself; anyone else gets null, which the
// sheet never asks for because the menu that opens it is not drawn for them.
//
// Subscribed only while the sheet is open. Its read set is the customer's
// whole history (capped per kind), so a live subscription re-runs on every
// message they send, which is the point while the owner is deciding and a
// waste the rest of the time.
export const deletionPreview = query({
  args: { customerId: v.id("customers") },
  returns: v.union(
    v.object({ name: v.string(), footprint: footprintValidator }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const { orgId, role } = await requireOrg(ctx);
    if (role !== "owner") return null;
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
    return {
      name: `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
      footprint: await customerFootprint(ctx, customer),
    };
  },
});

// Deletes the customer and everything held on them (customerDeletion.ts):
// gone from every screen in this commit, every queued send cancelled, the
// rest swept in the background. Nothing is sent to them about it.
//
// Owners only, since 2026-10-13 (it was any member). Staff edit customers all
// day, but erasing one is a KVKK decision that takes the business's own
// history with it and cannot be undone, so it belongs to whoever answers for
// the business. Every other deletion door checks the same (AGENTS.md,
// "Deleting a customer deletes them"). The activity feed records who did it,
// and never whom.
export const remove = mutation({
  args: { customerId: v.id("customers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    // A second press while the first is being swept changes nothing.
    if (isDeleting(customer)) return null;
    await beginCustomerDeletion(ctx, customer);
    return null;
  },
});
