"use client";

// One tenant's setup, in one place.
//
// This is the onboarding surface: everything an operator installs when a salon
// is wired up, and almost nothing they look at afterwards. It is deliberately
// NOT a mirror of the salon's own Settings. The split we hold to is config
// versus operation — the credentials, the webhooks and the provider accounts
// are installed once by whoever does the setup, while the reminders, the
// message wording and the daily work stay in the salon's own app where they
// belong. A field that appears on both screens is a bug in one of them.
//
// Secrets are shown masked and re-pasted to change. Nothing here reads a
// credential back to the browser; see convex/connections.ts for why.

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Failures } from "../parts";

// Label left, control right, current value underneath as a hint. Autosave on
// blur, no Save button, matching the app's own settings conventions.
function Row({
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
function SecretRow({
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
function Section({
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
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && (
        <p className="mt-0.5 text-xs text-[var(--muted)]">{description}</p>
      )}
      <div className="mt-2 divide-y divide-[var(--border)]">{children}</div>
    </section>
  );
}

// Status is a dot plus a word, never a bare lowercase token floating in a
// row. Tones map to the app's existing palette: green for healthy, amber for
// needs-attention, muted for off/none.
function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "muted";
  children: React.ReactNode;
}) {
  const dot =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : "bg-[var(--border)]";
  const text =
    tone === "warn"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "muted"
        ? "text-[var(--muted)]"
        : "";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${text}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

// Provider ids are reference data the operator pastes into dashboards and
// support tickets, so every id is one click to copy. The confirmation
// replaces the text inside a fixed-width slot: nothing shifts.
function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      title="Copy"
      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-[var(--muted-bg)] px-1.5 py-0.5 font-mono text-[11px] hover:opacity-80"
    >
      <span className="truncate">{value}</span>
      <span className="w-8 shrink-0 text-left text-[var(--muted)]">
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}

// A labeled data value. Every fact carries its label — a timestamp or a
// count with no name is the exact mess this page had before.
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 truncate text-xs">{children}</div>
    </div>
  );
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TenantPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId as Id<"orgs">;
  const allowed = useQuery(api.platform.amPlatformAdmin, {});
  const detail = useQuery(api.platform.orgDetail, allowed ? { orgId } : "skip");
  const setOrgConfig = useMutation(api.platform.setOrgConfig);
  const setWaAccount = useMutation(api.platform.setWaAccount);
  const actAs = useMutation(api.platform.actAs);
  const conns = useQuery(api.connections.orgStatus, allowed ? { orgId } : "skip");
  const setField = useMutation(api.connections.setField);
  const retryVoiceEvents = useMutation(api.platform.retryVoiceEvents);
  const [retryingAgent, setRetryingAgent] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<{ agentId: string; message: string } | null>(null);
  const router = useRouter();

  if (allowed === undefined) {
    return <main className="mx-auto max-w-4xl p-6 text-sm text-[var(--muted)]">Loading…</main>;
  }
  if (!allowed) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          This page is for platform operators. Your own settings live in the app.
        </p>
      </main>
    );
  }
  if (detail === undefined) {
    return <main className="mx-auto max-w-4xl p-6 text-sm text-[var(--muted)]">Loading…</main>;
  }
  if (detail === null) {
    return <main className="mx-auto max-w-4xl p-6 text-sm">No such business.</main>;
  }

  const org = (patch: Omit<Parameters<typeof setOrgConfig>[0], "orgId">) =>
    setOrgConfig({ ...patch, orgId });
  // Every WhatsApp write carries phoneNumberId because it is the row's
  // identity, not an optional field: the webhook resolves an org by it.
  const wa = (patch: { phoneNumberId?: string; wabaId?: string; accessToken?: string; displayNumber?: string }) =>
    setWaAccount({
      orgId,
      phoneNumberId: patch.phoneNumberId ?? detail.wa?.phoneNumberId ?? "",
      wabaId: patch.wabaId,
      accessToken: patch.accessToken,
      displayNumber: patch.displayNumber,
    });

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin" className="text-xs text-[var(--muted)] hover:underline">
            ← Fleet
          </Link>
          <h1 className="mt-1 text-lg font-semibold">
            {detail.name}
            {detail.demoMode && (
              <span className="ml-2 rounded-lg bg-[var(--muted-bg)] px-2 py-0.5 text-xs font-normal text-[var(--muted)]">
                demo
              </span>
            )}
          </h1>
          <p className="text-xs text-[var(--muted)]">
            {detail.timezone} · {detail.language} · {detail.agents.length}{" "}
            {detail.agents.length === 1 ? "agent" : "agents"}
          </p>
        </div>
        {/* Everything below this line is config the operator installs. This
            button is for the rest: the things that only exist inside the
            product, where the fix is three taps in their own Appointments
            screen and no amount of admin fields would have reached it. */}
        <button
          type="button"
          onClick={() => {
            void actAs({ orgId }).then(() => router.push("/"));
          }}
          className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
        >
          Work in this account as {detail.name} →
        </button>
      </header>

      <Section
        title="Voice"
        description="The client's own Retell account. The key decides whose agents Phone agent lists, and it must be the account's webhook signing key."
      >
        {(conns ?? []).filter((row) => row.provider === "retell").map((row) => (
          <SecretRow
            key={`${row.provider}.${row.field}`}
            label={`${row.providerLabel} ${row.fieldLabel}`}
            hint={row.label ?? undefined}
            masked={row.masked}
            onSave={(value) =>
              setField({ orgId, provider: row.provider, field: row.field, value })
            }
          />
        ))}

        {detail.voiceProvisioning.length > 0 && (
          <div className="py-2.5">
            <div className="text-sm font-medium">Agent setup</div>
            <div className="mt-1 space-y-2">
              {detail.voiceProvisioning.map((job, index) => (
                <div key={`${job.updatedAt}-${index}`} className="text-xs">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Pill tone={job.status === "failed" ? "warn" : job.status === "complete" ? "ok" : "muted"}>
                      {job.status}
                    </Pill>
                    <span className="font-medium">{job.name}</span>
                    <span className="text-[var(--muted)]">{job.template}</span>
                    <span className="ml-auto text-[var(--muted)]">{shortDate(job.updatedAt)}</span>
                  </div>
                  {(job.retellAgentId || job.retellLlmId) && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {job.retellAgentId && <CopyId value={job.retellAgentId} />}
                      {job.retellLlmId && <CopyId value={job.retellLlmId} />}
                    </div>
                  )}
                  {job.error && (
                    <div className="mt-1 break-words rounded-lg bg-amber-50 px-2 py-1.5 font-mono text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                      {job.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {detail.agents.length === 0 ? (
          <p className="py-2.5 text-xs text-[var(--muted)]">
            No agents connected. The business can add one in Phone agent once the key is in.
          </p>
        ) : (
          detail.agents.map((agent) => (
            <div key={agent.retellAgentId} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <CopyId value={agent.retellAgentId} />
                <span className="text-xs text-[var(--muted)]">
                  {agent.inboundNumber ?? "No line"}
                </span>
                <span className="ml-auto">
                  <Pill tone={agent.enabled ? "ok" : "warn"}>
                    {agent.enabled ? "Enabled" : "Disabled"}
                  </Pill>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
                <Fact label="Randevu runtime">
                  {agent.runtimeConnectedAt ? (
                    <Pill tone="ok">{shortDate(agent.runtimeConnectedAt)}</Pill>
                  ) : (
                    <Pill tone="warn">Not connected</Pill>
                  )}
                </Fact>
                <Fact label="Last call result">
                  {agent.lastCallEventAt ? (
                    shortDate(agent.lastCallEventAt)
                  ) : (
                    <span className="text-[var(--muted)]">None yet</span>
                  )}
                </Fact>
                <Fact label="Last analysis">
                  {agent.lastAnalyzedEventAt ? (
                    shortDate(agent.lastAnalyzedEventAt)
                  ) : (
                    <span className="text-[var(--muted)]">None yet</span>
                  )}
                </Fact>
                <Fact label="Event inbox">
                  {agent.pendingEvents === 0 && agent.failedEvents === 0 ? (
                    <span className="text-[var(--muted)]">Clear</span>
                  ) : (
                    <Pill tone={agent.failedEvents > 0 ? "warn" : "muted"}>
                      {agent.pendingEvents} pending · {agent.failedEvents} failed
                    </Pill>
                  )}
                </Fact>
              </div>
              {agent.latestFailure && (
                <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {agent.latestFailure.eventType} · {shortDate(agent.latestFailure.receivedAt)} · call {agent.latestFailure.callId} · {agent.latestFailure.attempts} attempts
                    </span>
                    <button
                      type="button"
                      disabled={retryingAgent === agent.retellAgentId}
                      onClick={() => {
                        setRetryingAgent(agent.retellAgentId);
                        setRetryError(null);
                        void retryVoiceEvents({
                          orgId,
                          retellAgentId: agent.retellAgentId,
                        })
                          .catch((error: unknown) =>
                            setRetryError({
                              agentId: agent.retellAgentId,
                              message: error instanceof Error ? error.message : "Retry failed.",
                            }),
                          )
                          .finally(() => setRetryingAgent(null));
                      }}
                      className="rounded-lg px-2 py-1 font-medium hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-950/60"
                    >
                      {retryingAgent === agent.retellAgentId ? "Retrying…" : "Retry failed updates"}
                    </button>
                  </div>
                  {agent.latestFailure.error && (
                    <div className="mt-1 break-words font-mono">
                      {agent.latestFailure.error}
                    </div>
                  )}
                  {retryError?.agentId === agent.retellAgentId && (
                    <div className="mt-1">{retryError.message}</div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </Section>

      <Section
        title="WhatsApp"
        description="The org's own Meta Cloud API number. Inbound messages resolve the org by phone number ID."
      >
        <Row
          label="Phone number ID"
          hint="Meta's phone_number_id. Inbound resolves the org by this."
          current={detail.wa?.phoneNumberId}
          placeholder="123456789012345"
          onSave={(value) => wa({ phoneNumberId: value })}
        />
        <Row
          label="WABA ID"
          current={detail.wa?.wabaId}
          onSave={(value) => wa({ wabaId: value })}
        />
        <Row
          label="Display number"
          hint="What the salon sees. Cosmetic."
          current={detail.wa?.displayNumber}
          placeholder="+905321234567"
          onSave={(value) => wa({ displayNumber: value })}
        />
        <SecretRow
          label="Access token"
          masked={detail.wa?.accessToken}
          onSave={(value) => wa({ accessToken: value })}
        />
      </Section>

      <Section
        title="Bookings"
        description="cal.com powers availability and conflict checks. Without a key, voice bookings record without checking the calendar."
      >
        <SecretRow
          label="cal.com API key"
          masked={detail.calcomApiKey}
          onSave={(value) => org({ calcomApiKey: value })}
        />
        <Row
          label="Event type ID"
          current={detail.calcomEventTypeId}
          onSave={(value) => org({ calcomEventTypeId: value })}
        />
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
          <div className="text-sm font-medium">Webhook URL</div>
          <div className="min-w-0 text-xs text-[var(--muted)]">
            {/* cal.com's payload carries no tenant identity, so the org is
                resolved from this token in the path. It is generated, not
                typed, which is why this is text and not a field. */}
            {detail.calcomWebhookToken ? (
              <CopyId value={`/calcom/webhook/${detail.calcomWebhookToken}`} />
            ) : (
              "No token generated yet."
            )}
          </div>
        </div>
      </Section>

      <Section
        title="Email"
        description="Resend sender identity for reminder and campaign mail."
      >
        <Row
          label="From address"
          hint="Domain must be verified in Resend or sends are rejected."
          current={detail.emailFrom}
          placeholder="info@salonunuz.com"
          onSave={(value) => org({ emailFrom: value })}
        />
        <Row
          label="Inbound address"
          hint="Local part only. Replies land here."
          current={detail.inboundAddress}
          placeholder="guzellik"
          onSave={(value) => org({ inboundAddress: value })}
        />
      </Section>

      <Section
        title="Recent failures"
        description="Delivery problems across every channel of this org, newest first."
      >
        <Failures orgId={orgId} />
      </Section>
    </main>
  );
}
