"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { formatAge } from "@/lib/datetime";
import {
  BulkComposer,
  BulkRunDetail,
  BulkRunsCard,
  type BulkChannel,
} from "./BulkActions";

// What already happened in this business: who did what, and every bulk send
// (Serdar, 2026-11-01). Opened from the clock in the top bar, never from the
// sidebar, which he did not want to grow; Nudge's Activity sits in the same
// place for the same reason.
//
// Bulk sends lived on Customers as a tab beside the list until now. A history
// of what a selection did is not a place anybody works from, and the tab read
// as if it were where you START a bulk send. Starting one stays on the
// Customers list, where the people are picked.
//
// The log was taken out of the salon's app on 2026-08-12 as an operator's
// debugging surface. It comes back for teams: "who cancelled Ayşe's booking"
// is a question an owner with three people on the calendar does ask. Messages
// are still not here; they live in the customer's own thread.
export type ActivitySection = "all" | "bulk";

type Entry = FunctionReturnType<typeof api.activity.recent>[number];
type Run = FunctionReturnType<typeof api.bulkRuns.list>[number];

// Kinds the reader sees, each as something that HAPPENED. A kind missing here
// (a new one written before its label) shows the generic line rather than a
// raw slug.
const KIND_LABEL: Record<string, TranslationKey> = {
  appointment_created: "activity.appointment_created",
  appointment_status: "activity.appointment_status",
  appointment_moved: "activity.appointment_moved",
  appointment_deleted: "activity.appointment_deleted",
  customer_created: "activity.customer_created",
  customer_updated: "activity.customer_updated",
  customer_deleted: "activity.customer_deleted",
  note_added: "activity.note_added",
  settings_changed: "activity.settings_changed",
  member_invited: "activity.member_invited",
  member_removed: "activity.member_removed",
  whatsapp_connected: "activity.whatsapp_connected",
  booking_dropped: "activity.booking_dropped",
};

const SECTIONS: { id: ActivitySection; label: TranslationKey }[] = [
  { id: "all", label: "activity.tabAll" },
  { id: "bulk", label: "activity.tabBulk" },
];

export function ActivityView({
  initialSection = "all",
  onOpenContact,
}: {
  initialSection?: ActivitySection;
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t } = useLanguage();
  const [section, setSection] = useState<ActivitySection>(initialSection);
  // A run opened from the All feed. The Bulk sends tab keeps its own, inside
  // BulkRunsCard.
  const [openRun, setOpenRun] = useState<Id<"bulkRuns"> | null>(null);
  // A follow-up to a past run's people (P13b): the composer opens over this
  // page, sends a new run, and lands on Bulk sends.
  const [composing, setComposing] = useState<BulkChannel | null>(null);
  const [followUp, setFollowUp] = useState<Doc<"customers">[]>([]);
  const onFollowUp = (channel: BulkChannel, people: Doc<"customers">[]) => {
    setFollowUp(people);
    setComposing(channel);
  };

  return (
    <div className="space-y-4 page-stack">
      {/* VoiceView's strip: the hairline belongs to the strip, each tab
          overlaps it with -mb-px, and the weight never changes. */}
      <div className="flex flex-wrap items-center gap-5 border-b border-[var(--border)]">
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              setSection(entry.id);
              setOpenRun(null);
            }}
            aria-current={section === entry.id ? "page" : undefined}
            className={`-mb-px border-b-2 px-0.5 py-2.5 text-sm transition-colors ${
              section === entry.id
                ? "border-[var(--foreground)] text-[var(--foreground)]"
                : "border-transparent text-[var(--muted-strong)] hover:text-[var(--foreground)]"
            }`}
          >
            {t(entry.label)}
          </button>
        ))}
      </div>

      {section === "all" &&
        (openRun ? (
          <BulkRunDetail
            runId={openRun}
            onBack={() => setOpenRun(null)}
            onOpenContact={onOpenContact}
            onFollowUp={onFollowUp}
          />
        ) : (
          <AllFeed onOpenContact={onOpenContact} onOpenRun={setOpenRun} />
        ))}
      {section === "bulk" && (
        <BulkRunsCard onOpenContact={onOpenContact} onFollowUp={onFollowUp} />
      )}

      {composing && (
        <BulkComposer
          channel={composing}
          customers={followUp}
          onClose={() => setComposing(null)}
          onSent={() => {
            setComposing(null);
            setOpenRun(null);
            setSection("bulk");
          }}
        />
      )}
    </div>
  );
}

// The log and the bulk sends, newest first in one list. Both reads are capped
// (the log at 100 rows, the runs at the list's own cap), so this is "what
// happened lately", not an archive.
function AllFeed({
  onOpenContact,
  onOpenRun,
}: {
  onOpenContact: (id: Id<"customers">) => void;
  onOpenRun: (id: Id<"bulkRuns">) => void;
}) {
  const { t, language } = useLanguage();
  const entries = useQuery(api.activity.recent, { limit: 100 });
  const runs = useQuery(api.bulkRuns.list, {});

  const rows = useMemo(() => {
    if (entries === undefined || runs === undefined) return undefined;
    const merged: (
      | { type: "entry"; at: number; entry: Entry }
      | { type: "run"; at: number; run: Run }
    )[] = [
      ...entries.map((entry) => ({ type: "entry" as const, at: entry.at, entry })),
      ...runs.map((run) => ({ type: "run" as const, at: run.startedAt, run })),
    ];
    return merged.sort((a, b) => b.at - a.at);
  }, [entries, runs]);

  if (rows === undefined) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg bg-[var(--card)] p-4 shadow-[var(--card-shadow)]">
        <p className="text-sm text-[var(--muted)]">{t("activity.empty")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg bg-[var(--card)] shadow-[var(--card-shadow)]">
      <ul className="divide-y divide-[var(--table-divider)]">
        {rows.map((row) =>
          row.type === "run" ? (
            <li key={row.run._id}>
              <button
                type="button"
                onClick={() => onOpenRun(row.run._id)}
                className="flex w-full items-baseline gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {t("activity.bulkSent")}: <span className="font-medium">{row.run.label}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">
                    {t(`bulk.${row.run.channel}`)} · {row.run.doneCount}/{row.run.totalCount}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                  {formatAge(row.at, language)}
                </span>
              </button>
            </li>
          ) : (
            <li key={row.entry._id} className="flex items-baseline gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {t(KIND_LABEL[row.entry.kind] ?? "activity.other")}
                  {row.entry.customerId && row.entry.customerName && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => onOpenContact(row.entry.customerId!)}
                        className="name-link"
                      >
                        {row.entry.customerName}
                      </button>
                    </>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                  {row.entry.actor ?? t("activity.system")}
                  {row.entry.detail ? ` · ${row.entry.detail}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                {formatAge(row.at, language)}
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
