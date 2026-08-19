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
  // rather than insisting it is Resepta.
  productName: null,
  // The platform's own LLM key (docs/chat-agent.md §3) — the Resend case
  // exactly: one deployment-wide key shared BY INTENT, because the platform
  // owns the LLM relationship and meters tokens per org. A per-org override
  // lives in `connections` ("llm"/"apiKey") and wins when present.
  anthropicApiKey: "ANTHROPIC_API_KEY",
  openaiApiKey: "OPENAI_API_KEY",
  // Which dialect the chat agent speaks by default ("anthropic" | "openai").
  // Table-only: an admin decision, not a deploy artifact. Resolution order
  // and the per-org override live in lib/chatLlm.ts.
  chatAgentProvider: null,
  // Per-provider model for every org, picked in /admin from what the
  // platform's own key can reach (platformConfig.listModels). Two rows, not
  // one, so the idle provider keeps its choice — the whole point of storing
  // both keys is that switching provider is one click, and a single model row
  // typed for Claude would ride along to OpenAI as a 404 on every turn.
  // Blank = DEFAULT_MODELS in lib/llm.ts.
  anthropicModel: null,
  openaiModel: null,
  // Legacy single override from before the per-provider rows above; still
  // read as their fallback (for the platform provider only) so a deployment
  // configured the old way keeps its model, but never written by the UI.
  chatAgentModel: null,
  // The shared Retell workspace key auto-provisioning stamps into a new org's
  // connections row (docs/chat-agent.md §7). The env var is the same one the
  // webhook guard already reads, which is not a coincidence: one workspace
  // has one signing key. A STAMP source, never a runtime fallback — the
  // connections doctrine stands.
  retellApiKey: "RETELL_API_KEY",
  // Platform-wide chat agent kill switch (§5): "true" stops every org's
  // agent before the model runs. Table-only on purpose — flipping it is an
  // operator action from /admin, not a deploy.
  chatAgentDisabled: null,
  // The default price per called minute, micro-USD as a string ("300000" =
  // $0.30/min). Set once here instead of on every org: the meter resolves
  // org.voiceRateMicroUsdPerMinute ?? this ?? 0 at stamp time, so an org row
  // exists only for exceptions (a market that needs its own price). Table-only:
  // pricing is an operator decision, not a deploy artifact.
  voiceRateMicroUsdPerMinute: null,
  // The platform's Stripe account for prepaid wallet top-ups — the Resend
  // case again: one deployment-wide account BY INTENT, because the platform
  // sells the credit and Stripe pays the platform, whichever org the money
  // lands on. Secret key creates Checkout sessions (wallet.createTopupSession);
  // the webhook secret verifies checkout.session.completed (/stripe/webhook).
  stripeSecretKey: "STRIPE_SECRET_KEY",
  stripeWebhookSecret: "STRIPE_WEBHOOK_SECRET",
} as const;

export type PlatformKey = keyof typeof PLATFORM_KEYS;

export const DEFAULT_PRODUCT_NAME = "Resepta";

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

// One platform value, table row first then env fallback — the general read
// the newer keys (LLM, Retell default, kill switch) share. emailConfig above
// predates it and stays as the batched read the email lane wants.
export async function platformValue(
  ctx: Ctx,
  key: PlatformKey,
): Promise<string | null> {
  const row = await ctx.db
    .query("platformConfig")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const stored = clean(row?.value);
  if (stored) return stored;
  const envName = PLATFORM_KEYS[key];
  return envName ? clean(process.env[envName]) : null;
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
