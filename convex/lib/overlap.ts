// One person cannot be in two chairs at once.
//
// The booking guards elsewhere count overlapping appointments against the
// salon's CAPACITY — how many people are working — which is the right question
// for "is 14:00 free". It is the wrong question for "is 14:00 free FOR THIS
// CALLER": a two-chair salon has capacity 2 at 14:00, so the same customer
// could be booked twice into it, and on a real call to Bella exactly that
// happened. A haircut and a beard trim, both at 14:00, for one man.
//
// Capacity is about the shop. This is about the human, and no amount of
// staff makes a second one of them.
//
// Lives in its own file rather than beside overlapCount in booking.ts because
// the voice lane (retell.voiceBook) needs it too and does its own read; a
// predicate shared by two large modules should not make either import the
// other.

import type { Doc, Id } from "../_generated/dataModel";

// The conflicting appointment, or null. Returns the row rather than a boolean
// so the caller can name it — the voice agent reads the failure out loud, and
// "you already have something at two" is actable where "no" is not.
export function customerConflict(
  rows: Doc<"appointments">[],
  customerId: Id<"customers">,
  startMs: number,
  durationMinutes: number,
  ignoreId?: Id<"appointments">,
): Doc<"appointments"> | null {
  // A goods order (duration 0) is a handover, not a sitting: the customer is
  // not IN it, so it collides with nothing — not with their haircut, and not
  // with their four other cakes due the same minute.
  if (durationMinutes === 0) return null;
  const endMs = startMs + durationMinutes * 60_000;
  return (
    rows.find(
      (row) =>
        row.customerId === customerId &&
        row._id !== ignoreId &&
        // Filtered here as well as by most callers: one of the two read paths
        // hands over its raw index range, and a cancelled appointment must
        // never block the slot it freed.
        (row.status === "scheduled" || row.status === "confirmed") &&
        // The same exemption from the other side — an existing goods order
        // never blocks the person. NOT ?? here: unset means a legacy row
        // (assume 30), only an explicit 0 means goods.
        row.durationMinutes !== 0 &&
        row.startAt < endMs &&
        startMs < row.startAt + (row.durationMinutes ?? 30) * 60_000,
    ) ?? null
  );
}

// The same question about a TEAM MEMBER, for the team's own calendar (P6,
// 2026-10-13): a booking given to Gez at 10:00 while Gez already has one at
// 10:00 double-books a person even in a shop with chairs to spare. Only the
// calendar ever names a person on a booking (the booking page and the
// assistants book capacity), so only its verdict asks this
// (schedule.judgeSlot). Same exemptions as the customer's: goods hold nobody,
// and only open bookings count.
export function staffConflict(
  rows: Doc<"appointments">[],
  staffId: Id<"staff">,
  startMs: number,
  durationMinutes: number,
  ignoreId?: Id<"appointments">,
): Doc<"appointments"> | null {
  if (durationMinutes === 0) return null;
  const endMs = startMs + durationMinutes * 60_000;
  return (
    rows.find(
      (row) =>
        row.staffId === staffId &&
        row._id !== ignoreId &&
        (row.status === "scheduled" || row.status === "confirmed") &&
        row.durationMinutes !== 0 &&
        row.startAt < endMs &&
        startMs < row.startAt + (row.durationMinutes ?? 30) * 60_000,
    ) ?? null
  );
}
