"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/LanguageProvider";
import {
  addLocalDays,
  atLocalMinutes,
  formatDayHeading,
  localeFor,
  startOfLocalDay,
  startOfLocalWeek,
  weekdayNames,
} from "@/lib/datetime";
import { addMonths, startOfMonth } from "./MonthGrid";

// Google Calendar's when-editor, sized for the booking sheet: a date chip
// that opens a mini month, and start/end time chips you can TYPE into or pick
// from a list. It replaces a native datetime-local input that neither typed
// well (a slip put the year at 0025 with no way back) nor looked like it
// belonged, plus a bare "duration in minutes" box that made the owner do
// clock arithmetic Google never asks for. Duration is what this component
// reports, because that is what the booking machinery speaks — but the owner
// only ever sees times.
//
// Every popover is portalled and fixed, measured from its chip — the sheet
// scrolls, and an absolute child would clip against it (the rule in
// AGENTS.md this repo keeps re-learning).

const STEP = 15; // Google's grid
const END_CHOICES = 32; // 8 hours of end options; longer is typed, not picked
const DATE_POP_W = 272;
const TIME_POP_W = 176;

function fmt(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
    minute % 60,
  ).padStart(2, "0")}`;
}

// "930" and "9:30" and "9" all mean half past / on the hour — whatever a
// busy counter types. 24-hour only, which is how this calendar prints time
// everywhere else.
function parseTime(text: string): number | null {
  const t = text.trim().replace(/[.,;]/g, ":");
  let h: number;
  let m: number;
  const withColon = t.match(/^(\d{1,2}):(\d{1,2})$/);
  const bare = t.match(/^(\d{1,4})$/);
  if (withColon) {
    h = Number(withColon[1]);
    m = Number(withColon[2]);
  } else if (bare) {
    const s = bare[1];
    if (s.length <= 2) {
      h = Number(s);
      m = 0;
    } else {
      h = Number(s.slice(0, -2));
      m = Number(s.slice(-2));
    }
  } else {
    return null;
  }
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

type Popover = "date" | "start" | "end";

export function WhenPicker({
  startAt,
  durationMinutes,
  showEnd,
  onChange,
}: {
  startAt: number;
  durationMinutes: number;
  // A goods order has a moment, not a length: no end chip.
  showEnd: boolean;
  onChange: (startAt: number, durationMinutes: number) => void;
}) {
  const { t, language } = useLanguage();
  const locale = localeFor(language);

  const day = startOfLocalDay(startAt);
  const startMin = Math.round((startAt - day) / 60_000);
  const endMin = startMin + durationMinutes;

  const [open, setOpen] = useState<Popover | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(startAt));
  // Text being typed into a time chip; null means the chip just prints the
  // value. Committed on Enter, blur, or picking from the list.
  const [startText, setStartText] = useState<string | null>(null);
  const [endText, setEndText] = useState<string | null>(null);

  const dateRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const anchorEl = (which: Popover) =>
    which === "date"
      ? dateRef.current
      : which === "start"
        ? startRef.current
        : endRef.current;

  // Measured while open, re-measured when anything underneath moves — fixed
  // coordinates go stale the moment the sheet scrolls.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const width = open === "date" ? DATE_POP_W : TIME_POP_W;
    const measure = () => {
      const r = anchorEl(open)?.getBoundingClientRect();
      if (!r) return;
      setPos({
        top: r.bottom + 4,
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  // A click that lands nowhere on the picker closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (anchorEl(open)?.contains(target)) return;
      setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // The time lists open with the current value centred, not at midnight.
  useLayoutEffect(() => {
    if (open !== "start" && open !== "end") return;
    const container = popRef.current;
    const selected = container?.querySelector<HTMLElement>("[data-selected]");
    if (container && selected) {
      container.scrollTop =
        selected.offsetTop - container.clientHeight / 2 + selected.clientHeight / 2;
    }
  }, [open, pos]);

  const commitStart = (text: string | null) => {
    setStartText(null);
    if (text === null) return;
    const parsed = parseTime(text);
    // Moving the start keeps the length, Google's rule: 10:00–10:30 dragged
    // to 14:00 is 14:00–14:30.
    if (parsed !== null) onChange(atLocalMinutes(day, parsed), durationMinutes);
  };

  const commitEnd = (text: string | null) => {
    setEndText(null);
    if (text === null) return;
    const parsed = parseTime(text);
    // An end at or before the start is refused, not reinterpreted — this
    // calendar cannot draw a booking that crosses midnight, and guessing
    // "tomorrow" would book 20 hours of chair.
    if (parsed !== null && parsed > startMin) onChange(startAt, parsed - startMin);
  };

  const durationLabel = (minutes: number) =>
    minutes < 60
      ? `${minutes} ${t("services.minutes")}`
      : `${(minutes / 60).toLocaleString(locale, { maximumFractionDigits: 1 })} ${t("services.hours")}`;

  // Chips in the muted wash, borderless — inputs read as values here, the
  // way Google's grey chips do, not as form boxes.
  //
  // h-8 py-0: the control scale's 32px (Control.tsx), the height of every
  // other field in the booking sheet, declared rather than padded into being.
  // Dark takes the foreground wash instead of --muted-bg, which there IS the
  // sheet's own --card, so the chips used to be bare text in dark mode.
  const chip =
    "inline-flex h-8 items-center rounded-lg border-0 bg-[var(--muted-bg)] px-3 py-0 text-sm text-[var(--foreground)] dark:bg-[var(--control-hover)]";

  const timeChip = (which: "start" | "end") => {
    const isStart = which === "start";
    const text = isStart ? startText : endText;
    const setText = isStart ? setStartText : setEndText;
    const commit = isStart ? commitStart : commitEnd;
    return (
      <input
        ref={isStart ? startRef : endRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={t("appointments.when")}
        className={`${chip} w-[4.25rem] text-center tabular-nums`}
        value={text ?? fmt(isStart ? startMin : endMin)}
        onFocus={(e) => {
          setOpen(which);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Commit the time; never submit the whole booking from here.
            e.preventDefault();
            commit(text);
            setOpen(null);
          }
        }}
      />
    );
  };

  // ---- The mini month ----
  const monthDays = (() => {
    const first = startOfLocalWeek(viewMonth);
    return Array.from({ length: 42 }, (_, i) => addLocalDays(first, i));
  })();
  const names = weekdayNames(language);
  const mondayFirst = [...names.slice(1), names[0]];
  const today = startOfLocalDay(Date.now());
  const monthOf = new Date(viewMonth).getMonth();

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <button
        ref={dateRef}
        type="button"
        onClick={() => {
          setViewMonth(startOfMonth(startAt));
          setOpen(open === "date" ? null : "date");
        }}
        className={`${chip} text-left transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_8%,var(--muted-bg))]`}
      >
        {formatDayHeading(startAt, language)}
      </button>
      <span className="flex items-center gap-1.5">
        {timeChip("start")}
        {showEnd && (
          <>
            <span className="text-[var(--muted)]">–</span>
            {timeChip("end")}
          </>
        )}
      </span>

      {open === "date" && pos &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: DATE_POP_W }}
            className="z-[100] rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">
                {new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
                  new Date(viewMonth),
                )}
              </span>
              <span className="flex">
                <button
                  type="button"
                  aria-label={t("appointments.previous")}
                  className="rounded-md px-1.5 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                  onClick={() => setViewMonth(addMonths(viewMonth, -1))}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label={t("appointments.next")}
                  className="rounded-md px-1.5 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                  onClick={() => setViewMonth(addMonths(viewMonth, 1))}
                >
                  ›
                </button>
              </span>
            </div>
            <div className="grid grid-cols-7 gap-y-0.5 text-center text-[11px]">
              {mondayFirst.map((name) => (
                <span key={name} className="pb-1 text-[var(--muted)]">
                  {name.slice(0, 1)}
                </span>
              ))}
              {monthDays.map((cell) => {
                const inMonth = new Date(cell).getMonth() === monthOf;
                const isSelected = cell === day;
                const isToday = cell === today;
                return (
                  <button
                    key={cell}
                    type="button"
                    onClick={() => {
                      // A new date, the same clock — picking Thursday moves
                      // the booking, never its time of day.
                      onChange(atLocalMinutes(cell, startMin), durationMinutes);
                      setOpen(null);
                    }}
                    className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full tabular-nums transition-colors ${
                      isSelected
                        ? "bg-[var(--accent)] font-medium text-white"
                        : isToday
                          ? "font-medium text-[var(--accent)] hover:bg-[var(--muted-bg)]"
                          : inMonth
                            ? "text-[var(--foreground)] hover:bg-[var(--muted-bg)]"
                            : "text-[var(--muted)] hover:bg-[var(--muted-bg)]"
                    }`}
                  >
                    {new Date(cell).getDate()}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}

      {(open === "start" || open === "end") && pos &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: TIME_POP_W }}
            className="z-[100] max-h-52 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl"
          >
            {(open === "start"
              ? Array.from({ length: (24 * 60) / STEP }, (_, i) => i * STEP)
              : Array.from({ length: END_CHOICES }, (_, i) => startMin + (i + 1) * STEP).filter(
                  (m) => m < 24 * 60,
                )
            ).map((minute) => {
              const selected = minute === (open === "start" ? startMin : endMin);
              return (
                <button
                  key={minute}
                  type="button"
                  data-selected={selected ? "" : undefined}
                  // Keeps focus in the chip so its onBlur cannot tear the
                  // list down before this click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (open === "start") {
                      setStartText(null);
                      onChange(atLocalMinutes(day, minute), durationMinutes);
                    } else {
                      setEndText(null);
                      onChange(startAt, minute - startMin);
                    }
                    setOpen(null);
                  }}
                  className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)] ${
                    selected ? "font-medium" : ""
                  }`}
                >
                  <span className="tabular-nums">{fmt(minute)}</span>
                  {open === "end" && (
                    <span className="text-xs text-[var(--muted)]">
                      {durationLabel(minute - startMin)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
