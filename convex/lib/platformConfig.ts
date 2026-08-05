// Deployment-wide operator settings, read from the platformConfig table with
// the matching environment variable as a fallback.
//
// ── WHY THE ENV FALLBACK IS RIGHT HERE AND WRONG IN lib/connections ─────────
//
// connections.ts refuses an env fallback because its credentials are
// PER-TENANT: a shared Retell key means one salon reading another's account.
// Everything in this file is deployment-wide on purpose — one Resend account
// and one verified domain serving every salon is exactly how a salon gets to
// send mail without owning a domain. So the env var is not a leaky default
// here; it is the same value by another name, and keeping it means a
// deployment configured before this table existed carries on working.
//
// The table wins when a row exists, so the operator console can change any of
// it without a terminal.

import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

// key → the env var it falls back to. A key absent from here is table-only.
export const PLATFORM_KEYS = {
  resendApiKey: "RESEND_API_KEY",
  resendInboundDomain: "RESEND_INBOUND_DOMAIN",
  resendWebhookSecret: "RESEND_WEBHOOK_SECRET",
  // What the product calls itself in mail it sends about the account (invites,
  // alerts). Configurable because the name is not settled, and because the
  // verified domain may belong to a sibling product before this one has its
  // own — a deployment mailing from mail.autotakt.com should be able to say so
  // rather than insisting it is Randevu.
  productName: null,
} as const;

export type PlatformKey = keyof typeof PLATFORM_KEYS;

export const DEFAULT_PRODUCT_NAME = "Mahlas";

// Everything the email lane needs, in one table read. Returned as a value
// object rather than resolved field by field because every caller needs at
// least two of them and the table is three rows.
export type EmailConfig = {
  apiKey: string | null;
  domain: string | null;
  productName: string;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function emailConfig(ctx: Ctx): Promise<EmailConfig> {
  const rows = await ctx.db.query("platformConfig").collect();
  const stored = (key: PlatformKey) =>
    clean(rows.find((row) => row.key === key)?.value);
  const env = (key: PlatformKey) => {
    const name = PLATFORM_KEYS[key];
    return name ? clean(process.env[name]) : null;
  };
  const resolve = (key: PlatformKey) => stored(key) ?? env(key);
  return {
    apiKey: resolve("resendApiKey"),
    domain: resolve("resendInboundDomain"),
    productName: resolve("productName") ?? DEFAULT_PRODUCT_NAME,
  };
}

// Inbound webhook signature checking, which runs in an httpAction and so needs
// its own narrow read rather than the whole email config.
export async function inboundWebhookSecret(ctx: Ctx): Promise<string | null> {
  const rows = await ctx.db.query("platformConfig").collect();
  return (
    clean(rows.find((row) => row.key === "resendWebhookSecret")?.value) ??
    clean(process.env.RESEND_WEBHOOK_SECRET)
  );
}
