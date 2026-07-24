import type { Language } from "./i18n";

const LOCALE: Record<Language, string> = { tr: "tr-TR", en: "en-GB" };

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
