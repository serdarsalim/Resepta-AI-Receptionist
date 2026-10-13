"use client";

import { useMemo } from "react";
import { useLanguage } from "@/lib/LanguageProvider";
import {
  closuresOnDay,
  hasBusinessHours,
  windowForWeekday,
  type Closure,
} from "../../convex/lib/businessHours";
import {
  addLocalDays,
  formatTime,
  startOfLocalDay,
  startOfLocalWeek,
  weekdayNames,
} from "@/lib/datetime";
import type { Rect } from "@/lib/anchoredSheet";
import { STAFF_TINT, staffTint } from "@/lib/staffTint";

// The month, as a month reads: whether days are full, not what happens at
// 14:15. The time grid answers "when exactly"; this answers "which day has
// room", which is the question you ask when somebody wants an appointment
// three weeks out.
//
// Deliberately NOT the week grid with thinner rows. A month of 56px hours is
// 1300px of mostly empty column, and a salon scanning for a free Thursday is
// not reading minutes.

export type MonthRow = {
  _id: string;
  startAt: number;
  status: string;
  // Whose booking it is: the chip wears their colour.
  staffId?: string;
  customer: { firstName: string; lastName?: string } | null;
  serviceName?: string;
};

// Six weeks always, never five. A month grid that changes height as you page
// through the year makes every row jump under the cursor, and the one thing
// you do in month view is page through the year.
const WEEKS = 6;

// Past this a cell is a list nobody reads, and the day view is right there.
const MAX_PER_DAY = 3;

// Re-exported under the local names the rest of this file already uses, rather
// than renaming forty call sites. The bodies moved to lib/datetime because they
// were retyped in three components and one of the copies had to be right about
// DST for the others to be — see addLocalDays there.
const startOfDay = startOfLocalDay;
const startOfWeek = startOfLocalWeek;

export function startOfMonth(ms: number): number {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Date set to 1 BEFORE the month moves, or 31 January plus one month is 3
// March. The classic.
export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + n);
  return d.getTime();
}

export function MonthGrid({
  anchor,
  rows,
  onOpenDay,
  onOpenBlock,
  onDraftDay,
  businessHours,
  closures,
  colorOf,
}: {
  anchor: number;
  rows: MonthRow[];
  // A team member's resolved colour key (lib/staffTint.ts).
  colorOf?: (staffId?: string) => string | undefined;
  onOpenDay: (dayMs: number) => void;
  onOpenBlock: (id: string, anchorRect?: Rect) => void;
  // Empty space in a cell books that day. No time was chosen, so the caller
  // picks a sensible one, the same way the toolbar button does.
  onDraftDay: (dayMs: number) => void;
  // Closed weekdays read as dead cells. Day-level only — a month answers
  // "which day", so open/close TIMES don't shade here. No timezone math
  // either: a cell is a civil date, and Monday is Monday in every zone.
  businessHours?: {
    activeDays?: number[];
    startMinute?: number;
    endMinute?: number;
    days?: ({ startMinute: number; endMinute: number } | null)[];
  };
  // Only whole-day closures reach the tint; see the cell below.
  closures?: Closure[];
}) {
  const { t, language } = useLanguage();

  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(anchor));
    // addLocalDays, not first + i * DAY_MS. A local day is 23 or 25 hours long
    // twice a year, so the fixed step drifted an hour partway through the grid
    // — and since byDay is keyed on exact local midnights, every cell past the
    // transition missed its bookings entirely. The last two weeks of October
    // rendered as empty, the date labels repeated a number, and isToday could
    // never match.
    return Array.from({ length: WEEKS * 7 }, (_, i) => addLocalDays(first, i));
  }, [anchor]);

  // Bookings bucketed by day, each bucket in time order. Built once per render
  // rather than filtered per cell, which would be 42 passes over the month.
  const byDay = useMemo(() => {
    const map = new Map<number, MonthRow[]>();
    for (const row of rows) {
      const key = startOfDay(row.startAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(row);
      else map.set(key, [row]);
    }
    for (const bucket of map.values()) bucket.sort((a, b) => a.startAt - b.startAt);
    return map;
  }, [rows]);

  // Monday-first, to match the week grid. weekdayNames is Sunday-indexed.
  const names = weekdayNames(language);
  const headers = [...names.slice(1), names[0]];

  const month = new Date(anchor).getMonth();
  const today = startOfDay(Date.now());

  return (
    // Same card as the week grid: white paper on the page gradient.
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-[var(--card)] shadow-[var(--card-shadow)]">
      {/* pt-2, the week grid's reason: a weekday name flush against the
          card's top edge reads as clipped (Nudge's month carries it too). */}
      <div className="grid grid-cols-7 pt-2">
        {headers.map((name) => (
          <div
            key={name}
            className="pb-1 text-center text-[11px] font-medium text-[var(--muted-strong)]"
          >
            {name}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 border-l border-t border-[var(--grid-line)]">
        {days.map((day) => {
          const inMonth = new Date(day).getMonth() === month;
          const isToday = day === today;
          // Grey means CLOSED, and only closed — through the same normaliser
          // the week grid and the booking page read, so a day off shows here
          // whichever shape the org's hours carry. Unset hours stay untinted:
          // nobody has said when this business is open, and a guessed default
          // would grey out a barber's Saturday.
          const cell = new Date(day);
          const weekday = cell.getDay();
          const win =
            businessHours !== undefined && hasBusinessHours(businessHours)
              ? windowForWeekday(businessHours, weekday)
              : undefined;
          // A dated all-day closure greys the cell too. The week grid already
          // shades a holiday; a month view that showed it as an ordinary open
          // day was the same fact answered two ways one click apart.
          //
          // Only a closure covering the WHOLE open window counts here. A month
          // cell has no room to say "shut between one and two", and greying a
          // day the salon works most of would be worse than saying nothing.
          const swallowed =
            win !== undefined &&
            win !== null &&
            closuresOnDay(closures, {
              y: cell.getFullYear(),
              m0: cell.getMonth(),
              d: cell.getDate(),
              weekday,
            }).some((c) => c.from <= win.startMinute && c.to >= win.endMinute);
          const closed = win === null || swallowed;
          const bookings = byDay.get(day) ?? [];
          const shown = bookings.slice(0, MAX_PER_DAY);
          const hidden = bookings.length - shown.length;
          return (
            <div
              key={day}
              // The cell itself books the day. A month cell has no minute to
              // point at, so the whole surface is one target rather than a
              // small "+" somebody has to find.
              onClick={() => onDraftDay(day)}
              // Grey means CLOSED, and only closed. Out-of-month cells used
              // to share the same fill, which made the July days at the top
              // of August read as shut on a Tuesday; Google marks them with
              // a muted date number and nothing else, and so do we.
              className={`relative min-w-0 overflow-hidden border-b border-r border-[var(--grid-line)] p-1 text-left transition-colors hover:bg-[var(--row-hover-bg)] ${
                closed ? "bg-[var(--closed-bg)]" : ""
              }`}
            >
              {/* The date opens the day. Its own button, because the cell
                  around it creates: one surface cannot mean both, and the
                  number is the part that reads like a link to a day. */}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenDay(day);
                }}
                className={`mb-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular-nums transition-colors ${
                  isToday
                    ? "bg-[var(--accent)] font-medium text-white"
                    : inMonth
                      ? "text-[var(--foreground)] hover:bg-[var(--muted-bg)]"
                      : "text-[var(--muted)] hover:bg-[var(--muted-bg)]"
                }`}
              >
                {new Date(day).getDate()}
              </button>

              <div className="space-y-px">
                {shown.map((row) => (
                  <button
                    key={row._id}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      const r = event.currentTarget.getBoundingClientRect();
                      onOpenBlock(row._id, {
                        top: r.top,
                        left: r.left,
                        width: r.width,
                        height: r.height,
                      });
                    }}
                    title={`${formatTime(row.startAt, language)} ${nameOf(row)}`}
                    style={staffTint(colorOf?.(row.staffId))}
                    className={`${STAFF_TINT} block w-full truncate rounded px-1 text-left text-[11px] leading-4 transition-opacity hover:opacity-80 ${
                      row.status === "cancelled"
                        ? "text-[var(--muted)] line-through"
                        : // Same tense split as the week grid: what already
                          // happened fades, what is coming carries the colour.
                          day < today
                          ? "bg-[var(--event-past)] text-[var(--event-past-fg)]"
                          : "bg-[var(--event-soft)] text-[var(--foreground)]"
                    }`}
                  >
                    <span className="tabular-nums">{formatTime(row.startAt, language)}</span>{" "}
                    {nameOf(row)}
                  </button>
                ))}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenDay(day);
                    }}
                    className="block w-full truncate px-1 text-left text-[11px] leading-4 text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    {t("appointments.more", { n: hidden })}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function nameOf(row: MonthRow): string {
  if (!row.customer) return "";
  return `${row.customer.firstName} ${row.customer.lastName ?? ""}`.trim();
}
