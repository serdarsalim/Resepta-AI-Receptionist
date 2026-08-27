// The operator's deployment-wide settings: read for actions, and the two
// functions the admin console uses to see and change them.
//
// Resolution and the env fallback live in lib/platformConfig; this file is the
// Convex surface around it.

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requirePlatformAdmin } from "./lib/platformAuth";
import { maskSecret } from "./lib/connections";
import {
  DEFAULT_PRODUCT_NAME,
  emailConfig,
  inboundWebhookSecret,
  platformValue,
  type PlatformKey,
} from "./lib/platformConfig";
import { resolvePlatformHighPriority } from "./lib/voiceModels";
import { resolveWaRateTable } from "./lib/waPricing";

export const emailConfigValidator = v.object({
  apiKey: v.union(v.string(), v.null()),
  domain: v.union(v.string(), v.null()),
  productName: v.string(),
});

// Actions have no ctx.db, so every send path resolves the config through here.
// Internal because it hands back the provider key in the clear.
export const forSend = internalQuery({
  args: {},
  returns: emailConfigValidator,
  handler: async (ctx) => await emailConfig(ctx),
});

export const webhookSecret = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => await inboundWebhookSecret(ctx),
});

// What the console may show: set-or-not, a tail for the key, the domain in
// full. Never the key itself — same rule as lib/connections maskSecret, and
// for the same reason: one compromised operator session must not equal the
// provider account.
export const status = query({
  args: {},
  returns: v.object({
    apiKey: v.union(v.string(), v.null()),
    domain: v.union(v.string(), v.null()),
    webhookSecret: v.union(v.string(), v.null()),
    productName: v.string(),
    // The chat agent's platform key and the Retell default auto-provisioning
    // stamps (docs/chat-agent.md §3, §7). Masked like every secret here.
    anthropicApiKey: v.union(v.string(), v.null()),
    openaiApiKey: v.union(v.string(), v.null()),
    chatAgentProvider: v.union(v.literal("anthropic"), v.literal("openai")),
    anthropicModel: v.union(v.string(), v.null()),
    openaiModel: v.union(v.string(), v.null()),
    chatAgentDisabled: v.boolean(),
    // The stored fleet default for voice agents, plain — a model id is not a
    // secret, and the picker needs the exact value back to show it selected.
    voiceModel: v.union(v.string(), v.null()),
    // Tri-state, like the row: null is "unset", which the publish paths read
    // as the template's own constant. The console has to be able to show
    // that third state — a plain checkbox would claim the operator had
    // chosen the tier they merely inherited.
    voiceHighPriority: v.union(v.boolean(), v.null()),
    retellApiKey: v.union(v.string(), v.null()),
    // The Meta Cloud API platform token every waAccounts row without its own
    // token rides (lib/platformConfig resolveWaAccount).
    whatsappAccessToken: v.union(v.string(), v.null()),
    voiceRateMicroUsdPerMinute: v.union(v.number(), v.null()),
    // The rest of the price book: chat per-reply default, WhatsApp markup
    // percent, and the effective per-country Meta rate table (defaults with
    // the operator's waRateTable override already merged in — what a send
    // would actually be priced at, so the console never shows a stale card).
    chatRateMicroUsdPerTurn: v.union(v.number(), v.null()),
    waMarkupPercent: v.union(v.number(), v.null()),
    waRateTable: v.array(
      v.object({
        country: v.string(),
        marketing: v.number(),
        utility: v.number(),
        authentication: v.number(),
        overridden: v.boolean(),
      }),
    ),
    // What a new org is born as, and the welcome credit a prepaid birth
    // carries (lib/platformConfig defaultBillingMode / trialCreditUsd).
    defaultBillingMode: v.union(v.literal("invoice"), v.literal("prepaid")),
    trialCreditUsd: v.union(v.number(), v.null()),
    // The prepaid wallet's Stripe account (wallet.ts, /stripe/webhook).
    stripeSecretKey: v.union(v.string(), v.null()),
    stripeWebhookSecret: v.union(v.string(), v.null()),
    // Whether each value is coming from an env var rather than a row, so the
    // operator knows why editing the field appears to do nothing on a
    // deployment still configured the old way.
    fromEnv: v.object({
      apiKey: v.boolean(),
      domain: v.boolean(),
      webhookSecret: v.boolean(),
      anthropicApiKey: v.boolean(),
      openaiApiKey: v.boolean(),
      retellApiKey: v.boolean(),
      whatsappAccessToken: v.boolean(),
      stripeSecretKey: v.boolean(),
      stripeWebhookSecret: v.boolean(),
    }),
  }),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const rows = await ctx.db.query("platformConfig").collect();
    const row = (key: PlatformKey) => rows.find((r) => r.key === key)?.value.trim() || null;
    const config = await emailConfig(ctx);
    const secret = await inboundWebhookSecret(ctx);
    const anthropicKey = await platformValue(ctx, "anthropicApiKey");
    const openaiKey = await platformValue(ctx, "openaiApiKey");
    const provider = (await platformValue(ctx, "chatAgentProvider"))?.toLowerCase();
    const retellKey = await platformValue(ctx, "retellApiKey");
    const waToken = await platformValue(ctx, "whatsappAccessToken");
    const stripeKey = await platformValue(ctx, "stripeSecretKey");
    const stripeWebhook = await platformValue(ctx, "stripeWebhookSecret");
    // The effective rate card: defaults with the stored override merged in,
    // plus which rows the operator actually touched — the console shows the
    // prices sends are metered at, and marks which ones are edits.
    const waOverrideRaw = row("waRateTable");
    const waTable = resolveWaRateTable(waOverrideRaw);
    let waOverridden = new Set<string>();
    try {
      waOverridden = new Set(Object.keys(JSON.parse(waOverrideRaw ?? "{}")));
    } catch {
      // an unparseable override changes no prices, so it marks no rows
    }
    return {
      apiKey: config.apiKey ? maskSecret(config.apiKey) : null,
      domain: config.domain,
      webhookSecret: secret ? maskSecret(secret) : null,
      productName: config.productName,
      anthropicApiKey: anthropicKey ? maskSecret(anthropicKey) : null,
      openaiApiKey: openaiKey ? maskSecret(openaiKey) : null,
      chatAgentProvider: provider === "openai" ? ("openai" as const) : ("anthropic" as const),
      // The legacy single override (chatAgentModel) shows through the row for
      // the provider it was typed for, exactly mirroring how lib/chatLlm.ts
      // resolves it — what this page displays is what the runtime uses.
      anthropicModel:
        row("anthropicModel") ??
        (provider !== "openai" ? row("chatAgentModel") : null),
      openaiModel:
        row("openaiModel") ??
        (provider === "openai" ? row("chatAgentModel") : null),
      chatAgentDisabled: (await platformValue(ctx, "chatAgentDisabled")) === "true",
      voiceModel: row("voiceModel"),
      voiceHighPriority: resolvePlatformHighPriority(row("voiceHighPriority")),
      retellApiKey: retellKey ? maskSecret(retellKey) : null,
      whatsappAccessToken: waToken ? maskSecret(waToken) : null,
      voiceRateMicroUsdPerMinute:
        Number(await platformValue(ctx, "voiceRateMicroUsdPerMinute")) || null,
      chatRateMicroUsdPerTurn:
        Number(await platformValue(ctx, "chatRateMicroUsdPerTurn")) || null,
      waMarkupPercent:
        Number(await platformValue(ctx, "waMarkupPercent")) || null,
      // "other" last: it is the fallback bucket, not a market.
      waRateTable: Object.entries(waTable)
        .sort(([a], [b]) =>
          a === "other" ? 1 : b === "other" ? -1 : a.localeCompare(b),
        )
        .map(([country, rates]) => ({
          country,
          ...rates,
          overridden: waOverridden.has(country),
        })),
      defaultBillingMode:
        (await platformValue(ctx, "defaultBillingMode")) === "prepaid"
          ? ("prepaid" as const)
          : ("invoice" as const),
      trialCreditUsd:
        Number(await platformValue(ctx, "trialCreditUsd")) || null,
      stripeSecretKey: stripeKey ? maskSecret(stripeKey) : null,
      stripeWebhookSecret: stripeWebhook ? maskSecret(stripeWebhook) : null,
      fromEnv: {
        apiKey: Boolean(config.apiKey) && !row("resendApiKey"),
        domain: Boolean(config.domain) && !row("resendInboundDomain"),
        webhookSecret: Boolean(secret) && !row("resendWebhookSecret"),
        anthropicApiKey: Boolean(anthropicKey) && !row("anthropicApiKey"),
        openaiApiKey: Boolean(openaiKey) && !row("openaiApiKey"),
        retellApiKey: Boolean(retellKey) && !row("retellApiKey"),
        whatsappAccessToken: Boolean(waToken) && !row("whatsappAccessToken"),
        stripeSecretKey: Boolean(stripeKey) && !row("stripeSecretKey"),
        stripeWebhookSecret:
          Boolean(stripeWebhook) && !row("stripeWebhookSecret"),
      },
    };
  },
});

const settableKey = v.union(
  v.literal("resendApiKey"),
  v.literal("resendInboundDomain"),
  v.literal("resendWebhookSecret"),
  v.literal("productName"),
  // Chat-agent platform keys (docs/chat-agent.md §3, §5) and the Retell
  // default auto-provisioning stamps (§7).
  v.literal("anthropicApiKey"),
  v.literal("openaiApiKey"),
  v.literal("chatAgentProvider"),
  v.literal("anthropicModel"),
  v.literal("openaiModel"),
  // Legacy single model override, superseded by the per-provider rows above.
  // Still settable so a CLI clear ('{"key":"chatAgentModel","value":""}') can
  // retire an old row.
  v.literal("chatAgentModel"),
  v.literal("retellApiKey"),
  v.literal("whatsappAccessToken"),
  v.literal("chatAgentDisabled"),
  // The fleet-wide default voice agent model (lib/voiceModels ids). Validated
  // on READ (resolvePlatformVoiceModel), not here: `set` stays a dumb
  // key-value write, and a row that outlives its catalogue entry simply
  // stops resolving instead of blocking the operator from clearing it.
  v.literal("voiceModel"),
  // The fleet-wide fast-tier default ("true" / "false"). Parsed on READ
  // (resolvePlatformHighPriority) for the same reason voiceModel is: `set`
  // stays a dumb key-value write, and anything else in the row reads as
  // unset rather than blocking the operator from correcting it.
  v.literal("voiceHighPriority"),
  v.literal("voiceRateMicroUsdPerMinute"),
  // The chat lane's default price per AI reply, the WhatsApp markup percent
  // and the Meta rate-card override (lib/waPricing) — the rest of the price
  // book, same read-side parsing rule as the voice rate.
  v.literal("chatRateMicroUsdPerTurn"),
  v.literal("waMarkupPercent"),
  v.literal("waRateTable"),
  // What a new org is born as, and the prepaid welcome credit.
  v.literal("defaultBillingMode"),
  v.literal("trialCreditUsd"),
  // The prepaid wallet's Stripe account (wallet.ts, /stripe/webhook).
  v.literal("stripeSecretKey"),
  v.literal("stripeWebhookSecret"),
);

// One key at a time, so a form that submits every field cannot blank the three
// the operator did not touch — the same absent-vs-empty problem platform.ts
// solves with `applied`, avoided here by not batching. An empty value DELETES
// the row, which falls the key back to its env var rather than pinning it to
// an empty string.
export const set = mutation({
  args: { key: settableKey, value: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const userId = await getAuthUserId(ctx);
    const value = args.value.trim();
    const existing = await ctx.db
      .query("platformConfig")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!value) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    // The domain is an address suffix, not a URL. Operators paste
    // "https://mail.example.com/" often enough that accepting it and then
    // building noreply@https://... is worse than fixing it here.
    const cleaned =
      args.key === "resendInboundDomain"
        ? value.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase()
        : value;
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: cleaned,
        updatedAt: Date.now(),
        updatedBy: userId ?? undefined,
      });
    } else {
      await ctx.db.insert("platformConfig", {
        key: args.key,
        value: cleaned,
        updatedAt: Date.now(),
        updatedBy: userId ?? undefined,
      });
    }
    return null;
  },
});

// The platform key for one provider, in the clear — for listModels below,
// which runs as an action and so has no ctx.db of its own. Internal AND
// admin-gated: auth rides ctx.runQuery, so the gate still runs.
export const llmKey = internalQuery({
  args: { provider: v.union(v.literal("anthropic"), v.literal("openai")) },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    return platformValue(
      ctx,
      args.provider === "openai" ? "openaiApiKey" : "anthropicApiKey",
    );
  },
});

// The models the PLATFORM key can actually reach, for the model pickers on
// /admin. Live rather than a checked-in list (the nudge listOpenAiModels
// argument): names churn, and a project-scoped OpenAI key only reaches what
// its project was granted — a static list would confidently offer models the
// key 403s on. Returns [] with a reason instead of throwing, so the picker
// degrades to plain free text rather than blocking the field.
export const listModels = action({
  args: { provider: v.union(v.literal("anthropic"), v.literal("openai")) },
  returns: v.object({
    models: v.array(v.string()),
    reason: v.union(v.string(), v.null()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ models: string[]; reason: string | null }> => {
    const apiKey = await ctx.runQuery(internal.platformConfig.llmKey, {
      provider: args.provider,
    });
    if (!apiKey) return { models: [], reason: "no-api-key" };
    try {
      if (args.provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        });
        if (!res.ok) return { models: [], reason: `anthropic-http-${res.status}` };
        const data = (await res.json()) as { data?: Array<{ id?: string }> };
        // Already newest-first and all chat-capable; nothing to filter.
        const ids = (data.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean);
        return { models: Array.from(new Set(ids)), reason: null };
      }
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return { models: [], reason: `openai-http-${res.status}` };
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (data.data ?? [])
        .map((m) => String(m.id ?? ""))
        .filter(Boolean)
        // Chat-completions families only. The account also lists embeddings,
        // TTS, moderation and image models, none of which the agent can speak.
        .filter((id) => /^(gpt|o\d|chatgpt)/i.test(id))
        .filter(
          (id) =>
            !/(audio|realtime|transcribe|tts|image|search|embed|moderation)/i.test(id),
        )
        // Newest first: OpenAI returns creation order, and the model the
        // operator wants is nearly always the most recent one.
        .sort((a, b) => b.localeCompare(a));
      return { models: Array.from(new Set(ids)), reason: null };
    } catch (e) {
      return { models: [], reason: e instanceof Error ? e.message : "fetch-failed" };
    }
  },
});

// The terminal's door to the same write. `set` requires a signed-in platform
// admin, which `npx convex run` is not — this is the nudge
// setBillingRateFromCli pattern: internal, so only a deploy key reaches it,
// and it funnels through the same one-key-at-a-time semantics as `set`
// (empty value deletes the row, falling the key back to its env var).
//
//   npx convex run platformConfig:setFromCli '{"key":"voiceRateMicroUsdPerMinute","value":"300000"}'
export const setFromCli = internalMutation({
  args: { key: settableKey, value: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const value = args.value.trim();
    const existing = await ctx.db
      .query("platformConfig")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!value) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    if (existing) {
      await ctx.db.patch(existing._id, { value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("platformConfig", { key: args.key, value, updatedAt: Date.now() });
    }
    return null;
  },
});

export { DEFAULT_PRODUCT_NAME };
