// The booking page inside a business's own website (P29, Nudge c7459ed2).
// The CONTRACT the website relies on lives here, one copy:
//
//   /book/<slug>/embed[?lang=xx]
//     the booking page as it is on its own, on the one route next.config.ts
//     lets any site frame; lang=xx (tr, en, de) is the page's language over
//     the business's own
//
//   messages to window.parent (postMessage, target "*"):
//     { type: "resepta:ready" }                                  once, on load
//     { type: "resepta:booked", start, end, durationMinutes, order }
//
// A booked message carries NO name, phone, email or note: any site can frame
// a business's page, so whatever the message says, that site learns. Times are
// epoch milliseconds; `order` is true for a goods order (no length).
// public/embed.js is the loader that speaks the other side of this.

import { isLanguage, type Language } from "./i18n";

export const EMBED_MESSAGES = {
  ready: "resepta:ready",
  booked: "resepta:booked",
} as const;

/** "tr", "TR", "tr-TR", "tr_TR" → "tr"; a language the app does not ship,
 *  or nothing, → null (the page keeps the business's own). */
export function languageFromParam(raw: string | string[] | null | undefined): Language | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const code = (first ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return isLanguage(code) ? code : null;
}

/** The booked message, built from exactly these fields and nothing else. */
export function bookedMessage(a: {
  start: number;
  durationMinutes: number;
  order: boolean;
}): { type: typeof EMBED_MESSAGES.booked; start: number; end: number; durationMinutes: number; order: boolean } {
  return {
    type: EMBED_MESSAGES.booked,
    start: a.start,
    end: a.start + a.durationMinutes * 60_000,
    durationMinutes: a.durationMinutes,
    order: a.order,
  };
}

/** Tell the embedding page something, when there is one. */
export function postToParent(message: { type: string } & Record<string, unknown>): void {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(message, "*");
}

/** The code a website pastes: the div names the booking page, the script
 *  (served from the same origin) turns it into the frame. */
export function embedSnippet(pageUrl: string): string {
  const origin = new URL(pageUrl).origin;
  const attr = pageUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<div data-resepta-booking="${attr}"></div>\n<script src="${origin}/embed.js" async></script>`;
}
