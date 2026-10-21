"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

// One track, N named states. THE segmented control: seven hand-copied ones
// were folded into it on 2026-10-13 (the field-source picker it was first
// lifted from, the WhatsApp/Email preview switches in the rule editor and the
// operator's template editor, the agent create/connect switch, the variable
// type picker, the account menu's theme row) plus the email editor's
// Visual/HTML/Preview switch, which also hardcoded "Visual" in English.
//
// A segmented control rather than a switch whenever OFF IS A STATE rather than
// the absence of the control. "Off" for the chat agent is a position on a dial
// somebody chose, not an empty box.
//
// The track recesses and the picked cell lifts, on their own token pair
// (--segment-track / --segment-thumb, globals.css; Nudge b43691f4). The copies
// drew them with --muted-bg and --card or --background, and in dark --muted-bg
// IS --card: the track vanished into the card it sat on and the picked cell
// was told apart by a shade of near-black. The theme row in the account menu
// had grown a ring to survive it, on the one control whose job is switching
// dark mode.
//
// A PILL with one thumb that slides to the pick (Nudge, 2026-10-20, Serdar:
// "modern pill switch designs"; here 2026-10-21). Round because a state you
// select is rounded-full (Control.tsx); the slide shows the choice moving,
// where a box going out and another lighting up only showed it changing. The
// thumb is MEASURED from the picked cell, never placed by index, because a
// cell is as wide as its words unless the caller stretches the track. Until
// it is placed (the server render, the first paint) the picked cell wears the
// same look itself, so a selection never shows up late.
//
// Every cell is font-medium in both states. A copy that bolded only the picked
// cell changed that cell's width on every click, and nothing shifts under the
// pointer (AGENTS.md).

export type Segment<T extends string> = {
  id: T;
  label: string;
  // The button's title. The modes differ in what happens to a customer, which
  // a one-word pill cannot carry on its own; a cell that truncates its label
  // can pass the label itself.
  hint?: string;
  // Drawn ABOVE the label: the account menu's theme row, where a 66px column
  // cannot fit a glyph beside "Automatisch". Any icon makes every cell stack.
  icon?: ReactNode;
  // After the label, inside the cell: an unsaved lane's amber dot.
  mark?: ReactNode;
};

// What the cells ARE to a screen reader. "radio" is a value you pick (the
// default). "tabs" swaps the content under it (agent create/connect, the
// email editor's modes). "menu" sits inside a role="menu", where only
// menuitemradio is a legal child (the theme row).
type Semantics = "radio" | "tabs" | "menu";

// The lifted look: the thumb's, and the picked cell's until the thumb is placed.
const LIFT = "bg-[var(--segment-thumb)] shadow-[var(--segment-thumb-shadow)]";
// A quick start and a long soft landing, the curve iOS settles sheets on.
const SLIDE =
  "transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

export function SegmentedControl<T extends string>({
  value,
  segments,
  onChange,
  disabled,
  labelledBy,
  ariaLabel,
  size = "sm",
  fill = false,
  semantics = "radio",
}: {
  value: T;
  segments: readonly Segment<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
  labelledBy?: string;
  ariaLabel?: string;
  // The control scale (Control.tsx): sm is a 32px track, xs a 28px one for
  // the in-thread bar above the composer and the preview switches, where it
  // must not out-shout what it switches. A stacked track is 48px.
  size?: "xs" | "sm";
  // Equal cells across the container's width (the type picker, the theme
  // row) instead of cells sized to their words.
  fill?: boolean;
  semantics?: Semantics;
}) {
  const stacked = segments.some((segment) => segment.icon !== undefined);
  // Heights are declared: track = cell + the 3px inset on each side.
  const track = stacked ? "h-12" : size === "xs" ? "h-7" : "h-8";
  // A stacked cell has no side padding: the theme row's thirds are 64px of a
  // 224px menu.
  const cell = stacked
    ? "h-[42px] flex-col gap-1 px-0"
    : size === "xs"
      ? `h-[22px] text-xs ${fill ? "px-1" : "px-2.5"}`
      : `h-[26px] text-sm ${fill ? "px-1" : "px-3.5"}`;
  // A 42px stacked cell drawn fully round is an oval, so the stacked row
  // keeps the same idea in a softer corner.
  const radius = stacked ? "rounded-xl" : "rounded-full";
  const trackRadius = stacked ? "rounded-[15px]" : "rounded-full";
  const groupRole =
    semantics === "tabs" ? "tablist" : semantics === "menu" ? "group" : "radiogroup";
  const itemRole =
    semantics === "tabs" ? "tab" : semantics === "menu" ? "menuitemradio" : "radio";

  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const idsKey = segments.map((segment) => segment.id).join("\u0000");

  // Put the thumb under the picked cell. Written straight onto the thumb, not
  // through state: a re-render per measure would be a render loop with the
  // segment arrays callers build inline. A new pick slides; the first
  // placement and a resize jump, because a thumb chasing a window being
  // dragged wider reads as lag. The observer's first report after a pick
  // finds the thumb already where it is going and leaves the slide alone.
  useLayoutEffect(() => {
    const trackEl = trackRef.current;
    const thumb = thumbRef.current;
    if (!trackEl || !thumb) return;
    let placedAt = "";
    const place = (slide: boolean) => {
      const picked = trackEl.querySelector<HTMLElement>("[data-picked]");
      if (!picked) {
        placedAt = "";
        delete trackEl.dataset.thumb;
        return;
      }
      const at = `${picked.offsetLeft},${picked.offsetTop},${picked.offsetWidth},${picked.offsetHeight}`;
      if (at === placedAt) return;
      placedAt = at;
      const jump = !slide || trackEl.dataset.thumb !== "on";
      if (jump) thumb.style.transition = "none";
      thumb.style.width = `${picked.offsetWidth}px`;
      thumb.style.height = `${picked.offsetHeight}px`;
      thumb.style.transform = `translate(${picked.offsetLeft}px, ${picked.offsetTop}px)`;
      if (jump) {
        // Commit the jump before the transition comes back, or it animates.
        void thumb.offsetWidth;
        thumb.style.transition = "";
      }
      trackEl.dataset.thumb = "on";
    };
    place(true);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place(false));
    observer.observe(trackEl);
    trackEl.querySelectorAll("button").forEach((cellEl) => observer.observe(cellEl));
    return () => observer.disconnect();
  }, [value, idsKey, stacked, size, fill]);

  // A radio group behaves like native radios: Tab reaches one cell (the
  // pick) and the arrows move the pick. Tabs and menu rows keep their own
  // keyboard owners.
  const roving = semantics === "radio" && !disabled;
  const pickedIndex = segments.findIndex((segment) => segment.id === value);
  const tabStop = pickedIndex >= 0 ? pickedIndex : 0;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!roving) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const cells = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    if (!cells.length) return;
    event.preventDefault();
    const at = cells.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? cells.length - 1
          : (at + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + cells.length) % cells.length;
    cells[next].focus();
    cells[next].click();
  };

  return (
    <div
      ref={trackRef}
      role={groupRole}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      // w-fit is load-bearing: placed straight in a grid cell (the handover
      // row in Automations) the track is blockified and stretched to the
      // column, and a visible track then ran on past its cells.
      className={`group/segment relative ${fill ? "flex w-full" : "inline-flex w-fit"} ${track} shrink-0 items-center ${trackRadius} bg-[var(--segment-track)] p-[3px] ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {/* First, so the cells (positioned, later in the tree) paint over it. */}
      <span
        ref={thumbRef}
        aria-hidden
        className={`pointer-events-none absolute left-0 top-0 ${radius} opacity-0 group-data-[thumb=on]/segment:opacity-100 ${LIFT} ${SLIDE}`}
      />
      {segments.map((segment, i) => {
        const active = value === segment.id;
        return (
          <button
            key={segment.id}
            type="button"
            role={itemRole}
            data-picked={active ? "" : undefined}
            aria-checked={semantics === "tabs" ? undefined : active}
            aria-selected={semantics === "tabs" ? active : undefined}
            tabIndex={roving ? (i === tabStop ? 0 : -1) : undefined}
            title={segment.hint}
            disabled={disabled}
            onClick={() => {
              // A click on the current segment is not a change. Letting it
              // through would write the same value and, where writes clear a
              // per-conversation pin, quietly re-pin it.
              if (!disabled && segment.id !== value) onChange(segment.id);
            }}
            className={`relative inline-flex ${cell} ${
              fill ? "min-w-0 flex-1 basis-0" : ""
            } items-center justify-center whitespace-nowrap ${radius} font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 disabled:cursor-not-allowed ${
              active
                ? `text-[var(--foreground)] ${LIFT} group-data-[thumb=on]/segment:bg-transparent group-data-[thumb=on]/segment:shadow-none`
                : "text-[var(--muted-strong)] hover:text-[var(--foreground)]"
            }`}
          >
            {segment.icon !== undefined && (
              <span className="inline-flex h-[18px] w-[18px] items-center justify-center">
                {segment.icon}
              </span>
            )}
            <span
              className={
                stacked
                  ? // Measured, not guessed (the theme row, 2026-08): German
                    // "Automatisch" wants 57px at regular weight, about 59 at
                    // the medium every cell now wears; the cell gives it 62,
                    // with tracking-tight and no side padding. truncate is
                    // the backstop if a future language beats German.
                    "w-full truncate text-center text-[10px] leading-none tracking-tight"
                  : "min-w-0 truncate"
              }
            >
              {segment.label}
            </span>
            {segment.mark}
          </button>
        );
      })}
    </div>
  );
}
