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

import { useEffect, useState } from "react";
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
  Errors,
  PercentRow,
  Row,
  Section,
  SecretRow,
  TabStrip,
} from "./parts";
import { OnboardingTab } from "./onboarding";
import { TemplatesTab } from "./templates";
import { InfoTip } from "@/components/InfoTip";
import { SearchableSelect } from "@/components/SearchableSelect";
import { SearchInput } from "@/components/DataTable";
import {
  decodeEngine,
  encodeEngine,
  engineLabel,
  formatVoicePrice,
  voiceEngineChoices,
} from "../../../convex/lib/voiceModels";
import {
  VOICE_AGENT_HIGH_PRIORITY,
  VOICE_AGENT_MODEL,
} from "../../../convex/lib/voiceAgentTemplate";
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
  const actAs = useMutation(api.platform.actAs);
  // The model pickers' option source: each provider's own /v1/models, read
  // with the platform key, fetched lazily on first focus (see ModelRow).
  const listModels = useAction(api.platformConfig.listModels);
  // Two rooms, not one scroll: the tenant list is what the operator opens
  // this page FOR, and deployment settings are visited a handful of times
  // ever. Living below the table meant the settings had no address and the
  // table had a basement. Same pill pattern as the org detail page.
  //
  // The tab rides the URL (Serdar, 2026-08-28: refresh must not dump him
  // back on Businesses). Read once on mount, written with replaceState —
  // not useSearchParams, which would demand a Suspense boundary around the
  // whole page for one string.
  const [tab, setTabState] = useState<
    "businesses" | "onboarding" | "templates" | "platform"
  >("businesses");
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("tab");
    if (
      raw === "onboarding" ||
      raw === "templates" ||
      raw === "platform"
    ) {
      setTabState(raw);
    }
  }, []);
  const setTab = (next: typeof tab) => {
    setTabState(next);
    window.history.replaceState(
      null,
      "",
      next === "businesses" ? "/admin" : `/admin?tab=${next}`,
    );
  };
  // One box, three jobs, decided by the tab under it: on Businesses it narrows
  // the table, on Onboarding the vertical list, on Platform the settings rows.
  // The salon app's own search box, so the console does not invent a second.
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
          placeholder={
            tab === "businesses" || tab === "templates"
              ? "Search businesses"
              : tab === "onboarding"
                ? "Search verticals"
                : "Search settings"
          }
        />
      </header>

      <div className="mb-4">
        <TabStrip
          tabs={[
            { id: "businesses" as const, label: "Businesses" },
            // Between the fleet and the deployment plumbing, which is where it
            // belongs: a vertical is neither one business nor a provider key.
            { id: "onboarding" as const, label: "Onboarding" },
            // Fleet-level by design (2026-08-27): one wording for everyone is
            // what keeps approval per WABA, so the desk that edits it and
            // reads the fleet's approval state is not a per-client page.
            { id: "templates" as const, label: "Templates" },
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


      {/* The verticals a business can pick during onboarding, and what each
          one seeds. Not a per-org surface and not deployment plumbing — see
          the header in ./onboarding for why editing here is an override on
          top of the code module rather than a move into the database. */}
      {tab === "onboarding" && <OnboardingTab search={search} />}
      {tab === "templates" && <TemplatesTab search={search} />}

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
                {/* No w-full here, and that is a correction rather than an
                    omission. Handing this column the slack is the rule for a
                    table that OUTGROWS its card — one flexible column plus
                    nowrap everywhere else is what stops a horizontal
                    scrollbar. This table has never outgrown anything; nine
                    narrow columns fit with room to spare. So the rule bought
                    nothing and cost the obvious thing: the spare width all
                    landed in one place, and a fleet of one business drew
                    "Barberio" across half the card with the counts huddled at
                    the far edge. Auto layout spreads it instead, which is what
                    this table always did and what nobody complained about. The
                    button that made it look crowded is a w-px cell now, which
                    was the actual fault. */}
                <th className="px-3 pb-2 pt-3.5 font-semibold">Business</th>
                <th
                  className="whitespace-nowrap px-3 pb-2 pt-3.5 font-semibold"
                  title="People who can sign in"
                >
                  Members
                </th>
                {/* One header row. The period lives in the title rather than
                    under the name — this table has one reader and he knows
                    what it counts, and a second line under four of nine
                    columns cost every row its height to tell him. */}
                <th
                  className="whitespace-nowrap px-3 pb-2 pt-3.5 font-semibold"
                  title="Emails sent, all time"
                >
                  Email
                </th>
                <th
                  className="whitespace-nowrap px-3 pb-2 pt-3.5 font-semibold"
                  title="WhatsApp messages sent, all time: count, what we bill them for template sends, and what Meta charges us. Session replies and Evolution sends are free."
                >
                  WhatsApp
                </th>
                <th
                  className="whitespace-nowrap px-3 pb-2 pt-3.5 font-semibold"
                  title="Voice calls, all time: count, minutes, what we bill them, and what Retell charges us. The month-by-month breakdown is on the business's own page."
                >
                  Calls
                </th>
                <th
                  className="whitespace-nowrap px-3 pb-2 pt-3.5 font-semibold"
                  title="Appointments in the book from now on"
                >
                  Booked
                </th>
                {/* Four columns collapsed into one. They were four flavours of
                    "a message broke" — failed, dead-lettered, retrying, stuck — and
                    across a healthy fleet all four are empty, so they spent a
                    third of the table saying nothing. The cell stays blank
                    unless something is actually wrong, and then says which
                    kind, which is more than a bare number in a column headed
                    "Stuck" ever did. Sorting is unchanged: the query still
                    orders by dead letters, then failures, then stuck. */}
                <th
                  className="whitespace-nowrap px-3 pb-2 pt-3.5 font-semibold"
                  title="Sends that broke: refused in the last 24h, dead-lettered after retries, stuck mid-send, or backing off for another attempt"
                >
                  Errors
                </th>
                {/* One word and pushed to the wall: the age is the narrowest
                    fact on the row, and "Last activity" spent its width on
                    the label rather than the answer (Serdar, 2026-08-28). */}
                <th className="whitespace-nowrap px-3 pb-2 pt-3.5 text-right font-semibold">Activity</th>
                {/* No header word, and barely a column: w-px collapses it to
                    its content so the action cannot buy width from the data. */}
                <th className="w-px px-2 pb-2 pt-3.5" />
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
                  className="group cursor-pointer border-t border-[var(--table-divider)] hover:bg-[var(--row-hover-bg)]"
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
                      {org.timezone}
                      {org.calcomConnected ? " · cal.com" : ""}
                    </div>
                  </td>
                  {/* Members leaves the subtitle and becomes a column you can
                      read DOWN — the whole point of asking who uses this most.
                      It goes to the tab that can change it rather than the
                      business's front page. */}
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/${org.orgId}?tab=members`}
                      onClick={(e) => e.stopPropagation()}
                      className="tabular-nums text-[var(--muted-strong)] hover:underline"
                    >
                      {org.members}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Count value={org.emailSentTotal} tone="plain" />
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    <Count value={org.waSentTotal} tone="plain" />
                    {/* The Calls column's billed · cost line, for the lane
                        Meta charges. Only when money actually moved: most
                        sends are free session replies, and "$0.00 · Meta
                        $0.00" under every count would read as a broken
                        meter rather than a free lane. */}
                    {(org.waBilledMicroUsdTotal > 0 ||
                      org.waCostMicroUsdTotal > 0) && (
                      <div className="text-xs text-[var(--muted)]">
                        ${(org.waBilledMicroUsdTotal / 1_000_000).toFixed(2)} · Meta $
                        {(org.waCostMicroUsdTotal / 1_000_000).toFixed(2)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {org.voiceCallsTotal === 0 && org.voiceSecondsTotal === 0 ? (
                      <span className="text-[var(--muted)]">—</span>
                    ) : (
                      <>
                        <div className="font-medium">
                          {org.voiceCallsTotal}
                          <span className="ml-1.5 font-normal text-[var(--muted)]">
                            {Math.round(org.voiceSecondsTotal / 60)} min
                          </span>
                        </div>
                        <div className="text-xs text-[var(--muted)]">
                          ${(org.voiceBilledMicroUsdTotal / 1_000_000).toFixed(2)} · Retell $
                          {(org.voiceCostMicroUsdTotal / 1_000_000).toFixed(2)}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[var(--muted-strong)]">
                    {org.upcomingAppointments === 0 ? (
                      <span className="text-[var(--muted)]">—</span>
                    ) : (
                      org.upcomingAppointments
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Errors org={org} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--muted-strong)]">
                    {ago(org.lastActivityAt)}
                  </td>
                  {/* Into the client's OWN app, from the list. This existed
                      only on the business's page, so seeing a salon meant
                      opening its admin record first and then leaving it —
                      two navigations to look at a thing you could already
                      read the name of.

                      A GLYPH, and only on hover. It shipped as "Open app ↗"
                      in a column of its own and Serdar's read was that it ate
                      the table: ninety pixels of button, on every row, for an
                      action you take on one of them. Hover-revealed and icon
                      sized, it costs a column the width of the icon, and the
                      slot is held open at rest so nothing shifts under the
                      pointer when it appears. Touch has no hover, so there it
                      simply stays visible — the same bargain the inbox pin
                      dot makes.

                      A new tab because the fleet list is where you were and
                      where you are going back to. The blank tab is opened
                      SYNCHRONOUSLY, inside the click, and pointed at "/" once
                      the mutation lands: window.open after an await has lost
                      the user gesture and is a popup blocker's exact
                      definition of a popup. */}
                  <td className="w-px px-2 py-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const tab = window.open("", "_blank");
                        void actAs({ orgId: org.orgId })
                          .then(() => {
                            if (tab) tab.location.href = "/";
                            else router.push("/");
                          })
                          .catch(() => tab?.close());
                      }}
                      // Acting-as is a column on the OPERATOR's user row, not
                      // a per-tab thing, so opening a second business repoints
                      // the first tab too. Said here rather than engineered
                      // around: scoping it per tab means a second way to
                      // resolve which org a request belongs to, and this app
                      // has exactly one.
                      title="Open this business's own app in a new tab. Only one at a time — opening another repoints it."
                      aria-label="Open this business's own app in a new tab"
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-strong)] opacity-0 transition-opacity hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <path d="M15 3h6v6" />
                        <path d="M10 14 21 3" />
                      </svg>
                    </button>
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
            {/* The fleet's default voice ENGINE — model and tier as one
                choice, the phone-agent sibling of the chat rows below, and
                the value every per-agent picker calls "Platform default". It
                moves agents on their next publish or template sync, never by
                itself: a published agent keeps the engine it was published
                with until something republishes it.

                Two config rows behind one control. They are written together
                and always have been read together; splitting the control was
                what let an operator read a model's price without the tier
                that doubles it. */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">Voice agent engine</div>
                <InfoTip text="What every agent without its own Engine override runs. Applies to new agents and to existing ones on their next template sync or engine publish; it does not repoint already-published agents by itself. Per-agent pickers on each business page always win." />
              </div>
              <div>
                <SearchableSelect
                  value={
                    mail.voiceModel
                      ? encodeEngine(
                          mail.voiceModel,
                          mail.voiceHighPriority ?? VOICE_AGENT_HIGH_PRIORITY,
                        )
                      : ""
                  }
                  placeholder="Voice engine"
                  searchPlaceholder="Search models"
                  options={[
                    {
                      value: "",
                      label: `Resepta default — ${engineLabel(
                        VOICE_AGENT_MODEL,
                        VOICE_AGENT_HIGH_PRIORITY,
                      )}`,
                    },
                    ...voiceEngineChoices().map((choice) => ({
                      value: choice.value,
                      label: choice.label,
                      note: formatVoicePrice(choice.usdPerMinute),
                    })),
                  ]}
                  onChange={(next) => {
                    const picked = decodeEngine(next);
                    if (
                      (mail.voiceModel ?? "") === (picked?.id ?? "") &&
                      (mail.voiceHighPriority ?? null) === (picked ? picked.fast : null)
                    ) {
                      return;
                    }
                    // Sequential, not parallel: the model row is the one the
                    // per-agent pickers fall back to, so it lands first and a
                    // failure on the tier leaves a coherent fleet rather than
                    // a tier pointing at a model nobody selected.
                    void (async () => {
                      await setConfig({ key: "voiceModel", value: picked?.id ?? "" });
                      await setConfig({
                        key: "voiceHighPriority",
                        value: picked ? String(picked.fast) : "",
                      });
                    })();
                  }}
                />
              </div>
            </div>
            {/* Which dialect every org's chat agent speaks by default: the
                pill on the provider's own row, not a separate picker row
                (Serdar, 2026-08-27). Both key rows stay settable — switching
                provider is one click on the other row's pill, not a
                re-paste. */}
            <KeyModelRow
              label="Anthropic (Claude)"
              isDefault={mail.chatAgentProvider === "anthropic"}
              onMakeDefault={() =>
                setConfig({ key: "chatAgentProvider", value: "anthropic" })
              }
              hint={`${
                mail.fromEnv.anthropicApiKey
                  ? "The key currently comes from the ANTHROPIC_API_KEY env var; saving here overrides it."
                  : mail.chatAgentProvider === "anthropic"
                    ? "The active key: powers every org's chat agent unless the org has its own."
                    : "Kept for when the provider switches back; inactive while OpenAI is selected."
              } The model beside it is what every org runs on this provider — the list holds what the key can reach and lib/llm.ts can price; blank = claude-sonnet-5. A name typed outside the list that lib/llm.ts has not priced is refused, and every org's assistant skips its turns until the row is added.`}
              masked={mail.anthropicApiKey}
              onSaveKey={(value) => setConfig({ key: "anthropicApiKey", value })}
              model={mail.anthropicModel}
              modelPlaceholder="claude-sonnet-5"
              loadOptions={() => listModels({ provider: "anthropic" })}
              onSaveModel={(value) => setConfig({ key: "anthropicModel", value })}
            />
            <KeyModelRow
              label="OpenAI (GPT)"
              isDefault={mail.chatAgentProvider === "openai"}
              onMakeDefault={() =>
                setConfig({ key: "chatAgentProvider", value: "openai" })
              }
              hint={`${
                mail.fromEnv.openaiApiKey
                  ? "The key currently comes from the OPENAI_API_KEY env var; saving here overrides it."
                  : mail.chatAgentProvider === "openai"
                    ? "The active key: powers every org's chat agent unless the org has its own."
                    : "Kept for when the provider switches; inactive while Anthropic is selected."
              } The model beside it is what every org runs on this provider — the list holds what the key can reach and lib/llm.ts can price; blank = gpt-5.2. A name typed outside the list that lib/llm.ts has not priced is refused, and every org's assistant skips its turns until the row is added.`}
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
            {/* The mode a business is born into leads the section (Serdar,
                2026-08-27): it is the billing decision, the rate below only
                prices it. */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
              {/* The explanation rides the (i), the Row affordance exactly —
                  it sat inline after the pills and was the longest thing in
                  the row (Serdar, 2026-08-25). */}
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">Default billing mode</div>
                <InfoTip text="What a new business is born as. Stamped at sign-up; existing businesses keep their mode, overridable per business on its Voice agent tab." />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(["invoice", "prepaid"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() =>
                      void setConfig({
                        key: "defaultBillingMode",
                        // Invoice is what an absent row already means, so
                        // picking it clears the row rather than pinning it.
                        value: option === "prepaid" ? "prepaid" : "",
                      })
                    }
                    className={`rounded-full px-3 py-1 text-sm transition-colors ${
                      mail.defaultBillingMode === option
                        ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <Row
              label="Voice rate per minute"
              money
              hint="What every business pays per called minute, billed per second. Set once here; the Voice meter on a business's Voice agent tab can override it. Changes only price calls from now on; history keeps its stamped rate."
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
            <Row
              label="Chat rate per reply"
              money
              hint="What every business pays per AI chat reply the agent actually sends. Shadow, skipped and failed turns are never billed. Per-business override on the business's Billing settings; empty here and there = replies bill at $0 while the meter still counts them."
              current={
                mail.chatRateMicroUsdPerTurn === null
                  ? undefined
                  : String(mail.chatRateMicroUsdPerTurn / 1_000_000)
              }
              onSave={(value) => {
                const parsed = Number(value.replace(",", "."));
                return setConfig({
                  key: "chatRateMicroUsdPerTurn",
                  value:
                    !value.trim() || Number.isNaN(parsed)
                      ? ""
                      : String(Math.max(0, Math.round(parsed * 1_000_000))),
                });
              }}
            />
            <PercentRow
              label="WhatsApp markup"
              hint="Percent added on top of Meta's own per-message rate when a template send is billed to a business. Empty or 0 = pass-through: businesses pay exactly what Meta charges, per country. Per-business override on the business's Billing settings."
              current={
                mail.waMarkupPercent === null ? "" : String(mail.waMarkupPercent)
              }
              onSave={(value) => {
                const parsed = Number(value.replace(",", "."));
                return setConfig({
                  key: "waMarkupPercent",
                  value:
                    !value.trim() || Number.isNaN(parsed) || parsed <= 0
                      ? ""
                      : String(parsed),
                });
              }}
            />
            <WaRateCard
              rows={mail.waRateTable}
              onSave={(value) => setConfig({ key: "waRateTable", value })}
            />
            <Row
              label="Trial credit"
              money
              hint="Welcome money for businesses born prepaid: credited to the wallet once at sign-up, shown in their top-ups as trial credit. Empty or 0 = none. Invoice-mode sign-ups never receive it."
              current={
                mail.trialCreditUsd === null
                  ? undefined
                  : String(mail.trialCreditUsd)
              }
              onSave={(value) => {
                const parsed = Number(value.replace(",", "."));
                return setConfig({
                  key: "trialCreditUsd",
                  value:
                    !value.trim() || Number.isNaN(parsed) || parsed <= 0
                      ? ""
                      : String(parsed),
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

          {/* The address /privacy and /terms give for questions, KVKK
              requests and closing an account. Read by those pages on every
              request (platformConfig.legalContact), so saving here changes
              them at once. Empty is a real state, not a missing field: the
              pages then leave out every sentence asking people to write to
              us, rather than promise an answer nobody can ask for. */}
          <Section
            title="Legal pages"
            description="What the public privacy policy and terms of service print about how to reach us."
          >
            <Row
              label="Contact email"
              hint="Printed on /privacy and /terms as the address for questions, data requests and closing an account. The pages read it on every visit. Empty = they leave out every sentence that asks people to write to us."
              current={mail.legalContactEmail}
              placeholder="Not set"
              onSave={(value) => setConfig({ key: "legalContactEmail", value })}
            />
          </Section>

          {/* The platform-wide kill switch card lived here until 2026-08-27
              (Serdar: "very destructive and i don't see where i'd use it").
              The chatAgentDisabled flag and its gate in the agent stay — a
              stuck-on flag would need `npx convex run` to clear, which is
              exactly the ceremony a platform-wide stop deserves. */}

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

// Meta's per-message rate card, editable in place. The backend hands the
// EFFECTIVE table — checked-in defaults with the stored override already
// merged (platformConfig.status) — so what this renders is what sends are
// being priced at right now. Any edit saves the whole visible table as the
// override; Reset clears the row and the card falls back to the defaults in
// lib/waPricing, which is also how a new Meta rate card lands by deploy.
function WaRateCard({
  rows,
  onSave,
}: {
  rows: Array<{
    country: string;
    marketing: number;
    utility: number;
    authentication: number;
    overridden: boolean;
  }>;
  onSave: (value: string) => unknown;
}) {
  const CATS = ["marketing", "utility", "authentication"] as const;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const usd = (micro: number) => String(micro / 1_000_000);
  const cell = (country: string, cat: string) => `${country}:${cat}`;
  const shown = (row: (typeof rows)[number], cat: (typeof CATS)[number]) =>
    drafts[cell(row.country, cat)] ?? usd(row[cat]);
  const save = () => {
    if (Object.keys(drafts).length === 0) return;
    const table: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      table[row.country] = Object.fromEntries(
        CATS.map((cat) => {
          const parsed = Number(shown(row, cat).replace(",", "."));
          return [
            cat,
            Number.isFinite(parsed) && parsed >= 0
              ? Math.round(parsed * 1_000_000)
              : row[cat],
          ];
        }),
      );
    }
    void Promise.resolve(onSave(JSON.stringify(table))).then(() =>
      setDrafts({}),
    );
  };
  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2 pb-2">
        <div className="text-sm font-medium">WhatsApp rates</div>
        <InfoTip text="Meta's price per DELIVERED template message, USD, by recipient country and the category the template landed as. Session replies inside the 24h window and Evolution sends are free. Countries without a row bill at “other”. Businesses pay these plus the markup above; edits only price sends from now on." />
        {rows.some((row) => row.overridden) && (
          <button
            type="button"
            onClick={() => void onSave("")}
            className="text-xs text-[var(--muted)] underline-offset-2 hover:underline"
          >
            Reset to Meta card
          </button>
        )}
      </div>
      <table className="text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-[var(--muted)]">
            <th className="pr-6 pb-1 font-normal">Country</th>
            <th className="pr-6 pb-1 font-normal">Marketing</th>
            <th className="pr-6 pb-1 font-normal">Utility</th>
            <th className="pb-1 font-normal">Auth</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.country}>
              <td className="pr-6 py-0.5 text-[var(--muted-strong)]">
                {row.country}
                {row.overridden && (
                  <span
                    className="ml-1 text-[var(--muted)]"
                    title="Edited; not Meta's card"
                  >
                    *
                  </span>
                )}
              </td>
              {CATS.map((cat) => (
                <td key={cat} className="pr-6 py-0.5 last:pr-0">
                  <div className="inline-flex w-24 items-center rounded-lg border border-[var(--border)] px-2 py-0.5 focus-within:border-[var(--muted-strong)]">
                    <span className="shrink-0 pr-1 text-xs text-[var(--muted)]">
                      $
                    </span>
                    <input
                      value={shown(row, cat)}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [cell(row.country, cat)]: e.target.value,
                        }))
                      }
                      onBlur={save}
                      inputMode="decimal"
                      className="w-full min-w-0 border-0 bg-transparent p-0 text-sm outline-none"
                    />
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
