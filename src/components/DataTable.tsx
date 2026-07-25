"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/LanguageProvider";
import { foldSearch, type SortDir } from "@/lib/useTableState";

// Shared table chrome: the quiet sort header, the funnel filter that lives ON
// the column it filters, the column picker, and the search box. Ported from
// Nudge's LeadsTable, kept to the parts that make a table readable.
//
// Every floating panel here goes through createPortal(document.body) with
// position: fixed, measured from the trigger at open time and clamped to the
// viewport. An absolute panel inside the table's horizontal scroll container
// clips at the card edge, and z-index does not fix that. InfoTip is the same
// pattern for tooltips.

type PanelPos = { left: number; top?: number; bottom?: number };

function useAnchoredPanel(width: number, maxHeight: number, align: "left" | "right" = "left") {
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
      const anchored = align === "right" ? rect.right - width : rect.left;
      const left = Math.max(8, Math.min(anchored, window.innerWidth - width - 8));
      // Flip above the trigger when the panel would run off the bottom and
      // there is more room up there. Bottom-anchored, so a short list still
      // hugs the trigger instead of floating away from it.
      const roomBelow = window.innerHeight - rect.bottom;
      if (roomBelow < maxHeight + 12 && rect.top > roomBelow) {
        return { left, bottom: window.innerHeight - rect.top + 4 };
      }
      return { left, top: rect.bottom + 4 };
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
    // Capture: the table's own overflow container scrolls without bubbling.
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [close, open]);

  return { triggerRef, panelRef, pos, open, toggle, close };
}

// Checkmark box. A stock checkbox is outside the house style, and this one
// reads the same in both panels.
function CheckMark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] ${
        on
          ? "bg-[var(--foreground)] text-[var(--background)]"
          : "border border-[var(--border)]"
      }`}
    >
      {on ? "✓" : ""}
    </span>
  );
}

const PANEL_CLASS =
  "thin-scroll z-[100] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 text-sm text-[var(--foreground)] shadow-lg";

const ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--muted-bg)]";

// A dropdown action. Used for the rare actions parked at the foot of the
// column picker, where they belong instead of on the toolbar.
export function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={`${ITEM_CLASS} text-[var(--muted)] hover:text-[var(--foreground)]`}>
      {children}
    </button>
  );
}

function FunnelIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

const FILTER_W = 224;
const FILTER_MAX_H = 264;

// Value filter for one column. Multi-select, OR within the column; the table
// ANDs the columns together. Amber means filter state, never an action.
export function HeaderFilter({
  options,
  selected,
  onToggle,
  labelFor,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  labelFor?: (value: string) => string;
}) {
  const t = useT();
  const { triggerRef, panelRef, pos, open, toggle } = useAnchoredPanel(
    FILTER_W,
    FILTER_MAX_H,
  );
  const count = selected.length;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        aria-label={t("table.filterColumn")}
        aria-expanded={open}
        // An active filter is always visible. An unused funnel reveals on
        // header hover, on keyboard focus, and while its own panel is open,
        // so it never vanishes as the pointer travels into the panel.
        className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 align-middle transition-opacity ${
          count > 0
            ? "text-amber-600 dark:text-amber-400"
            : `text-[var(--muted)] hover:text-[var(--foreground)] focus-visible:opacity-100 ${
                open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`
        }`}
      >
        <FunnelIcon active={count > 0} />
        {count > 0 && (
          <span className="text-[10px] font-semibold leading-none tabular-nums">{count}</span>
        )}
      </button>
      {pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", width: FILTER_W, maxHeight: FILTER_MAX_H, ...pos }}
            className={PANEL_CLASS}
          >
            {options.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[var(--muted)]">{t("table.noMatches")}</div>
            ) : (
              options.map((option) => {
                const on = selected.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onToggle(option)}
                    className={ITEM_CLASS}
                  >
                    <CheckMark on={on} />
                    <span className="truncate">
                      {labelFor ? labelFor(option) : option || t("table.blank")}
                    </span>
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

// Column header. Sortable when onSort is given: the active column keeps a
// directional caret, an unsorted one reveals a neutral glyph on hover, and the
// space is reserved either way so the label never moves.
export function Th({
  label,
  sortDir,
  onSort,
  filter,
  className = "",
}: {
  label: string;
  sortDir?: SortDir | null;
  onSort?: () => void;
  filter?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      aria-sort={sortDir ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
      className={`group whitespace-nowrap px-4 py-2 font-medium ${className}`}
    >
      <span className="inline-flex max-w-full items-center gap-1">
        {onSort ? (
          <button
            type="button"
            onClick={onSort}
            className={`inline-flex min-w-0 items-center gap-1 transition-colors hover:text-[var(--foreground)] ${
              sortDir ? "text-[var(--foreground)]" : ""
            }`}
          >
            <span className="truncate">{label}</span>
            {sortDir ? (
              <span aria-hidden className="text-[10px] opacity-80">
                {sortDir === "asc" ? "▲" : "▼"}
              </span>
            ) : (
              <span
                aria-hidden
                className="text-[10px] opacity-0 transition-opacity group-hover:opacity-60 group-focus-within:opacity-60"
              >
                ↕
              </span>
            )}
          </button>
        ) : (
          <span className="truncate">{label}</span>
        )}
        {filter}
      </span>
    </th>
  );
}

const PICKER_W = 232;
const PICKER_MAX_H = 320;

// Column picker. Its own search, because an org with a dozen contact fields
// makes a plain list a scavenger hunt. Rare table actions ride in the footer.
export function ColumnPicker({
  columns,
  hidden,
  onToggle,
  footer,
  className = "",
}: {
  columns: Array<{ key: string; label: string }>;
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  footer?: (close: () => void) => React.ReactNode;
  className?: string;
}) {
  const t = useT();
  const { triggerRef, panelRef, pos, open, toggle, close } = useAnchoredPanel(
    PICKER_W,
    PICKER_MAX_H,
    "right",
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const shown = useMemo(() => {
    const folded = foldSearch(query.trim());
    if (!folded) return columns;
    return columns.filter((column) => foldSearch(column.label).includes(folded));
  }, [columns, query]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] ${
          open ? "bg-[var(--muted-bg)] text-[var(--foreground)]" : ""
        } ${className}`}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
        {t("table.columns")}
      </button>
      {pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", width: PICKER_W, ...pos }}
            className="z-[100] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--foreground)] shadow-lg"
          >
            <div className="border-b border-[var(--border)] p-1.5">
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("table.searchColumns")}
                aria-label={t("table.searchColumns")}
                className="w-full border-none bg-transparent px-2 py-1 text-[16px] outline-none placeholder:text-[var(--muted)] focus:outline-none sm:text-sm"
              />
            </div>
            <div className="thin-scroll max-h-72 overflow-y-auto p-1">
              {shown.length === 0 ? (
                <div className="px-2.5 py-1.5 text-[var(--muted)]">{t("table.noMatches")}</div>
              ) : (
                shown.map((column) => (
                  <button
                    key={column.key}
                    type="button"
                    onClick={() => onToggle(column.key)}
                    className={ITEM_CLASS}
                  >
                    <CheckMark on={!hidden.has(column.key)} />
                    <span className="truncate">{column.label}</span>
                  </button>
                ))
              )}
            </div>
            {footer && (
              <div className="border-t border-[var(--border)] p-1">{footer(close)}</div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

// The search box. Feeds useSearch from @/lib/useTableState; the appointments
// list and the inbox conversation list can hang off the same pair.
export function SearchInput({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        // Not type="search": WebKit paints its own clear button next to ours.
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        // 16px floor below sm: iOS Safari zooms the viewport under it.
        className="h-9 w-full py-0 pl-9 pr-3 text-[16px] sm:text-sm"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("common.close")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
