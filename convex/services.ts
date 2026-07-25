import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrg } from "./lib/orgAuth";

const serviceDoc = v.object({
  _id: v.id("services"),
  _creationTime: v.number(),
  orgId: v.id("orgs"),
  name: v.string(),
  durationMinutes: v.number(),
  active: v.boolean(),
});

export const list = query({
  args: {},
  returns: v.array(serviceDoc),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    return await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

export const create = mutation({
  args: { name: v.string(), durationMinutes: v.number() },
  returns: v.id("services"),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("name-required");
    return await ctx.db.insert("services", {
      orgId,
      name,
      durationMinutes: Math.max(5, Math.round(args.durationMinutes)),
      active: true,
    });
  },
});

export const update = mutation({
  args: {
    serviceId: v.id("services"),
    name: v.optional(v.string()),
    durationMinutes: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.orgId !== orgId) throw new Error("not-found");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined && args.name.trim()) patch.name = args.name.trim();
    if (args.durationMinutes !== undefined) {
      patch.durationMinutes = Math.max(5, Math.round(args.durationMinutes));
    }
    if (args.active !== undefined) patch.active = args.active;
    await ctx.db.patch(args.serviceId, patch);
    return null;
  },
});

// Hard delete. Past appointments keep their own record and simply stop
// resolving a service name, which is the honest outcome: the salon stopped
// offering it. Deactivating instead is the softer path (`update`).
export const remove = mutation({
  args: { serviceId: v.id("services") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.orgId !== orgId) throw new Error("not-found");
    await ctx.db.delete(args.serviceId);
    return null;
  },
});
