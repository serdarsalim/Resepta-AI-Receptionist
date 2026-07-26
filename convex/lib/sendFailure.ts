// Is this failure worth trying again?
//
// The send path reports failures as strings — Meta's are shaped
// `wa-cloud-http-<status>-<code>: <message>` (lib/waCloud.ts), the email lane's
// come from the provider, and the rest are our own refusals before anything
// left the building. Retrying the wrong one is not free: a send that can never
// succeed burns the budget for six attempts and then reports a dead letter,
// which trains the salon to ignore the alert that matters.
//
// The split is about whether ANYTHING could change between now and later
// without a human doing something:
//
//   transient   the provider was busy, rate-limited, or unreachable. Same
//               request, later, plausibly works.
//   permanent   the request itself is refused — no consent, no approved
//               template, the 24h window shut, a bad token. Later changes
//               nothing until somebody acts.
//
// When in doubt this returns permanent. A failure we wrongly stop retrying
// shows up as one failed row the salon can see; a failure we wrongly retry
// forever is invisible load plus a delayed, misleading dead-letter alert.

export type FailureClass = "transient" | "permanent";

// Our own refusals, raised before the provider was ever called.
const LOCAL_REFUSALS = new Set([
  "no-consent",
  "wa-not-configured",
  "session-window-closed",
  "email-not-configured",
  "customer-missing",
  "no-body",
]);

// Meta error codes that mean "too fast", not "no". Worth naming individually
// because they arrive with an HTTP 400, which is otherwise permanent.
// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const RATE_LIMIT_CODES = new Set([
  "130429", // rate limit hit
  "131048", // spam rate limit
  "131056", // pair rate limit (this business ↔ this customer)
  "133016", // account temporarily blocked, retry later
  "4", // application request limit reached
  "80007", // rate limit issues
]);

export function classifyFailure(reason: string | undefined): FailureClass {
  if (!reason) return "permanent";
  if (LOCAL_REFUSALS.has(reason)) return "permanent";
  if (reason.startsWith("no-approved-template")) return "permanent";

  const http = reason.match(/^wa-cloud-http-(\d{3})(?:-(\d+))?/);
  if (http) {
    const status = Number(http[1]);
    const code = http[2];
    if (code && RATE_LIMIT_CODES.has(code)) return "transient";
    // 5xx is the provider's problem and it usually passes.
    if (status >= 500) return "transient";
    // Too Many Requests / Request Timeout.
    if (status === 429 || status === 408) return "transient";
    // Everything else in 4xx is a refusal: a bad token (401/403) needs the
    // owner to reconnect, an unapproved template needs Meta, 131047 needs the
    // customer to write first. None of them heal on their own.
    return "permanent";
  }

  // Resend surfaces its own shapes; treat its 5xx and rate limit the same way.
  const email = reason.match(/^email-http-(\d{3})/);
  if (email) {
    const status = Number(email[1]);
    return status >= 500 || status === 429 ? "transient" : "permanent";
  }

  // No recognisable status: this is the catch block in postWaCloud, i.e. fetch
  // itself threw — DNS, connection reset, timeout. That is the most retryable
  // failure there is.
  return "transient";
}

// Backoff schedule, in milliseconds, indexed by the attempt that just failed.
// Front-loaded because most transient failures are brief, then stretched so a
// genuinely down provider is not hammered: ~1m, 5m, 15m, 1h, 3h. Five waits
// means MAX_ATTEMPTS attempts spread over roughly four and a half hours before
// the row dead-letters.
const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 10_800_000];

export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;

// When to try again after `attempts` failures. Undefined once the budget is
// spent, which is the caller's signal to dead-letter.
export function nextAttemptDelay(attempts: number): number | undefined {
  return BACKOFF_MS[attempts - 1];
}
