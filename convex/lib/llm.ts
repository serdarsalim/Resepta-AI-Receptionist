// The LLM seam (docs/chat-agent.md §3): one place the product talks to a
// language model, provider-neutral at the call site. It speaks two dialects —
// the Anthropic Messages API and the OpenAI Chat Completions API — behind ONE
// result shape, and the tool-round replay helpers below are what keep the
// agent loop in chatAgent.ts from knowing which provider is on the wire.
// Actions only — a mutation cannot fetch.
//
// Key/provider/model resolution does NOT live here: lib/chatLlm.ts does that
// (it needs ctx), reading the org's connections override first and the
// platform settings second.

export type LlmProvider = "anthropic" | "openai";

// Per-provider defaults, overridable deployment-wide via the platformConfig
// rows anthropicModel / openaiModel — so a new model name is an admin edit,
// not a deploy.
export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5.2",
};

// What a turn may spend. maxTokens bounds ONE completion; the tool loop in
// chatAgent.ts bounds how many completions a turn may chain. Both are
// circuit breakers, not tuning knobs.
//
// 2048, not 1024: on the current models thinking is always on and its tokens
// draw from THIS budget, so a 1024 cap is a reply truncated mid-sentence
// whenever the model thought for a moment first — and a truncated reply is a
// reply we send.
export const MAX_COMPLETION_TOKENS = 2048;

// How hard the model thinks, Anthropic-side (output_config.effort, GA — the
// parameter is nested, and a top-level `effort` is ignored). The API default
// is "high", which is a reasoning budget for a receptionist answering "are you
// open Sunday" — real money, no better answer.
//
// Do NOT reach for thinking:{type:"disabled"} to get the same saving. It is
// accepted on Sonnet 5, but with thinking off a model sometimes writes a tool
// call into its VISIBLE TEXT instead of a tool_use block: the turn succeeds,
// the tool never runs, nothing errors, and the customer is told their
// appointment was booked when nothing was written. This agent has seven tools.
// Thinking on at low effort costs less than that failure and is cheaper than
// the default anyway.
//
// budget_tokens is not the dial either — it is REJECTED with a 400 on
// Sonnet 5, Opus 5 and Fable 5.
export const ANTHROPIC_EFFORT = "low";

// Per-org monthly LLM budget when the org has no override, in micro-USD.
// $20/month is far above any honest salon's chat volume and far below what a
// runaway loop could burn unbounded — a circuit breaker, not a quota a
// customer should ever meet.
export const DEFAULT_MONTHLY_BUDGET_MICRO_USD = 20_000_000;

// ── Price table ─────────────────────────────────────────────────────────────
// USD per million tokens. Versioned, and every turn snapshots the cost it was
// billed at (chatAgentTurns.costMicroUsd), so editing this table never
// rewrites history — it only changes turns that have not happened yet.
// Bump the version when a rate changes so a turn row names its rate card.
// An unknown model (an operator's model override this table has not met)
// records cost 0 — and zero never accumulates, so the monthly budget cap goes
// silently inert behind a confident $0.00. isPricedModel below exists so the
// admin panel can say so out loud instead.
//
// v3 (2026-08-28): claude-sonnet-5 was carrying 3/15 — Sonnet 4.6's rate,
// inherited when the model name changed and the numbers didn't. Every Sonnet
// turn since was metered at 1.5x its real cost. Turns snapshot their own rate,
// so this corrects turns from here on and rewrites nothing already recorded.
// The rest of the current lineup is listed now so a model swap in /admin
// cannot silently disarm the budget.
export const PRICE_TABLE_VERSION = 3;

const PRICES: Record<string, { inUsdPerMTok: number; outUsdPerMTok: number }> = {
  "claude-opus-5": { inUsdPerMTok: 5, outUsdPerMTok: 25 },
  "claude-fable-5": { inUsdPerMTok: 10, outUsdPerMTok: 50 },
  "claude-sonnet-5": { inUsdPerMTok: 2, outUsdPerMTok: 10 },
  "claude-sonnet-4-6": { inUsdPerMTok: 3, outUsdPerMTok: 15 },
  "claude-haiku-4-5": { inUsdPerMTok: 1, outUsdPerMTok: 5 },
  "claude-haiku-4-5-20251001": { inUsdPerMTok: 1, outUsdPerMTok: 5 },
  "gpt-5.2": { inUsdPerMTok: 1.75, outUsdPerMTok: 14 },
};

// Whether a model's spend is real or a placeholder zero. The budget cap is
// only a cap over models this table knows.
export function isPricedModel(model: string): boolean {
  return PRICES[model] !== undefined;
}

// Integer micro-USD, rounded up: a fraction of a micro-dollar owed is a
// micro-dollar owed, and rounding down across thousands of turns is a slow
// leak in the platform's favor to report and the org's favor to bill.
export function costMicroUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = PRICES[model];
  if (!price) return 0;
  return Math.ceil(
    inputTokens * price.inUsdPerMTok + outputTokens * price.outUsdPerMTok,
  );
}

// ── Wire types ──────────────────────────────────────────────────────────────

// A message in the PROVIDER'S OWN shape. The agent loop never constructs
// these by hand past the plain text turns; the helpers below build the tool
// rounds, which is where the two dialects actually differ.
export type ProviderMessage = Record<string, unknown>;

export function textMessage(role: "user" | "assistant", text: string): ProviderMessage {
  return { role, content: text };
}

// Neutral tool definition; converted per dialect inside chatComplete.
export type LlmTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
  };
};

export type LlmToolUse = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type LlmResult =
  | {
      ok: true;
      text: string;
      toolUses: LlmToolUse[];
      stopReason: string;
      inputTokens: number;
      outputTokens: number;
      // The provider-shaped assistant turn, replayed verbatim into the next
      // request when tools ran — both APIs require their own blocks back.
      assistantTurn: ProviderMessage | ProviderMessage[];
    }
  | { ok: false; error: string };

// Append one completed tool round to the conversation, in the dialect the
// provider expects back: Anthropic wants ONE user message of tool_result
// blocks; OpenAI wants one `tool` role message PER call. This asymmetry is
// the whole reason the loop works through helpers.
export function appendToolRound(
  provider: LlmProvider,
  messages: ProviderMessage[],
  result: Extract<LlmResult, { ok: true }>,
  toolResults: { id: string; content: string }[],
): void {
  if (Array.isArray(result.assistantTurn)) messages.push(...result.assistantTurn);
  else messages.push(result.assistantTurn);
  if (provider === "anthropic") {
    messages.push({
      role: "user",
      content: toolResults.map((r) => ({
        type: "tool_result",
        tool_use_id: r.id,
        content: r.content,
      })),
    });
    return;
  }
  for (const r of toolResults) {
    messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
  }
}

// ── The call itself ─────────────────────────────────────────────────────────

export async function chatComplete(args: {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  system: string;
  messages: ProviderMessage[];
  tools?: LlmTool[];
}): Promise<LlmResult> {
  return args.provider === "openai" ? openaiComplete(args) : anthropicComplete(args);
}

async function anthropicComplete(args: {
  apiKey: string;
  model: string;
  system: string;
  messages: ProviderMessage[];
  tools?: LlmTool[];
}): Promise<LlmResult> {
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": args.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: MAX_COMPLETION_TOKENS,
        // Thinking stays on (adaptive, the default when the parameter is
        // omitted) and is turned DOWN here rather than off — see
        // ANTHROPIC_EFFORT.
        output_config: { effort: ANTHROPIC_EFFORT },
        system: args.system,
        messages: args.messages,
        ...(args.tools?.length ? { tools: args.tools } : {}),
      }),
    });
  } catch (err) {
    return { ok: false, error: `llm-fetch-failed: ${err instanceof Error ? err.message : "unknown"}` };
  }
  if (!response.ok) {
    // The status code is the diagnosis: 401 is a key problem, 429 a rate
    // limit, 529 overload. The body's first line rides along for the flight
    // recorder; never for the customer.
    const body = (await response.text()).slice(0, 300);
    return { ok: false, error: `llm-http-${response.status}: ${body}` };
  }
  const data = (await response.json()) as {
    content?: Array<Record<string, unknown>>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const content = data.content ?? [];
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => String(block.text ?? ""))
    .join("")
    .trim();
  const toolUses = content
    .filter((block) => block.type === "tool_use")
    .map((block) => ({
      id: String(block.id ?? ""),
      name: String(block.name ?? ""),
      input: (block.input ?? {}) as Record<string, unknown>,
    }));
  return {
    ok: true,
    text,
    toolUses,
    stopReason: String(data.stop_reason ?? ""),
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    assistantTurn: { role: "assistant", content },
  };
}

async function openaiComplete(args: {
  apiKey: string;
  model: string;
  system: string;
  messages: ProviderMessage[];
  tools?: LlmTool[];
}): Promise<LlmResult> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        // The system prompt travels as the first message here, where the
        // Anthropic dialect carries it as a separate parameter.
        messages: [{ role: "system", content: args.system }, ...args.messages],
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        ...(args.tools?.length
          ? {
              tools: args.tools.map((t) => ({
                type: "function",
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.input_schema,
                },
              })),
            }
          : {}),
      }),
    });
  } catch (err) {
    return { ok: false, error: `llm-fetch-failed: ${err instanceof Error ? err.message : "unknown"}` };
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    return { ok: false, error: `llm-http-${response.status}: ${body}` };
  }
  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = data.choices?.[0]?.message;
  const toolUses = (message?.tool_calls ?? []).map((call) => {
    // Arguments arrive as a JSON STRING; a malformed one becomes an empty
    // input rather than a dead turn — the tool's own validation answers it.
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(call.function?.arguments ?? "{}") as Record<string, unknown>;
    } catch {
      // fall through with {}
    }
    return { id: String(call.id ?? ""), name: String(call.function?.name ?? ""), input };
  });
  return {
    ok: true,
    text: (message?.content ?? "").trim(),
    toolUses,
    stopReason: String(data.choices?.[0]?.finish_reason ?? ""),
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    // The whole assistant message, tool_calls included — what this dialect
    // wants replayed.
    assistantTurn: (message ?? { role: "assistant", content: "" }) as ProviderMessage,
  };
}
