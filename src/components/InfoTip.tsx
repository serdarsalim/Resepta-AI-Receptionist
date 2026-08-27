"use client";

import { useLayoutEffect, useRef, useState } from "react";
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
const GAP = 6; // breathing room between the trigger and the tip
const GUTTER = 8; // smallest distance a tip may sit from a viewport edge

// Vertical placement, resolved against the tip's REAL height rather than a
// guess. The text is variable length, so an estimate puts a two-line tip on
// screen and a five-line one under the fold — which is exactly how the consent
// and mute tips on a contact card ended up unreadable at the bottom of the
// page. `placement` is now a preference: the tip takes the preferred side when
// it fits there, flips when it doesn't, and picks the roomier side when
// neither fits, clamped so it always starts on screen.
function resolveTop(
  trigger: DOMRect,
  tipHeight: number,
  prefer: "above" | "below",
): number {
  const below = trigger.bottom + GAP;
  const above = trigger.top - GAP - tipHeight;
  const roomBelow = window.innerHeight - GUTTER - (below + tipHeight);
  const roomAbove = above - GUTTER;
  const preferAbove = prefer === "above";
  const first = preferAbove ? above : below;
  const second = preferAbove ? below : above;
  const firstFits = preferAbove ? roomAbove >= 0 : roomBelow >= 0;
  const secondFits = preferAbove ? roomBelow >= 0 : roomAbove >= 0;

  let top: number;
  if (firstFits) top = first;
  else if (secondFits) top = second;
  else top = roomAbove >= roomBelow ? above : below;

  return Math.max(GUTTER, Math.min(top, window.innerHeight - GUTTER - tipHeight));
}

// An action button whose label lives in a tooltip instead of text. For icon
// buttons in dense rows (the voice table's disconnect ✕): a text label widens
// the row, an unlabeled glyph is a guess. The tip shows immediately on
// hover/focus and renders through the same portal trick as InfoTip, because
// these buttons tend to sit inside overflow containers that would clip an
// in-flow tooltip. Anchored to the button's right edge: these buttons sit at
// row ends, so growing leftward is the direction with room.
export function ActionTip({
  label,
  onClick,
  disabled,
  multiline = false,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  // Greys the control and drops the click WITHOUT the disabled attribute: a
  // disabled button fires no mouse events, so the tooltip explaining why it is
  // unavailable would never open. Refusing is only useful if it says why.
  disabled?: boolean;
  // A sentence rather than a label. nowrap turns one into a strip wider than
  // the screen, so this wraps it and caps the width instead.
  multiline?: boolean;
  // Appended, not replacing: callers add visibility tricks (hover-only in
  // table rows), never their own button styling.
  className?: string;
  children: React.ReactNode;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [top, setTop] = useState<number | null>(null);

  const show = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setTop(null);
    setRect(r);
  };
  const hide = () => {
    setRect(null);
    setTop(null);
  };

  // Layout effect, not effect: it runs after the tip is in the DOM but before
  // the browser paints, so the flip is never a visible jump.
  useLayoutEffect(() => {
    if (!rect || !tipRef.current) return;
    setTop(resolveTop(rect, tipRef.current.offsetHeight, "below"));
  }, [rect]);

  // Clamped on BOTH sides. Anchoring to the button's right edge grows the box
  // leftward, and a wrapped sentence near the left of the viewport ran off it —
  // the right offset can never exceed the room actually available.
  const width = multiline ? TIP_WIDTH : 0;
  const right = rect
    ? Math.min(
        Math.max(GUTTER, window.innerWidth - rect.right),
        Math.max(GUTTER, window.innerWidth - width - GUTTER),
      )
    : 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-disabled={disabled}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => {
          hide();
          if (disabled) return;
          onClick();
        }}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
          disabled
            ? "cursor-not-allowed text-[var(--border)]"
            : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
        } ${className ?? ""}`}
      >
        {children}
      </button>
      {rect &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            style={{
              position: "fixed",
              top: top ?? rect.bottom + GAP,
              right,
              ...(multiline ? { width: TIP_WIDTH } : {}),
              // One frame of hidden while the height is measured. Never seen:
              // the layout effect resolves the real top before paint.
              ...(top === null ? { visibility: "hidden" as const } : {}),
            }}
            className={`pointer-events-none z-[100] rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--foreground)] shadow-lg ${
              multiline ? "" : "whitespace-nowrap"
            }`}
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}

export function InfoTip({
  text,
  placement = "below",
  align = "left",
  hoverOnly = false,
}: {
  text: string;
  // Preferred side. The tip flips to the other one when the preferred side
  // would push it off screen, so this never has to be right, only better.
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
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [top, setTop] = useState<number | null>(null);

  const show = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setTop(null);
    setRect(r);
  };
  const hide = () => {
    setRect(null);
    setTop(null);
  };

  // Layout effect, not effect: it runs after the tip is in the DOM but before
  // the browser paints, so the flip is never a visible jump.
  useLayoutEffect(() => {
    if (!rect || !tipRef.current) return;
    setTop(resolveTop(rect, tipRef.current.offsetHeight, placement));
  }, [rect, placement]);

  // Clamp inside the viewport with a gutter on both sides. Guarded on `rect`
  // so `window` is only touched once the tip is open, never during SSR.
  const left = rect
    ? Math.max(
        GUTTER,
        Math.min(
          align === "right" ? rect.right - TIP_WIDTH : rect.left,
          window.innerWidth - TIP_WIDTH - GUTTER,
        ),
      )
    : 0;

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
      {rect &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            style={{
              position: "fixed",
              width: TIP_WIDTH,
              left,
              top: top ?? rect.bottom + GAP,
              // One frame of hidden while the height is measured. Never seen:
              // the layout effect resolves the real top before paint.
              ...(top === null ? { visibility: "hidden" as const } : {}),
            }}
            className="pointer-events-none z-[100] whitespace-pre-line rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--foreground)] shadow-lg"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
