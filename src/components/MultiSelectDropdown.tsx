"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { foldSearch } from "@/lib/useTableState";
import { fieldClass, type ControlSize } from "./Control";
import { CheckMark, ITEM_CLASS, PANEL_CLASS } from "./DataTable";

// A field that lists what is picked, one per line, and opens a checklist
// that stays open while you toggle. Ported from Nudge's MultiSelectDropdown
// (2026-10-13) for the voice agents table, where each agent's inbound and
// outbound numbers were a hand-made copy of it (`LineMultiSelect` in
// VoiceCard). Every pick on its own line is that copy's own rule: "+43… +1"
// made the second number a count you had to open the panel to read (Serdar).
//
// Through useAnchoredPanel, like every menu: portalled, follows its field on
// scroll. Past eight options the panel grows a search box, Nudge's threshold:
// a short list reads at a glance, a long one is quicker typed than scrolled.
// Nudge's summary mode ("3 selected"), select-all row and link-out picks have
// no Resepta surface yet.
const SEARCH_THRESHOLD = 8;
const PANEL_W = 224;
const PANEL_MAX_H = 264;

export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder,
  emptyLabel,
  label,
  disabled,
  size = "xs",
}: {
  options: string[];
  selected: string[];
  // The whole new selection. A caller that writes one toggle at a time
  // diffs it against `selected`.
  onChange: (next: string[]) => void;
  // The field with nothing picked.
  placeholder: string;
  // The panel with nothing to pick.
  emptyLabel: string;
  // The field's accessible name; a column header names it for everyone else.
  label: string;
  disabled?: boolean;
  // The control scale (Control.tsx): xs in a table row. The field grows a
  // line per pick from there.
  size?: ControlSize;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const { triggerRef, panelRef, pos, open, toggle } = useAnchoredPanel(
    PANEL_W,
    PANEL_MAX_H,
  );
  const searchable = options.length > SEARCH_THRESHOLD;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    if (!searchable) return;
    const raf = requestAnimationFrame(() =>
      searchRef.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(raf);
  }, [open, searchable]);

  const q = foldSearch(query.trim());
  const shown = q ? options.filter((option) => foldSearch(option).includes(q)) : options;

  const toggleOption = (option: string) =>
    onChange(
      selected.includes(option)
        ? selected.filter((value) => value !== option)
        : [...selected, option],
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(event) => {
          // Rows in these tables can be click targets of their own.
          event.stopPropagation();
          toggle();
        }}
        // Multiline: one pick is exactly the scale's height, and each further
        // pick adds a line rather than a count.
        className={`${fieldClass(size, { multiline: true })} flex w-full min-w-36 items-start justify-between gap-2 text-left disabled:cursor-not-allowed`}
      >
        {selected.length === 0 ? (
          <span className="truncate text-[var(--muted)]">{placeholder}</span>
        ) : (
          <span className="flex min-w-0 flex-col">
            {selected.map((value) => (
              <span key={value} className="truncate">
                {value}
              </span>
            ))}
          </span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
          className="mt-1 shrink-0 text-[var(--muted)]"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {pos &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={label}
            aria-multiselectable
            style={{ position: "fixed", maxHeight: PANEL_MAX_H, ...pos }}
            className={PANEL_CLASS}
          >
            {searchable && (
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("common.search")}
                aria-label={t("common.search")}
                className={`${fieldClass("xs")} mb-1 w-full`}
              />
            )}
            {shown.length === 0 && (
              <div className="px-2.5 py-1.5 text-[var(--muted)]">
                {q ? t("table.noMatches") : emptyLabel}
              </div>
            )}
            {shown.map((option) => {
              const on = selected.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={on}
                  disabled={disabled}
                  onClick={() => toggleOption(option)}
                  className={`${ITEM_CLASS} disabled:opacity-60`}
                >
                  <CheckMark on={on} />
                  <span className="truncate">{option}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
