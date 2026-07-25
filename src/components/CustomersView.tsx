"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { localeFor } from "@/lib/datetime";
import {
  compareCells,
  useSearch,
  useTableState,
  type CellValue,
} from "@/lib/useTableState";
import { ColumnPicker, HeaderFilter, MenuItem, SearchInput, Th } from "./DataTable";
import { PhoneInput } from "./PhoneField";

type Customer = FunctionReturnType<typeof api.customers.list>[number];
type ContactField = Doc<"contactFields">;

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
  const create = useMutation(api.customers.create);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const table = useTableState<string>({ key: "added", dir: "desc" });
  const search = useSearch();

  const fields: ContactField[] = useMemo(() => contactFields ?? [], [contactFields]);
  const fieldByKey = useMemo(
    () => new Map(fields.map((field) => [field.key, field])),
    [fields],
  );

  // Dates read as day-level facts here: a salon owner scanning a list wants
  // "when", not "at what minute".
  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(localeFor(language), {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    [language],
  );
  const formatDay = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const today = startOfToday.getTime();
    const DAY = 86_400_000;
    return (ms: number) => {
      if (ms >= today) return t("time.today");
      if (ms >= today - DAY) return t("time.yesterday");
      return dayFormat.format(ms);
    };
  }, [dayFormat, t]);

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
      case "consent":
        // Consent on file is the normal case and says nothing worth a word;
        // only its absence is news.
        return customer.consentAt ? "" : t("customers.noConsent");
      case "added":
        return formatDay(customer._creationTime);
      case "lastActivity":
        return customer.lastInboundAt ? formatDay(customer.lastInboundAt) : "";
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
      {
        key: "consent",
        label: t("customers.consentShort"),
        width: 130,
        sortable: true,
        filterOptions: [CONSENT_ON, CONSENT_OFF],
        labelFor: (value) =>
          value === CONSENT_ON ? t("customers.consentGiven") : t("customers.noConsent"),
      },
      { key: "added", label: t("customers.added"), width: 140, sortable: true, numeric: true },
      {
        key: "lastActivity",
        label: t("customers.lastActivity"),
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

  const visibleColumns = columns.filter((column) => table.isColumnVisible(column.key));

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
    return [...kept].sort((a, b) =>
      compareCells(sortValue(a, table.sort.key), sortValue(b, table.sort.key), table.sort.dir),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, fieldByKey, search.active, search.matches, table.matchesFilters, table.sort]);

  const exportCsv = () => {
    const exported = [{ key: "name", label: t("customers.name") }, ...visibleColumns];
    const lines = [
      exported.map((column) => csvCell(column.label)).join(","),
      ...rows.map((customer) =>
        exported
          .map((column) =>
            csvCell(
              column.key === "consent"
                ? customer.consentAt
                  ? t("customers.consentGiven")
                  : t("customers.noConsent")
                : displayValue(customer, column.key),
            ),
          )
          .join(","),
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
  const minWidth = 260 + visibleColumns.reduce((total, column) => total + column.width, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {hasCustomers && (
          <SearchInput
            value={search.query}
            onChange={search.setQuery}
            placeholder={t("customers.search")}
            className="w-full sm:w-64"
          />
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* The picker belongs to the table, and below sm there is no table. */}
          {hasCustomers && (
            <div className="hidden sm:block">
              <ColumnPicker
                columns={columns}
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
            className="h-9 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-[var(--accent-fg)]"
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? t("common.cancel") : t("customers.new")}
          </button>
        </div>
      </div>

      {adding && (
        <form
          className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setError(null);
            try {
              await create({
                firstName: String(form.get("firstName") ?? ""),
                lastName: String(form.get("lastName") ?? "") || undefined,
                phone: String(form.get("phone") ?? ""),
                email: String(form.get("email") ?? "") || undefined,
                consent: form.get("consent") === "on",
              });
              setAdding(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "error");
            }
          }}
        >
          <label className="text-sm">
            {t("customers.firstName")}
            <input name="firstName" required className="mt-1" />
          </label>
          <label className="text-sm">
            {t("customers.lastName")}
            <input name="lastName" className="mt-1" />
          </label>
          <label className="text-sm" htmlFor="new-customer-phone">
            {t("customers.phone")}
            <PhoneInput id="new-customer-phone" name="phone" required className="mt-1" />
          </label>
          <label className="text-sm">
            {t("customers.email")}
            <input name="email" type="email" className="mt-1" />
          </label>
          <label className="flex items-start gap-2 text-sm sm:col-span-3">
            <input name="consent" type="checkbox" defaultChecked className="mt-1 w-auto" />
            <span>
              {t("customers.consent")}
              <span className="block text-xs text-[var(--muted)]">
                {t("customers.consentHint")}
              </span>
            </span>
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-3">{error}</p>}
          <div className="sm:col-span-3">
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
            >
              {t("common.add")}
            </button>
          </div>
        </form>
      )}

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
              onClick={() => onOpenContact(customer._id)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{fullName(customer)}</span>
                <span className="block text-xs tabular-nums text-[var(--muted)]">
                  {customer.phone}
                </span>
              </span>
              {customer.consentAt === undefined && (
                <span className="shrink-0 text-xs text-red-600 dark:text-red-400">
                  {t("customers.noConsent")}
                </span>
              )}
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
                  <col key={column.key} style={{ width: column.width }} />
                ))}
              </colgroup>
              <thead className="text-left text-[var(--muted)]">
                <tr>
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
                    onClick={() => onOpenContact(customer._id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onOpenContact(customer._id);
                    }}
                    className="cursor-pointer outline-none transition-colors hover:bg-[var(--row-hover-bg)] focus-visible:bg-[var(--row-hover-bg)]"
                  >
                    <td className="truncate px-4 py-2.5 font-medium">{fullName(customer)}</td>
                    {visibleColumns.map((column) => {
                      const text = displayValue(customer, column.key);
                      const missingConsent = column.key === "consent" && text !== "";
                      return (
                        <td
                          key={column.key}
                          className={`truncate px-4 py-2.5 ${column.numeric ? "tabular-nums " : ""}${
                            missingConsent
                              ? "text-red-600 dark:text-red-400"
                              : "text-[var(--muted)]"
                          }`}
                        >
                          {text}
                        </td>
                      );
                    })}
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
