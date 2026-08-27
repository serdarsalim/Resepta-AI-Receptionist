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
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { DEFAULT_PRODUCT_NAME, platformValue } from "./lib/platformConfig";
import { queueOrgAlert } from "./lib/alerts";

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
          source: v.union(v.literal("stripe"), v.literal("manual"), v.literal("trial")),
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

// The one DEBIT path, shared by every metered lane — voice (retell.meterCall),
// chat turns (chatAgent.recordTurn) and WhatsApp template sends
// (messages.applySendResult) all draw down through here, in the same mutation
// that stamps their line item, so the balance can never disagree with what it
// paid for. The low/empty mails fire on the way down, once per descent —
// their stamps clear on top-up (applyWalletCredit below), not on a new month.
// Empty also stamps low: "running low" arriving after "ran out" reads as the
// balance going backwards. Callers gate on billingMode === "prepaid"; an
// invoice org's meter counts without ever reaching this.
export async function applyWalletDebit(
  ctx: MutationCtx,
  org: Doc<"orgs">,
  amountMicroUsd: number,
): Promise<void> {
  const after = (org.walletBalanceMicroUsd ?? 0) - Math.round(amountMicroUsd);
  const crossedEmpty = after <= 0 && !org.walletAlertEmptyAt;
  const crossedLow = after <= WALLET_LOW_MICRO_USD && !org.walletAlertLowAt;
  await ctx.db.patch(org._id, {
    walletBalanceMicroUsd: after,
    ...(crossedLow || crossedEmpty ? { walletAlertLowAt: Date.now() } : {}),
    ...(crossedEmpty ? { walletAlertEmptyAt: Date.now() } : {}),
  });
  if (crossedEmpty || crossedLow) {
    await queueOrgAlert(ctx, {
      orgId: org._id,
      template: crossedEmpty ? "walletEmpty" : "walletLow",
      who: org.name || "—",
      detail: `$${(Math.max(after, 0) / 1_000_000).toFixed(2)}`,
    });
  }
}

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
    source: "stripe" | "manual" | "trial";
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
  // A credit is usually a top-up, so the interesting direction is upward and
  // this only ever CLEARED the stamps. But platform.addWalletCredit takes a
  // signed amount on purpose — its activity line reads "+" or "−" — so an
  // operator clawback comes through here too, and a correction landing on
  // exactly zero used to write no stamp and queue no mail. That silence was
  // permanent, not merely late: at a balance of zero beforeCallContext declines
  // every ring, so meterCall never runs again and the descent that WOULD have
  // fired the empty alert can never happen. The owner's phone agent just stops
  // answering.
  //
  // Mirrors the debit path in retell.meterCall, including empty stamping low as
  // well: "running low" arriving after "ran out" reads as the balance going
  // backwards.
  const crossedEmpty = after <= 0 && !org.walletAlertEmptyAt;
  const crossedLow = after <= WALLET_LOW_MICRO_USD && !org.walletAlertLowAt;
  await ctx.db.patch(args.orgId, {
    walletBalanceMicroUsd: after,
    ...(after > 0
      ? { walletAlertEmptyAt: undefined }
      : crossedEmpty
        ? { walletAlertEmptyAt: Date.now() }
        : {}),
    ...(after > WALLET_LOW_MICRO_USD
      ? { walletAlertLowAt: undefined }
      : crossedLow || crossedEmpty
        ? { walletAlertLowAt: Date.now() }
        : {}),
  });
  if (crossedEmpty || crossedLow) {
    await queueOrgAlert(ctx, {
      orgId: args.orgId,
      template: crossedEmpty ? "walletEmpty" : "walletLow",
      who: org.name || "—",
      detail: `$${(Math.max(after, 0) / 1_000_000).toFixed(2)}`,
    });
  }
}

export const creditTopup = internalMutation({
  args: {
    orgId: v.id("orgs"),
    amountMicroUsd: v.number(),
    source: v.union(v.literal("stripe"), v.literal("manual"), v.literal("trial")),
    stripeSessionId: v.optional(v.string()),
    by: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyWalletCredit(ctx, args);
    return null;
  },
});

// The Stripe webhook's door, and the only one that takes an UNVALIDATED org
// reference.
//
// client_reference_id arrives from Stripe and used to be cast straight into a
// v.id("orgs") argument with `as never` and no try/catch. The Stripe credentials
// are platform-wide — one account for the whole deployment — so any other
// session on that account carrying a reference verifies fine and lands here: a
// Payment Link, a second product, a second Convex deployment sharing the
// endpoint secret. A reference that is not a document id in THIS deployment
// failed argument validation, the httpAction threw, Convex answered 500, and
// Stripe retried with backoff for days before disabling the endpoint — with
// real top-ups queued behind it.
//
// Returns whether it was ours, so the route can answer 200 for "this event was
// not for us" while a genuine failure still throws and earns the retry. That
// distinction is the route's own stated contract.
export const creditStripeSession = internalMutation({
  args: {
    clientReferenceId: v.string(),
    amountMicroUsd: v.number(),
    stripeSessionId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const orgId = ctx.db.normalizeId("orgs", args.clientReferenceId.trim());
    if (!orgId) return false;
    await applyWalletCredit(ctx, {
      orgId,
      amountMicroUsd: args.amountMicroUsd,
      source: "stripe",
      stripeSessionId: args.stripeSessionId,
    });
    return true;
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
    // res.ok first, and the body read defensively — the order every other
    // provider wrapper in this codebase uses (postWaCloud, sendEvolutionText,
    // sendEmail, chatComplete), three of them with a comment about exactly this.
    // Parsing first meant a 502 or 503 carrying an HTML maintenance page threw
    // `SyntaxError: Unexpected token '<'` out of res.json() before !res.ok could
    // be consulted, so the deliberate stripe-error below was unreachable for
    // every non-JSON failure and an operator debugging a failed top-up got a
    // parse stack instead of Stripe's status.
    if (!res.ok) {
      const detail = await res
        .json()
        .then((body: unknown) => (body as { error?: { message?: string } })?.error?.message)
        .catch(() => undefined);
      throw new Error(detail ?? `stripe-http-${res.status}`);
    }
    const json = (await res.json().catch(() => null)) as {
      url?: string;
      error?: { message?: string };
    } | null;
    if (!json?.url) throw new Error(json?.error?.message ?? "stripe-error");
    return json.url;
  },
});
