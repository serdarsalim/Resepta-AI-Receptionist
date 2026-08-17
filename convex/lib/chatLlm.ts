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
//
// A per-org KEY with no per-org provider names its provider through its own
// prefix where the prefix is unambiguous (sk-ant-, sk-proj-), because the
// platform default can move underneath it and a key sent to the wrong host is
// a 401 on every turn for one org.

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
  const orgKey = (await connectionField(ctx, orgId, "llm", "apiKey"))?.trim();

  // An org key that names its own provider settles the question, and it has to,
  // because the platform default can move underneath it. The UI hint invites
  // leaving the provider empty ("Leave empty to follow the platform default"),
  // so an operator putting one client on their own billing typically sets the
  // key alone — and the key used to ride whatever the platform resolved. The day
  // the operator switched chatAgentProvider to openai, that org's sk-ant-… went
  // to api.openai.com as a bearer token: every turn 401ing, for one org, while
  // platform.orgChatAgent still showed green because llmKeyConfigured only asks
  // whether a key is present.
  //
  // Prefixes only, and only the unambiguous ones. Anthropic issues sk-ant-…;
  // OpenAI's current keys are sk-proj-…. A bare sk-… is historically either, so
  // it infers nothing and falls through — same instinct as dialCodeForTimezone
  // refusing to guess a country it was not given.
  const keyProvider: LlmProvider | null = orgKey?.startsWith("sk-ant-")
    ? "anthropic"
    : orgKey?.startsWith("sk-proj-")
      ? "openai"
      : null;
  const provider: LlmProvider =
    orgProvider ?? keyProvider ?? platformProvider ?? "anthropic";
  // The org's key is kept only when it belongs to the resolved provider. An org
  // that set a bare sk-… while the platform ran Anthropic, and now resolves to
  // OpenAI, falls back to the platform key rather than having its credential
  // sent to the wrong host: the operator moved the default, so the operator's
  // key is the honest default too.
  const keyBelongsHere =
    orgKey !== undefined &&
    (orgProvider ?? keyProvider ?? provider) === provider;
  const apiKey =
    (keyBelongsHere ? orgKey : null) ??
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
