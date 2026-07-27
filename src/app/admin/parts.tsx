"use client";

// Shared pieces of the operator console. Split out because the fleet list and
// a tenant's own page both need them and neither owns them.
//
// English-only on purpose, like the rest of /admin: lib/i18n exists so SALON
// staff read the product in their own language, and this surface has exactly
// one reader.

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
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

// Per-tenant provider credentials. This is the only surface that installs
// them: each client gets their own Retell account, provisioned by hand at
// setup, so the key belongs to whoever does the setup and not to the salon.
//
// It shows a masked tail, never the value. The operator created these accounts
// and does not need the app to recite a key back — and a console that did
// would make one compromised operator session worth every client's provider
// account at once. "Does this key still work" is answered by the salon's own
// Settings loading its agent list, not by reading the string.
export function Connections({ orgId }: { orgId: Id<"orgs"> }) {
  const rows = useQuery(api.connections.orgStatus, { orgId });
  const setField = useMutation(api.connections.setField);
  // Keyed by provider/field so two secrets on one org don't share a draft.
  const [draft, setDraft] = useState<Record<string, string>>({});

  if (rows === undefined) {
    return <div className="px-3 py-2 text-xs text-[var(--muted)]">Loading…</div>;
  }
  const save = (provider: string, field: string) => {
    const key = `${provider}.${field}`;
    const value = draft[key]?.trim();
    if (!value) return;
    void setField({ orgId, provider, field, value });
    // Drop it from component state the moment it is stored, so a pasted key
    // isn't left sitting in the DOM for the rest of the session.
    setDraft((prev) => ({ ...prev, [key]: "" }));
  };
  return (
    <div className="border-b border-[var(--border)] px-3 py-2">
      {rows.map((row) => {
        const key = `${row.provider}.${row.field}`;
        return (
          <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1 text-xs">
            <span className="w-40 shrink-0 font-medium">
              {row.providerLabel} {row.fieldLabel}
            </span>
            <span className="w-32 shrink-0 font-mono text-[var(--muted)]">
              {row.set ? row.masked : "not set"}
            </span>
            <span className="w-40 shrink-0 text-[var(--muted)]">
              {row.label ?? (row.set ? `set ${ago(row.updatedAt ?? undefined)} ago` : "")}
            </span>
            <input
              value={draft[key] ?? ""}
              onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
              onBlur={() => save(row.provider, row.field)}
              placeholder={row.set ? "replace…" : "paste key…"}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 font-mono"
            />
          </div>
        );
      })}
    </div>
  );
}

export function Failures({ orgId }: { orgId: Id<"orgs"> }) {
  const rows = useQuery(api.platform.orgFailures, { orgId });
  if (rows === undefined) {
    return <div className="px-3 py-2 text-xs text-[var(--muted)]">Loading…</div>;
  }
  if (rows.length === 0) {
    return <div className="px-3 py-2 text-xs text-[var(--muted)]">No failures on record.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((row) => (
            <tr key={row._id} className="border-t border-[var(--border)]">
              <td className="whitespace-nowrap px-3 py-1.5 text-[var(--muted)] tabular-nums">
                {ago(row.at)} ago
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">{row.kind}</td>
              <td className="px-3 py-1.5 font-mono text-[11px]">{row.error ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-[var(--muted)]">
                {row.attempts ? `${row.attempts} tries` : ""}
                {row.deadLettered ? " · gave up" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

