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
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import {
  ago,
  AdminSearchProvider,
  Count,
  KeyModelRow,
  Plane,
  Row,
  Section,
  SecretRow,
  Setup,
  TabStrip,
} from "./parts";
import { SearchInput } from "@/components/DataTable";
import { useSearch } from "@/lib/useTableState";

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
  // The model pickers' option source: each provider's own /v1/models, read
  // with the platform key, fetched lazily on first focus (see ModelRow).
  const listModels = useAction(api.platformConfig.listModels);
  // Two rooms, not one scroll: the tenant list is what the operator opens
  // this page FOR, and deployment settings are visited a handful of times
  // ever. Living below the table meant the settings had no address and the
  // table had a basement. Same pill pattern as the org detail page.
  const [tab, setTab] = useState<"businesses" | "platform">("businesses");
  // One box, two jobs, decided by the tab under it: on Businesses it narrows
  // the table, on Platform it narrows the settings rows. The salon app's own
  // search box, so the console does not invent a second one.
  const search = useSearch();
  const router = useRouter();

  // Loading wears the plane too. Bare, the page painted flat white for as long
  // as the query took and then washed over — a flash of a different app.
  if (allowed === undefined) {
    return <Plane><p className="text-sm text-[var(--muted)]">Loading…</p></Plane>;
  }
  // 404, not "you may not". Explaining the refusal told a salon owner that an
  // operator console exists and invited them to ask for a login to it; the
  // honest answer to someone who is not an operator is that this address is
  // not a page. Same reason a private repo 404s rather than 403s.
  if (!allowed) notFound();
  if (fleet === undefined) {
    return <Plane><p className="text-sm text-[var(--muted)]">Loading…</p></Plane>;
  }

  // Name and timezone: the two things an operator actually has in their head
  // when they come looking for one salon out of the list.
  const shownFleet = fleet.filter((org) => search.matches(org.name, org.timezone));

  return (
    <Plane>
      <header className="mb-4 flex items-center justify-between gap-3">
        {/* page-title, like every header in the salon app: one variable owns
            what a page heading looks like in both themes. */}
        <h1 className="page-title text-lg font-semibold">Resepta admin</h1>
        {/* The org count and sort order used to sit here. Both were facts the
            table states by being a table, and they were holding the only spot
            on the page where a control can go. Same box as the salon app's
            header search, so the console does not invent a second one. */}
        <SearchInput
          value={search.query}
          onChange={search.setQuery}
          placeholder={tab === "businesses" ? "Search businesses" : "Search settings"}
        />
      </header>

      <div className="mb-4">
        <TabStrip
          tabs={[
            { id: "businesses" as const, label: "Businesses" },
            { id: "platform" as const, label: "Platform" },
          ]}
          active={tab}
          onSelect={setTab}
        />
      </div>

      {/* One line for the whole deployment. Email is operator plumbing that
          arrives for every org at once, so a missing key is one fact stated
          once — not a column that would say the same thing on every row. */}
      {/* Same amber treatment as OperatorBanner: a tint plus an inset ring,
          never a fill with a border on top of it. One edge per surface, and on
          a washed plane a filled amber slab is the loudest thing on screen for
          a fact that is one sentence long. */}
      {deployment && !deployment.emailLane && (
        <p className="mb-4 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
          No email lane on this deployment, so nothing sends by email for any
          org: reminders, invites and your own failure alerts included.{" "}
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


      {tab === "businesses" && (shownFleet.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          {fleet.length === 0
            ? "No orgs on this deployment yet."
            : "No business matches that."}
        </p>
      ) : (
        // A card like every other card: no border, --card-shadow, rounded-lg.
        // overflow-hidden is not tidying — a table's square corners paint
        // straight over a rounded card's, and the sideways scroll has to live
        // on an inner box so the clip survives it.
        //
        // Rules stay FULL-BLEED here. The inset gutter the salon app's
        // Customers table uses is for four short columns; this is nine you
        // track across to the last cell, which makes each rule a reading rail.
        // Same language, opposite call, decided by column count.
        <div className="overflow-hidden rounded-lg bg-[var(--card)] shadow-[var(--card-shadow)]">
          <div className="thin-scroll overflow-x-auto overscroll-x-contain">
          <table className="w-full text-sm">
            {/* No fill behind the header. Weight and one rule separate it, and
                the rule is drawn on thead globally so a wrapped header still
                gets one continuous line. font-semibold is the compensation for
                the fill being gone, not taste. pt-3.5 pb-2 because a column
                name flush against the card's top edge reads as clipped. */}
            <thead className="text-left text-xs">
              <tr>
                <th className="px-3 pb-2 pt-3.5 font-semibold">Business</th>
                <th className="px-3 pb-2 pt-3.5 font-semibold">Setup</th>
                <th className="px-3 pb-2 pt-3.5 font-semibold" title="Failed sends, last 24h">
                  Failed
                </th>
                <th
                  className="px-3 pb-2 pt-3.5 font-semibold"
                  title="Retries exhausted, so nothing will pick these up"
                >
                  Gave up
                </th>
                <th className="px-3 pb-2 pt-3.5 font-semibold" title="Waiting on a retry">
                  Retrying
                </th>
                <th
                  className="px-3 pb-2 pt-3.5 font-semibold"
                  title="Claimed for sending and never reported back"
                >
                  Stuck
                </th>
                <th className="px-3 pb-2 pt-3.5 font-semibold">Upcoming</th>
                <th
                  className="px-3 pb-2 pt-3.5 font-semibold"
                  title="This month's metered voice usage: what we bill them, and what Retell charges us"
                >
                  Calls MTD
                </th>
                <th className="px-3 pb-2 pt-3.5 font-semibold">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {shownFleet.map((org) => (
                // A row opens the tenant's own page. This used to expand in
                // place, which was fine for a failure list and stopped being
                // fine once the row had to hold every credential the salon
                // owns. The name is a real link as well as the row being
                // clickable, so middle-click and keyboard both work.
                <tr
                  key={org.orgId}
                  onClick={() => router.push(`/admin/${org.orgId}`)}
                  className="cursor-pointer border-t border-[var(--table-divider)] hover:bg-[var(--row-hover-bg)]"
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
        </div>
      ))}

      {/* Deployment settings. One Resend account and one AI key serve every
          salon — configured here rather than per tenant, and rather than in
          an env var only a terminal can reach. Per-org overrides live on each
          business's own Setup tab. */}
      {tab === "platform" && mail && (
        <AdminSearchProvider search={search}>
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
              onSave={(value) => setConfig({ key: "resendInboundDomain", value })}
            />
            <SecretRow
              label="Inbound webhook secret"
              hint="Signs Resend's email.received calls. Only needed for replies landing in the Inbox."
              masked={mail.webhookSecret}
              onSave={(value) => setConfig({ key: "resendWebhookSecret", value })}
            />
            {/* Product name has no row here any more (Serdar, 2026-08-20):
                the name is settled, and a rename field on a settings page
                invites the one edit nobody should make casually. The
                productName key survives for platformConfig:setFromCli should
                the product ever actually rename. */}
          </Section>

          {/* The two agent keys, same doctrine split (docs/chat-agent.md):
              the LLM key is shared BY INTENT and resolved at call time — one
              paste here turns every org's chat agent on. The Retell default
              is a STAMP source: it is copied into each new org's own
              connections row at auto-provision time, so editing it here
              changes future orgs only, never running ones. Retell leads the
              section (Serdar, 2026-08-19): it is the key the operator
              actually comes here for, and it was hiding at the bottom. */}
          <Section
            title="AI & Voice defaults"
            description="Platform keys for the chat agent and phone-agent auto-provisioning. Per-org overrides live on each business's Setup tab and always win."
          >
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
            {/* Which dialect every org's chat agent speaks by default. The
                key rows below both stay settable — switching provider is one
                click, not a re-paste. Whether the active provider has a key
                is readable off its own row (an empty field IS the answer);
                the status line that used to repeat it here is gone. */}
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
              </div>
            </div>
            <KeyModelRow
              label="Anthropic (Claude)"
              hint={`${
                mail.fromEnv.anthropicApiKey
                  ? "The key currently comes from the ANTHROPIC_API_KEY env var; saving here overrides it."
                  : mail.chatAgentProvider === "anthropic"
                    ? "The active key: powers every org's chat agent unless the org has its own."
                    : "Kept for when the provider switches back; inactive while OpenAI is selected."
              } The model beside it is what every org runs on this provider — pick from what the key can reach or type any name; blank = claude-sonnet-5. A model lib/llm.ts has not priced meters at $0 until its row is added.`}
              masked={mail.anthropicApiKey}
              onSaveKey={(value) => setConfig({ key: "anthropicApiKey", value })}
              model={mail.anthropicModel}
              modelPlaceholder="claude-sonnet-5"
              loadOptions={() => listModels({ provider: "anthropic" })}
              onSaveModel={(value) => setConfig({ key: "anthropicModel", value })}
            />
            <KeyModelRow
              label="OpenAI (GPT)"
              hint={`${
                mail.fromEnv.openaiApiKey
                  ? "The key currently comes from the OPENAI_API_KEY env var; saving here overrides it."
                  : mail.chatAgentProvider === "openai"
                    ? "The active key: powers every org's chat agent unless the org has its own."
                    : "Kept for when the provider switches; inactive while Anthropic is selected."
              } The model beside it is what every org runs on this provider — pick from what the key can reach or type any name; blank = gpt-5.2. A model lib/llm.ts has not priced meters at $0 until its row is added.`}
              masked={mail.openaiApiKey}
              onSaveKey={(value) => setConfig({ key: "openaiApiKey", value })}
              model={mail.openaiModel}
              modelPlaceholder="gpt-5.2"
              loadOptions={() => listModels({ provider: "openai" })}
              onSaveModel={(value) => setConfig({ key: "openaiModel", value })}
            />
          </Section>

          {/* The Tech Provider shape (lib/platformConfig resolveWaAccount):
              one Meta system-user token for every hosted number, so wiring a
              business is just its phone number id and WABA id on the Setup
              tab. A business with its own Meta app pastes its own token
              there, which always wins over this one. */}
          <Section
            title="WhatsApp (Meta Cloud API)"
            description="The platform's Meta access token. Every business without a token of its own sends and receives through this one."
          >
            <SecretRow
              label="Access token"
              hint={
                mail.fromEnv.whatsappAccessToken
                  ? "Currently coming from the WHATSAPP_ACCESS_TOKEN env var. Saving here overrides it. Rotating it re-keys every hosted business at once."
                  : "A system-user token from the platform's Meta Business portfolio. Rotating it re-keys every hosted business at once; businesses with their own token are untouched."
              }
              masked={mail.whatsappAccessToken}
              onSave={(value) => setConfig({ key: "whatsappAccessToken", value })}
            />
          </Section>

          {/* The Resend doctrine once more: one Stripe account for the whole
              deployment, because the platform sells the credit and Stripe
              pays the platform whichever org the money lands on. */}
          <Section
            title="Billing"
            description={`What businesses pay, and the platform's Stripe account for prepaid wallet top-ups. In Stripe, add a webhook endpoint pointing at ${
              (process.env.NEXT_PUBLIC_CONVEX_URL ?? "<convex-url>").replace(
                ".convex.cloud",
                ".convex.site",
              )
            }/stripe/webhook with the checkout.session.completed event, and paste its signing secret below. Businesses on invoice mode never touch the Stripe half.`}
          >
            <Row
              label="Voice rate (USD per minute)"
              hint="What every business pays per called minute, billed per second. Set once here; a business's own Usage tab can override it. Changes only price calls from now on; history keeps its stamped rate."
              current={
                mail.voiceRateMicroUsdPerMinute === null
                  ? undefined
                  : String(mail.voiceRateMicroUsdPerMinute / 1_000_000)
              }
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
            <SecretRow
              label="Secret key"
              hint={
                mail.fromEnv.stripeSecretKey
                  ? "Currently coming from the STRIPE_SECRET_KEY env var. Saving here overrides it."
                  : "The sk_live or sk_test key. Creates Checkout sessions when an owner tops up; the card itself never touches this product."
              }
              masked={mail.stripeSecretKey}
              onSave={(value) => setConfig({ key: "stripeSecretKey", value })}
            />
            <SecretRow
              label="Webhook signing secret"
              hint={
                mail.fromEnv.stripeWebhookSecret
                  ? "Currently coming from the STRIPE_WEBHOOK_SECRET env var. Saving here overrides it."
                  : "The whsec value from the webhook endpoint above. Without it, payments succeed on Stripe but no balance is ever credited."
              }
              masked={mail.stripeWebhookSecret}
              onSave={(value) => setConfig({ key: "stripeWebhookSecret", value })}
            />
          </Section>

          {/* Its own card at the very bottom (Serdar, 2026-08-19): an
              emergency brake sitting between ordinary key rows read as one
              more setting, and the one time it matters is the one time it
              must not be hunted for. */}
          <Section
            title="Kill switch"
            description="Stops every org's chat agent before the model runs. Immediate, platform-wide, reversible. Also visible on each business's Assistant tab."
          >
            <div className="py-2.5">
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
                  ? "Every agent is stopped. Click to re-enable"
                  : "Stop every org's chat agent"}
              </button>
            </div>
          </Section>

          {/* A footer, not a header (Serdar, 2026-08-20): who the operators
              are is reference material, not the page's opening line. Printed
              at all because the answer otherwise lives in an env var only a
              terminal can read. No add button on purpose: the allowlist
              being out of the app's reach is what makes it safe. See
              convex/lib/platformAuth.ts. */}
          {deployment && deployment.platformAdmins.length > 0 && (
            <p className="pt-2 text-xs text-[var(--muted)]">
              Platform admins: {deployment.platformAdmins.join(" · ")}
              <span className="ml-2 opacity-70">
                (set with{" "}
                <code className="font-mono">npx convex env set PLATFORM_ADMIN_EMAILS</code>)
              </span>
            </p>
          )}
        </div>
        </AdminSearchProvider>
      )}
    </Plane>
  );
}
