// The operator's deployment-wide settings: read for actions, and the two
// functions the admin console uses to see and change them.
//
// Resolution and the env fallback live in lib/platformConfig; this file is the
// Convex surface around it.

import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
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
    chatAgentModel: v.union(v.string(), v.null()),
    retellApiKey: v.union(v.string(), v.null()),
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
    return {
      apiKey: config.apiKey ? maskSecret(config.apiKey) : null,
      domain: config.domain,
      webhookSecret: secret ? maskSecret(secret) : null,
      productName: config.productName,
      anthropicApiKey: anthropicKey ? maskSecret(anthropicKey) : null,
      openaiApiKey: openaiKey ? maskSecret(openaiKey) : null,
      chatAgentProvider: provider === "openai" ? ("openai" as const) : ("anthropic" as const),
      chatAgentModel: (await platformValue(ctx, "chatAgentModel"))?.trim() || null,
      retellApiKey: retellKey ? maskSecret(retellKey) : null,
      fromEnv: {
        apiKey: Boolean(config.apiKey) && !row("resendApiKey"),
        domain: Boolean(config.domain) && !row("resendInboundDomain"),
        webhookSecret: Boolean(secret) && !row("resendWebhookSecret"),
        anthropicApiKey: Boolean(anthropicKey) && !row("anthropicApiKey"),
        openaiApiKey: Boolean(openaiKey) && !row("openaiApiKey"),
        retellApiKey: Boolean(retellKey) && !row("retellApiKey"),
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
  v.literal("chatAgentModel"),
  v.literal("retellApiKey"),
  v.literal("chatAgentDisabled"),
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

export { DEFAULT_PRODUCT_NAME };
