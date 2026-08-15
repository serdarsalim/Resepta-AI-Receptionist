// Meta webhook signature verification (X-Hub-Signature-256): HMAC-SHA256 of
// the RAW request body with the Meta app secret, hex-encoded, prefixed
// "sha256=". Verified before the body is parsed; http.ts fails closed when
// WA_APP_SECRET is set and fails open (with a warning) when it isn't — prod
// deployments must set it.

function hexOf(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time-ish compare: length check + full-scan XOR. Not a substitute
// for crypto.subtle.verify semantics, but avoids early-exit timing on the
// prefix.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return hexOf(mac);
}

// Retell signs webhooks as "v=<ms timestamp>,d=<hex>" where the digest is
// HMAC-SHA256 of rawBody + timestamp with the workspace's webhook signing
// key — the SCHEME IS NOT hmac(body): the timestamp is concatenated into the
// MAC input, and a stale timestamp is rejected outright (their SDK uses five
// minutes; mirrored here). This matches retell-sdk's webhook_auth exactly —
// a bare hex digest of the body alone never validates a real Retell webhook.
const RETELL_SIGNATURE_TIMEOUT_MS = 5 * 60 * 1000;

export async function verifyRetellSignature(
  apiKey: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const match = /^v=(\d+),d=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(Date.now() - timestamp) > RETELL_SIGNATURE_TIMEOUT_MS
  ) {
    return false;
  }
  const expected = match[2].toLowerCase();
  return safeEqual(await hmacSha256Hex(apiKey, rawBody + timestamp), expected);
}

// Stripe signs webhooks as "t=<sec timestamp>,v1=<hex>[,v1=<hex>...]" where
// the digest is HMAC-SHA256 of `${t}.${rawBody}` with the endpoint's signing
// secret. Multiple v1 entries appear while a secret is being rolled; any one
// matching validates. Same five-minute staleness window as Retell above,
// which is also Stripe's own SDK default. Note the timestamp is SECONDS
// where Retell's is milliseconds.
const STRIPE_SIGNATURE_TIMEOUT_MS = 5 * 60 * 1000;

export async function verifyStripeSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = Number(parts.find((part) => part.startsWith("t="))?.slice(2));
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(Date.now() - timestamp * 1000) > STRIPE_SIGNATURE_TIMEOUT_MS
  ) {
    return false;
  }
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return parts
    .filter((part) => part.startsWith("v1="))
    .some((part) => safeEqual(part.slice(3).toLowerCase(), expected));
}

export async function verifyMetaSignature(
  appSecret: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = signatureHeader.slice("sha256=".length).toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return safeEqual(hexOf(mac), expected);
}
