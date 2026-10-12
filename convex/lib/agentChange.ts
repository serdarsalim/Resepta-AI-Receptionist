// The assistants' daily change cap, and the words both lanes use when a move
// or a cancel is refused.
//
// A LEAF: it imports nothing, so http.ts, chatAgent.ts and agentAppointments.ts
// can all read it without an import cycle between them.
//
// Ported from Nudge (bookingLinks.CHANGES_PER_DAY, meetingTools.ts,
// 2026-10-11), with Nudge's number: six changes a day per customer, counted
// over the trailing 24 hours on customers.agentChangesAt. A BOOKING is counted
// and never refused, because the count is what stops a cancel-and-rebook loop.
// A move or a cancel past the sixth is refused, and the agent is told to hand
// it to a person. It is one person changing one diary whichever assistant they
// reach, so the phone and WhatsApp count against the same six.

export const CHANGES_PER_DAY = 6;
export const CHANGE_WINDOW_MS = 24 * 60 * 60_000;
// Bounds the stored array. Bookings are never refused, so a busy day can hold
// more than six entries; twenty is far past anything the cap needs to read.
const KEPT = 20;

export function changesToday(
  times: readonly number[] | undefined,
  now: number,
): number {
  return (times ?? []).filter((at) => at > now - CHANGE_WINDOW_MS).length;
}

// The stored array after one more change: trimmed to the window, then capped.
export function withChange(
  times: readonly number[] | undefined,
  now: number,
): number[] {
  return [...(times ?? []).filter((at) => at > now - CHANGE_WINDOW_MS), now].slice(
    -KEPT,
  );
}

// Why a move or a cancel was not made. One vocabulary for the write
// (agentAppointments.ts), both agents' answers and the draft approval.
export type ChangeRefusal =
  // No such appointment for this customer in this org.
  | "not-found"
  // No longer their next appointment, no longer open, or its time moved since
  // the agent looked. The agent must look again rather than act on old facts.
  | "appointment-changed"
  | "too-many-changes"
  | "past"
  | "too-far"
  // A good that needs more notice than the new time leaves.
  | "lead-time"
  // The new span leaves the day's opening hours or runs into a closure.
  | "outside-open-hours"
  // Every person is busy at the new time.
  | "slot-taken"
  // The customer already has another appointment overlapping the new time.
  | "customer-busy"
  // The calendar provider refused or could not be reached.
  | "calendar-error";

export const CHANGE_REFUSALS: readonly ChangeRefusal[] = [
  "not-found",
  "appointment-changed",
  "too-many-changes",
  "past",
  "too-far",
  "lead-time",
  "outside-open-hours",
  "slot-taken",
  "customer-busy",
  "calendar-error",
];

export function isChangeRefusal(reason: string): reason is ChangeRefusal {
  return (CHANGE_REFUSALS as readonly string[]).includes(reason);
}

// What the agent is told when a move or a cancel is refused: a fact it can
// act on, in English, for the model to say in the conversation's language.
// The house style of every tool note: a bare code becomes "something went
// wrong" in front of the customer.
//
// The two lanes differ only where they must. On the phone the person is "the
// caller", and a promise that a colleague will be in touch is backed by an
// email to the team (http.ts). In a chat the person is "the customer", and the
// promise goes through escalate_to_staff, which follows the business's own
// handover setting rather than a second rule here.
export function changeRefusalNote(
  reason: ChangeRefusal,
  did: "moved" | "cancelled",
  lane: "voice" | "chat",
): string {
  const who = lane === "voice" ? "caller" : "customer";
  const lookAgain =
    lane === "voice" ? "Call find_appointment again" : "Call my_appointments again";
  const person =
    lane === "voice"
      ? `Tell the ${who} a colleague will be in touch about it, and carry on.`
      : `Tell the ${who} a person from the team will take care of it, then call escalate_to_staff.`;
  switch (reason) {
    case "too-many-changes":
      return `This ${who}'s appointments have already been changed too many times today, so it was NOT ${did}. ${person}`;
    case "appointment-changed":
      return `That appointment changed since you looked it up, so it was NOT ${did}. ${lookAgain} before saying anything about it.`;
    case "not-found":
      return `There is no upcoming appointment to change, so nothing was ${did}.`;
    case "slot-taken":
      return `That time is already full, so it was NOT ${did}; it stays at its old time. Check availability for that day and offer a free time.`;
    case "customer-busy":
      return `The ${who} already has another appointment overlapping that time, so it was NOT ${did}. Offer a time that does not overlap it.`;
    case "outside-open-hours":
      return `The appointment would start outside the opening hours, run past closing, or run into a closed period then, so it was NOT ${did}. Offer a time that fits inside open_hours.`;
    case "lead-time":
      return `That order needs more notice than that, so it was NOT ${did}. Offer a later day.`;
    case "past":
      return `That time has already passed, so it was NOT ${did}.`;
    case "too-far":
      return `That is too far ahead, so it was NOT ${did}.`;
    case "calendar-error":
      return `The calendar could not make the change just now, so it was NOT ${did}. ${person}`;
  }
}
