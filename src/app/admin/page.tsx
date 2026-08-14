"use client";

// The operator's fleet view. NOT a salon-facing surface.
//
// Resepta is one Convex deployment serving every org, so this can be a route
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

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { ago, Count, Row, Section, SecretRow, Setup } from "./parts";
import { InfoTip } from "@/components/InfoTip";

export default function AdminPage() {
  // Asked FIRST, and fleet is skipped until it comes back true. platform.fleet
  // throws for anyone not on the allowlist, and a thrown query surfaces as an
  // error boundary rather than a value — so a salon owner who guessed the URL
  // would get a crash instead of an answer. This turns that into a sentence.
  const allowed = useQuery(api.platform.amPlatformAdmin, {});
  const fleet = useQuery(api.platform.fleet, allowed ? {} : "skip");
  const deployment = useQuery(api.platform.deploymentHealth, allowed ? {} : "skip");
  const mail = useQuery(api.platformConfig.status, allowed ? {} : "skip");
  const setConfig = useMutation(api.platformConfig.set);
  // Two rooms, not one scroll: the tenant list is what the operator opens
  // this page FOR, and deployment settings are visited a handful of times
  // ever. Living below the table meant the settings had no address and the
  // table had a basement. Same pill pattern as the org detail page.
  const [tab, setTab] = useState<"businesses" | "platform">("businesses");
  const router = useRouter();

  if (allowed === undefined) {
    return (
      <main className="mx-auto max-w-6xl p-6 text-sm text-[var(--muted)]">Loading…</main>
    );
  }
  // 404, not "you may not". Explaining the refusal told a salon owner that an
  // operator console exists and invited them to ask for a login to it; the
  // honest answer to someone who is not an operator is that this address is
  // not a page. Same reason a private repo 404s rather than 403s.
  if (!allowed) notFound();
  if (fleet === undefined) {
    return (
      <main className="mx-auto max-w-6xl p-6 text-sm text-[var(--muted)]">Loading…</main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Resepta admin</h1>
        {tab === "businesses" && (
          <p className="text-xs text-[var(--muted)]">
            {fleet.length} {fleet.length === 1 ? "org" : "orgs"} · noisiest first
          </p>
        )}
      </header>

      <div className="mb-4 flex gap-1">
        {(
          [
            { id: "businesses" as const, label: "Businesses" },
            { id: "platform" as const, label: "Platform" },
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

      {/* One line for the whole deployment. Email is operator plumbing that
          arrives for every org at once, so a missing key is one fact stated
          once — not a column that would say the same thing on every row. */}
      {deployment && !deployment.emailLane && (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          No email lane on this deployment, so nothing sends by email for any
          org — reminders, invites and your own failure alerts included.{" "}
          {tab !== "platform" && (
            <button
              type="button"
              onClick={() => setTab("platform")}
              className="font-medium underline hover:no-underline"
            >
              Set the Resend key →
            </button>
          )}
        </p>
      )}


      {tab === "businesses" && (fleet.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No orgs on this deployment yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--table-header-bg)] text-left text-xs text-[var(--muted-strong)]">
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
                <th
                  className="px-3 py-2 font-medium"
                  title="This month's metered voice usage: what we bill them, and what Retell charges us"
                >
                  Calls MTD
                </th>
                <th className="px-3 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((org) => (
                // A row opens the tenant's own page. This used to expand in
                // place, which was fine for a failure list and stopped being
                // fine once the row had to hold every credential the salon
                // owns. The name is a real link as well as the row being
                // clickable, so middle-click and keyboard both work.
                <tr
                  key={org.orgId}
                  onClick={() => router.push(`/admin/${org.orgId}`)}
                  className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--row-hover-bg)]"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/${org.orgId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium hover:underline"
                    >
                      {org.name}
                    </Link>
                    <div className="text-xs text-[var(--muted)]">
                      {org.members} {org.members === 1 ? "member" : "members"} · {org.timezone}
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
                  <td className="px-3 py-2 tabular-nums text-[var(--muted-strong)]">
                    {org.upcomingAppointments}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {org.voiceSecondsMtd === 0 && org.voiceCostMicroUsdMtd === 0 ? (
                      <span className="text-[var(--muted)]">—</span>
                    ) : (
                      <>
                        <div>${(org.voiceBilledMicroUsdMtd / 1_000_000).toFixed(2)}</div>
                        <div className="text-xs text-[var(--muted)]">
                          {Math.round(org.voiceSecondsMtd / 60)} min · Retell $
                          {(org.voiceCostMicroUsdMtd / 1_000_000).toFixed(2)}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[var(--muted-strong)]">
                    {ago(org.lastActivityAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Deployment settings. One Resend account and one AI key serve every
          salon — configured here rather than per tenant, and rather than in
          an env var only a terminal can reach. Per-org overrides live on each
          business's own Setup tab. */}
      {tab === "platform" && deployment && deployment.platformAdmins.length > 0 && (
        <p className="mb-4 text-xs text-[var(--muted)]">
          {/* Printed because the answer otherwise lives in an env var only a
              terminal can read — and the question ("which address is the
              operator?") comes up while looking at this page. No add button
              on purpose: the allowlist being out of the app's reach is what
              makes it safe. See convex/lib/platformAuth.ts. */}
          Platform admins: {deployment.platformAdmins.join(" · ")}
          <span className="ml-2 opacity-70">
            — set with{" "}
            <code className="font-mono">npx convex env set PLATFORM_ADMIN_EMAILS</code>
          </span>
        </p>
      )}
      {tab === "platform" && mail && (
        <div className="space-y-4">
          <Section
            title="Email (Resend)"
            description="One account and one verified domain for the whole deployment. Every salon sends from it unless they set a domain of their own."
          >
            <SecretRow
              label="API key"
              hint={
                mail.fromEnv.apiKey
                  ? "Currently coming from the RESEND_API_KEY env var. Saving here overrides it."
                  : undefined
              }
              masked={mail.apiKey}
              onSave={(value) => setConfig({ key: "resendApiKey", value })}
            />
            <Row
              label="Sending domain"
              hint="Verified in Resend. Carries every org's incoming address and the noreply sender."
              current={mail.domain}
              placeholder="mail.example.com"
              onSave={(value) => setConfig({ key: "resendInboundDomain", value })}
            />
            <SecretRow
              label="Inbound webhook secret"
              hint="Signs Resend's email.received calls. Only needed for replies landing in the Inbox."
              masked={mail.webhookSecret}
              onSave={(value) => setConfig({ key: "resendWebhookSecret", value })}
            />
            <Row
              label="Product name"
              hint="How invites and alerts sign themselves. Not what customers see — salon mail carries the salon's name."
              current={mail.productName}
              placeholder="Resepta"
              onSave={(value) => setConfig({ key: "productName", value })}
            />
          </Section>

          {/* The two agent keys, same doctrine split (docs/chat-agent.md):
              the LLM key is shared BY INTENT and resolved at call time — one
              paste here turns every org's chat agent on. The Retell default
              is a STAMP source: it is copied into each new org's own
              connections row at auto-provision time, so editing it here
              changes future orgs only, never running ones. */}
          <Section
            title="AI & Voice defaults"
            description="Platform keys for the chat agent and phone-agent auto-provisioning. Per-org overrides live on each business's Setup tab and always win."
          >
            {/* Which dialect every org's chat agent speaks by default. The
                key rows below both stay settable — switching provider is one
                click, not a re-paste — and the active one is marked so a
                pill flipped without its key configured is visible here, not
                discovered in the flight recorder. */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
              <div className="text-sm font-medium">Chat agent provider</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(["anthropic", "openai"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() =>
                      void setConfig({ key: "chatAgentProvider", value: option })
                    }
                    className={`rounded-full px-3 py-1 text-sm transition-colors ${
                      mail.chatAgentProvider === option
                        ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {option === "anthropic" ? "Anthropic (Claude)" : "OpenAI (GPT)"}
                  </button>
                ))}
                <span className="text-xs text-[var(--muted)]">
                  {mail.chatAgentProvider === "openai"
                    ? mail.openaiApiKey
                      ? "using the OpenAI key below"
                      : "⚠ no OpenAI key set — every turn will skip"
                    : mail.anthropicApiKey
                      ? "using the Anthropic key below"
                      : "⚠ no Anthropic key set — every turn will skip"}
                </span>
              </div>
            </div>
            <SecretRow
              label="Anthropic API key"
              hint={
                mail.fromEnv.anthropicApiKey
                  ? "Currently coming from the ANTHROPIC_API_KEY env var. Saving here overrides it."
                  : mail.chatAgentProvider === "anthropic"
                    ? "The active key: powers every org's chat agent unless the org has its own."
                    : "Kept for when the provider switches back; inactive while OpenAI is selected."
              }
              masked={mail.anthropicApiKey}
              onSave={(value) => setConfig({ key: "anthropicApiKey", value })}
            />
            <SecretRow
              label="OpenAI API key"
              hint={
                mail.fromEnv.openaiApiKey
                  ? "Currently coming from the OPENAI_API_KEY env var. Saving here overrides it."
                  : mail.chatAgentProvider === "openai"
                    ? "The active key: powers every org's chat agent unless the org has its own."
                    : "Kept for when the provider switches; inactive while Anthropic is selected."
              }
              masked={mail.openaiApiKey}
              onSave={(value) => setConfig({ key: "openaiApiKey", value })}
            />
            <Row
              label="Voice rate (USD per minute)"
              hint="What every business pays per called minute, billed per second. Set once here; a business's own Usage tab can override it. Changes only price calls from now on; history keeps its stamped rate."
              current={
                mail.voiceRateMicroUsdPerMinute === null
                  ? undefined
                  : String(mail.voiceRateMicroUsdPerMinute / 1_000_000)
              }
              placeholder="0.30"
              onSave={(value) => {
                const parsed = Number(value.replace(",", "."));
                return setConfig({
                  key: "voiceRateMicroUsdPerMinute",
                  value:
                    !value.trim() || Number.isNaN(parsed)
                      ? ""
                      : String(Math.max(0, Math.round(parsed * 1_000_000))),
                });
              }}
            />
            <Row
              label="Model override"
              hint="Optional exact model name for the selected provider (defaults: claude-sonnet-5 / gpt-5.2). Applies only while an org resolves to the platform provider. Unknown names fail visibly in the flight recorder and meter at $0 until priced in lib/llm.ts."
              current={mail.chatAgentModel ?? undefined}
              placeholder={
                mail.chatAgentProvider === "openai" ? "gpt-5.2" : "claude-sonnet-5"
              }
              onSave={(value) => setConfig({ key: "chatAgentModel", value })}
            />
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">Kill switch</div>
                <InfoTip text="Immediate, platform-wide, reversible. Also visible on each business's Assistant tab." />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void setConfig({
                      key: "chatAgentDisabled",
                      value: mail.chatAgentDisabled ? "" : "true",
                    })
                  }
                  className={`rounded-lg px-2 py-1 text-xs ${
                    mail.chatAgentDisabled
                      ? "bg-amber-50 font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                      : "text-[var(--muted)] hover:bg-[var(--muted-bg)]"
                  }`}
                >
                  {mail.chatAgentDisabled
                    ? "Every agent is stopped — click to re-enable"
                    : "Stop every org&apos;s chat agent"}
                </button>
              </div>
            </div>
            <SecretRow
              label="Retell default key"
              hint={
                mail.fromEnv.retellApiKey
                  ? "Currently coming from the RETELL_API_KEY env var. Saving here overrides it. Stamped into each NEW org at auto-provisioning; existing orgs keep the key on their row."
                  : "Stamped into each NEW org's own connections row at auto-provisioning. Existing orgs keep the key on their row. Must be the workspace's webhook signing key."
              }
              masked={mail.retellApiKey}
              onSave={(value) => setConfig({ key: "retellApiKey", value })}
            />
          </Section>
        </div>
      )}
    </main>
  );
}
