"use client";

// Shared pieces of the operator console. Split out because the fleet list and
// a tenant's own page both need them and neither owns them.
//
// English-only on purpose, like the rest of /admin: lib/i18n exists so SALON
// staff read the product in their own language, and this surface has exactly
// one reader.

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { InfoTip } from "@/components/InfoTip";

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
// Whether this salon can reach anybody, which is not the same question as
// whether WhatsApp is connected. An org on email alone is fully working, and
// amber-flagging it as "no WhatsApp" sent the operator chasing a Meta number
// nobody needed. Amber is now reserved for genuinely dark: no channel at all.
export function Setup({
  org,
}: {
  org: { waConnected: boolean; approvedTemplates: number; emailReady: boolean };
}) {
  if (!org.waConnected) {
    return org.emailReady ? (
      <span className="text-[var(--muted)]">email only</span>
    ) : (
      <span className="text-amber-600 dark:text-amber-400">no channel</span>
    );
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


// ---- Settings primitives, shared by the fleet page and a tenant's page ----

export function Row({
  label,
  hint,
  current,
  placeholder,
  onSave,
}: {
  label: string;
  hint?: string;
  current?: string | null;
  placeholder?: string;
  onSave: (value: string) => unknown;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-[var(--muted)]">{hint}</div>}
      </div>
      <div className="min-w-0">
        <input
          value={draft ?? current ?? ""}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft === null || draft === (current ?? "")) return;
            void onSave(draft);
            setDraft(null);
          }}
          placeholder={placeholder}
          className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
        />
      </div>
    </div>
  );
}

// A secret already installed shows its tail and an empty box. Typing replaces
// it; leaving it blank keeps what is there. An input pre-filled with a masked
// string would submit the mask as the new value the first time somebody
// tabbed through it.
//
// The masked tail sits UNDER THE LABEL rather than beside the input, so the
// control column starts at the same x as every plain row. Three sections each
// indenting their inputs differently is what it looked like otherwise, and the
// eye reads that as three unrelated forms.
export function SecretRow({
  label,
  hint,
  masked,
  onSave,
}: {
  label: string;
  hint?: string;
  masked?: string | null;
  onSave: (value: string) => unknown;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="font-mono text-xs text-[var(--muted)]">{masked ?? "not set"}</div>
        {hint && <div className="text-xs text-[var(--muted)]">{hint}</div>}
      </div>
      <div className="min-w-0">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const value = draft.trim();
            if (!value) return;
            void onSave(value);
            setDraft("");
          }}
          placeholder={masked ? "replace…" : "paste…"}
          className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-sm"
        />
      </div>
    </div>
  );
}

// A titled card with an optional one-line description, the pattern every
// business settings surface (Vercel, Stripe) uses: the reader should know
// what a section governs without reading its rows.
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      {/* The description is a sentence explaining what the section governs,
          and a sentence per card is what made this page a wall of prose. It
          moves behind the (i) the rest of the app already uses — same
          affordance, same place, and the row labels are what the eye lands on.
          No divider between rows either: every control in here already draws
          its own border, so the lines were a second grid over the first. */}
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <InfoTip text={description} />}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

