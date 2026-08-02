// The address an integration writes to, derived from what a human typed.
//
// Contact fields and services both hand keys to the voice agent — one as the
// property `update_contact` writes, one as the service `book_appointment`
// asks for — so the rule has to be ONE rule. Two copies of it drift the day
// somebody adds a character class to one of them, and the symptom is an agent
// silently addressing a key the app does not have.
//
// Turkish-folded so "Saç boyama" and "Manikür" survive as sac_boyama and
// manikur rather than as underscores where the letters were. Folding happens
// BEFORE lowercasing: "İ".toLowerCase() is "i" plus a combining dot (U+0307)
// the classes can't match, which is how "İstenen hizmet" once became
// i_stenen_hizmet; the NFD strip catches any other combining mark.
//
// A label is often a question ("What is your best friend's favorite
// restaurant?"), and a key is a property name — so the scaffolding words are
// stripped from the edges and the result is capped at a word boundary.
// best_friend_s_favorite_restaurant, not the whole sentence.
const LEADING_STOP = new Set([
  // en
  "what", "whats", "is", "are", "your", "you", "do", "does", "the", "a", "an",
  "please", "s", "their", "his", "her", "my", "our", "how", "many", "much", "which", "who",
  "this", "that",
  // tr
  "sizin", "senin", "lutfen", "hangi", "bu",
  // de
  "was", "ist", "sind", "ihre", "ihr", "dein", "deine", "bitte", "wie", "welche", "welcher",
]);
// Words a key must not END on. The question-mark words were the original
// reason, but the function words matter more in practice: the length cap
// truncates mid-phrase, so a long label reliably left keys like
// "..._to_be_defined_to". Stripping runs again AFTER the cap for exactly that.
const TRAILING_STOP = new Set([
  // en
  "a", "an", "the", "to", "be", "is", "are", "of", "for", "and", "or", "with",
  "in", "on", "at", "by", "from",
  // tr
  "nedir", "midir", "mudur", "mi", "mu", "ve", "ile",
  // de
  "und", "oder", "mit", "von", "fur", "ist",
]);
const MAX_KEY_WORD_LENGTH = 40;

// Turkish-fold and snake-case, no length cap. The uncapped middle step both
// public functions build on.
function foldKey(raw: string): string {
  return raw
    .replace(/[çÇ]/g, "c").replace(/[ğĞ]/g, "g").replace(/[ıİ]/g, "i")
    .replace(/[öÖ]/g, "o").replace(/[şŞ]/g, "s").replace(/[üÜ]/g, "u")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Key shape WITHOUT the stop-word stripping: the rule for a key the owner
// typed themselves. Every word they chose is kept.
export function normaliseKey(raw: string): string {
  return foldKey(raw).slice(0, 64);
}

// Identity and compliance columns the voice pipeline refuses to write; a
// custom field must not shadow them either. One list, shared with the
// runtime's write gate in retell.ts.
export const RESERVED_CONTACT_KEYS = new Set([
  "firstname",
  "first_name",
  "lastname",
  "last_name",
  "phone",
  "phonenumber",
  "phone_number",
  "email",
  "consent",
  "consentat",
  "consent_at",
]);

export function keyFromLabel(raw: string): string {
  // foldKey, not normaliseKey: a 64-char cap applied to the whole question
  // would truncate the words the stop-word strip was about to keep.
  const words = foldKey(raw).split("_").filter(Boolean);
  let start = 0;
  let end = words.length;
  while (start < end - 1 && LEADING_STOP.has(words[start])) start += 1;
  while (end - 1 > start && TRAILING_STOP.has(words[end - 1])) end -= 1;
  const kept = words.slice(start, end);
  const parts: string[] = [];
  for (const word of kept) {
    if (parts.length > 0 && parts.join("_").length + 1 + word.length > MAX_KEY_WORD_LENGTH) break;
    parts.push(word);
  }
  // Again, because the cap cuts mid-phrase and the first pass could only see
  // the end of the WHOLE label. "…to be defined to be a great service" capped
  // to "…_to_be_defined_to_be_a"; this is what takes it back to a real word.
  // Never down to nothing: a label made entirely of stop words still needs an
  // address, and the caller's fallback is a positional key, not silence.
  while (parts.length > 1 && TRAILING_STOP.has(parts[parts.length - 1])) parts.pop();
  return parts.join("_").slice(0, 64);
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
