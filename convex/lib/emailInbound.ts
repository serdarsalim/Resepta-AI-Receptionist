// Inbound email: verifying Resend's webhook, and fetching the message it only
// told us about.
//
// TWO CALLS, not one, and that is Resend's design rather than ours: the
// `email.received` webhook carries METADATA ONLY — id, from, to, subject — and
// the body has to be fetched from the receiving API with that id. So the route
// verifies, then reads.

const RECEIVING_ENDPOINT = "https://api.resend.com/emails/receiving";

// Resend signs webhooks with Svix. The signed string is
// `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 under the secret, base64. The
// secret arrives as "whsec_<base64>" and it is the DECODED bytes that key the
// HMAC — using the printable string as the key is the classic way this check
// passes review and fails in production.
//
// The signature header holds space-separated `v1,<sig>` pairs so a secret can
// be rotated without dropping deliveries; any one matching is a pass.
export async function verifyResendSignature(args: {
  secret: string;
  rawBody: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}): Promise<boolean> {
  const { secret, rawBody, id, timestamp, signature } = args;
  if (!id || !timestamp || !signature) return false;

  // Replay guard. Svix stamps seconds; anything older than five minutes is
  // either a replay or a clock so wrong that failing closed is correct.
  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > 5 * 60_000) {
    return false;
  }

  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  return signature
    .split(" ")
    .map((part) => part.split(",")[1])
    .some((candidate) => candidate !== undefined && timingSafeEqual(candidate, expected));
}

// Constant-time compare. A plain === leaks how much of the signature matched
// through timing, which is enough to forge one byte at a time.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type ReceivedEmail = { text?: string; html?: string };

// The second call: the body Resend kept back.
export async function fetchReceivedEmail(
  emailId: string,
): Promise<ReceivedEmail | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`${RECEIVING_ENDPOINT}/${emailId}`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as ReceivedEmail;
    return body;
  } catch {
    return null;
  }
}

// "Ayşe Yılmaz <ayse@example.com>" → "ayse@example.com". Real From headers
// carry the display name, and matching a customer on the whole string never
// hits. Ported from Nudge, which learned this from an IMAP feed.
export function bareAddress(input: string): string {
  const angled = /<([^>]+)>/.exec(input);
  return (angled ? angled[1] : input).trim().toLowerCase();
}

// The local part of an address on OUR domain — the org routing key.
export function localPart(address: string): string {
  return bareAddress(address).split("@")[0] ?? "";
}

// HTML → something a chat bubble can show. Not a renderer: the bubble is one
// line of a timeline, and the customer's actual formatting matters far less
// than being able to read what they said at a glance. Used only when the
// message has no plain-text alternative.
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// "Re: Re: RE: Randevunuz" → "randevunuz". The thread key: a reply chain is
// one conversation however many clients have prefixed it, and Turkish mail
// clients add "Yn:" where English ones add "Re:".
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^\s*((re|fwd?|yn|ilt|aw|wg)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}
