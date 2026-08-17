// Where a reply stops being new and starts being the conversation so far.
//
// A mail client does not send what somebody typed. It sends what they typed
// PLUS the whole thread quoted underneath, and every client marks the boundary
// its own way. Gmail hides that behind its "···"; we render bubbles, and a
// bubble shows its whole body, so without this the third message in a thread
// contains the first two inside it and a four-mail exchange renders as ten.
//
// NOTHING IS STRIPPED AT INGEST. The full mail is stored exactly as it arrived
// and the split happens at render, every time. That is deliberate: this is a
// pile of heuristics against a format nobody agrees on, and a heuristic that
// runs once against the database is a heuristic that can destroy a mail. One
// that runs at render is a display bug you fix by editing this file.

export type SplitBody = {
  // What this person actually wrote.
  visible: string;
  // The quoted history, "" when there is none. Goes behind a disclosure.
  quoted: string;
};

// Tag markers, in no particular order — the EARLIEST match in the document
// wins, because a thread quoted by two different clients carries two markers
// and the outer one is the real boundary.
//
// Every major client wraps the quote in a blockquote or a marked div, which is
// why HTML is matched on structure and never on the "On … wrote:" sentence:
// that line arrives split across tags, localised, and formatted, and a regex
// tolerant enough to catch it is tolerant enough to cut a mail in half at the
// word "on".
const HTML_MARKERS: RegExp[] = [
  // Gmail. The div wraps attribution + blockquote in newer versions; the
  // blockquote alone is what older ones send.
  /<div[^>]*class="[^"]*gmail_quote/i,
  /<blockquote[^>]*class="[^"]*gmail_quote/i,
  // Outlook web and desktop.
  /<div[^>]*id="?divRplyFwdMsg/i,
  /<div[^>]*id="?appendonsend/i,
  // Thunderbird.
  /<div[^>]*class="[^"]*moz-cite-prefix/i,
  // Apple Mail, and the generic "this is a quote" blockquote.
  /<blockquote[^>]*type="?cite/i,
  // The oldest convention, still emitted by Outlook in plain-ish HTML.
  /-{2,}\s*(Original Message|Ursprüngliche Nachricht|Orijinal Mesaj|Forwarded message)\s*-{2,}/i,
];

// Plain text has no structure to match, so here the attribution sentence IS the
// signal — along with the > prefix every client falls back to.
const TEXT_MARKERS: RegExp[] = [
  /^-{2,}\s*(Original Message|Ursprüngliche Nachricht|Orijinal Mesaj|Forwarded message)\s*-{2,}/im,
  // "On Mon, 17 Aug 2026 at 19:02, Barber <x@y.com> wrote:" and its German
  // twin. The languages disagree about word order — English ends on the verb,
  // German puts the name after it ("Am 17.08.2026 um 19:02 schrieb Barber:") —
  // so the verb cannot be required to sit against the colon. What holds both
  // together is the shape: starts the line, ends the line on a colon, and has
  // the verb somewhere between. That is still tight enough that "On the phone
  // you said Saturday works." cannot trigger it, because it has no trailing
  // colon.
  /^\s*(On|Am)\b.{0,200}?\b(wrote|schrieb)\b[^\n:]{0,80}:\s*$/im,
  // Turkish puts the verb last and the date first: "17 Ağu 2026 Pzt, 19:02
  // tarihinde Barber <x@y.com> şunu yazdı:"
  /^\s*.{0,200}?\btarihinde\b.{0,200}?\byazdı\s*:\s*$/im,
  // A run of quoted lines. Requires the > to open a LINE — a > mid-sentence is
  // somebody typing an arrow.
  /^\s*>/m,
];

function earliestMatch(source: string, markers: RegExp[]): number {
  let at = -1;
  for (const marker of markers) {
    const found = source.search(marker);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  return at;
}

// Text with the tags taken out, for the "did this actually leave anything
// behind" check below. Not exported: callers that want readable text have
// htmlToText in lib/emailInbound.
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export function splitQuotedHtml(html: string): SplitBody {
  const at = earliestMatch(html, HTML_MARKERS);
  if (at === -1) return { visible: html, quoted: "" };
  // Cut at the tag that opens the quote, not at the marker inside it, or the
  // visible half keeps a dangling "<div class=" and the quoted half opens
  // mid-attribute.
  const cut = html.lastIndexOf("<", at) === -1 ? at : html.lastIndexOf("<", at);
  const visible = html.slice(0, cut);
  // The guard that makes a wrong heuristic harmless: if cutting left nothing
  // to read, the marker was not a boundary — a top-posted reply whose author
  // wrote nothing above the quote, or a match inside the first tag. Show the
  // whole mail rather than an empty bubble.
  if (!stripTags(visible)) return { visible: html, quoted: "" };
  // Unbalanced tags are expected here and are not a problem: both halves go
  // through sanitizeEmailHtml before they render, and DOMPurify closes what
  // the cut left open.
  return { visible, quoted: html.slice(cut) };
}

export function splitQuotedText(text: string): SplitBody {
  const at = earliestMatch(text, TEXT_MARKERS);
  if (at === -1) return { visible: text, quoted: "" };
  const visible = text.slice(0, at);
  if (!visible.trim()) return { visible: text, quoted: "" };
  // `visible + quoted === input`, always, in both directions. The blank line
  // between a reply and its quote is left on the visible half rather than
  // trimmed off: the contract that nothing is LOST is what makes a heuristic
  // this fuzzy safe to run, and it is only worth having if it is exact.
  // Trimming for display is the renderer's business.
  return { visible, quoted: text.slice(at) };
}

// What a one-line preview should say: the new content, never the thread it
// quotes. An index row reading "On Mon 17 Aug, Barber wrote:" describes the
// mail before this one.
export function quoteFreeSnippet(body: string): string {
  return splitQuotedText(body).visible.replace(/\s+/g, " ").trim();
}
