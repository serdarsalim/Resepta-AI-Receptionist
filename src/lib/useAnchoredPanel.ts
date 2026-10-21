"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

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
// one that drifts is always the one nobody is looking at. That happened anyway:
// by 2026-10-13 eleven menus had hand-rolled their own positioning, and every
// one of them closed on scroll. They all come through here now, which is what
// the options below are for.

type PanelPos = { left: number; top?: number; bottom?: number; width: number };

export type AnchoredPanelOptions<T extends HTMLElement = HTMLButtonElement> = {
  // The side the panel tries first. "above" is a menu that opens upward from
  // a button at the foot of a pane, the composer's +; it drops below only
  // when there is no room above and more below.
  prefer?: "below" | "above";
  // Space between the trigger and the panel. 4px; the account menu sits 8px
  // off its avatar.
  gap?: number;
  // Measure from something that is not the trigger element: the caret in the
  // prompt editor, where the @ menu opens. The trigger ref still marks what
  // counts as "inside" for an outside click.
  anchorRect?: () => DOMRect | null;
  // The caller's own ref for the trigger, when the component reads that
  // element itself (the prompt editor's textarea). Otherwise the hook makes
  // one and hands it back.
  triggerRef?: RefObject<T | null>;
  // With "trigger" width: never narrower than this. A list of device names
  // needs more room than the box that shows the chosen one (the browser
  // test's Audio picker).
  minWidth?: number;
};

export function useAnchoredPanel<T extends HTMLElement = HTMLButtonElement>(
  // A number pins the panel's width. "trigger" makes it match the control it
  // hangs off, which is what a full-width form field wants — a 16rem dropdown
  // under a field twice that wide reads as a rendering mistake.
  width: number | "trigger",
  // How tall the panel may get. Decides which side it opens on; the panel
  // caps its own height in CSS.
  maxHeight: number,
  align: "left" | "right" = "left",
  options: AnchoredPanelOptions<T> = {},
) {
  const { prefer = "below", gap = 4, anchorRect, minWidth = 0 } = options;
  const ownTriggerRef = useRef<T | null>(null);
  const triggerRef = options.triggerRef ?? ownTriggerRef;
  const panelRef = useRef<HTMLDivElement | null>(null);
  // pos is what callers spread into the panel's style; room rides beside it
  // so it never lands in a style object.
  const [placement, setPlacement] = useState<{ pos: PanelPos; room: number } | null>(
    null,
  );
  const open = placement !== null;

  // Callers pass anchorRect inline, so it has a new identity every render.
  // The ref keeps measure (and the listeners that depend on it) stable.
  const anchorRectRef = useRef(anchorRect);
  useLayoutEffect(() => {
    anchorRectRef.current = anchorRect;
  });

  const close = useCallback(() => setPlacement(null), []);

  // Where the panel goes RIGHT NOW, from the anchor's current rect. Split out
  // of toggle so scrolling can re-run it: the panel is position:fixed and was
  // measured once at open, so it had to close on scroll or drift away from the
  // control it belongs to.
  const measure = useCallback((): { pos: PanelPos; room: number } | null => {
    const rect =
      anchorRectRef.current?.() ?? triggerRef.current?.getBoundingClientRect() ?? null;
    if (!rect) return null;
    const panelWidth = Math.min(
      width === "trigger" ? Math.max(rect.width, minWidth) : width,
      window.innerWidth - 16,
    );
    const anchored = align === "right" ? rect.right - panelWidth : rect.left;
    const left = Math.max(
      8,
      Math.min(anchored, window.innerWidth - panelWidth - 8),
    );
    // Flip to the other side when the panel would run off the preferred one
    // and there is more room over there. Placed above, the panel is
    // bottom-anchored, so a short list still hugs the trigger instead of
    // floating away from it, and nobody has to guess its height.
    const roomBelow = window.innerHeight - rect.bottom;
    const roomAbove = rect.top;
    const above =
      prefer === "above"
        ? !(roomAbove < maxHeight + 12 && roomBelow > roomAbove)
        : roomBelow < maxHeight + 12 && roomAbove > roomBelow;
    if (above) {
      return {
        pos: { left, bottom: window.innerHeight - rect.top + gap, width: panelWidth },
        room: rect.top - gap - 8,
      };
    }
    return {
      pos: { left, top: rect.bottom + gap, width: panelWidth },
      room: roomBelow - gap - 8,
    };
    // triggerRef is a ref object, stable for the component's life; listed
    // because it may be the caller's rather than this hook's own.
  }, [align, gap, maxHeight, minWidth, prefer, triggerRef, width]);

  const toggle = useCallback(() => {
    setPlacement((current) => (current ? null : measure()));
  }, [measure]);

  // Opens, or moves an open panel to where its anchor is now: the @ menu
  // follows the caret as the fragment is typed.
  const show = useCallback(() => setPlacement(measure()), [measure]);

  // A panel whose size changes while it is open (the composer's + becoming
  // the emoji grid) is re-placed for its new size. A layout effect, so the
  // frame placed for the old size is never painted.
  useLayoutEffect(() => {
    if (open) setPlacement(measure());
  }, [measure, open]);

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
    // Scrolling FOLLOWS the trigger rather than closing the panel. Closing was
    // the old answer and it made the long lists unusable: reaching for a
    // variable below the fold meant scrolling the page, and the scroll that
    // brought the trigger into view also dismissed what you had just opened.
    const onReflow = (event: Event) => {
      // The panel's own list scrolls too (these are capture listeners, so its
      // wheel events arrive here). Moving the list must not move the panel.
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) {
        return;
      }
      const rect =
        anchorRectRef.current?.() ?? triggerRef.current?.getBoundingClientRect();
      // Trigger has left the viewport — there is nothing to hang off any more,
      // and a panel anchored to an off-screen control is the drift this
      // listener exists to prevent.
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) {
        close();
        return;
      }
      setPlacement(measure());
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    // Capture: the panes this opens inside scroll without bubbling, so a
    // non-capturing listener never hears them at all.
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [close, measure, open, triggerRef]);

  return {
    triggerRef,
    panelRef,
    pos: placement?.pos ?? null,
    // The vertical room on the side the panel opened, after the gap and an
    // 8px margin. A panel that shrinks to fit (the country list) caps its
    // height with it.
    room: placement?.room ?? 0,
    open,
    toggle,
    show,
    close,
  };
}
