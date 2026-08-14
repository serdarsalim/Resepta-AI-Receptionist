// The owner's side of the voice meter: what the phone agent is costing them,
// month by month, and the one number they control — the soft budget. The
// operator's twin (rate setting, Retell margin) lives in platform.ts; nothing
// here returns voiceCostMicroUsd, which is margin data and never the org's
// business (schema.ts, calls.retellCostMicroUsd).

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { platformValue } from "./lib/platformConfig";

export const voiceOverview = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      // The rate this org actually meters at right now (override or platform
      // default) — shown so the bill is explainable, not negotiable in-app.
      rateMicroUsdPerMinute: v.number(),
      budgetMicroUsd: v.union(v.number(), v.null()),
      months: v.array(
        v.object({
          month: v.string(),
          calls: v.number(),
          seconds: v.number(),
          billedMicroUsd: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    // Owner-only, resolved as null rather than thrown: staff see no Usage
    // section, and a thrown query would take the whole voice tab down with it.
    const { orgId, role } = await requireOrg(ctx);
    if (role !== "owner") return null;
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    const rate =
      org.voiceRateMicroUsdPerMinute ??
      Math.max(
        0,
        Math.round(
          Number(await platformValue(ctx, "voiceRateMicroUsdPerMinute")) || 0,
        ),
      );
    const rows = await ctx.db
      .query("usageMonthly")
      .withIndex("by_org_month", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(24);
    return {
      rateMicroUsdPerMinute: rate,
      budgetMicroUsd: org.voiceMonthlyBudgetMicroUsd ?? null,
      months: rows
        .filter((r) => (r.voiceCalls ?? 0) > 0 || (r.voiceSeconds ?? 0) > 0)
        .map((r) => ({
          month: r.month,
          calls: r.voiceCalls ?? 0,
          seconds: r.voiceSeconds ?? 0,
          billedMicroUsd: r.voiceBilledMicroUsd ?? 0,
        })),
    };
  },
});

export const setVoiceBudget = mutation({
  args: {
    // null clears the budget, which also silences the 80/100% alert emails —
    // the budget being set is the opt-in (lib/alerts.ts alertEnabled).
    budgetMicroUsd: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    await ctx.db.patch(orgId, {
      voiceMonthlyBudgetMicroUsd:
        args.budgetMicroUsd === null
          ? undefined
          : Math.max(0, Math.round(args.budgetMicroUsd)),
    });
    return null;
  },
});
