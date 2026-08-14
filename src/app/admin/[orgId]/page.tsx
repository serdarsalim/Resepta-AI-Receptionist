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
import { notFound, useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Activity, Row, Section, SecretRow, UserActivity } from "../parts";

// Label left, control right, current value underneath as a hint. Autosave on
// blur, no Save button, matching the app's own settings conventions.
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
      <div className="text-[11px] text-[var(--muted-strong)]">{label}</div>
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

// Both sides of the meter are micro-USD integers (schema: usageMonthly).
function usd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

// "12 min 05 s" rather than raw seconds: the operator reads this to sanity-
// check an invoice, and nobody invoices in seconds.
function minSec(seconds: number): string {
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
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
  const assistant = useQuery(api.platform.orgAssistant, allowed ? { orgId } : "skip");
  const voice = useQuery(api.platform.orgVoiceUsage, allowed ? { orgId } : "skip");
  const setVoiceRate = useMutation(api.platform.setVoiceRate);
  const setChatAgentMode = useMutation(api.platform.setChatAgentMode);
  const setChatAgentBudget = useMutation(api.platform.setChatAgentBudget);
  const setOrgStatus = useMutation(api.platform.setOrgStatus);
  const setPlatformFlag = useMutation(api.platformConfig.set);
  // Suspend is two clicks, not a dialog: the admin shell has no confirm
  // provider, and a state that arms and disarms itself is the same protection
  // with less machinery.
  const [armedSuspend, setArmedSuspend] = useState(false);
  // Setup is the install-once config; Activity is an unbounded feed. One page
  // holding both scrolled forever, so the feed lives behind its own tab with
  // a filter and pagination.
  const [tab, setTab] = useState<"setup" | "agents" | "assistant" | "usage" | "members" | "activity">("setup");
  const [retryingAgent, setRetryingAgent] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<{ agentId: string; message: string } | null>(null);
  const router = useRouter();

  if (allowed === undefined) {
    return <main className="mx-auto max-w-4xl p-6 text-sm text-[var(--muted)]">Loading…</main>;
  }
  // 404, not "you may not" — see the note on the fleet page. A refusal that
  // explains itself is an advert for the thing it is refusing.
  if (!allowed) notFound();
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
        <div className="flex items-center gap-1">
          {/* Suspension (docs/chat-agent.md §8): outbound stops, inbound keeps
              recording. Two-click arm/confirm instead of a dialog. */}
          {assistant && assistant.status === "suspended" ? (
            <button
              type="button"
              onClick={() => void setOrgStatus({ orgId, status: "active" })}
              className="rounded-lg px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
            >
              Suspended · Reactivate
            </button>
          ) : assistant ? (
            <button
              type="button"
              onClick={() => {
                if (!armedSuspend) {
                  setArmedSuspend(true);
                  setTimeout(() => setArmedSuspend(false), 4000);
                  return;
                }
                setArmedSuspend(false);
                void setOrgStatus({ orgId, status: "suspended" });
              }}
              className={`rounded-lg px-2 py-1 text-xs ${
                armedSuspend
                  ? "bg-red-50 font-medium text-red-700 dark:bg-red-950/30 dark:text-red-400"
                  : "text-[var(--muted)] hover:bg-[var(--muted-bg)]"
              }`}
            >
              {armedSuspend ? "Click again to suspend — all sends stop" : "Suspend"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void actAs({ orgId }).then(() => router.push("/"));
            }}
            className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
          >
            Work in this account as {detail.name} →
          </button>
        </div>
      </header>

      <div className="flex gap-1">
        {(
          [
            { id: "setup" as const, label: "Setup" },
            { id: "agents" as const, label: "Agents" },
            { id: "assistant" as const, label: "Assistant" },
            { id: "usage" as const, label: "Usage" },
            { id: "members" as const, label: "Members" },
            { id: "activity" as const, label: "Activity" },
          ]
        ).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              tab === entry.id
                ? "bg-[var(--accent)] font-medium text-[var(--accent-fg)]"
                : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* Two feeds, deliberately separate and deliberately in this order. The
          first answers "who touched this account", the second "did our messages
          land". Both used to be called activity, which is why each one now says
          which it is.

          The user feed lives HERE and not in the salon's own app: it was a
          sidebar destination there for about an hour on 2026-08-12 and came
          straight back out. An audit log is a debugging surface, its readers
          are operators, and a salon owner has no use for a page of "settings
          changed / businessHours". */}
      {tab === "activity" && (
        <>
          <Section
            title="Account activity"
            description="Who did what inside the app: bookings, customers, settings, members. Operator actions are attributed to the person, not the brand."
          >
            <UserActivity orgId={orgId} />
          </Section>
          <Section
            title="Message activity"
            description="The org's latest messages in both directions with their delivery outcome, newest first."
          >
            <Activity orgId={orgId} />
          </Section>
        </>
      )}

      {tab === "setup" && (
      <>
      <Section
        title="Voice"
        description="The client's own Retell account. The key decides whose agents Voice agent lists, and it must be the account's webhook signing key."
      >
        {(conns ?? []).filter((row) => row.provider === "retell").map((row) => (
          <SecretRow
            key={`${row.provider}.${row.field}`}
            label={`${row.providerLabel} ${row.fieldLabel}`}
            hint={[row.fieldHint, row.label].filter(Boolean).join(" ") || undefined}
            masked={row.masked}
            onSave={(value) =>
              setField({ orgId, provider: row.provider, field: row.field, value })
            }
          />
        ))}

      </Section>
      </>
      )}

      {/* Agents live behind their own tab. Setup is credentials you install
          once; this is running state that changes every call, and reading one
          while looking for the other is why the Voice card had grown to hold
          both. */}
      {tab === "agents" && (
      <>
      <Section
        title="Agent setup"
        description="Provisioning jobs for agents Resepta created, newest first. A failed job keeps its provider ids, so a retry repairs rather than duplicating."
      >
        {detail.voiceProvisioning.length === 0 ? (
          <p className="py-2.5 text-xs text-[var(--muted)]">
            No agent has been created from Resepta yet.
          </p>
        ) : (
          <div className="py-2.5">
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
      </Section>

      <Section
        title="Connected agents"
        description="Every agent mapped to this business, with whether Resepta's private runtime is published to it and whether call results are arriving."
      >
        {detail.agents.length === 0 ? (
          <p className="py-2.5 text-xs text-[var(--muted)]">
            No agents connected. The business can add one in Voice agent once the key is in.
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
                <Fact label="Resepta runtime">
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
      </>
      )}

      {tab === "assistant" && assistant && (
      <>
      <Section
        title="Chat agent"
        description="The WhatsApp assistant's lifecycle (docs/chat-agent.md). Shadow runs the full agent on real inbound and records every would-be reply without sending — read a week of it before going live."
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
          <div className="text-sm font-medium">Mode</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["off", "shadow", "live"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => void setChatAgentMode({ orgId, mode: option })}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${
                  assistant.mode === option
                    ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-2 py-2.5 sm:grid-cols-4">
          <Fact label="Model">
            {assistant.llmKeyConfigured ? (
              <Pill tone="ok">
                {assistant.llmProvider === "openai" ? "OpenAI" : "Anthropic"} · {assistant.llmModel}
              </Pill>
            ) : (
              <Pill tone="warn">
                No {assistant.llmProvider === "openai" ? "OpenAI" : "Anthropic"} key — agent skips every turn
              </Pill>
            )}
          </Fact>
          <Fact label="Platform kill switch">
            {assistant.killSwitch ? (
              <Pill tone="warn">ON — every org stopped</Pill>
            ) : (
              <span className="text-[var(--muted)]">off</span>
            )}
          </Fact>
          <Fact label={`Cost (${assistant.month})`}>
            ${((assistant.usage?.llmCostMicroUsd ?? 0) / 1_000_000).toFixed(3)}
            {" of "}
            ${((assistant.budgetMicroUsd ?? assistant.defaultBudgetMicroUsd) / 1_000_000).toFixed(0)}
          </Fact>
          <Fact label="Turns this month">
            {assistant.usage?.llmTurns ?? 0} · {(((assistant.usage?.llmInputTokens ?? 0) + (assistant.usage?.llmOutputTokens ?? 0)) / 1000).toFixed(1)}k tok
          </Fact>
        </div>
        <Row
          label="Monthly budget (USD)"
          hint="Hard cap for this org's LLM spend. Empty = the platform default. The turn that would cross it is skipped and visible below."
          current={
            assistant.budgetMicroUsd === null
              ? undefined
              : String(assistant.budgetMicroUsd / 1_000_000)
          }
          placeholder={String(assistant.defaultBudgetMicroUsd / 1_000_000)}
          onSave={(value) => {
            const parsed = Number(value.replace(",", "."));
            return setChatAgentBudget({
              orgId,
              budgetMicroUsd:
                !value.trim() || Number.isNaN(parsed)
                  ? null
                  : Math.round(parsed * 1_000_000),
            });
          }}
        />
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
          <div className="text-sm font-medium">Platform kill switch</div>
          <div>
            <button
              type="button"
              onClick={() =>
                void setPlatformFlag({
                  key: "chatAgentDisabled",
                  value: assistant.killSwitch ? "" : "true",
                })
              }
              className={`rounded-lg px-2 py-1 text-xs ${
                assistant.killSwitch
                  ? "bg-amber-50 font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                  : "text-[var(--muted)] hover:bg-[var(--muted-bg)]"
              }`}
            >
              {assistant.killSwitch
                ? "Every agent is stopped — click to re-enable"
                : "Stop every org's agent"}
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="Flight recorder"
        description="The last 25 turns, newest first — sent, shadowed, skipped and failed alike. Expand one to read the reply and every tool call with its arguments and result."
      >
        {assistant.turns.length === 0 ? (
          <p className="py-2.5 text-xs text-[var(--muted)]">No turns yet.</p>
        ) : (
          <div className="space-y-1 py-2">
            {assistant.turns.map((turn, index) => (
              <details key={`${turn.at}-${index}`} className="text-xs">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-1 [&::-webkit-details-marker]:hidden">
                  <Pill
                    tone={
                      turn.status === "sent"
                        ? "ok"
                        : turn.status === "error"
                          ? "warn"
                          : "muted"
                    }
                  >
                    {turn.status}
                  </Pill>
                  <span className="font-medium">{turn.customerName}</span>
                  {turn.error && (
                    <span className="text-amber-700 dark:text-amber-400">{turn.error}</span>
                  )}
                  <span className="ml-auto text-[var(--muted)]">
                    {(turn.inputTokens + turn.outputTokens).toLocaleString()} tok ·
                    ${(turn.costMicroUsd / 1_000_000).toFixed(4)} · v{turn.templateVersion} ·{" "}
                    {shortDate(turn.at)}
                  </span>
                </summary>
                <div className="ml-1 space-y-1.5 border-l-2 border-[var(--border)] py-1 pl-3">
                  {turn.reply && <p className="whitespace-pre-wrap">{turn.reply}</p>}
                  {turn.toolCalls && (
                    <pre className="overflow-x-auto rounded-lg bg-[var(--muted-bg)] p-2 font-mono text-[11px]">
                      {JSON.stringify(JSON.parse(turn.toolCalls), null, 2)}
                    </pre>
                  )}
                  {turn.latencyMs !== undefined && (
                    <p className="text-[var(--muted)]">{turn.latencyMs} ms · {turn.model}</p>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </Section>
      </>
      )}

      {tab === "usage" && voice && (
      <>
      <Section
        title="Voice meter"
        description="What this business's phone agent costs and earns. Every call is billed per second at the rate below, frozen onto the call the moment its duration lands — changing the rate only affects calls from now on. Retell cost is what Retell charges us for the same calls; the margin column is the difference."
      >
        <Row
          label="Rate (USD per minute)"
          hint="Empty = no rate: calls still meter (minutes and Retell cost stay visible) but bill at $0. History keeps the rate it was stamped with."
          current={
            voice.rateMicroUsdPerMinute === null
              ? undefined
              : String(voice.rateMicroUsdPerMinute / 1_000_000)
          }
          placeholder="0.30"
          onSave={(value) => {
            const parsed = Number(value.replace(",", "."));
            return setVoiceRate({
              orgId,
              rateMicroUsdPerMinute:
                !value.trim() || Number.isNaN(parsed)
                  ? null
                  : Math.round(parsed * 1_000_000),
            });
          }}
        />
        {voice.months.length === 0 ? (
          <p className="py-2.5 text-xs text-[var(--muted)]">No metered calls yet.</p>
        ) : (
          <div className="overflow-x-auto py-2">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[var(--muted-strong)]">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Month</th>
                  <th className="py-1.5 pr-3 font-medium">Calls</th>
                  <th className="py-1.5 pr-3 font-medium">Talk time</th>
                  <th className="py-1.5 pr-3 font-medium">Billed</th>
                  <th className="py-1.5 pr-3 font-medium">Retell cost</th>
                  <th className="py-1.5 font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {voice.months.map((m) => {
                  const margin = m.billedMicroUsd - m.costMicroUsd;
                  return (
                    <tr key={m.month} className="border-t border-[var(--border)] tabular-nums">
                      <td className="py-1.5 pr-3">{m.month}</td>
                      <td className="py-1.5 pr-3">{m.calls}</td>
                      <td className="py-1.5 pr-3">{minSec(m.seconds)}</td>
                      <td className="py-1.5 pr-3">{usd(m.billedMicroUsd)}</td>
                      <td className="py-1.5 pr-3">{usd(m.costMicroUsd)}</td>
                      <td
                        className={`py-1.5 ${
                          margin < 0 ? "text-red-600 dark:text-red-400" : ""
                        }`}
                      >
                        {usd(margin)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      </>
      )}

      {tab === "members" && (
      <Section
        title="Members"
        description="Who can sign in to this business. Sign-in is Google-only, so the address here is the only one that works — and there is no way to look it up from the other side."
      >
        {detail.members.length === 0 ? (
          <p className="py-2.5 text-xs text-[var(--muted)]">
            Nobody has signed in yet.
          </p>
        ) : (
          detail.members.map((member) => (
            <div
              key={`${member.email ?? member.name ?? "unknown"}-${member.role}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
            >
              <span className="text-sm font-medium">
                {member.name ?? <span className="text-[var(--muted)]">No name</span>}
              </span>
              {member.email ? (
                <CopyId value={member.email} />
              ) : (
                <span className="text-xs text-[var(--muted)]">No address</span>
              )}
              <span className="ml-auto flex items-center gap-3">
                {/* Unset seenAt means somebody else added them and they have
                    not signed in to find out — a seat, not yet a user. */}
                {member.seenAt === null && (
                  <span className="text-xs text-[var(--muted)]">Never signed in</span>
                )}
                <Pill tone={member.role === "owner" ? "ok" : "muted"}>{member.role}</Pill>
              </span>
            </div>
          ))
        )}
      </Section>
      )}

      {tab === "setup" && (
      <>
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
        title="Voice agents"
        description="One Retell workspace can serve several businesses. This decides which of its agents this business may connect — not which it already has, which nothing here changes."
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
          <div className="text-sm font-medium">Connectable agents</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["randevu", "account"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => void org({ voiceAgentSource: option })}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${
                  detail.voiceAgentSource === option
                    ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                }`}
              >
                {option === "randevu" ? "Only this business's" : "Whole workspace"}
              </button>
            ))}
          </div>
          <div />
          <div className="text-xs text-[var(--muted)]">
            {detail.voiceAgentSource === "randevu"
              ? "Only agents Resepta created for this business. The safe default when the Retell key is shared with another business."
              : "Every agent in the Retell workspace this key opens, including other businesses'. Agents already claimed elsewhere still cannot be connected."}
          </div>
        </div>
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

      </>
      )}
    </main>
  );
}
