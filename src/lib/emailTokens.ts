// The boundary between the HTML we STORE and the HTML the email editor edits
// (P15, the Nudge port). A stored email body is HTML with `[business]`
// sitting in it as ordinary text: that is what the send path substitutes and
// what the HTML view shows. Inside the editor the same thing is an atomic
// node (VariableToken), so it reads as a chip and deletes as one unit.
//
// Both directions run at the editor's edge and nowhere else. Nothing
// downstream (the preview, the sanitizer, the send) ever sees a `data-token`
// span.

// A bracket with a space in it ("[see attached]") is prose and stays prose.
const TOKEN_TEXT = /\[([A-Za-z0-9_]{1,32})\]/g;

// Stored → editable. Only TEXT is rewritten: a `[…]` inside a tag is part of
// an attribute (a URL, a style) and turning it into a node would corrupt the
// markup rather than decorate it.
export function tokensToHtml(html: string): string {
  if (!html) return html;
  return html
    .split(/(<[^>]*>)/g)
    .map((seg) =>
      seg.startsWith("<")
        ? seg
        : seg.replace(TOKEN_TEXT, (m, key: string) => `<span data-token="${key}">${m}</span>`),
    )
    .join("");
}

// Editable → stored. Non-greedy to the first `</span>`, which is safe because
// the only thing producing these is VariableToken.renderHTML and its content
// is a bare string.
export function htmlToTokens(html: string): string {
  if (!html) return html;
  return html.replace(
    /<span[^>]*\sdata-token="([A-Za-z0-9_]{1,32})"[^>]*>.*?<\/span>/g,
    (_m, key: string) => `[${key}]`,
  );
}
