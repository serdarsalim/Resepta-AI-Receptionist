"use client";

// The takings. Deliberately one screen: three numbers, and under them the
// ledger of every priced visit that reached its day — pageable back to the
// first day, searched from the header box like every other tab. Not an
// analytics section.
//
// The line this refuses to cross: no charts, no date-range picker, no
// per-staff split, no export, no comparison to last month. The moment this
// needs its own sub-navigation it has become accounting, which is a different
// product the salon's accountant already has. It exists to close the loop on
// the prices staff type in, and nothing more.

import { useRef, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { useHeaderSearch } from "@/lib/HeaderSearch";
import { formatDateTime } from "@/lib/datetime";
import { formatMoney } from "@/lib/money";

type Row = {
  _id: Id<"appointments">;
  startAt: number;
  customerName: string;
  services: string;
  total: number;
  status: "completed" | "no_show";
};

export function RevenueView() {
  const { t, language } = useLanguage();
  const report = useQuery(api.reports.revenue, {});
  const setStatus = useMutation(api.appointments.setStatus);
  // The header's box, same as Customers — a fixed position is only fixed if
  // the shell owns it. The query goes to the server, so a search reaches rows
  // no page has loaded yet.
  const search = useHeaderSearch(t("common.search"));
  const { results, status, loadMore } = usePaginatedQuery(
    api.reports.revenueList,
    { search: search.query.trim() || undefined },
    { initialNumItems: 50 },
  );
  const [hideNoShows, setHideNoShows] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<Id<"appointments">>>(
    new Set(),
  );
  // Anchor for shift-click ranges, as an index into the VISIBLE list — the
  // one the person is looking at when they sweep.
  const anchor = useRef<number | null>(null);

  if (report === undefined) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }

  const figures = [
    { key: "revenue.today" as const, value: report.today },
    { key: "revenue.week" as const, value: report.week },
    { key: "revenue.month" as const, value: report.month },
  ];

  const rows = results as Row[];
  const visible = hideNoShows ? rows.filter((row) => row.status !== "no_show") : rows;
  const allSelected = visible.length > 0 && visible.every((row) => selected.has(row._id));
  const picked = visible.filter((row) => selected.has(row._id));

  const toggleRow = (index: number, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const turnOn = !next.has(visible[index]._id);
      const from = shift && anchor.current !== null ? Math.min(anchor.current, index) : index;
      const to = shift && anchor.current !== null ? Math.max(anchor.current, index) : index;
      for (let i = from; i <= to; i++) {
        if (turnOn) next.add(visible[i]._id);
        else next.delete(visible[i]._id);
      }
      return next;
    });
    anchor.current = index;
  };

  const applyBulk = (nextStatus: "completed" | "no_show") => {
    const ids = picked.map((row) => row._id);
    setSelected(new Set());
    anchor.current = null;
    for (const id of ids) {
      void setStatus({ appointmentId: id, status: nextStatus });
    }
  };

  const flipRow = (row: Row, nextStatus: "completed" | "no_show") => {
    if (row.status !== nextStatus) {
      void setStatus({ appointmentId: row._id, status: nextStatus });
    }
  };

  const pill = "rounded-full px-2 py-0.5 text-[11px] transition-colors";
  const paidOn = "bg-[var(--brand-soft)] text-emerald-700 dark:text-emerald-400";
  const noShowOn = "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400";
  const pillOff = "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 page-stack">
      <section className="card-raised grid grid-cols-1 divide-y divide-[var(--border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {figures.map((figure) => (
          <div key={figure.key} className="px-4 py-4">
            <p className="text-xs text-[var(--muted)]">{t(figure.key)}</p>
            {/* tabular-nums so three figures of different lengths still line
                up at the decimal when you scan down them. */}
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formatMoney(figure.value, report.currency, language, report.priceDecimals)}
            </p>
          </div>
        ))}
      </section>

      <section className="card-raised overflow-hidden">
        {/* Everything lives on the title row: select-all opening the right
            cluster, the bulk verbs the moment something is picked, and the
            cancelled filter as a pill. A rail of its own held one checkbox
            and looked abandoned. */}
        <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-2">
          {/* Select-all sits BEFORE the title, flush with the column of row
              checkboxes under it — the position is the label. */}
          {visible.length > 0 && (
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => {
                setSelected(
                  allSelected ? new Set() : new Set(visible.map((row) => row._id)),
                );
                anchor.current = null;
              }}
            />
          )}
          <h2 className="text-sm font-semibold">{t("revenue.history")}</h2>
          {visible.length > 0 && (
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {picked.length > 0 && (
                <>
                  <span className="text-xs text-[var(--muted)]">
                    {t("revenue.selected", { n: picked.length })}
                  </span>
                  <button
                    className={`${pill} ${pillOff} hover:text-emerald-600 dark:hover:text-emerald-400`}
                    onClick={() => applyBulk("completed")}
                  >
                    {t("statusPill.paid")}
                  </button>
                  {/* Says İptal, writes no_show: on a visit already in the
                      past that is the status whose machinery fits (win-back
                      arms, no cancellation message fires), and one word for
                      "didn't happen" is one fewer concept on the screen. */}
                  <button
                    className={`${pill} ${pillOff} hover:text-red-600 dark:hover:text-red-400`}
                    onClick={() => applyBulk("no_show")}
                  >
                    {t("status.cancelled")}
                  </button>
                </>
              )}
              <button
                className={`${pill} ${
                  hideNoShows
                    ? "bg-[var(--border)] text-[var(--foreground)]"
                    : pillOff
                }`}
                onClick={() => setHideNoShows((current) => !current)}
              >
                {t("revenue.hideCancelled")}
              </button>
            </span>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-4 text-sm text-[var(--muted)]">
            {status === "LoadingFirstPage" ? t("common.loading") : t("revenue.none")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {visible.map((row, index) => (
              <li
                key={row._id}
                className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
              >
                {/* onClick, not onChange: only the MouseEvent knows shift was
                    held, and a shift-click sweeps from the last checkbox. */}
                <input
                  type="checkbox"
                  checked={selected.has(row._id)}
                  onClick={(event) => toggleRow(index, event.shiftKey)}
                  readOnly
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{row.customerName}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {[formatDateTime(row.startAt, language), row.services]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {/* A no-show's amount stays printed but struck: the row must
                    keep saying what the visit was worth while saying it is
                    not in the totals. */}
                <span
                  className={`shrink-0 tabular-nums ${
                    row.status === "no_show"
                      ? "text-[var(--muted)] line-through"
                      : ""
                  }`}
                >
                  {formatMoney(row.total, report.currency, language, report.priceDecimals)}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    className={`${pill} ${row.status === "completed" ? paidOn : pillOff}`}
                    onClick={() => flipRow(row, "completed")}
                  >
                    {t("statusPill.paid")}
                  </button>
                  <button
                    className={`${pill} ${row.status === "no_show" ? noShowOn : pillOff}`}
                    onClick={() => flipRow(row, "no_show")}
                  >
                    {t("status.cancelled")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* A filtered page can come back short or empty while older rows still
            exist, so "more" is driven by the cursor, not by what this page
            happened to show. */}
        {status === "CanLoadMore" && (
          <div className="px-4 py-3">
            <button
              className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
              onClick={() => loadMore(50)}
            >
              {t("common.loadMore")}
            </button>
          </div>
        )}
        {status === "LoadingMore" && (
          <p className="px-4 py-3 text-xs text-[var(--muted)]">{t("common.loading")}</p>
        )}
      </section>
    </div>
  );
}
