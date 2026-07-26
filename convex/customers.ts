import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertE164, requireOrg } from "./lib/orgAuth";
import { recordActivity } from "./lib/activity";

const customerDoc = v.object({
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
});

export const get = query({
  args: { customerId: v.id("customers") },
  returns: v.union(customerDoc, v.null()),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) return null;
    return customer;
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
  returns: v.array(customerDoc),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    return await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(1000);
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
    await recordActivity(ctx, { orgId, kind: "customer_created", customerId });
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
