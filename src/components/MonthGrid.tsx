"use client";

import { useMemo } from "react";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatTime, weekdayNames } from "@/lib/datetime";
import type { Rect } from "@/lib/anchoredSheet";

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
  customer: { firstName: string; lastName?: string } | null;
  serviceName?: string;
};

// Six weeks always, never five. A month grid that changes height as you page
// through the year makes every row jump under the cursor, and the one thing
// you do in month view is page through the year.
const WEEKS = 6;
const DAY_MS = 86_400_000;

// Past this a cell is a list nobody reads, and the day view is right there.
const MAX_PER_DAY = 3;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  return d.getTime() - ((d.getDay() + 6) % 7) * DAY_MS; // Monday-start
}

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
}: {
  anchor: number;
  rows: MonthRow[];
  onOpenDay: (dayMs: number) => void;
  onOpenBlock: (id: string, anchorRect?: Rect) => void;
  // Empty space in a cell books that day. No time was chosen, so the caller
  // picks a sensible one, the same way the toolbar button does.
  onDraftDay: (dayMs: number) => void;
  // Closed weekdays read as dead cells. Day-level only — a month answers
  // "which day", so open/close TIMES don't shade here. No timezone math
  // either: a cell is a civil date, and Monday is Monday in every zone.
  businessHours?: { activeDays?: number[] };
}) {
  const { t, language } = useLanguage();

  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(anchor));
    return Array.from({ length: WEEKS * 7 }, (_, i) => first + i * DAY_MS);
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7">
        {headers.map((name) => (
          <div
            key={name}
            className="pb-1 text-center text-[11px] font-medium text-[var(--muted)]"
          >
            {name}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 border-l border-t border-[var(--grid-line)]">
        {days.map((day) => {
          const inMonth = new Date(day).getMonth() === month;
          const isToday = day === today;
          const activeDays = businessHours?.activeDays;
          const closed =
            activeDays !== undefined &&
            activeDays.length > 0 &&
            !activeDays.includes(new Date(day).getDay());
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
              className={`relative min-w-0 overflow-hidden border-b border-r border-[var(--grid-line)] p-1 text-left transition-colors hover:bg-[var(--row-hover-bg)] ${
                inMonth && !closed ? "" : "bg-[var(--closed-bg)]"
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
                    ? "bg-[var(--brand)] font-medium text-white"
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
                    className={`block w-full truncate rounded px-1 text-left text-[11px] leading-4 transition-opacity hover:opacity-80 ${
                      row.status === "cancelled"
                        ? "text-[var(--muted)] line-through"
                        : "bg-[var(--brand-soft)] text-[var(--foreground)]"
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
                    {t("appointments.more").replace("{n}", String(hidden))}
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
