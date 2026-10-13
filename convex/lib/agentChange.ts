// The assistants' daily change cap, the words both lanes use when a move or a
// cancel is refused, and the shape of a change a draft is still waiting to
// make.
//
// A LEAF: it imports only convex/values and the minNotice leaf, so http.ts,
// chatAgent.ts, agentAppointments.ts and the schema can all read it without an
// import cycle between them.
import { v, type Infer } from "convex/values";
import { noticeSpan } from "./minNotice";
//
// Ported from Nudge (bookingLinks.CHANGES_PER_DAY, meetingTools.ts,
// 2026-10-11), with Nudge's number: six changes a day per customer, counted
// over the trailing 24 hours on customers.agentChangesAt. It is one person
// changing one diary whichever door they use, so the phone and WhatsApp
// assistants, the customer's own manage page (booking.reschedule /
// booking.cancel) and their own WhatsApp cancel (typed İPTAL or the cancel
// button, webhook.ts) all count against the same six.
//
// Who is refused past it (decided 2026-10-13, after a review showed a
// cancel-by-button and rebook-by-assistant loop the count never stopped):
// the assistants refuse moves, cancels AND new bookings, and hand over to a
// person; the manage page refuses moves. A customer's own CANCEL, on the
// manage page or by WhatsApp, is counted and never refused: cancelling is
// always theirs.

export const CHANGES_PER_DAY = 6;
export const CHANGE_WINDOW_MS = 24 * 60 * 60_000;
// How long after a change a second one that names its appointment loosely
// is read as a possible repeat: long enough to cover a provider retry and a
// customer saying "yes" twice, short enough that a real second change later
// in a long call goes through. A start alone, with something else changed
// at that minute or at the destination within it, is asked about rather
// than acted on (agentAppointments.ownTarget); a phone engine with no
// appointment_start is refused a second change inside it (http.ts).
export const REPEAT_WINDOW_MS = 3 * 60_000;
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
  // What the agent named fits more than one of the customer's appointments:
  // a start alone, at a minute holding several (two orders for 10:00), or a
  // minute where one was just changed. The agent asks which, from the list
  // the refusal carries, instead of the write picking one.
  | "appointment-ambiguous"
  // Two of their appointments at that minute are identical, services and
  // all (or an engine that cannot name services meets two): nothing the
  // agent can say picks one, so a person does.
  | "appointment-duplicate"
  | "too-many-changes"
  | "past"
  | "too-far"
  // Sooner than the business's minimum notice (orgs.minNoticeHours,
  // lib/minNotice), which binds a move as it binds a booking.
  | "too-soon"
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
  "appointment-ambiguous",
  "appointment-duplicate",
  "too-many-changes",
  "past",
  "too-far",
  "too-soon",
  "lead-time",
  "outside-open-hours",
  "slot-taken",
  "customer-busy",
  "calendar-error",
];

// The refusals a different TIME fixes, and so the ones answered with the
// nearest free times (retell.nearestFreeTimes) rather than a bare no.
export function isTimeRefusal(reason: string): boolean {
  return (
    reason === "slot-taken" ||
    reason === "customer-busy" ||
    reason === "outside-open-hours" ||
    reason === "too-soon" ||
    reason === "lead-time" ||
    reason === "past"
  );
}

// What the agent is told beside a nearest_free list.
export const NEAREST_FREE_NOTE =
  "nearest_free lists the closest free times either side of the one asked for: offer those rather than a bare no.";

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
  did: "moved" | "cancelled" | "booked",
  lane: "voice" | "chat",
  // The business's minimum notice in hours, for the too-soon sentence.
  facts?: { noticeHours?: number },
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
    case "appointment-ambiguous":
      return `More than one of the ${who}'s appointments is at that time, so nothing was ${did}. appointments_at_that_time lists them: ask which one they mean, then call this again with that one's appointment_services exactly as listed.`;
    case "appointment-duplicate":
      return `More than one appointment fits, and nothing you can pass tells them apart, so nothing was ${did}. ${person}`;
    case "not-found":
      return `There is no upcoming appointment to change, so nothing was ${did}.`;
    case "slot-taken":
      return `That time is already full, so it was NOT ${did}; it stays at its old time. Check availability for that day and offer a free time.`;
    case "customer-busy":
      return `The ${who} already has another appointment overlapping that time, so it was NOT ${did}. Offer a time that does not overlap it.`;
    case "outside-open-hours":
      return `The appointment would start outside the opening hours, run past closing, or run into a closed period then, so it was NOT ${did}. Offer a time that fits inside open_hours.`;
    case "too-soon":
      return facts?.noticeHours
        ? `That is too soon: this business takes appointments at least ${noticeSpan(facts.noticeHours)} ahead, so it was NOT ${did}. Offer a later time.`
        : `That is too soon for this business, so it was NOT ${did}. Offer a later time.`;
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

// Whether two lists name the same services: what the agent read back against
// what a row holds (its items' names), ignoring order, case and spacing. An
// appointment with no services is the empty list, and matches only that.
export function sameServiceNames(
  a: readonly string[],
  b: readonly string[],
): boolean {
  const key = (names: readonly string[]) =>
    names
      .map((name) => name.trim().toLocaleLowerCase("tr-TR"))
      .sort()
      .join("\n");
  return a.length === b.length && key(a) === key(b);
}

// A change a chat reply would make, recorded on its chatAgentTurns row
// instead of made (2026-10-13, Nudge's lib/meetingChange.ts meetingIntentV in
// Resepta's words). In suggest and shadow the tools run every check and write
// nothing; a suggested reply's changes are made only when a person sends it
// (chatAgent.sendSuggestion), re-checked at that moment, and the reply goes
// only if every one of them took.
export const agentIntentValidator = v.union(
  v.object({
    kind: v.literal("book"),
    // The name to book under, as book_appointment resolved it.
    name: v.string(),
    // The confirmed start, UTC ms. An asap order carries the moment the
    // draft was written, and approval places it "now" instead.
    start: v.number(),
    asap: v.optional(v.boolean()),
    // What the customer asked for, in their own words: matched again at
    // approval against what the business sells then.
    services: v.array(v.string()),
    // What those words matched when the draft was written, for the line
    // above the composer.
    serviceNames: v.array(v.string()),
    fulfillment: v.optional(
      v.object({
        kind: v.union(v.literal("pickup"), v.literal("delivery")),
        address: v.optional(v.string()),
      }),
    ),
  }),
  v.object({
    kind: v.literal("move"),
    // Which appointment: the customer's own open one starting at `from`, the
    // start the assistant read back, with the services it read back when it
    // gave them (two orders can share a minute). The id is a note of which
    // row that was when the draft was written; the target is always found by
    // `from` and `services`.
    appointmentId: v.optional(v.id("appointments")),
    from: v.number(),
    services: v.optional(v.array(v.string())),
    to: v.number(),
  }),
  v.object({
    kind: v.literal("cancel"),
    appointmentId: v.optional(v.id("appointments")),
    from: v.number(),
    services: v.optional(v.array(v.string())),
  }),
  v.object({
    kind: v.literal("save"),
    // Only the keys the write gate accepted in the dry run.
    values: v.record(v.string(), v.string()),
    // Their labels, for the line above the composer.
    labels: v.array(v.string()),
  }),
);
export type AgentIntent = Infer<typeof agentIntentValidator>;

// Why sending a draft did not go through, as the composer shows it. The
// change comes FIRST and the words only if it took, so every one of these
// but the last means nothing was sent; the last means the change was made
// and the reply was not.
export type ApprovalFailure =
  | "change-slot-taken"
  | "change-customer-busy"
  | "change-time-not-allowed"
  | "change-appointment-changed"
  | "change-too-many"
  | "change-too-many-upcoming"
  | "change-failed"
  | "changed-not-sent";

// A refusal from any change path, booking included, as one of the above.
// The booking path answers in sentences ("customer-busy: this caller…"),
// hence the prefix tests.
export function approvalFailureOf(reason: string): ApprovalFailure {
  if (reason.startsWith("slot-taken")) return "change-slot-taken";
  if (reason.startsWith("customer-busy")) return "change-customer-busy";
  if (
    reason === "past" ||
    reason === "too-far" ||
    reason === "too-soon" ||
    reason === "outside-open-hours" ||
    reason.startsWith("lead-time") ||
    reason.startsWith("start-is-")
  ) {
    return "change-time-not-allowed";
  }
  if (
    reason === "appointment-changed" ||
    reason === "appointment-ambiguous" ||
    reason === "not-found"
  ) {
    return "change-appointment-changed";
  }
  if (reason === "too-many-changes") return "change-too-many";
  if (reason.startsWith("too-many-upcoming")) return "change-too-many-upcoming";
  return "change-failed";
}
