"use client";

import { useCallback, useMemo, useState } from "react";

// Table behaviour that has nothing to do with what a table renders: sort,
// per-column filters, column visibility, and search. Ported from Nudge's
// LeadsTable, minus everything that made that file 2800 lines — no saved
// views, no condition builder, no resizable columns, no URL state. State is
// plain component state and dies with the view.

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

// The search primitive. Deliberately not table-specific: the appointments list
// and the inbox conversation list feed it their own strings.
export function useSearch(): Search {
  const [query, setQuery] = useState("");
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
};

export function useTableState<K extends string>(initial: SortState<K>): TableState<K> {
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
  };
}
