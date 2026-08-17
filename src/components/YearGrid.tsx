"use client";

import { useMemo } from "react";
import { useLanguage } from "@/lib/LanguageProvider";
import {
  addLocalDays,
  localeFor,
  startOfLocalDay,
  startOfLocalWeek,
  weekdayNames,
} from "@/lib/datetime";

// Twelve months at once. Not a view you read appointments in — a view you
// NAVIGATE with, and secondarily one you read shape from: which months are
// busy, where the quiet stretch is, whether August is filling up.
//
// So a day carries a dot, not a name. At this size a name is four characters of
// a name, and four characters of a name is worse than nothing because it looks
// like information.

// Bodies live in lib/datetime now — they were retyped here, in MonthGrid and in
// AppointmentsView, and DST arithmetic is not a thing to get right three times.
const startOfDay = startOfLocalDay;
const startOfWeek = startOfLocalWeek;

export function startOfYear(ms: number): number {
  const d = new Date(ms);
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addYears(ms: number, n: number): number {
  const d = new Date(ms);
  // Month and date pinned to 1 January first, so 29 February plus a year is
  // not 1 March of a non-leap year.
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  d.setFullYear(d.getFullYear() + n);
  return d.getTime();
}

export function YearGrid({
  anchor,
  bookedDays,
  onOpenDay,
  onOpenMonth,
}: {
  anchor: number;
  // Day starts (local midnight) that hold at least one booking. A set, because
  // this grid asks the question 366 times and asking a list would be 366 scans.
  bookedDays: Set<number>;
  onOpenDay: (dayMs: number) => void;
  onOpenMonth: (monthMs: number) => void;
}) {
  const { language } = useLanguage();
  const locale = localeFor(language);
  const year = new Date(anchor).getFullYear();
  const today = startOfDay(Date.now());

  // Single-letter weekday heads, Monday first to match every other view.
  const initials = useMemo(() => {
    const names = weekdayNames(language);
    const monday = [...names.slice(1), names[0]];
    return monday.map((name) => name.slice(0, 1));
  }, [language]);

  const monthName = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long" }),
    [locale],
  );

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, month) => {
        const first = new Date(year, month, 1).getTime();
        // Six weeks covers every month in every alignment, so each mini grid is
        // the same height and the row of months does not stagger.
        const from = startOfWeek(first);
        return {
          month,
          first,
          // addLocalDays, not from + i * DAY_MS: bookedDays is a Set of exact
          // local midnights, so the fixed step made has() false for every cell
          // after a DST transition — 30–31 March and 26–31 October showed no
          // booked dot no matter how many appointments those days held.
          days: Array.from({ length: 42 }, (_, i) => addLocalDays(from, i)),
        };
      }),
    [year],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {months.map(({ month, first, days }) => (
          <div key={month}>
            <button
              type="button"
              onClick={() => onOpenMonth(first)}
              className="mb-1 rounded px-1 text-sm font-medium capitalize transition-colors hover:bg-[var(--muted-bg)]"
            >
              {monthName.format(new Date(first))}
            </button>
            <div className="grid grid-cols-7 gap-y-0.5">
              {initials.map((letter, i) => (
                <span
                  key={i}
                  className="text-center text-[10px] leading-5 text-[var(--muted)]"
                >
                  {letter}
                </span>
              ))}
              {days.map((day) => {
                const inMonth = new Date(day).getMonth() === month;
                const isToday = day === today;
                const booked = bookedDays.has(day);
                // Days from the neighbouring month keep their cell but not
                // their ink: removing them would break the seven-column
                // rhythm, and printing them fully would double every date in
                // the year.
                if (!inMonth) return <span key={day} className="h-5" />;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => onOpenDay(day)}
                    className={`relative mx-auto flex h-5 w-5 items-center justify-center rounded-full text-[10px] tabular-nums transition-colors ${
                      isToday
                        ? "bg-[var(--brand)] font-medium text-white"
                        : booked
                          ? "font-medium text-[var(--foreground)] hover:bg-[var(--muted-bg)]"
                          : "text-[var(--muted)] hover:bg-[var(--muted-bg)]"
                    }`}
                  >
                    {new Date(day).getDate()}
                    {/* The dot is the whole payload of this view: it says
                        "something is booked here" without claiming to say
                        what. Suppressed under today's filled circle, where it
                        would be a dot on a dot. */}
                    {booked && !isToday && (
                      <span className="absolute -bottom-px h-1 w-1 rounded-full bg-[var(--brand)]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
