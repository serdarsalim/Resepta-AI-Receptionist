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

// One day's open window. Half-open [startMinute, endMinute), minutes from
// local midnight — the same convention isWithinActiveWindow has always used,
// so 18:00 is CLOSED at an 18:00 close.
export interface DayWindow {
  startMinute: number;
  endMinute: number;
}

export interface ActiveWindow {
  // ── LEGACY. Read only through windowForWeekday; never write these. ───────
  // 0=Sunday .. 6=Saturday. Undefined or empty => every day is active.
  activeDays?: number[];
  // Minutes from local midnight. Undefined => no lower / upper bound.
  startMinute?: number;
  endMinute?: number;
  // ── CURRENT. Seven entries, index 0=Sunday. null => closed that day. ─────
  days?: (DayWindow | null)[];
}

// A shut period inside opening hours: recurring weekly (`weekdays`) or a
// dated one-off (`date`). Both minute bounds unset means the whole day.
// Mirrors the `closures` table; kept structural rather than importing Doc so
// this module stays free of Convex imports — src/ imports it directly and a
// Convex import here drags the server graph into the browser bundle.
export interface Closure {
  weekdays?: number[];
  date?: string;
  startMinute?: number;
  endMinute?: number;
  reason?: string;
}

// THE normaliser. Folds the legacy single-window shape and the per-weekday
// shape into one answer so no caller has to know which one an org carries.
// Returns null for a CLOSED day.
//
// The two shapes disagree about what silence means, which is the entire
// hazard of this migration: legacy `activeDays: []` means open every day,
// while `days` missing an entry means that day is shut. Every such decision
// is made here, once.
export function windowForWeekday(
  w: ActiveWindow | null | undefined,
  weekday: number,
): DayWindow | null {
  if (!w) return null;
  // Non-empty only, matching hasBusinessHours: `days: []` is a half-finished
  // write, not a declaration that the business never opens, so it falls
  // through to whatever the legacy fields still say.
  if (w.days && w.days.length > 0) {
    // The array position IS the weekday. A short or ragged array (hand-written
    // fixture, interrupted migration) reads as closed on the days it does not
    // reach rather than falling back to the legacy fields for those days —
    // mixing the two shapes within one org is where a silent guess is worst.
    return w.days[weekday] ?? null;
  }
  if (w.activeDays && w.activeDays.length > 0 && !w.activeDays.includes(weekday)) {
    return null;
  }
  // Unset bounds stay unrestricted, preserving the legacy contract that an org
  // with no configuration is always "within" — hasBusinessHours, not this, is
  // what tells the away-reply and the booking page that nobody has said when
  // the salon is open.
  return {
    startMinute: w.startMinute ?? 0,
    endMinute: w.endMinute ?? 24 * 60,
  };
}

// The local civil date of `p`, as YYYY-MM-DD — the form `closures.date` is
// stored in.
export function isoDateOf(p: { y: number; m0: number; d: number }): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m0 + 1)}-${pad(p.d)}`;
}

// Does this closure say anything about this local day at all?
//
// A row with BOTH `date` and `weekdays`, or NEITHER, applies to no day. That
// is deliberate: an ambiguous row must not block a business's whole calendar,
// and a throw here would take down a cron tick over one bad document.
// Exported for the calendar, which pins an editable label chip on each
// closure's band and so needs the ROWS on a day, not just the merged ranges
// closuresOnDay answers with.
export function closureAppliesToDay(
  c: Closure,
  p: { y: number; m0: number; d: number; weekday: number },
): boolean {
  const dated = typeof c.date === "string" && c.date.length > 0;
  const recurring = Array.isArray(c.weekdays) && c.weekdays.length > 0;
  if (dated === recurring) return false;
  if (dated) return c.date === isoDateOf(p);
  return c.weekdays!.includes(p.weekday);
}

// The closures that say something about this local day, as plain minute
// ranges — what the calendar needs to CUT the day's open window into the
// segments it shades between. closureBlocks answers yes/no for one span; this
// hands back the spans themselves.
export function closuresOnDay(
  closures: Closure[] | null | undefined,
  p: { y: number; m0: number; d: number; weekday: number },
): { from: number; to: number; reason?: string }[] {
  if (!closures) return [];
  return closures
    .filter((c) => closureAppliesToDay(c, p))
    .map((c) => ({
      from: c.startMinute ?? 0,
      to: c.endMinute ?? 24 * 60,
      reason: c.reason,
    }))
    .sort((a, b) => a.from - b.from);
}

// Has the business STATED a clock, as opposed to merely not restricting one?
//
// windowForWeekday answers 00:00-24:00 for a legacy org with no bounds, and
// that is right for the gates asking "is this instant inside the window" — an
// unset bound restricts nothing. It is wrong for anything that QUOTES the
// window back: "we're open 00:00-24:00" is a sentence no business said, and
// times generated across it get read down a phone as real offers.
//
// A `days` entry always carries both bounds, so only legacy orgs can fail this.
export function hasClockBounds(w: ActiveWindow | null | undefined): boolean {
  if (!w) return false;
  if (w.days && w.days.length > 0) return true;
  return w.startMinute != null && w.endMinute != null;
}

// Does any closure block the local-day range [fromMinute, toMinute)? Returns
// the FIRST blocking row so callers can name it ("closed for Bayram"), or null.
//
// `toMinute` is exclusive, and a zero-length range (a good, which occupies
// nobody) is treated as the instant `fromMinute` — otherwise an order placed
// at exactly 13:00 would slip through a 13:00-14:00 lunch break on the
// strict-inequality test below.
export function closureBlocks(
  closures: Closure[] | null | undefined,
  p: { y: number; m0: number; d: number; weekday: number },
  fromMinute: number,
  toMinute: number,
): Closure | null {
  if (!closures || closures.length === 0) return null;
  const end = Math.max(toMinute, fromMinute + 1);
  for (const c of closures) {
    if (!closureAppliesToDay(c, p)) continue;
    const s = c.startMinute ?? 0;
    const e = c.endMinute ?? 24 * 60;
    if (fromMinute < e && end > s) return c;
  }
  return null;
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
// `closures` is optional so the six existing call sites compile unchanged; a
// caller that omits it gets opening-hours enforcement only. Every customer-
// facing path passes it. The argument is a plain array rather than a ctx
// because this module must stay import-free (see the Closure note above), so
// fetching the rows is the caller's job.
export function isWithinActiveWindow(
  utcMs: number,
  tz: string | undefined,
  w: ActiveWindow,
  closures?: Closure[] | null,
): boolean {
  const p = getLocalPartsSafe(utcMs, tz);
  const win = windowForWeekday(w, p.weekday);
  if (!win) return false;
  if (p.minutesOfDay < win.startMinute) return false;
  if (p.minutesOfDay >= win.endMinute) return false;
  if (closureBlocks(closures, p, p.minutesOfDay, p.minutesOfDay)) return false;
  return true;
}

// Deliberately NO default hours. Nudge defaults to Mon–Fri 09:00–18:00, which
// is wrong for this product: Turkish barbers routinely open Saturday and close
// Monday, so a default would send "we're closed" on the salon's busiest day.
// An org that has not configured hours gets no away-reply at all — silence
// beats a confidently wrong message.
//
// It MUST recognise the per-weekday shape. Callers split on this in opposite
// directions — booking.ts:fitsOpenHours refuses every booking when it is
// false, while the away-reply stays silent — so a stale implementation would
// take the public booking page down and mute the auto-reply at the same time,
// for every org, with no error anywhere.
//
// A `days` array counts as configured when ANY day carries a window. Seven
// nulls is a business that has said it is never open, which is answerable
// ("we're closed") and therefore configured; an empty or absent array is
// nobody having said anything, which is not.
export function hasBusinessHours(w: ActiveWindow): boolean {
  // Non-empty only. An org carrying `days: []` alongside legacy fields is a
  // half-finished write, and falling through to the legacy answer keeps it
  // working rather than declaring it unconfigured.
  if (w.days && w.days.length > 0) return true;
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
  // Recurring and dated closures for this org. Omitted means none — the same
  // permissive default isWithinActiveWindow takes, and for the same reason.
  closures?: Closure[] | null;
  nowMs: number;
}): number[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(args.dayIso);
  const hours = args.hours;
  if (!match || !hours) return [];
  const [, y, m, d] = match;
  const civil = { y: Number(y), m0: Number(m) - 1, d: Number(d) };
  const weekday = new Date(Date.UTC(civil.y, civil.m0, civil.d)).getUTCDay();
  // Both bounds come from the day's own window now, so a business open
  // 10:00-16:00 on Saturday stops being offered its weekday morning.
  const win = windowForWeekday(hours, weekday);
  if (!win) return [];
  // windowForWeekday's 00:00-24:00 means UNRESTRICTED, not open. That default
  // is load-bearing for the permissive gates (isWithinActiveWindow, and the
  // away-reply that leans on it), but this function does not gate anything —
  // it produces times an agent READS ALOUD as concrete offers. A legacy org
  // that picked its days and never typed a closing time has no bounds to
  // suggest from, and without this bail it gets offered a 23:30 haircut.
  //
  // Only legacy orgs can reach it: the `days` shape requires both bounds on
  // every entry, so a per-weekday org always has a real window.
  if (!hasClockBounds(hours)) return [];
  const slotMs = 30 * 60_000;
  // A slot starting in five minutes is not an offer anyone can accept.
  const earliest = args.nowMs + 15 * 60_000;
  const free: number[] = [];
  for (let minute = win.startMinute; minute + 30 <= win.endMinute; minute += 30) {
    // A slot the lunch break eats must never be read aloud. Checked on the
    // whole 30-minute span, not the start: 12:45 runs into a 13:00 closure.
    if (closureBlocks(args.closures, { ...civil, weekday }, minute, minute + 30)) {
      continue;
    }
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

const asClock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

// How far ahead a dated closure is worth mentioning. Long enough to cover the
// bank holiday somebody is ringing about, short enough that the agent is not
// handed next spring.
const CLOSURE_HORIZON_DAYS = 60;
// And how many, so one org with a year of holidays typed in cannot crowd the
// rest of the ring-time payload out.
const MAX_CLOSURES_ANNOUNCED = 6;

export interface AgentHoursFacts {
  open_hours?: string;
  closed_days?: string[];
  closed_times?: string[];
  upcoming_closures?: string[];
}

export function openHoursForAgent(
  hours: ActiveWindow | null | undefined,
  opts?: {
    closures?: Closure[] | null;
    // Local civil date "YYYY-MM-DD" at the business, from todayInZone. Dated
    // closures are only announced when this is supplied — without a today
    // there is no way to tell a holiday that has passed from one that has not,
    // and reciting last year's is worse than saying nothing.
    todayIso?: string;
  },
): AgentHoursFacts {
  if (!hours) return {};
  const out: AgentHoursFacts = {};

  // Per-day windows, resolved through the one normaliser so a legacy org and a
  // per-weekday org produce the same sentences.
  const windows = WEEKDAY_NAMES.map((_, day) => windowForWeekday(hours, day));
  const open = windows
    .map((win, day) => ({ day, win }))
    .filter((row): row is { day: number; win: DayWindow } => row.win !== null);

  // Same reason suggestFreeSlots bails: an unset legacy bound is "unrestricted",
  // and rendering it as a clock told callers the salon closes at 24:00.
  if (open.length > 0 && hasClockBounds(hours)) {
    const first = open[0].win;
    const uniform = open.every(
      (row) =>
        row.win.startMinute === first.startMinute &&
        row.win.endMinute === first.endMinute,
    );
    // One range while every open day agrees — the shape the prompts already
    // quote, and the shape most businesses actually have. Only a business that
    // really does differ pays the longer string.
    out.open_hours = uniform
      ? `${asClock(first.startMinute)}-${asClock(first.endMinute)}`
      : open
          .map(
            (row) =>
              `${WEEKDAY_NAMES[row.day]} ${asClock(row.win.startMinute)}-${asClock(row.win.endMinute)}`,
          )
          .join(", ");
  }

  // The agent needs the COMPLEMENT — the days it must not offer — because "we
  // are open Mon-Sat" is a fact it has to invert under time pressure, and
  // inverting it is how Sunday gets offered.
  const closedDays = WEEKDAY_NAMES.filter((_, day) => windows[day] === null);
  // Suppressed when nothing is open at all: "closed every day" alongside no
  // open_hours reads to a model as a business that does not exist, and the
  // caller's own no-hours wording is the better answer there.
  if (closedDays.length > 0 && open.length > 0) out.closed_days = closedDays;

  const closures = opts?.closures ?? [];
  const recurring = closures.filter(
    (c) => Array.isArray(c.weekdays) && c.weekdays.length > 0 && !c.date,
  );
  if (recurring.length > 0) {
    out.closed_times = recurring.map((c) => {
      const when =
        c.startMinute == null && c.endMinute == null
          ? "all day"
          : `${asClock(c.startMinute ?? 0)}-${asClock(c.endMinute ?? 24 * 60)}`;
      const days = c
        .weekdays!.slice()
        .sort((a, b) => a - b)
        .map((day) => WEEKDAY_NAMES[day])
        .filter(Boolean)
        .join(", ");
      // The reason rides along when there is one: "lunch" lets the agent say
      // why rather than just refusing a time it will not explain.
      return `${when} on ${days}${c.reason ? ` (${c.reason})` : ""}`;
    });
  }

  const todayIso = opts?.todayIso;
  if (todayIso && /^\d{4}-\d{2}-\d{2}$/.test(todayIso)) {
    // String comparison is date comparison for YYYY-MM-DD, and it avoids
    // parsing a civil date into an instant only to compare it back.
    const horizon = new Date(`${todayIso}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + CLOSURE_HORIZON_DAYS);
    const horizonIso = horizon.toISOString().slice(0, 10);
    const dated = closures
      .filter(
        (c) =>
          typeof c.date === "string" &&
          !(Array.isArray(c.weekdays) && c.weekdays.length > 0) &&
          c.date >= todayIso &&
          c.date <= horizonIso,
      )
      .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0))
      .slice(0, MAX_CLOSURES_ANNOUNCED);
    if (dated.length > 0) {
      out.upcoming_closures = dated.map((c) => {
        const when =
          c.startMinute == null && c.endMinute == null
            ? "all day"
            : `${asClock(c.startMinute ?? 0)}-${asClock(c.endMinute ?? 24 * 60)}`;
        return `${c.date} ${when}${c.reason ? ` (${c.reason})` : ""}`;
      });
    }
  }

  return out;
}
