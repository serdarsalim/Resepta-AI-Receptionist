// A note's body is one string column, and it holds either plain text or the
// rich editor's markup. There is no flag saying which, deliberately.
//
// Lives in convex/lib so the SERVER and the client share one answer — the same
// arrangement lib/emailInbound already has with normalizeSubject. The mutation
// rejecting an empty note and the button that stays disabled have to agree
// about what "empty" means, and two copies of this file would eventually not.
//
// Nudge shipped a flag and it became a lie the first time somebody edited an
// old plain note in the rich editor: the row then stored markup while the
// column still said "plain", and the note rendered its own tags as literal
// text. A flag records where a note CAME FROM. What matters at render time is
// what it IS, and the body already knows.

// Requires a real tag NAME, not just angle brackets, so a note that reads
// "bütçe < 5000 TL" stays the plain text somebody typed rather than being
// handed to a HTML renderer that will eat the rest of the line.
const TAG = /<(p|div|br|ul|ol|li|strong|b|em|i|u|s|a|h[1-6]|span|blockquote|table|tr|td|th|img)\b[^>]*>/i;

export function bodyIsHtml(body: string): boolean {
  return TAG.test(body);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Plain text on its way INTO the editor. Blank lines become paragraphs and
// single newlines become breaks, so a legacy note keeps the shape it was
// written in instead of collapsing to one run-on paragraph the moment somebody
// opens it. Nothing stored is migrated — this runs at edit time.
export function plainToHtml(plain: string): string {
  const paragraphs = plain.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return "";
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// The words, whatever the body is made of. An index, a one-line preview and
// anything that ever searches notes want text — a row that prints "<p>Amonyak"
// is worse than useless.
export function noteText(body: string): string {
  if (!bodyIsHtml(body)) return body;
  return body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Did somebody actually WRITE something? An empty tiptap document serialises to
// "<p></p>" and a paragraph of non-breaking spaces is emptier still, so a
// non-empty string is not the question. Shared by every Save/Add button that
// gates on the editor.
export function hasNoteText(body: string): boolean {
  return noteText(body).replace(/\s| /g, "") !== "";
}
