// The two projections of one authored email, shared by every editor that
// hosts the WYSIWYG (the salon's rule editor, the platform's fleet desk).
// plainToHtml lifts a plain-text body into the editor; htmlToText derives the
// plain text the session/WhatsApp path sends from whatever the editor holds.
// Deriving on SAVE — not at send time — keeps the backend blind to HTML
// parsing. Lived inside RemindersView until the fleet desk needed the same
// split (2026-08-28).

export function plainToHtml(text: string): string {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

export function htmlToText(html: string): string {
  const prepared = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ");
  // SSR guard: this only runs for real in the browser; the server render just
  // needs to not crash before hydration.
  if (typeof window === "undefined") {
    return prepared
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  const doc = new DOMParser().parseFromString(prepared, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}
