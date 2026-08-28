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
      // Lets the Usage section drop the soft-budget row for prepaid orgs:
      // its hint promises "calls are never cut off", which is the invoice
      // lane's truth — a prepaid org's calls DO stop at zero balance, and
      // its alerts come from the wallet (BillingView), not from a budget.
      mode: v.union(v.literal("invoice"), v.literal("prepaid")),
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
      mode: org.billingMode ?? "invoice",
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

// The chat/WhatsApp half of the same meter: what the AI agent's replies and
// the org's template messages are costing them, at THEIR prices. Counts are
// the billed units (usageMonthly.llmBilledTurns / waBilledCount), not the raw
// traffic counters — a table whose count × rate disagrees with its amount is
// a support ticket. Nothing here exposes llmCostMicroUsd or waCostMicroUsd:
// the platform's own costs are margin data, the voiceCostMicroUsd rule.
export const messagingOverview = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      // The per-reply rate this org meters at right now — shown so the bill
      // is explainable, like the voice rate above.
      chatRateMicroUsdPerTurn: v.number(),
      months: v.array(
        v.object({
          month: v.string(),
          chatReplies: v.number(),
          chatBilledMicroUsd: v.number(),
          waMessages: v.number(),
          waBilledMicroUsd: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const { orgId, role } = await requireOrg(ctx);
    if (role !== "owner") return null;
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    const rate =
      org.chatRateMicroUsdPerTurn ??
      Math.max(
        0,
        Math.round(
          Number(await platformValue(ctx, "chatRateMicroUsdPerTurn")) || 0,
        ),
      );
    const rows = await ctx.db
      .query("usageMonthly")
      .withIndex("by_org_month", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(24);
    return {
      chatRateMicroUsdPerTurn: rate,
      months: rows
        .filter(
          (r) =>
            (r.llmBilledTurns ?? 0) > 0 ||
            (r.waBilledCount ?? 0) > 0 ||
            (r.llmBilledMicroUsd ?? 0) > 0 ||
            (r.waBilledMicroUsd ?? 0) > 0,
        )
        .map((r) => ({
          month: r.month,
          chatReplies: r.llmBilledTurns ?? 0,
          chatBilledMicroUsd: r.llmBilledMicroUsd ?? 0,
          waMessages: r.waBilledCount ?? 0,
          waBilledMicroUsd: r.waBilledMicroUsd ?? 0,
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
