// The provider's voice library, turned into something a salon owner can pick
// from. Extracted so the create sheet and the agent page offer the SAME list:
// two copies of this filtering drift, and then the voice an agent shows is one
// the picker that made it never offered.

export type RawVoice = {
  voice_id?: string;
  voice_name?: string;
  provider?: string;
  gender?: string;
  accent?: string;
  preview_audio_url?: string;
};

export type CatalogueVoice = {
  id: string;
  name: string;
  gender: string;
  accent: string;
  previewUrl: string | null;
};

// The raw library contains the same named voice many times from different
// engines. Resepta offers the MINIMAX set only (Serdar, 2026-08-21): it is
// the engine family Bella was tuned on, its voices are multilingual, and the
// previous "platform-maintained" filter excluded every minimax voice — so a
// Turkish clinic's auto-provisioned agent was born speaking retell-Alejandro
// while the curated default (minimax-Camille) was not even in the tenant's
// picker. One engine family also means one latency and pricing profile
// across the fleet. Duplicates are removed after the filter; the provider
// name never reaches the browser.
// `keepId` is the voice an existing agent is ALREADY using. It survives both
// the platform filter and the dedupe, because an agent created before this
// picker existed (or through Retell directly) can be on a voice the filter
// drops — and then the picker either shows a raw id like "minimax-Andrew" or
// silently reads as some other voice entirely. Both are worse than one extra
// row.
export function voiceCatalogue(raw: unknown, keepId?: string | null): CatalogueVoice[] {
  const items = (Array.isArray(raw) ? raw : []) as RawVoice[];
  const maintained = items.filter((voice) => voice.provider === "minimax");
  const kept =
    keepId && !maintained.some((voice) => voice.voice_id === keepId)
      ? items.filter((voice) => voice.voice_id === keepId)
      : [];
  const candidates = maintained.length > 0 ? [...kept, ...maintained] : items;
  const labels = new Set<string>();
  return candidates
    .filter((voice) => voice.voice_id && voice.voice_name)
    .filter((voice) => {
      const label = [voice.voice_name, voice.accent, voice.gender]
        .map((value) => value?.trim().toLocaleLowerCase() ?? "")
        .join("|");
      if (labels.has(label)) return false;
      labels.add(label);
      return true;
    })
    .map((voice) => ({
      id: voice.voice_id!,
      name: voice.voice_name!.trim(),
      gender: voice.gender?.trim() || "",
      accent: voice.accent?.trim() || "",
      previewUrl: voice.preview_audio_url?.trim() || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
