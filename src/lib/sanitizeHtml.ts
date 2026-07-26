import DOMPurify from "isomorphic-dompurify";

// Inbound email HTML, made safe to render.
//
// This is FULLY attacker-controlled input, which is a stronger threat than the
// one Nudge's equivalent guards: there the HTML is our own editor's output
// with contact fields substituted in, whereas here anyone in the world can
// email the salon and choose every byte. A stylist opening their inbox must
// not be able to lose their session to a message.
//
// A library, not a regex. HTML sanitising has a long history of clever
// bypasses — mXSS via mutation, namespace confusion in SVG and MathML,
// attribute smuggling — and a hand-rolled stripper is a vulnerability with a
// comment above it saying it isn't.

// Beyond DOMPurify's html profile: an email has no business embedding a page,
// running a form, or loading a plugin, and every one of those is a route to
// something we do not want inside the app's own origin.
const FORBID_TAGS = ["iframe", "object", "embed", "form", "input", "button", "base"];

export function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html ?? "", {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    // Legitimate mail is full of inline style, and stripping it turns a
    // designed newsletter into a column of naked text. DOMPurify already
    // removes the dangerous parts of a style attribute.
    ALLOWED_ATTR: undefined,
  });
}

// Links inside a customer's email open in a new tab, and never hand the
// destination our referrer or a window handle back into this page. Done as a
// DOM pass after sanitising rather than a string replace, because rewriting
// attributes with a regex is the same mistake as sanitising with one.
export function hardenEmailLinks(root: HTMLElement | null): void {
  if (!root) return;
  for (const anchor of Array.from(root.querySelectorAll("a"))) {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer nofollow");
  }
}
