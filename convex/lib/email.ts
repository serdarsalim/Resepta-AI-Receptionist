// Email delivery, straight to the provider. No n8n in the middle any more —
// it was one HTTP POST forwarded to a second HTTP POST, and the hop bought
// nothing: no retry we don't get from the provider, no routing we use, and one
// more box that can be down while everything else is up.
//
// Resend's REST API, called with fetch, so this stays a plain module a Convex
// ACTION can call (a mutation still cannot reach the network — see schedule.ts
// for the same rule applied to cal.com).
//
// RESEND_API_KEY is deployment-level; the From address is per-org
// (orgs.emailFrom) and must be on a domain verified in Resend, or the send is
// rejected with a 403 rather than silently spam-foldered.

const ENDPOINT = "https://api.resend.com/emails";

export type EmailSendResult = { ok: true } | { ok: false; reason: string };

// Whether this deployment can send at all. Callers check it before writing a
// queued message row, so a deployment with no key doesn't leave a trail of
// sends that were never attempted.
export function emailLaneConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(args: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, reason: "email-not-configured" };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: args.from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
      }),
    });
    if (!res.ok) {
      // The body carries WHY — an unverified domain and a malformed address
      // are both 4xx, and a bare status code sends whoever reads the log to
      // the wrong place. Truncated because it lands in a message row's error
      // column, which a salon owner may end up looking at.
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `email-http-${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "email-failed",
    };
  }
}
