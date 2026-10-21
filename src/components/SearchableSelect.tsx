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
// app/admin/parts.tsx) that closed on every scroll. The agent page's Testing
// tab brought three more of Nudge's: no search box for a short list, grouped
// options, and one pick per group in one menu (the Audio picker's
// microphone and speaker). Typed new values and an inline cell mode wait for
// the surface that needs them, the contact record's picklists (P12 in
// docs/nudge-port-plan.md).
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
  // A heading the option sits under in the menu. Groups keep the order their
  // first option comes in; options without one follow the groups.
  group?: string;
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
  menuMinWidth,
  plain = false,
  emptyText,
  searchable = true,
  values,
  triggerLabel,
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
  // A number pins the menu's width; "trigger" matches the field, never
  // narrower than `menuMinWidth`.
  menuWidth?: number | "trigger";
  menuMinWidth?: number;
  // The closed field as a line of text with its caret, no box: the booking
  // page's time zone, which reads as a fact you may change rather than a
  // form field (P29, cal.com's look).
  plain?: boolean;
  // The empty list's words, for a page that speaks another language than the
  // viewer's app setting (the public pages' createTranslator).
  emptyText?: string;
  // The search box over the list. Off for a list of a handful, where
  // filtering is noise (the browser test's Direction).
  searchable?: boolean;
  // One pick per GROUP in one menu: every value here is ticked, a click hands
  // its option to onChange (the caller replaces that group's pick) and the
  // menu stays open, so each group can be set in one visit. The field then
  // shows `triggerLabel`, since no single option is "the" value. The Testing
  // tab's Audio picker, Meet's shape: the microphone and the speaker are one
  // decision, which headset.
  values?: string[];
  triggerLabel?: string;
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
    "left",
    { minWidth: menuMinWidth },
  );
  const maxH = Math.max(PANEL_MIN_H, Math.min(PANEL_MAX_H, room));
  const multi = values !== undefined;

  const selected = options.find((option) => option.value === value) ?? null;
  const isPicked = (option: SearchableSelectOption) =>
    multi ? values.includes(option.value) : option.value === value;

  // Grouped options are drawn contiguous under their heading, in the order
  // each group first appears; a list without groups keeps its order.
  const ordered = useMemo(() => {
    if (!options.some((option) => option.group)) return options;
    const groups: string[] = [];
    for (const option of options) {
      if (option.group && !groups.includes(option.group)) groups.push(option.group);
    }
    return [
      ...groups.flatMap((group) => options.filter((option) => option.group === group)),
      ...options.filter((option) => !option.group),
    ];
  }, [options]);

  const filtered = useMemo(() => {
    const q = foldSearch(query.trim());
    if (!q) return ordered;
    return ordered.filter((option) =>
      foldSearch(`${option.label} ${option.note ?? ""} ${option.group ?? ""}`).includes(q),
    );
  }, [query, ordered]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    if (!searchable) return;
    // preventScroll: focusing the box otherwise scrolls it into view, which
    // moves the card the field sits in (CountryCodeSelect learned it first).
    const raf = requestAnimationFrame(() =>
      searchRef.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(raf);
  }, [open, searchable]);

  const pick = (next: string) => {
    if (multi) {
      // A click on a ticked row changes nothing: the group already has it.
      if (!values.includes(next)) onChange(next);
      return;
    }
    close();
    if (next !== value) onChange(next);
  };

  // The list's keys, wherever the focus is: the search box when there is
  // one, the field itself when there is not.
  const onListKey = (event: React.KeyboardEvent) => {
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
  };

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        onKeyDown={open && !searchable ? onListKey : undefined}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={placeholder}
        className={
          plain
            ? "inline-flex max-w-full items-center gap-1.5 rounded-md text-left transition-colors hover:text-[var(--foreground)] disabled:cursor-not-allowed"
            : `${fieldClass(size)} inline-flex w-full items-center justify-between gap-2 transition-colors hover:bg-[var(--muted-bg)] disabled:cursor-not-allowed`
        }
      >
        <span
          className={`truncate ${selected || triggerLabel ? "" : "text-[var(--muted)]"}`}
        >
          {triggerLabel ?? selected?.label ?? placeholder}
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
            className="menu-surface z-[100] overflow-hidden rounded-lg"
          >
            {searchable && (
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onListKey}
                placeholder={searchPlaceholder ?? t("common.search")}
                aria-label={searchPlaceholder ?? t("common.search")}
                aria-controls={listId}
                className="block w-full rounded-none border-0 border-b border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none"
              />
            )}
            <div
              id={listId}
              role="listbox"
              aria-multiselectable={multi || undefined}
              className="thin-scroll overflow-y-auto p-1"
              style={{ maxHeight: searchable ? maxH - SEARCH_H : maxH }}
            >
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-[var(--muted)]">
                  {emptyText ?? t("table.noMatches")}
                </div>
              ) : (
                filtered.map((option, index) => {
                  const isSelected = isPicked(option);
                  const heading =
                    option.group && option.group !== filtered[index - 1]?.group
                      ? option.group
                      : null;
                  return (
                    // An empty value is a real option (the platform default),
                    // so the key cannot be the value alone.
                    <div key={`${option.group ?? ""}:${option.value || "__default__"}`}>
                      {heading && (
                        <div
                          role="presentation"
                          className="px-3 pt-2 pb-1 text-xs font-medium text-[var(--muted-strong)]"
                        >
                          {heading}
                        </div>
                      )}
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onMouseEnter={() => setHighlight(index)}
                        onClick={() => pick(option.value)}
                        className={`flex w-full items-center justify-between gap-3 rounded px-3 py-1.5 text-left text-sm ${
                          index === highlight ? "bg-[var(--row-hover-bg)]" : ""
                        } ${isSelected ? "font-medium" : ""}`}
                      >
                        {/* A menu whose field does not show the pick has to:
                            a tick, since bold alone is too quiet to answer
                            "which one is on?". */}
                        {multi && (
                          <span aria-hidden className="w-3 shrink-0 text-[var(--accent)]">
                            {isSelected ? "✓" : ""}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {option.note && (
                          <span className="shrink-0 tabular-nums text-xs text-[var(--muted)]">
                            {option.note}
                          </span>
                        )}
                      </button>
                    </div>
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
