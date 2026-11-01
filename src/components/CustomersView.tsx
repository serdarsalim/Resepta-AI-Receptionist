"use client";

import { customerHref, wantsNewTab } from "@/lib/customerLink";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useLanguage, useT } from "@/lib/LanguageProvider";
import { formatAge, localeFor } from "@/lib/datetime";
import {
  compareCells,
  moveKey,
  useTableState,
  type CellValue,
} from "@/lib/useTableState";
import { useHeaderSearch } from "@/lib/HeaderSearch";
import { ColumnPicker, HeaderFilter, MenuItem, Th } from "./DataTable";
import { PhoneInput } from "./PhoneField";
import { Sheet } from "./Sheet";
import { BulkComposer, type BulkChannel } from "./BulkActions";
import { HoverTip } from "./HoverTip";
import { buttonClass, fieldClass, iconButtonClass } from "./Control";
import { useConfirm } from "./ConfirmDialog";
import { customerName, hasCustomerName } from "@/lib/customerName";
import { TabLabel, tabClass } from "./TabLabel";

// The list and what was done to it. Contact fields lived on this strip from
// 2026-08-25 (moved off the voice agent's strip so an owner could find them)
// until 2026-11-01, when Serdar moved them to Business: defining what the
// business records about a customer is setup, done once, and setup lives with
// the other settings rather than beside the daily list.
//
// Bulk sends started here as a tab too (2026-08-29) and moved to Activity on
// 2026-11-01: a history of what a selection did belongs with the rest of what
// happened. Starting one stays here, on the selection; a sent run lands on
// Activity's Bulk sends.

type Customer = FunctionReturnType<typeof api.customers.listPage>["page"][number];
type ContactField = Doc<"contactFields">;

// What a table that has never been arranged shows: who they are and how to
// reach them. Everything else — when they were added, when they last replied,
// and every contact field the business defines — is one tick away in the
// Columns picker.
//
// It used to be everything, on the reasoning that a field you just created
// should be visible without hunting for a picker. True for the first two
// fields and wrong by the fifth: nothing ever removed a column, so the table
// only ever got wider, and the cost is paid on every visit to the customer
// list by everyone. The name column is pinned and never in the picker.
const DEFAULT_CUSTOMER_COLUMNS = ["phone", "email"] as const;

// Org-defined columns are namespaced so a field keyed "phone" can never
// collide with the built-in one.
const FIELD_PREFIX = "f:";
// The email column's own funnel: "has one" / "hasn't". It exists
// for the bulk sender, who needs to see who a mail can actually reach before
// picking a hundred people it will skip. Declared as filterOptions on the
// column rather than as a new control, so it inherits the funnel, the amber
// active count and the saved filter state every other column already has.
const HAS_EMAIL = "yes";
const NO_EMAIL = "no";
// The tick column. Wide enough for a checkbox plus the table's px-3, and
// counted into minWidth so the horizontal scroller knows about it.
const SELECT_COL_W = 40;
// A funnel on a free-text column is only useful while the value set is small.
// Past this the checklist is longer than the table and search is the better
// tool anyway.
const MAX_TEXT_FILTER_OPTIONS = 20;

type Column = {
  key: string;
  label: string;
  width: number;
  sortable: boolean;
  // Present means the header carries a funnel.
  filterOptions?: string[];
  labelFor?: (value: string) => string;
  numeric?: boolean;
};

function fullName(customer: Customer): string {
  return customerName(customer);
}

// The same green dot the inbox rows wear, because it is the same fact:
// somebody still has to look at this. Lit by an unread message, or by the
// person having arrived through the door on their own — a voice booking sends
// no message at all, so the inbox alone would never show them.
//
// A button, and it stops the click reaching the row underneath — the inbox's
// own trick, and the reason the whole row can stay clickable. Taking row-click
// away to protect this would cost a full-width target on every row to guard
// against a mis-hit that undoes itself in one more click.
//
// It only ever DISMISSES here, because it is only rendered when lit: there is
// nothing to press on a row that is already handled. Re-lighting one lives on
// the record page, where the hollow ring gives the finger something to find.
// One direction per surface, so neither is ambiguous.
function NewMark({ onDismiss }: { onDismiss: () => void }) {
  const t = useT();
  return (
    <HoverTip text={t("customers.dismissLook")} className="inline-flex shrink-0">
    <button
      type="button"
      aria-label={t("customers.dismissLook")}
      onClick={(event) => {
        event.stopPropagation();
        onDismiss();
      }}
      // The dot stays 8px; the box around it is 28 so it can be hit without
      // being big enough to catch clicks aimed at the name beside it. -my-1
      // keeps the taller box from setting the row height.
      className="-my-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-black/[0.07] dark:hover:bg-white/[0.12]"
    >
      <span className="h-2 w-2 rounded-full bg-[var(--brand)]" />
    </button>
    </HoverTip>
  );
}

// Indicator, not a control: mute is set on the contact record. Without it a
// muted row just looks like it sorts oddly, with nothing on screen saying why
// it sits at the bottom and never lights a dot.
//
// A speaker with a cross, grey rather than amber: mute is a choice somebody
// already made, not a problem the salon has to fix.
function MutedMark() {
  const t = useT();
  return (
    <HoverTip text={t("customers.mutedMark")} className="inline-flex shrink-0">
    <span
      aria-label={t("customers.mute")}
      className="inline-flex shrink-0 items-center text-[var(--muted)]"
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M11 5 6 9H2v6h4l5 4V5Z" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </svg>
    </span>
    </HoverTip>
  );
}

// The table keeps its client-side sort, funnels and search over what is
// loaded, so it loads the book in pages of 500 in the background, up to a soft
// cap of 5,000 (five times what the old single take reached). Each page is
// its own subscription and re-runs alone when one of its customers changes.
// Past the cap the header search still finds anyone, through the index.
const CUSTOMER_PAGE = 500;
const CUSTOMER_BOOK_CAP = 5000;

function useCustomerBook(): Customer[] | undefined {
  const { results, status, loadMore } = usePaginatedQuery(
    api.customers.listPage,
    {},
    { initialNumItems: CUSTOMER_PAGE },
  );
  useEffect(() => {
    if (status === "CanLoadMore" && results.length < CUSTOMER_BOOK_CAP) {
      loadMore(CUSTOMER_PAGE);
    }
  }, [status, results.length, loadMore]);
  return status === "LoadingFirstPage" ? undefined : results;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function CustomersView({
  onOpenContact,
  onOpenBulkSends,
}: {
  onOpenContact: (id: Id<"customers">) => void;
  onOpenBulkSends: () => void;
}) {
  const { t, language } = useLanguage();
  const customers = useCustomerBook();
  const contactFields = useQuery(api.contactFields.list, {});
  const setAttention = useMutation(api.messages.setAttention);
  const [adding, setAdding] = useState(false);
  // The open tab: All, the built-in Muted, or a saved view's id (Nudge's
  // Contacts strip). A view is a name over the column filters and the sort.
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);
  const [namingView, setNamingView] = useState(false);
  const views = useQuery(api.customerViews.list, {});
  const updateView = useMutation(api.customerViews.update);
  const removeView = useMutation(api.customerViews.remove);
  const [confirm, confirmDialog] = useConfirm();
  // Ticked rows, and the anchor a shift-click sweeps from. Both ported from
  // RevenueView, which is this app's only prior multi-select and already
  // settled the two decisions that matter: the anchor is an index into the
  // VISIBLE list (the one the finger is actually travelling down), and the
  // selection is an inclusion set of ids rather than an exclusion set.
  //
  // Inclusion works here because the loaded book is one plain array and a
  // tick is an explicit id — a customer arriving mid-selection cannot disturb
  // what is already ticked. Nudge inverts this, but it has to: its recipient
  // list is a live segment that re-runs, so "everyone except these" is the
  // only stable way to say it there.
  const [selected, setSelected] = useState<ReadonlySet<Id<"customers">>>(new Set());
  const anchor = useRef<number | null>(null);
  // Which composer is open over the list, if any. Null is the resting state.
  const [composing, setComposing] = useState<BulkChannel | null>(null);
  const me = useQuery(api.orgs.current, {});

  // Opening the record IS reading it, so the dot goes out on the way in — the
  // same stamp the inbox writes when somebody dismisses a row by hand, because
  // it is the same fact being recorded and a second field would be a second
  // answer. Fired only when it is lit: an unconditional write would touch
  // every customer anyone ever clicked, for nothing.
  const openContact = (customer: Customer) => {
    if (customer.needsAttention) {
      void setAttention({ customerId: customer._id, cleared: true });
    }
    onOpenContact(customer._id);
  };

  // The new-tab half of a row click (lib/customerLink). A middle click
  // arrives as auxclick only; a plain left click falls through to here too.
  const openOrNewTab = (
    event: { metaKey: boolean; ctrlKey: boolean; button?: number; preventDefault: () => void },
    customer: Customer,
  ) => {
    if (wantsNewTab(event)) {
      event.preventDefault();
      if (me) window.open(customerHref(customer._id, me.org._id), "_blank", "noopener");
      return;
    }
    if (event.button !== undefined && event.button !== 0) return;
    openContact(customer);
  };

  const table = useTableState<string>(
    { key: "added", dir: "desc" },
    "customers",
    DEFAULT_CUSTOMER_COLUMNS,
  );
  const search = useHeaderSearch(t("common.search"));

  const fields: ContactField[] = useMemo(() => contactFields ?? [], [contactFields]);
  const fieldByKey = useMemo(
    () => new Map(fields.map((field) => [field.key, field])),
    [fields],
  );

  // Dates read as day-level facts here: a salon owner scanning a list wants
  // "when", not "at what minute". Drives the Added column, custom date fields
  // and the CSV export; only Last activity still renders an age (formatAge).
  //
  // Deliberately
  // day/short-month/year ("20 Jul 2026") rather than a numeric date, because
  // 07/08 is two different days depending on who is reading it and this app
  // ships in three languages. Locale drives month name and word order.
  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(localeFor(language), {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    [language],
  );

  const customValue = (customer: Customer, fieldKey: string): string =>
    customer.custom?.[fieldKey] ?? "";

  // What a cell sorts by. Numbers stay numbers so 9 lands before 10.
  const sortValue = (customer: Customer, key: string): CellValue => {
    switch (key) {
      case "name":
        return fullName(customer);
      case "phone":
        return customer.phone;
      case "email":
        return customer.email;
      case "added":
        return customer._creationTime;
      case "lastActivity":
        return customer.lastInboundAt;
      default: {
        const fieldKey = key.slice(FIELD_PREFIX.length);
        const raw = customValue(customer, fieldKey);
        if (!raw) return undefined;
        if (fieldByKey.get(fieldKey)?.type === "number") {
          const parsed = Number(raw);
          return Number.isFinite(parsed) ? parsed : raw;
        }
        return raw;
      }
    }
  };

  // What a funnel matches on. Blank is "", which is exactly the value the
  // "Blank" entry in the checklist carries.
  const filterValue = (customer: Customer, key: string): string => {
    if (key === "email") return customer.email ? HAS_EMAIL : NO_EMAIL;
    if (key.startsWith(FIELD_PREFIX)) {
      return customValue(customer, key.slice(FIELD_PREFIX.length));
    }
    return "";
  };

  // What the cell prints. Empty string prints nothing: blank over zero, never
  // a dash.
  const displayValue = (customer: Customer, key: string): string => {
    switch (key) {
      case "name":
        return fullName(customer);
      case "phone":
        return customer.phone;
      case "email":
        return customer.email ?? "";
      // Added is a FACT, not a recency: the day someone became a customer
      // doesn't get more or less interesting as it ages, and "21d" makes the
      // reader do arithmetic to answer "when did we get them". Last activity
      // is the opposite — nobody cares which Tuesday it was, only whether it
      // was recent — so it keeps the age treatment. Sorting reads
      // _creationTime either way, so the column still sorts by time.
      case "added":
        return dayFormat.format(customer._creationTime);
      case "lastActivity":
        return customer.lastInboundAt ? formatAge(customer.lastInboundAt, language) : "";
      default: {
        const fieldKey = key.slice(FIELD_PREFIX.length);
        const raw = customValue(customer, fieldKey);
        if (raw && fieldByKey.get(fieldKey)?.type === "date") {
          const parsed = Date.parse(raw);
          if (!Number.isNaN(parsed)) return dayFormat.format(parsed);
        }
        return raw;
      }
    }
  };

  const columns: Column[] = useMemo(() => {
    const rows = customers ?? [];
    const built: Column[] = [
      { key: "phone", label: t("customers.phone"), width: 165, sortable: true, numeric: true },
      {
        key: "email",
        label: t("customers.email"),
        width: 210,
        sortable: true,
        // Two options, always both offered, even when every customer has an
        // address: unlike the text-column funnels below, this one is not a
        // checklist of values that happen to be present. It answers a yes/no
        // question, and a funnel that disappears once the answer is uniform
        // is a control that vanishes exactly when it would have told you so.
        filterOptions: [HAS_EMAIL, NO_EMAIL],
        labelFor: (value) =>
          value === HAS_EMAIL ? t("customers.hasEmail") : t("customers.noEmail"),
      },
      { key: "added", label: t("customers.added"), width: 140, sortable: true, numeric: true },
      {
        // The key stays "lastActivity" while the label reads "Last reply":
        // column keys are persisted in the saved table state, so renaming this
        // one would quietly drop every user's sort, filters and column order
        // to fix a word they only ever see in the header.
        key: "lastActivity",
        label: t("customers.lastReply"),
        width: 155,
        sortable: true,
        numeric: true,
      },
    ];

    for (const field of fields) {
      const present = new Set<string>();
      let anyBlank = false;
      for (const customer of rows) {
        const value = customer.custom?.[field.key] ?? "";
        if (value) present.add(value);
        else anyBlank = true;
      }
      // A select filters on what the org declared plus anything already stored
      // under a since-renamed option. Free text earns a funnel only while the
      // value set stays short; numbers and dates get sort, not a checklist.
      let options: string[] | undefined;
      if (field.type === "select") {
        const declared = field.options ?? [];
        options = [...declared, ...[...present].filter((v) => !declared.includes(v)).sort()];
      } else if (field.type === "text" && present.size > 0 && present.size <= MAX_TEXT_FILTER_OPTIONS) {
        options = [...present].sort();
      }
      if (options && anyBlank) options = [...options, ""];
      built.push({
        key: `${FIELD_PREFIX}${field.key}`,
        label: field.label,
        width: 170,
        sortable: true,
        filterOptions: options && options.length > 0 ? options : undefined,
        numeric: field.type === "number" || field.type === "date",
      });
    }
    return built;
  }, [customers, fields, t]);

  // Order first, then hide. The stored order covers EVERY column, not just the
  // visible ones, so re-showing a column from the picker returns it to where
  // it was dragged rather than to the end of the row.
  const orderedColumns = table.orderColumns(columns);
  const visibleColumns = orderedColumns.filter((column) => table.isColumnVisible(column.key));
  const columnKeys = orderedColumns.map((column) => column.key);
  const dragKey = useRef<string | null>(null);

  // In an effect, not during render: deciding a new column's default flips
  // state, and the columns are only known once the field list has loaded.
  // syncColumns is a no-op once every key has been seen, so this settles after
  // the first pass and stays quiet.
  //
  // Keyed on the joined list rather than the array: orderedColumns is rebuilt
  // every render, so the array identity alone would re-fire this forever.
  const { syncColumns } = table;
  const columnSignature = columnKeys.join("|");
  useEffect(() => {
    syncColumns(columnSignature.split("|"));
  }, [syncColumns, columnSignature]);

  const rows = useMemo(() => {
    const all = customers ?? [];
    // The Muted tab is everyone muted and nobody else; All keeps them, sunk
    // below the rest.
    const list =
      activeTab === MUTED_TAB ? all.filter((customer) => customer.mutedAt !== undefined) : all;
    const matched = list.filter((customer) =>
      search.matches(
        fullName(customer),
        customer.phone,
        customer.email,
        ...Object.values(customer.custom ?? {}),
      ),
    );
    // A query REVEALS what the funnels are hiding. Someone typing a name is
    // asking "is this person in here", and a filter set an hour ago must not
    // answer no on their behalf.
    const kept = search.active
      ? matched
      : matched.filter((customer) =>
          table.matchesFilters((column) => filterValue(customer, column)),
        );
    // Muted contacts sink below every unmuted row, whatever column is sorted
    // and whichever direction. Mute is not a value in a column, it is a
    // statement about how much of the list this person deserves, so it ranks
    // ahead of the sort rather than inside it.
    //
    // A search is the exception, for the reason stated above: someone typing a
    // name is asking whether this person is in here, and burying the one match
    // under everybody else answers a question they did not ask.
    return [...kept].sort((a, b) => {
      if (!search.active) {
        const muted = Number(a.mutedAt !== undefined) - Number(b.mutedAt !== undefined);
        if (muted !== 0) return muted;
      }
      return compareCells(
        sortValue(a, table.sort.key),
        sortValue(b, table.sort.key),
        table.sort.dir,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, fieldByKey, search.active, search.matches, table.matchesFilters, table.sort, activeTab]);

  // The screen and the file disagree on purpose. A cell is read at a glance
  // and wants an age ("3g"); a spreadsheet is filtered, pivoted and kept, and
  // an age is worthless the day after it is exported.
  const csvValue = (customer: Customer, key: string): string => {
    switch (key) {
      case "added":
        return dayFormat.format(customer._creationTime);
      case "lastActivity":
        return customer.lastInboundAt ? dayFormat.format(customer.lastInboundAt) : "";
      default:
        return displayValue(customer, key);
    }
  };

  const exportCsv = () => {
    const exported = [{ key: "name", label: t("customers.name") }, ...visibleColumns];
    const lines = [
      exported.map((column) => csvCell(column.label)).join(","),
      ...rows.map((customer) =>
        exported.map((column) => csvCell(csvValue(customer, column.key))).join(","),
      ),
    ];
    // The BOM is what makes Excel read the Turkish characters instead of
    // mangling them.
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "customers.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  // The selection universe is `rows`: what survived the funnels and the
  // search, in the order shown. So "select all" means every row on screen,
  // never every customer in the table — which is also the only honest
  // promise available, because the table loads at most CUSTOMER_BOOK_CAP.
  const picked = rows.filter((customer) => selected.has(customer._id));
  const allSelected = rows.length > 0 && picked.length === rows.length;

  // Changing a filter drops selections it hides, because `picked` is derived
  // from the visible rows rather than kept alongside them. That is deliberate
  // and it is RevenueView's rule too: the count on the bar always describes
  // something the person can see, and a run that quietly included forty rows
  // filtered away ten minutes ago is the worst outcome this feature has.
  const toggleRow = (index: number, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const turnOn = !next.has(rows[index]._id);
      // The anchor is an index into a list that changes underneath it: every
      // funnel, every keystroke in the search box and every sort rebuilds
      // `rows`. Tick row 90, filter down to 12, shift-click row 3, and the
      // sweep runs to 90 through an array that ends at 11 — rows[i] is
      // undefined and reading _id off it takes the tab down. Clamping is
      // enough; the alternative, clearing the anchor whenever rows changes,
      // costs an effect and a re-render on every keystroke to fix a case the
      // person cannot see anyway.
      const ceiling = rows.length - 1;
      const raw = shift && anchor.current !== null ? anchor.current : index;
      const other = Math.min(Math.max(raw, 0), ceiling);
      const from = Math.min(other, index);
      const to = Math.max(other, index);
      for (let i = from; i <= to; i++) {
        if (turnOn) next.add(rows[i]._id);
        else next.delete(rows[i]._id);
      }
      return next;
    });
    anchor.current = index;
  };

  const clearSelection = () => {
    setSelected(new Set());
    anchor.current = null;
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((customer) => customer._id)));
    anchor.current = null;
  };

  const hasCustomers = (customers?.length ?? 0) > 0;
  const widthOf = (column: Column) => table.widthFor(column.key, column.width);
  const minWidth =
    260 + SELECT_COL_W + visibleColumns.reduce((total, column) => total + widthOf(column), 0);

  // The table's own controls, lifted out of the return so the toolbar above
  // the card can show them on desktop and leave Columns out on a phone,
  // without the markup existing twice.
  //
  // Search is NOT here — it moved to the shell header, where it sits in the
  // same place on every tab.
  const columnPicker = hasCustomers ? (
    <ColumnPicker
                // Ordered, not the raw list: once a column has been dragged,
                // a picker still reading left-to-right in the original order
                // is a second, disagreeing map of the same table.
                columns={orderedColumns}
                hidden={table.hiddenColumns}
                onToggle={table.toggleColumn}
                footer={(close) => (
                  <>
                    {table.activeFilterCount > 0 && (
                      <MenuItem
                        onClick={() => {
                          table.clearFilters();
                          close();
                        }}
                      >
                        {t("table.clearFilters")}
                      </MenuItem>
                    )}
                    {/* A column dragged to the minimum width, or parked behind
                        ten others, is genuinely hard to undo by hand. */}
                    {table.layoutChanged && (
                      <MenuItem
                        onClick={() => {
                          table.resetLayout();
                          close();
                        }}
                      >
                        {t("table.resetLayout")}
                      </MenuItem>
                    )}
                    <MenuItem
                      onClick={() => {
                        exportCsv();
                        close();
                      }}
                    >
                      {t("table.exportCsv")}
                    </MenuItem>
                  </>
                )}
    />
  ) : null;

  const addButton = (
    <button
      type="button"
      className={`${buttonClass("primary", "sm")} shrink-0 gap-1.5`}
      onClick={() => setAdding(true)}
    >
      <PlusGlyph />
      {t("customers.new")}
    </button>
  );

  const mutedCount = (customers ?? []).filter((customer) => customer.mutedAt !== undefined).length;
  const activeView = views?.find((view) => view._id === activeTab);
  // Gone from under us (deleted by someone else, or a switch of business):
  // back to All rather than a tab that names nothing.
  useEffect(() => {
    if (activeTab === ALL_TAB || activeTab === MUTED_TAB || views === undefined) return;
    if (!views.some((view) => view._id === activeTab)) {
      setActiveTab(ALL_TAB);
      table.clearFilters();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, activeTab]);
  const openTab = (key: string) => {
    setActiveTab(key);
    clearSelection();
    const view = views?.find((entry) => entry._id === key);
    table.applyView(
      view
        ? { filters: view.filters, sort: view.sort }
        : { filters: {} },
    );
  };
  // A view whose filters or sort were changed on its tab has something to
  // save; the row offers Save and Reset, as Nudge's does.
  const viewChanged =
    activeView !== undefined &&
    (sameFilters(activeView.filters, table.filters) === false ||
      (activeView.sort?.key ?? "added") !== table.sort.key ||
      (activeView.sort?.dir ?? "desc") !== table.sort.dir);

  const tabs: { key: string; label: string }[] = [
    { key: ALL_TAB, label: t("customers.tabAll") },
    ...(mutedCount > 0 || activeTab === MUTED_TAB
      ? [{ key: MUTED_TAB, label: t("customers.tabMuted") }]
      : []),
    ...(views ?? []).map((view) => ({ key: view._id as string, label: view.name })),
  ];

  const list = (
    <>
      {/* Nudge's Contacts head (Serdar, 2026-11-01): the views as underlined
          tabs with + after them, Add customer at the strip's right end; then
          the count left and the table's view controls right, above the card.
          The verbs take that second row while a selection stands, so "Add
          customer" is never one slip from "Call 20 people". */}
      <div className="flex items-end gap-5 border-b border-[var(--border)]">
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => openTab(tab.key)}
              aria-current={activeTab === tab.key ? "page" : undefined}
              className={tabClass(activeTab === tab.key, "flex max-w-[14rem] min-w-0")}
            >
              <TabLabel text={tab.label} />
            </button>
          ))}
          <HoverTip text={t("views.new")} className="mb-1.5 inline-flex shrink-0">
            <button
              type="button"
              onClick={() => setNamingView(true)}
              aria-label={t("views.new")}
              className={iconButtonClass("quiet", "xs")}
            >
              <PlusGlyph />
            </button>
          </HoverTip>
        </div>
        <div className="mb-1.5 shrink-0">{addButton}</div>
      </div>

      <div className="flex min-h-8 flex-wrap items-center gap-2">
        {picked.length > 0 ? (
          <div className="hidden w-full sm:contents">
            <BulkBar
              count={picked.length}
              onCompose={setComposing}
              onClear={clearSelection}
            />
          </div>
        ) : (
          <>
            <span className="text-sm tabular-nums text-[var(--muted)]">
              {customers === undefined ? "" : t.plural("customers.count", rows.length)}
            </span>
            {activeView?.canEdit && viewChanged && (
              <>
                <button
                  type="button"
                  className={buttonClass("outline", "sm")}
                  onClick={() =>
                    void updateView({
                      viewId: activeView._id,
                      filters: { ...table.filters },
                      sort: { key: table.sort.key, dir: table.sort.dir },
                    })
                  }
                >
                  {t("views.save")}
                </button>
                <button
                  type="button"
                  className={buttonClass("quiet", "sm")}
                  onClick={() => openTab(activeView._id)}
                >
                  {t("views.reset")}
                </button>
              </>
            )}
            {activeView?.canEdit && !viewChanged && (
              <button
                type="button"
                className={buttonClass("quiet", "sm")}
                onClick={async () => {
                  const ok = await confirm({
                    title: t("views.delete"),
                    body: t("views.deleteConfirm"),
                  });
                  if (!ok) return;
                  await removeView({ viewId: activeView._id });
                  openTab(ALL_TAB);
                }}
              >
                {t("views.delete")}
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {table.activeFilterCount > 0 && (
                <button
                  type="button"
                  className={buttonClass("pill", "sm")}
                  onClick={table.clearFilters}
                >
                  {t("table.clearFilters")} ({table.activeFilterCount})
                </button>
              )}
              <div className="hidden sm:contents">{columnPicker}</div>
            </div>
          </>
        )}
      </div>

      {confirmDialog}
      {namingView && (
        <NewViewSheet
          filters={table.filters}
          sort={table.sort}
          onClose={() => setNamingView(false)}
          onCreated={(viewId) => {
            setNamingView(false);
            setActiveTab(viewId);
          }}
        />
      )}
      {adding && <NewCustomerSheet onClose={() => setAdding(false)} />}

      {customers === undefined && (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      )}
      {/* Desktop reads this inside the card, under the toolbar's Add
          customer, so the button is on screen for a salon with no customers
          yet. */}
      {customers?.length === 0 && (
        <p className="text-sm text-[var(--muted)] sm:hidden">{t("customers.none")}</p>
      )}
      {/* On desktop this line lives in the table body instead, so the header
          and its funnels survive a filter that matches nothing: whatever hid
          the rows has to stay undoable. */}
      {hasCustomers && rows.length === 0 && (
        <p className="text-sm text-[var(--muted)] sm:hidden">{t("customers.noMatches")}</p>
      )}

      {/* Phones get the list they already had: seven columns on a 390px screen
          is unreadable, and a horizontal scrubber is worse. Sort and filter are
          desktop affordances; search works in both. */}
      {rows.length > 0 && (
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] sm:hidden">
          {rows.map((customer) => (
            <li
              key={customer._id}
              className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
              onClick={(event) => openOrNewTab(event, customer)}
              onAuxClick={(event) => openOrNewTab(event, customer)}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={`truncate ${hasCustomerName(customer) ? "name-link" : "font-medium text-[var(--muted)]"}`}>{fullName(customer)}</span>
                  {customer.needsAttention && (
                    <NewMark
                      onDismiss={() =>
                        void setAttention({
                          customerId: customer._id,
                          cleared: true,
                        })
                      }
                    />
                  )}
                  {customer.mutedAt !== undefined && <MutedMark />}
                </span>
                <span className="block text-xs tabular-nums text-[var(--muted)]">
                  {customer.phone}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Gated on LOADED, not on having rows, so a salon with no customers
          yet sees the card's "no customers" line under the toolbar's Add
          customer rather than nothing at all. */}
      {customers !== undefined && (
        <div className="hidden rounded-lg bg-[var(--card)] shadow-[var(--card-shadow)] sm:block">
          {/* The table scrolls sideways inside its own card. The page body
              never does.

              px-4 here rather than on the card is what insets the rules. The
              header's bottom border and every row divider are drawn by the
              TABLE, so they can only ever run its full width — the way to
              stop them touching the card's edge is to make the table narrower
              than the card, which is what padding on the scroller does. Cell
              padding drops to px-3 in exchange, so the first column's text
              lands about where it did before. */}
          {hasCustomers ? (
          <div className="thin-scroll overflow-x-auto overscroll-x-contain px-4 pb-1 pt-2">
            <table className="w-full text-sm" style={{ tableLayout: "fixed", minWidth }}>
              <colgroup>
                {/* The tick column. Fixed and narrow, ahead of the pinned
                    Name column, so the select-all in the header sits directly
                    over the column it commands. */}
                <col style={{ width: SELECT_COL_W }} />
                {/* Name takes no width of its own: it absorbs whatever the
                    fixed columns leave, so a row never ends in a ghost gap. */}
                <col />
                {visibleColumns.map((column) => (
                  <col key={column.key} style={{ width: widthOf(column) }} />
                ))}
              </colgroup>
              <thead className="text-left">
                <tr>
                  {/* Not a Th: it carries no label, no sort and no resize
                      handle, and giving it one would put a draggable,
                      droppable column header around a checkbox. The border
                      and padding are copied from Th so the hairline under the
                      header runs unbroken across it. */}
                  <th
                    scope="col"
                    className="border-b border-[var(--border)] px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={t("customers.selectAll")}
                    />
                  </th>
                  <Th
                    label={t("customers.name")}
                    sortDir={table.sort.key === "name" ? table.sort.dir : null}
                    onSort={() => table.toggleSort("name")}
                  />
                  {visibleColumns.map((column) => (
                    <Th
                      key={column.key}
                      label={column.label}
                      sortDir={table.sort.key === column.key ? table.sort.dir : null}
                      onSort={column.sortable ? () => table.toggleSort(column.key) : undefined}
                      width={widthOf(column)}
                      onResize={(next) => table.setWidth(column.key, next)}
                      drag={{
                        onDragStart: () => {
                          dragKey.current = column.key;
                        },
                        onDrop: () => {
                          const from = dragKey.current;
                          dragKey.current = null;
                          if (from) table.setColumnOrder(moveKey(columnKeys, from, column.key));
                        },
                      }}
                      filter={
                        column.filterOptions ? (
                          <HeaderFilter
                            options={column.filterOptions}
                            selected={table.filterFor(column.key)}
                            onToggle={(value) => table.toggleFilter(column.key, value)}
                            labelFor={column.labelFor}
                          />
                        ) : undefined
                      }
                    />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--table-divider)]">
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={visibleColumns.length + 2}
                      className="px-3 py-6 text-[var(--muted)]"
                    >
                      {t("customers.noMatches")}
                    </td>
                  </tr>
                )}
                {rows.map((customer, index) => (
                  <tr
                    key={customer._id}
                    tabIndex={0}
                    // Cmd/ctrl-click or the middle button opens the record in a
                    // new tab, like a link (P12); a plain click opens it here.
                    onClick={(event) => openOrNewTab(event, customer)}
                    onAuxClick={(event) => openOrNewTab(event, customer)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") openOrNewTab(event, customer);
                    }}
                    className="cursor-pointer outline-none transition-colors hover:bg-[var(--row-hover-bg)] focus-visible:bg-[var(--row-hover-bg)]"
                  >
                    {/* The whole row opens the contact, so the tick has to
                        stop its click reaching it — NewMark's trick, and the
                        reason the row can stay a full-width target. The cell
                        swallows the click as well as the box: a finger that
                        lands 3px off the checkbox meant to tick it, not to
                        navigate away from the list it was ticking. */}
                    <td
                      className="px-3 py-2.5"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {/* onClick, not onChange: only the MouseEvent knows
                          whether shift was held. readOnly keeps React from
                          warning about a checked input with no onChange. */}
                      <input
                        type="checkbox"
                        checked={selected.has(customer._id)}
                        onClick={(event) => toggleRow(index, event.shiftKey)}
                        readOnly
                        aria-label={fullName(customer)}
                      />
                    </td>
                    <td className="px-3 py-2.5 font-medium">
                      <span className="flex items-center gap-1.5">
                        <span className={`truncate ${hasCustomerName(customer) ? "name-link" : "text-[var(--muted)]"}`}>{fullName(customer)}</span>
                        {customer.needsAttention && (
                          <NewMark
                            onDismiss={() =>
                              void setAttention({
                                customerId: customer._id,
                                cleared: true,
                              })
                            }
                          />
                        )}
                        {customer.mutedAt !== undefined && <MutedMark />}
                      </span>
                    </td>
                    {visibleColumns.map((column) => (
                      <td
                        key={column.key}
                        className={`truncate px-3 py-2.5 text-[var(--muted)] ${
                          column.numeric ? "tabular-nums" : ""
                        }`}
                      >
                        {displayValue(customer, column.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          ) : (
            <p className="p-4 text-sm text-[var(--muted)]">
              {t("customers.none")}
            </p>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-4 page-stack">
      {list}

      {/* Mounted beside the list rather than inside it: the composer is a
          drill-in over the whole tab (AGENTS: adding is a sheet you open),
          and it closes back to the selection it was launched from, which is
          why the tick set survives it. */}
      {composing && (
        <BulkComposer
          channel={composing}
          customers={picked}
          onClose={() => setComposing(null)}
          onSent={() => {
            setComposing(null);
            clearSelection();
            onOpenBulkSends();
          }}
        />
      )}
    </div>
  );
}

// The verbs, and the count they act on. Three buttons and a way out, because
// a bar that appears the moment something is ticked also has to say how to
// make it go away. Who a run will skip (unsubscribed, no address) is the
// composer's first line, before anything is sent.
function BulkBar({
  count,
  onCompose,
  onClear,
}: {
  count: number;
  onCompose: (channel: BulkChannel) => void;
  onClear: () => void;
}) {
  const t = useT();
  const verb =
    "h-9 rounded-lg border border-[var(--border)] px-3 text-sm font-medium transition-colors hover:bg-[var(--row-hover-bg)]";
  return (
    <>
      <span className="text-sm font-medium">
        {t("bulk.selected", { n: count })}
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <button type="button" className={verb} onClick={() => onCompose("email")}>
          {t("bulk.email")}
        </button>
        <button type="button" className={verb} onClick={() => onCompose("whatsapp")}>
          {t("bulk.whatsapp")}
        </button>
        <button type="button" className={verb} onClick={() => onCompose("call")}>
          {t("bulk.call")}
        </button>
        <button
          type="button"
          className="h-9 px-2 text-sm text-[var(--muted-strong)] transition-colors hover:text-[var(--foreground)]"
          onClick={onClear}
        >
          {t("bulk.clear")}
        </button>
      </span>
    </>
  );
}

// One field per line, in the order somebody says them out loud: who they are
// and how to reach them. The old version was a three-column grid wedged
// between the toolbar and the table, which pushed the list you came to read
// off the bottom of the screen every time you opened it. The consent checkbox
// that closed it went on 2026-10-21 with the gate it fed.
function NewCustomerSheet({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const create = useMutation(api.customers.create);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Sheet title={t("customers.new")} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError(null);
          setPending(true);
          try {
            await create({
              firstName: String(form.get("firstName") ?? ""),
              lastName: String(form.get("lastName") ?? "") || undefined,
              phone: String(form.get("phone") ?? ""),
              email: String(form.get("email") ?? "") || undefined,
            });
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "error");
          } finally {
            setPending(false);
          }
        }}
      >
        {/* Two names on one line: they are one answer to one question, and
            stacking them spends a row on a nine-character field. */}
        <div className="flex gap-2">
          <label className="min-w-0 flex-1 text-xs font-medium">
            {t("customers.firstName")}
            <input name="firstName" required autoFocus className="mt-1" />
          </label>
          <label className="min-w-0 flex-1 text-xs font-medium">
            {t("customers.lastName")}
            <input name="lastName" className="mt-1" />
          </label>
        </div>

        <label className="block text-xs font-medium" htmlFor="new-customer-phone">
          {t("customers.phone")}
          <PhoneInput id="new-customer-phone" name="phone" required className="mt-1" />
        </label>

        <label className="block text-xs font-medium">
          {t("customers.email")}
          <input name="email" type="email" className="mt-1" />
        </label>

        {/* The line is reserved whether or not it holds anything, so a failed
            save does not shove the buttons out from under the pointer. */}
        <p className="min-h-[1.25rem] text-sm text-red-600 dark:text-red-400">{error}</p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-60"
          >
            {t("common.add")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

const ALL_TAB = "all";
const MUTED_TAB = "muted";

function sameFilters(
  a: Readonly<Record<string, string[]>>,
  b: Readonly<Record<string, string[]>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = [...(a[key] ?? [])].sort();
    const right = [...(b[key] ?? [])].sort();
    if (left.length !== right.length || left.some((value, i) => value !== right[i])) return false;
  }
  return true;
}

function PlusGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// Names the current filters and sort as a view. The view opens as the active
// tab, already matching what is on screen, so there is nothing to save.
function NewViewSheet({
  filters,
  sort,
  onClose,
  onCreated,
}: {
  filters: Readonly<Record<string, string[]>>;
  sort: { key: string; dir: "asc" | "desc" };
  onClose: () => void;
  onCreated: (viewId: string) => void;
}) {
  const t = useT();
  const create = useMutation(api.customerViews.create);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={t("views.new")} hint={t("views.newHint")} dirty={name.length > 0} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          try {
            const viewId = await create({
              name,
              filters: { ...filters },
              sort: { key: sort.key, dir: sort.dir },
            });
            onCreated(viewId);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("views.name")}</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            className={`${fieldClass("sm")} w-full`}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonClass("quiet", "md")}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={!name.trim() || busy} className={buttonClass("primary", "md")}>
            {t("views.create")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
