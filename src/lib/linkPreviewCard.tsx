// The 1200×630 picture a chat app shows under a pasted Resepta link (P27,
// Nudge fbeae989; lib/linkPreview has the words). The business's logo in a
// circle (its initials when it has none), its name, what the link is, what
// it offers, and its address small at the foot.
//
// The logo is fetched here, with a short timeout, and inlined: a slow or
// broken image becomes initials, never a failed card, because a crawler that
// waits too long shows no picture at all.

import { ImageResponse } from "next/og";
import type { PreviewModel } from "@/lib/linkPreview";

export const CARD_SIZE = { width: 1200, height: 630 } as const;

const INK = "#18181b";
const MUTED = "#52525b";
const SOFT = "#71717a";
const PAPER = "#ffffff";
// The initials sit on a tint picked from the name, so two businesses do not
// wear the same circle.
const TINTS = ["#dbeafe", "#dcfce7", "#fef3c7", "#fce7f3", "#e0e7ff", "#ccfbf1"];
const TINT_INK = ["#1d4ed8", "#15803d", "#b45309", "#be185d", "#4338ca", "#0f766e"];

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/svg+xml"]);
const MAX_IMAGE_BYTES = 2_000_000;

/** An image as a data: URI, or null when it is slow, huge or not a picture
 *  the renderer can draw. */
async function inline(url: string | null, timeoutMs = 2500): Promise<string | null> {
  if (!url) return null;
  try {
    const target = new URL(url);
    if (target.protocol !== "https:" && target.protocol !== "http:") return null;
    const res = await fetch(target, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return `data:${type === "image/jpg" ? "image/jpeg" : type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

function tintFor(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TINTS.length;
}

/** The card as a PNG response. `cache` is the Cache-Control header. */
export async function renderCard(model: PreviewModel, cache: string): Promise<Response> {
  const card = model.card;
  const logo = await inline(card.logoUrl);
  const tint = tintFor(card.heading);
  const headingSize = card.heading.length > 24 ? 72 : 88;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: PAPER,
          padding: "56px 72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
          {logo ? (
            // Contained, not cropped: a business logo is often a wordmark,
            // and a circle that cuts its ends off says nothing.
            <div
              style={{
                width: 240,
                height: 240,
                borderRadius: 120,
                border: "2px solid #e4e4e7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt="" width={176} height={176} style={{ objectFit: "contain" }} />
            </div>
          ) : (
            <div
              style={{
                width: 240,
                height: 240,
                borderRadius: 120,
                background: TINTS[tint],
                color: TINT_INK[tint],
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 96,
                flexShrink: 0,
              }}
            >
              {card.initials}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", fontSize: headingSize, color: INK, lineHeight: 1.1, letterSpacing: -1.5 }}>
              {card.heading}
            </div>
            <div style={{ display: "flex", fontSize: 46, color: MUTED, marginTop: 20, lineHeight: 1.2 }}>
              {card.line}
            </div>
            {card.detail ? (
              <div style={{ display: "flex", fontSize: 36, color: SOFT, marginTop: 12, lineHeight: 1.3 }}>
                {card.detail}
              </div>
            ) : null}
            {card.footnote ? (
              <div style={{ display: "flex", fontSize: 30, color: SOFT, marginTop: 24, lineHeight: 1.3 }}>
                {card.footnote}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    ),
    { ...CARD_SIZE, headers: { "cache-control": cache } },
  );
}

/** How long a card may be kept: long when its address carries the version
 *  stamp (a change is a new address), short without one. */
export function cardCacheControl(versioned: boolean): string {
  return versioned
    ? "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400"
    : "public, max-age=300, s-maxage=3600";
}
