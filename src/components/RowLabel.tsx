"use client";

import { fieldClass } from "./Control";
import { InfoTip } from "./InfoTip";

// Left-column label for the label-left/input-right settings grids. Shared by
// every settings section.
//
// The grid MUST be the responsive form — one column on phones, two from sm:
//
//   grid grid-cols-1 gap-x-6 gap-y-5
//   sm:grid-cols-[minmax(220px,260px)_1fr] sm:items-start
//
// A bare `grid-cols-[22rem_1fr]` reserves 352px for labels, which on a 390px
// phone pushes the entire input column off-screen.
//
// The label WRAPS inside its column. It used to carry `whitespace-nowrap`,
// which let a long label ("Send a confirmation when a booking is made") run
// straight out of the 260px column and underneath its own control.
//
// The control column is CAPPED, not 1fr. globals.css gives every input
// width:100%, so a 1fr column stretched a timezone picker and a two-letter
// language select clear across a 48rem card — the control announcing itself as
// far more important than the label, and a text field wide enough to look like
// it wants an essay. 24rem is what the WIDEST rows need — seven day chips on
// one line, a pair of time pickers — so the column stays there; a row whose
// value is a short string caps its own control tighter (sm:max-w-72 on the
// General card's inputs) instead of shrinking every row to the narrowest one.
//
// The grid string lives HERE, next to the comment that documents it. It used to
// be a local const copy-pasted into SettingsView, BusinessView and AccountView,
// and three copies of one documented spec drift the moment someone tunes a gap.
export const ROW_GRID =
  "grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-[minmax(220px,260px)_minmax(0,24rem)] sm:items-start";

// The compact control for these grids, matched to TimezoneSelect's trigger —
// the one control on the Business page that was drawn deliberately rather than
// inherited from the globals.css base, and the one Serdar pointed at and said
// "like that" (2026-08-27). Same border-radius, same padding, same text size,
// and the PAGE background rather than the card's, so the box reads as a well
// in the card instead of a border floating on it. The base style stays as it
// is for every other surface; rows opt in by adding this next to their width
// cap.
//
// Since 2026-10-13 it is the control scale's sm field (Control.tsx), the same
// look with a DECLARED 32px. Built from padding it gave the Business card's
// inputs 34px and its selects ~31px, because a native select ignores
// line-height, and the Hours card's time inputs a third height of their own.
export const FIELD = fieldClass("sm");

export function RowLabel({ label, hint, hintPlacement }: { label: string; hint?: string; hintPlacement?: "above" | "below" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      {label}
      {hint && <InfoTip text={hint} placement={hintPlacement} />}
    </span>
  );
}

// RowLabel for a ROW_GRID row whose value is a control (2026-10-21, the
// Business card first). The grid is items-start, so a bare 20px label sat 6px
// above the text of the 32px field beside it. From sm this cell is a
// control's height with the label centred in it, which puts the words on the
// field's text line, on a switch's middle, and on the FIRST line of a
// multi-line box. On a phone the label stacks on its field half a row-gap
// away, so it reads as that field's and not as the foot of the row above.
// `className` places it on a taller value (sm:self-center beside a logo).
export function ControlLabel({
  label,
  hint,
  className = "",
}: {
  label: string;
  hint?: string;
  className?: string;
}) {
  return (
    <span className={`flex items-center max-sm:-mb-3 sm:min-h-8 ${className}`}>
      <RowLabel label={label} hint={hint} />
    </span>
  );
}
