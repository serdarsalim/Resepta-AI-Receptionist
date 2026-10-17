// What a pasted Resepta link shows before anyone opens it (P27, ported from
// Nudge fbeae989). The words for the Open Graph tags and for the generated
// card, in the page's own language. Pure: the metadata (lib/linkPreviewServer)
// and the card route (app/book/[slug]/og.png) build from the same model, so
// the title in the chat and the words on the picture never disagree.
//
// Two shapes:
// - The BOOKING page (/book/<slug>): the business, what it offers and for
//   how long, and where it is. All of it is already public on the page.
// - The MANAGE page (/appt/<token>): the business and a neutral line, never
//   the customer, the service or the time. The link is a bearer capability
//   that gets forwarded, and its preview is read by whoever it lands with;
//   its picture is drawn under the business's slug so the token never rides
//   the image address.

import { createTranslator, isLanguage, DEFAULT_LANGUAGE, type Language } from "@/lib/i18n";

export type BookPreviewInput = {
  orgName: string;
  logoUrl: string | null;
  language: string;
  services: { name: string; durationMinutes?: number }[];
  address: string | null;
};

export type ApptPreviewInput = {
  orgName: string;
  logoUrl: string | null;
  language: string;
};

export type PreviewModel = {
  // og:title / twitter:title. The browser tab keeps the business's name alone.
  title: string;
  // og:description / description.
  description: string;
  siteName: string;
  language: Language;
  // The picture: the business's logo (or its initials), its name, a line
  // saying what this link is, an optional detail and an optional footnote.
  card: {
    heading: string;
    line: string;
    detail: string | null;
    footnote: string | null;
    initials: string;
    logoUrl: string | null;
  };
};

const join = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" · ");

function languageOf(code: string): Language {
  return isLanguage(code) ? code : DEFAULT_LANGUAGE;
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1);
  return letters.map((w) => [...w][0] ?? "").join("").toLocaleUpperCase() || "?";
}

/** "Haircut, beard and colour", or "8 services" past three. */
function servicesText(language: Language, services: BookPreviewInput["services"]): string | null {
  if (services.length === 0) return null;
  const t = createTranslator(language);
  if (services.length > 3) return t.plural("linkPreview.services", services.length);
  return new Intl.ListFormat(language, { type: "conjunction" }).format(services.map((s) => s.name));
}

/** "30 minutes", "15 to 60 minutes". Goods (no length) say nothing here. */
function lengthsText(language: Language, services: BookPreviewInput["services"]): string | null {
  const all = services
    .map((s) => s.durationMinutes)
    .filter((m): m is number => typeof m === "number" && Number.isFinite(m) && m > 0);
  if (all.length === 0) return null;
  const t = createTranslator(language);
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (min === max) return t.plural("linkPreview.minutes", min);
  const number = new Intl.NumberFormat(language);
  return t("linkPreview.minutesRange", { min: number.format(min), max: number.format(max) });
}

export function bookPreview(input: BookPreviewInput): PreviewModel {
  const language = languageOf(input.language);
  const t = createTranslator(language);
  const offer = [servicesText(language, input.services), lengthsText(language, input.services)]
    .filter(Boolean)
    .join(", ");
  return {
    title: t("linkPreview.bookTitle", { business: input.orgName }),
    description: join(offer, input.address) || t("linkPreview.bookLine"),
    siteName: input.orgName,
    language,
    card: {
      heading: input.orgName,
      line: t("linkPreview.bookLine"),
      detail: offer || null,
      footnote: input.address,
      initials: initialsOf(input.orgName),
      logoUrl: input.logoUrl,
    },
  };
}

export function apptPreview(input: ApptPreviewInput): PreviewModel {
  const language = languageOf(input.language);
  const t = createTranslator(language);
  return {
    title: t("linkPreview.apptTitle", { business: input.orgName }),
    description: t("linkPreview.apptDescription"),
    siteName: input.orgName,
    language,
    card: {
      heading: input.orgName,
      line: t("linkPreview.apptLine"),
      detail: null,
      footnote: null,
      initials: initialsOf(input.orgName),
      logoUrl: input.logoUrl,
    },
  };
}

/** A short stable stamp of everything the picture shows: it rides the image
 *  address, so a renamed business, a new logo or a changed list is a new
 *  address, and a chat app that cached the old picture fetches the new one.
 *  FNV-1a. */
export function cardVersion(model: PreviewModel): string {
  const text = JSON.stringify(model.card);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
