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

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  decodeEngine,
  encodeEngine,
  engineLabel,
  formatVoicePrice,
  voiceEngineChoices,
} from "../../../../convex/lib/voiceModels";
import {
  VOICE_AGENT_HIGH_PRIORITY,
  VOICE_AGENT_MODEL,
} from "../../../../convex/lib/voiceAgentTemplate";
import {
  Activity,
  AdminSearchProvider,
  CopyId,
  Plane,
  PercentRow,
  Row,
  SearchSelect,
  Section,
  SecretRow,
  TabStrip,
  UserActivity,
} from "../parts";
import { CheckMark, SearchInput } from "@/components/DataTable";
import { InfoTip } from "@/components/InfoTip";
import { useSearch } from "@/lib/useTableState";
import { MembersCard } from "./members";

// Named once so the ?tab= guard and the state cannot fall out of step: an
// unlisted value in the URL must land on Setup, not render an empty page.
const ADMIN_TABS = [
  "setup",
  "agents",
  "assistant",
  "billing",
  "members",
  "sends",
  "activity",
] as const;
type AdminTab = (typeof ADMIN_TABS)[number];

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
  const setAgentEngine = useAction(api.platform.setAgentEngine);
  const assistant = useQuery(api.platform.orgAssistant, allowed ? { orgId } : "skip");
  const voice = useQuery(api.platform.orgVoiceUsage, allowed ? { orgId } : "skip");
  const numberReqs = useQuery(
    api.platform.orgNumberRequests,
    allowed ? { orgId } : "skip",
  );
  const decideNumberRequest = useMutation(api.platform.decideNumberRequest);
  const [numberNote, setNumberNote] = useState("");
  // Filing a document the client sent some other way. Most of them do: the
  // self-serve upload is the tidy path, not the common one, and without this
  // the only way to get a request row was to ask the client to re-send a
  // document they had already sent.
  const numberDocumentUploadUrl = useMutation(
    api.platform.numberDocumentUploadUrl,
  );
  const fileNumberRequest = useMutation(api.platform.fileNumberRequest);
  const numberFileInput = useRef<HTMLInputElement>(null);
  const [filingDoc, setFilingDoc] = useState(false);
  const [fileDocError, setFileDocError] = useState<string | null>(null);
  const fileDocument = async (file: File) => {
    setFileDocError(null);
    setFilingDoc(true);
    try {
      const url = await numberDocumentUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await fileNumberRequest({ orgId, storageId, fileName: file.name });
    } catch (err) {
      // The operator's own console, so the thrown string is shown as thrown
      // (the 2026-08-25 rule: use the code's own words here). unsupported-type
      // and too-large are the two that actually happen.
      setFileDocError(err instanceof Error ? err.message : String(err));
    } finally {
      setFilingDoc(false);
    }
  };
  const setVoiceRate = useMutation(api.platform.setVoiceRate);
  const setChatRate = useMutation(api.platform.setChatRate);
  const setWaMarkup = useMutation(api.platform.setWaMarkup);
  const setAllowedPhoneNumbers = useMutation(api.platform.setAllowedPhoneNumbers);
  const claimPhoneNumber = useMutation(api.platform.claimPhoneNumber);
  // Which held line is armed, and what went wrong if a claim was refused.
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const rotateEvolutionToken = useMutation(
    api.platform.rotateEvolutionWebhookToken,
  );
  const setBillingMode = useMutation(api.platform.setBillingMode);
  const addWalletCredit = useMutation(api.platform.addWalletCredit);
  const setChatAgentMode = useMutation(api.platform.setChatAgentMode);
  const setChatAgentBudget = useMutation(api.platform.setChatAgentBudget);
  const setOrgStatus = useMutation(api.platform.setOrgStatus);
  const deleteOrg = useAction(api.platform.deleteOrg);
  // Suspend is two clicks, not a dialog: the admin shell has no confirm
  // provider, and a state that arms and disarms itself is the same protection
  // with less machinery.
  const [armedSuspend, setArmedSuspend] = useState(false);
  // Delete is a THIRD state of this card, not a second armed button. Two
  // click-again controls side by side is how somebody suspends when they meant
  // to delete and, worse, the reverse — so this one asks for the name.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [deleting, setDeleting] = useState(false);
  // Set when the provider teardown reported something it could not do. Holds
  // the message AND the fact that a second press means "go anyway", because
  // the alternative — deleting quietly and printing a warning — is exactly how
  // an orphan agent ends up in the Retell account.
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
  const [tab, setTab] = useState<AdminTab>("setup");
  // ?tab=members lands you where the link meant to send you — today that is the
  // fleet table's Members count, which is a number you click BECAUSE you want
  // to change it. Applied in an effect rather than in the useState initializer
  // on purpose: the initializer also runs during SSR, where there is no
  // location, so reading it there returns "setup" on the server and something
  // else on the client, which is a hydration mismatch. One frame of Setup is
  // the price. Read once, never written back — the tabs are not the URL.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("tab");
    if (asked && (ADMIN_TABS as readonly string[]).includes(asked)) {
      setTab(asked as AdminTab);
    }
  }, []);
  const [retryingAgent, setRetryingAgent] = useState<string | null>(null);
  // Phone lines shows only this business's numbers until the operator asks
  // to add one — the account list is pick-time inventory, not standing state.
  const [addingLine, setAddingLine] = useState(false);
  const [retryError, setRetryError] = useState<{ agentId: string; message: string } | null>(null);
  // The model publish is a provider round trip (draft, patch, publish), so
  // the select disables while it runs and any refusal lands next to the row
  // it belongs to instead of vanishing into the console.
  const [settingModel, setSettingModel] = useState<string | null>(null);
  const [modelError, setModelError] = useState<{ agentId: string; message: string } | null>(null);

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
  const wa = (patch: { phoneNumberId?: string; wabaId?: string; accessToken?: string | null; displayNumber?: string }) =>
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
          {/* A real button now, and a drawn arrow (Serdar, 2026-08-26). The
              old "← Fleet" was twelve-pixel muted text with a glyph whose
              shape is whatever the reader's font decides — the one control
              that leaves this page, styled quieter than any control on it.
              Same SVG the app shell draws for its own back arrow. "Back"
              rather than the destination's name: this page has exactly one
              place to go back to, so naming it bought nothing the arrow does
              not already say. */}
          <Link
            href="/admin"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs font-medium text-[var(--muted-strong)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
            Back
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
          { id: "agents" as const, label: "Voice agent" },
          { id: "assistant" as const, label: "Chat agent" },
          // Money got its own room (Serdar, 2026-08-26), reversing the
          // 2026-08-20 call that put the meter under Agents. That call was
          // right for what the card was then and stopped being right as it
          // grew: rate, billing mode, wallet, top-ups and a margin table is
          // not a fact ABOUT an agent, it is the invoice conversation, and it
          // was sitting in the middle of the page an operator opens to wire a
          // phone line. What makes the tab earn itself rather than just move
          // one card is that it takes BOTH channels' money — the chat agent's
          // spend and budget came with it, so "what does this client cost"
          // stopped being a question spread across two tabs.
          { id: "billing" as const, label: "Billing" },
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
      {/* The one fact that could not move with the wallet. A prepaid balance
          at zero DECLINES THE RING (retell.ts, prepaid gate) — the line
          sounds busy and the agent never answers. That is not a billing
          detail, it is the first answer to "why is nobody getting through",
          and it is asked on this tab. So the balance stays on Billing and the
          OUTAGE comes here, only when it is real. */}
      {voice &&
        voice.billingMode === "prepaid" &&
        voice.walletBalanceMicroUsd <= 0 && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
            Wallet is empty and this business is prepaid, so every incoming
            call is declined at ring time — callers hear a busy line, not an
            agent.{" "}
            <button
              type="button"
              onClick={() => setTab("billing")}
              className="font-medium underline hover:no-underline"
            >
              Top up on Billing →
            </button>
          </p>
        )}
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
              failures keep their amber block below.

              A REAL TABLE now, with headers (Serdar, 2026-08-25). The flex
              row wrapped: an agent with a long name and a number pushed the
              engine picker onto a second line, so the list alternated between
              one-line and two-line entries and nothing lined up down the
              page. A table cannot wrap — every agent is exactly one row, and
              the columns say what each cell is, which is what let the inline
              "Engine" label go.

              The row is the drill-in: clicking it opens this agent's edit
              page in the business's own app, signed in as them, because the
              path here used to be "Open their app" → Voice agents → find the
              same agent again. Same synchronous-blank-tab dance as the fleet
              glyph — window.open after an await has lost the user gesture and
              is what popup blockers exist for. The id chip and the engine
              picker stop the click: copying an id must not also open a tab.
              The picker's dropdown needs no guard — it portals to body,
              outside this row. */}
          <div className="thin-scroll overflow-x-auto py-1">
          <table className="w-full text-sm">
            <thead className="text-left text-xs">
              <tr>
                <th className="pb-2 pr-3 pt-1 font-semibold">Agent</th>
                <th className="pb-2 pr-3 pt-1 font-semibold">Line</th>
                {/* Was "runtime <date>", which named an internal — the private
                    MCP runtime an agent must be published to before its tools
                    answer (Serdar: "what's runtime? get rid of that word").
                    What the operator needs is whether its tools work, so the
                    column asks that and the date rides the title. */}
                <th
                  className="pb-2 pr-3 pt-1 font-semibold"
                  title="Whether Resepta's booking tools are published to this agent. Without them it can talk but cannot check a calendar, book, or save anything."
                >
                  Tools
                </th>
                <th className="pb-2 pr-3 pt-1 font-semibold">Engine</th>
                <th className="pb-2 pr-3 pt-1 font-semibold">Status</th>
                <th className="w-px pb-2 pt-1" />
              </tr>
            </thead>
            <tbody>
            {detail.agents.map((agent) => (
            <Fragment key={agent.retellAgentId}>
              {/* The whole row is no longer the target (Serdar, 2026-08-25).
                  A row carrying a picker, a copy chip and a remove-less set of
                  cells was a click surface with three holes in it, and every
                  one of them needed a stopPropagation to stay a hole. The
                  Open button says where it goes and the rest of the row is
                  just cells again. */}
              <tr className="border-t border-[var(--table-divider)]">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    {agent.name && (
                      <span className="font-medium">{agent.name}</span>
                    )}
                    <CopyId value={agent.retellAgentId} label="copy agent id" />
                  </div>
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-xs text-[var(--muted)]">
                  {agent.inboundNumber ?? "No line"}
                </td>
                <td className="whitespace-nowrap py-2 pr-3">
                  {agent.runtimeConnectedAt ? (
                    <Pill tone="ok">
                      <span title={shortDate(agent.runtimeConnectedAt)}>Connected</span>
                    </Pill>
                  ) : (
                    <Pill tone="warn">Not connected</Pill>
                  )}
                </td>
              {/* The ENGINE behind the agent: which model, at which tier,
                  priced per conversation minute — the whole point is deciding
                  here without opening Retell's pricing page. One picker
                  because they are one decision; a model whose cost you cannot
                  read without checking a second control beside it is how an
                  agent came to bill double for months.

                  Unset in the row means FOLLOW THE FLEET, and it follows
                  both: the common case stays one string in the template
                  rather than a fleet of rows pinning today's default forever.
                  Picking anything else pins both, which is the trade this
                  shape makes — a fleet tier change stops reaching an agent
                  that chose. The option reads just "Default" plus the model
                  it resolves to; "Platform default" spent two words on a
                  distinction the row cannot make anyway. */}
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2 text-xs">
                <SearchSelect
                  className="w-52"
                  value={
                    agent.llmModel
                      ? encodeEngine(
                          agent.llmModel,
                          agent.llmHighPriority ??
                            detail.platformHighPriority ??
                            VOICE_AGENT_HIGH_PRIORITY,
                        )
                      : ""
                  }
                  disabled={settingModel === agent.retellAgentId}
                  placeholder="Engine"
                  searchPlaceholder="Search models"
                  options={[
                    {
                      value: "",
                      // The resolved fleet default from orgDetail, so this
                      // label and the /admin dropdown can never disagree.
                      label: `Default — ${engineLabel(
                        detail.platformVoiceModel ?? VOICE_AGENT_MODEL,
                        detail.platformHighPriority ?? VOICE_AGENT_HIGH_PRIORITY,
                      )}`,
                    },
                    ...voiceEngineChoices().map((choice) => ({
                      value: choice.value,
                      label: choice.label,
                      hint: formatVoicePrice(choice.usdPerMinute),
                    })),
                  ]}
                  onChange={(next) => {
                    const picked = decodeEngine(next);
                    const model = picked?.id ?? null;
                    const highPriority = picked ? picked.fast : null;
                    if (
                      (agent.llmModel ?? null) === model &&
                      (agent.llmHighPriority ?? null) === highPriority
                    ) {
                      return;
                    }
                    setSettingModel(agent.retellAgentId);
                    setModelError(null);
                    void setAgentEngine({
                      orgId,
                      retellAgentId: agent.retellAgentId,
                      model,
                      highPriority,
                    })
                      .catch((error: unknown) =>
                        setModelError({
                          agentId: agent.retellAgentId,
                          message:
                            error instanceof Error ? error.message : "Engine change failed.",
                        }),
                      )
                      .finally(() => setSettingModel(null));
                  }}
                />
                {settingModel === agent.retellAgentId && (
                  <span className="whitespace-nowrap text-[var(--muted)]">Publishing…</span>
                )}
                  </div>
                </td>
                {/* Enabled is the dot alone (Serdar, 2026-08-25): it is the
                    state every healthy agent is in, so the word was printed
                    down the whole column to say "normal". Disabled keeps its
                    word — an amber dot with nothing beside it is a colour to
                    decode, and this one is worth reading. */}
                <td className="whitespace-nowrap py-2 pr-3">
                  <div className="flex items-center gap-2">
                    {agent.enabled ? (
                      <span
                        className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                        title="Enabled"
                        aria-label="Enabled"
                      />
                    ) : (
                      <Pill tone="warn">Disabled</Pill>
                    )}
                    {(agent.pendingEvents > 0 || agent.failedEvents > 0) && (
                      <Pill tone={agent.failedEvents > 0 ? "warn" : "muted"}>
                        {agent.pendingEvents} pending · {agent.failedEvents} failed
                      </Pill>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap py-2">
                  <button
                    type="button"
                    onClick={() => {
                      const editorTab = window.open("", "_blank");
                      const dest = `/?tab=voice&agent=${encodeURIComponent(agent.retellAgentId)}`;
                      void actAs({ orgId })
                        .then(() => {
                          if (editorTab) editorTab.location.href = dest;
                          else router.push(dest);
                        })
                        .catch(() => editorTab?.close());
                    }}
                    title="Open this agent's edit page in the business's own app, signed in as them. Only one business at a time — opening another repoints it."
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-medium transition-colors hover:bg-[var(--muted-bg)]"
                  >
                    Open
                  </button>
                </td>
              </tr>
              {/* Trouble gets a row of its own, spanning the table. Both of
                  these are rare and neither is a fact about a column: an
                  engine change that the provider refused, and the last
                  webhook that would not process. Squeezing either into a cell
                  is what made the flex version wrap. */}
              {modelError?.agentId === agent.retellAgentId && (
                <tr className="border-t border-[var(--table-divider)]">
                  <td colSpan={6} className="py-1.5 text-xs text-amber-700 dark:text-amber-400">
                    {modelError.message}
                  </td>
                </tr>
              )}
              {agent.latestFailure && (
                <tr className="border-t border-[var(--table-divider)]">
                  <td colSpan={6} className="py-1.5">
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
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
            </tbody>
          </table>
          </div>
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
          description="The numbers this business may route inbound calls to, or place outbound calls from — their app's number pickers offer exactly this list, and no lines means NO numbers for them until you provision one here. Add a phone line offers the Retell account's real numbers, so provisioning is a click, never retyped E.164. Number requests below: the business uploaded its company registration to ask for a line. Verify it, approve (then buy the number at the provider and provision it above) or deny with a reason the business will read."
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
                // A line another business holds is CLAIMABLE, not dead
                // (Serdar, 2026-08-26). It used to be a disabled row, which
                // stated the invariant — one number, one business — and left
                // the operator to be the transaction: open the other
                // business, untick it there, come back, tick it here, with
                // the line half-assigned in between. Clicking asks first,
                // then platform.claimPhoneNumber does both edits at once and
                // releases the loser's binding at the provider.
                const held = !on && line.heldBy !== null;
                const arming = claiming === line.number;
                return (
                  <button
                    key={line.number}
                    type="button"
                    onClick={() => {
                      if (held && !arming) {
                        setClaiming(line.number);
                        setClaimError(null);
                        // Disarms itself, like Suspend on this page: an armed
                        // control left sitting is one stray click from taking
                        // somebody's phone line.
                        setTimeout(
                          () => setClaiming((c) => (c === line.number ? null : c)),
                          4000,
                        );
                        return;
                      }
                      if (held && arming) {
                        setClaiming(null);
                        void claimPhoneNumber({ orgId, number: line.number }).catch(
                          (err: unknown) =>
                            setClaimError(
                              err instanceof Error ? err.message : "Could not claim it.",
                            ),
                        );
                        return;
                      }
                      void setAllowedPhoneNumbers({
                        orgId,
                        numbers: on
                          ? voice.allowedPhoneNumbers.filter((n) => n !== line.number)
                          : [...voice.allowedPhoneNumbers, line.number],
                      });
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--muted-bg)]"
                  >
                    <CheckMark on={on} />
                    <span className={`font-mono text-xs ${held ? "text-[var(--muted)]" : ""}`}>
                      {line.number}
                    </span>
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
                      <span
                        className={`ml-auto shrink-0 text-xs ${
                          arming
                            ? "font-medium text-red-700 dark:text-red-400"
                            : "text-[var(--muted)]"
                        }`}
                      >
                        {arming
                          ? `Click again to take it from ${line.heldBy}`
                          : `(held by ${line.heldBy})`}
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
              {claimError && (
                <p className="px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                  {claimError}
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
          {/* The tenant's number request (numberRequests.ts): the registration
              document regulators want before a number can be provisioned. In
              THIS card rather than one of its own (Serdar, 2026-08-25): the
              request is why you go buy a line, and the checklist above is
              where you land it — one flow, and split across two cards it read
              as two unrelated features. The decision here is the operator's
              own cue to go buy the number at the provider and provision it
              above — the app never purchases numbers. */}
          {/* Always rendered once loaded, empty or not (Serdar, 2026-08-26:
              "maybe I should see that card even though it hasn't been
              uploaded yet so I know where it is"). A block that only exists
              while a document is pending is a surface the operator cannot
              learn the location of: the one time they go looking, it is
              because a client ASKED, and the answer used to be a section
              that was not there. */}
          {numberReqs && (
            <div className="mt-2 space-y-3 border-t border-[var(--border)] pt-3">
              <p className="text-xs font-medium text-[var(--muted-strong)]">
                Number requests
              </p>
              {numberReqs.length === 0 && (
                <p className="text-xs text-[var(--muted)]">
                  Nothing to review. When the business uploads its company
                  registration, the document lands here: accept it, then buy
                  the number at the provider and tick it above. If they sent
                  it to you instead, file it yourself below.
                </p>
              )}
              {/* File-on-their-behalf. Always available, not only while the
                  list is empty: a business that uploaded the wrong document
                  then emailed the right one is the same situation, and
                  fileNumberRequest replaces any unapproved row the way a
                  re-upload does. */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={numberFileInput}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void fileDocument(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={filingDoc}
                  onClick={() => numberFileInput.current?.click()}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {filingDoc ? "Uploading…" : "File a document for them"}
                </button>
                <span className="text-xs text-[var(--muted)]">
                  Lands pending, marked as filed by us. Accept it below to
                  decide it.
                </span>
              </div>
              {fileDocError && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {fileDocError}
                </p>
              )}
              {/* Said plainly for the OPERATOR, because the button used to
                  imply otherwise (Serdar, 2026-08-26): approving decides the
                  DOCUMENT and nothing else. Nothing in the provisioning path
                  reads this status — the grant is the checklist above. The
                  tenant sees only "received / approved / live", which is true
                  at every step and says nothing about who does which part. */}
              {numberReqs.length > 0 && (
                <p className="text-xs text-[var(--muted)]">
                  Approving accepts the document and tells the business so. It
                  does not grant a line: buy the number at the provider and
                  tick it above, and their card then shows it as live.
                </p>
              )}
              {numberReqs.map((req) => (
                <div
                  key={req.requestId}
                  className="rounded-xl border border-[var(--border)] px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    {req.url ? (
                      <a
                        href={req.url}
                        target="_blank"
                        rel="noopener"
                        className="font-medium text-[var(--accent)] hover:underline"
                      >
                        {req.fileName}
                      </a>
                    ) : (
                      <span className="font-medium">{req.fileName}</span>
                    )}
                    <span className="text-xs text-[var(--muted)]">
                      {Math.max(1, Math.round(req.size / 1024))} KB ·{" "}
                      {new Date(req.createdAt).toLocaleString("en-GB")}
                      {/* Months later, "we accepted what the business sent"
                          and "we accepted what we typed in for them" are
                          different claims, and the file cannot say which. */}
                      {req.viaOperator && " · filed by us"}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        req.status === "pending"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          : req.status === "approved"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                      }`}
                    >
                      {req.status}
                    </span>
                  </div>
                  {req.note && (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Note to the business: {req.note}
                    </p>
                  )}
                  {req.status === "pending" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        value={numberNote}
                        onChange={(e) => setNumberNote(e.target.value)}
                        placeholder="Note to the business (required to deny)"
                        className="min-w-64 flex-1 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void decideNumberRequest({
                            requestId: req.requestId,
                            decision: "approved",
                            note: numberNote.trim() || undefined,
                          }).then(() => setNumberNote(""));
                        }}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
                      >
                        Accept document
                      </button>
                      <button
                        type="button"
                        disabled={!numberNote.trim()}
                        onClick={() => {
                          void decideNumberRequest({
                            requestId: req.requestId,
                            decision: "denied",
                            note: numberNote.trim(),
                          }).then(() => setNumberNote(""));
                        }}
                        className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-40 dark:border-red-900 dark:text-red-400"
                      >
                        Reject document
                      </button>
                    </div>
                  )}
                </div>
              ))}
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
          {/* The owner's half, shown and not settable here. Bringing an org
              live stamps "suggest" the first time, so a new org drafts until
              its owner decides otherwise — and this row is where an operator
              finds out that "live" does not mean the customers are being
              answered yet. */}
          {assistant.mode === "live" && (
            <>
              <div className="text-sm font-medium">Owner has it set to</div>
              <div className="text-sm text-[var(--muted)]">
                {assistant.behavior === "suggest"
                  ? "suggest — it drafts, staff send"
                  : assistant.behavior === "off"
                    ? "off — the owner switched it off"
                    : "answers customers directly"}
                {assistant.behavior === "live" &&
                  (assistant.stopOnHandover
                    ? " · hands the chat over when a person is needed"
                    : " · keeps answering when a person is needed")}
              </div>
            </>
          )}
        </div>
        {/* Two facts, not four: cost and turns moved to Billing with the
            budget that caps them (Serdar, 2026-08-26). What is left is what
            the agent IS, not what it spent. */}
        <div className="grid grid-cols-2 gap-x-5 gap-y-2 py-2.5">
          <Fact label="Model">
            {assistant.llmKeyConfigured ? (
              // A model with no row in the price table fails closed: the
              // agent skips every turn (model-unpriced) rather than run with
              // a budget that can never fill. Say it here, next to the model
              // that caused it.
              <Pill tone={assistant.llmModelPriced ? "ok" : "warn"}>
                {assistant.llmProvider === "openai" ? "OpenAI" : "Anthropic"} · {assistant.llmModel}
                {!assistant.llmModelPriced && " · unpriced, so the agent skips every turn until lib/llm.ts prices it"}
              </Pill>
            ) : (
              <Pill tone="warn">
                No {assistant.llmProvider === "openai" ? "OpenAI" : "Anthropic"} key, so the agent skips every turn
              </Pill>
            )}
          </Fact>
          {/* The stop-everything toggle is gone from the UI (Serdar,
              2026-08-27: too destructive to sit one click away). The flag
              itself survives — settable only by CLI now — so a set flag
              still explains itself here instead of skipping turns silently. */}
          {/* The go-live signal. An org sending most of what its assistant
              drafts is ready to answer customers directly; one discarding most
              of them is telling you what the brief is missing. Nothing trains
              on it — it is a reading, not a feedback loop. */}
          {assistant.acceptance && (
            <Fact label="Drafts sent">
              <Pill
                tone={
                  assistant.acceptance.sent * 2 >= assistant.acceptance.decided
                    ? "ok"
                    : "muted"
                }
              >
                {assistant.acceptance.sent} of {assistant.acceptance.decided} decided
              </Pill>
            </Fact>
          )}
          {assistant.killSwitch && (
            <Fact label="Platform kill switch">
              <Pill tone="warn">On, every org stopped</Pill>
            </Fact>
          )}
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
                      turn.status === "sent" ||
                      turn.suggestionOutcome === "sent"
                        ? "ok"
                        : turn.status === "error"
                          ? "warn"
                          : "muted"
                    }
                  >
                    {/* A draft's status alone says nothing worth knowing —
                        what happened to it is the fact. */}
                    {turn.status === "suggested"
                      ? `draft → ${turn.suggestionOutcome ?? "pending"}`
                      : turn.status}
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


      {/* Rebuilt Stripe-shaped (Serdar, 2026-08-26: "this looks a bit all
          over the place"). The Voice meter card was four different jobs in
          one box: config (rate, mode), state (balance), action (add credit)
          and history (two tables), stacked in the order they were written.
          A billing page has a standard shape and this now follows it:
          numbers first, money in, money out, terms last. The summary strip
          is the app's own Revenue-page idiom, cells divided, one figure
          each, so the operator's first glance answers "is this client fine"
          before any table is read. */}
      {(tab === "billing" || search.active) && voice && (() => {
        const monthNow = new Date().toISOString().slice(0, 7);
        const thisMonth = voice.months.find((m) => m.month === monthNow);
        const billed = thisMonth?.billedMicroUsd ?? 0;
        const cost = thisMonth?.costMicroUsd ?? 0;
        const prepaid = voice.billingMode === "prepaid";
        const tiles = 2 + (prepaid ? 1 : 0) + (assistant ? 1 : 0);
        return (
      <>
      <section
        className={`grid grid-cols-1 divide-y divide-[var(--border)] overflow-hidden rounded-lg bg-[var(--card)] shadow-[var(--card-shadow)] sm:divide-x sm:divide-y-0 ${
          tiles === 4 ? "sm:grid-cols-4" : tiles === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
        }`}
      >
        {prepaid && (
          <div className="px-4 py-3.5">
            <p className="text-xs text-[var(--muted)]">Wallet balance</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                voice.walletBalanceMicroUsd <= 0 ? "text-red-600 dark:text-red-400" : ""
              }`}
            >
              {usd(voice.walletBalanceMicroUsd)}
            </p>
            {/* The tile carries the consequence, not just the number: an
                empty wallet is an outage, and "0.00" alone does not say so. */}
            <p
              className={`mt-0.5 text-xs ${
                voice.walletBalanceMicroUsd <= 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-[var(--muted)]"
              }`}
            >
              {voice.walletBalanceMicroUsd <= 0
                ? "Empty: new calls are declined"
                : "Stripe and manual top-ups"}
            </p>
          </div>
        )}
        <div className="px-4 py-3.5">
          <p className="text-xs text-[var(--muted)]">Billed this month</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{usd(billed)}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {thisMonth ? `${thisMonth.calls} calls · ${minSec(thisMonth.seconds)}` : "No metered calls"}
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-xs text-[var(--muted)]">Margin this month</p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              billed - cost < 0 ? "text-red-600 dark:text-red-400" : ""
            }`}
          >
            {usd(billed - cost)}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">Retell cost {usd(cost)}</p>
        </div>
        {assistant && (
          <div className="px-4 py-3.5">
            <p className="text-xs text-[var(--muted)]">Chat agent this month</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              ${((assistant.usage?.llmCostMicroUsd ?? 0) / 1_000_000).toFixed(3)}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              of ${((assistant.budgetMicroUsd ?? assistant.defaultBudgetMicroUsd) / 1_000_000).toFixed(0)} budget · {assistant.usage?.llmTurns ?? 0} turns
            </p>
          </div>
        )}
      </section>

      {/* Money in. Only a prepaid business has a wallet; invoice mode settles
          outside the product and would render this card empty. */}
      {prepaid && (
        <Section
          title="Wallet"
          description="Manual credit applies immediately: goodwill, a correction, or a negative amount to claw one back. Stripe top-ups land here on their own. An empty balance declines new calls at ring time."
        >
          <Row
            label="Add credit"
            money
            hint="On top of Stripe top-ups. Applies immediately."
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
          {voice.topups.length === 0 ? (
            <p className="py-2.5 text-xs text-[var(--muted)]">No top-ups yet.</p>
          ) : (
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
        </Section>
      )}

      {/* Money out: the metered history, one row per month. */}
      <Section
        title="Voice usage"
        description="Every call is billed per second at the rate below, frozen onto the call the moment its duration lands, so a rate change only prices calls from now on. Retell cost is what Retell charges us for the same calls; margin is the difference."
      >
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

      {/* Terms last, because they are set once and read rarely: the rate, the
          mode, and the chat agent's cap. The chat budget lives here rather
          than in a card of its own, since a lone Row was the whole card once
          its cost figure moved into the summary strip. */}
      <Section
        title="Billing settings"
        description="The rate this business pays, how it settles, and the chat agent's monthly cap."
      >
        <Row
          label="Rate per minute"
          money
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
        <Row
          label="Chat rate per reply"
          money
          hint={
            voice.defaultChatRateMicroUsdPerTurn === null
              ? "Override for this business only. Empty = the platform default, which is not set yet; AI replies bill at $0 until one exists (Platform tab on the fleet page)."
              : `Override for this business only. Empty = the platform default, currently $${(voice.defaultChatRateMicroUsdPerTurn / 1_000_000).toFixed(3)}/reply. Only replies the agent actually sends are billed.`
          }
          current={
            voice.chatRateMicroUsdPerTurn === null
              ? undefined
              : String(voice.chatRateMicroUsdPerTurn / 1_000_000)
          }
          placeholder={
            voice.defaultChatRateMicroUsdPerTurn === null
              ? undefined
              : String(voice.defaultChatRateMicroUsdPerTurn / 1_000_000)
          }
          onSave={(value) => {
            const parsed = Number(value.replace(",", "."));
            return setChatRate({
              orgId,
              rateMicroUsdPerTurn:
                !value.trim() || Number.isNaN(parsed)
                  ? null
                  : Math.round(parsed * 1_000_000),
            });
          }}
        />
        <PercentRow
          label="WhatsApp markup"
          hint={
            voice.defaultWaMarkupPercent === null
              ? "Override for this business only, on top of Meta's per-message rate for template sends. Empty = the platform default, currently pass-through (0%)."
              : `Override for this business only, on top of Meta's per-message rate for template sends. Empty = the platform default, currently ${voice.defaultWaMarkupPercent}%. An explicit 0 makes this business pass-through.`
          }
          current={
            voice.waMarkupPercent === null ? "" : String(voice.waMarkupPercent)
          }
          placeholder={
            voice.defaultWaMarkupPercent === null
              ? undefined
              : String(voice.defaultWaMarkupPercent)
          }
          onSave={(value) => {
            const parsed = Number(value.replace(",", "."));
            return setWaMarkup({
              orgId,
              markupPercent:
                !value.trim() || Number.isNaN(parsed) ? null : parsed,
            });
          }}
        />
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">Billing mode</div>
            <InfoTip text="Invoice: meter only, settle outside the product. Prepaid: Stripe wallet, an empty balance declines new calls at ring time." />
          </div>
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
          </div>
        </div>
        {assistant && (
          <Row
            label="Chat agent budget"
            money
            hint="Hard cap for this org's LLM spend per month. Empty = the platform default. The turn that would cross it is skipped and visible in the Flight recorder on the Chat agent tab."
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
        )}
      </Section>
      </>
        );
      })()}

      {(tab === "members" || search.active) && (
        <MembersCard
          orgId={orgId}
          members={detail.members}
          pendingInvites={detail.pendingInvites}
        />
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
          hint="Empty = the platform token (fleet page, WhatsApp section) authenticates this number. Paste one only when this business runs its own Meta app."
          masked={detail.wa?.accessToken}
          onSave={(value) => wa({ accessToken: value })}
          onClear={() => wa({ accessToken: null })}
          clearLabel="Use platform token"
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
          {/* The explainer rides an (i) like every other row (Serdar,
              2026-08-26) — inline it was a paragraph of prose sitting where
              every other row keeps a value. */}
          <div className="flex items-center gap-2 text-sm font-medium">
            Webhook URL
            <InfoTip text="No token yet, so this endpoint refuses every call. Generate one and paste the URL into Evolution's webhook settings." />
          </div>
          <div className="min-w-0 space-y-1.5 text-xs text-[var(--muted)]">
            {detail.evolutionWebhookToken && (
              <CopyId
                value={`/whatsapp/evolution?token=${detail.evolutionWebhookToken}`}
              />
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

      {/* No Email card here (Serdar, 2026-08-20). Both of its fields are the
          salon's own settings (BusinessView: inbound address, custom From),
          and the address auto-assigns when missing — this page's header rule
          applies: a field on both screens is a bug in one of them. The
          setOrgConfig args survive for the CLI. */}

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
            {/* The second button, on the same line (Serdar, 2026-08-26). It
                only shows while the delete form is CLOSED — open, it becomes
                the block below, because a name field and a disclosure do not
                belong in a row of buttons. A REAL button, no ellipsis
                (Serdar, same day): ghost text beside a bordered button read
                as a caption, and the "…" promised a dialog when what opens
                is a form right here. */}
            {!deleteOpen && (
              <button
                type="button"
                onClick={() => {
                  setDeleteOpen(true);
                  setDeleteName("");
                  setDeleteError(null);
                }}
                className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted-strong)] transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:hover:border-red-900 dark:hover:bg-red-950/30 dark:hover:text-red-400"
              >
                Delete account
              </button>
            )}
          </div>

          {/* Beside suspension now, no rule between them (Serdar,
              2026-08-26). The divider was making a two-button card look like
              two sections, and one horizontal rule under a single button is a
              lot of furniture for "and here is the other one". The SLOWNESS
              is what keeps this safe, not the distance: a disclosure, then
              the name typed out, then a button that stays dead until the two
              match. None of that moved. */}
          {deleteOpen && (
            <div className="pt-1">
              <div className="space-y-2">
                <p className="text-xs text-[var(--muted-strong)]">
                  Deletes every customer, message, call, appointment and file
                  this business has, and removes its Retell agent. Its phone
                  number is unbound, not released, so you can hand it to
                  somebody else. There is no undo. Type{" "}
                  <span className="font-medium text-[var(--foreground)]">
                    {detail.name || "the business name"}
                  </span>{" "}
                  to confirm.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={deleteName}
                    onChange={(e) => setDeleteName(e.target.value)}
                    placeholder={detail.name}
                    className="w-56 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    disabled={deleting || deleteName.trim() !== detail.name.trim()}
                    onClick={() => {
                      setDeleting(true);
                      // force only on the SECOND press, and only after the
                      // first one came back with provider failures — that is
                      // what deleteError holds.
                      void deleteOrg({
                        orgId,
                        confirmName: deleteName.trim(),
                        ...(deleteError ? { force: true } : {}),
                      })
                        .then(() => router.push("/admin"))
                        .catch((err: unknown) => {
                          setDeleting(false);
                          setDeleteError(
                            err instanceof Error ? err.message : String(err),
                          );
                        });
                    }}
                    className="rounded-lg border border-red-500/40 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:pointer-events-none disabled:opacity-40 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
                  >
                    {deleting
                      ? "Deleting…"
                      : deleteError
                        ? "Delete anyway"
                        : "Delete account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteOpen(false)}
                    className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                  >
                    Cancel
                  </button>
                </div>
                {deleteError && (
                  <p className="text-xs text-red-700 dark:text-red-400">
                    {deleteError.includes("retell-teardown-failed")
                      ? `Retell teardown did not finish: ${deleteError.replace(/^.*retell-teardown-failed:\s*/, "")} — deleting now leaves that behind.`
                      : deleteError}
                  </p>
                )}
              </div>
            </div>
          )}
        </Section>
      )}
    </Plane>
    </AdminSearchProvider>
  );
}
