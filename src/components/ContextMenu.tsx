"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";

// A menu about one thing in a list, opened by right-clicking it (at the
// cursor) or by a small chevron on it (under the chevron). WhatsApp Web's
// chat-row and bubble menus are the model. Written for the Inbox row
// (P21, Nudge 2a94bb92) and shaped for the WhatsApp bubble menu that follows
// it (P23): ONE menu per list, re-aimed at whichever row asked, rather than a
// menu mounted on every row.
//
// Built on useAnchoredPanel, so it portals to the body, positions fixed, flips
// above when there is no room below, closes on Escape and outside clicks, and
// FOLLOWS a chevron when the page scrolls (AGENTS.md, "Popovers NEVER position
// absolute inside a card"). A cursor point has nothing to follow, so a menu
// opened by right-click stays where it opened.
//
// RowMenu is the sibling for a menu with its own ⋯ button; this one has no
// trigger of its own, which is what lets a right-click open it.

export type ContextMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  // A 16px glyph before the label, drawn by the caller.
  icon?: ReactNode;
  // Red, for the verb that destroys something.
  danger?: boolean;
  disabled?: boolean;
  // Leaves the menu open after onSelect, for an item that changes what the
  // menu shows rather than acting.
  keepOpen?: boolean;
};

// Which edge of the chevron the menu lines up on: "end" opens leftward from
// a chevron at a row's right end (the Inbox row), "start" rightward from one
// on a left-hand bubble (a customer's WhatsApp message).
export type MenuEdge = "start" | "end";

type Anchor = { el: HTMLElement; edge: MenuEdge } | { x: number; y: number };

const MENU_WIDTH = 224;
const ITEM_HEIGHT = 36;

// The state of one list's menu: what it is about (`target`, the caller's own
// key) and where it hangs. `itemCount` sizes the panel for the flip decision.
// `width` and `height` override the footprint for a menu that carries more
// than items: the WhatsApp bubble menu's quick reactions above its items, and
// the full emoji panel that replaces them. A change while open re-places it.
export function useContextMenu<T>(
  itemCount: number,
  { width = MENU_WIDTH, height }: { width?: number; height?: number } = {},
) {
  const anchorRef = useRef<Anchor | null>(null);
  // The chevron that opened the menu counts as "inside" for the outside-click
  // test, so clicking it again closes the menu instead of closing and then
  // reopening it.
  const triggerRef = useRef<HTMLElement | null>(null);
  const panel = useAnchoredPanel<HTMLElement>(
    width,
    height ?? itemCount * ITEM_HEIGHT + 8,
    "left",
    {
      triggerRef,
      anchorRect: () => {
        const anchor = anchorRef.current;
        if (!anchor) return null;
        if ("el" in anchor) {
          const r = anchor.el.getBoundingClientRect();
          // Aligned on the chevron's own edge: the menu opens from the side
          // the chevron sits on, so it never covers the row's name or the
          // message it is about.
          const left = anchor.edge === "end" ? r.right - width : r.left;
          return new DOMRect(left, r.top, width, r.height);
        }
        return new DOMRect(anchor.x, anchor.y, 0, 0);
      },
    },
  );
  const [target, setTarget] = useState<T | null>(null);
  const [edge, setEdge] = useState<MenuEdge>("start");
  const { show, close: closePanel, open } = panel;

  const openAt = useCallback(
    (next: T, x: number, y: number) => {
      anchorRef.current = { x, y };
      triggerRef.current = null;
      setTarget(next);
      setEdge("start");
      show();
    },
    [show],
  );
  const openUnder = useCallback(
    (next: T, el: HTMLElement, at: MenuEdge = "end") => {
      anchorRef.current = { el, edge: at };
      triggerRef.current = el;
      setTarget(next);
      setEdge(at);
      show();
    },
    [show],
  );
  const close = useCallback(() => {
    closePanel();
  }, [closePanel]);

  return {
    // What the menu is about while it is open, null otherwise. A closed menu
    // keeps nothing, so a row can ask "is the menu open on me" with one test.
    target: open ? target : null,
    // The edge the open menu lines up on, for a menu narrower than its
    // footprint (the bubble menu's items under its wider reactions).
    edge,
    openAt,
    openUnder,
    close,
    panelRef: panel.panelRef,
    pos: panel.pos,
  };
}

export type ContextMenuState<T> = ReturnType<typeof useContextMenu<T>>;

// Takes the hook's pieces one by one rather than the hook's whole result: the
// result carries a ref, and React's lint then treats every field read off it
// as a ref read during render.
export function ContextMenu({
  panelRef,
  pos,
  open,
  onClose,
  label,
  items,
  className = "",
  header,
  replacement,
  edge = "start",
}: {
  panelRef: ContextMenuState<unknown>["panelRef"];
  pos: ContextMenuState<unknown>["pos"];
  open: boolean;
  onClose: () => void;
  // What the menu is about, for screen readers: "Conversation options for Ayşe".
  label: string;
  items: ContextMenuItem[];
  className?: string;
  // Drawn above the items as its own surface: the bubble menu's quick
  // reactions, stacked the way WhatsApp Web stacks them.
  header?: ReactNode;
  // Drawn INSTEAD of header and items: the full emoji panel once React is
  // picked. Its footprint is the caller's `height`/`width` on the hook.
  replacement?: ReactNode;
  // Which side the items line up on when the footprint is wider than they are.
  edge?: MenuEdge;
}) {
  if (!pos || !open) return null;
  // The footprint is a click-through frame: only what it holds takes the
  // pointer, so a click in the gap beside a narrow item list lands on the
  // page and closes the menu like any other outside click.
  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        bottom: pos.bottom,
        width: pos.width,
      }}
      // The right-click must not reach the page under the menu either.
      onContextMenu={(e) => e.preventDefault()}
      className={`pointer-events-none z-[100] flex flex-col gap-2 ${
        edge === "end" ? "items-end" : "items-start"
      }`}
    >
      {replacement ? (
        <div className="pointer-events-auto">{replacement}</div>
      ) : (
        <>
          {header && <div className="pointer-events-auto">{header}</div>}
          <div
            role="menu"
            aria-label={label}
            style={{ width: Math.min(pos.width, MENU_WIDTH) }}
            className={`menu-surface pointer-events-auto overflow-hidden rounded-lg py-1 ${className}`}
          >
            {items.map((item) => (
              <ContextMenuButton key={item.key} item={item} onClose={onClose} />
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

function ContextMenuButton({ item, onClose }: { item: ContextMenuItem; onClose: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onClick={() => {
        // An item that opens something inside the menu (React swapping in
        // the emoji panel) keeps it open.
        if (!item.keepOpen) onClose();
        item.onSelect();
      }}
      // --row-hover-bg, not --muted-bg: on a --card panel in dark the two
      // are one colour and the hover showed nothing (RowMenu's reason).
      className={`flex h-9 w-full items-center gap-3 px-3 text-left text-sm outline-none transition-colors hover:bg-[var(--row-hover-bg)] focus-visible:bg-[var(--row-hover-bg)] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent ${
        item.danger ? "text-red-600 dark:text-red-400" : ""
      }`}
    >
      {item.icon && (
        <span className="flex shrink-0 text-[var(--muted-strong)]">{item.icon}</span>
      )}
      <span className="truncate">{item.label}</span>
    </button>
  );
}

// The 16px glyphs the menus draw, at the sidebar's 1.5 stroke. Shared so the
// Inbox row menu and the WhatsApp bubble menu speak with one set of marks.
export type MenuIconName =
  | "chevron"
  | "contact"
  | "pin"
  | "unpin"
  | "read"
  | "unread"
  | "mute"
  | "reply"
  | "copy"
  | "react"
  | "note";

export function MenuIcon({ name }: { name: MenuIconName }) {
  const pin = (
    <>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </>
  );
  const paths: Record<MenuIconName, ReactNode> = {
    chevron: <path d="m6 9 6 6 6-6" />,
    contact: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      </>
    ),
    pin,
    unpin: (
      <>
        {pin}
        <path d="m2 2 20 20" />
      </>
    ),
    read: (
      <>
        <path d="M18 6 7 17l-5-5" />
        <path d="m22 10-7.5 7.5L13 16" />
      </>
    ),
    unread: (
      <>
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </>
    ),
    mute: (
      <>
        <path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5" />
        <path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        <path d="m2 2 20 20" />
      </>
    ),
    reply: (
      <>
        <path d="m9 17-5-5 5-5" />
        <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="14" height="14" rx="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </>
    ),
    react: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <path d="M9 9h.01" />
        <path d="M15 9h.01" />
      </>
    ),
    note: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </>
    ),
  };
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}

// The quick-reaction row above the WhatsApp bubble menu (P23, Nudge e02706eb):
// WhatsApp Web's set without the thumbs-down, the angry and the crying face,
// in its order, at its ~20px size, and a "+" for the full picker. A business
// answering its customers does not send those three; Serdar dropped them in
// Nudge for the same reason.
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "🙏"] as const;

export function QuickReactions({
  onPick,
  onMore,
  moreLabel,
  current,
}: {
  onPick: (emoji: string) => void;
  onMore: () => void;
  moreLabel: string;
  // The reaction already on the message wears a wash, because picking it
  // again takes it back (WhatsApp's own gesture).
  current?: string;
}) {
  return (
    <div className="menu-surface flex items-center gap-0.5 rounded-full px-1.5 py-1">
      {QUICK_REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          aria-pressed={current === e}
          onClick={() => onPick(e)}
          className={`flex h-9 w-9 items-center justify-center rounded-full text-[20px] leading-none transition-transform hover:scale-110 hover:bg-[var(--row-hover-bg)] ${
            current === e ? "bg-[var(--row-hover-bg)]" : ""
          }`}
        >
          {e}
        </button>
      ))}
      <button
        type="button"
        onClick={onMore}
        aria-label={moreLabel}
        className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted-strong)] hover:bg-[var(--row-hover-bg)] hover:text-[var(--foreground)]"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
