// The shape of the calendar's verdict on a slot (schedule.judgeSlot, P6 of the
// Nudge port, 2026-10-13). A LEAF, values only: schedule.ts judges and
// appointments.ts reports, and appointments.ts cannot import a value from
// schedule.ts, which imports it back.

import { v, type Infer } from "convex/values";

// Why a time is not free, most fundamental first, so the sheet names the thing
// a person can act on: the business's week, then its blocked time, then the
// people (the customer, the team member picked), then the headcount.
export const slotConflictValidator = v.union(
  // The visit does not fit inside that day's opening hours.
  v.literal("outside-hours"),
  // It runs into blocked time (a closure).
  v.literal("closed"),
  // The customer already has an open booking overlapping it.
  v.literal("customer-busy"),
  // The team member picked already has one.
  v.literal("staff-busy"),
  // As many bookings overlap it as there are active team members.
  v.literal("full"),
);
export type SlotConflict = Infer<typeof slotConflictValidator>;

export const slotVerdictValidator = v.object({
  // Absent: nothing stands in the way.
  conflict: v.optional(slotConflictValidator),
  // The blocked time's own reason ("Öğle arası"), when it gave one.
  closedReason: v.optional(v.string()),
});
export type SlotVerdict = Infer<typeof slotVerdictValidator>;
