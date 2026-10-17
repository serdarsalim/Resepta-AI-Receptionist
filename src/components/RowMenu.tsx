"use client";

import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { filterPillClass } from "./filterPill";

// A ⋯ that opens a short list of verbs about the thing it sits on. Built on
// useAnchoredPanel, so it portals, positions fixed off its trigger, and
// FOLLOWS the trigger when the page scrolls instead of closing (the house
// rule since 2026-08-19; see AGENTS.md, "Popovers NEVER position absolute
// inside a card").
//
// Written for the customer record's Delete (2026-10-13). The calendar list's
// row menu and the inbox's filter-row menu were older copies of the same idea
// that closed on scroll; both render this now, which is what `hint`,
// `disabled` and `reveal` are for.
//
// The trigger is a borderless glyph with a hover wash: borders belong to
// containers, and the panel is the container here.

export type RowMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  // Red, for the verb that destroys something. It still opens a confirmation
  // of its own; the colour only says which item that will be.
  danger?: boolean;
  // A muted fact at the end of the row: the inbox's unread count beside
  // "Mark all as read".
  hint?: string;
  // Shown but not pressable: mark-all-read with nothing unread.
  disabled?: boolean;
};

const MENU_WIDTH = 224;
const ITEM_HEIGHT = 36;

export function RowMenu({
  items,
  label,
  reveal = false,
  trigger = "dots",
}: {
  items: RowMenuItem[];
  // What the menu is about, for screen readers: "Customer actions".
  label: string;
  // Hidden until its row is hovered or the menu has focus (an ancestor
  // carries `group`): the calendar list's convention, where a ⋯ on every
  // row read as a column of noise. Always shown where there is no hover.
  reveal?: boolean;
  // "pill" wears the filter pill's outline and a filled down-arrow, for a
  // menu at the end of a row of filter pills: the Inbox's (P21, Nudge
  // 63893624), where people missed a bare ⋯ beside three outlined chips.
  trigger?: "dots" | "pill";
}) {
  const { triggerRef, panelRef, pos, open, toggle, close } = useAnchoredPanel(
    MENU_WIDTH,
    items.length * ITEM_HEIGHT + 8,
    "right",
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className={trigger === "pill" ? `${filterPillClass(open)} w-9 px-0` : `flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-sm transition-colors ${
          open
            ? "bg-[var(--control-hover)] text-[var(--foreground)]"
            : "text-[var(--muted)] hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]"
        } ${
          reveal && !open
            ? "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
            : ""
        }`}
      >
        {trigger === "pill" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="m6 9 6 6 6-6H6z" />
          </svg>
        ) : (
          "⋯"
        )}
      </button>
      {pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width: pos.width,
            }}
            className="menu-surface z-[100] overflow-hidden rounded-lg py-1"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                // --row-hover-bg, not --muted-bg: on a --card panel in dark
                // the two are one colour and the hover showed nothing.
                className={`flex h-9 w-full items-center justify-between gap-3 px-3 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent ${
                  item.danger ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                <span className="truncate">{item.label}</span>
                {item.hint && (
                  <span className="shrink-0 tabular-nums text-[var(--muted)]">
                    {item.hint}
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
