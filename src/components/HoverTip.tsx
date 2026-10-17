"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

// The label a control wears on hover (P20 of the Nudge port, Nudge 15d2d8b7,
// 57b6347d, 5ffe0877, fa6a0d95, 258c9316). A native `title` waits about a
// second and renders in the operating system's chrome, which is too slow to
// learn icons by; wrapping a control in HoverTip shows the same words at once,
// in the app's own look. Use it for icon-only buttons and for a terse control
// whose glyph alone does not say what the click does. An EXPLANATION is not a
// label: that is InfoTip's (i), which opens a card.
//
// Portal + fixed positioning for the same reason as InfoTip: any overflow
// ancestor (every card, the shell's main pane) would clip an in-flow tip.
// Mounted only while shown, so a hidden tip has no layout box.
//
// `side="right"` is the folded sidebar's: the label sits beside the icon,
// vertically centred, like a rail's flyout. `side="top"` is for a control at
// the foot of the screen (the email window's bottom bar, P28), where a tip
// underneath would fall off the window. `disabled` renders the child
// alone (the open sidebar already prints its labels). `className` replaces
// the wrapper's `inline-flex` when the child must keep its own layout: a
// full-width row takes "flex w-full", and a child positioned absolutely or
// placed by a grid takes "contents", so the wrapper adds no box at all.
const TIP_MAX_WIDTH = 260;

// THE tooltip look, one for the whole app: a dark chip with small medium
// text, the convention Google, GitHub and Vercel share. Every label tip uses
// it: HoverTip on both sides and ActionTip's. Data pop-ups (a calendar
// booking's preview, InfoTip's explanation) are cards, not labels, and keep
// their own. `TOOLTIP_CHIP` is the look without the no-wrap, for a tip that
// may hold a sentence.
export const TOOLTIP_CHIP =
  "rounded-md bg-[var(--foreground)] px-2 py-1 text-xs font-medium text-[var(--background)] shadow-lg";
export const TOOLTIP_LOOK = `whitespace-nowrap ${TOOLTIP_CHIP}`;

type Pos = { top: number; left: number; centred?: boolean };

export function HoverTip({
  text,
  children,
  side = "bottom",
  disabled = false,
  className = "inline-flex",
  delay = 0,
}: {
  text: string;
  children: ReactNode;
  side?: "bottom" | "right" | "top";
  disabled?: boolean;
  className?: string;
  // ms before showing. 0 (instant) everywhere except the sidebar's fold
  // toggle, which sits where the pointer crosses on its way to the rail and
  // flashed a label on every pass (Nudge fa6a0d95).
  delay?: number;
}) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const place = () => {
    // The child's box, not the wrapper's: a full-width wrapper around a
    // centred icon would put a right-side tip past the row's far edge, and a
    // "contents" wrapper has no box at all.
    const el = (wrapRef.current?.firstElementChild as HTMLElement | null) ?? wrapRef.current;
    const r = el?.getBoundingClientRect();
    if (!r) return;
    if (side === "right") {
      setPos({ top: r.top + r.height / 2, left: r.right + 8 });
      return;
    }
    // Centred under the control; the layout effect below pulls it back inside
    // the window by its REAL width. Clamping by the max width instead threw a
    // short tip far left of an icon near the window's right edge.
    setPos({
      top: side === "top" ? r.top - 6 : r.bottom + 6,
      left: r.left + r.width / 2,
      centred: true,
    });
  };
  const show = () => {
    if (disabled) return;
    if (timer.current) clearTimeout(timer.current);
    if (delay > 0) {
      timer.current = setTimeout(place, delay);
      return;
    }
    place();
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPos(null);
  };

  // Layout effect, not effect: it runs after the tip is in the DOM but before
  // the browser paints, so the measuring pass is never seen.
  useLayoutEffect(() => {
    if (!pos?.centred || !tipRef.current) return;
    const w = tipRef.current.getBoundingClientRect().width;
    const left = Math.max(8, Math.min(pos.left - w / 2, window.innerWidth - w - 8));
    setPos({ top: pos.top, left });
  }, [pos]);

  // A pending timer must not fire into an unmounted component.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <span
      ref={wrapRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      // A click acts; the label has done its job. It also keeps a tip from
      // staying behind a menu or a sheet the click opened.
      onClick={hide}
      className={className}
    >
      {children}
      {pos &&
        !disabled &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            style={{
              position: "fixed",
              maxWidth: TIP_MAX_WIDTH,
              top: pos.top,
              left: pos.left,
              // Hidden for the one layout pass that measures it.
              visibility: pos.centred ? "hidden" : undefined,
              ...(side === "right"
                ? { transform: "translateY(-50%)" }
                : side === "top"
                  ? { transform: "translateY(-100%)" }
                  : null),
            }}
            className={`pointer-events-none z-[100] overflow-hidden text-ellipsis ${TOOLTIP_LOOK} ${
              side === "right" ? "hover-tip-right" : ""
            }`}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
