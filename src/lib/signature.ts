// Putting an email signature at the foot of a body, and swapping it for
// another (P28, Nudge's lib/signature). Browser-only where it matters: the
// swap reads the body through DOMParser.

// A rough plain-text of an HTML fragment, for "does the body already end with
// this signature?" checks. Not for display: a comparison key that survives the
// editor re-serialising attributes and tags.
export function signatureText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const SEP = "<p></p>";

// Appends `signature` unless the body already holds it (by text). ONE empty
// line above it, written or not: on an empty body that is the line you type
// on, so the signature never sits at the very top where your first click
// lands inside it. Blank lines the signature itself starts with go, or "one
// line" reads as four.
export function appendSignature(body: string, signature: string | undefined): string {
  const sig = (signature ?? "").trim();
  if (!sig) return body;
  const sigText = signatureText(sig);
  if (!sigText || signatureText(body).includes(sigText)) return body;
  const lead = /^(?:\s*<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>|\s*<br\s*\/?>)+/i;
  return body + SEP + sig.replace(lead, "");
}

// Removes whichever candidate signature ENDS the body, matched by its TEXT,
// with the blank lines above it. By text because the body has been through
// the editor, which re-serialises it, so the signature put in is never
// byte-for-byte at the tail again. Null when none ends it, which includes
// text typed BELOW the signature: that is left alone, a duplicate beats eaten
// words.
function stripTailSignature(body: string, candidates: (string | undefined)[]): string | null {
  if (typeof DOMParser === "undefined") return null;
  const texts = candidates.map((c) => signatureText(c ?? "")).filter(Boolean);
  if (!texts.length) return null;
  const longest = Math.max(...texts.map((x) => x.length));
  const doc = new DOMParser().parseFromString(`<body>${body}</body>`, "text/html");
  const kids = Array.from(doc.body.childNodes);
  const html = (n: ChildNode) =>
    n.nodeType === 1 ? (n as Element).outerHTML : (n.textContent ?? "");
  const blank = (n: ChildNode) =>
    !(n.textContent ?? "").trim() && !(n.nodeType === 1 && (n as Element).querySelector("img"));
  for (let i = kids.length - 1; i >= 0; i--) {
    const tail = signatureText(kids.slice(i).map(html).join(""));
    if (texts.includes(tail) && !blank(kids[i])) {
      let j = i;
      while (j > 0 && blank(kids[j - 1])) j--;
      return kids.slice(0, j).map(html).join("");
    }
    if (tail.length > longest) break;
  }
  return null;
}

// Whichever known signature ends the body goes, and `next` takes its place.
// Callers pass every signature the person could have used as candidates, so
// picking another from the menu replaces the old one instead of stacking.
export function swapSignature(
  body: string,
  candidates: (string | undefined)[],
  next: string | undefined,
): string {
  const stripped = stripTailSignature(body, candidates);
  return appendSignature(stripped ?? body, next);
}
