"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/LanguageProvider";
import { localeFor } from "@/lib/datetime";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { fieldClass } from "./Control";

// A time, Google Calendar's way (Nudge's TimeSelect, 2026-10-12 there): a
// field you can TYPE in ("930", "9:30", "9", "1:15pm") that opens a list of
// times every 15 minutes. An END field lists from just after its start and
// says how long each choice makes it ("10:30  30 dk"), which is the question
// an end time is really answering.
//
// It replaced the browser's own time box in the blocked-time sheet (which
// rendered "10:30 AM" in a 24-hour app, from the browser's locale rather than
// the business's) and WhenPicker's time chips in the booking sheet. Times are
// minutes past midnight in whatever frame the caller works in; this field
// never touches a date or a zone. 24-hour, like every time this app prints.
//
// The list is portalled and fixed through useAnchoredPanel, so it follows the
// field when the sheet scrolls, and it carries data-nested-menu: while it is
// open, Escape closes the list and not the sheet around it.

const STEP = 15;
const DAY_MINUTES = 24 * 60;

function label(minutes: number): string {
  // 1440 is an END at midnight: "until the end of the day", printed the way a
  // 24-hour clock says it rather than as a misleading 00:00.
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "930", "9:30", "09.30", "9", "1:15pm", "1pm" → minutes from midnight. */
export function parseTimeInput(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, "").replace(/[.,;]/g, ":");
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const half = m[3];
  if (min > 59) return null;
  if (half) {
    if (h < 1 || h > 12) return null;
    if (half.startsWith("p") && h !== 12) h += 12;
    if (half.startsWith("a") && h === 12) h = 0;
  } else if (h > 24 || (h === 24 && min > 0)) {
    return null;
  }
  return h * 60 + min;
}

export function TimeSelect({
  minutes,
  onChange,
  ariaLabel,
  from,
  className = "",
  tight = false,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  ariaLabel: string;
  // An END field: the start it runs from. The list starts one step after it
  // and names each choice's length, and the end of the day is 24:00.
  from?: number;
  className?: string;
  // fieldClass's tight padding, for a time sharing one line with a date.
  tight?: boolean;
}) {
  const { t, language } = useLanguage();
  const locale = localeFor(language);
  const listId = useId();
  const isEnd = from !== undefined;
  const { triggerRef, panelRef, pos, room, open, show, close } =
    useAnchoredPanel<HTMLInputElement>(isEnd ? 184 : 136, 256);
  // Text being typed; null means the field prints the value.
  const [text, setText] = useState<string | null>(null);
  // The row the arrow keys are on, before Enter takes it.
  const [active, setActive] = useState<number | null>(null);

  const choices: number[] = [];
  for (
    let m = isEnd ? from + STEP : 0;
    m <= (isEnd ? DAY_MINUTES : DAY_MINUTES - STEP);
    m += STEP
  ) {
    choices.push(m);
  }
  // A value off the grid (12:10) is still listed, so it shows as chosen.
  if (!choices.includes(minutes) && (!isEnd || minutes > from)) {
    choices.push(minutes);
    choices.sort((a, b) => a - b);
  }

  // "45 dk", "1 sa", "1 sa 15 dk": hours and minutes, Google's way. A decimal
  // ("1.25 hr") made the owner do the arithmetic the list exists to save.
  const length = (m: number) => {
    const d = m - (from ?? 0);
    const h = Math.floor(d / 60);
    const rest = d % 60;
    if (h === 0) return `${rest} ${t("services.minutes")}`;
    const hours = `${h.toLocaleString(locale)} ${t("services.hours")}`;
    return rest === 0 ? hours : `${hours} ${rest} ${t("services.minutes")}`;
  };

  // Opening lands on the chosen time, Google's way, not at midnight.
  useEffect(() => {
    if (!open) return;
    const el = panelRef.current?.querySelector('[aria-selected="true"]');
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "center" });
  }, [open, panelRef]);

  const commitText = () => {
    if (text === null) return;
    const parsed = parseTimeInput(text);
    setText(null);
    if (parsed === null) return;
    // An end typed as midnight means the end of the day; a start may not be
    // 24:00, there is no tomorrow on this calendar.
    if (isEnd) onChange(parsed === 0 ? DAY_MINUTES : parsed);
    else onChange(Math.min(parsed, DAY_MINUTES - STEP));
  };

  const pick = (m: number) => {
    setText(null);
    close();
    onChange(m);
  };

  return (
    <>
      <input
        ref={triggerRef}
        type="text"
        // Digits are most of what gets typed, but "pm" has to be typeable too.
        inputMode="text"
        autoComplete="off"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={text ?? label(minutes)}
        onFocus={(e) => {
          e.currentTarget.select();
          setActive(null);
          if (!open) show();
        }}
        onClick={() => {
          if (!open) show();
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (!open) show();
        }}
        onBlur={() => {
          commitText();
          close();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) show();
            const at = choices.indexOf(active ?? minutes);
            const next = Math.max(
              0,
              Math.min(choices.length - 1, (at < 0 ? 0 : at) + (e.key === "ArrowDown" ? 1 : -1)),
            );
            setActive(choices[next]);
            panelRef.current
              ?.querySelector(`[data-minutes="${choices[next]}"]`)
              ?.scrollIntoView({ block: "nearest" });
          } else if (e.key === "Enter") {
            // Commit the time; never submit the whole form from here.
            e.preventDefault();
            if (text !== null) commitText();
            else if (active !== null) pick(active);
            close();
          } else if (e.key === "Tab") {
            close();
          }
        }}
        className={`${fieldClass("sm", { tight })} tabular-nums ${className}`}
      />
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            data-nested-menu
            // A press anywhere on the list (its scrollbar included) must not
            // take focus from the field, or the blur commits and closes it.
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: Math.min(256, room),
            }}
            className="menu-surface thin-scroll z-[100] overflow-y-auto rounded-lg py-1"
          >
            {choices.map((m) => {
              const selected = m === minutes;
              return (
                <button
                  key={m}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-minutes={m}
                  tabIndex={-1}
                  // Keeps focus in the field, or its blur would commit and
                  // close before this click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(m)}
                  className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm tabular-nums transition-colors hover:bg-[var(--row-hover-bg)] ${
                    selected || active === m ? "bg-[var(--row-hover-bg)]" : ""
                  } ${selected ? "font-medium" : ""}`}
                >
                  <span>{label(m)}</span>
                  {isEnd && <span className="text-xs text-[var(--muted)]">{length(m)}</span>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
