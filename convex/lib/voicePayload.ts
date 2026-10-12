// Provider payloads use several shapes for collected values. Normalise them
// once before the values reach either the live tool path or the durable
// post-call reconciler.

import { isNonAnswer } from "./nonAnswer";

export function coerceVoiceValues(
  source: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_]*$/.test(key)) continue;
    const text = String(value).trim();
    // Missing analysis values arrive as empty strings. Empty means "not
    // collected", never "erase a value a person already confirmed". A
    // non-answer ("Belirtilmedi", "Not specified" and their siblings,
    // lib/nonAnswer) is the same thing written as words, and goes the same
    // way: it never fills a field, never blanks one, and is never read back.
    if (text && !isNonAnswer(text)) out[key] = text;
  }
  return out;
}

export function voiceValuesFromToolArgs(
  args: Record<string, unknown>,
): Record<string, string> {
  const nested = args.values ?? args.properties ?? args.fields;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return coerceVoiceValues(nested as Record<string, unknown>);
  }
  const rest = { ...args };
  delete rest.phone;
  delete rest.name;
  return coerceVoiceValues(rest);
}
