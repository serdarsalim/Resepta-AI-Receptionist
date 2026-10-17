"use client";

// The public pages' time picker in cal.com's layout (P29, Nudge a1ff675d,
// e04cce31, b1d8ff55, 84cc50fb): a month grid with the days that have a free
// time filled in, and the picked day's times as a list beside it. Shared by
// the booking page (/book/<slug>) and the manage page's Reschedule
// (/appt/<token>), which ask the same question through different keys.
//
// The caller owns the month (it is what the query asks for) and lays the two
// sections out; this file owns the drawing. Times are grouped and labelled in
// `zone`: the business's own by default, the visitor's when they pick theirs.

import { useMemo } from "react";
import type { Language, Translator } from "@/lib/i18n";
import { gmtLabel } from "@/lib/gmtLabel";
import { SearchableSelect } from "@/components/SearchableSelect";

// cal.com's filled day: a quiet grey on the light card, a lifted grey on the
// dark one. Not --muted-bg, which in dark mode is close to the card itself.
const FILL =
  "bg-[color-mix(in_srgb,var(--foreground)_7%,var(--card))] dark:bg-[color-mix(in_srgb,var(--foreground)_15%,var(--card))]";

// A day is its calendar date IN THE ZONE, "2026-10-15", which sorts as text.
export type DayKey = string;

export function dayKeyIn(zone: string, ms: number): DayKey {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

// "2026-10" → "2026-11" (or back with -1). Calendar arithmetic in UTC, where
// a month is a month.
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// What the month query asks for: the month's days plus one either side, in
// the BUSINESS's days, so a visitor whose zone sits a few hours off still
// gets the month's first and last days complete (booking.monthSlots caps at
// 33).
export function monthQuery(month: string): { from: string; days: number } {
  const [y, m] = month.split("-").map(Number);
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return { from, days: length + 2 };
}

// "Europe/Istanbul" as cal.com writes it: "Europe/Istanbul" → "Istanbul".
export function zoneCity(zone: string): string {
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

export function MonthGrid({
  t,
  language,
  zone,
  month,
  onMonth,
  minMonth,
  maxMonth,
  offers,
  day,
  onDay,
}: {
  t: Translator;
  language: Language;
  zone: string;
  month: string;
  onMonth: (month: string) => void;
  minMonth: string;
  maxMonth: string;
  offers: number[] | undefined;
  day: DayKey | null;
  onDay: (day: DayKey) => void;
}) {
  const open = useMemo(() => {
    const set = new Set<DayKey>();
    for (const ms of offers ?? []) set.add(dayKeyIn(zone, ms));
    return set;
  }, [offers, zone]);
  const today = dayKeyIn(zone, Date.now());
  const [y, m] = month.split("-").map(Number);
  // English weeks start on Sunday, as cal.com's do; Turkish and German on
  // Monday.
  const weekStart = language === "en" ? 0 : 1;
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const lead = (firstWeekday - weekStart + 7) % 7;
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (DayKey | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  const utc = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(language, { timeZone: "UTC", ...opts });
  const monthName = utc({ month: "long" }).format(new Date(Date.UTC(y, m - 1, 1)));
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    utc({ weekday: "short" }).format(new Date(Date.UTC(2026, 1, 1 + ((weekStart + i) % 7)))),
  );

  return (
    <section aria-label={t("booking.pickTime")}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          {monthName} <span className="font-normal text-[var(--muted)]">{y}</span>
        </h2>
        <div className="flex gap-1">
          <ArrowButton
            dir="left"
            label={t("booking.prevMonth")}
            disabled={month <= minMonth}
            onClick={() => onMonth(shiftMonth(month, -1))}
          />
          <ArrowButton
            dir="right"
            label={t("booking.nextMonth")}
            disabled={month >= maxMonth}
            onClick={() => onMonth(shiftMonth(month, 1))}
          />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1 text-center">
        {weekdays.map((w) => (
          <span key={w} className="pb-2 text-xs font-medium text-[var(--muted-strong)]">
            {w}
          </span>
        ))}
        {cells.map((key, i) => {
          if (!key) return <span key={`pad-${i}`} />;
          const isOpen = open.has(key);
          const isSelected = key === day;
          const isToday = key === today;
          return (
            <button
              key={key}
              type="button"
              disabled={!isOpen}
              aria-pressed={isSelected}
              onClick={() => onDay(key)}
              className={`relative flex aspect-square items-center justify-center rounded-lg text-sm tabular-nums transition-colors ${
                isSelected
                  ? "bg-[var(--foreground)] font-semibold text-[var(--background)]"
                  : isOpen
                    ? `${FILL} font-medium hover:ring-2 hover:ring-[var(--foreground)]`
                    : "cursor-default text-[var(--muted)]"
              }`}
            >
              {Number(key.slice(8))}
              {/* Today's dot, as cal.com marks it; a selected day needs no
                  second mark. */}
              {isToday && !isSelected && (
                <span className="absolute bottom-1 h-1 w-1 rounded-full bg-[var(--foreground)]" />
              )}
            </button>
          );
        })}
      </div>
      {offers === undefined && (
        <p className="mt-3 text-xs text-[var(--muted)]">{t("common.loading")}</p>
      )}
    </section>
  );
}

// The picked day's times as one column of rows, cal.com's list.
export function TimeList({
  t,
  language,
  zone,
  offers,
  day,
  busy,
  onPick,
  className = "",
}: {
  t: Translator;
  language: Language;
  zone: string;
  offers: number[] | undefined;
  day: DayKey | null;
  busy?: boolean;
  onPick: (ms: number) => void;
  className?: string;
}) {
  const times = useMemo(
    () => (day ? (offers ?? []).filter((ms) => dayKeyIn(zone, ms) === day) : []),
    [offers, zone, day],
  );
  const clock = new Intl.DateTimeFormat(language, {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const heading = day
    ? new Intl.DateTimeFormat(language, {
        timeZone: "UTC",
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(new Date(`${day}T12:00:00Z`))
    : null;
  return (
    <section className={`flex min-h-0 flex-col ${className}`}>
      <p className="h-6 text-base font-semibold">{heading}</p>
      <div className="mt-3 min-h-0 flex-1 space-y-2">
        {offers === undefined ? (
          <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
        ) : !day ? (
          <p className="text-sm text-[var(--muted)]">{t("booking.noSlotsMonth")}</p>
        ) : times.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("booking.noSlots")}</p>
        ) : (
          times.map((ms) => (
            <button
              key={ms}
              type="button"
              disabled={busy}
              onClick={() => onPick(ms)}
              className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-[var(--border)] text-sm font-medium tabular-nums transition-colors hover:border-[var(--foreground)] disabled:opacity-50"
            >
              {/* cal.com's green dot: free, and nothing else. */}
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              {clock.format(new Date(ms))}
            </button>
          ))
        )}
      </div>
    </section>
  );
}

// The day a month opens on: the picked one when it is open in this month,
// else the month's first open day, else none.
export function dayInMonth(
  offers: number[] | undefined,
  zone: string,
  month: string,
  picked: DayKey | null,
): DayKey | null {
  if (!offers) return null;
  const days = new Set(offers.map((ms) => dayKeyIn(zone, ms)));
  if (picked && picked.startsWith(month) && days.has(picked)) return picked;
  return [...days].filter((d) => d.startsWith(month)).sort()[0] ?? null;
}

// The visitor's time zone, searchable over every zone the browser knows, with
// the business's own on top and each one's offset beside it.
export function ZonePicker({
  t,
  zone,
  homeZone,
  onZone,
}: {
  t: Translator;
  zone: string;
  homeZone: string;
  onZone: (zone: string) => void;
}) {
  const options = useMemo(() => {
    let all: string[] = [];
    try {
      all =
        (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
          "timeZone",
        ) ?? [];
    } catch {
      all = [];
    }
    const now = Date.now();
    const list = [homeZone, ...all.filter((z) => z !== homeZone)];
    if (!list.includes(zone)) list.splice(1, 0, zone);
    return list.map((z) => ({
      value: z,
      label: z.replace(/_/g, " "),
      note: gmtLabel(z, now),
    }));
  }, [zone, homeZone]);
  return (
    <div className="flex items-center gap-2 text-sm">
      <GlobeIcon />
      <SearchableSelect
        plain
        value={zone}
        options={options}
        onChange={onZone}
        placeholder={t("booking.timeZone")}
        searchPlaceholder={t("booking.searchZone")}
        emptyText={t("booking.noMatches")}
        menuWidth={300}
      />
    </div>
  );
}

function ArrowButton({
  dir,
  label,
  disabled,
  onClick,
}: {
  dir: "left" | "right";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-strong)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d={dir === "left" ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export function GlobeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[var(--muted)]">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

export function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[var(--muted)]">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[var(--muted)]">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
