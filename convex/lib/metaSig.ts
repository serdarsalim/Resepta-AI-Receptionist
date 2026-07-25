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

// Retell signs webhook/function bodies with the API key (x-retell-signature,
// bare hex or "v1=<hex>"). Same fail-open-in-dev policy as the Meta check.
export async function verifyRetellSignature(
  apiKey: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = signatureHeader.replace(/^v1=/, "").toLowerCase();
  return safeEqual(await hmacSha256Hex(apiKey, rawBody), expected);
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
