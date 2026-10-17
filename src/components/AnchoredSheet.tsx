"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeBeside, type Placement, type Rect } from "@/lib/anchoredSheet";
import { HoverTip } from "./HoverTip";

// The popover the calendar opens beside the thing it belongs to: the booking
// sheet and the blocked-time sheet. They carried two copies of this chrome
// (the portal, the placement, Escape, the Tab trap, the panel's classes),
// and two copies of "where does the panel go" drift. Nudge's AnchoredPanel
// is the same component ported back the other way.
//
// It NEVER covers the slot or booking it was opened from: it takes the side
// with room (lib/anchoredSheet.placeBeside) and only falls back to a centred
// sheet, a bottom sheet on a phone, when the window is too narrow to sit
// beside anything. Anchored, the backdrop is only a place to click to
// dismiss, with NO dim: the week stays readable behind it so you can see the
// slot you are booking against the ones around it. Portalled and fixed, per
// the house rule: an absolute panel inside the grid would clip on its scroll
// container.

// Google's popover width, near enough.
export const SHEET_W = 448;

export function AnchoredSheet({
  anchor,
  label,
  onClose,
  measureKey,
  heightFloor,
  onNaturalHeight,
  footer,
  children,
}: {
  anchor?: Rect;
  label: string;
  onClose: () => void;
  // Re-measured whenever anything that changes the panel's HEIGHT changes, so
  // it slides up rather than run off the bottom. A dependency, not a
  // ResizeObserver: an observer on this panel never delivered a single
  // callback in this app (AppointmentModal's note, 2026-08), while the
  // panel's offsetHeight demonstrably changed.
  measureKey?: unknown;
  // The least the panel may be, in px. Two sheets that swap into one spot
  // (Appointment | Blocked time) share one floor, so Save stays where it was:
  // the shorter sheet pads above its footer instead of pulling it up.
  heightFloor?: number;
  // The height the content wants on its own, without the floor's padding.
  // The calendar keeps the larger of the two sheets' answers as the floor.
  onNaturalHeight?: (px: number) => void;
  // Pinned to the panel's foot: under a floor, the space opens ABOVE it.
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  // Callers pass inline closures; the key handler below must not re-bind on
  // every render, or a re-render mid-keypress drops it.
  const onCloseRef = useRef(onClose);
  const onNaturalRef = useRef(onNaturalHeight);
  useEffect(() => {
    onCloseRef.current = onClose;
    onNaturalRef.current = onNaturalHeight;
  }, [onClose, onNaturalHeight]);

  // Where to sit, measured after layout so the panel's real height decides
  // whether it has to slide up. Compared before storing: a fresh object each
  // time would re-render for nothing.
  const [placement, setPlacement] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = panelRef.current;
      if (!el) return;
      onNaturalRef.current?.(el.offsetHeight - (spacerRef.current?.offsetHeight ?? 0));
      if (!anchor) {
        setPlacement(null);
        return;
      }
      const next = placeBeside(
        anchor,
        { width: SHEET_W, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setPlacement((current) =>
        current &&
        next &&
        current.top === next.top &&
        current.left === next.left &&
        current.side === next.side
          ? current
          : next,
      );
    };
    measure();
    // A window resize can turn a window with room beside the slot into one
    // without, and it does NOT re-render, so it needs its own listener.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor, measureKey, heightFloor]);

  // Escape closes, Tab cycles inside the panel. Capture phase, so the
  // calendar's own key handling never sees an Escape meant for this sheet.
  //
  // Escape belongs to the TOPMOST thing open: a confirm opened over this
  // sheet (a Sheet, role="dialog", later in the body), or a menu opened from
  // inside it (a time list, a date month, the customer matches, each marked
  // data-nested-menu). Those close themselves and this sheet stays. Before,
  // the sheet's capture listener stopped the key before any of them heard
  // it, so dismissing a list closed the sheet under it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        if (dialogs[dialogs.length - 1] !== panelRef.current) return;
        if (document.querySelector("[data-nested-menu]")) return;
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  return createPortal(
    <div
      className={
        placement
          ? "fixed inset-0 z-50"
          : "fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      }
      // mousedown, not click: a drag that started inside the panel and ended
      // on the backdrop must not close it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        // Anchored it is NOT modal: the calendar behind stays legible and
        // meaningful, and claiming otherwise to a screen reader would be a lie
        // about what is on screen.
        aria-modal={placement ? undefined : true}
        aria-label={label}
        style={{
          ...(placement
            ? { position: "fixed", top: placement.top, left: placement.left, width: SHEET_W }
            : {}),
          ...(heightFloor ? { minHeight: heightFloor } : {}),
        }}
        // Google's popover chrome (Nudge ac51b3c9): a 16px radius, and a
        // sheet tinted a step darker than the white grid it floats over, so
        // its fields read as white wells on it. Deep shadow, no drawn
        // border: the shadow IS the edge. Dark keeps a hairline, because a
        // shadow is invisible on near-black. Full width from the bottom on a
        // phone, where a salon books from the counter.
        className={`flex flex-col ${
          placement
            ? "max-h-[90vh] overflow-y-auto rounded-2xl border border-transparent bg-[var(--sheet-bg)] p-5 shadow-2xl dark:border-[var(--border)]"
            : "max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-transparent bg-[var(--sheet-bg)] p-5 shadow-xl dark:border-[var(--border)] sm:rounded-2xl"
        }`}
      >
        {children}
        <div ref={spacerRef} aria-hidden className="flex-1" />
        {footer}
      </div>
    </div>,
    document.body,
  );
}

// [label][value] rows, the shape every field in these sheets shares: a label
// column, so clicking a value to edit it never makes the column jump.
//
// The column is as wide as the longest label and no wider (Nudge f06e67bd:
// the fixed 96px left a gulf after a short label), with a 5rem floor. The
// floor is measured, not guessed: the longest label in either sheet in any of
// the three languages is "Team member" (4.97rem) and "Wiederholung" (4.87),
// so both sheets get exactly 5rem and the values start at one x whichever
// sheet the Appointment | Blocked time switch is showing.
export const SHEET_ROWS =
  "grid grid-cols-[minmax(5rem,max-content)_minmax(0,1fr)] items-center gap-x-3 gap-y-4";

export function SheetRow({
  label,
  htmlFor,
  alignTop = false,
  children,
}: {
  label: string;
  // The field the label names, when there is exactly one.
  htmlFor?: string;
  // A value taller than one control (the service lines, a growing note):
  // the label stays level with its FIRST line. pt-2 centres a 16px label
  // line on the 32px control beside it.
  alignTop?: boolean;
  children: React.ReactNode;
}) {
  const labelClass = `whitespace-nowrap text-xs font-medium ${alignTop ? "self-start pt-2" : ""}`;
  return (
    // `contents`: the label and the value are cells of the parent's
    // SHEET_ROWS grid, which is what lines every row up.
    <div className="contents">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {label}
        </label>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

// A round icon in a sheet's header: Google's bin and close. The name rides
// `title` too, because an icon alone is a guess.
export function SheetIconButton({
  label,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <HoverTip text={label}>
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      // --control-hover, not --muted-bg: the sheet is tinted now, and in dark
      // --muted-bg is the card colour, so its wash showed nothing on either.
      className={`rounded-full p-1.5 transition-colors hover:bg-[var(--control-hover)] hover:text-[var(--foreground)] disabled:opacity-40 ${
        pressed ? "bg-[var(--control-hover)] text-[var(--foreground)]" : "text-[var(--muted)]"
      }`}
    >
      {children}
    </button>
    </HoverTip>
  );
}

export function SheetCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <SheetIconButton label={label} onClick={onClick}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </SheetIconButton>
  );
}

export function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

// The sheet's footer pills, Google's shapes: a quiet text pill and a filled
// one. Kept here so the booking and blocked-time sheets cannot drift apart,
// and so the cancel confirm's red pill is the same size as the Save it
// replaces.
export const SHEET_PILL_QUIET =
  "rounded-full px-4 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]";
export const SHEET_PILL_PRIMARY =
  "rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50";
export const SHEET_PILL_DANGER =
  "rounded-full bg-red-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50";
