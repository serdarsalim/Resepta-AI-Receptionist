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

// ── The agent-facing description of open hours ──────────────────────────────
// Shared by the voice tool endpoint (convex/http.ts) and the chat agent
// (convex/chatAgent.ts): one wording of "when may an agent offer a slot", so
// the two agents can never disagree about the doors. English on purpose —
// this goes to a model, not a person, and the model answers in the
// customer's language.
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Concrete times to OFFER, computed here so the choice is deterministic code
// rather than model judgment. On a live call (Bella, 20 Aug 2026) an empty
// Friday came back as booked_slots: [] and the agent, handed only the hours,
// recited "dokuzdan altıya açığız" and asked the caller to pick — the one
// move a receptionist never makes. The note field only covered the
// slots-taken case; this covers the other one, for every tenant at once.
//
// Returns UTC ms starts, spread across the open window (first free, middle,
// last) rather than the first three — 09:00/09:30/10:00 is a morning, not a
// choice. Empty when the org has no clock bounds to suggest from, when the
// day is a closed day, or when nothing is free: the callers of this keep
// their existing wording for those cases.
export function suggestFreeSlots(args: {
  dayIso: string;
  tz: string;
  hours: ActiveWindow | null | undefined;
  // FULL blocks (capacity exhausted), not merely booked ones — same contract
  // as retell.bookedBetween.
  full: { startAt: number; durationMinutes: number | null }[];
  nowMs: number;
}): number[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(args.dayIso);
  const hours = args.hours;
  if (!match || !hours || hours.startMinute == null || hours.endMinute == null) {
    return [];
  }
  const [, y, m, d] = match;
  const weekday = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay();
  if (hours.activeDays && hours.activeDays.length > 0 && !hours.activeDays.includes(weekday)) {
    return [];
  }
  const slotMs = 30 * 60_000;
  // A slot starting in five minutes is not an offer anyone can accept.
  const earliest = args.nowMs + 15 * 60_000;
  const free: number[] = [];
  for (let minute = hours.startMinute; minute + 30 <= hours.endMinute; minute += 30) {
    let startMs: number;
    try {
      startMs = localWallTimeToUtcMs(
        Number(y),
        Number(m) - 1,
        Number(d),
        Math.floor(minute / 60),
        minute % 60,
        args.tz,
      );
    } catch {
      return [];
    }
    if (startMs < earliest) continue;
    const clashes = args.full.some((block) => {
      const blockEnd = block.startAt + (block.durationMinutes ?? 30) * 60_000;
      return startMs < blockEnd && startMs + slotMs > block.startAt;
    });
    if (!clashes) free.push(startMs);
  }
  if (free.length <= 3) return free;
  return [free[0], free[Math.floor((free.length - 1) / 2)], free[free.length - 1]];
}

export function openHoursForAgent(
  hours:
    | { activeDays?: number[]; startMinute?: number; endMinute?: number }
    | null
    | undefined,
): { open_hours?: string; closed_days?: string[] } {
  if (!hours) return {};
  const asClock = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const out: { open_hours?: string; closed_days?: string[] } = {};
  if (hours.startMinute !== undefined && hours.endMinute !== undefined) {
    out.open_hours = `${asClock(hours.startMinute)}-${asClock(hours.endMinute)}`;
  }
  // Empty or absent activeDays means open every day (the schema's rule), so
  // only a non-empty list closes anything. The agent needs the COMPLEMENT —
  // the days it must not offer — because "we are open Mon-Sat" is a fact it
  // has to invert under time pressure, and inverting it is how Sunday gets
  // offered.
  const days = hours.activeDays;
  if (days && days.length > 0) {
    const closed = WEEKDAY_NAMES.filter((_, day) => !days.includes(day));
    if (closed.length > 0) out.closed_days = closed;
  }
  return out;
}
