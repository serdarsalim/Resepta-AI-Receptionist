"use client";

import { InfoTip } from "./InfoTip";

// Left-column label for the label-left/input-right settings grids. Shared by
// the Settings and Workspace setup cards.
//
// The grid MUST be the responsive form — one column on phones, two from sm:
//
//   grid grid-cols-1 gap-y-2 sm:grid-cols-[22rem_1fr] sm:items-center
//   sm:gap-x-4 sm:gap-y-3
//
// A bare `grid-cols-[22rem_1fr]` reserves 352px for labels, which on a 390px
// phone pushes the entire input column off-screen. Add
// `[&>*:nth-child(even)]:mb-3 sm:[&>*:nth-child(even)]:mb-0` when the inputs
// are tall enough that stacked rows need breathing room between pairs.
export function RowLabel({ label, hint, hintPlacement }: { label: string; hint?: string; hintPlacement?: "above" | "below" }) {
  return (
    <span className="text-sm font-medium inline-flex items-center gap-1.5 whitespace-nowrap">
      {label}
      {hint && <InfoTip text={hint} placement={hintPlacement} />}
    </span>
  );
}
