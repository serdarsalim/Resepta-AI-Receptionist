"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/LanguageProvider";
import { foldSearch, type SortDir } from "@/lib/useTableState";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";

// Shared table chrome: the quiet sort header, the funnel filter that lives ON
// the column it filters, the column picker, and the search box. Ported from
// Nudge's LeadsTable, kept to the parts that make a table readable.
//
// Every floating panel here goes through useAnchoredPanel (@/lib), which
// portals to the body and positions fixed: an absolute panel inside the
// table's horizontal scroll container clips at the card edge, and z-index does
// not fix that. InfoTip is the same pattern for tooltips.

// Checkmark box. A stock checkbox is outside the house style, and this one
// reads the same in every panel — exported with the two panel classes below
// so other multi-select dropdowns (MultiSelectDropdown, the voice agents'
// number pickers) are this one visual, not a drifting copy.
export function CheckMark({ on }: { on: boolean }) {
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

export const PANEL_CLASS =
  "menu-surface thin-scroll z-[100] overflow-y-auto rounded-lg p-1 text-sm text-[var(--foreground)]";

// --row-hover-bg, not --muted-bg: the panel is --card, and in dark the two
// are one colour, so the hover showed nothing.
export const ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--row-hover-bg)]";

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
            style={{ position: "fixed", maxHeight: FILTER_MAX_H, ...pos }}
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

// Narrow enough to be a deliberate choice, wide enough that a column can
// always be grabbed again after someone drags it as small as it goes.
const MIN_COLUMN_WIDTH = 72;

// Pointer events, not a window mousemove pair: setPointerCapture keeps the
// drag attached to this handle when the pointer outruns a 6px target, and it
// releases on its own if the browser cancels the gesture.
function ResizeHandle({
  width,
  onResize,
}: {
  width: number;
  onResize: (next: number) => void;
}) {
  const t = useT();
  const start = useRef<{ x: number; width: number } | null>(null);
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={t("table.resizeColumn")}
      // The header itself is an HTML5 drag source for reordering. Grabbing the
      // resize edge must not also pick the column up and move it.
      draggable={false}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        start.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const from = start.current;
        if (!from) return;
        onResize(
          Math.max(MIN_COLUMN_WIDTH, Math.round(from.width + (event.clientX - from.x))),
        );
      }}
      onPointerUp={(event) => {
        start.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none transition-colors hover:bg-[var(--border)]"
    />
  );
}

export type ColumnDrag = {
  onDragStart: () => void;
  onDrop: () => void;
};

// Column header. Sortable when onSort is given: the active column keeps a
// directional caret, an unsorted one reveals a neutral glyph on hover, and the
// space is reserved either way so the label never moves.
//
// Resize and reorder are both opt-in per column, because the Name column is
// anchored: it carries no fixed width (it absorbs whatever the others leave)
// so there is nothing to drag, and it stays first so a reordered table is
// still readable. Nudge anchors its checkbox and Name columns the same way.
//
// Reordering is pointer-only, as it is in Nudge. Keyboard users can still hide
// and show columns from the picker; moving them needs a different affordance
// than drag, and inventing one here would be guesswork.
export function Th({
  label,
  sortDir,
  onSort,
  filter,
  width,
  onResize,
  drag,
  className = "",
}: {
  label: string;
  sortDir?: SortDir | null;
  onSort?: () => void;
  filter?: React.ReactNode;
  width?: number;
  onResize?: (next: number) => void;
  drag?: ColumnDrag;
  className?: string;
}) {
  const [dropTarget, setDropTarget] = useState(false);
  return (
    <th
      scope="col"
      aria-sort={sortDir ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
      // Drop TARGET is the whole cell; the drag SOURCE is the label span
      // below. They are deliberately different elements: dragstart fires on
      // the nearest draggable ANCESTOR, so a draggable <th> would also pick
      // the column up when the grab started on the resize handle — the
      // handle's own onDragStart never gets a look in, because the event
      // never targets it. Anchoring the source inside the label leaves the
      // handle with no draggable ancestor and the two gestures stop competing.
      onDragEnd={() => setDropTarget(false)}
      onDragOver={(event) => {
        if (!drag) return;
        // Without preventDefault the browser refuses the drop outright.
        event.preventDefault();
        setDropTarget(true);
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(event) => {
        if (!drag) return;
        event.preventDefault();
        setDropTarget(false);
        drag.onDrop();
      }}
      // semibold, not medium: with the header's fill gone, weight is now half
      // of what separates it from the body — the rule underneath is the other
      // half.
      className={`group relative overflow-hidden whitespace-nowrap px-3 py-2 font-semibold ${
        dropTarget ? "bg-[var(--muted-bg)]" : ""
      } ${className}`}
    >
      {/* The landing edge, drawn inside the cell so it cannot widen the row. */}
      {dropTarget && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5 bg-[var(--accent)]"
        />
      )}
      <span
        draggable={drag !== undefined}
        onDragStart={drag?.onDragStart}
        className={`inline-flex max-w-full items-center gap-1 ${
          drag ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      >
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
      {onResize && width !== undefined && (
        <ResizeHandle width={width} onResize={onResize} />
      )}
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
        // A bordered button, not a ghost label. It opens a menu and changes
        // the table under it, so it should look like something you press —
        // the borderless version read as a caption sitting above the table.
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted-bg)] ${
          open ? "bg-[var(--muted-bg)]" : ""
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
            style={{ position: "fixed", ...pos }}
            className="menu-surface z-[100] overflow-hidden rounded-lg text-sm text-[var(--foreground)]"
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

// The search box: the header's global find, and the operator console's,
// which shares it so the console does not invent a second one. Feeds
// useSearch from @/lib/useTableState.
//
// Nudge's SearchField, round shape (2026-10-21): chrome, like a browser's
// address bar, so it is the one ROUND field in the app; a field inside a card
// stays boxed. The shell draws the border, fill and focus ring and the input
// is bare, so the magnifier and the clear button are flex siblings instead of
// overlays fighting the input's padding. --card fill, because it sits ON the
// frame's fill and has to read as raised; in dark --background is below the
// frame and the pill read as a well cut into it.
//
// Fixed and narrow, never sized to its text. The box used to grow with
// whichever was longer, the typed value or the placeholder, so the header
// re-laid itself out on every keystroke and every tab's placeholder had to be
// one short word.
export function SearchInput({
  value,
  onChange,
  placeholder,
  className = "",
  ref,
  onBlur,
  onFocus,
  fluid,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  // Fill the container instead of the fixed width. The phone header's
  // expanded state wants the whole row.
  fluid?: boolean;
  // The header owns focus for the phone's expand-to-search, so it needs a
  // handle on the field and a say in when the field gives focus back.
  ref?: React.Ref<HTMLInputElement>;
  onBlur?: () => void;
  // The header's jump list (CustomerJump) shows recents on focus with an
  // empty box, so the shell needs to know when the field holds focus.
  onFocus?: () => void;
}) {
  const t = useT();
  return (
    <div
      className={`flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 transition-colors focus-within:outline focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-[var(--accent)] ${
        fluid ? "w-full" : "w-40 lg:w-48"
      } ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
        className="shrink-0 text-[var(--muted)]"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={ref}
        // Not type="search": WebKit paints its own clear button next to ours.
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onFocus={onFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        // Bare: the shell above owns the chrome. 16px below sm, where iOS
        // Safari zooms the viewport under it.
        className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-[16px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:outline-none sm:text-sm"
      />
      {value && (
        <button
          type="button"
          // Keeps focus in the field, so clearing leaves you ready to type
          // rather than dismissing the jump list the focus was holding open.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange("")}
          aria-label={t("common.close")}
          className="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
