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
import { FieldsCard } from "./BusinessView";
import { BulkComposer, BulkRunsCard, type BulkChannel } from "./BulkActions";
import { HoverTip } from "./HoverTip";

// The list, and the definition of what the list HOLDS. Contact fields moved
// here from the voice agent's strip on 2026-08-25 (Serdar: the app is for
// people who are not technically versatile, and nobody looks under Voice to
// find out what they record about a customer).
//
// The argument that kept them on that strip is in VoiceView's header and it
// half made this case itself: a field's sibling is the customer record, not
// the price list. What it weighed against that was the cohesion of the voice
// tab — the agent, its calls, and the vocabulary it works in — and cohesion
// for the person building the agent lost to findability for the person who
// owns the salon. The Locked / Can edit column stays, because the agent IS a
// consumer of these fields; it is one column now instead of the landlord.
//
// NOT the foot of the Columns picker, where it also briefly lived. Fields are
// those columns, so the rule about rare actions fit the letter and missed the
// point: this is a setup surface, and a setup surface inside a dropdown is not
// findable by the person who needs it most.
//
// Bulk joins List and Fields rather than earning a sidebar door of its own
// (Serdar, 2026-08-29). It acts on the selection made in the list one tab
// over, and a history of what that selection did is not a destination anybody
// navigates to cold.
type CustomersSection = "list" | "fields" | "bulk";

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
// Consent is a stamp, not a value, so the funnel filters on these two.
const CONSENT_ON = "yes";
const CONSENT_OFF = "no";
// The email column's own funnel reuses them: "has one" / "hasn't". It exists
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
  return `${customer.firstName} ${customer.lastName ?? ""}`.trim();
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

// A bell with a line through it: this person gets no messages. Consent used to
// own a whole column that was blank for everyone who had it — 130px spent
// saying nothing four rows in five, which is also what pushed Last activity
// off the right edge. Nobody in the category does that: HubSpot and Salesforce
// keep consent on the record and make it a segment, and Fresha and Booksy keep
// it on the client profile.
//
// It cannot go all the way onto the profile here, though. In those products
// consent gates MARKETING; under KVKK it gates everything, reminders included
// (wa.sendAppointmentMessage), so a customer without it books on Friday and is
// simply never reminded. That is a broken row, not a preference, and a broken
// row earns a mark. Finding them is the Name column's funnel, which is where
// every other filter in this table already lives.
function NoConsentMark() {
  const t = useT();
  return (
    <HoverTip text={t("customers.cannotBeMessaged")} className="inline-flex shrink-0">
    <span
      aria-label={t("customers.cannotBeMessaged")}
      className="inline-flex shrink-0 items-center text-amber-600 dark:text-amber-500"
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
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        <path d="M18.63 13A17.9 17.9 0 0 1 18 8" />
        <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
        <path d="M18 8a6 6 0 0 0-9.33-5" />
        <path d="m2 2 20 20" />
      </svg>
    </span>
    </HoverTip>
  );
}

// Indicator, not a control: mute is set on the contact record. Without it a
// muted row just looks like it sorts oddly, with nothing on screen saying why
// it sits at the bottom and never lights a dot.
//
// A speaker with a cross, deliberately NOT the bell NoConsentMark just used.
// The two can appear on the same row and mean different things, so they cannot
// share a glyph. Grey rather than amber for the same reason: no consent is a
// problem the salon has to fix, mute is a choice somebody already made.
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
}: {
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t, language } = useLanguage();
  const customers = useCustomerBook();
  const contactFields = useQuery(api.contactFields.list, {});
  const setAttention = useMutation(api.messages.setAttention);
  const [adding, setAdding] = useState(false);
  const [section, setSection] = useState<CustomersSection>("list");
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
  // A follow-up's recipients (P13b): the people a past run's detail showed,
  // composed to instead of the list's selection, which stays as it was.
  const [followUp, setFollowUp] = useState<Doc<"customers">[] | null>(null);
  // Read here rather than taken as a prop, the same way VoiceView does it:
  // FieldsCard needs it, this is the only other caller, and threading a
  // permission down through AppShell for one card puts the answer somewhere
  // that does not own the question. Staff see the fields read-only.
  const me = useQuery(api.orgs.current, {});
  const isOwner = me ? me.me.role !== "staff" : false;

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
      case "consent":
        return customer.consentAt;
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
    if (key === "consent") return customer.consentAt ? CONSENT_ON : CONSENT_OFF;
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
    const list = customers ?? [];
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
  }, [customers, fieldByKey, search.active, search.matches, table.matchesFilters, table.sort]);

  // The screen and the file disagree on purpose. A cell is read at a glance
  // and wants an age ("3g"); a spreadsheet is filtered, pivoted and kept, and
  // an age is worthless the day after it is exported. Consent already had to
  // opt out of displayValue for the same reason — the cell says nothing when
  // consent is on file, which would export as a blank that reads like missing
  // data rather than the normal case.
  const csvValue = (customer: Customer, key: string): string => {
    switch (key) {
      case "consent":
        return customer.consentAt ? t("customers.consentGiven") : t("customers.noConsent");
      case "added":
        return dayFormat.format(customer._creationTime);
      case "lastActivity":
        return customer.lastInboundAt ? dayFormat.format(customer.lastInboundAt) : "";
      default:
        return displayValue(customer, key);
    }
  };

  const exportCsv = () => {
    // Consent rides along unconditionally now that it has no column to be
    // visible in. It is the one field here that answers to a regulator, and
    // "it wasn't on screen when I exported" is not a defence.
    const exported = [
      { key: "name", label: t("customers.name") },
      ...visibleColumns,
      { key: "consent", label: t("customers.consent") },
    ];
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

  // The table's own controls, lifted out of the return so they can be mounted
  // in the card header on desktop and left out entirely on a phone, without
  // the markup existing twice.
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
      className="ml-auto h-9 shrink-0 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-[var(--accent-fg)]"
      onClick={() => setAdding(true)}
    >
      {t("customers.new")}
    </button>
  );

  const list = (
    <>
      {/* A phone has no table to hang a header on — it gets the card list
          below — so the one action it needs keeps its own row. Columns is
          desktop-only either way: below sm there is no table to pick columns
          for. */}
      <div className="flex sm:hidden">{addButton}</div>

      {adding && <NewCustomerSheet onClose={() => setAdding(false)} />}

      {customers === undefined && (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      )}
      {/* Desktop reads this inside the card, under the header, so the Add
          customer button is still on screen for a salon with no customers
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
                  <span className="truncate font-medium">{fullName(customer)}</span>
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
                  {customer.consentAt === undefined && <NoConsentMark />}
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

      {/* Gated on LOADED, not on having rows: the header carries Add customer
          now, and a salon whose first customer has not been added yet still
          has to be able to add one. */}
      {customers !== undefined && (
        <div className="hidden rounded-lg bg-[var(--card)] shadow-[var(--card-shadow)] sm:block">
          {/* The table's controls, in the card they belong to rather than
              floating on the page gradient above it. Both are h-9 so the
              bordered picker and the filled button share a baseline; Team's
              header action is h-8 because it has nothing to line up with.

              px-4 matches the scroller below, so the button's right edge lands
              on the same line as the table's last column rule, and pt-4/pb-3
              is Card's own header metric (p-4 with mb-3 under it) rather than
              a number picked to look right in one screenshot. */}
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4">
            {/* The verbs take the whole row while a selection stands. Columns
                and Add customer are both about the LIST, and neither is what
                anyone reaches for with twenty rows ticked; leaving them there
                puts "Add customer" one slip away from "Call 20 people". */}
            {picked.length > 0 ? (
              <BulkBar
                count={picked.length}
                noConsent={picked.filter((c) => c.consentAt === undefined).length}
                onCompose={setComposing}
                onClear={clearSelection}
              />
            ) : (
              <>
                {columnPicker}
                {addButton}
              </>
            )}
          </div>
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
          <div className="thin-scroll overflow-x-auto overscroll-x-contain px-4 py-1">
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
                    // Consent has no column of its own any more, but the name
                    // cell is where its mark shows — so the funnel that filters
                    // on it belongs here, on the column it visibly affects.
                    // Same rule as every other funnel in this table.
                    filter={
                      <HeaderFilter
                        options={[CONSENT_ON, CONSENT_OFF]}
                        selected={table.filterFor("consent")}
                        onToggle={(value) => table.toggleFilter("consent", value)}
                        labelFor={(value) =>
                          value === CONSENT_ON
                            ? t("customers.consentGiven")
                            : t("customers.noConsent")
                        }
                      />
                    }
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
                        <span className="truncate">{fullName(customer)}</span>
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
                        {customer.consentAt === undefined && <NoConsentMark />}
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
            <p className="px-4 pb-4 text-sm text-[var(--muted)]">
              {t("customers.none")}
            </p>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-4 page-stack">
      {/* Ported from VoiceView, which is this app's reference tab strip: the
          hairline belongs to the STRIP and each tab overlaps it with -mb-px,
          so the active underline replaces that segment of the rule rather than
          sitting under it, and the weight never changes between states. */}
      <div className="flex flex-wrap items-center gap-5 border-b border-[var(--border)]">
        {(
          [
            { id: "list" as const, label: t("customers.tabList") },
            { id: "fields" as const, label: t("fields.title") },
            { id: "bulk" as const, label: t("bulk.title") },
          ] as { id: CustomersSection; label: string }[]
        ).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setSection(entry.id)}
            aria-current={section === entry.id ? "page" : undefined}
            className={`-mb-px border-b-2 px-0.5 py-2.5 text-sm transition-colors ${
              section === entry.id
                ? "border-[var(--foreground)] text-[var(--foreground)]"
                : "border-transparent text-[var(--muted-strong)] hover:text-[var(--foreground)]"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {section === "list" && list}
      {section === "fields" && <FieldsCard isOwner={isOwner} />}
      {section === "bulk" && (
        <BulkRunsCard
          onOpenContact={onOpenContact}
          onFollowUp={(channel, people) => {
            setFollowUp(people);
            setComposing(channel);
          }}
        />
      )}

      {/* Mounted beside the list rather than inside it: the composer is a
          drill-in over the whole tab (AGENTS: adding is a sheet you open),
          and it closes back to the selection it was launched from, which is
          why the tick set survives it. */}
      {composing && (
        <BulkComposer
          channel={composing}
          customers={followUp ?? picked}
          onClose={() => {
            setComposing(null);
            setFollowUp(null);
          }}
          onSent={() => {
            setComposing(null);
            if (followUp) setFollowUp(null);
            else clearSelection();
            setSection("bulk");
          }}
        />
      )}
    </div>
  );
}

// The verbs, and the count they act on. Three buttons and a way out, because
// a bar that appears the moment something is ticked also has to say how to
// make it go away.
//
// The consent line is not decoration. Under KVKK consent gates EVERYTHING,
// reminders included, so a selection of forty with eleven unconsented is a
// run that will reach twenty-nine people — and the moment to learn that is
// before the composer, not in the run detail afterwards.
function BulkBar({
  count,
  noConsent,
  onCompose,
  onClear,
}: {
  count: number;
  noConsent: number;
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
      {noConsent > 0 && (
        <span
          className="text-xs text-amber-600 dark:text-amber-500"
          title={t("customers.cannotBeMessaged")}
        >
          {t("bulk.noConsentCount", { n: noConsent })}
        </span>
      )}
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

// One field per line, in the order somebody says them out loud: who they are,
// how to reach them, and whether we may. The old version was a three-column
// grid wedged between the toolbar and the table, which pushed the list you
// came to read off the bottom of the screen every time you opened it.
//
// Consent is last and stays checked, but it is not decoration: without it the
// KVKK gate in wa.sendAppointmentMessage silently drops every confirmation and
// reminder for this person. That is why it gets a sentence rather than a
// label, and why the field it guards sits directly above it.
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
              consent: form.get("consent") === "on",
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

        <label className="flex items-start gap-2 rounded-lg bg-[var(--muted-bg)] p-3 text-sm">
          <input name="consent" type="checkbox" defaultChecked className="mt-0.5 w-auto" />
          <span className="min-w-0">
            {t("customers.consent")}
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              {t("customers.consentHint")}
            </span>
          </span>
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
