// When a requested callback rings (P36 of the Nudge port). A LEAF with no
// imports, so scripts/callback-time.test.mjs can run it under node: the two
// clock questions it needs (what instant is this wall time at the business,
// and when is the business next open) are handed in by convex/callbacks.ts,
// which answers them with lib/businessHours in the business's timezone.
//
// The caller named a time on the phone and the agent's analysis wrote it down
// (CALLBACK_TIME_FIELD). What rings is that time, unless it cannot be:
//   - nothing readable, or a time already gone, or one further out than a
//     month: no call. A callback is one real call to a real phone, so a guess
//     is worse than none, and the call card still shows what was said.
//   - a time in the next few minutes is moved to a few minutes on, so the
//     line the caller just hung up on is not rung straight back;
//   - a time outside the business's calling hours or inside a closure is
//     moved to the next open minute, and says it moved, because "you called
//     at nine when I said seven" deserves an answer on the record.

// How soon after the request the phone may ring at the earliest.
export const CALLBACK_MIN_LEAD_MS = 5 * 60_000;
// How far out a callback may be asked for. Past this it is a plan, not a
// callback, and nobody will remember having asked.
export const CALLBACK_HORIZON_MS = 30 * 24 * 60 * 60_000;
// A model rounding "in five minutes" down to the minute the call ended reads
// as a few minutes ago; that is still a request for now, not a time gone.
const PAST_SLACK_MS = 10 * 60_000;

export type CallbackTime =
  | {
      ok: true;
      // The instant the caller named.
      askedFor: number;
      // When the call rings: askedFor, or the next open minute after it.
      dueAt: number;
      // dueAt is not the time they named, because the business is closed
      // then (not merely the few minutes of minimum lead).
      moved: boolean;
    }
  | { ok: false; reason: "unreadable" | "past" | "too-far" | "no-opening" };

export function judgeCallbackTime(
  raw: unknown,
  now: number,
  clock: {
    // The instant of a wall time at the business, NaN when unreadable.
    parse: (text: string) => number;
    // The first open minute at or after an instant, null when none is near.
    openAt: (ms: number) => number | null;
  },
): CallbackTime {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, reason: "unreadable" };
  const askedFor = clock.parse(text);
  if (!Number.isFinite(askedFor)) return { ok: false, reason: "unreadable" };
  if (askedFor < now - PAST_SLACK_MS) return { ok: false, reason: "past" };
  if (askedFor > now + CALLBACK_HORIZON_MS) return { ok: false, reason: "too-far" };
  const earliest = Math.max(askedFor, now + CALLBACK_MIN_LEAD_MS);
  const dueAt = clock.openAt(earliest);
  if (dueAt === null) return { ok: false, reason: "no-opening" };
  return { ok: true, askedFor, dueAt, moved: dueAt > earliest };
}
