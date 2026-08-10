// The LLM seam (docs/chat-agent.md §3): one place the product talks to a
// language model, provider-neutral at the call site. Today it speaks the
// Anthropic Messages API over fetch; adding a provider means a second sender
// behind the same result shape, exactly like the voice seam's CallRecord
// thinking. Actions only — a mutation cannot fetch.
//
// Key resolution does NOT live here: the caller resolves it (org connections
// override first, then the platform key) inside its context query, because
// this file has no ctx and must not grow one.

export const DEFAULT_CHAT_MODEL = "claude-sonnet-5";

// What a turn may spend. maxTokens bounds ONE completion; the tool loop in
// chatAgent.ts bounds how many completions a turn may chain. Both are
// circuit breakers, not tuning knobs.
export const MAX_COMPLETION_TOKENS = 1024;

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
export const PRICE_TABLE_VERSION = 1;

const PRICES: Record<string, { inUsdPerMTok: number; outUsdPerMTok: number }> = {
  "claude-sonnet-5": { inUsdPerMTok: 3, outUsdPerMTok: 15 },
  "claude-haiku-4-5-20251001": { inUsdPerMTok: 1, outUsdPerMTok: 5 },
};

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

// ── The call itself ─────────────────────────────────────────────────────────

export type LlmMessage = {
  role: "user" | "assistant";
  // String content for plain turns; block arrays carry tool_use/tool_result
  // rounds in the provider's own shape. The loop in chatAgent.ts builds
  // these; nothing else needs to.
  content: string | Array<Record<string, unknown>>;
};

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
      // The raw assistant content blocks, replayed verbatim into the next
      // request when tools ran — the API requires the exact blocks back.
      rawContent: Array<Record<string, unknown>>;
    }
  | { ok: false; error: string };

export async function chatComplete(args: {
  apiKey: string;
  model: string;
  system: string;
  messages: LlmMessage[];
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
    rawContent: content,
  };
}
