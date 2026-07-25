import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireUser } from "./lib/orgAuth";

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
