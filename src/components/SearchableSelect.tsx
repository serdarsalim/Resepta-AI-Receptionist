"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
// The table's search folding, so "İstanbul" typed on a Turkish keyboard finds
// what an English one would.
import { foldSearch } from "@/lib/useTableState";
import { fieldClass, type ControlSize } from "./Control";

// A select whose list is searched in place: one field that opens a panel with
// a search box over the options. For lists past the twenty-odd where a native
// <select> stops being usable (the voice-engine pickers proved it), and for
// options that carry a muted fact beside their name.
//
// Ported from Nudge's SearchableSelect (2026-10-13) at the size Resepta
// needs today: the operator console's engine pickers, which were a
// hand-rolled copy of CountryCodeSelect's shape (`SearchSelect` in
// app/admin/parts.tsx) that closed on every scroll. Nudge's also does
// grouped options, several picks, typed new values and an inline cell mode;
// those wait for the surface that needs them, the contact record's picklists
// (P12 in docs/nudge-port-plan.md).
//
// Through useAnchoredPanel like every menu: portalled, fixed, follows the
// trigger on scroll, flips above near the bottom of the screen, and the list
// shrinks to the room on the side it opened.

export type SearchableSelectOption = {
  value: string;
  label: string;
  // A muted fact right-aligned in the menu row: an engine's price per minute.
  // Not part of the label, because it is not what the thing is called, but it
  // is searched.
  note?: string;
};

const PANEL_MAX_H = 300;
const PANEL_MIN_H = 180;
// The search box's own height inside the panel, subtracted from the room the
// option list may use.
const SEARCH_H = 40;

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  disabled,
  className,
  size = "sm",
  menuWidth = 320,
}: {
  value: string;
  options: SearchableSelectOption[];
  onChange: (next: string) => void;
  // What the closed field says when nothing is picked; also its accessible
  // name.
  placeholder: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  // Width and placement of the field; the panel keeps its own width.
  className?: string;
  // The control scale (Control.tsx): sm on a settings row, xs in a table.
  size?: ControlSize;
  menuWidth?: number;
}) {
  const t = useT();
  // useId keeps two pickers on one page from sharing a listbox id, and agrees
  // between the server render and the client.
  const listId = useId();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const { triggerRef, panelRef, pos, room, open, toggle, close } = useAnchoredPanel(
    menuWidth,
    PANEL_MIN_H,
  );
  const maxH = Math.max(PANEL_MIN_H, Math.min(PANEL_MAX_H, room));

  const selected = options.find((option) => option.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = foldSearch(query.trim());
    if (!q) return options;
    return options.filter((option) =>
      foldSearch(`${option.label} ${option.note ?? ""}`).includes(q),
    );
  }, [query, options]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    // preventScroll: focusing the box otherwise scrolls it into view, which
    // moves the card the field sits in (CountryCodeSelect learned it first).
    const raf = requestAnimationFrame(() =>
      searchRef.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const pick = (next: string) => {
    close();
    if (next !== value) onChange(next);
  };

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={placeholder}
        className={`${fieldClass(size)} inline-flex w-full items-center justify-between gap-2 transition-colors hover:bg-[var(--muted-bg)] disabled:cursor-not-allowed`}
      >
        <span className={`truncate ${selected ? "" : "text-[var(--muted)]"}`}>
          {selected?.label ?? placeholder}
        </span>
        <span
          aria-hidden
          className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width: pos.width,
            }}
            className="z-[100] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
          >
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlight((h) => Math.min(h + 1, filtered.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const option = filtered[highlight];
                  if (option) pick(option.value);
                }
              }}
              placeholder={searchPlaceholder ?? t("common.search")}
              aria-label={searchPlaceholder ?? t("common.search")}
              aria-controls={listId}
              className="block w-full rounded-none border-0 border-b border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none"
            />
            <div
              id={listId}
              role="listbox"
              className="thin-scroll overflow-y-auto p-1"
              style={{ maxHeight: maxH - SEARCH_H }}
            >
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-[var(--muted)]">
                  {t("table.noMatches")}
                </div>
              ) : (
                filtered.map((option, index) => {
                  const isSelected = option.value === value;
                  return (
                    <button
                      // An empty value is a real option (the platform
                      // default), so the key cannot be the value alone.
                      key={option.value || "__default__"}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => pick(option.value)}
                      className={`flex w-full items-center justify-between gap-3 rounded px-3 py-1.5 text-left text-sm ${
                        index === highlight ? "bg-[var(--row-hover-bg)]" : ""
                      } ${isSelected ? "font-medium" : ""}`}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
                      {option.note && (
                        <span className="shrink-0 tabular-nums text-xs text-[var(--muted)]">
                          {option.note}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
