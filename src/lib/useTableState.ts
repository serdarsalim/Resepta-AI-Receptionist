"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Table behaviour that has nothing to do with what a table renders: sort,
// per-column filters, column visibility, widths, order, and search. Ported
// from Nudge's LeadsTable, minus what made that file 2800 lines — no saved
// views, no condition builder, no URL state.
//
// Resizing and reordering were on that cut list too, and came back by request.
// They brought persistence with them, which is not decoration: a column you
// dragged to the right width and lost on the next navigation is worse than one
// you could never drag at all. Sort, filters and the search query still die
// with the view — those answer a question you are asking right now. Layout is
// a preference, and preferences outlive the question.
const STORAGE_PREFIX = "randevu.table.";

type StoredLayout = {
  hidden?: string[];
  widths?: Record<string, number>;
  order?: string[];
};

// Anything can be in localStorage: a half-written entry, a shape from a build
// two months ago, a value a user typed into devtools. Every field is checked
// on the way in, and a bad one falls back to the default rather than taking
// the table down with it.
function readLayout(storageKey: string): StoredLayout | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { hidden, widths, order } = parsed as StoredLayout;
    const out: StoredLayout = {};
    if (Array.isArray(hidden)) out.hidden = hidden.filter((k) => typeof k === "string");
    if (Array.isArray(order)) out.order = order.filter((k) => typeof k === "string");
    if (widths && typeof widths === "object" && !Array.isArray(widths)) {
      out.widths = Object.fromEntries(
        Object.entries(widths).filter(
          ([, value]) => typeof value === "number" && Number.isFinite(value) && value > 0,
        ),
      );
    }
    return out;
  } catch {
    return null;
  }
}

// Move one key to another key's position. Pure, and exported because the drop
// handler is the only place that knows which column was dragged onto which.
export function moveKey(keys: string[], fromKey: string, toKey: string): string[] {
  if (fromKey === toKey) return keys;
  const from = keys.indexOf(fromKey);
  const to = keys.indexOf(toKey);
  if (from < 0 || to < 0) return keys;
  const next = [...keys];
  next.splice(from, 1);
  next.splice(to, 0, fromKey);
  return next;
}

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };
export type CellValue = string | number | undefined;

// Turkish and German fold into ASCII before comparing, so "sirin" finds
// "Şirin" and "strasse" finds "Straße". The dotted/dotless i pair is handled
// BEFORE lowercasing: JS lowercases "İ" to "i̇" (i + combining dot), which the
// diacritic strip would then have to undo anyway.
export function foldSearch(value: string): string {
  return value
    .replace(/[İIı]/g, "i")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export type Search = {
  query: string;
  setQuery: (query: string) => void;
  // True once the query has content. Callers use this to let search REVEAL
  // rows their filters are hiding: a query must never fail to find a match
  // that exists in the data.
  active: boolean;
  // True when ANY of the values contains the query. An empty query matches
  // everything, so a call site can pipe every row through it unconditionally.
  matches: (...values: Array<string | number | null | undefined>) => boolean;
};

// The matching half, over query state somebody else owns. Split out because
// the search BOX now lives in the app header while the list that reacts to it
// lives in a view — see useHeaderSearch, which holds the state in between.
export function useSearchFrom(
  query: string,
  setQuery: (query: string) => void,
): Search {
  const folded = foldSearch(query.trim());
  const matches = useCallback(
    (...values: Array<string | number | null | undefined>) => {
      if (!folded) return true;
      return values.some(
        (value) =>
          value !== null &&
          value !== undefined &&
          foldSearch(String(value)).includes(folded),
      );
    },
    [folded],
  );
  return { query, setQuery, active: folded.length > 0, matches };
}

// The search primitive for a list that owns its own box. Deliberately not
// table-specific: the appointments list and the inbox conversation list feed
// it their own strings.
export function useSearch(): Search {
  const [query, setQuery] = useState("");
  return useSearchFrom(query, setQuery);
}

// Blanks sort last in BOTH directions. Flipping the direction is meant to
// reorder the data, not to march the empty rows to the top.
export function compareCells(a: CellValue, b: CellValue, dir: SortDir): number {
  const aBlank = a === undefined || a === "";
  const bBlank = b === undefined || b === "";
  if (aBlank || bBlank) return aBlank && bBlank ? 0 : aBlank ? 1 : -1;
  const cmp =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : foldSearch(String(a)).localeCompare(foldSearch(String(b)));
  return dir === "asc" ? cmp : -cmp;
}

export type TableState<K extends string> = {
  sort: SortState<K>;
  toggleSort: (key: K) => void;
  isColumnVisible: (key: string) => boolean;
  hiddenColumns: ReadonlySet<string>;
  toggleColumn: (key: string) => void;
  filters: Readonly<Record<string, string[]>>;
  filterFor: (column: string) => string[];
  toggleFilter: (column: string, value: string) => void;
  clearFilters: () => void;
  activeFilterCount: number;
  // OR inside one column, AND across columns.
  matchesFilters: (valueOf: (column: string) => string) => boolean;
  widthFor: (key: string, fallback: number) => number;
  setWidth: (key: string, width: number) => void;
  // Applies the stored order to a column list. Columns the stored order has
  // never seen keep their natural position instead of being flung to the end,
  // so a contact field the owner adds next week lands where the code puts it.
  orderColumns: <C extends { key: string }>(columns: C[]) => C[];
  setColumnOrder: (keys: string[]) => void;
  // Escape hatch. A column dragged down to the minimum width, or off to the
  // right of a dozen others, is hard to undo by hand.
  resetLayout: () => void;
  layoutChanged: boolean;
};

export function useTableState<K extends string>(
  initial: SortState<K>,
  // Omit to keep layout in memory only. Given, it is the localStorage suffix,
  // so two tables in the app never share a layout.
  storageKey?: string,
): TableState<K> {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const toggleSort = useCallback((key: K) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }, []);

  // HIDDEN, not visible: a contact field the owner adds next week shows up on
  // its own instead of staying invisible until someone finds the picker.
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const isColumnVisible = useCallback(
    (key: string) => !hiddenColumns.has(key),
    [hiddenColumns],
  );

  const [widths, setWidths] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<string[]>([]);

  // Read on mount, not during render: the server has no localStorage, and
  // seeding state from it during render is a hydration mismatch (same reason
  // AppShell reads the sidebar flag in an effect). Costs one frame at the
  // default layout before the stored one lands.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!storageKey) {
      setRestored(true);
      return;
    }
    const stored = readLayout(storageKey);
    if (stored?.hidden) setHiddenColumns(new Set(stored.hidden));
    if (stored?.widths) setWidths(stored.widths);
    if (stored?.order) setOrder(stored.order);
    setRestored(true);
  }, [storageKey]);

  // Gated on `restored` so the empty defaults of that first frame never
  // overwrite what is on disk before the read lands.
  useEffect(() => {
    if (!storageKey || !restored) return;
    try {
      window.localStorage.setItem(
        STORAGE_PREFIX + storageKey,
        JSON.stringify({ hidden: [...hiddenColumns], widths, order }),
      );
    } catch {
      // Private mode, or the quota is full. A table that cannot remember its
      // layout still works; one that throws while you drag a column does not.
    }
  }, [storageKey, restored, hiddenColumns, widths, order]);

  const widthFor = useCallback(
    (key: string, fallback: number) => widths[key] ?? fallback,
    [widths],
  );
  const setWidth = useCallback((key: string, width: number) => {
    setWidths((prev) => ({ ...prev, [key]: width }));
  }, []);

  const orderColumns = useCallback(
    <C extends { key: string }>(columns: C[]): C[] => {
      if (order.length === 0) return columns;
      const rank = new Map(order.map((key, index) => [key, index]));
      // Array#sort is stable, so two columns the stored order has never seen
      // hold their natural order relative to each other.
      return [...columns].sort((a, b) => {
        const rankA = rank.get(a.key);
        const rankB = rank.get(b.key);
        if (rankA === undefined && rankB === undefined) return 0;
        if (rankA === undefined) return 1;
        if (rankB === undefined) return -1;
        return rankA - rankB;
      });
    },
    [order],
  );

  const resetLayout = useCallback(() => {
    setHiddenColumns(new Set<string>());
    setWidths({});
    setOrder([]);
  }, []);

  const layoutChanged =
    hiddenColumns.size > 0 || Object.keys(widths).length > 0 || order.length > 0;

  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const toggleFilter = useCallback((column: string, value: string) => {
    setFilters((prev) => {
      const current = prev[column] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const out = { ...prev };
      // An empty selection is no filter at all, so the key goes away and the
      // funnel drops back to its resting state.
      if (next.length === 0) delete out[column];
      else out[column] = next;
      return out;
    });
  }, []);
  const clearFilters = useCallback(() => setFilters({}), []);
  const filterFor = useCallback((column: string) => filters[column] ?? [], [filters]);
  const activeFilterCount = useMemo(
    () => Object.values(filters).reduce((n, values) => n + values.length, 0),
    [filters],
  );
  const matchesFilters = useCallback(
    (valueOf: (column: string) => string) =>
      Object.entries(filters).every(([column, values]) =>
        values.includes(valueOf(column)),
      ),
    [filters],
  );

  return {
    sort,
    toggleSort,
    isColumnVisible,
    hiddenColumns,
    toggleColumn,
    filters,
    filterFor,
    toggleFilter,
    clearFilters,
    activeFilterCount,
    matchesFilters,
    widthFor,
    setWidth,
    orderColumns,
    setColumnOrder: setOrder,
    resetLayout,
    layoutChanged,
  };
}
