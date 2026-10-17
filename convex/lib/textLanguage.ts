// Which language a customer WROTE or SPOKE in (P30 of the Nudge port, Nudge
// 9670941f). Free and local: letters only one language uses, then common
// words. Conservative on purpose: what this returns replaces the business's
// default for that customer (lib/customerLanguage), so "ok", "👍", "1" or a
// lone "iptal" says nothing and comes back null. Only the three languages
// Resepta writes to customers in; anything else is null, because a language
// with no templates would fail every send (AGENTS.md, i18n layer 1).
//
// A LEAF with no imports, so a node test can read it.

export type TextLanguage = "tr" | "en" | "de";

// ı ğ ş İ Ğ Ş are Turkish only; ç ö ü are shared with German.
const TURKISH_ONLY = /[ığşİĞŞ]/;
// ß and ä are German, never Turkish or English.
const GERMAN_ONLY = /[ßäÄ]/;
// Arabic, Cyrillic, Greek, Hebrew: a script none of the three uses.
const OTHER_SCRIPT = /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿ]/;

const WORDS: Record<TextLanguage, Set<string>> = {
  tr: new Set(
    (
      "merhaba selam selamlar evet hayır hayir teşekkür tesekkur teşekkürler tesekkurler " +
      "sağol sagol sağolun tamam istiyorum isterim nasıl nasil değil degil için icin ben " +
      "bir var yok lütfen lutfen iyi günler gunler ederim olur ne zaman neden bu ama ile " +
      "gibi kadar çok cok daha sonra randevu randevum randevumu saat saatte yarın yarin " +
      "bugün bugun gelemiyorum gelebilir gelirim geleceğim gelecegim müsait musait mı mi " +
      "mısınız misiniz miyim mıyım iptal erteleyebilir alabilir abla abi hocam efendim"
    ).split(" "),
  ),
  en: new Set(
    (
      "the and you is are i'm please thanks thank hello hi yes would like can could " +
      "call me my what when how not have want need about this that will for with your " +
      "just get know appointment tomorrow today cancel book booking time see there it's " +
      "sorry fine great"
    ).split(" "),
  ),
  de: new Set(
    (
      "ich und nicht bitte danke ist das wie haben gerne hallo ja nein sie mit für fur " +
      "auch wir termin morgen heute absagen uhr kann komme kommen guten tag vielen dank " +
      "möchte mochte leider geht noch"
    ).split(" "),
  ),
};

/** The language of a piece of text the customer wrote or said, or null when
 *  it does not say enough. */
export function detectTextLanguage(text: string | null | undefined): TextLanguage | null {
  const t = (text ?? "").replace(/https?:\/\/\S+/g, " ").trim();
  if (!t) return null;
  if (OTHER_SCRIPT.test(t)) return null;
  const words = t.replace(/İ/g, "i").toLowerCase().match(/[\p{L}\p{M}']+/gu) ?? [];
  if (words.length < 2) return null;
  if (TURKISH_ONLY.test(t)) return "tr";
  if (GERMAN_ONLY.test(t)) return "de";
  const score: Partial<Record<TextLanguage, number>> = {};
  for (const w of words) {
    for (const lang of Object.keys(WORDS) as TextLanguage[]) {
      if (WORDS[lang].has(w)) score[lang] = (score[lang] ?? 0) + 1;
    }
  }
  const ranked = (Object.entries(score) as [TextLanguage, number][]).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best || best[1] < 2) return null;
  if (second && best[1] < second[1] * 2) return null;
  return best[0];
}

/** What the CUSTOMER said on a call: the user turns of the provider's
 *  transcript. Takes the structured turns when the payload carries them, else
 *  the plain transcript's "User:" lines. */
export function customerSpokenText(transcriptObject: unknown, transcript: unknown): string {
  if (Array.isArray(transcriptObject)) {
    return (transcriptObject as { role?: unknown; content?: unknown }[])
      .filter((turn) => turn && turn.role === "user")
      .map((turn) => String(turn.content ?? ""))
      .join(" ");
  }
  if (typeof transcript !== "string") return "";
  return transcript
    .split("\n")
    .filter((line) => /^user:/i.test(line.trim()))
    .map((line) => line.trim().slice(5))
    .join(" ");
}
