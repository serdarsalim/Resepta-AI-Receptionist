// The models an operator may put behind a voice agent, with what each costs.
//
// Every id here was validated against the live Retell API by creating a
// throwaway LLM with it and reading the echo back — the SDK types the field
// as a bare string, so OUR dropdown is the only thing standing between the
// admin console and a typo.
//
// The API's own allowlist is readable, which is faster than probing one id at
// a time: POST a made-up model and the 400 names every allowed value. Read in
// full on 2026-08-24 and every text id below is on it.
//
// What that list has and this one deliberately does not: gpt-4o, gpt-4o-mini,
// claude-4.0-sonnet, gemini-2.0-flash, gemini-2.0-flash-lite, gemini-2.5-flash.
// Superseded generations, left out so the picker offers what a business
// should actually be running rather than everything the provider still
// answers to. gemini-2.5-flash-lite is absent for a sharper reason: the API
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
  // Retell's fast-tier price for THIS id, absent when the provider offers no
  // fast tier on it. Read off Retell's own model picker (24 Aug 2026), where
  // a row with a chevron opens a Default/Fast submenu and a row without has
  // no tier to choose at all.
  //
  // Per-model data, never a rule, and the picker is exactly why: gpt-4.1-nano
  // has a fast tier and gpt-5-nano does not. A prefix heuristic over "gpt-"
  // shipped here first and invented two tiers that do not exist. Membership
  // follows neither the family, nor the generation, nor the size.
  //
  // The NUMBER is still doubling, which is the honest state of it. gpt-5.1
  // reads $0.040 against $0.080 in its submenu, exactly 2x, and the pricing
  // page describes the OpenAI fast tier that way for the line; only 5.1 has
  // been read directly. Correct one of these the day a submenu says otherwise.
  // It is a number to edit, not logic to unpick.
  fastUsdPerMinute?: number;
};

export const VOICE_MODEL_CHOICES: VoiceModelChoice[] = [
  { id: "claude-4.5-haiku", label: "Claude 4.5 Haiku", usdPerMinute: 0.025 },
  { id: "claude-4.5-sonnet", label: "Claude 4.5 Sonnet", usdPerMinute: 0.08 },
  { id: "claude-4.6-sonnet", label: "Claude 4.6 Sonnet", usdPerMinute: 0.08 },
  { id: "claude-5-sonnet", label: "Claude 5 Sonnet", usdPerMinute: 0.08 },
  // The 5.6 pair, added 2026-08-24. Two variants and no plain "gpt-5.6" —
  // the API rejects that and "gpt-5.6-mini" both. Neither carries a chevron
  // in Retell's picker, so neither has a fast tier.
  { id: "gpt-5.6-terra", label: "GPT 5.6 Terra", usdPerMinute: 0.064 },
  { id: "gpt-5.6-luna", label: "GPT 5.6 Luna", usdPerMinute: 0.0064 },
  { id: "gpt-5.5", label: "GPT 5.5", usdPerMinute: 0.16, fastUsdPerMinute: 0.32 },
  { id: "gpt-5.4", label: "GPT 5.4", usdPerMinute: 0.08, fastUsdPerMinute: 0.16 },
  { id: "gpt-5.4-mini", label: "GPT 5.4 Mini", usdPerMinute: 0.036, fastUsdPerMinute: 0.072 },
  { id: "gpt-5.4-nano", label: "GPT 5.4 Nano", usdPerMinute: 0.01 },
  { id: "gpt-5.2", label: "GPT 5.2", usdPerMinute: 0.056, fastUsdPerMinute: 0.112 },
  { id: "gpt-5.1", label: "GPT 5.1", usdPerMinute: 0.04, fastUsdPerMinute: 0.08 },
  { id: "gpt-5", label: "GPT 5", usdPerMinute: 0.04, fastUsdPerMinute: 0.08 },
  { id: "gpt-5-mini", label: "GPT 5 Mini", usdPerMinute: 0.012, fastUsdPerMinute: 0.024 },
  { id: "gpt-5-nano", label: "GPT 5 Nano", usdPerMinute: 0.003 },
  { id: "gpt-4.1", label: "GPT 4.1", usdPerMinute: 0.045, fastUsdPerMinute: 0.09 },
  { id: "gpt-4.1-mini", label: "GPT 4.1 Mini", usdPerMinute: 0.016, fastUsdPerMinute: 0.032 },
  { id: "gpt-4.1-nano", label: "GPT 4.1 Nano", usdPerMinute: 0.004, fastUsdPerMinute: 0.008 },
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

// Prices, for a dropdown hint. Three decimals normally, FOUR below a cent:
// gpt-5.6-luna is $0.0064/min and three decimals round it to $0.006, which is
// 6% light on a model whose whole pitch is the price. The band, rather than
// trimming zeros per value, so every sub-cent row shares one shape.
export function formatVoicePrice(usdPerMinute: number): string {
  return `$${usdPerMinute.toFixed(usdPerMinute < 0.01 ? 4 : 3)}/min`;
}

export function isVoiceModel(id: string): boolean {
  return VOICE_MODEL_CHOICES.some((choice) => choice.id === id);
}

// What the fast tier (model_high_priority) costs on a given id, or null when
// there is no fast tier to buy. A lookup now, not a rule — see
// fastUsdPerMinute above for what the rule got wrong.
//
// Null covers three different facts and treats them alike on purpose: no such
// model, a model Retell sells no tier on, and a realtime id whose engine has
// no LLM step to queue (model_high_priority belongs to the STT→LLM→TTS
// pipeline a speech-to-speech agent replaces, and enginePatchFor drops it).
// In every one of them there is nothing to choose, which is the only thing
// the console needs to know.
//
// Retell's API takes model_high_priority: true on ids with no tier anyway —
// verified 2026-08-23 by creating a throwaway LLM per family (gpt-5.1,
// claude-4.5-haiku, claude-5-sonnet, gemini-3.5-flash, gpt-5.4-mini) and
// reading the echo back: all five returned true. An unvalidated field is not
// a feature. A provider that will not sell you a tier in its own console is
// not running one.
export function fastTierPriceFor(id: string): number | null {
  const choice = VOICE_MODEL_CHOICES.find((entry) => entry.id === id);
  if (!choice || choice.realtime) return null;
  return choice.fastUsdPerMinute ?? null;
}

// ---- The picker's rows: a model and its tier, as one choice ----
//
// Retell's own console draws it this way and Serdar asked for the same shape
// (2026-08-24): you pick an ENGINE, not a model and then a tier. There it is a
// submenu hanging off the OpenAI rows; here it is two adjacent rows in the
// existing SearchSelect, because the rule that matters is "reuse the style
// that already exists" and a bespoke submenu widget to imitate one provider's
// dashboard would be a lookalike, not a port. Same information, same
// adjacency, the component this app already has.
//
// What it costs, stated where the cost lives: "explicit model, inherited
// tier" is no longer expressible. Picking a model now pins its tier too, so a
// fleet tier change stops reaching any agent that pinned one. Inheritance
// survives exactly where it was always clearest — the "Platform default" row,
// which follows both.

export type VoiceEngineChoice = {
  // What the picker stores. See encodeEngine below for the grammar.
  value: string;
  id: string;
  label: string;
  usdPerMinute: number;
  fast: boolean;
};

// "gpt-5.1" or "gpt-5.1:fast". A suffix rather than two fields because the
// component takes one string, and a suffix on the id keeps the standard row's
// value byte-identical to what the picker stored before this existed — every
// row already in the database reads back as the same choice it was.
export function encodeEngine(id: string, fast: boolean): string {
  return fast ? `${id}:fast` : id;
}

export function decodeEngine(value: string): { id: string; fast: boolean } | null {
  if (!value) return null;
  const fast = value.endsWith(":fast");
  const id = fast ? value.slice(0, -":fast".length) : value;
  return isVoiceModel(id) ? { id, fast } : null;
}

// Every choice the picker offers, fast variants sitting immediately under
// their standard row so the two prices for one model read as a pair. A model
// with no fast tier contributes one row and no gap, which is how Retell's
// list shows the same fact (no chevron on the Claude and Gemini rows).
export function voiceEngineChoices(): VoiceEngineChoice[] {
  const out: VoiceEngineChoice[] = [];
  for (const choice of VOICE_MODEL_CHOICES) {
    out.push({
      value: encodeEngine(choice.id, false),
      id: choice.id,
      label: choice.label,
      usdPerMinute: choice.usdPerMinute,
      fast: false,
    });
    const fast = fastTierPriceFor(choice.id);
    if (fast !== null) {
      out.push({
        value: encodeEngine(choice.id, true),
        id: choice.id,
        // The word, not a coloured pill: this list is searchable, and "fast"
        // typed into the box should find these rows.
        label: `${choice.label} · Fast`,
        usdPerMinute: fast,
        fast: true,
      });
    }
  }
  return out;
}

// How a resolved engine reads in one line — the "Platform default — ..." row,
// and anywhere else a screen has to name what an agent is actually running.
export function engineLabel(id: string, fast: boolean): string {
  const choice = VOICE_MODEL_CHOICES.find((entry) => entry.id === id);
  const label = choice?.label ?? id;
  return fast && fastTierPriceFor(id) !== null ? `${label} · Fast` : label;
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
