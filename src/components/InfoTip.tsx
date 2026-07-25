"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

// Small (i) icon with a hover/focus tooltip. Lets us push verbose help
// text out of the visible form line — the explanation is one hover away.
// Shared by AdminGlobalSettingsView and AdminTeamView so the affordance
// reads the same everywhere.
//
// The open tooltip renders through a PORTAL with fixed positioning (measured
// from the icon at open time), not as an absolute child: any scrollable/
// overflow-hidden ancestor (the ContactView properties card, dashboards)
// would clip an in-flow tooltip at the card edge. Fixed + portal escapes
// every clip context. Horizontal position clamps to the viewport, so a tip
// near either screen edge stays fully readable regardless of `align`. Only
// mounted while open — hidden tooltips have no layout box (see the app-shell
// phantom-scrollbar note in AGENTS.md).
const TIP_WIDTH = 288; // w-72, used for the viewport clamp

export function InfoTip({
  text,
  placement = "below",
  align = "left",
  hoverOnly = false,
}: {
  text: string;
  placement?: "above" | "below";
  // Horizontal anchor: "left" extends the tooltip to the right of the icon
  // (default); "right" anchors to the icon's right edge so it extends left.
  // Both clamp to the viewport, so this is a preference, not a clipping fix.
  align?: "left" | "right";
  // Hide the (i) until its card is hovered. For the dashboards, where a dozen
  // always-on icons read as clutter on what is meant to be a glanceable page.
  //
  // Requires an ancestor carrying `group/card`. That group is NAMED on purpose
  // so hovering the card reveals the icon without popping the tooltip itself.
  //
  // opacity, not `hidden` — the icon keeps its layout box so revealing it
  // doesn't shove the label sideways.
  hoverOnly?: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(
    null,
  );

  const show = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const anchoredLeft = align === "right" ? r.right - TIP_WIDTH : r.left;
    // Clamp inside the viewport with an 8px gutter on both sides.
    const left = Math.max(8, Math.min(anchoredLeft, window.innerWidth - TIP_WIDTH - 8));
    setPos(
      placement === "above"
        ? { bottom: window.innerHeight - r.top + 6, left }
        : { top: r.bottom + 6, left },
    );
  };
  const hide = () => setPos(null);

  return (
    <span
      onMouseEnter={show}
      onMouseLeave={hide}
      className={`relative inline-flex align-middle ${
        hoverOnly
          ? "opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100"
          : ""
      }`}
    >
      <button
        ref={btnRef}
        type="button"
        tabIndex={0}
        aria-label="More info"
        onFocus={show}
        onBlur={hide}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-[var(--border)] text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)] transition-colors"
      >
        i
      </button>
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ position: "fixed", width: TIP_WIDTH, ...pos }}
            className="pointer-events-none z-[100] whitespace-pre-line rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--foreground)] shadow-lg"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
