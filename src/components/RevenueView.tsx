"use client";

// The takings. Deliberately one screen with three numbers and the week's
// visits under them — not an analytics section.
//
// The line this refuses to cross: no charts, no date-range picker, no
// per-staff split, no export, no comparison to last month. The moment this
// needs its own sub-navigation it has become accounting, which is a different
// product the salon's accountant already has. It exists to close the loop on
// the prices staff type in, and nothing more.

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatDateTime } from "@/lib/datetime";
import { formatMoney } from "@/lib/money";

export function RevenueView() {
  const { t, language } = useLanguage();
  const report = useQuery(api.reports.revenue, {});
  const setStatus = useMutation(api.appointments.setStatus);

  if (report === undefined) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }

  const figures = [
    { key: "revenue.today" as const, value: report.today },
    { key: "revenue.week" as const, value: report.week },
    { key: "revenue.month" as const, value: report.month },
  ];

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

      {/* Said out loud rather than swallowed: a takings figure that silently
          drops the visits nobody priced is how this kind of number stops
          being trusted. */}
      {report.unpriced > 0 && (
        <p className="text-xs text-[var(--muted)]">
          {t("revenue.unpriced").replace("{n}", String(report.unpriced))}
        </p>
      )}

      <section className="card-raised overflow-hidden">
        <h2 className="px-4 pt-4 pb-2 text-sm font-semibold">
          {t("revenue.recent")}
        </h2>
        {report.recent.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-[var(--muted)]">
            {t("revenue.none")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {report.recent.map((row) => (
              <li
                key={row._id}
                className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{row.customerName}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {[formatDateTime(row.startAt, language), row.services]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatMoney(row.total, report.currency, language, report.priceDecimals)}
                </span>
                {/* The one correction this list needs: every row here was
                    auto-completed overnight, so a no-show nobody flagged is
                    standing in the totals as money. Flipping it to no_show
                    drops it from the figures reactively and arms the win-back;
                    a mis-tap is undone from the appointment itself. */}
                <button
                  className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:border-red-400 hover:text-red-600 dark:hover:text-red-400"
                  title={t("revenue.noShowHint")}
                  onClick={() =>
                    void setStatus({ appointmentId: row._id, status: "no_show" })
                  }
                >
                  {t("status.no_show")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
