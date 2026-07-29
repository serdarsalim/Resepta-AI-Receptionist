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

// A date with no time on it, for facts that are day-level however precisely
// they were recorded. Deliberately day/short-month/year ("20 Jul 2026") rather
// than a numeric date, because 07/08 is two different days depending on who is
// reading it and this app ships in three languages.
export function formatDay(ms: number, language: Language, timezone?: string): string {
  return new Intl.DateTimeFormat(LOCALE[language], {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
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

// Compact age for table cells, Nudge's timeAgo with the units localised and
// the "ago" dropped: in a column headed "Added", the word is already implied.
//
// Nudge could hardcode "3d" because Nudge is English-only. Turkish is this
// app's default language and "d" is not a Turkish abbreviation of anything —
// gün shortens to g, saat to sa, hafta to hf. Same reason formatReminderOffset
// below branches per language instead of templating at the call site.
//
// Nudge stops at days, so a lead added last spring reads "412d". A customer
// list only accumulates, so this carries on through weeks, months and years.
const AGE_UNITS: Record<
  Language,
  { now: string; min: string; hour: string; day: string; week: string; month: string; year: string }
> = {
  tr: { now: "şimdi", min: "dk", hour: "sa", day: "g", week: "hf", month: "ay", year: "y" },
  en: { now: "now", min: "min", hour: "h", day: "d", week: "w", month: "mo", year: "y" },
  de: { now: "jetzt", min: "Min", hour: "Std", day: "T", week: "W", month: "Mon", year: "J" },
};

export function formatAge(ms: number, language: Language): string {
  const unit = AGE_UNITS[language];
  // Clamped at zero: clock skew between the client and Convex can date a row
  // a few seconds into the future, and "-1dk" is a bug report waiting to
  // happen. Everything this formats is in the past by nature.
  const elapsed = Math.max(0, Date.now() - ms);
  if (elapsed < 60_000) return unit.now;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}${unit.min}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${unit.hour}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}${unit.day}`;
  // Weeks run to 4, then months to 12, then years. Handing off on the calendar
  // month (30d) rather than 4 weeks keeps "1ay" from arriving before "4hf".
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks}${unit.week}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}${unit.month}`;
  return `${Math.floor(days / 365)}${unit.year}`;
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
