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
// The grid string lives HERE, next to the comment that documents it. It used to
// be a local const copy-pasted into SettingsView, BusinessView and AccountView,
// and three copies of one documented spec drift the moment someone tunes a gap.
export const ROW_GRID =
  "grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-[minmax(220px,260px)_1fr] sm:items-start";

export function RowLabel({ label, hint, hintPlacement }: { label: string; hint?: string; hintPlacement?: "above" | "below" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      {label}
      {hint && <InfoTip text={hint} placement={hintPlacement} />}
    </span>
  );
}
