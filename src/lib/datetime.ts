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

// Localized weekday names, index 0 = Sunday, matching the JS getDay()
// convention that orgs.businessHours.activeDays uses. Read from Intl rather
// than added as 21 dictionary keys: the names are already in every locale, and
// a new UI language should not require someone to type "Çarşamba".
export function weekdayNames(language: Language): string[] {
  const fmt = new Intl.DateTimeFormat(LOCALE[language], {
    weekday: "short",
    timeZone: "UTC",
  });
  // 2024-01-07 was a Sunday; walking seven days from it lands index 0 on Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(Date.UTC(2024, 0, 7 + i))),
  );
}

// Minutes-from-midnight <-> the "HH:MM" that <input type="time"> speaks.
export function minutesToTimeValue(minutes: number): string {
  const clamped = Math.min(24 * 60 - 1, Math.max(0, Math.round(minutes)));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

// Undefined for a cleared input, which is how "no bound" reaches the backend.
export function timeValueToMinutes(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : undefined;
}
