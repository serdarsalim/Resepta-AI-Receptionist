// Saved views of the Customers list. A view is a name over the column filters
// and the sort the list already has; it holds no customer data, so the only
// rules are the org boundary and who may change it: whoever saved it, or an
// owner.

import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrg } from "./lib/orgAuth";

const sortValidator = v.object({
  key: v.string(),
  dir: v.union(v.literal("asc"), v.literal("desc")),
});
const filtersValidator = v.record(v.string(), v.array(v.string()));

// A business has a handful of views, not hundreds; the cap is a guard.
const MAX_VIEWS = 50;

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("customerViews"),
      name: v.string(),
      filters: filtersValidator,
      sort: v.optional(sortValidator),
      canEdit: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const { user, orgId, role } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("customerViews")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .take(MAX_VIEWS);
    return rows.map((row) => ({
      _id: row._id,
      name: row.name,
      filters: row.filters,
      sort: row.sort,
      canEdit: role === "owner" || row.createdBy === user._id,
    }));
  },
});

function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) throw new Error("name-required");
  return trimmed;
}

export const create = mutation({
  args: { name: v.string(), filters: filtersValidator, sort: v.optional(sortValidator) },
  returns: v.id("customerViews"),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOrg(ctx);
    const existing = await ctx.db
      .query("customerViews")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .take(MAX_VIEWS);
    if (existing.length >= MAX_VIEWS) throw new Error("too-many-views");
    return await ctx.db.insert("customerViews", {
      orgId,
      name: cleanName(args.name),
      createdBy: user._id,
      filters: args.filters,
      sort: args.sort,
    });
  },
});

async function editable(ctx: MutationCtx, viewId: Id<"customerViews">) {
  const { user, orgId, role } = await requireOrg(ctx);
  const view = await ctx.db.get(viewId);
  if (!view || view.orgId !== orgId) throw new Error("not-found");
  if (role !== "owner" && view.createdBy !== user._id) throw new Error("not-allowed");
  return view;
}

export const update = mutation({
  args: {
    viewId: v.id("customerViews"),
    name: v.optional(v.string()),
    filters: v.optional(filtersValidator),
    sort: v.optional(sortValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await editable(ctx, args.viewId);
    await ctx.db.patch(args.viewId, {
      ...(args.name !== undefined ? { name: cleanName(args.name) } : {}),
      ...(args.filters !== undefined ? { filters: args.filters } : {}),
      ...(args.sort !== undefined ? { sort: args.sort } : {}),
    });
    return null;
  },
});

export const remove = mutation({
  args: { viewId: v.id("customerViews") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await editable(ctx, args.viewId);
    await ctx.db.delete(args.viewId);
    return null;
  },
});
