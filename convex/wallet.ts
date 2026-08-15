// The prepaid wallet (schema: orgs.walletBalanceMicroUsd). This file owns
// money IN: the Stripe Checkout the owner starts, the webhook credit that
// lands the payment, and the owner's read of their own balance. Money OUT is
// retell.meterCall's drawdown, stamped in the same mutation as the call it
// pays for — a debit is a fact about a call, so it lives with the meter.
// The operator's manual credit lives in platform.ts with the other
// cross-org writes.

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { DEFAULT_PRODUCT_NAME, platformValue } from "./lib/platformConfig";

// Below this the owner gets the "running low" mail — once per descent, since
// orgs.walletAlertLowAt re-arms on top-up rather than monthly.
export const WALLET_LOW_MICRO_USD = 5_000_000;

// What the top-up buttons offer, USD. A fixed menu rather than a free field:
// Stripe minimums, card-fee sanity and "which number do I type" all
// disappear when the choice is three buttons.
export const TOPUP_AMOUNTS_USD = [10, 20, 50] as const;

export const overview = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      balanceMicroUsd: v.number(),
      lowWaterMicroUsd: v.number(),
      rateMicroUsdPerMinute: v.number(),
      topupAmountsUsd: v.array(v.number()),
      topups: v.array(
        v.object({
          at: v.number(),
          amountMicroUsd: v.number(),
          source: v.union(v.literal("stripe"), v.literal("manual")),
        }),
      ),
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
    // Owner-only and prepaid-only, both resolved as null rather than thrown:
    // staff see no money, and an invoice-mode org has no wallet to show —
    // its meter lives on the voice page's Usage section (billing.ts).
    const { orgId, role } = await requireOrg(ctx);
    if (role !== "owner") return null;
    const org = await ctx.db.get(orgId);
    if (!org || org.billingMode !== "prepaid") return null;
    const rate =
      org.voiceRateMicroUsdPerMinute ??
      Math.max(
        0,
        Math.round(
          Number(await platformValue(ctx, "voiceRateMicroUsdPerMinute")) || 0,
        ),
      );
    const topups = await ctx.db
      .query("walletTopups")
      .withIndex("by_org_at", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(24);
    const months = await ctx.db
      .query("usageMonthly")
      .withIndex("by_org_month", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(24);
    return {
      balanceMicroUsd: org.walletBalanceMicroUsd ?? 0,
      lowWaterMicroUsd: WALLET_LOW_MICRO_USD,
      rateMicroUsdPerMinute: rate,
      topupAmountsUsd: [...TOPUP_AMOUNTS_USD],
      topups: topups.map((t) => ({
        at: t.at,
        amountMicroUsd: t.amountMicroUsd,
        source: t.source,
      })),
      months: months
        .filter((r) => (r.voiceCalls ?? 0) > 0)
        .map((r) => ({
          month: r.month,
          calls: r.voiceCalls ?? 0,
          seconds: r.voiceSeconds ?? 0,
          billedMicroUsd: r.voiceBilledMicroUsd ?? 0,
        })),
    };
  },
});

// The one credit path. Stripe rows are idempotent on the session id because
// Stripe retries webhooks until acknowledged, and a paid session must credit
// exactly once. The balance moves in the same mutation as the trail row —
// the usageMonthly rule again — and the alert stamps re-arm only past the
// thresholds the new balance actually clears: a top-up that leaves the
// wallet under the low mark must not earn a second "running low" mail.
// Shared by the Stripe webhook's mutation below and the operator's manual
// credit in platform.ts — one code path for "money arrived", however it
// arrived.
export async function applyWalletCredit(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    amountMicroUsd: number;
    source: "stripe" | "manual";
    stripeSessionId?: string;
    by?: Id<"users">;
  },
): Promise<void> {
  if (args.stripeSessionId) {
    const seen = await ctx.db
      .query("walletTopups")
      .withIndex("by_stripe_session", (q) =>
        q.eq("stripeSessionId", args.stripeSessionId),
      )
      .unique();
    if (seen) return;
  }
  const org = await ctx.db.get(args.orgId);
  if (!org) return;
  const amount = Math.round(args.amountMicroUsd);
  await ctx.db.insert("walletTopups", {
    orgId: args.orgId,
    amountMicroUsd: amount,
    source: args.source,
    stripeSessionId: args.stripeSessionId,
    at: Date.now(),
    by: args.by,
  });
  const after = (org.walletBalanceMicroUsd ?? 0) + amount;
  await ctx.db.patch(args.orgId, {
    walletBalanceMicroUsd: after,
    ...(after > 0 ? { walletAlertEmptyAt: undefined } : {}),
    ...(after > WALLET_LOW_MICRO_USD ? { walletAlertLowAt: undefined } : {}),
  });
}

export const creditTopup = internalMutation({
  args: {
    orgId: v.id("orgs"),
    amountMicroUsd: v.number(),
    source: v.union(v.literal("stripe"), v.literal("manual")),
    stripeSessionId: v.optional(v.string()),
    by: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyWalletCredit(ctx, args);
    return null;
  },
});

// The webhook's config read: httpActions have no db handle of their own.
export const stripeWebhookSecret = internalQuery({
  args: {},
  returns: v.union(v.null(), v.string()),
  handler: async (ctx) => platformValue(ctx, "stripeWebhookSecret"),
});

// Everything createTopupSession needs in one authenticated read. Owner-only
// by requireOwner's throw: the top-up button never renders for staff, so a
// thrown "owner-only" here is a defence, not a UX.
export const topupCheckoutContext = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      orgId: v.id("orgs"),
      secretKey: v.union(v.null(), v.string()),
      productName: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    if (!org || org.billingMode !== "prepaid") return null;
    return {
      orgId,
      secretKey: await platformValue(ctx, "stripeSecretKey"),
      productName:
        (await platformValue(ctx, "productName")) ?? DEFAULT_PRODUCT_NAME,
    };
  },
});

// Starts a Stripe Checkout session and returns its URL for the client to
// redirect into. Raw REST rather than the stripe SDK: one form-encoded POST
// does not earn a dependency. The credit itself lands only when the webhook
// confirms payment — this action moves no money.
export const createTopupSession = action({
  args: { amountUsd: v.number() },
  returns: v.string(),
  handler: async (ctx, args) => {
    if (!(TOPUP_AMOUNTS_USD as readonly number[]).includes(args.amountUsd)) {
      throw new Error("bad-amount");
    }
    const context = await ctx.runQuery(internal.wallet.topupCheckoutContext, {});
    if (!context) throw new Error("not-prepaid");
    if (!context.secretKey) throw new Error("stripe-not-configured");
    // The same env the invite mail builds its links from (email.ts).
    const site = process.env.SITE_URL;
    if (!site) throw new Error("site-url-missing");
    const params = new URLSearchParams({
      mode: "payment",
      success_url: `${site}/?tab=billing&topup=success`,
      cancel_url: `${site}/?tab=billing`,
      // How the webhook finds the org again; metadata would also work, but
      // client_reference_id is the field Stripe built for exactly this.
      client_reference_id: String(context.orgId),
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(args.amountUsd * 100),
      "line_items[0][price_data][product_data][name]": `${context.productName} balance top-up`,
      "line_items[0][quantity]": "1",
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const json = (await res.json()) as {
      url?: string;
      error?: { message?: string };
    };
    if (!res.ok || !json.url) {
      throw new Error(json.error?.message ?? "stripe-error");
    }
    return json.url;
  },
});
