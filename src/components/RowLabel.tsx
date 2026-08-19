"use client";

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

export function RowLabel({ label, hint, hintPlacement }: { label: string; hint?: string; hintPlacement?: "above" | "below" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      {label}
      {hint && <InfoTip text={hint} placement={hintPlacement} />}
    </span>
  );
}
