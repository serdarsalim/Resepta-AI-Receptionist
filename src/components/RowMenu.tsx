"use client";

import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";

// A ⋯ that opens a short list of verbs about the thing it sits on. Built on
// useAnchoredPanel, so it portals, positions fixed off its trigger, and
// FOLLOWS the trigger when the page scrolls instead of closing (the house
// rule since 2026-08-19; see AGENTS.md, "Popovers NEVER position absolute
// inside a card").
//
// Written for the customer record's Delete (2026-10-13). AppointmentsView's
// row menu and InboxView's filter menu are older copies of the same idea that
// still close on scroll; they belong on this component.
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
};

const MENU_WIDTH = 224;
const ITEM_HEIGHT = 36;

export function RowMenu({
  items,
  label,
}: {
  items: RowMenuItem[];
  // What the menu is about, for screen readers: "Customer actions".
  label: string;
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
        className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-sm transition-colors ${
          open
            ? "bg-[var(--muted-bg)] text-[var(--foreground)]"
            : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
        }`}
      >
        ⋯
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
            className="z-[100] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={`flex h-9 w-full items-center px-3 text-left text-sm transition-colors hover:bg-[var(--muted-bg)] ${
                  item.danger ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
