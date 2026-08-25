// One-shot backfill for the per-channel send counters on usageMonthly, which
// the fleet table reads. Run it once after the meter ships, from the CLI:
//
//   npx convex run sendBackfill:run '{}'
//
// It REBUILDS rather than increments, so it is safe to run twice and safe to
// run after the live meter has already counted a few days: `messages` is the
// source of truth for "did this go out", and every row the live meter counted
// is in there too. A message sent during the run may land on either side of
// the page boundary; a re-run fixes it, and being one off on a usage column is
// not a state worth engineering against.
//
// The counts are accumulated in the SCHEDULE ARGUMENT and written once, at the
// end. The obvious alternative — zero every row, then add as you page — leaves
// the fleet table reading zero for whoever looks during the minute it runs,
// which on an operator's dashboard is indistinguishable from a dead tenant.
// Carrying the totals costs one small object per (org, month), and a
// deployment with a dozen businesses and a year of history has ~150 of them.

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { channelForKind, monthKey } from "./lib/usage";

const PAGE = 500;
// A runaway guard, not a limit anyone should hit: 100k messages at this page
// size. If a deployment ever passes it the run stops and says so rather than
// scheduling itself forever.
const MAX_PAGES = 200;

const tallyValidator = v.array(
  v.object({
    orgId: v.id("orgs"),
    month: v.string(),
    email: v.number(),
    wa: v.number(),
  }),
);

type Tally = { orgId: Id<"orgs">; month: string; email: number; wa: number };

// Statuses that mean a provider took it. `sent` alone undercounts badly — the
// delivery webhooks move a row on to delivered and then read, and none of them
// come back.
const DELIVERED = new Set(["sent", "delivered", "read"]);

export const run = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    page: v.optional(v.number()),
    tallies: v.optional(tallyValidator),
  },
  returns: v.object({ done: v.boolean(), page: v.number(), counted: v.number() }),
  handler: async (ctx, args) => {
    const page = args.page ?? 0;
    const carried: Tally[] = args.tallies ? [...args.tallies] : [];
    const byKey = new Map(carried.map((row) => [`${row.orgId}:${row.month}`, row]));

    const batch = await ctx.db
      .query("messages")
      .paginate({ cursor: args.cursor ?? null, numItems: PAGE });

    // Cached per org for this page: monthKey needs the org's zone, and reading
    // the org row once per message would dominate the whole backfill.
    const zones = new Map<string, string>();
    for (const message of batch.page) {
      if (message.direction !== "out") continue;
      if (!DELIVERED.has(message.status)) continue;
      // The salon typing on its own phone, echoed back by Evolution. Nothing
      // was sent from this product, and the question these columns answer is
      // who uses the product.
      if (message.kind === "staff_reply") continue;

      const orgKey = message.orgId as string;
      let zone = zones.get(orgKey);
      if (zone === undefined) {
        const org = await ctx.db.get(message.orgId);
        if (!org) continue;
        zone = org.timezone;
        zones.set(orgKey, zone);
      }
      // sentAt when we have it, creation time otherwise: a row that predates
      // the sentAt stamp still happened, and its creation time is within
      // minutes of when it went out.
      const at = message.sentAt ?? message._creationTime;
      const month = monthKey(at, zone);
      const key = `${orgKey}:${month}`;
      let tally = byKey.get(key);
      if (!tally) {
        tally = { orgId: message.orgId, month, email: 0, wa: 0 };
        byKey.set(key, tally);
      }
      if (channelForKind(message.kind) === "email") tally.email += 1;
      else tally.wa += 1;
    }

    const tallies = [...byKey.values()];
    const counted = tallies.reduce((sum, row) => sum + row.email + row.wa, 0);
    const exhausted = batch.isDone || page + 1 >= MAX_PAGES;

    if (!exhausted) {
      await ctx.scheduler.runAfter(0, internal.sendBackfill.run, {
        cursor: batch.continueCursor,
        page: page + 1,
        tallies,
      });
      return { done: false, page, counted };
    }

    // Landing. One patch per (org, month), setting rather than adding — see
    // the header for why this is the idempotent half.
    for (const tally of tallies) {
      const usage = await ctx.db
        .query("usageMonthly")
        .withIndex("by_org_month", (q) =>
          q.eq("orgId", tally.orgId).eq("month", tally.month),
        )
        .unique();
      if (usage) {
        await ctx.db.patch(usage._id, {
          emailSent: tally.email,
          waSent: tally.wa,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("usageMonthly", {
          orgId: tally.orgId,
          month: tally.month,
          llmTurns: 0,
          llmInputTokens: 0,
          llmOutputTokens: 0,
          llmCostMicroUsd: 0,
          emailSent: tally.email,
          waSent: tally.wa,
          updatedAt: Date.now(),
        });
      }
    }
    if (page + 1 >= MAX_PAGES && !batch.isDone) {
      console.warn(
        `sendBackfill stopped at the ${MAX_PAGES}-page guard with rows left. Counters are LOW; raise MAX_PAGES and re-run.`,
      );
    }
    return { done: true, page, counted };
  },
});
