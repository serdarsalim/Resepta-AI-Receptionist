"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/LanguageProvider";
import { iconButtonClass } from "./Control";
import { HoverTip } from "./HoverTip";

// The window the email composer opens in (P28, Nudge's ComposeDock). Gmail's
// compose window, copied: docked bottom-right, floating just off the bottom
// edge with every corner rounded, no dimmed page behind it, so the customer
// you are writing to stays readable while you write. Its title bar folds it
// to a tab (click the bar again to bring it back) and, where the body can use
// the room, expands it to a centred sheet over a dimmed page.
//
// More than one can be open at once, so they do not each pin themselves to
// the corner: they line up in ONE tray, the first opened rightmost, and a
// fold or a close reflows the rest the way Gmail's do. The tray sits under
// the app's sheets and dialogs (z-40 against their z-50), so a confirm opens
// OVER an open draft.
//
// The children stay MOUNTED in every state: a folded draft is still the
// draft, and `hidden` (the undo hold) keeps it whole for Undo to bring back.
// Below `sm` the window is the whole screen, the way a phone composes.
//
// It never closes on its own: no outside click, no Escape. A composer holds
// work, and the page behind it is meant to be used while it is open. That is
// the one place this app's "Escape closes the sheet" does not hold, and on
// purpose: the sheet is a question, this is a piece of writing.
const TRAY_ID = "compose-dock-tray";

function dockTray(): HTMLElement {
  let tray = document.getElementById(TRAY_ID);
  if (!tray) {
    tray = document.createElement("div");
    tray.id = TRAY_ID;
    tray.className =
      "pointer-events-none fixed bottom-3 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-row-reverse items-end gap-3";
    document.body.appendChild(tray);
  }
  return tray;
}

export function ComposeDock({
  title,
  onClose,
  width,
  height,
  expandable = false,
  hidden = false,
  children,
}: {
  title: string;
  onClose: () => void;
  // Docked width, as a Tailwind class (`w-[…]`). It gives way, down to 20rem,
  // when the tray holds more than the screen is wide.
  width: string;
  // Docked height class. Omit to size to the content (capped at 90dvh).
  height?: string;
  // Offer the expand button, only where the body grows to fill the room.
  expandable?: boolean;
  // Out of sight but still mounted: the email window during its undo hold.
  hidden?: boolean;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const [state, setState] = useState<"docked" | "folded" | "expanded">("docked");
  const folded = state === "folded";
  const expanded = state === "expanded";
  const [tray] = useState(() => (typeof document === "undefined" ? null : dockTray()));
  // The tray is its own stacking context at z-40, so an expanded window's
  // z-50 is capped there and the shell's sidebar could draw over it. While one
  // is expanded the TRAY rises to the sheet layer; a dialog opened from it
  // (the link dialog) portals later and still lands on top.
  useEffect(() => {
    const el = expanded && !hidden ? document.getElementById(TRAY_ID) : null;
    if (!el) return;
    el.style.zIndex = "50";
    return () => {
      el.style.zIndex = "";
    };
  }, [expanded, hidden]);
  if (!tray) return null;

  // Docked and folded are flex items in the tray; expanded leaves it for the
  // middle of the screen (the tray has no transform, so `fixed` is still the
  // viewport's).
  const frame = expanded
    ? "fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[calc(100dvh-4rem)] w-[min(64rem,calc(100vw-4rem))] rounded-2xl"
    : folded
      ? "w-72 shrink-0 rounded-2xl"
      : `${width} min-w-[20rem] shrink ${height ?? "max-h-[90dvh]"} rounded-2xl`;

  const barButton = (label: string, onClick: () => void, glyph: ReactNode, extra = "") => (
    <HoverTip text={label} className={`inline-flex ${extra}`}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        aria-label={label}
        className={iconButtonClass("quiet", "xs")}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {glyph}
        </svg>
      </button>
    </HoverTip>
  );

  return createPortal(
    <>
      {expanded && !hidden && (
        <div
          className="pointer-events-auto fixed inset-0 z-50 bg-black/50"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setState("docked");
          }}
        />
      )}
      <div
        role="dialog"
        aria-label={title}
        style={hidden ? { display: "none" } : undefined}
        // .chat-font (P31): a message is written in the face it is read in.
        className={`chat-font pointer-events-auto flex flex-col overflow-hidden border border-[var(--border)] bg-[var(--card)] shadow-2xl ${frame} ${
          folded
            ? ""
            : "max-sm:fixed max-sm:inset-0 max-sm:z-50 max-sm:h-auto max-sm:max-h-none max-sm:w-auto max-sm:min-w-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0"
        }`}
      >
        {/* Clicking the bar folds and unfolds, as in Gmail; the buttons do
            their own thing and stop the click from reaching it. A bluish
            band with no rule under it: Gmail's bar is a colour (#f2f6fc),
            and 7% accent over the card lands on it in light and stays a
            faint blue in dark. */}
        <div
          className="flex h-10 shrink-0 cursor-pointer select-none items-center gap-1 bg-[color-mix(in_srgb,var(--accent)_7%,var(--card))] pl-4 pr-2"
          onClick={() => setState(folded ? "docked" : "folded")}
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">
            {title}
          </span>
          {barButton(
            folded ? t("compose.restore") : t("compose.minimise"),
            () => setState(folded ? "docked" : "folded"),
            folded ? <polyline points="6 15 12 9 18 15" /> : <line x1="6" y1="18" x2="18" y2="18" />,
          )}
          {expandable &&
            !folded &&
            barButton(
              expanded ? t("compose.exitFullScreen") : t("compose.fullScreen"),
              () => setState(expanded ? "docked" : "expanded"),
              expanded ? (
                <>
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                </>
              ) : (
                <>
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </>
              ),
              "max-sm:hidden",
            )}
          {barButton(
            t("common.close"),
            onClose,
            <>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </>,
          )}
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto ${folded ? "hidden" : "flex flex-col"}`}>
          {children}
        </div>
      </div>
    </>,
    tray,
  );
}
