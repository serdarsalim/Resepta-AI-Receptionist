"use client";

import type { ReactNode } from "react";

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
  // Heights are declared: track = cell + the 2px of p-0.5 on each side.
  const track = stacked ? "h-12" : size === "xs" ? "h-7" : "h-8";
  // A stacked cell has no side padding: the theme row's thirds are 64px of a
  // 224px menu, and the cell's 1px border already spends two of them.
  const cell = stacked
    ? "h-11 flex-col gap-1 px-0"
    : size === "xs"
      ? `h-6 text-xs ${fill ? "px-1" : "px-2.5"}`
      : `h-7 text-sm ${fill ? "px-1" : "px-3"}`;
  const groupRole =
    semantics === "tabs" ? "tablist" : semantics === "menu" ? "group" : "radiogroup";
  const itemRole =
    semantics === "tabs" ? "tab" : semantics === "menu" ? "menuitemradio" : "radio";

  return (
    <div
      role={groupRole}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      className={`${fill ? "flex w-full" : "inline-flex"} ${track} shrink-0 items-center gap-0.5 rounded-lg bg-[var(--segment-track)] p-0.5 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {segments.map((segment) => {
        const active = value === segment.id;
        return (
          <button
            key={segment.id}
            type="button"
            role={itemRole}
            aria-checked={semantics === "tabs" ? undefined : active}
            aria-selected={semantics === "tabs" ? active : undefined}
            title={segment.hint}
            disabled={disabled}
            onClick={() => {
              // A click on the current segment is not a change. Letting it
              // through would write the same value and, where writes clear a
              // per-conversation pin, quietly re-pin it.
              if (!disabled && segment.id !== value) onChange(segment.id);
            }}
            className={`inline-flex ${cell} ${
              fill ? "min-w-0 flex-1 basis-0" : ""
            } items-center justify-center whitespace-nowrap rounded-md border font-medium transition-colors disabled:cursor-not-allowed ${
              active
                ? "border-[var(--segment-thumb-border)] bg-[var(--segment-thumb)] text-[var(--foreground)] shadow-sm"
                : "border-transparent text-[var(--muted-strong)] hover:text-[var(--foreground)]"
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
