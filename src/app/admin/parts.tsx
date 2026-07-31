"use client";

// Shared pieces of the operator console. Split out because the fleet list and
// a tenant's own page both need them and neither owns them.
//
// English-only on purpose, like the rest of /admin: lib/i18n exists so SALON
// staff read the product in their own language, and this surface has exactly
// one reader.

import { useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export function ago(at: number | undefined): string {
  if (!at) return "never";
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

// A count worth reading, or nothing at all. Walls of "0" are noise the eye has
// to filter before it can find the one number that isn't zero.
export function Count({
  value,
  tone,
  capped,
}: {
  value: number;
  tone: "bad" | "warn" | "plain";
  capped?: boolean;
}) {
  if (value === 0) return <span className="text-[var(--muted)]">—</span>;
  const color =
    tone === "bad"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "";
  return (
    <span className={`font-medium tabular-nums ${color}`}>
      {value}
      {capped ? "+" : ""}
    </span>
  );
}

// Setup state reads as a word, not a tick: "no WABA" is the actual answer to
// "why is this salon not sending", and a red ✗ makes the reader work it out.
export function Setup({ org }: { org: { waConnected: boolean; approvedTemplates: number } }) {
  if (!org.waConnected) {
    return <span className="text-amber-600 dark:text-amber-400">no WhatsApp</span>;
  }
  if (org.approvedTemplates === 0) {
    return <span className="text-amber-600 dark:text-amber-400">no templates</span>;
  }
  return <span className="text-[var(--muted)]">{org.approvedTemplates} templates</span>;
}

// Delivery outcome as a dot and a word. Failed is the loud one; queued is a
// normal in-flight state, not an alarm.
function StatusPill({ status, deadLettered }: { status: string; deadLettered: boolean }) {
  const tone =
    status === "failed"
      ? "bg-red-500"
      : status === "queued"
        ? "bg-amber-400"
        : status === "received"
          ? "bg-sky-500"
          : "bg-emerald-500";
  const text =
    status === "failed" ? "text-red-600 dark:text-red-400" : "text-[var(--muted)]";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${text}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
      {status}
      {deadLettered ? " · gave up" : ""}
    </span>
  );
}

const MESSAGE_STATUSES = [
  "failed",
  "queued",
  "sent",
  "delivered",
  "read",
  "received",
] as const;
type MessageStatus = (typeof MESSAGE_STATUSES)[number];

type ActivityRow = {
  _id: string;
  at: number;
  kind: string;
  direction: "out" | "in";
  status: string;
  error?: string;
  attempts?: number;
  deadLettered: boolean;
};

export function Activity({ orgId }: { orgId: Id<"orgs"> }) {
  const [filter, setFilter] = useState<MessageStatus | "">("");
  const { results, status: loadStatus, loadMore } = usePaginatedQuery(
    api.platform.orgActivity,
    { orgId, status: filter || undefined },
    { initialNumItems: 25 },
  );
  const rows = results as ActivityRow[];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as MessageStatus | "")}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
        >
          <option value="">All statuses</option>
          {MESSAGE_STATUSES.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </div>
      {loadStatus !== "LoadingFirstPage" && rows.length === 0 ? (
        <div className="px-3 py-2 text-xs text-[var(--muted)]">
          {filter ? `No ${filter} messages.` : "No messages yet."}
        </div>
      ) : (
        <ActivityTable rows={rows} />
      )}
      {loadStatus === "CanLoadMore" && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => loadMore(50)}
            className="rounded-lg px-3 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((row) => (
            <tr key={row._id} className="border-t border-[var(--border)]">
              <td className="whitespace-nowrap px-3 py-1.5 text-[var(--muted)] tabular-nums">
                {ago(row.at)} ago
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">
                {row.kind}
                <span className="ml-1.5 text-[var(--muted)]">
                  {row.direction === "in" ? "in" : "out"}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">
                <StatusPill status={row.status} deadLettered={row.deadLettered} />
              </td>
              <td className="px-3 py-1.5 font-mono text-[11px]">
                {row.status === "failed" ? row.error ?? "—" : ""}
                {row.status === "failed" && row.attempts ? (
                  <span className="text-[var(--muted)]"> · {row.attempts} tries</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

