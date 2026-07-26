"use client";

// Channel glyphs, ported from Nudge's LeadActivityPanel. Each channel keeps
// ONE colour everywhere it appears — the row strip, the filter pills, the feed
// entries — so a channel is recognizable by hue before the label is read.

export type Channel = "whatsapp" | "email" | "call";

export const CHANNELS: readonly Channel[] = ["whatsapp", "email", "call"];

// A note is a row in the feed but not a way to reach anybody, so it gets a
// glyph without joining CHANNELS — which drives the inbox row's "reachable on"
// strip and must stay honest.
export type FeedIconType = Channel | "form" | "note";

export function FeedIcon({
  type,
  size = 15,
  // Compose/ghost buttons carry the icon in the button's own text colour so
  // hover reads cleanly; feed and filter rows keep the per-channel tint.
  tinted = true,
}: {
  type: FeedIconType;
  size?: number;
  tinted?: boolean;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  const tint = (c: string) => (tinted ? c : "");

  return (
    <span className="flex shrink-0">
      {type === "whatsapp" ? (
        // Real WhatsApp brand glyph (filled) — the same mark customers know.
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
          className={tint("text-emerald-600 dark:text-emerald-500")}
        >
          <path d="M20.52 3.48A11.78 11.78 0 0 0 12 0C5.5 0 .26 5.24.26 11.74c0 2.07.54 4.09 1.57 5.86L0 24l6.6-1.73a11.7 11.7 0 0 0 5.4 1.32h.01c6.5 0 11.74-5.24 11.74-11.74 0-3.13-1.22-6.08-3.23-8.37zM12 21.5h-.01a9.78 9.78 0 0 1-4.99-1.36l-.36-.21-3.93 1.03 1.05-3.83-.23-.39A9.7 9.7 0 0 1 2.27 11.74C2.27 6.36 6.62 2 12 2s9.74 4.36 9.74 9.74S17.39 21.5 12 21.5zm5.32-7.31c-.29-.15-1.7-.84-1.97-.94-.27-.1-.46-.15-.65.15s-.74.94-.91 1.13c-.17.19-.34.22-.62.07-.29-.15-1.21-.45-2.31-1.43-.85-.76-1.43-1.7-1.6-1.99-.17-.29-.02-.45.13-.6.13-.13.29-.34.43-.5.14-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.07-.15-.65-1.57-.89-2.15-.23-.56-.47-.49-.65-.5l-.55-.01c-.19 0-.51.07-.78.36-.27.29-1.02.99-1.02 2.42s1.04 2.81 1.19 3c.15.19 2.05 3.13 4.97 4.39.69.3 1.23.48 1.65.61.69.22 1.32.19 1.81.12.55-.08 1.7-.69 1.94-1.36.24-.67.24-1.24.17-1.36-.07-.12-.27-.19-.56-.34z" />
        </svg>
      ) : type === "email" ? (
        <svg {...common} className={tint("text-blue-500/80")}>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-10 5L2 7" />
        </svg>
      ) : type === "form" ? (
        // Violet, the one hue left unclaimed. A form arrival is the only feed
        // row that came from someone who was not yet a customer.
        <svg {...common} className={tint("text-violet-500/85")}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M9 13h6" />
          <path d="M9 17h4" />
        </svg>
      ) : type === "note" ? (
        // Amber, the one hue no channel uses: a note is the only row in the
        // feed nobody outside the salon ever saw.
        <svg {...common} className={tint("text-amber-500/90")}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      ) : (
        <svg {...common} className={tint("text-sky-500/80")}>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      )}
    </span>
  );
}
