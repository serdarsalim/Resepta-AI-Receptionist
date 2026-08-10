// Local wall-clock math in an org's timezone. THE one place in this codebase
// that converts between UTC ms and somebody's local day — ported from Nudge
// (convex/lib/businessHours.ts) by copy, per the AGENTS.md rule, because three
// separate implementations had already appeared here: hourInZone in
// reminders.ts, zoneOffsetMs/localDayRangeUtc in lib/format.ts, and this. Add
// callers, not more copies.
//
// Nudge's clampToWindow is deliberately NOT ported. It rolls a scheduled send
// forward to the next open moment, which Resepta's reminder tick does not need:
// a reminder held by the send window simply stays unstamped and the next tick
// picks it up. Port it the day something actually schedules forward.
//
// Two vocabularies live here and they are not the same thing:
//   - business hours: when the salon is OPEN. Drives the WhatsApp away-reply.
//   - quiet hours (orgs.quietHoursStart/End): when it is polite to message a
//     CUSTOMER. Drives reminder dispatch. A salon closed on Monday still wants
//     Monday's reminders going out for Tuesday's appointments.

export interface ActiveWindow {
  // 0=Sunday .. 6=Saturday. Undefined or empty => every day is active.
  activeDays?: number[];
  // Minutes from local midnight. Undefined => no lower / upper bound.
  startMinute?: number;
  endMinute?: number;
}

// Compute the UTC ms for a given local wall time in `tz`. Resolves DST
// boundaries by sampling the offset at the first guess and refining once —
// which is why this replaced the measure-at-noon approximation that used to
// live in format.ts and was an hour out on transition days.
export function localWallTimeToUtcMs(
  year: number,
  month0: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): number {
  const sampleOffset = (utcMs: number): number => {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
    const asIfUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return asIfUtc - utcMs;
  };
  const guess = Date.UTC(year, month0, day, hour, minute, 0);
  const offset1 = sampleOffset(guess);
  const candidate = guess - offset1;
  const offset2 = sampleOffset(candidate);
  return offset1 === offset2 ? candidate : guess - offset2;
}

export interface LocalParts {
  y: number;
  m0: number;
  d: number;
  weekday: number; // 0=Sun..6=Sat
  hour: number; // 0-23
  minutesOfDay: number;
}

// Break `utcMs` into local calendar fields + minutes-since-midnight.
export function getLocalParts(utcMs: number, tz: string): LocalParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const y = Number(parts.year);
  const m0 = Number(parts.month) - 1;
  const d = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  // The weekday of this local calendar date — independent of tz once we have
  // y/m0/d, since Date.UTC builds the same civil date.
  const weekday = new Date(Date.UTC(y, m0, d)).getUTCDay();
  return { y, m0, d, weekday, hour, minutesOfDay: hour * 60 + minute };
}

// Same shape as getLocalParts but never throws on a bad IANA zone — the value
// callers reach for when a malformed org.timezone must not kill a cron tick.
export function getLocalPartsSafe(utcMs: number, tz: string | undefined): LocalParts {
  try {
    return getLocalParts(utcMs, tz || "UTC");
  } catch {
    return getLocalParts(utcMs, "UTC");
  }
}

// Is `utcMs` inside the window? Any unset field is unrestricted, so an org with
// no configuration is always "within". Callers that need the opposite default
// (the away-reply, which must not fire when nobody has said when the salon is
// open) check for configuration themselves — see hasBusinessHours.
export function isWithinActiveWindow(
  utcMs: number,
  tz: string | undefined,
  w: ActiveWindow,
): boolean {
  const p = getLocalPartsSafe(utcMs, tz);
  if (w.activeDays && w.activeDays.length > 0 && !w.activeDays.includes(p.weekday)) {
    return false;
  }
  if (w.startMinute != null && p.minutesOfDay < w.startMinute) return false;
  if (w.endMinute != null && p.minutesOfDay >= w.endMinute) return false;
  return true;
}

// Deliberately NO default hours. Nudge defaults to Mon–Fri 09:00–18:00, which
// is wrong for this product: Turkish barbers routinely open Saturday and close
// Monday, so a default would send "we're closed" on the salon's busiest day.
// An org that has not configured hours gets no away-reply at all — silence
// beats a confidently wrong message.
export function hasBusinessHours(w: ActiveWindow): boolean {
  return (
    (w.activeDays != null && w.activeDays.length > 0) ||
    w.startMinute != null ||
    w.endMinute != null
  );
}

// UTC ms bounds of one local calendar day. cal.com's /slots takes absolute
// times, so asking for `${day}T00:00:00Z` would request the UTC day — a window
// offset from the salon's day by its own UTC offset, three hours for
// Europe/Istanbul, straddling two local dates.
export function localDayRangeUtc(
  dayIso: string,
  tz: string,
): { startIso: string; endIso: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayIso);
  if (!match) {
    return { startIso: `${dayIso}T00:00:00Z`, endIso: `${dayIso}T23:59:59Z` };
  }
  const [, y, m, d] = match;
  try {
    const startMs = localWallTimeToUtcMs(
      Number(y),
      Number(m) - 1,
      Number(d),
      0,
      0,
      tz,
    );
    // The end is the NEXT local midnight, not start + 24h: a DST spring-forward
    // day is 23 hours long and a fall-back day is 25, so a fixed 24 overshoots
    // into the next day or stops an hour short of this one.
    const nextCivil = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + 1));
    const nextMidnightMs = localWallTimeToUtcMs(
      nextCivil.getUTCFullYear(),
      nextCivil.getUTCMonth(),
      nextCivil.getUTCDate(),
      0,
      0,
      tz,
    );
    return {
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(nextMidnightMs - 1000).toISOString(),
    };
  } catch {
    return { startIso: `${dayIso}T00:00:00Z`, endIso: `${dayIso}T23:59:59Z` };
  }
}

// Today's calendar date in `tz`, as YYYY-MM-DD. `toISOString().slice(0, 10)` is
// the UTC date, which is yesterday in Istanbul between 00:00 and 03:00.
export function todayInZone(tz: string): string {
  const p = getLocalPartsSafe(Date.now(), tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m0 + 1)}-${pad(p.d)}`;
}

// A start time from the voice agent, read as WALL TIME AT THE BUSINESS.
//
// "2026-08-04T17:00:00" is what a model writes down when a caller says five
// o'clock, and Date.parse reads a string with no zone on it as UTC — which is
// 19:00 in Vienna and 20:00 in Istanbul. The salon then has a booking nobody
// agreed to at a time the caller was read back correctly on the phone.
//
// A string that DOES carry a zone (trailing Z, or ±HH:MM) is already an
// instant and is trusted as one. Returns NaN for anything unparseable, so the
// caller keeps its own "ask again" path rather than getting a guess.
export function parseLocalStart(raw: string, tz: string): number {
  const text = raw.trim();
  if (!text) return Number.NaN;
  const zoneless = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(
    text,
  );
  if (!zoneless) return Date.parse(text);
  const [, y, m, d, hour, minute] = zoneless;
  try {
    return localWallTimeToUtcMs(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hour),
      Number(minute),
      tz,
    );
  } catch {
    return Date.parse(`${text}Z`);
  }
}
