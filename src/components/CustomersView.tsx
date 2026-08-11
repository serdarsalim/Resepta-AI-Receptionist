"use client";

import { useMutation, useQuery } from "convex/react";
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

type Customer = FunctionReturnType<typeof api.customers.list>[number];
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
    <button
      type="button"
      title={t("customers.dismissLook")}
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
    <span
      title={t("customers.cannotBeMessaged")}
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
    <span
      title={t("customers.mutedMark")}
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
  );
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
  const customers = useQuery(api.customers.list, {});
  const contactFields = useQuery(api.contactFields.list, {});
  const setAttention = useMutation(api.messages.setAttention);
  const [adding, setAdding] = useState(false);

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
      { key: "email", label: t("customers.email"), width: 210, sortable: true },
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

  const hasCustomers = (customers?.length ?? 0) > 0;
  const widthOf = (column: Column) => table.widthFor(column.key, column.width);
  const minWidth = 260 + visibleColumns.reduce((total, column) => total + widthOf(column), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search moved to the header, where it is in the same place on
            every tab. What is left here belongs to this table specifically. */}
        <div className="flex w-full items-center gap-2">
          {/* The picker belongs to the table, and below sm there is no table. */}
          {hasCustomers && (
            <div className="hidden sm:block">
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
            </div>
          )}
          <button
            className="ml-auto h-9 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-[var(--accent-fg)]"
            onClick={() => setAdding(true)}
          >
            {t("customers.new")}
          </button>
        </div>
      </div>

      {adding && <NewCustomerSheet onClose={() => setAdding(false)} />}

      {customers === undefined && (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      )}
      {customers?.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{t("customers.none")}</p>
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
              onClick={() => openContact(customer)}
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

      {hasCustomers && (
        <div className="hidden overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] sm:block">
          {/* The table scrolls sideways inside its own card. The page body
              never does. */}
          <div className="thin-scroll overflow-x-auto overscroll-x-contain">
            <table className="w-full text-sm" style={{ tableLayout: "fixed", minWidth }}>
              <colgroup>
                {/* Name takes no width of its own: it absorbs whatever the
                    fixed columns leave, so a row never ends in a ghost gap. */}
                <col />
                {visibleColumns.map((column) => (
                  <col key={column.key} style={{ width: widthOf(column) }} />
                ))}
              </colgroup>
              <thead className="text-left text-[var(--muted-strong)]">
                <tr>
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
              <tbody className="divide-y divide-[var(--border)]">
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={visibleColumns.length + 1}
                      className="px-4 py-6 text-[var(--muted)]"
                    >
                      {t("customers.noMatches")}
                    </td>
                  </tr>
                )}
                {rows.map((customer) => (
                  <tr
                    key={customer._id}
                    tabIndex={0}
                    onClick={() => openContact(customer)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") openContact(customer);
                    }}
                    className="cursor-pointer outline-none transition-colors hover:bg-[var(--row-hover-bg)] focus-visible:bg-[var(--row-hover-bg)]"
                  >
                    <td className="px-4 py-2.5 font-medium">
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
                        className={`truncate px-4 py-2.5 text-[var(--muted)] ${
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
        </div>
      )}
    </div>
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
