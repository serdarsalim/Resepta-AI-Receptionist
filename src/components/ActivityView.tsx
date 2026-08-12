"use client";

// Recent activity — who did what across the whole workspace, newest first.
//
// Its own sidebar destination since 2026-08-12, in the foot group beside
// Business rather than as a chip inside it. It was never a setting: nothing
// here is configured, it is a record the workspace writes about itself. The
// foot group is exactly that distinction, "about this workspace" rather than
// today's work, which is why this is a row below the divider and not a seventh
// item people scan past every morning.

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { Card } from "./Card";

// Who did what, newest first. No owner gate: a stylist wondering who moved
// their 14:00 has the same right to the answer as the owner does, and every
// row here describes something that person could already see in the app.
export function ActivityView() {
  const { t, language } = useLanguage();
  const rows = useQuery(api.activity.recent, {});
  const when = new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card title={t("activity.title")} tip={t("activity.hint")}>
        {rows === undefined ? (
          <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("activity.empty")}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              // One line per entry: what happened, who it was about, who did it.
              // Stacking these would make a morning's work three screens tall.
              <li
                key={row._id}
                className="flex items-baseline gap-3 py-1.5 text-sm"
              >
                <span className="w-28 shrink-0 text-xs tabular-nums text-[var(--muted)]">
                  {when.format(row.at)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {ACTIVITY_LABELS[row.kind]
                    ? t(ACTIVITY_LABELS[row.kind])
                    : row.kind}
                  {row.customerName && (
                    <span className="text-[var(--muted)]">
                      {" "}
                      · {row.customerName}
                    </span>
                  )}
                  {row.detail && (
                    <span className="text-[var(--muted)]"> · {row.detail}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-[var(--muted)]">
                  {row.actor ?? t("activity.system")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// Explicit rather than a template cast: translate() throws on a key it does
// not hold, so building the key from the kind string would turn one entry
// written by a newer deploy than this bundle into a blank card. Unknown kinds
// fall through to the raw value, which is ugly and readable and does not take
// the rest of the history down with it.
const ACTIVITY_LABELS: Record<string, TranslationKey> = {
  appointment_created: "activity.appointment_created",
  appointment_status: "activity.appointment_status",
  appointment_moved: "activity.appointment_moved",
  appointment_deleted: "activity.appointment_deleted",
  customer_created: "activity.customer_created",
  customer_deleted: "activity.customer_deleted",
  settings_changed: "activity.settings_changed",
  member_invited: "activity.member_invited",
  member_removed: "activity.member_removed",
  whatsapp_connected: "activity.whatsapp_connected",
  booking_dropped: "activity.booking_dropped",
};
