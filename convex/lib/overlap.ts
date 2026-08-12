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
        row.startAt < endMs &&
        startMs < row.startAt + (row.durationMinutes ?? 30) * 60_000,
    ) ?? null
  );
}
