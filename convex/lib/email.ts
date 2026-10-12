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
// exactly ONE such domain here — Resepta's own (RESEND_INBOUND_DOMAIN, the one
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
  return cleaned || "Resepta";
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

// The origin every link inside customer mail is built on: the app's own site
// (SITE_URL, https://app.resepta.xyz in production), not this deployment's
// bare *.convex.site host (2026-10-13). A link domain that matches nothing
// the mail is from reads as unbranded to the reader and as a warning sign to
// spam filters, and every business sends from our one shared domain, so all
// of them paid for it. src/proxy.ts forwards /e/o/ and /e/u/ on that origin,
// method and body intact, to the Convex routes in convex/http.ts, which still
// hold the logic and still answer the convex.site links in mail sent before
// this. Falls back to the Convex site when SITE_URL is unset, so a deployment
// configured without it keeps tracking and unsubscribing.
function emailLinkOrigin(): string | undefined {
  const site = process.env.SITE_URL || process.env.CONVEX_SITE_URL;
  return site ? site.replace(/\/+$/, "") : undefined;
}

// Open-pixel injection: rule mail (confirmations, reminders, cancellation
// notices, follow-ups, win-backs), campaign and bulk mail. The route
// (/e/o/<token>) records the open on the row in this deployment's database.
// Appended after the body — our customer mail is a single paragraph, there is
// no </body> to slot before. No token or no site URL means the mail simply
// goes untracked; a missing pixel must never block a send.
export function withOpenPixel(html: string, token: string | undefined): string {
  const site = emailLinkOrigin();
  if (!token || !site) return html;
  return `${html}<img src="${site}/e/o/${token}" width="1" height="1" alt="" style="display:none;max-height:1px;max-width:1px;" />`;
}

// ── Marketing mail and its unsubscribe ─────────────────────────────────────
//
// Which customer mail is MARKETING: a campaign, a bulk run, a win-back. These
// carry a visible unsubscribe link and the List-Unsubscribe headers, and stop
// for a customer who used one (customers.marketingEmailOptOutAt). Everything
// else a business sends by email (confirmations, reminders, follow-ups,
// cancellation notices, replies typed in the composer) is transactional or a
// conversation, carries no link, and never stops for an opt-out.
//
// By message kind, because the kind is the one fact every send path already
// has on the row: the first attempt, the retry queue and the claim.
const MARKETING_EMAIL_KINDS: ReadonlySet<string> = new Set([
  "email_campaign",
  "email_bulk",
  "email_winback",
]);

export function isMarketingEmailKind(kind: string): boolean {
  return MARKETING_EMAIL_KINDS.has(kind);
}

// The link behind "Unsubscribe", on the app's own origin (emailLinkOrigin
// above; the route is convex/http.ts /e/u/<token>). The token is the message
// row's trackingToken: random, minted per message, resolving to exactly one
// business and one customer. Every business sends from the same domain, so
// nothing about the link may name or reach another business; a token is all
// it carries.
export function unsubscribeUrl(token: string | undefined): string | undefined {
  const site = emailLinkOrigin();
  if (!token || !site) return undefined;
  return `${site}/e/u/${token}`;
}

// The visible link at the foot of a marketing mail, in the customer's
// language. Small and grey, after the body and before the open pixel. A mail
// with no link URL (no site URL configured) goes without it rather than with a
// dead one.
const UNSUBSCRIBE_LABEL: Record<string, string> = {
  tr: "Abonelikten çık",
  en: "Unsubscribe",
  de: "Abmelden",
};

export function withUnsubscribeFooter(
  html: string,
  url: string | undefined,
  language: string | undefined,
): string {
  if (!url) return html;
  const lang = (language ?? "").trim().toLowerCase().slice(0, 2);
  const label = UNSUBSCRIBE_LABEL[lang] ?? UNSUBSCRIBE_LABEL.en;
  return `${html}<p style="margin-top:24px;font-size:12px;line-height:1.4;color:#8a8a8a;"><a href="${url}" style="color:#8a8a8a;">${label}</a></p>`;
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
  // Marketing mail only (isMarketingEmailKind): the same link as the visible
  // footer, as RFC 2369 List-Unsubscribe plus RFC 8058 one-click, which is
  // what Gmail and Yahoo require of bulk senders and what lets a mail client
  // show its own Unsubscribe button. The client POSTs to the URL, and the
  // route's POST is what unsubscribes.
  unsubscribeUrl?: string;
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
        ...(args.unsubscribeUrl
          ? {
              headers: {
                "List-Unsubscribe": `<${args.unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
          : {}),
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
