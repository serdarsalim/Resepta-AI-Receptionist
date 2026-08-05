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

import type { EmailConfig } from "./platformConfig";

const ENDPOINT = "https://api.resend.com/emails";

export type EmailSendResult = { ok: true } | { ok: false; reason: string };

// ── Who the mail says it is from ────────────────────────────────────────────
//
// Resend will only accept a From on a domain verified in the account. There is
// exactly ONE such domain here — Randevu's own (RESEND_INBOUND_DOMAIN, the one
// that already carries every org's incoming address) — and a salon that has
// verified a domain of their own on top.
//
// So orgs.emailFrom is an UPGRADE, never a requirement. Demanding it before a
// reminder could go out meant asking a hairdresser to add DNS records, which
// is why the email lane sat dark: the address the salon already has
// (guzellik@mail.randevu.app) was sitting right there, verified, unused.

// A display name safe to put in a From header. Quoted rather than escaped in
// place, so a salon called "Güzellik, Kadıköy" doesn't parse as two addresses.
// Empty falls back to the product name — a fresh org has name: "" until
// onboarding, and `"" <addr>` is not a thing to send to a customer.
function displayName(raw: string | undefined): string {
  const cleaned = (raw ?? "").replace(/[\r\n"\\]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Mahlas";
}

// Mail RANDEVU writes: invites, alerts about the account. From the product,
// never from the salon — an alert saying a salon's message failed should not
// arrive wearing that salon's name.
export function productSender(config: EmailConfig): string | undefined {
  return config.domain
    ? `${displayName(config.productName)} <noreply@${config.domain}>`
    : undefined;
}

// Mail a SALON writes to its customers: confirmations, reminders, campaigns,
// replies typed in the composer. Three tiers, best first:
//
//   1. their own verified domain, when they went and set one up;
//   2. their incoming address on ours — From and Reply-To become the same
//      address, so a customer hitting reply lands in the Inbox by default;
//   3. noreply@ours, so a salon that has set nothing at all still sends.
//
// Undefined only when the deployment itself has no domain, which is a config
// problem no salon can fix and the caller reports as email-not-configured.
export function customerSender(
  org: { name?: string; emailFrom?: string; inboundAddress?: string },
  config: EmailConfig,
): string | undefined {
  const domain = config.domain;
  const address =
    org.emailFrom ??
    (domain && org.inboundAddress ? `${org.inboundAddress}@${domain}` : undefined) ??
    (domain ? `noreply@${domain}` : undefined);
  return address
    ? `${displayName(org.name ?? config.productName)} <${address}>`
    : undefined;
}

// Plain text → the one HTML shape customer mail uses. Escaped first so a name
// with an ampersand in it cannot become markup, then newlines become breaks so
// the mail reads the way it was written.
export function emailBodyHtml(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<p>${escaped.replace(/\n/g, "<br/>")}</p>`;
}

// Whether this deployment can send at all. Callers check it before writing a
// queued message row, so a deployment with no key doesn't leave a trail of
// sends that were never attempted. Takes the resolved config rather than
// reading the environment, because the key now lives in platformConfig where
// the operator can set it (see lib/platformConfig).
export function emailLaneConfigured(config: EmailConfig): boolean {
  return Boolean(config.apiKey);
}

// Open-pixel injection, winback and campaign mail only. The URL is this
// deployment's own convex.site route (/e/o/<token>, convex/http.ts), so the
// hit lands in the right deployment's database. Appended after the body — our
// customer mail is a single paragraph, there is no </body> to slot before.
// No token or no site URL means the mail simply goes untracked; a missing
// pixel must never block a send.
export function withOpenPixel(html: string, token: string | undefined): string {
  const site = process.env.CONVEX_SITE_URL;
  if (!token || !site) return html;
  return `${html}<img src="${site}/e/o/${token}" width="1" height="1" alt="" style="display:none;max-height:1px;max-width:1px;" />`;
}

// UTF-8-safe base64: btoa alone throws on anything past latin1, and an invite
// for "Erkek saç kesimi" is past latin1 on its first ç. Chunked so the
// fromCharCode spread never meets an argument-count ceiling.
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x1000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x1000));
  }
  return btoa(binary);
}

export async function sendEmail(args: {
  // The provider key, resolved by the caller from platformConfig.
  apiKey: string | null;
  from: string;
  to: string;
  subject: string;
  html: string;
  // Where a reply should go. For customer mail this is the org's own inbound
  // address, so the answer comes back into the app instead of dead-ending in
  // whichever mailbox the From address belongs to.
  replyTo?: string;
  // A calendar invite riding along (lib/ics.ts). The method repeats in the
  // attachment's content type because that parameter — not the filename — is
  // what mail clients key on to offer the event.
  ics?: { content: string; method: "REQUEST" | "CANCEL" };
}): Promise<EmailSendResult> {
  const apiKey = args.apiKey;
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
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
        ...(args.ics
          ? {
              attachments: [
                {
                  filename: "invite.ics",
                  content: toBase64(args.ics.content),
                  content_type: `text/calendar; method=${args.ics.method}; charset=utf-8`,
                },
              ],
            }
          : {}),
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
