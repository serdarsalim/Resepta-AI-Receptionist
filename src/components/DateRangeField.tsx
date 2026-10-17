"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/LanguageProvider";
import { localeFor } from "@/lib/datetime";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { fieldClass } from "./Control";

// A run of days: a From field and a To field, both opening one small month
// (Nudge's DateRangeField, 2026-10-12 there). Built for blocked time, where
// the browser's own date box was ~150px of dd/mm/yyyy beside a sentence, its
// picker a grey year list, and the last day an EMPTY box that read as
// unfinished. Both ends stay visible as their own field ("let's not make it
// harder to select from to dates", Serdar in Nudge), and the month draws the
// range between them as a band.
//
// From picks the first day and hands straight on to To, the way flight and
// booking pickers do; To picks the last and closes. The month heading drills
// up, days → months → years, and back down by picking. `DateField` below is
// the one-day form, the booking sheet's date.
//
// Dates are CIVIL ("YYYY-MM-DD"), never instants: everything here is UTC
// arithmetic on a calendar, so no zone can move a day. Monday-first, like the
// week grid. The month portals through useAnchoredPanel and carries
// data-nested-menu, so Escape closes it before the sheet around it.

const DAY_MS = 86_400_000;
const WEEKS = 6;
const PANEL_W = 288;
// Every view is this tall (a weekday row plus six 36px weeks), so drilling
// between days, months and years never resizes the popover.
const BODY_PX = 236;

type View = "days" | "months" | "years";
type End = "start" | "end";

function parse(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function monthStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
}

/** One day: the booking sheet's date. */
export function DateField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (date: string) => void;
  label: string;
}) {
  return (
    <DateRangeField
      single
      start={value}
      end={value}
      onChange={(day) => onChange(day)}
      fromLabel={label}
      toLabel={label}
    />
  );
}

export function DateRangeField({
  start,
  end,
  onChange,
  fromLabel,
  toLabel,
  hint,
  single = false,
}: {
  start: string;
  // Equal to `start` for one day.
  end: string;
  onChange: (start: string, end: string) => void;
  fromLabel: string;
  toLabel: string;
  // Shown under the month while the last day is still to pick.
  hint?: string;
  // One field, one day (DateField).
  single?: boolean;
}) {
  const { t, language } = useLanguage();
  const locale = localeFor(language);
  const { triggerRef, panelRef, pos, open, show, close } = useAnchoredPanel<HTMLDivElement>(
    PANEL_W,
    BODY_PX + 96,
  );
  // Which end the next click sets, and what the popover shows.
  const [picking, setPicking] = useState<End>("start");
  const [view, setView] = useState<View>("days");
  const [month, setMonth] = useState(() => monthStart(parse(start)));
  const [hover, setHover] = useState<string | null>(null);
  // The first of the twelve years on screen: the year being looked at sits
  // second, so next year is in reach and the past barely shows (nobody blocks
  // time in 2016).
  const [yearsFrom, setYearsFrom] = useState(0);
  const thisYear = new Date().getUTCFullYear();

  const words = (value: string) => {
    const ms = parse(value);
    if (Number.isNaN(ms)) return "—";
    // Another year's date names the year INSTEAD of the weekday: both at once
    // ("Wed, 10 Mar 2027") outgrows the field.
    const otherYear = new Date(ms).getUTCFullYear() !== thisYear;
    return new Intl.DateTimeFormat(locale, {
      ...(otherYear ? { year: "numeric" } : { weekday: "short" }),
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(ms);
  };

  const days = useMemo(() => {
    const first = new Date(month);
    // getUTCDay: 0 = Sunday. Back up to the Monday on or before the 1st.
    const back = (first.getUTCDay() + 6) % 7;
    const from = month - back * DAY_MS;
    return Array.from({ length: WEEKS * 7 }, (_, i) => from + i * DAY_MS);
  }, [month]);
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  // 2024-01-01 was a Monday.
  const weekdays = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(Date.UTC(2024, 0, 1 + i)));
  const monthFmt = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const monthNames = Array.from({ length: 12 }, (_, i) => monthFmt.format(Date.UTC(2024, i, 1)));

  const year = new Date(month).getUTCFullYear();
  const heading =
    view === "days"
      ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(month)
      : view === "months"
        ? String(year)
        : `${yearsFrom}–${yearsFrom + 11}`;

  const today = iso(Date.now());
  // While choosing the last day, the range follows the pointer.
  const shownEnd = picking === "end" && hover && hover >= start ? hover : end;

  const openFor = (which: End) => {
    if (open && picking === which) {
      close();
      return;
    }
    setPicking(which);
    setView("days");
    setMonth(monthStart(parse(which === "start" ? start : end)));
    if (!open) show();
  };

  const pickDay = (day: string) => {
    if (single) {
      onChange(day, day);
      close();
      return;
    }
    if (picking === "start" || day < start) {
      // A new first day keeps the last one when it still follows, and hands
      // straight on to To.
      onChange(day, end >= day ? end : day);
      setPicking("end");
      return;
    }
    onChange(start, day);
    close();
  };

  const step = (direction: 1 | -1) => {
    if (view === "days") setMonth((m) => addMonths(m, direction));
    else if (view === "months") setMonth((m) => addMonths(m, direction * 12));
    else setYearsFrom((y) => y + direction * 12);
  };

  const fieldFor = (which: End) => {
    const active = open && picking === which;
    const value = which === "start" ? start : end;
    return (
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={active}
        aria-label={`${which === "start" ? fromLabel : toLabel}: ${words(value)}`}
        onClick={() => openFor(which)}
        className={`${fieldClass("sm")} inline-flex min-w-0 items-center gap-2 whitespace-nowrap text-left ${
          single ? "" : "flex-1"
        } ${active ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/25" : ""}`}
      >
        <CalendarIcon />
        <span className="truncate">{words(value)}</span>
      </button>
    );
  };

  return (
    <>
      <div
        ref={triggerRef}
        className={`${single ? "inline-flex" : "flex"} min-w-0 items-center gap-2`}
      >
        {fieldFor("start")}
        {!single && (
          <>
            <span className="shrink-0 text-[var(--muted)]">–</span>
            {fieldFor("end")}
          </>
        )}
      </div>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={picking === "start" ? fromLabel : toLabel}
            data-nested-menu
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
            }}
            className="menu-surface z-[100] rounded-xl p-3"
            onMouseLeave={() => setHover(null)}
          >
            <div className="mb-2 flex items-center justify-between">
              {/* The heading drills up a level; years is the top. */}
              <button
                type="button"
                onClick={() => {
                  if (view === "months") setYearsFrom(year - 1);
                  setView(view === "days" ? "months" : "years");
                }}
                disabled={view === "years"}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium transition-colors hover:bg-[var(--control-hover)] disabled:hover:bg-transparent"
              >
                {heading}
                {view !== "years" && <Chevron dir="down" />}
              </button>
              <span className="flex items-center gap-0.5">
                <NavButton label={t("appointments.previous")} dir="left" onClick={() => step(-1)} />
                <NavButton label={t("appointments.next")} dir="right" onClick={() => step(1)} />
              </span>
            </div>

            <div style={{ height: BODY_PX }}>
              {view === "days" && (
                <div className="grid grid-cols-7 text-center">
                  {weekdays.map((w) => (
                    <span key={w} className="pb-1 text-[11px] font-medium text-[var(--muted-strong)]">
                      {w}
                    </span>
                  ))}
                  {days.map((ms) => {
                    const day = iso(ms);
                    const inMonth = new Date(ms).getUTCMonth() === new Date(month).getUTCMonth();
                    const isStart = day === start;
                    const isEnd = day === shownEnd;
                    const inRange = day > start && day < shownEnd;
                    const edge = isStart || isEnd;
                    return (
                      <div
                        key={day}
                        // The band between the two ends, drawn on the cell so it
                        // runs edge to edge; the ends sit on it as circles.
                        className={`py-0.5 ${
                          inRange || (edge && start !== shownEnd)
                            ? `bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] ${
                                isStart ? "rounded-l-full" : ""
                              } ${isEnd ? "rounded-r-full" : ""}`
                            : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => pickDay(day)}
                          onMouseEnter={() => setHover(day)}
                          aria-pressed={edge}
                          className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm tabular-nums transition-colors ${
                            edge
                              ? "bg-[var(--accent)] font-medium text-white"
                              : day === today
                                ? "font-medium text-[var(--accent)] hover:bg-[var(--control-hover)]"
                                : inMonth
                                  ? "text-[var(--foreground)] hover:bg-[var(--control-hover)]"
                                  : "text-[var(--muted)] hover:bg-[var(--control-hover)]"
                          }`}
                        >
                          {new Date(ms).getUTCDate()}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {view === "months" && (
                <PickGrid
                  items={monthNames.map((name, i) => {
                    const shown = new Date(parse(picking === "start" ? start : end));
                    return {
                      key: i,
                      label: name,
                      selected: year === shown.getUTCFullYear() && i === shown.getUTCMonth(),
                      current: year === thisYear && i === new Date().getUTCMonth(),
                    };
                  })}
                  onPick={(i) => {
                    setMonth(Date.UTC(year, i, 1));
                    setView("days");
                  }}
                />
              )}
              {view === "years" && (
                <PickGrid
                  items={Array.from({ length: 12 }, (_, i) => yearsFrom + i).map((y) => ({
                    key: y,
                    label: String(y),
                    selected: y === year,
                    current: y === thisYear,
                  }))}
                  onPick={(y) => {
                    setMonth(Date.UTC(y, new Date(month).getUTCMonth(), 1));
                    setView("months");
                  }}
                />
              )}
            </div>
            {/* Reserved either way, so the popover never jumps when it shows. */}
            {!single && (
              <p className="mt-2 min-h-4 px-1 text-xs text-[var(--muted)]">
                {picking === "end" && view === "days" ? hint : ""}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

// Twelve choices in a 3 × 4 grid filling the body: the months of a year, or
// twelve years.
function PickGrid({
  items,
  onPick,
}: {
  items: { key: number; label: string; selected: boolean; current: boolean }[];
  onPick: (key: number) => void;
}) {
  return (
    <div className="grid h-full grid-cols-3 grid-rows-4 gap-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onPick(item.key)}
          className={`rounded-lg text-sm transition-colors ${
            item.selected
              ? "bg-[var(--accent)] font-medium text-white"
              : item.current
                ? "font-medium text-[var(--accent)] hover:bg-[var(--control-hover)]"
                : "text-[var(--foreground)] hover:bg-[var(--control-hover)]"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" | "down" }) {
  const d = dir === "left" ? "m15 18-6-6 6-6" : dir === "right" ? "m9 18 6-6-6-6" : "m6 9 6 6 6-6";
  return (
    <svg
      width={dir === "down" ? 14 : 16}
      height={dir === "down" ? 14 : 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-[var(--muted)]"
    >
      <path d={d} />
    </svg>
  );
}

function NavButton({
  label,
  dir,
  onClick,
}: {
  label: string;
  dir: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]"
    >
      <Chevron dir={dir} />
    </button>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-[var(--muted)]"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
