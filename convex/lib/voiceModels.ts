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
// "fast tier" (model_high_priority, which the template enables) is priced
// separately and only published for the OpenAI models, at roughly double;
// Claude and Gemini have no listed fast-tier price.
//
// The platform default lives in voiceAgentTemplate.ts (llm.model), not here:
// that file owns what a NEW agent is born with, this one owns what the
// operator may change an existing agent to.

export type VoiceModelChoice = {
  id: string;
  label: string;
  usdPerMinute: number;
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
];

export function isVoiceModel(id: string): boolean {
  return VOICE_MODEL_CHOICES.some((choice) => choice.id === id);
}
