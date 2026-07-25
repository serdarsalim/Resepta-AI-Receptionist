import type { Language } from "./i18n";

const LOCALE: Record<Language, string> = {
  tr: "tr-TR",
  en: "en-GB",
  de: "de-DE",
};

// One place resolves a UI language to an Intl locale. Call sites that build
// their own Intl.DateTimeFormat (the calendar's weekday strip, for one) ask
// here instead of branching on the language code, so a fourth language is a
// line in the record above and nothing else.
export function localeFor(language: Language): string {
  return LOCALE[language];
}

export function formatDateTime(ms: number, language: Language, timezone?: string): string {
  return new Intl.DateTimeFormat(LOCALE[language], {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function formatTime(ms: number, language: Language, timezone?: string): string {
  return new Intl.DateTimeFormat(LOCALE[language], {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function formatDayHeading(ms: number, language: Language, timezone?: string): string {
  return new Intl.DateTimeFormat(LOCALE[language], {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(ms));
}

// Reminder offsets are stored as hours and read as human language: a salon
// owner taps "1 gün önce", never "24". Largest unit that divides evenly, per
// the house rule, and the plural suffix differs per language (Tag/Tage,
// Stunde/Stunden), which is why this is not a template string at the call
// site.
export function formatReminderOffset(hours: number, language: Language): string {
  const inDays = hours % 24 === 0;
  const n = inDays ? hours / 24 : hours;
  const plural = n > 1;
  if (language === "tr") return inDays ? `${n} gün önce` : `${n} saat önce`;
  if (language === "de") {
    return inDays
      ? `${n} Tag${plural ? "e" : ""} vorher`
      : `${n} Stunde${plural ? "n" : ""} vorher`;
  }
  return inDays
    ? `${n} day${plural ? "s" : ""} before`
    : `${n} hour${plural ? "s" : ""} before`;
}

// <input type="datetime-local"> works in local wall-clock strings; these two
// convert against the BROWSER's zone (the staff member's own), which is the
// right frame for someone typing a booking at the salon.
export function toDatetimeLocalValue(ms: number): string {
  const date = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}

export function fromDatetimeLocalValue(value: string): number {
  return new Date(value).getTime();
}
