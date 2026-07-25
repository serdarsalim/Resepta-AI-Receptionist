import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// One-shot (2026-07-25): backfill memberships for users created before the
// workspace model. Run: npx convex run migrations:backfillMemberships
export const backfillMemberships = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let created = 0;
    for (const user of users) {
      if (!user.orgId) continue;
      const existing = await ctx.db
        .query("memberships")
        .withIndex("by_user_org", (q) =>
          q.eq("userId", user._id).eq("orgId", user.orgId!),
        )
        .unique();
      if (existing) continue;
      await ctx.db.insert("memberships", {
        userId: user._id,
        orgId: user.orgId,
        role: user.role ?? "owner",
      });
      created++;
    }
    return created;
  },
});
