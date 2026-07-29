import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { assertE164, requireOrg } from "./lib/orgAuth";
import { recordActivity } from "./lib/activity";
import { recordCustomerCreated } from "./lib/newCustomer";
import { conversationEntries, summariseEntries, type ConversationEntry } from "./messages";

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
};

// Only the LIST carries the dot. Resolving it costs a scan of the org's recent
// messages, which is the right price for the one screen that draws a dot per
// row and the wrong one for reading a single record that never shows it.
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
function resolveAttention(
  customer: Doc<"customers">,
  byCustomer: Map<string, ConversationEntry[]>,
): boolean {
  // Mute answers first, and answers for every caller: the table, the record
  // page, and anything else that ever asks. A muted customer cannot light the
  // dot, which is the whole of what mute means.
  if (customer.mutedAt) return false;
  const entries = byCustomer.get(customer._id);
  const messageAttentionAt = entries ? summariseEntries(entries).attentionAt : 0;
  const wants = Math.max(messageAttentionAt, customer.arrivedAt ?? 0);
  return wants > 0 && wants > (customer.attentionClearedAt ?? 0);
}

export const get = query({
  args: { customerId: v.id("customers") },
  returns: v.union(customerRow, v.null()),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) return null;
    // The record page carries the dot too, so it has to answer the same
    // question the table does — and answer it the same way, through
    // resolveAttention, rather than by looking at two of the three timestamps
    // and guessing at the third.
    const byCustomer = await conversationEntries(ctx, orgId);
    return { ...customer, needsAttention: resolveAttention(customer, byCustomer) };
  },
});

// Contact data is daily staff work — org-scoped, not owner-gated.
export const setCustomValue = mutation({
  args: { customerId: v.id("customers"), key: v.string(), value: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    const custom = { ...(customer.custom ?? {}) };
    if (args.value.trim()) custom[args.key] = args.value.trim();
    else delete custom[args.key];
    await ctx.db.patch(args.customerId, { custom });
    return null;
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
    const byCustomer = await conversationEntries(ctx, orgId);
    // mutedAt ships raw and the table decides where muted rows land. Nudge
    // sinks them server-side, through a second query and a by_muted index,
    // because its Contacts table is paginated: a muted row can only sort late
    // within the page it happens to land in, so the tail has to be assembled
    // before the page is. This list is one unpaginated take that the table
    // re-sorts by whichever column is active, so a server-side order would be
    // thrown away on arrival. One place decides, and it is the sort.
    return rows.map((row) => ({
      ...row,
      needsAttention: resolveAttention(row, byCustomer),
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
    return rows.map((row) => ({
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
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
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
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    await ctx.db.patch(args.customerId, {
      mutedAt: args.muted ? Date.now() : undefined,
    });
    return null;
  },
});

export const remove = mutation({
  args: { customerId: v.id("customers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect();
    for (const appointment of appointments) {
      await ctx.db.delete(appointment._id);
    }
    await ctx.db.delete(args.customerId);
    // The one deletion that takes appointments with it, so it is the one most
    // worth being able to attribute afterwards. The name is carried in the
    // detail because the row it pointed at is gone.
    await recordActivity(ctx, {
      orgId,
      kind: "customer_deleted",
      detail: `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
    });
    return null;
  },
});
