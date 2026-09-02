import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { recomputeThread } from "./lib/thread";

// Rebuild customers.thread for every customer on the deployment. Idempotent:
// a row whose summary already matches is not written. Run once after the
// summary shipped, and again any time a write path is found to have skipped
// its noteMessage / recomputeThread call (lib/thread.ts, "THE RULE").
//
//   npx convex run threads:backfill --prod
//
// Ten customers per step: each recompute reads that customer's 40 newest
// messages and 20 newest calls, and messages carry email HTML, so the page
// is kept small enough that an email-heavy salon stays under the
// transaction's read budget.
export const backfill = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ processed: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("customers")
      .paginate({ cursor: args.cursor ?? null, numItems: 10 });
    for (const customer of page.page) {
      await recomputeThread(ctx, customer._id);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.threads.backfill, {
        cursor: page.continueCursor,
      });
    }
    return { processed: page.page.length, done: page.isDone };
  },
});
