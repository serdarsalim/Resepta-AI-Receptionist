"use client";

// The operator's fleet view. NOT a salon-facing surface.
//
// Randevu is one Convex deployment serving every org, so this can be a route
// in the app itself rather than the separate control-plane project Nudge needs
// — there, each tenant has its own backend and nothing inside one of them can
// see the others. A second project here would need its own auth and its own
// deploy just to read this same database.
//
// Access is an env allowlist checked in the backend (convex/lib/platformAuth),
// never an org role: the owner of a salon is not the operator of the platform.
// Everything on this page comes from convex/platform.ts, the one file allowed
// to read across orgs.
//
// Deliberately English-only while the app is Turkish-first. The dictionary in
// lib/i18n exists so SALON staff read the product in their own language; this
// page has exactly one reader and translating it would mean maintaining a
// second copy of every operational term for nobody.

import { Fragment, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

function ago(at: number | undefined): string {
  if (!at) return "never";
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

// A count worth reading, or nothing at all. Walls of "0" are noise the eye has
// to filter before it can find the one number that isn't zero.
function Count({
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
function Setup({ org }: { org: { waConnected: boolean; approvedTemplates: number } }) {
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
function Connections({ orgId }: { orgId: Id<"orgs"> }) {
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

function Failures({ orgId }: { orgId: Id<"orgs"> }) {
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

export default function AdminPage() {
  // Asked FIRST, and fleet is skipped until it comes back true. platform.fleet
  // throws for anyone not on the allowlist, and a thrown query surfaces as an
  // error boundary rather than a value — so a salon owner who guessed the URL
  // would get a crash instead of an answer. This turns that into a sentence.
  const allowed = useQuery(api.platform.amPlatformAdmin, {});
  const fleet = useQuery(api.platform.fleet, allowed ? {} : "skip");
  const [open, setOpen] = useState<Id<"orgs"> | null>(null);

  if (allowed === undefined) {
    return (
      <main className="mx-auto max-w-6xl p-6 text-sm text-[var(--muted)]">Loading…</main>
    );
  }
  if (!allowed) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          This page is for platform operators. Nothing here belongs to your business —
          your own settings live in the app.
        </p>
      </main>
    );
  }
  if (fleet === undefined) {
    return (
      <main className="mx-auto max-w-6xl p-6 text-sm text-[var(--muted)]">Loading…</main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Fleet</h1>
        <p className="text-xs text-[var(--muted)]">
          {fleet.length} {fleet.length === 1 ? "org" : "orgs"} · noisiest first
        </p>
      </header>

      {fleet.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No orgs on this deployment yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--table-header-bg)] text-left text-xs text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Business</th>
                <th className="px-3 py-2 font-medium">Setup</th>
                <th className="px-3 py-2 font-medium" title="Failed sends, last 24h">
                  Failed
                </th>
                <th
                  className="px-3 py-2 font-medium"
                  title="Retries exhausted — nothing will pick these up"
                >
                  Gave up
                </th>
                <th className="px-3 py-2 font-medium" title="Waiting on a retry">
                  Retrying
                </th>
                <th
                  className="px-3 py-2 font-medium"
                  title="Claimed for sending and never reported back"
                >
                  Stuck
                </th>
                <th className="px-3 py-2 font-medium">Upcoming</th>
                <th className="px-3 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((org) => (
                <Fragment key={org.orgId}>
                  <tr
                    onClick={() => setOpen(open === org.orgId ? null : org.orgId)}
                    className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--row-hover-bg)]"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{org.name}</div>
                      <div className="text-xs text-[var(--muted)]">
                        {org.members} {org.members === 1 ? "member" : "members"} ·{" "}
                        {org.timezone}
                        {org.calcomConnected ? " · cal.com" : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <Setup org={org} />
                    </td>
                    <td className="px-3 py-2">
                      <Count value={org.failed24h} tone="warn" capped={org.capped} />
                    </td>
                    <td className="px-3 py-2">
                      <Count value={org.deadLettered24h} tone="bad" />
                    </td>
                    <td className="px-3 py-2">
                      <Count value={org.retrying} tone="plain" />
                    </td>
                    <td className="px-3 py-2">
                      <Count value={org.stuck} tone="bad" />
                    </td>
                    <td className="px-3 py-2 tabular-nums text-[var(--muted)]">
                      {org.upcomingAppointments}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-[var(--muted)]">
                      {ago(org.lastActivityAt)}
                    </td>
                  </tr>
                  {open === org.orgId && (
                    <tr className="bg-[var(--muted-bg)]">
                      <td colSpan={8} className="p-0">
                        <Connections orgId={org.orgId} />
                        <Failures orgId={org.orgId} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
