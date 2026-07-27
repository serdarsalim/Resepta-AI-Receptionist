"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The one way a floating panel is positioned in this app.
//
// Every dropdown, combobox and menu renders through createPortal(document.body)
// with position: fixed, measured from its trigger at open time and clamped to
// the viewport. An `absolute` panel clips on the nearest overflow-hidden or
// scrolling ancestor — the shell's main pane and every card are exactly that —
// and no amount of z-index rescues it. See AGENTS.md; this has been flagged
// enough times to be a house rule rather than a preference.
//
// Lived inside DataTable until the timezone picker needed it too. Moved rather
// than copied: two implementations of "where does the panel go" drift, and the
// one that drifts is always the one nobody is looking at.

type PanelPos = { left: number; top?: number; bottom?: number; width: number };

export function useAnchoredPanel(
  // A number pins the panel's width. "trigger" makes it match the control it
  // hangs off, which is what a full-width form field wants — a 16rem dropdown
  // under a field twice that wide reads as a rendering mistake.
  width: number | "trigger",
  maxHeight: number,
  align: "left" | "right" = "left",
) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const open = pos !== null;

  const close = useCallback(() => setPos(null), []);

  const toggle = useCallback(() => {
    setPos((current) => {
      if (current) return null;
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const panelWidth = width === "trigger" ? rect.width : width;
      const anchored = align === "right" ? rect.right - panelWidth : rect.left;
      const left = Math.max(
        8,
        Math.min(anchored, window.innerWidth - panelWidth - 8),
      );
      // Flip above the trigger when the panel would run off the bottom and
      // there is more room up there. Bottom-anchored, so a short list still
      // hugs the trigger instead of floating away from it.
      const roomBelow = window.innerHeight - rect.bottom;
      if (roomBelow < maxHeight + 12 && rect.top > roomBelow) {
        return {
          left,
          bottom: window.innerHeight - rect.top + 4,
          width: panelWidth,
        };
      }
      return { left, top: rect.bottom + 4, width: panelWidth };
    });
  }, [align, maxHeight, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    // Capture: the panes this opens inside scroll without bubbling, so a
    // non-capturing listener never hears them and the panel floats away from
    // the trigger it was measured against.
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [close, open]);

  return { triggerRef, panelRef, pos, open, toggle, close };
}
