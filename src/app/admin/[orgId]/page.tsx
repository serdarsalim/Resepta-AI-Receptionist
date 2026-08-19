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

import { useEffect, useState } from "react";
import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  Activity,
  AdminSearchProvider,
  Plane,
  Row,
  Section,
  SecretRow,
  TabStrip,
  UserActivity,
} from "../parts";
import { CheckMark, SearchInput } from "@/components/DataTable";
import { useSearch } from "@/lib/useTableState";

// The cal.com card is parked, not deleted — see the guard at its Section.
const SHOW_CALCOM_CARD = false;

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
  const setAllowedPhoneNumbers = useMutation(api.platform.setAllowedPhoneNumbers);
  const rotateEvolutionToken = useMutation(
    api.platform.rotateEvolutionWebhookToken,
  );
  const setBillingMode = useMutation(api.platform.setBillingMode);
  const addWalletCredit = useMutation(api.platform.addWalletCredit);
  const setChatAgentMode = useMutation(api.platform.setChatAgentMode);
  const setChatAgentBudget = useMutation(api.platform.setChatAgentBudget);
  const setOrgStatus = useMutation(api.platform.setOrgStatus);
  const setPlatformFlag = useMutation(api.platformConfig.set);
  // Suspend is two clicks, not a dialog: the admin shell has no confirm
  // provider, and a state that arms and disarms itself is the same protection
  // with less machinery.
  const [armedSuspend, setArmedSuspend] = useState(false);
  // The Retell account's real numbers, for the Phone lines checklist. An
  // action, not a query — the provider is the truth and nothing mirrors the
  // full account. null = loading, "error" = the fetch failed visibly.
  const listProvisionable = useAction(api.platform.listProvisionableNumbers);
  const [provisionable, setProvisionable] = useState<
    | Array<{ number: string; nickname: string | null; heldBy: string | null; missing: boolean }>
    | null
    | "error"
  >(null);
  useEffect(() => {
    if (!allowed) return;
    setProvisionable(null);
    void listProvisionable({ orgId })
      .then(setProvisionable)
      .catch(() => setProvisionable("error"));
  }, [allowed, listProvisionable, orgId]);
  // Same box as the fleet page and the salon app: this page is six tabs of
  // labelled rows, and "where do I set the transfer number" should not be a
  // hunt through all six.
  const search = useSearch();
  // Setup is the install-once config; Activity is an unbounded feed. One page
  // holding both scrolled forever, so the feed lives behind its own tab with
  // a filter and pagination.
  const [tab, setTab] = useState<
    "setup" | "agents" | "assistant" | "members" | "sends" | "activity"
  >("setup");
  const [retryingAgent, setRetryingAgent] = useState<string | null>(null);
  // Phone lines shows only this business's numbers until the operator asks
  // to add one — the account list is pick-time inventory, not standing state.
  const [addingLine, setAddingLine] = useState(false);
  const [retryError, setRetryError] = useState<{ agentId: string; message: string } | null>(null);
  const router = useRouter();

  // Every state wears the plane, loading included: bare, the page painted flat
  // white until the query landed and then washed over, which reads as arriving
  // in a different app.
  if (allowed === undefined) {
    return <Plane narrow><p className="text-sm text-[var(--muted)]">Loading…</p></Plane>;
  }
  // 404, not "you may not" — see the note on the fleet page. A refusal that
  // explains itself is an advert for the thing it is refusing.
  if (!allowed) notFound();
  if (detail === undefined) {
    return <Plane narrow><p className="text-sm text-[var(--muted)]">Loading…</p></Plane>;
  }
  if (detail === null) {
    return <Plane narrow><p className="text-sm">No such business.</p></Plane>;
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
    <AdminSearchProvider search={search}>
    <Plane narrow className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin" className="text-xs text-[var(--muted)] hover:underline">
            ← Fleet
          </Link>
          <h1 className="page-title mt-1 text-lg font-semibold">
            {detail.name}
            {detail.demoMode && (
              <span className="ml-2 rounded-full bg-[var(--muted-bg)] px-2 py-0.5 text-xs font-normal text-[var(--muted)]">
                demo
              </span>
            )}
          </h1>
          <p className="text-xs text-[var(--muted)]">
            {detail.timezone} · {detail.language} · {detail.agents.length}{" "}
            {detail.agents.length === 1 ? "agent" : "agents"}
          </p>
        </div>
        {/* Two controls, both real buttons now: they were plain text sitting
            in the corner, which read as a caption rather than something you
            could press. Suspend left the header entirely — it is the most
            destructive thing on this page and it was one stray click from the
            impersonation button. It lives at the foot of the page instead.

            The label lost the salon's name: it sat directly under an <h1> that
            already says it, so the name was the longest word in a button that
            repeated its own page title back at you. */}
        <div className="flex items-center gap-2">
          <SearchInput
            value={search.query}
            onChange={search.setQuery}
            placeholder="Search settings"
          />
          <button
            type="button"
            title="Opens the salon's own app with you signed in as them. Everything below is config an operator installs; this is for the rest, where the fix is three taps in their own screens."
            onClick={() => {
              void actAs({ orgId }).then(() => router.push("/"));
            }}
            // Filled with --card, not left transparent. A bordered control
            // sitting straight on the plane is a ring around a piece of the
            // gradient; filled, it reads as a control on the same paper as
            // the cards below it. Height matches the search box beside it —
            // any difference on the top row reads as misalignment.
            className="h-9 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-medium transition-colors hover:bg-[var(--muted-bg)]"
          >
            Open their app →
          </button>
        </div>
      </header>

      {/* A live query looks across every tab at once — a setting must be
          findable from wherever you happen to be standing — so the strip goes
          away rather than sitting there implying it still divides anything. */}
      {!search.active && (
      <TabStrip
        tabs={[
          { id: "setup" as const, label: "Setup" },
          { id: "agents" as const, label: "Agents" },
          { id: "assistant" as const, label: "Assistant" },
          { id: "members" as const, label: "Members" },
          { id: "sends" as const, label: "Sends" },
          { id: "activity" as const, label: "Logs" },
        ]}
        active={tab}
        onSelect={setTab}
      />
      )}

      {/* Two feeds, deliberately separate and deliberately in this order. The
          first answers "who touched this account", the second "did our messages
          land". Both used to be called activity, which is why each one now says
          which it is.

          The user feed lives HERE and not in the salon's own app: it was a
          sidebar destination there for about an hour on 2026-08-12 and came
          straight back out. An audit log is a debugging surface, its readers
          are operators, and a salon owner has no use for a page of "settings
          changed / businessHours". */}
      {/* Two feeds, two TABS (Serdar, 2026-08-18): what people DID and what
          the org SENT answer different questions, and stacking them under one
          Activity tab made each the other's noise. */}
      {tab === "activity" && (
        <Section
          title="Account activity"
          description="Who did what inside the app: bookings, customers, settings, members. Operator actions are attributed to the person, not the brand."
        >
          <UserActivity orgId={orgId} />
        </Section>
      )}
      {tab === "sends" && (
        <Section
          title="Message activity"
          description="The org's latest messages in both directions with their delivery outcome, newest first."
        >
          <Activity orgId={orgId} />
        </Section>
      )}

      {(tab === "setup" || search.active) && (
      <>
      {/* One card where there were two (Serdar, 2026-08-20): "Voice" held
          the key and "Voice agents" held a Connectable-agents toggle whose
          value is a fact about the key — the platform key means the shared
          workspace (picker scoped to this business's own agents), any other
          key means the client's own account (whole workspace visible). That
          scope now derives when the key is saved (connections.setFieldInternal),
          so the toggle had nothing left to decide. The odd case — a second
          key for the shared workspace — is set by hand via
          platform.setOrgConfig, which still accepts voiceAgentSource. */}
      <Section
        title="Voice agents"
        description="The Retell key this business runs on — it must be the workspace's webhook signing key. Which agents the business may connect follows from the key by itself: the platform key scopes the picker to its own agents, its own key opens its whole workspace."
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
      {(tab === "agents" || search.active) && (
      <>
      {/* ONE list (Serdar, 2026-08-20). This was two cards — "Agent setup",
          the auto-provisioning job log, above "Connected agents" — and for a
          business whose agent was born in the Retell dashboard and then
          connected, the pair read as a contradiction: "no agent has been
          created yet" printed over a live, enabled agent. Where an agent came
          from is not a card boundary. Provisioning jobs still in flight or
          failed render below the agents; a COMPLETE job's outcome IS the
          agent row, so it is not repeated as history. */}
      <Section
        title="Agents"
        description="Every agent answering for this business — created by Resepta or connected from the Retell workspace — with whether Resepta's private runtime is published to it and whether call results are arriving. A failed provisioning job keeps its provider ids, so a retry repairs rather than duplicating."
      >
        {detail.agents.length === 0 &&
        !detail.voiceProvisioning.some((job) => job.status !== "complete") ? (
          <p className="py-2.5 text-xs text-[var(--muted)]">
            No agent yet. Resepta provisions one at onboarding, or the business
            connects an existing Retell agent from its Phone page once the key
            is in.
          </p>
        ) : (
          <>
          {/* One line per agent (Serdar, 2026-08-20). The four-fact grid —
              last call result, last analysis, "Clear" inbox — printed the
              healthy answer to diagnostic questions nobody had asked, four
              cells of "fine" under every agent. What survives is the name an
              operator actually recognises, plus what can be WRONG: the
              runtime (an agent without it answers with nothing), the inbox
              only when something is stuck, and the enabled pill. Actual
              failures keep their amber block below. */}
          {detail.agents.map((agent) => (
            <div key={agent.retellAgentId} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {agent.name && <span className="text-sm font-medium">{agent.name}</span>}
                <CopyId value={agent.retellAgentId} />
                <span className="text-xs text-[var(--muted)]">
                  {agent.inboundNumber ?? "No line"}
                </span>
                {agent.runtimeConnectedAt ? (
                  <Pill tone="ok">runtime {shortDate(agent.runtimeConnectedAt)}</Pill>
                ) : (
                  <Pill tone="warn">No runtime</Pill>
                )}
                {(agent.pendingEvents > 0 || agent.failedEvents > 0) && (
                  <Pill tone={agent.failedEvents > 0 ? "warn" : "muted"}>
                    {agent.pendingEvents} pending · {agent.failedEvents} failed
                  </Pill>
                )}
                <span className="ml-auto">
                  <Pill tone={agent.enabled ? "ok" : "warn"}>
                    {agent.enabled ? "Enabled" : "Disabled"}
                  </Pill>
                </span>
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
          ))}
          {detail.voiceProvisioning.some((job) => job.status !== "complete") && (
            <div className="py-2.5">
              <div className="space-y-2">
                {detail.voiceProvisioning
                  .filter((job) => job.status !== "complete")
                  .map((job, index) => (
                    <div key={`${job.updatedAt}-${index}`} className="text-xs">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Pill tone={job.status === "failed" ? "warn" : "muted"}>
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
          </>
        )}
      </Section>
      {/* Provisioning numbers lives with the agents that answer on them, not
          under Usage where it sat unfindable — the flow is buy → operator
          provisions the line here → the tenant's pickers offer it
          (retell.orgNumberPolicy). */}
      {voice && (
        <Section
          title="Phone lines"
          description="The numbers this business may route inbound calls to, or place outbound calls from — their app's number pickers offer exactly this list, and no lines means NO numbers for them until you provision one here. Add a phone line offers the Retell account's real numbers, so provisioning is a click, never retyped E.164."
        >
          {provisionable === null ? (
            <p className="py-2.5 text-xs text-[var(--muted)]">
              Loading the account&apos;s numbers…
            </p>
          ) : provisionable === "error" ? (
            <p className="py-2.5 text-xs text-amber-700 dark:text-amber-400">
              Could not list the Retell account&apos;s numbers. Check the Voice key on Setup.
            </p>
          ) : provisionable.length === 0 ? (
            <p className="py-2.5 text-xs text-[var(--muted)]">
              The Retell account has no phone numbers (or no Voice key is set).
            </p>
          ) : (
            <div className="py-1.5">
              {/* This business's lines only, until "Add a phone line" opens
                  the whole account (Serdar, 2026-08-20): the full inventory —
                  every other client's number, each with its holder — is
                  pick-time information, and as the standing view it read as
                  a page of other people's lines under a business that has
                  one. Stale allowlist entries (missing) always show, since
                  unticking one here is how they get cleaned up. */}
              {provisionable
                .filter(
                  (line) =>
                    addingLine ||
                    voice.allowedPhoneNumbers.includes(line.number) ||
                    line.missing,
                )
                .map((line) => {
                const on = voice.allowedPhoneNumbers.includes(line.number);
                // A line another business holds cannot be ticked ON from
                // here — one number, one business. It can still be ticked
                // OFF if this org has it, whoever else claims it.
                const blocked = !on && line.heldBy !== null;
                return (
                  <button
                    key={line.number}
                    type="button"
                    disabled={blocked}
                    onClick={() =>
                      setAllowedPhoneNumbers({
                        orgId,
                        numbers: on
                          ? voice.allowedPhoneNumbers.filter((n) => n !== line.number)
                          : [...voice.allowedPhoneNumbers, line.number],
                      })
                    }
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--muted-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CheckMark on={on} />
                    <span className="font-mono text-xs">{line.number}</span>
                    {line.nickname && (
                      <span className="truncate text-xs text-[var(--muted)]">
                        {line.nickname}
                      </span>
                    )}
                    {line.missing && (
                      <span className="text-xs text-amber-700 dark:text-amber-400">
                        not on the Retell account — untick to clean up
                      </span>
                    )}
                    {line.heldBy && (
                      <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">
                        (held by {line.heldBy})
                      </span>
                    )}
                  </button>
                );
              })}
              {!addingLine &&
                !provisionable.some(
                  (line) =>
                    voice.allowedPhoneNumbers.includes(line.number) ||
                    line.missing,
                ) && (
                  <p className="px-2 py-1.5 text-xs text-[var(--muted)]">
                    No line provisioned yet.
                  </p>
                )}
              <div className="px-2 pt-1.5">
                <button
                  type="button"
                  onClick={() => setAddingLine((open) => !open)}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                >
                  {addingLine ? "Done" : "Add a phone line…"}
                </button>
              </div>
            </div>
          )}
        </Section>
      )}
      </>
      )}

      {(tab === "assistant" || search.active) && assistant && (
      <>
      <Section
        title="Chat agent"
        description="The WhatsApp assistant's lifecycle (docs/chat-agent.md). Shadow runs the full agent on real inbound and records every would-be reply without sending. Read a week of it before going live."
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
                No {assistant.llmProvider === "openai" ? "OpenAI" : "Anthropic"} key, so the agent skips every turn
              </Pill>
            )}
          </Fact>
          <Fact label="Platform kill switch">
            {assistant.killSwitch ? (
              <Pill tone="warn">On, every org stopped</Pill>
            ) : (
              <span className="text-[var(--muted)]">Off</span>
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
                ? "Every agent is stopped. Click to re-enable"
                : "Stop every org's agent"}
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="Flight recorder"
        description="The last 25 turns, newest first: sent, shadowed, skipped and failed alike. Expand one to read the reply and every tool call with its arguments and result."
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
                {/* Indent alone, no left bar. A 2px rule down the side of an
                    expander is the accent-bar habit the house rules ban, and
                    the summary directly above already says what this belongs
                    to. Spacing carries the nesting. */}
                <div className="space-y-1.5 py-1 pl-4">
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

      {/* Under Agents rather than a tab of its own (Serdar, 2026-08-20): the
          meter and the wallet are facts ABOUT the phone agents, and Assistant
          already keeps its cost card on the same page as the thing it
          meters. A seventh tab for two cards was navigation, not
          organization. */}
      {(tab === "agents" || search.active) && voice && (
      <>
      <Section
        title="Voice meter"
        description="What this business's phone agent costs and earns. Every call is billed per second at the rate below, frozen onto the call the moment its duration lands, so changing the rate only affects calls from now on. Retell cost is what Retell charges us for the same calls; the margin column is the difference."
      >
        <Row
          label="Rate (USD per minute)"
          hint={
            voice.defaultRateMicroUsdPerMinute === null
              ? "Override for this business only. Empty = the platform default, which is not set yet; calls bill at $0 until one exists (Platform tab on the fleet page)."
              : `Override for this business only. Empty = the platform default, currently $${(voice.defaultRateMicroUsdPerMinute / 1_000_000).toFixed(2)}/min. History keeps the rate it was stamped with.`
          }
          current={
            voice.rateMicroUsdPerMinute === null
              ? undefined
              : String(voice.rateMicroUsdPerMinute / 1_000_000)
          }
          // The real resolution is org ?? platform ?? 0, so with no platform
          // rate the truthful "what applies when empty" is nothing at all —
          // the old "0.30" here promised a price nobody would be charged.
          placeholder={
            voice.defaultRateMicroUsdPerMinute === null
              ? undefined
              : String(voice.defaultRateMicroUsdPerMinute / 1_000_000)
          }
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
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
          <div className="text-sm font-medium">Billing mode</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["invoice", "prepaid"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => void setBillingMode({ orgId, mode: option })}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${
                  voice.billingMode === option
                    ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                }`}
              >
                {option}
              </button>
            ))}
            <span className="text-xs text-[var(--muted)]">
              Invoice: meter only, settle outside the product. Prepaid: Stripe
              wallet, an empty balance declines new calls at ring time.
            </span>
          </div>
        </div>
        {voice.billingMode === "prepaid" && (
          <>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
              <div className="text-sm font-medium">Wallet balance</div>
              <div
                className={`text-sm tabular-nums ${
                  voice.walletBalanceMicroUsd <= 0
                    ? "text-red-600 dark:text-red-400"
                    : ""
                }`}
              >
                {usd(voice.walletBalanceMicroUsd)}
                {voice.walletBalanceMicroUsd <= 0 && ", declining new calls"}
              </div>
            </div>
            <Row
              label="Add credit (USD)"
              hint="Manual credit on top of Stripe top-ups: goodwill, a correction, or negative to claw one back. Applies immediately."
              onSave={(value) => {
                const parsed = Number(value.replace(",", "."));
                if (!value.trim() || Number.isNaN(parsed) || parsed === 0) {
                  return Promise.resolve();
                }
                return addWalletCredit({
                  orgId,
                  amountMicroUsd: Math.round(parsed * 1_000_000),
                });
              }}
            />
            {voice.topups.length > 0 && (
              <div className="overflow-x-auto py-2">
                <table className="w-full text-sm">
                  {/* No colour override on thead. The global rule paints it
                      --table-header-fg and draws the one rule under it; a
                      per-table --muted-strong here fought that and made this
                      the only header in the app reading as a caption. */}
                  <thead className="text-left text-xs">
                    <tr>
                      <th className="pb-2 pr-3 pt-1 font-semibold">Top-up</th>
                      <th className="pb-2 pr-3 pt-1 font-semibold">Amount</th>
                      <th className="pb-2 pt-1 font-semibold">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {voice.topups.map((t) => (
                      <tr
                        key={`${t.at}-${t.amountMicroUsd}`}
                        className="border-t border-[var(--table-divider)] tabular-nums"
                      >
                        <td className="py-1.5 pr-3">
                          {new Date(t.at).toLocaleString("en-GB")}
                        </td>
                        <td className="py-1.5 pr-3">{usd(t.amountMicroUsd)}</td>
                        <td className="py-1.5">{t.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {voice.months.length === 0 ? (
          <p className="py-2.5 text-xs text-[var(--muted)]">No metered calls yet.</p>
        ) : (
          <div className="overflow-x-auto py-2">
            <table className="w-full text-sm">
              <thead className="text-left text-xs">
                <tr>
                  <th className="pb-2 pr-3 pt-1 font-semibold">Month</th>
                  <th className="pb-2 pr-3 pt-1 font-semibold">Calls</th>
                  <th className="pb-2 pr-3 pt-1 font-semibold">Talk time</th>
                  <th className="pb-2 pr-3 pt-1 font-semibold">Billed</th>
                  <th className="pb-2 pr-3 pt-1 font-semibold">Retell cost</th>
                  <th className="pb-2 pt-1 font-semibold">Margin</th>
                </tr>
              </thead>
              <tbody>
                {voice.months.map((m) => {
                  const margin = m.billedMicroUsd - m.costMicroUsd;
                  return (
                    <tr key={m.month} className="border-t border-[var(--table-divider)] tabular-nums">
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

      {(tab === "members" || search.active) && (
      <Section
        title="Members"
        description="Who can sign in to this business. Sign-in is Google-only, so the address here is the only one that works, and there is no way to look it up from the other side."
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

      {(tab === "setup" || search.active) && (
      <>
      <Section
        title="WhatsApp"
        description="The org's own Meta Cloud API number. Inbound messages resolve the org by phone number ID."
      >
        <Row
          label="Phone number ID"
          hint="Meta's phone_number_id. Inbound resolves the org by this."
          current={detail.wa?.phoneNumberId}
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
          onSave={(value) => wa({ displayNumber: value })}
        />
        <SecretRow
          label="Access token"
          hint="Empty = the platform token (Platform tab) authenticates this number. Paste one only when this business runs its own Meta app."
          masked={detail.wa?.accessToken}
          onSave={(value) => wa({ accessToken: value })}
        />
      </Section>

      {/* Hidden, not removed (Serdar, 2026-08-19): the cal.com lane stays
          dormant — no org is wired, native booking owns availability, and the
          card only invited the operator to configure a path nothing uses.
          The guard keeps the JSX compiling so the card cannot rot while it
          waits; flip the constant to show it again. */}
      {SHOW_CALCOM_CARD && (
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
                resolved from this token. It is generated, not typed, which is
                why this is text and not a field.

                Query param, not a path segment: the route is an exact
                /calcom/webhook and reads searchParams. This used to render
                /calcom/webhook/<token>, which 404s — the console was handing
                the operator a URL that could not work. */}
            {detail.calcomWebhookToken ? (
              <CopyId value={`/calcom/webhook?token=${detail.calcomWebhookToken}`} />
            ) : (
              "No token generated yet."
            )}
          </div>
        </div>
      </Section>
      )}

      <Section
        title="WhatsApp (Evolution API)"
        description="The self-hosted Baileys lane. Evolution posts a bare JSON body with no HMAC, so the token below is the whole credential for that endpoint — the org used to be resolved from the instance name in the payload, which nothing generates and anyone can guess."
      >
        <Row
          label="Instance name"
          hint="Must match the instance Evolution posts as. A label now, not a credential — but it is still checked against the payload, so a message from the wrong instance is not filed against this business."
          current={detail.evolutionInstance ?? undefined}
          onSave={(value) => org({ evolutionInstance: value })}
        />
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
          <div className="text-sm font-medium">Webhook URL</div>
          <div className="min-w-0 space-y-1.5 text-xs text-[var(--muted)]">
            {detail.evolutionWebhookToken ? (
              <CopyId
                value={`/whatsapp/evolution?token=${detail.evolutionWebhookToken}`}
              />
            ) : (
              <p>
                No token yet, so this endpoint refuses every call. Generate one
                and paste the URL into Evolution&apos;s webhook settings.
              </p>
            )}
            <button
              type="button"
              onClick={() => void rotateEvolutionToken({ orgId })}
              className="text-[var(--muted)] underline decoration-dotted transition-colors hover:text-[var(--foreground)]"
            >
              {detail.evolutionWebhookToken ? "Rotate token" : "Generate token"}
            </button>
            {detail.evolutionWebhookToken && (
              <p>
                Rotating breaks the URL in Evolution until you paste the new one.
              </p>
            )}
          </div>
        </div>
      </Section>

      <Section
        title="Email"
        description="Resend sender identity for reminder and campaign mail."
      >
        <Row
          label="Address"
          hint="Local part only — 'bella' mails as bella@ the platform's sending domain. Replies to it land in the app's Inbox, and it doubles as the From, so answers thread back into the timeline. The one email field a hosted business needs."
          current={detail.inboundAddress}
          onSave={(value) => org({ inboundAddress: value })}
        />
        <Row
          label="Custom From (own domain)"
          hint="Only for a business sending from its OWN domain, which must be verified in Resend or every send is rejected. Empty is the normal state: mail then leaves from the address above."
          current={detail.emailFrom}
          onSave={(value) => org({ emailFrom: value })}
        />
      </Section>

      </>
      )}

      {/* Setup only. This used to sit below EVERY tab so it would take a
          deliberate scroll to reach — which in practice read as the page
          repeating itself six times (Serdar, 2026-08-18). Setup is where the
          account-level facts live, so its most account-level control lives
          there too. The arm-then-confirm button remains the protection. */}
      {(tab === "setup" || search.active) && assistant && (
        <Section
          title="Account status"
          description="Suspending stops every outbound message: reminders, campaigns, the chat agent. Inbound keeps recording, so un-suspending restores a complete world: losing a customer's messages during a billing dispute is how a late payer becomes an ex-customer."
        >
          <div className="flex flex-wrap items-center gap-3 py-1.5">
            {assistant.status === "suspended" ? (
              <>
                <button
                  type="button"
                  onClick={() => void setOrgStatus({ orgId, status: "active" })}
                  className="rounded-lg border border-amber-500/40 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50"
                >
                  Reactivate
                </button>
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  Suspended. Nothing is sending.
                </span>
              </>
            ) : (
              <>
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
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    armedSuspend
                      ? "border-red-500/40 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                      : "border-[var(--border)] text-[var(--muted-strong)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {armedSuspend ? "Click again to confirm" : "Suspend account"}
                </button>
                {armedSuspend && (
                  <span className="text-xs text-red-700 dark:text-red-400">
                    All sends stop immediately.
                  </span>
                )}
              </>
            )}
          </div>
        </Section>
      )}
    </Plane>
    </AdminSearchProvider>
  );
}
