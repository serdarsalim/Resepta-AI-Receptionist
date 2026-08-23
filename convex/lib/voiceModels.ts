// The models an operator may put behind a voice agent, with what each costs.
//
// Every id here was validated against the live Retell API on 2026-08-20 by
// creating a throwaway LLM with it and reading the echo back — the API does
// enforce an allowlist (a made-up id 400s), but the SDK types the field as a
// bare string, so OUR dropdown is the only thing standing between the admin
// console and a typo. gemini-2.5-flash-lite is deliberately absent: the API
// accepts it and silently answers gemini-3.1-flash-lite, and a picker that
// stores one id while the provider runs another is a lie in both directions.
//
// Prices are Retell's STANDARD-tier LLM cost per conversation minute
// (retellai.com/pricing, read 2026-08-20). They are display data for the
// operator choosing a model — billing truth stays with the provider. The
// "fast tier" is a SECOND price on the same id, not a model of its own; see
// fastTierPriceFor below for which ids have one and why the rest must be
// shown as unknown rather than guessed.
//
// The platform default lives in voiceAgentTemplate.ts (llm.model), not here:
// that file owns what a NEW agent is born with, this one owns what the
// operator may change an existing agent to.

export type VoiceModelChoice = {
  id: string;
  label: string;
  usdPerMinute: number;
  // Speech-to-speech: the id goes in the provider's s2s_model field and
  // REPLACES the STT→LLM→TTS pipeline — the model listens and speaks itself.
  // The voice engine fee still applies (billed as "Voice Infra"), and the
  // model speaks with its own voices, so a realtime pick changes how the
  // agent sounds. Ids validated against the live API 2026-08-20 like the
  // rest; the 2.1 pair carries the family price, Retell does not list it
  // separately.
  realtime?: true;
};

export const VOICE_MODEL_CHOICES: VoiceModelChoice[] = [
  { id: "claude-4.5-haiku", label: "Claude 4.5 Haiku", usdPerMinute: 0.025 },
  { id: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet", usdPerMinute: 0.08 },
  { id: "claude-4.6-sonnet", label: "Claude 4.6 Sonnet", usdPerMinute: 0.08 },
  { id: "claude-5-sonnet", label: "Claude 5 Sonnet", usdPerMinute: 0.08 },
  { id: "gpt-5.5", label: "GPT 5.5", usdPerMinute: 0.16 },
  { id: "gpt-5.4", label: "GPT 5.4", usdPerMinute: 0.08 },
  { id: "gpt-5.4-mini", label: "GPT 5.4 Mini", usdPerMinute: 0.036 },
  { id: "gpt-5.4-nano", label: "GPT 5.4 Nano", usdPerMinute: 0.01 },
  { id: "gpt-5.2", label: "GPT 5.2", usdPerMinute: 0.056 },
  { id: "gpt-5.1", label: "GPT 5.1", usdPerMinute: 0.04 },
  { id: "gpt-5", label: "GPT 5", usdPerMinute: 0.04 },
  { id: "gpt-5-mini", label: "GPT 5 Mini", usdPerMinute: 0.012 },
  { id: "gpt-5-nano", label: "GPT 5 Nano", usdPerMinute: 0.003 },
  { id: "gpt-4.1", label: "GPT 4.1", usdPerMinute: 0.045 },
  { id: "gpt-4.1-mini", label: "GPT 4.1 Mini", usdPerMinute: 0.016 },
  { id: "gpt-4.1-nano", label: "GPT 4.1 Nano", usdPerMinute: 0.004 },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", usdPerMinute: 0.069 },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", usdPerMinute: 0.081 },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", usdPerMinute: 0.023 },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", usdPerMinute: 0.014 },
  { id: "gemini-3.0-flash", label: "Gemini 3.0 Flash", usdPerMinute: 0.027 },
  { id: "gpt-realtime-2.1-mini", label: "GPT Realtime 2.1 Mini (s2s)", usdPerMinute: 0.07, realtime: true },
  { id: "gpt-realtime-2.1", label: "GPT Realtime 2.1 (s2s)", usdPerMinute: 0.345, realtime: true },
  { id: "gpt-realtime-1.5", label: "GPT Realtime 1.5 (s2s)", usdPerMinute: 0.345, realtime: true },
  { id: "gpt-realtime-mini", label: "GPT Realtime Mini (s2s)", usdPerMinute: 0.07, realtime: true },
  { id: "gpt-realtime", label: "GPT Realtime (s2s)", usdPerMinute: 0.345, realtime: true },
];

export function isVoiceModel(id: string): boolean {
  return VOICE_MODEL_CHOICES.some((choice) => choice.id === id);
}

// What the fast tier (model_high_priority) costs on a given id, or null when
// the provider does not publish one.
//
// Retell prices fast inference only for the OpenAI line. gpt-5.1 reads $0.040
// standard against $0.080 fast on the dashboard — exactly double — and the
// pricing page applies the same doubling across the rest of that line, so one
// rule covers it and no per-model number has to be hand-copied (a table of
// transcribed prices is a table that goes stale silently).
//
// Claude and Gemini have NO published fast-tier price, and the API accepts
// model_high_priority: true on them regardless — verified live 2026-08-23 by
// creating a throwaway LLM per family (gpt-5.1, claude-4.5-haiku,
// claude-5-sonnet, gemini-3.5-flash, gpt-5.4-mini) and reading the echo: all
// five came back true. So the flag on a Claude agent buys an unknown amount
// of speed for an unknown amount of money. That is precisely why this returns
// null instead of a guess, and why the console says "price not published"
// rather than printing usdPerMinute twice.
//
// Realtime ids return null too, for a different reason: model_high_priority
// belongs to the STT→LLM→TTS pipeline a speech-to-speech agent is not
// running, so there is no tier to price (enginePatchFor drops the knob).
export function fastTierPriceFor(id: string): number | null {
  const choice = VOICE_MODEL_CHOICES.find((entry) => entry.id === id);
  if (!choice || choice.realtime) return null;
  return id.startsWith("gpt-") ? Number((choice.usdPerMinute * 2).toFixed(3)) : null;
}

// The stored fleet-wide fast-tier default, as a tri-state. Null (unset, or a
// row holding anything else) means "no operator opinion" and falls through to
// the template constant, exactly like resolvePlatformVoiceModel above — the
// platformConfig row is a dumb string, so the parsing lives here where every
// reader shares it rather than in each caller's idea of what "true" looks
// like.
export function resolvePlatformHighPriority(raw: string | null | undefined): boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

// The stored platform default, admitted only while the catalogue still knows
// it. One place, because three readers (editor context, provisioning, the
// operator console) each resolve the default and a stale row naming a
// retired id must fall through to the code constant in all of them, not
// publish garbage from whichever reader forgot to check.
export function resolvePlatformVoiceModel(raw: string | null | undefined): string | null {
  return raw && isVoiceModel(raw) ? raw : null;
}

// Which provider field a model id belongs in. `model` and `s2s_model` are
// mutually exclusive on the engine, and BOTH must be sent on every switch:
// the API clears a field only when it is explicitly nulled (verified live,
// 2026-08-20 — an omitted field survives the PATCH), so sending just the new
// one would leave an agent with both engines configured.
function engineFieldsFor(id: string): {
  model: string | null;
  s2s_model: string | null;
} {
  const realtime = VOICE_MODEL_CHOICES.find((choice) => choice.id === id)?.realtime === true;
  return realtime ? { model: null, s2s_model: id } : { model: id, s2s_model: null };
}

// The complete engine half of a publish: which field the id goes in, plus the
// two text-pipeline knobs that ride with it.
//
// One function because the three publish paths — birth, syncTemplate and the
// model publish — each used to assemble this by hand, and the model publish
// forgot the knobs. That omission was invisible rather than loud: an omitted
// field SURVIVES the PATCH, so changing an agent's model silently kept
// whatever tier the engine already had. Every path calls this now, so a knob
// added here reaches all three or none.
//
// The knobs come back undefined for a realtime id on purpose. They belong to
// the STT→LLM→TTS pipeline that a speech-to-speech agent replaces, and
// undefined is what JSON.stringify drops — so a realtime publish carries no
// text-pipeline settings rather than carrying meaningless ones.
export function enginePatchFor(
  id: string,
  knobs: { temperature: number; highPriority: boolean },
): {
  model: string | null;
  s2s_model: string | null;
  model_temperature: number | undefined;
  model_high_priority: boolean | undefined;
} {
  const fields = engineFieldsFor(id);
  const text = fields.model !== null;
  return {
    ...fields,
    model_temperature: text ? knobs.temperature : undefined,
    model_high_priority: text ? knobs.highPriority : undefined,
  };
}
