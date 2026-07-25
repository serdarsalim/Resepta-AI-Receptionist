import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrg, requireUser } from "./lib/orgAuth";

// Cross-device theme preference (Nudge convention): Convex is the source of
// truth, localStorage (src/lib/theme.ts) is the instant no-FOUC cache.
export const setMyTheme = mutation({
  args: {
    theme: v.union(v.literal("light"), v.literal("dark"), v.literal("auto")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { themePreference: args.theme });
    return null;
  },
});

// Workspace switcher data: every org this login belongs to + the active one.
export const myWorkspaces = query({
  args: {},
  returns: v.object({
    activeOrgId: v.id("orgs"),
    workspaces: v.array(
      v.object({
        orgId: v.id("orgs"),
        name: v.string(),
        role: v.union(v.literal("owner"), v.literal("staff")),
      }),
    ),
  }),
  handler: async (ctx) => {
    const { user, orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const workspaces = [];
    for (const row of rows) {
      const org = await ctx.db.get(row.orgId);
      if (org) workspaces.push({ orgId: row.orgId, name: org.name, role: row.role });
    }
    return { activeOrgId: orgId, workspaces };
  },
});

export const setActiveOrg = mutation({
  args: { orgId: v.id("orgs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", user._id).eq("orgId", args.orgId),
      )
      .unique();
    if (!membership) throw new Error("not-a-member");
    await ctx.db.patch(user._id, { orgId: args.orgId });
    return null;
  },
});
