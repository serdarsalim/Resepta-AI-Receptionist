// What a call came to, read from the phone provider's disconnect code, and
// which refusals are worth another try (2026-10-17, P6b of the Nudge port).
// A LEAF with no imports: the bulk call
// queue, the run detail in the browser, the MCP activity report and
// scripts/call-outcome.test.mjs all read it, and a Convex import here would
// put the server graph in the browser bundle.
//
// The code is the honest source, and the only one this needs. Before it, a
// bulk run's row said "Sent" for every call that ended without a duration,
// which is most of the calls nobody picked up (a leg that never connects has
// no start to measure from), and the activity report counted any call with a
// duration as answered, voicemail included. Nudge answers "did anybody speak"
// by reading the transcript (its lib/personSpoke); those word lists are
// English and this product speaks three languages, so here the codes decide.

export type CallOutcome =
  // The line was picked up and the call ran.
  | "answered"
  // Voicemail or an answering machine took it.
  | "voicemail"
  // The line was busy.
  | "busy"
  // It rang and they turned it down.
  | "declined"
  // It rang out.
  | "no-answer"
  // The phone network, or the provider, would not place it. Nothing rang.
  | "refused"
  // It broke on the way. Nothing reliable reached the phone.
  | "failed";

// The provider's codes as it spells them. A Map rather than an object
// literal, so a code like "constructor" can never match a prototype key.
const OUTCOME_BY_CODE = new Map<string, CallOutcome>([
  ["user_hangup", "answered"],
  ["agent_hangup", "answered"],
  ["call_transfer", "answered"],
  ["transfer_bridged", "answered"],
  ["transfer_cancelled", "answered"],
  // The line was open and went quiet until the provider's timeout: it
  // connected, and a person may well have spoken first.
  ["inactivity", "answered"],
  ["max_duration_reached", "answered"],
  ["voicemail_reached", "voicemail"],
  ["machine_detected", "voicemail"],
  ["ivr_reached", "voicemail"],
  ["dial_busy", "busy"],
  ["user_declined", "declined"],
  ["dial_no_answer", "no-answer"],
  // The carrier rejected the number before ringing it (Nudge f6394537: six of
  // its leads were walked to Cancelled by a cadence that read this as
  // "didn't answer", without their phones ringing once).
  ["telephony_provider_permission_denied", "refused"],
  ["telephony_provider_unavailable", "refused"],
  ["invalid_destination", "refused"],
  ["marked_as_spam", "refused"],
  ["scam_detected", "refused"],
  ["no_valid_payment", "refused"],
  // Every line on the shared account was in use.
  ["concurrency_limit_reached", "refused"],
  ["dial_failed", "failed"],
  ["sip_routing_error", "failed"],
]);

// What the call came to. A code nobody has met yet, or a row written before
// the code was kept, falls back to the duration, which is what decided every
// call before this; with neither there is nothing to say (undefined).
export function callOutcome(
  reason: string | null | undefined,
  durationSec?: number | null,
): CallOutcome | undefined {
  const code = (reason ?? "").trim().toLowerCase();
  const known = OUTCOME_BY_CODE.get(code);
  if (known) return known;
  // The provider's own faults all start "error_" (its LLM socket, no audio,
  // an unknown failure), and none of them is a call that reached anyone.
  if (code.startsWith("error")) return "failed";
  if (durationSec === undefined || durationSec === null) return undefined;
  return durationSec > 0 ? "answered" : "no-answer";
}

// Did the call reach the customer's phone at all: it rang, or a person or a
// machine picked up. A refused or failed call did not, so it is not a call
// anybody received, and a queue must not count it as one.
export function reachedPhone(outcome: CallOutcome): boolean {
  return outcome !== "refused" && outcome !== "failed";
}

// Nothing rang, and the same dial a few minutes later can work: the shared
// account's lines were all in use, or the carrier was briefly unavailable.
// The bulk call queue puts the customer back in line for these rather than
// counting them as called (bulkRuns.requeueCall).
const RETRYABLE_ENDS = new Set(["concurrency_limit_reached", "telephony_provider_unavailable"]);

export function isRetryableCallEnd(reason: string | null | undefined): boolean {
  return RETRYABLE_ENDS.has((reason ?? "").trim().toLowerCase());
}

// The provider refused the call because of the ACCOUNT, not this customer:
// every next call would end the same way, so a queue stops rather than spend
// its list on it (bulkRuns: the run pauses).
export function isAccountRefusal(reason: string | null | undefined): boolean {
  return (reason ?? "").trim().toLowerCase() === "no_valid_payment";
}

// The same question at dial time, about the error the create-call request
// threw, as cleanError leaves it ("retell-429: {...}"). Retry what a later
// attempt can plausibly pass: 429 (rate or concurrency) and 5xx (the provider
// failing), plus a full pool named in the body, because the status a full
// pool rides on has moved before (Nudge abbbbdff). A 4xx about the request
// itself (a bad number, a bad key) fails identically forever and is not
// retried; nor is a thrown fetch with no answer at all, because that call may
// be ringing and a second dial would ring the customer twice.
export function isRetryableDialError(message: string): boolean {
  if (/^retell-(?:429|5\d\d)\b/.test(message)) return true;
  return /concurrency|rate.?limit|too many (?:requests|calls|concurrent)|capacity/i.test(message);
}
