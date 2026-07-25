// Appointment date+time as it appears inside WhatsApp messages ({{3}} in the
// template convention). Formatted in the ORG's timezone and the message
// language — the customer reads "23 Temmuz Perşembe 14:30", never UTC ms.

const LOCALE_BY_LANGUAGE: Record<string, string> = {
  tr: "tr-TR",
  en: "en-GB",
  de: "de-DE",
};

export function formatAppointmentTime(
  startAt: number,
  timezone: string,
  language: string,
): string {
  const locale = LOCALE_BY_LANGUAGE[language] ?? language;
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(startAt));
  } catch {
    // Unknown zone/locale: an ISO stamp beats a crashed reminder send.
    return new Date(startAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
}

// How far ahead of UTC `timezone` runs at a given instant, DST included.
// Formatting the instant in the zone and re-reading it as if it were UTC gives
// the offset without a date library.
function zoneOffsetMs(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Some engines render midnight as hour 24; %24 keeps it at 0.
  const asIfUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour") % 24,
    part("minute"),
    part("second"),
  );
  return asIfUtc - instant;
}

// Today's calendar date in the org's timezone, as YYYY-MM-DD.
// `new Date().toISOString().slice(0, 10)` is the UTC date, which is yesterday
// for a salon in Istanbul between 00:00 and 03:00 local — the voice agent would
// default to the wrong day.
export function todayInZone(timezone: string): string {
  try {
    // en-CA renders YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// The UTC instant range covering one local calendar day in `timezone`.
// cal.com's /slots takes absolute times, so `${day}T00:00:00Z`–`T23:59:59Z`
// asks for the UTC day, a window offset from the salon's day by its own UTC
// offset — three hours for Europe/Istanbul. It therefore spans two local dates,
// and the flattened slot list can mix them.
export function localDayRangeUtc(
  dayIso: string,
  timezone: string,
): { startIso: string; endIso: string } {
  const utcMidnight = Date.parse(`${dayIso}T00:00:00Z`);
  if (Number.isNaN(utcMidnight)) {
    return { startIso: `${dayIso}T00:00:00Z`, endIso: `${dayIso}T23:59:59Z` };
  }
  try {
    // Resolve the offset at local noon, never at midnight: a DST jump lands on
    // midnight in some zones, and noon is never inside the skipped hour. The
    // cost is that on the two transition days the window shifts an hour at the
    // far end (local 23:00 or 01:00) — hours no salon is open.
    const offsetMs = zoneOffsetMs(utcMidnight + 12 * 60 * 60 * 1000, timezone);
    const startMs = utcMidnight - offsetMs;
    return {
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(startMs + 24 * 60 * 60 * 1000 - 1000).toISOString(),
    };
  } catch {
    return { startIso: `${dayIso}T00:00:00Z`, endIso: `${dayIso}T23:59:59Z` };
  }
}
