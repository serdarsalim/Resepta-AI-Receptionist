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
// rows anthropicModel / openaiModel — so switching to a model MODELS below
// already knows is an admin edit, not a deploy. A model it does not know
// needs its row first: until then it is refused rather than run unmetered.
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
// is "high" on most models, which is a reasoning budget for a receptionist
// answering "are you open Sunday" — real money, no better answer.
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
//
// Sent only to a model that takes it (MODELS below, 2026-10-13): Haiku 4.5
// and Sonnet 4.5 answer the parameter with a 400, and /admin offers every
// model the platform key can reach, so "low" on every request meant a model
// pick in the console could stop every org's assistant mid-sentence.
export const ANTHROPIC_EFFORT = "low";

// Per-org monthly LLM budget when the org has no override, in micro-USD.
// $20/month is far above any honest salon's chat volume and far below what a
// runaway loop could burn unbounded — a circuit breaker, not a quota a
// customer should ever meet.
export const DEFAULT_MONTHLY_BUDGET_MICRO_USD = 20_000_000;

// ── The model table ─────────────────────────────────────────────────────────
// One row per model /admin can offer: what it costs and, for Anthropic, what
// its Messages API accepts. One table on purpose. A model priced here but not
// described would get a request it might refuse, and one described but not
// priced would run for free, so a model is either fully known or not at all.
//
// Prices are USD per million tokens, as published. Versioned, and every turn
// snapshots the cost it was billed at (chatAgentTurns.costMicroUsd), so
// editing this table never rewrites history — it only changes turns that
// have not happened yet. Bump the version when a rate changes so a turn row
// names its rate card.
//
// v3 (2026-08-28): claude-sonnet-5 was carrying 3/15 — Sonnet 4.6's rate,
// inherited when the model name changed and the numbers didn't. Every Sonnet
// turn since was metered at 1.5x its real cost. Turns snapshot their own rate,
// so this corrects turns from here on and rewrites nothing already recorded.
//
// v4 (2026-10-13): every model the platform key lists, the Nudge port's
// guard (Nudge 08311abc). The 5.5 family was missing, so a pick of
// claude-opus-5-5 or claude-haiku-5-5 in /admin metered every turn at $0 and
// the monthly budget never closed. Rates checked against Anthropic's pricing
// page on 2026-10-13; the OpenAI rows are Nudge's (checked 2026-08-28). Dated
// ids are listed one by one rather than matched by stripping the date: a
// snapshot nobody checked is exactly the model that should stay unpriced.
// Models retired from the Claude API (Opus 4.1, Opus 4, Sonnet 4, Haiku 3.5)
// are left out; the platform key cannot reach them.
export const PRICE_TABLE_VERSION = 4;

type Rate = { inUsdPerMTok: number; outUsdPerMTok: number };

type ModelRow = Rate & {
  // A request whose prompt is longer than this pays these rates for the
  // WHOLE request (Haiku 5.5 above 100K prompt tokens). Per request, not per
  // turn: costMicroUsd is called once per completion.
  longPrompt?: Rate & { overInputTokens: number };
  // Anthropic only: whether the model takes output_config.effort. Haiku 4.5
  // and Sonnet 4.5 refuse it with a 400.
  effort?: boolean;
  // Anthropic only: how thinking stays on at ANTHROPIC_EFFORT. "default"
  // runs adaptive thinking when the parameter is left out (the 5.x lineup).
  // "adaptive" runs WITHOUT thinking unless {type:"adaptive"} is sent (Opus
  // 4.6 to 4.8, Sonnet 4.6), and thinking off is the visible-tool-call
  // failure described above. Unset: the model has no adaptive thinking
  // (budget_tokens only), so nothing is sent and it answers without.
  thinking?: "default" | "adaptive";
};

const FABLE: ModelRow = { inUsdPerMTok: 10, outUsdPerMTok: 50, effort: true, thinking: "default" };
const OPUS_45: ModelRow = { inUsdPerMTok: 5, outUsdPerMTok: 25, effort: true };
const SONNET_45: ModelRow = { inUsdPerMTok: 3, outUsdPerMTok: 15 };
const HAIKU_45: ModelRow = { inUsdPerMTok: 1, outUsdPerMTok: 5 };

const MODELS: Record<string, ModelRow> = {
  "claude-fable-5-1": FABLE,
  "claude-fable-5": FABLE,
  // Project Glasswing only; same model, same price as its Fable twin.
  "claude-mythos-5-1": FABLE,
  "claude-mythos-5": FABLE,
  "claude-opus-5-5": { inUsdPerMTok: 4, outUsdPerMTok: 20, effort: true, thinking: "default" },
  "claude-opus-5": { inUsdPerMTok: 5, outUsdPerMTok: 25, effort: true, thinking: "default" },
  "claude-opus-4-8": { inUsdPerMTok: 5, outUsdPerMTok: 25, effort: true, thinking: "adaptive" },
  "claude-opus-4-7": { inUsdPerMTok: 5, outUsdPerMTok: 25, effort: true, thinking: "adaptive" },
  "claude-opus-4-6": { inUsdPerMTok: 5, outUsdPerMTok: 25, effort: true, thinking: "adaptive" },
  "claude-opus-4-5": OPUS_45,
  "claude-opus-4-5-20251101": OPUS_45,
  "claude-sonnet-5-5": { inUsdPerMTok: 2, outUsdPerMTok: 10, effort: true, thinking: "default" },
  "claude-sonnet-5": { inUsdPerMTok: 2, outUsdPerMTok: 10, effort: true, thinking: "default" },
  "claude-sonnet-4-6": { inUsdPerMTok: 3, outUsdPerMTok: 15, effort: true, thinking: "adaptive" },
  "claude-sonnet-4-5": SONNET_45,
  "claude-sonnet-4-5-20250929": SONNET_45,
  "claude-haiku-5-5": {
    inUsdPerMTok: 0.1,
    outUsdPerMTok: 0.5,
    longPrompt: { overInputTokens: 100_000, inUsdPerMTok: 0.5, outUsdPerMTok: 2.5 },
    effort: true,
    thinking: "default",
  },
  "claude-haiku-4-5": HAIKU_45,
  "claude-haiku-4-5-20251001": HAIKU_45,
  "gpt-5.2": { inUsdPerMTok: 1.75, outUsdPerMTok: 14 },
  "gpt-4.1": { inUsdPerMTok: 2, outUsdPerMTok: 8 },
  "gpt-4.1-mini": { inUsdPerMTok: 0.4, outUsdPerMTok: 1.6 },
  "gpt-4.1-nano": { inUsdPerMTok: 0.1, outUsdPerMTok: 0.4 },
  "gpt-4o": { inUsdPerMTok: 2.5, outUsdPerMTok: 10 },
  "gpt-4o-mini": { inUsdPerMTok: 0.15, outUsdPerMTok: 0.6 },
};

// Whether a model can run here at all. An unpriced model would meter at
// nothing, and nothing never reaches the monthly budget, so chatAgent refuses
// it before the turn starts (skip "model-unpriced") and /admin offers only
// models that pass this.
export function isPricedModel(model: string): boolean {
  return MODELS[model] !== undefined;
}

// The dearest rate in the table, for a model that is somehow metered without
// a row of its own. Nothing should reach that today, since an unpriced model
// never runs, but a caller that skips the gate is billed high, never free.
const CEILING: Rate = Object.values(MODELS).reduce<Rate>(
  (top, row) => ({
    inUsdPerMTok: Math.max(top.inUsdPerMTok, row.inUsdPerMTok, row.longPrompt?.inUsdPerMTok ?? 0),
    outUsdPerMTok: Math.max(top.outUsdPerMTok, row.outUsdPerMTok, row.longPrompt?.outUsdPerMTok ?? 0),
  }),
  { inUsdPerMTok: 0, outUsdPerMTok: 0 },
);

// The cost of ONE completion, in integer micro-USD, rounded up: a fraction of
// a micro-dollar owed is a micro-dollar owed, and rounding down across
// thousands of turns is a slow leak in the platform's favor to report and the
// org's favor to bill. Per completion because a long-prompt rate is decided
// per request; a turn sums its rounds.
export function costMicroUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const row = MODELS[model];
  const rate: Rate = !row
    ? CEILING
    : row.longPrompt && inputTokens > row.longPrompt.overInputTokens
      ? row.longPrompt
      : row;
  return Math.ceil(inputTokens * rate.inUsdPerMTok + outputTokens * rate.outUsdPerMTok);
}

// What this model's Messages API takes beyond the request every model
// accepts: effort where the model has it, and the explicit adaptive switch
// where thinking is otherwise off. A model the table does not know gets
// neither, the one request nothing refuses. It never runs today anyway (see
// isPricedModel), but the builder must not depend on that gate to be safe.
export function anthropicModelParams(model: string): Record<string, unknown> {
  const row = MODELS[model];
  if (!row) return {};
  return {
    ...(row.effort ? { output_config: { effort: ANTHROPIC_EFFORT } } : {}),
    ...(row.thinking === "adaptive" ? { thinking: { type: "adaptive" } } : {}),
  };
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
        // Thinking stays on and is turned DOWN rather than off (see
        // ANTHROPIC_EFFORT), in whichever words this model understands: the
        // effort field only where it is accepted, and the adaptive switch
        // only where leaving it out would mean no thinking at all.
        ...anthropicModelParams(args.model),
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
