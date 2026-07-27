// The address an integration writes to, derived from what a human typed.
//
// Contact fields and services both hand keys to the voice agent — one as the
// property `update_contact` writes, one as the service `book_appointment`
// asks for — so the rule has to be ONE rule. Two copies of it drift the day
// somebody adds a character class to one of them, and the symptom is an agent
// silently addressing a key the app does not have.
//
// Turkish-folded so "Saç boyama" and "Manikür" survive as sac_boyama and
// manikur rather than as underscores where the letters were.
export function keyFromLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[çÇ]/g, "c").replace(/[ğĞ]/g, "g").replace(/[ıİ]/g, "i")
    .replace(/[öÖ]/g, "o").replace(/[şŞ]/g, "s").replace(/[üÜ]/g, "u")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// A key that is already taken gets a numeric tail rather than an error.
// Contact fields refuse a duplicate because the owner is naming one property
// and can pick another word; services legitimately repeat words ("Manikür",
// "Manikür (jel)") and a salon should not have to invent a name that pleases
// the key generator.
export function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
