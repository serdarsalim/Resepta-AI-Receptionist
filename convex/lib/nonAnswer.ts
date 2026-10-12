// "The call didn't establish this", told apart from a real answer. Ported
// from Nudge (lib/nonAnswer.ts, 3e61d794) and widened to the three languages
// Resepta's agents speak. A LEAF: it imports nothing, so the payload
// normaliser, the write gate and the ring-time injection can all read it.
//
// Why it exists. The post-call analysis is told to leave a field empty when
// the call never mentioned it (retellAgent publishVariableSet appends exactly
// that), and models answer that instruction with a placeholder instead:
// "Belirtilmedi", "Not specified", "Nicht angegeben". Stored, a placeholder
// fills an empty field for good, because the next call's inference only fills
// fields still empty, and the ring-time injection then hands it to the agent
// as a fact about the caller: "Belirtilmedi Bey". Storing one is survivable;
// speaking one is not (Nudge's words). So a non-answer is never stored, and
// one stored before this existed is never read back.
//
// A short, explicit list, never a heuristic over free text. A value matches
// as a whole, or as a stem with a qualifier on either side ("Not provided in
// transcript", "Görüşmede belirtilmedi": Turkish and German put the verb
// last, so their qualifiers come first). Never as a loose prefix: "Alerji yok"
// and "No pet" are real answers in this same data, which is also why "yok",
// "none" and "keine" are non-answers only where a NAME is expected, never in
// a custom field, where "no allergies" is exactly what a clinic needs to know.

// Lower case, accents and the Turkish dotless i folded, every run of
// punctuation and space reduced to one space. "Belirtilmedi." and
// "BELİRTİLMEDİ" both become "belirtilmedi"; "N/A" becomes "n a"; a value of
// nothing but dashes or dots becomes "", which counts as no answer.
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Non-answers only as the whole value.
const WHOLE = new Set(
  [
    // English
    "n/a",
    "not applicable",
    "null",
    "undefined",
    // Turkish
    "bilinmemektedir",
    "bilgi yok",
    "yanıt yok",
    "cevap yok",
    "bilgi verilmedi",
    "yanıt verilmedi",
    "cevap verilmedi",
    "sorulmadı",
    "tespit edilemedi",
    "anlaşılamadı",
    // German
    "k. a.",
    "keine information",
    "keine informationen",
  ].map(fold),
);

// Non-answers whole, or with a qualifier before or after.
const STEMS = [
  // English: Nudge's measured family, plus its two declared escapes.
  "not provided",
  "not specified",
  "not stated",
  "not mentioned",
  "not given",
  "not answered",
  "not discussed",
  "unknown",
  // Turkish
  "belirtilmedi",
  "belirtilmemiş",
  "belirtilmemiştir",
  "söylenmedi",
  "bahsedilmedi",
  "paylaşılmadı",
  "bilinmiyor",
  // German
  "nicht angegeben",
  "keine angabe",
  "keine angaben",
  "nicht genannt",
  "nicht erwähnt",
  "nicht beantwortet",
  "nicht besprochen",
  "nicht spezifiziert",
  "nicht bekannt",
  "unbekannt",
].map(fold);

// Words that are a real answer to "any allergies?" and never a person's name.
const NAME_ONLY = new Set(
  [
    "yok",
    "hayır",
    "isimsiz",
    "anonim",
    "none",
    "no",
    "anonymous",
    "keine",
    "kein",
    "nein",
    "anonym",
  ].map(fold),
);

/**
 * True when a value carries no information about the customer: empty, or one
 * of the "the call did not establish this" placeholders above. `kind: "name"`
 * adds the words that answer a question but can never be somebody's name.
 */
export function isNonAnswer(
  value: string | null | undefined,
  kind?: "name",
): boolean {
  const folded = fold(value ?? "");
  if (folded === "") return true;
  if (WHOLE.has(folded)) return true;
  if (kind === "name" && NAME_ONLY.has(folded)) return true;
  return STEMS.some(
    (stem) =>
      folded === stem ||
      folded.startsWith(`${stem} `) ||
      folded.endsWith(` ${stem}`),
  );
}

/** The value when it is an answer, "" when it is not. For reading a stored
 *  field back to an agent: a placeholder stored before the filter existed
 *  reads as nothing, the same as a field never filled. */
export function answerOrEmpty(
  value: string | null | undefined,
  kind?: "name",
): string {
  return value && !isNonAnswer(value, kind) ? value : "";
}

/** A collected-values bag without its non-answers: string placeholders are
 *  dropped, every other shape is kept as it came. */
export function withoutNonAnswers(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => typeof value !== "string" || !isNonAnswer(value),
    ),
  );
}
