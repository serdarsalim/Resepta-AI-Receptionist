// Which model answers for this org, and with whose key (docs/chat-agent.md
// §3). ONE resolution, shared by the turn context (chatAgent.ts) and the
// admin panel (platform.orgAssistant), so the health fact and the runtime can
// never disagree about whether the agent is configured.
//
// Order, most specific wins:
//   1. The org's own connections rows ("llm"): provider, apiKey. Operator-set
//      per client; a key here is that client on their own billing.
//   2. The platform settings: chatAgentProvider picks the dialect,
//      anthropicApiKey / openaiApiKey supply the key, chatAgentModel
//      optionally overrides the provider's default model.
//
// A per-org provider with no per-org key still reads the PLATFORM key for
// that provider — "this client runs on OpenAI" and "this client pays their
// own bill" are separate decisions.

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { connectionField } from "./connections";
import { platformValue } from "./platformConfig";
import { DEFAULT_MODELS, type LlmProvider } from "./llm";

type Ctx = QueryCtx | MutationCtx;

export type ResolvedChatLlm = {
  provider: LlmProvider;
  model: string;
  // Null = not configured anywhere; the agent skips with llm-not-configured.
  apiKey: string | null;
};

function asProvider(raw: string | null): LlmProvider | null {
  const folded = raw?.trim().toLowerCase();
  return folded === "openai" || folded === "anthropic" ? folded : null;
}

export async function resolveChatLlm(
  ctx: Ctx,
  orgId: Id<"orgs">,
): Promise<ResolvedChatLlm> {
  const orgProvider = asProvider(await connectionField(ctx, orgId, "llm", "provider"));
  const platformProvider = asProvider(await platformValue(ctx, "chatAgentProvider"));
  const provider = orgProvider ?? platformProvider ?? "anthropic";
  const apiKey =
    (await connectionField(ctx, orgId, "llm", "apiKey")) ??
    (await platformValue(
      ctx,
      provider === "openai" ? "openaiApiKey" : "anthropicApiKey",
    ));
  // The model override was typed with the PLATFORM's provider in mind, so it
  // only applies while this org resolves to that same provider — an org
  // moved to OpenAI must not inherit a Claude model name, or every one of
  // its turns dies on a 404 the operator caused two screens away.
  const override =
    provider === (platformProvider ?? "anthropic")
      ? (await platformValue(ctx, "chatAgentModel"))?.trim()
      : undefined;
  return { provider, model: override || DEFAULT_MODELS[provider], apiKey };
}
