// One-shot meter backfill for calls that predate the meter (or landed while
// an org had no Retell key). CLI-run per org during onboarding:
//
//   npx convex run voiceBackfill:run '{"orgId": "..."}'
//
// Pages the org's whole Retell workspace through list-calls and stamps every
// call row this org owns that the meter missed. Stamps follow meterCall's
// exact idempotency (each side keys on its own field being unset), so running
// this twice — or running it after the webhook already metered a call — does
// nothing the second time.
//
// Billed defaults to ZERO, not to the org's current rate: a call made before
// a price existed was made at no price, and pretending otherwise invoices
// history at today's rate. Pass rateMicroUsdPerMinute only when the org
// agreed a price that predates the meter. Run this BEFORE setting the org's
// rate in /admin, the same onboarding order the nudge meter settled on.
//
// The workspace may be shared across orgs (orgs.voiceAgentSource "randevu",
// or the de_autotakt test account): listed calls that belong to no row of
// THIS org are skipped, so a shared workspace only ever backfills its own.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { connectionField } from "./lib/connections";
import { monthKey } from "./lib/usage";

const PAGE = 1000;
const MAX_PAGES = 50;
// Mutations get the page in slices: a thousand row lookups plus patches in
// one transaction flirts with the read limit for nothing.
const BATCH = 200;

export const backfillContext = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.object({ apiKey: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    return { apiKey: await connectionField(ctx, args.orgId, "retell", "apiKey") };
  },
});

export const applyBatch = internalMutation({
  args: {
    orgId: v.id("orgs"),
    rateMicroUsdPerMinute: v.number(),
    calls: v.array(
      v.object({
        callId: v.string(),
        durationMs: v.optional(v.number()),
        costMicroUsd: v.optional(v.number()),
      }),
    ),
  },
  returns: v.object({ matched: v.number(), stamped: v.number() }),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return { matched: 0, stamped: 0 };
    let matched = 0;
    let stamped = 0;
    // Month bumps collect here and land once per month at the end, so a
    // 200-call batch touches each usageMonthly row once, not 200 times.
    const bumps = new Map<
      string,
      { calls: number; seconds: number; billed: number; cost: number }
    >();
    for (const call of args.calls) {
      const row = await ctx.db
        .query("calls")
        .withIndex("by_retell_call", (q) => q.eq("retellCallId", call.callId))
        .unique();
      if (!row || row.orgId !== args.orgId) continue;
      matched += 1;
      const durationSec =
        row.durationSec ??
        (call.durationMs !== undefined ? Math.round(call.durationMs / 1000) : undefined);
      const stampBilled =
        durationSec !== undefined && row.billedMicroUsd === undefined;
      const stampCost =
        call.costMicroUsd !== undefined && row.retellCostMicroUsd === undefined;
      if (!stampBilled && !stampCost) continue;
      stamped += 1;
      const billedMicroUsd = stampBilled
        ? Math.round(((durationSec ?? 0) * args.rateMicroUsdPerMinute) / 60)
        : undefined;
      await ctx.db.patch(row._id, {
        // The webhook path never saw these calls, so the duration may be
        // missing from the row too — fill it from Retell while we are here.
        ...(row.durationSec === undefined && durationSec !== undefined
          ? { durationSec }
          : {}),
        ...(billedMicroUsd !== undefined ? { billedMicroUsd } : {}),
        ...(stampCost ? { retellCostMicroUsd: call.costMicroUsd } : {}),
      });
      const month = monthKey(row.startedAt, org.timezone);
      const bump = bumps.get(month) ?? { calls: 0, seconds: 0, billed: 0, cost: 0 };
      if (stampBilled) {
        bump.calls += 1;
        bump.seconds += durationSec ?? 0;
        bump.billed += billedMicroUsd ?? 0;
      }
      if (stampCost) bump.cost += call.costMicroUsd ?? 0;
      bumps.set(month, bump);
    }
    for (const [month, bump] of bumps) {
      const usage = await ctx.db
        .query("usageMonthly")
        .withIndex("by_org_month", (q) =>
          q.eq("orgId", args.orgId).eq("month", month),
        )
        .unique();
      if (usage) {
        await ctx.db.patch(usage._id, {
          voiceCalls: (usage.voiceCalls ?? 0) + bump.calls,
          voiceSeconds: (usage.voiceSeconds ?? 0) + bump.seconds,
          voiceBilledMicroUsd: (usage.voiceBilledMicroUsd ?? 0) + bump.billed,
          voiceCostMicroUsd: (usage.voiceCostMicroUsd ?? 0) + bump.cost,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("usageMonthly", {
          orgId: args.orgId,
          month,
          llmTurns: 0,
          llmInputTokens: 0,
          llmOutputTokens: 0,
          llmCostMicroUsd: 0,
          voiceCalls: bump.calls,
          voiceSeconds: bump.seconds,
          voiceBilledMicroUsd: bump.billed,
          voiceCostMicroUsd: bump.cost,
          updatedAt: Date.now(),
        });
      }
    }
    return { matched, stamped };
  },
});

export const run = internalAction({
  args: {
    orgId: v.id("orgs"),
    rateMicroUsdPerMinute: v.optional(v.number()),
  },
  returns: v.object({
    listed: v.number(),
    matched: v.number(),
    stamped: v.number(),
  }),
  handler: async (ctx, args) => {
    const { apiKey } = await ctx.runQuery(internal.voiceBackfill.backfillContext, {
      orgId: args.orgId,
    });
    if (!apiKey) throw new Error("no-retell-key-for-org");
    const rate = Math.max(0, Math.round(args.rateMicroUsdPerMinute ?? 0));
    let listed = 0;
    let matched = 0;
    let stamped = 0;
    let paginationKey: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch("https://api.retellai.com/v3/list-calls", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          limit: PAGE,
          sort_order: "descending",
          ...(paginationKey ? { pagination_key: paginationKey } : {}),
        }),
      });
      if (!res.ok) throw new Error(`list-calls-http-${res.status}`);
      const body = (await res.json()) as {
        has_more?: boolean;
        items?: Array<Record<string, unknown>>;
        pagination_key?: string;
      };
      const items = body.items ?? [];
      listed += items.length;
      const slim = items
        .filter((c) => typeof c.call_id === "string")
        .map((c) => {
          const cost = (c.call_cost ?? {}) as Record<string, unknown>;
          const combinedCents = Number(cost.combined_cost);
          return {
            callId: String(c.call_id),
            durationMs:
              typeof c.duration_ms === "number" ? c.duration_ms : undefined,
            costMicroUsd: Number.isFinite(combinedCents)
              ? Math.round(combinedCents * 10_000)
              : undefined,
          };
        });
      for (let i = 0; i < slim.length; i += BATCH) {
        const result = await ctx.runMutation(internal.voiceBackfill.applyBatch, {
          orgId: args.orgId,
          rateMicroUsdPerMinute: rate,
          calls: slim.slice(i, i + BATCH),
        });
        matched += result.matched;
        stamped += result.stamped;
      }
      if (!body.has_more || !body.pagination_key) break;
      paginationKey = body.pagination_key;
    }
    return { listed, matched, stamped };
  },
});
