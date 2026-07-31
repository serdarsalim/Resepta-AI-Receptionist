// Provider payloads use several shapes for collected values. Normalise them
// once before the values reach either the live tool path or the durable
// post-call reconciler.

export function coerceVoiceValues(
  source: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_]*$/.test(key)) continue;
    const text = String(value).trim();
    // Missing analysis values arrive as empty strings. Empty means "not
    // collected", never "erase a value a person already confirmed".
    if (text) out[key] = text;
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
