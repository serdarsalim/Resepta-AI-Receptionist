# Resepta — working in this codebase

> **Brand and infrastructure (decided 2026-08-05, Serdar):** the public product
> is **Resepta** and its canonical frontend is `https://resepta.xyz`. The repo,
> directory, Vercel project and selected internal identifiers retain the former
> `randevu` name; do not rename infrastructure merely to match the brand.

> **Public help center:** `https://docs.resepta.xyz` is served by the same
> Vercel project and rewritten to `/help` in `src/proxy.ts`. Its content
> lives in `src/components/HelpCenter.tsx` so product and help ship together.
> The Markdown `docs/` directory is the technical/operator source material,
> not a public site. Translate its product facts into customer steps; never
> expose provider names, credentials, internal IDs, or platform-admin recovery.

> **Public demo:** `https://demo.resepta.xyz` rewrites signed-out root requests
> to `/demo`, then signs visitors anonymously into the isolated showroom org.
> It shares the production deployment by design. Preserve all three safety
> boundaries documented under "The demo org" and never add credentials to it.

> **Read [`docs/wwsd.md`](docs/wwsd.md) FIRST.** It is the decision model —
> how Serdar picks, what he rejects, and the design-language violations he has
> personally flagged. Every rule there came from a real correction. Consult it
> before building a surface, not after it gets rejected.

> **Public landing hierarchy (Serdar, 2026-08-05):** the headline is the first
> text in every hero and section intro. Never place a kicker or eyebrow above
> it. Product imagery supports the hero copy at a smaller scale; it must not
> compete with the headline. Keep decorative layers and idle motion quiet.

WhatsApp appointment automation for SMBs (salons, barbers, dentists). One shared
deployment serves EVERY business — this is the multi-org sibling of Nudge
(`../nudge`), which is instance-per-tenant. The two products deliberately do not
share a codebase; Resepta borrows Nudge's proven pieces (the wa_cloud sender,
config conventions) by copy, not import.

## The one invariant that matters

**Every table except `orgs` and the auth tables carries `orgId`, and every query
filters by it.** There is no cross-org read path. When you add a table, add
`orgId` and an index starting with it. When you add a query/mutation, resolve the
caller's org via `requireOrg(ctx)` (convex/lib/orgAuth.ts) and scope every read
and write to it. An unscoped query is a data leak between businesses, not a
style issue.

## Product boundaries (decided 2026-07-25, Serdar)

- Scope is appointment automation: customers, appointments, WhatsApp
  confirmations + reminders, confirm/cancel by reply. NOT lead qualification,
  NOT deal stages, NOT HubSpot. If a feature request looks like Nudge, it
  belongs in Nudge.
- **The public product is vertical-agnostic** (Serdar, 2026-07-31). Lead with
  Resepta's call → booking → follow-up workflow and product UI, never with one
  industry's lifestyle photo. Industry photography belongs only inside
  labelled use-case tabs and never inside the product demo; it illustrates an
  example without redefining the app as salon, clinic or workshop software.
- Self-serve: a salon signs in with **Google OAuth only** (Serdar, 2026-07-25:
  ease of use wins; no passwords, no reset flow ever). First sign-in creates
  the org unnamed; the AppShell onboarding gate asks the one question
  (business name). No invites, no fleet provisioning, no operator in the loop.
  (An agency/partner-operated admin surface is the likely next layer — note
  that Google-only means the partner can't pre-provision credentials; if that
  model wins, add a second provider then. See "Open product questions".)
- **Appointment intake is NATIVE; cal.com is parked, not removed** (Serdar,
  2026-08-19 — reversing the earlier "cal.com by design" stance). The native
  lane already computes availability (`booking.ts` freeStarts: capacity,
  customer conflicts, lead times) and cal.com was never wired for any real
  org, so new features build native-only and MUST NOT fork on
  `org.calcomApiKey`. The integration stays in code for the eventuality:
  entirely gated on `org.calcomApiKey && org.calcomEventTypeId`,
  `convex/calcom.ts` handles BOOKING_CREATED / RESCHEDULED / CANCELLED, the
  org resolved from a per-org token in the webhook URL
  (`orgs.calcomWebhookToken`) because cal.com's payload carries no tenant
  identity, and its admin card hidden behind `SHOW_CALCOM_CARD`. The salon's
  own calendar is fed by email instead: `users.notifyNewBooking` mails a real
  ICS invite per system-sourced booking and its retraction on cancel
  (`scheduleLifecycleMessages` → `lib/alerts.ts`), with
  `appointments.icsSequence` bumping on every startAt change so clients honor
  the update. The known next step if invite-per-email proves too weak: a
  token-authed read-only ICS feed route the owner subscribes to once.

  With no key configured, `schedule.create` takes its documented no-key path
  and the appointment is Resepta's alone. **Consequence: today nothing checks
  for conflicts in the salon-facing calendar.** Double-booking a slot is
  possible and is caught only by a human looking at the grid; the `force` /
  `canForce` "book anyway" flow only ever fires when a key exists. Do not
  assume the guardrail is there.

  Manual entry in the app stays for walk-ins; `appointments.source`
  distinguishes them and `externalUid` is cal.com's booking uid.
- **Blocked time is deliberately not modelled.** `appointments.customerId` is
  required, so there is no way to put a lunch break, a training day or a
  closure on the calendar without inventing a fake customer. This was weighed
  (optional `customerId` across ~41 dereference sites vs a separate `blocks`
  table) and PARKED, on the reasoning that breaks are *availability* rather
  than appointments and belong to cal.com once it is wired. Note
  `enrichedAppointment.customer` is already `v.union(object, v.null())`, so the
  read path would tolerate it. Do not build a parallel blocked-time system
  without revisiting that call with Serdar.
- **The Cloud lane's token is PLATFORM-level with a per-org override**
  (2026-08-20, the Meta Tech Provider shape). `waAccounts.accessToken` is
  optional; `resolveWaAccount` (`lib/platformConfig.ts`) hands every loader
  query an account whose token is the row's own or the platform
  `whatsappAccessToken`, and null when neither exists — a row that can
  authenticate nothing reads as "Cloud off" rather than firing Bearer-less
  requests at Meta. So provisioning a hosted business is just its
  `phoneNumberId` + `wabaId` on the admin card. Resolve in the QUERY, never in
  the action: actions have no `ctx.db`. This is a LIVE fallback, deliberately
  unlike the Retell key's stamp (below) — a Meta token is pure auth over
  phone-number ids that never move, and one rotation has to reach every hosted
  org at once.
- WhatsApp runs on TWO lanes (`convex/lib/waLane.ts`): the Meta Cloud API
  (`waAccounts`, credentials operator-installed at /admin) and the salon's own
  shop phone on an Evolution instance (operator-provisioned; the salon links
  the handset by QR in Reminders). A reply goes back out the lane it came in
  on; anything business-initiated prefers Cloud, because Evolution silently
  drops first contact (Reachout Timelock, ACK 463). Cloud sends ride
  pre-approved **Meta template messages**; the shop phone and the email lane
  send the template row's authored body and need no approval from anybody.
  Orthogonal to the lanes: `orgs.messageChannel` (whatsapp | email | both,
  unset = both) is the salon's own choice of which CHANNEL the appointment
  rules send on — email-only skips the WhatsApp attempt including its failure
  rows, and logs visible failures when the email half is missing instead
  (`email-not-configured`, `no-email-address`).

## Message model

- Outbound rides Meta template messages: `waCloudTemplatePayload` in
  `convex/lib/waCloud.ts`. Body variable convention is fixed: `{{1}}` customer
  first name, `{{2}}` business name, `{{3}}` appointment date+time (formatted in
  the org's timezone/locale). Quick-reply buttons carry
  `confirm:<appointmentId>` / `cancel:<appointmentId>` payloads.
- Inbound comes through one webhook (`convex/http.ts`, `/whatsapp/webhook`),
  resolved to an org by `metadata.phone_number_id` — never by guessing from the
  customer's number alone. Button payloads confirm/cancel the exact
  appointment; bare "EVET"/"İPTAL" text falls back to the customer's next
  upcoming appointment.
- Reminders are cron-driven (`convex/crons.ts` → `reminders.tick`, every 5
  min): offsets come from `orgs.reminderOffsetsHours` (default 24h and 2h
  before start). The tick stamps `reminderSentOffsets` BEFORE scheduling the
  send — that ordering is the double-send guard across overlapping ticks; keep
  it.
- Status moves on its own in ONE direction: `appointments.completePast`
  (hourly) marks `scheduled`/`confirmed` bookings `completed` once their day is
  over in the ORG's timezone. `no_show` stays manual and that is the point —
  `reminders.tick` sends a win-back only for `no_show`, so it is the one status
  worth a tap, and the owner has until closing to mark it. Nothing ever moves a
  booking back to live; `cancelled` and `no_show` are left alone.

## Delivery is a queue, not a fire-and-forget

`messages.applySendResult` is the ONE place a send outcome is decided — retry
policy, dead-lettering and the failure alert all have to agree, and one
function is the only way to guarantee they do. Never alert from a call site.

- Failures are classified in [`lib/sendFailure.ts`](convex/lib/sendFailure.ts).
  **Permanent** (no consent, no approved template, shut 24h window, bad token,
  any other 4xx) fails terminally. **Transient** (5xx, 429, Meta's rate-limit
  codes, a thrown fetch) backs off ~1m/5m/15m/1h/3h and then dead-letters.
- **A retrying row keeps status `queued`, not `failed`.** A message still in
  flight has not failed, and the health counts read status.
- `convex/delivery.ts` re-POSTs the EXISTING row rather than re-running the
  action that made it — re-running would log a second row for one message the
  customer gets once. Rows store `templateParams` so a retry replays the same
  words.
- `sendingAt` marks a row in flight; the reaper FAILS rows stuck past 2h rather
  than retrying them. There is no idempotency key on Meta's endpoint, so an
  ambiguous outcome must not be re-sent. The retry queue takes the opposite
  view deliberately — losing a reminder is worse than a duplicate, but a
  claimed row may already have been delivered.

## Cron cost must track work, not org count

This is one deployment for every salon, so any cron that scans "all rows in a
window" is work proportional to how many customers exist. `.take()` truncates
in SILENCE, which is how the reminder sweep quietly stopped reminding whoever
sorted last past ~15 orgs.

`appointments.nextMessageAt` (see [`lib/reminderSchedule.ts`](convex/lib/reminderSchedule.ts))
holds when a booking next owes the customer something — a reminder while live,
a winback once it ends as a no_show. The cron reads an index range and gets
back exactly the due rows.

**Any mutation that changes `startAt`, `status`, `reminderSentOffsets` or
`winbackSentAt` must call `syncAppointmentSchedule` after its patch.** It is
idempotent, `reminders.reconcile` repairs what a write path forgets, and
changing an org's offsets re-derives that org's calendar in the background.

## Cross-org reads live in exactly one file

Every query is scoped by `requireOrg`. The single exception is
`convex/platform.ts`, gated by `requirePlatformAdmin`
([`lib/platformAuth.ts`](convex/lib/platformAuth.ts)) — an env allowlist
(`PLATFORM_ADMIN_EMAILS`), never an org role and never a DB flag, because a
column is something an org-scoped mutation could reach. Unset denies everyone.
`requirePlatformAdmin` may also gate an OPERATOR-ONLY WRITE surface outside that
file — `convex/connections.ts` (per-org provider credentials the salon must
never see) and `convex/platformConfig.ts` (deployment-global operator settings)
both do. Neither reads across orgs, which is what this rule is actually
protecting: the confinement that matters is cross-org READS, and those stay in
`convex/platform.ts`. `lib/orgAuth.ts` and `lib/activity.ts` import only
`emailIsPlatformAdmin`, which touches no database at all.

Do not widen it further without the same argument: name the surface, show it is
operator-only, and show it reads one org or none.

**Widened once, on 2026-08-24, and this is the whole of it.** The sharing block
at the foot of [`convex/team.ts`](convex/team.ts) (`sharedAccess`,
`setAccessElsewhere`, `shareCandidates`, `shareIntoThisBusiness`) reads and
writes MEMBERSHIPS across orgs, so an owner of several businesses can staff them
from one screen. It is not operator-gated and does not need to be: the gate is
ownership of BOTH ENDS, read from `memberships` rows the caller cannot mint, and
only a person who is already a member of an org the caller owns can be moved.
The reads give up the least that answers the question — `sharedAccess` returns
ids and roles, never names, so the card can only draw people this org's own Team
query already gave it. No customer, message, appointment or setting crosses a
boundary, which is the confinement this rule protects. Anything beyond
memberships still belongs in `platform.ts`.

## Two kinds of template, never conflate them

- **Meta template messages** are business-initiated, registered with Meta and
  filled BY POSITION: `{{1}}` first name, `{{2}}` business, `{{3}}` appointment
  time. Meta approved that exact string; we do not rewrite it.
- **Everything else** — away-reply, composer text, campaign line, email body —
  is ours and takes NAMED tokens (`[ad]`, `[isletme]`, `[tarih]`) via
  [`lib/renderTokens.ts`](convex/lib/renderTokens.ts). Token names deliberately
  do not translate: the stored string cannot be right in three languages at
  once. An unresolved token renders as nothing, never as itself.

Campaigns are business-initiated, so on the Cloud lane they MUST ride an
approved template. The campaign template's `{{3}}` is a free line the campaign
supplies, which is what makes one Meta approval cover every campaign the salon
will ever run.

The `waTemplates` row bridges the two kinds (the Nudge template-engine port,
Aug 2026). Per (kind, language) it carries the salon's AUTHORED `body` and
email `subject` in named tokens — the content for the shop-phone lane, email
and the demo — while `metaName`/`status`/`bodyPreview` remain the Cloud
registration, which gates only the Cloud send. `metaName` is optional
(shop-phone/email-only orgs register nothing with Meta); `bodyPreview` doubles
as the legacy content fallback for rows with no authored body. The editor is
the templates card in Reminders; the Meta row renders only while a Cloud
number is connected. Winback and campaign email carries an open pixel
(`/e/o/<token>` in `convex/http.ts`, `messages.recordEmailOpen`, 15s prefetch
guard); opens surface as a RATE on the winback template row and the campaign
row — never as a per-customer "opened" badge, because relay prefetch makes the
individual fact a guess.

## i18n — two layers, don't conflate them

1. **Customer-facing (WhatsApp).** Language resolves per customer:
   `customers.language ?? orgs.language`. The content row is an EXACT match on
   `(kind, language)` with **no cross-language fallback** — a missing template
   logs a failed message rather than shipping the wrong language (the Nudge
   lesson). The Cloud send additionally requires `status === "approved"` plus
   a `metaName` on that same row. Dates inside messages format through
   `convex/lib/format.ts` in the ORG's timezone and the message language.
2. **App UI.** A typed dictionary in `src/lib/i18n.ts` (`tr`/`en`) behind
   `LanguageProvider` + `useT()`. Adding a language = adding a column; adding
   a string = adding a key (the union type makes a missing key a compile
   error). Deliberately NOT next-intl: no locale-prefixed routes and no SEO
   surface in a logged-in app. A future PUBLIC booking page can adopt next-intl
   on its own without touching this.
   The signed-in app follows `orgs.language`; the sign-in screen falls back to
   localStorage then the browser language.

## The demo org

`orgs.demoMode` marks a showroom org: sends are simulated, replies invented,
and a nightly cron rebuilds it from `devSeed`. **Its safety story is NOT
Nudge's.** Nudge's demo is a separate deployment with no credentials, so an
empty env is the boundary. Here the same deployment holds real salons, so the
boundary is the org scoping every query already does, plus the demo org having
no `waAccounts` row, plus every send path checking `demoMode` BEFORE it reaches
a provider (which is why that check sits before the credentials check, not
after).

Walk-in anonymous sign-in exists only when `DEMO_ORG_ID` is set — the provider
is not registered otherwise. Never set `demoMode` on an org with credentials.
The public entry origin is `https://demo.resepta.xyz`; its session stays on that
subdomain so trying the demo does not replace an owner's `resepta.xyz` session.

## Open product questions (unresolved as of 2026-07-25)

These change what gets built next — don't paper over them:

- **Operator model.** Self-serve (current) vs partner-operated agency vs
  hybrid. Affects whether a super-admin surface exists at all.
- **WABA ownership.** Does each salon go through Meta embedded signup, or does
  the partner hold numbers as a Tech Provider? This is the real onboarding
  bottleneck and it is unvalidated.
- **Template approval.** Every org currently types its own Meta-approved
  template names into the Reminders tab. If the partner owns the WABA,
  templates are approved once centrally and this UI gets much smaller.

## The IA after 2026-08-12 (read this before the 2026-07-31 section below)

Sidebar: Customers · Inbox · Campaigns · **Voice agent** · Revenue (flag) ·
Calendar · **Reminders** · Business. Two things moved and one scar is worth
more than either.

- **Knowledge left Business for the voice agent.** It is now the third chip on
  `VoiceView`'s own strip: Agents · Calls · Knowledge. It is what the agent
  KNOWS, so it belongs beside the agent that reads it; under Business it was
  filed as a fact about the salon, which is the same scavenger hunt the Hours
  comment in `BusinessView` describes. `BusinessView` must not take the
  `knowledge` section id back.
- **Reminders stays in the sidebar, directly under Calendar.** It was moved
  into Business as a config section and Serdar rejected it on sight. The
  config argument is right on paper — rules you set once, nothing arrives in
  them, its own old comment called it "the last of Settings" — and wrong in
  use: reminders are the thing this product does to keep chairs full, and they
  sit under Calendar because every rule fires off an appointment. Don't
  re-propose the move.
- **⚠️ NEVER wrap a view that already has a chip strip in another chip strip.**
  The first attempt at this session's IA work built a `FrontDeskView` holding
  Voice / Knowledge / Reminders as chips. `VoiceView` renders its OWN chips at
  its top, so the result was two identical chip rows stacked, one indented
  under the other. Reverted in `f2e9918`. The lesson generalises past this one
  bug: before grouping views under a new container, open each one and look at
  what it renders first. Grouping in this app means adding a tab to the strip
  a view already owns, or adding a sidebar row — never a third level.
- **SUPERSEDED by the 2026-08-12 (later) section below.** Hours no longer keeps
  its own Business tab; Business has no tabs at all. The reasoning that kept
  them apart, and what changed to answer it, is recorded there.

## A lesson learned on one agent belongs in the defaults (2026-08-21)

Serdar, after a live tenant hit three problems in a row: *"we keep learning and
we keep improving the onboarding agents, so the next client that self-enrolls
starts where we got to — and existing agents get better too, without touching
the prompts they crafted."* He should never have to ask for this per finding.
So it is a standing rule, not a request:

**Fixing the tenant in front of you is half the job. The other half is asking
which lane carries the fix to everyone else, and taking it.** There are three,
and they differ ONLY in reach — pick the highest one the fix can live in.

1. **Ring-time injection** (`retell.ts beforeCallContext`) — reaches EVERY
   agent on its very next call. No publish, no click, no version. This is
   where `{{services}}`, `{{now}}`, `{{contact}}`, `{{knowledge}}` live. The
   catch: it carries VALUES, not instructions, and only works if the agent's
   prompt already references the variable. An injected value nobody's prompt
   mentions reaches everyone and does nothing.
2. **Sync-deliverable** (the template's TOOLS, model, agent knobs, analysis
   fields) — reaches existing agents through the update banner: one click,
   and `syncTemplate` explicitly leaves the owner's prompt alone. **This lane
   only opens if you bump `VOICE_AGENT_TEMPLATE_VERSION`** — the banner is
   gated on `templateVersion !== VOICE_AGENT_TEMPLATE_VERSION`, so a
   sync-deliverable improvement without a bump reaches NOBODY. Bumping also
   obliges you to rewrite `voiceDetail.templateBehindHint`, which names what
   the new version does; a banner still advertising the last version's wins
   is a promise about a version nobody is being offered.
   - **An operator dial is not this lane, even though it rides the same
     PATCH.** The voice model and its fast tier both resolve
     `agent override ?? fleet row ?? template constant` and both reach an
     existing agent on its next publish — but the banner is a promise to the
     OWNER about their agent, and "the operator changed a default" is not
     something to ask an owner to click. Add the dial, leave the version
     alone. Bump only when the template itself starts saying something new.
3. **Prompt text** — NEW AGENTS ONLY, forever. Existing owners get it only by
   editing their own prompt, which is theirs and which they have tuned.
   - **Since 2026-08-22 this lane also has an /admin surface** (Onboarding →
     "What a new phone agent is born saying"): a `voicePrompts` row per
     LANGUAGE laid over `GENERAL_PROMPTS` / `BEGIN_MESSAGES`, resolved by
     `lib/voicePromptStore`. It does not widen the lane one inch, and the
     enforcement is structural rather than a rule somebody has to remember:
     `appointmentReceptionistTemplate` takes the override as an optional
     `prompt` argument, and `provisionAgent` is the ONLY caller that resolves
     one. `syncTemplate`, `setEndCallEnabled` and the model path all build a
     template too and none of them sends `general_prompt` or `begin_message`
     — so there is no code path by which an /admin edit reaches a phone that
     is already answering. **If you ever add one, you have broken lane 3.**
   - The named greeting stores its persona as `{name}` (SINGLE brace,
     substituted at provisioning) precisely because it must not read as a
     ring-time `{{variable}}` — see `BEGIN_MESSAGES_NAMED` for why the
     introduction is a clause and cannot be substituted away by an empty one.
   - Per language, NOT per vertical, and keep it that way: a dentist and a
     barber get identical prompts on purpose, because what makes an agent
     sound like its trade is the services and contact fields injected at ring
     time (lane 1) from what `lib/industryPresets` seeded.

**The move that makes this work: say the same thing in two lanes.** The
2026-08-21 early-hangup fix is the worked example — the turn-based closing
rule went into the prompts (lane 3, for new agents' clarity) AND the same two
negatives went into the `end_call` tool DESCRIPTION (lane 2, bumped to v12),
which is the half that rescues the agents already in the field. Ask of every
lesson: can this be a tool description, a knob, or an injected value as well
as a sentence in the prompt? Usually it can.

**And the onboarding surfaces are the same duty in a different place.** A
lesson about what a business needs on day one belongs in
`lib/industryPresets`, `DEFAULT_VOICE_IDS`, the auto-provision naming, or the
wizard — not only in the one tenant you repaired by hand. The next self-enrol
should start where the last support conversation ended.

**When a fix is genuinely prompt-only, SAY SO in the handoff** rather than
letting it read as shipped. Stranded as of 2026-08-21: the Bella port
(`{{next_appointment}}`, greet-by-name), the `{{knowledge}}` prompt line, and
the turn-based closing rule all reach new agents only. The knowledge one is
the sharpest — every existing agent now HAS the variable injected and no
prompt line reading it. The shape of the answer, if it is worth building: an
ADDITIVE, one-click prompt patch that appends the single line and shows the
owner exactly what it added, which is a different thing from a sync
overwriting text they wrote.

## Onboarding (built 2026-08-21) — the wizard, presets, billing for everyone

Serdar's brief, built overnight: a world-class first-run. What holds now:

- **The one-question gate is a five-step wizard** (`OnboardingWizard.tsx`,
  still gated on `org.name === ""` in AppShell): language → business name →
  industry + prefilled-or-blank → business info → phone number. The NAME is
  saved LAST, deliberately: naming unlocks the shell and schedules voice
  auto-provisioning, so it is the commit point for everything the wizard
  collected, and an abandoned wizard simply reopens next visit (every earlier
  write is idempotent or additive). The language step persists `org.language`
  immediately so provisioning and every later write happen in it. The name
  step pre-checks availability (`onboarding.nameAvailable` — same one-bit
  answer the name-taken error already discloses; the definitive check stays
  in `orgs.update`). Replay it in dev with
  `npx convex run devSeed:resetOnboarding '{}'` (`wipe:true` also clears the
  catalog; `devSeed:setOrgName` puts a name back without walking the wizard).
  - **The language step STAYS a step, PRESELECTED with the landing's
    language** (Serdar, 2026-08-21, after weighing dropping it entirely and
    a field-on-the-name-step): the agent and every customer message are born
    in this language, which earns it a screen. What protects the first
    impression is around the step, not the step: AppShell's language sync
    STANDS DOWN while the org is unnamed — new orgs are born `language:
    "tr"`, and before this a German visitor's wizard flipped to Turkish the
    moment settings loaded. A header-pills version of the control shipped
    for an hour and died (three bare two-letter codes explain nothing);
    a no-step inherit-only version died in review the same day.
  - **The card holds ONLY the step, and its heading is the step's QUESTION.**
    "Welcome!" as the title with the real question demoted to subtext, plus
    language pills and sign-out crammed into the card's title row, was three
    unrelated things fighting on one line (Serdar, same day, in those
    words). Brand mark and sign-out are PAGE chrome — top-left / top-right,
    outside the card. The card sizes to its step between a floor
    (min-h-[340px]) and the viewport — NOT /book's fixed height: that rule
    was written for steps that hold similar amounts, and one input vs eight
    industry options is not that, so a fixed card left the name step crammed
    at the top of a void.
- **Sign-in is a DIALOG over the landing** (`SignInDialog.tsx`, same day):
  every Get-started/Sign-in CTA opens it in place instead of shipping the
  reader to a bare page. The /signin ROUTE stays alive as the fallback
  (middle-click, shared links, auth redirects) rendering the same
  `SignInCard`; the privacy/terms links live INSIDE the card because
  Google's consent-screen review wants them wherever the OAuth flow starts,
  and it starts in the dialog now. The Google button wears Google's own G on
  a bordered button, not an anonymous accent block. The product mark is
  shared from `BrandMark.tsx` (landing header, dialog, /signin, wizard
  chrome — one glyph, four surfaces). `app.tagline` says "AI front desk",
  matching lib/brand's DEFAULT_TITLE; it read "WhatsApp appointment
  reminders" long after the product outgrew it.
- **Industry presets are ORG DATA, seeded once** (`lib/industryPresets.ts`, a
  PURE module the browser may import; applied by `convex/onboarding.ts`).
  Seven verticals × three languages seed services and voice-sourced contact
  fields; field KEYS are fixed in the module (language-stable addresses),
  services dedupe by key so re-applying never doubles a price list. NO PRICES
  seeded, ever — an invented price is a claim about the business; durations
  are a guess the owner corrects in seconds. `orgs.industry` remembers the
  answer; Business → General grows an Industry row whose select only records
  and whose "Reset to defaults" re-seeds behind a confirmation naming the
  cost (services deleted — safe, appointments snapshot their lines; fields a
  voice agent references SURVIVE the reset, deleting them would wedge the
  next publish).
  - **The catalogue stays in CODE; /admin → Onboarding is an OVERRIDE layer**
    (Serdar, 2026-08-22: "realistically Claude will still own updates to the
    prompts and verticals, but I should be able to quickly see or do quick
    edits or add verticals for later"). A vertical with no row in the
    `industryPresets` table is served straight from `lib/industryPresets.ts`,
    so a catalogue commit still reaches everything nobody has edited, and
    Revert-to-code is deleting a row. Resolution lives in
    `lib/industryPresetStore.ts` (the pure module stays pure); the Convex
    surface is `convex/industryPresets.ts`, wrapping it the way
    `platformConfig.ts` wraps `lib/platformConfig.ts` — but with the fallback
    pointing the OTHER way, because here the code is the artifact people can
    see, diff and revert.
    - `edited` compares CONTENT, not row existence, so switching a vertical
      off does not report drift it does not have. The console shows the
      Edited chip and an "improvements no longer reach these" banner, and the
      editor emits the TypeScript literal to paste back into the module —
      porting is the intended end of an override's life, not an afterthought.
    - `active: false` hides a vertical from the wizard and keeps it resolving,
      so a business already on a retired vertical keeps its reset working.
      Business settings passes its own answer as `catalogue({ include })` so
      that vertical still has a NAME in the picker.
    - The wizard and Business settings read the catalogue from the SERVER
      now. They used to import the module into the bundle, which meant a
      vertical added or retired in /admin reached nobody until a deploy.
      `catalogue` is deliberately unauthenticated: it is the same data the
      browser already downloaded, and it must answer for a user whose org is
      still unnamed.
- **The Bella port**: the two prompt refinements Serdar hand-tuned into the
  prod "Bella Randevu Asistanı" (de_autotakt workspace) live in the template
  now — `{{next_appointment}}` in the context block and greet-a-known-caller-
  by-name-once — in all three languages, prompt-text only, no version bump.
  `DEFAULT_VOICE_IDS` gives auto-provisioning a curated voice per language
  (tr keeps Bella's minimax-Camille) instead of `voices[0]`.
  - **⚠️ The preview clips NAME THE PROVIDER, and that is unfixed** (Serdar,
    2026-08-21, on hearing the new picker: "all agents say that they're from
    retellai"). `previewUrl` is Retell's own ~7s marketing sample hosted on
    their S3, and the voice in it introduces itself as a Retell AI agent —
    so the one surface that plays audio to a salon owner breaks this file's
    own rule that Retell is an implementation detail salon-facing UI never
    names. It cannot be fixed at Retell: their API has list / retrieve /
    clone / search-community and NO synthesize endpoint, so there is no way
    to ask them for a different sentence in the same voice. The shape of the
    real fix, when it is worth doing: these are minimax voices, so generate
    the clips through MINIMAX's own TTS API with the same voice ids, saying
    a receptionist line per language, store them in Convex storage and serve
    `previewUrl` from us. That also upgrades the sample from a vendor ad
    to the thing the owner is actually buying. Until then the leak stands and
    is known — do not "discover" it again.
  - **The voice catalogue is MINIMAX-ONLY** (lib/voiceCatalogue, Serdar,
    2026-08-21): the old "platform-maintained" filter excluded every minimax
    voice, so the curated default was never in the tenant's picker and Sun
    Klinik's Turkish agent was born speaking retell-Alejandro. One engine
    family, multilingual, the one Bella was tuned on. `keepId` still lets an
    agent already on an off-list voice show what it actually uses.
  - **Auto-provisioned agents are named after the BUSINESS** ("Sun Klinik
    Sesli Asistanı", not "Randevu asistanı" — same day): every new agent
    sharing one neutral name filled the shared Retell workspace with
    indistinguishable rows.
- **Knowledge reaches the VOICE agent at ring time**: `{{knowledge}}` is a
  built-in in `beforeCallContext` (capped ~8k chars, cut between blocks) with
  its prompt line in all three GENERAL_PROMPTS — an edit reaches the very
  next call with no republish, like services and staff. The Knowledge editor
  is the rich editor now (`EmailBodyEditor` compact, no token dropdown), on
  the notes model exactly: no is-it-html flag, `bodyIsHtml` judges the body,
  and EVERY agent read — `knowledge.forAgent`, chatAgent's own query, the
  ring-time builtin — flattens through `noteText`, so what reaches a model or
  provider is words only. Do not let a send path read the raw column.
- **Billing is every owner's tab, glued above the profile** (BILLING_TAB in
  AppShell, rendered inside the account-edge container above UserMenu — not
  a foot tab). Prepaid owners see the wallet (unchanged); invoice owners see
  the meter + soft budget, ported off the voice strip, WHICH LOST ITS BILLING
  CHIP — the bill belongs to the business, not to one channel. Staff never
  see money; the deep-link guard redirects them.
- **Billing mode has a platform default, STAMPED at founding sign-in**
  (`defaultBillingMode` in platformConfig, pills on the Platform tab's
  Billing section). Stamped, never resolved at read time: flipping the
  default must not silently switch existing tenants to prepaid with a zero
  wallet, which declines their calls at ring time. `trialCreditUsd` rides
  beside it: an org born prepaid gets the welcome credit once, through
  `applyWalletCredit` (the one credit path) with the new source `"trial"`,
  scheduled from auth.ts so it runs in a real mutation ctx.
- **Number provisioning is a request with a document**
  (`convex/numberRequests.ts`, table `numberRequests`): the wizard's last
  step and the Voice tab's card (`NumberRequestCard`, which also owns the
  shared upload hook) take the company registration (PDF/photo, 10 MB —
  required in Türkiye, same flow for DACH/UK) and promise a number within
  24h. One live request per org; re-uploading replaces anything not yet
  approved. The operator's half lives in platform.ts (the standing rule):
  `orgNumberRequests` + `decideNumberRequest`, rendered as a "Number
  provisioning" card on the admin org page's Voice agent tab — download,
  approve, or deny with a note the salon reads. The decision is the
  operator's cue to go buy the line at the provider; the app still never
  purchases numbers.

## Operational readiness (audited 2026-08-20) — read before "why didn't it send"

A three-way audit (onboarding path, silent-failure surfaces, config surface)
against the live prod deployment. Everything here is a KNOWN state, not a
discovery to re-make. Re-verify before acting — items get fixed.

**Dead in prod at audit time, config not code:**
- `WA_APP_SECRET` and `WA_WEBHOOK_VERIFY_TOKEN` are UNSET, so the Cloud
  webhook 503s every POST and Meta cannot even register the callback. No
  inbound WhatsApp: no replies, no confirm/cancel buttons, no session window.
  Neither has an admin field by design — they are `convex env set --prod`.
- No LLM key of either provider ⇒ every chat-agent turn logs a
  `llm-not-configured` skip. The provider pill says OpenAI.
- `voiceRateMicroUsdPerMinute` unset ⇒ the meter resolves org ?? platform ??
  **0**, so every call bills zero and a prepaid wallet never draws down. Run
  `voiceBackfill:run` BEFORE setting a rate.
- Platform `whatsappAccessToken` unset (harmless until the first hosted org).
- Stripe IS wired and endpoint-verified (2026-08-20) — first lane proven end
  to end. Email is fully configured but has still never sent from prod.

**Silent-failure gaps, in severity order.** These are design holes, not bugs
to hunt — each was traced to a file:
1. **No cron heartbeat anywhere.** Seven jobs run the product's promises; a
   throwing `reminders.tick` sends nothing fleet-wide, forever, with every
   screen looking normal. Compounding: the tick is ONE mutation across all
   orgs, so one malformed row rolls back every salon's reminders.
2. `delivery.reapStuck` dead-letters by patching the row directly, bypassing
   `messages.applySendResult` — the only caller of `alertFailedSend`. Violates
   this file's own "never a second dead-lettering site" rule; ~5 lines to fix.
3. The alert lane is fail-silent about ITSELF: `alertHealth` exists and is
   wired to no screen, and `deliverOrgAlert` discards `sendEmail`'s result
   inside a bare catch, so a revoked key produces no log line at all.
4. `/admin` failed/dead-lettered counts key on `_creationTime`, missing every
   old row that fails today; the "Stuck" column counts all in-flight sends,
   so it reds on normal traffic and zeroes once the reaper hides a real one.
5. Inbound WhatsApp for an unknown `phone_number_id` vanishes with no log. An
   expired WABA token alert-storms (one email per failed row × every member).
   Orphaned `voiceEvents` lose the transcript AND the cost meter — unbilled
   minutes. Org-setup failures alert once ever (last-40-rows window, not time).

**Known product gaps:** staff can still double-book on the app's own grid
(every customer-facing lane checks overlap; `schedule.create`'s no-key path
does not — `overlapCount` already exists). Blocked time is still
unrepresentable and its "wait for cal.com" reasoning died with cal.com; a
`blocks` table that `freeStarts` subtracts is the shape, and the write must
be owner-authenticated only — a customer-facing agent that can create
closures is a prompt-injection hole (Serdar, 2026-08-20: "someone could call
and say your business is off next week"). Meta template approval remains
fully manual per org and is the real onboarding bottleneck.

**Doc drift found:** `docs/deploy.md` predates the whole platformConfig
console and describes env vars as the primary path when they are now the
fallback. `docs/email-lane-setup.md` is accurate but dated.

## The IA after 2026-08-14 (inbox, reminders, message variables)

Four moves, each made because a surface was named after its implementation
rather than after what it does.

- **Unread is per CONVERSATION, and the old boundary is a frozen floor.**
  `inboxVisits` (seenAt/leftAt) was the whole model: a row counted as new when
  its latest inbound landed after you last LEFT the Inbox. That answers "have
  you visited lately", so switching tabs marked everything read — markers went
  out with nobody having opened a conversation, and a filter over it would
  empty itself on every navigation. Nudge shipped that same model, found it
  wrong, and replaced it; this is the port of the replacement.
  `inboxReads` holds one stamp per (org, user, customer) and a conversation is
  new when its latest inbound is newer than MY stamp for it — per user, like
  the pins beside it, because a colleague reading a message does not mean I
  have. **`inboxVisits` is never written again**: it survives only as the
  floor under the new model (`inboxReadFloor` = max(leftAt, seenAt,
  user._creationTime)), which is what stopped every existing salon waking up
  to its whole history lit green. A moving floor silently marks things read —
  that is the bug being replaced. `markInboxSeen`/`markInboxLeft` are gone;
  `markConversationRead` is the only writer, called on an explicit row click
  and on a reply landing in the thread you are already looking at. **One rule,
  two readers:** `messages.conversations` and `messages.inboxUnseenCount` run
  the same test over the same rows, so the sidebar can never dot something the
  tab cannot show. Read stamps are POINT LOOKUPS behind the floor test, never
  collected — cost stays bounded by the conversation window rather than
  growing with every conversation a salon has ever opened.
- **The inbox has All / Unread / Pinned chips**, persisted per browser
  (`randevu.inbox.view.v1`), in the `h-9` track that exists to line the two
  cards up — one line only, or the chips spill out of it. Counts are computed
  over the UNFILTERED list, because a chip advertises what switching to it
  would show and cannot count through itself. **A live search overrides the
  chip**, per `useTableState`'s rule that a query must never fail to find a
  match that exists in the data. The open conversation falls back outside the
  filtered list, or reading an unread one under the Unread chip would blank
  the pane as its own row dropped out.
- **"Message variables" is gone, and so is setting `[phone]` at all
  (2026-08-19).** That card named the `[booking_link]` and `[phone]` TOKENS
  rather than the things themselves. The phone field then moved to Business →
  General with agent-line chips — and got deleted too, because it re-asked a
  question the voice-agent table already answers: the number customers call IS
  the enabled agent's inbound line. `[phone]` now resolves at send time in
  `convex/lib/publicPhone.ts` (first enabled agent's inbound number, stored
  `orgs.publicPhone` only as the legacy pre-agent fallback; nothing writes it
  any more). Do not add a phone settings field back. **Online booking is a
  card with ONE switch**: the Resepta page, on or off, the derived link shown
  as a fact to copy. "My own link" died 2026-08-19 — it meant switching the
  page off while messages kept printing a URL, off here and on in the
  customer's inbox. The request-form toggle and embed snippet left General the
  same day: `/r` and `/book` were two public channels for the same job and
  the booking page is the one that stayed.

  **The `/r` route is RETIRED** (2026-08-19, Serdar: "I used it nowhere").
  `convex/forms.ts` and `src/app/r/` are deleted, `/r/(.*)` is out of
  `proxy.ts`'s public matcher, and `orgs.formEnabled` is dead-and-commented in
  the schema (Convex cannot drop a field while documents carry values).
  `publicSlug` is LIVE — the booking page uses the same slug, and `slugify`
  moved to `convex/lib/publicSlug.ts`. The `"form"` FEED channel stays wired end to end (`messages.channelOfMessage`,
  `FeedIcon`, `FeedFilterPills`): `form_request` rows are historical data and
  must still render, and the filter pill already hides itself for a customer
  who has none. Do not rebuild a second public page that collects a name and a
  service without writing an appointment — that was the whole shape, and it
  put a stranger's request in a queue for staff to retype.

- **The booking link FOLLOWS the business name, and the name is UNIQUE**
  (Serdar, 2026-08-20). `/book/<slug>` is `slugify(orgs.name)`, re-derived
  whenever the name changes — `convex/lib/publicSlug.ts` owns the rule, and
  `resolvePublicSlug` throws `name-taken` rather than let two businesses land
  on one page. Do NOT add a field for editing the slug on its own: a second
  place to type it is a second answer to one question, and the answer is the
  name. The slug used to be minted once, from whatever the name was the day
  the booking switch went on, and never re-derived — which left a renamed
  salon advertising a business that no longer exists in every link it sends.
  The cost that buys: renaming MOVES the page, so links already sent stop
  opening. That is stated on the name field's hint and is the accepted trade.
  Three things must stay wired together or the fix reintroduces its own bug:
  (1) `orgs.update` patches `publicSlug` and rewrites `orgs.bookingUrl` in the
  SAME patch, because `[booking_link]` resolves through `bookingUrl` and a
  rename that missed it points every reminder at a dead page; (2) the sync in
  `orgs.update` is self-healing, not just a backfill — orgs that renamed
  before this rule have a correct name and a stale slug, so waiting for a
  rename would never reach them — and `slugMatchesName` guards it with a
  string compare so the whole-table scan in `assignPublicSlug` does not run on
  every settings save; (3) both client callers of `orgs.update({ name })` (the
  Business name field, `AppShell`'s onboarding gate) render the `name-taken`
  refusal, since an unhandled rejection here is a save that silently did not
  happen.

- **Money: `orgs.priceDecimals`, OFF by default** (Serdar, 2026-08-20). A
  Türkiye salon prices in whole lira and ".00" on every row was noise on the
  page a stranger reads to decide whether to book. The switch lives beside the
  currency select in Business → General, on one line with it, because the three
  answer together: currency picks the symbol, language picks the separators,
  this picks how much of the number to write. `lib/money` NEVER ROUNDS — the
  option only removes zeroes, so a price genuinely carrying kuruş still shows
  them, which is the only version of it that can be trusted on a public page.
  The flag defaults to the product default rather than the old behaviour, so a
  call site that forgets to thread it errs toward one salon seeing a rounded
  price instead of every salon's every message carrying ".00". It reaches all
  eight `formatMoney` sites, `moneyInputValue` (the editor has to agree with
  the display, and it is one Save from becoming the price), `booking.page`,
  `reports.revenue` and the chat agent. Deliberately NOT the platform's own USD
  figures — voice minutes, wallet, admin billing are what we charge the salon,
  not what the salon charges anyone — and not the voice lane, which drops
  trailing zeroes unconditionally because nobody says "üç bin tam sıfır sıfır".

- **`orgs.language` is the CUSTOMER language, and it drives the public pages**
  (renamed from "Message language", 2026-08-20). `/book/<slug>` and
  `/appt/<token>` formatted times and prices through it while taking their
  WORDS from `useLanguage()` — the viewer's app setting — so a salon's booking
  page greeted its customers in whatever the owner last picked in their own
  account menu, and the manage page opened from a Turkish reminder answered in
  English one tap later. Both bind `t()` to the org's language and fall back to
  the viewer's only for the states that render before the org is known. `lang`
  rides as an attribute on each page's own `<main>`: LanguageProvider owns
  `<html lang>` and a parent's effect runs after a child's, so an effect here
  loses the race every mount.

- **The customer-facing tabs wear the SALON**: their name as the title, their
  logo as the favicon, via `generateMetadata` in each route's layout
  (`booking.brand` for the slug, `manage` for the token). SERVER metadata, not
  a `document.title` effect — React owns the `<title>` and icon links it
  renders from metadata, so a client write is reverted the next time the tree
  reconciles, which on these pages is every query update. It also means a
  booking link pasted into WhatsApp unfurls as the salon. The signed-in app
  makes the OPPOSITE call and that split is the point: the owner is hunting
  Resepta among thirty tabs, so the tab strip keeps our mark, while the sidebar
  — already inside the app — wears the org's logo.

- **Services and Products are SEPARATE CARDS in Business settings**, mirroring
  the booking page's split. A product books no time, holds no chair, and
  answers a different question in every column the table has; mixed in, the
  only thing marking it out was an empty Duration cell. That cell is now empty
  for a good — unless it carries a lead time, which is a real fact about the
  row — and a unit never renders without a value to qualify ("— days ahead" and
  a lone "₺" both read as fields that failed rather than fields nobody set).
  The Products card appears only once a product exists. There is deliberately
  NO "Add product" button: the Add sheet has had a Service/Product Type switch
  since before the card existed, and a second button would be a second door
  onto one form.

- **`/book/<slug>` is a THREE-STEP WIZARD, not a growing page** (Serdar,
  2026-08-20, reversing this file's own "each answer reveals the next
  question" doctrine). Service → time → details: the header chevron goes back,
  and the screen SWAPS so nothing ever reflows. Tapping an answer IS the
  advance on the TIME and DETAILS steps, which ask for one answer each — the
  service step is the amended exception below. The old reveal-downward design grew the card
  on every selection and — because crossing the fold summoned the document
  scrollbar — shoved it sideways too; `html { scrollbar-gutter: stable }` in
  globals.css fixes the second half and must stay. Fresha and Booksy both
  work this way; do not rebuild the accordion.
  - **The service step is MULTI-SELECT** (2026-08-20, amending the no-Continue
    rule for this step only). `appointments.items` has modelled a visit as
    several lines since long before this page could express it — "a haircut
    plus a beard trim is ONE appointment with two lines" — and the staff sheet
    always wrote them; the public page took a single `serviceId` and sent a
    customer who wanted both back round to book twice. A choice you can add to
    cannot also be the advance, so this step alone ends on the sticky bar's
    Continue. `booking.slots` takes `serviceIds` and `booking.book` takes
    `lines`, both resolving through `resolveLines`: duration SUMS and lead time
    takes the MAX, and both endpoints read the same helper so the grid cannot
    offer a 30-minute gap for a 105-minute booking. Quantity stays goods-only
    (two haircuts is two visits) and lives on the row as a stepper, not on the
    details step two screens after the thing was picked.
  - **Services and products are separate groups**, headed only when the salon
    sells both. They are not the same purchase — one books a chair for a length
    of time, the other is handed over and adds no minutes — and with the
    duration line as the only tell, a product read as a service someone forgot
    to time. Duration is its own line under the name, in words
    (`Intl` unit, "1 hr 30 min" / "1 sa 30 dk"): "30′" was a prime symbol the
    width of a comma, greyed out against the price, carrying the one fact a
    customer needs to know whether they have time today.
  - **The card is FIXED-HEIGHT AT EVERY WIDTH and its middle scrolls** (Serdar,
    2026-08-20). Every step holds a different amount — six services, a slot
    grid, four fields — so the card resized under the reader at every tap, and
    fixing it per step meant another reserved height guessing at content the
    page does not control. One height for the whole wizard costs one guess
    instead of three; measured identical on all three steps. A salon with
    thirty services scrolls the list inside the card rather than growing it
    past the fold. The scroller wears `thin-scroll stable-gutter`, the pair
    every in-card scroller in the app already uses.

    It shipped desktop-only for an hour, with the phone keeping page scroll and
    a viewport-fixed bar. That was wrong in the way only a phone shows: the
    card ended halfway up the screen and the bar sat at the bottom with a
    hand's width of plane between them, reading as two unrelated surfaces
    rather than one card with a footer. `100dvh` is what makes the single
    version safe — it tracks the address bar instead of fighting it. The
    fixed/sticky/static split and the backdrop blur went with it; all three
    existed to fake an attachment the layout now has.
  - **The bar's action button is always in the bottom-right corner, greyed
    until it can be used, and BACK sits opposite it.** The button used to
    appear on the service step, vanish on the time step and return on the
    details step, so the bar's right edge was a different shape on each of
    three screens. Always-there-and-disabled says "there is a next step, not
    yet"; absent says nothing. The time step's is a formality — tapping a slot
    still advances, so it is only ever seen disabled — and that is the point:
    it holds the corner. Both sit on their OWN row under the summary, because
    at the end of one line the primary was wedged against the total and the two
    loudest things on the card fought for one corner.

    Back is in that row and NOT in the header. As a chevron beside the logo it
    pushed the logo and the salon's name right on every step that had somewhere
    to go back to, so the card's identity moved while its content changed;
    reserving an empty slot fixed the shift and left a hole. Back and forward
    are the same kind of thing and this is the row that holds them.
  - **The service list searches behind a magnifier.** The heading row IS the
    search row: collapsed it is "What would you like?" plus a glyph, open it is
    the field. No row-count threshold — collapsing to a glyph is itself the
    answer to a short list. Matching runs BOTH sides through `lib/publicSlug`'s
    slugger, which folds Turkish to ASCII, so a customer typing "sac" on a
    phone keyboard finds "Saç kesimi". It closes on blur only when empty: a
    filter still narrowing the list has to survive the tap that picks a row.
  - **The details step takes an optional NOTE, and it lands on the customer's
    record** — not on the appointment. The record is where the salon already
    reads everything else about them, and a note shows in the conversation feed
    beside the messages that follow. `notes.authorId` is optional for this, and
    unset means the CUSTOMER wrote it: a stranger on a public page is not a row
    in `users`. Nothing else may leave it blank, and `messages.feedForCustomer`
    resolves an author-less note to the customer's own name rather than to
    "System". The write is LAST in `booking.book` and never fatal — a note is
    the least important thing that mutation does and must not cost a slot.
  - **Never import a value from `convex/<name>.ts` in `src/`.** It drags that
    file's whole import graph into the client bundle — booking.ts →
    lib/newCustomer → lib/alerts, which defines an `internalQuery` — and Convex
    logs "functions should not be imported in the browser". Shared values live
    in a `convex/lib/*` module with no Convex imports; `lib/bookingLimits.ts`
    exists for exactly this, holding the cap the page and the server must
    agree on.
  - **Prices ARE published** on the public page (same date, reversing the
    forms.ts-era "duration yes, price no" rule): rows carry duration and
    `formatMoney(service.price)`, and a service with no price shows duration
    alone rather than a made-up zero. Hiding price only moved the question to
    the phone.
  - Times shelve into morning/afternoon/evening at 12:00 and 17:00 (labels
    group, hours define); the day strip is 14 civil days from the lead-time
    floor, stepped in 24h and deduped so a DST fall-back cannot mint the same
    date twice.
  - The sticky bottom bar carries the running BASKET across steps: the lines
    joined (not counted — "2 services" makes the customer open the step back up
    to remember which two), the running duration until a time is picked and the
    time after, and the summed price held out on the right. Its button is
    Continue on the service step and, on the last one, IS the submit
    (`form="booking-form"`) — never add an in-form twin button to race it. It
    carries no "pick a day and time" prompt: on the step where that is the next
    move the Continue button says so, and on the next step the heading does.
  - **`orgs.logoStorageId`** is the salon's logo, uploaded by the owner in
    Business → General through `media.generateUploadUrl` → `orgs.setLogo`,
    resolved to a URL by `booking.page` and `orgs.current`. `setLogo` DELETES
    the file it replaces — logos get re-uploaded until the crop looks right,
    and each abandoned attempt would otherwise sit in storage forever.
- **Reminders rules open as a PAGE, not an expanding row.** The id lives in
  the URL (`?rule=`) like the app's tab does, so a refresh or a trip to
  another tab and back returns to the rule. A row that navigates must not also
  hold controls: timing and channel switches live inside the page, the row
  states what the rule does and which lanes it is on, and there is no chevron
  because the whole row is the affordance.

## Message tokens: the preview, and the defaults (2026-08-14)

- **`renderTokens` is shared by the send path and the preview** and must stay
  that way, or the preview becomes a second opinion. An unknown token stays
  LITERAL (so a typo stays visible); a known token with no value renders as
  nothing, and the whitespace cleanup makes the sentence survive it.
- **`waTemplates.variableDefaults` is the "when empty, print…" table**, one
  row per token the body actually uses, authored under the body it repairs.
  The wording is EDITORIAL — what reads correctly depends on the sentence and
  the language — which is why it lives on the template and not on the field.
  A default only fires for a token the renderer already knows THAT RESOLVED TO
  EMPTY. Threaded through every send path (`wa.ts`, `campaigns.ts`,
  `lib/awayReply.ts`); add it to any new one.
- **Only tokens that sit MID-SENTENCE and can honestly be blank get a row**
  (narrowed 2026-08-19). Not `[business]` (an org always has a name), not
  `[date]` (every lifecycle send has a time), not `[booking_link]`/`[phone]`
  (configuration — a blank one means go and set it in Business settings, not
  write a sentence about not having it), not `[manage_link]` (structural), and
  not `[name]` (the renderer already tidies "Hello [name]!" down to "Hello!").
  `[service]`, `[pricelist]` and `[price]` went too: the stock texts give them
  their own LINE, and a line that resolves to nothing collapses cleanly — a
  missing list is less information, not a broken sentence, and a fallback
  there papers over an appointment with no line items, which is data to fix
  rather than write around. What is left is the honest list: `[staff]` ("your
  appointment with [staff]" → "your appointment with", which the whitespace
  cleanup does NOT repair — it fixes spaces and punctuation, never a dangling
  preposition) and the org's own contact fields. Stored defaults keep firing
  at send time whatever the editor offers; narrowing the list only stops it
  soliciting new ones.
- **The preview invents the PERSON and reads the salon's real SERVICES**
  (2026-08-19). Three answers were tried in order: invent everything (a €350
  haircut in a shop charging €35 reads as a pricing bug in the product, and
  you cannot tell a broken `[pricelist]` from an invented number), refuse to
  draw without a real booking, then auto-pick a real customer — which put
  someone's actual name in a settings screen, unasked, to make a template
  legible. The rule that survives is narrower than "never invent": **inventing
  a price is a claim about the business; inventing a first name is not.** So a
  fictional customer (per language, `settings.previewFirstName`) books the
  org's own first active service at its own price, in its currency, language
  and timezone. Everything an owner could mistake for their data still is
  their data. Reading order is **sample value → the owner's default → the
  labelled slot**, so a token with nothing behind it previews as ⟨Services
  with prices⟩, never as silence. Contact fields get the guillemets too now:
  they were exempt while the pane spoke about a real person (a field they
  never answered is honestly blank — information, not a gap), and with nobody
  real to be honest about, a silently empty `[hair_type]` is indistinguishable
  from one misspelled.

## Messages: the tab, the editor, the draft buffer (2026-08-19)

- **The tab is Messages, not Reminders.** Six message types live there and
  exactly one is a reminder; the tab was named after its smallest member,
  leaving the confirmation, cancellation notice, follow-up, win-back and away
  reply with no word on the sidebar — and making "when booked" read as a
  strange kind of reminder. The nav `id` has been `"messages"` all along. Its
  symbol is a speech bubble, not a bell: a bell says "we will nudge you",
  which describes one of the six.
- **Wording is edited through a DRAFT BUFFER, never live** (`waTemplates.draft`
  + `draftUpdatedAt`, ported from Nudge's `templates.draft`). Reminders send
  from a cron, so writing straight to the live row on blur meant a body caught
  mid-sentence was a body a customer could receive — you were editing
  production one keystroke at a time. Blur writes the buffer; the live fields
  do not move until `orgs.commitTemplateDraft`. **No send path may read
  `draft`.** Three bugs are already paid for and must not be reintroduced:
  (1) a draft equal to live is CLEARED rather than stored, or type-then-delete
  pins the "Unsaved" pill forever; (2) the equality check compares the row **as
  it would look after commit**, not the blob alone — a draft is partial (body
  edits buffer `body` + `bodyHtml` and nothing else), so comparing it bare
  reads every untouched field as cleared; (3) Discard re-seeds the editor from
  the LIVE fields rather than waiting for the cleared row, because the
  subscription can still be emitting the blob being thrown away. Meta
  registration (`metaName`, approval `status`) deliberately bypasses the
  buffer and writes live — publishing WORDS must never cost an approval that
  took weeks.
- **The preview is a TAB, not a second column.** Visual | HTML | Preview,
  inside the editor's own frame. The old split rendered the same formatted
  message twice side by side and gave the box you type in half the width;
  Visual already shows the email as it looks, and what the preview alone can
  say is that `[name]` becomes a name and `[date]` becomes a date — a
  different VIEW of the body, which is what a tab is for. Switching to Preview
  and back must never re-parse, or a round trip rewrites the author's HTML
  with tiptap's serialization of it. A WhatsApp-only rule keeps its pane below
  the textarea: there it duplicates nothing, being the only rendering. The
  paper carries no border of its own — inside the editor's panel it would be
  three rectangles drawn around one message.
- **Adding a message shows the words first, in two steps.** Step one picks the
  type; step two carries it as a heading with Back, plus timing and the
  seeded subject/body. One growing form pushed the list, the option just
  clicked and the Add button down the page — the dialog moved under the
  pointer while being read. The seed resolves **this org's own kind-level
  fallback, then stock** — the same order `ensureTemplate` uses, or the sheet
  previews one thing and saves another. Stepping back and re-picking the same
  type keeps your edits; only a genuine change of type re-seeds.
- **Stock wording lives in `convex/lib/templateTexts.ts`, a PURE module**, so
  the browser can read it without pulling the server file's mutations and
  generated api into the bundle. Every lifecycle message ends with the ACTION
  it is trying to cause, on its own line so `renderTokens` drops it cleanly:
  the reminder carries `[manage_link]` (a reminder you cannot act on is how a
  no-show happens instead of a reschedule) and the follow-up carries
  `[booking_link]` (a thank-you that never invites the next visit spends a
  send on nothing). Both used to end on "reply to us", which hands the work
  back to the salon.
- **"Reset to defaults" is gone.** It offered to throw away every rule and
  every word an owner had written in exchange for a state reachable one rule
  at a time. A destructive button does not earn its place under a list by
  being quiet. `messageRules.resetToDefaults` stays for support to call.
- **`booking` / `cancellation` / `out_of_hours` fire immediately and have no
  timing control** (`clampOffset` pins them to 0). A confirmation minutes late
  reads as the booking not having worked — the customer is still holding their
  phone. If a real case appears, it is a suppression rule, not a delay.

## Goods (2026-08-15) — services without a duration

Resepta sells two kinds of thing now: SERVICES (time — a haircut, blocks the
calendar) and GOODS (things — a chocolate cake, a delivery). A good is a
`services` row with **no `durationMinutes`**; the writers floor a real
duration at 5, so the catalog is unambiguous. The model follows Square (one
catalog, two kinds), Shopify (due-time as an attribute on the order, not a
calendar entity) and bakery order-ahead systems (lead time as the only
capacity control worth having).

The invariants, and where they live:

- **On the appointment the sentinel is an explicit `durationMinutes: 0`,
  never unset.** Legacy rows use unset to mean "assume 30", and 0 flows
  through every `?? 30` fallback untouched (`0 ?? 30 === 0`). If you write a
  goods booking, write the zero.
- **A goods order occupies nobody, in both directions.** `overlapCount`
  (booking.ts), `customerConflict` (lib/overlap.ts), voiceBook's guards and
  `bookedBetween` (retell.ts) all skip explicit-0 rows AND zero-length
  candidates. Ten cakes at Saturday 15:00 is fine; a cake never blocks a
  haircut, a haircut never blocks a cake. Guard checks use `!== 0`, not
  falsy — unset must keep meaning "legacy, assume 30".
- **Quantity rides the line, price stays per unit.** `items[].quantity`
  (unset = 1), goods only — "two haircuts" is two visits. `itemsTotal`/
  `lineWorth` (appointments.ts), the revenue report and the WhatsApp
  receipt tokens all multiply; if you sum prices anywhere new, multiply.
- **The voice/chat agents order multiples by REPEATING the name** in the
  `services` array — matchServices accumulates repeats of a good into
  quantity and still dedupes repeated time-bound services. That is why the
  tool schema never changed and deployed agents kept working (template
  bumps: voice v9, chat v3).
- **⚠️ Still open from the build session, verify before trusting goods in
  prod.** (1) **Existing Retell agents are still on template v8** — v9 reaches
  a deployed agent only when its owner clicks the update banner, so until then
  those agents still refuse same-time repeats. Harmless, just stale, but it
  means "goods work" is false for any workspace that has not clicked.
  (2) **None of this has been walked against a live DB.** Schema and function
  changes went in untested: walk one flow of each kind — create a good in
  Business, book it three times at the same time from the calendar, once from
  the /book page with a quantity, and a voice sim if you can get one.
  (3) `chatAgentTemplate`'s service list renders lead time in English
  ("order 1 day(s) ahead") even inside tr/de prompts — cosmetic and
  prompt-internal. Consciously rejected for v1: stock tracking, per-slot caps,
  cutoff times; the next bakery-shaped step if asked is `max_per_day` per good.
- **Goods never touch cal.com.** No zero-length representation exists there,
  and an externalUid makes voiceBook skip its own guards. http.ts and
  chatAgent.ts ask `retell.classifyServices` first; schedule.create skips
  cal.com when the prepared duration is 0.
- **Lead time (`services.leadMinutes`) is the goods capacity control**,
  enforced on customer-facing paths only (booking page, voice, chat,
  self-serve reschedule) — the owner's own calendar may always take a rush
  job. The voiceBook refusal is a sentence naming the remedy; the booking
  page gets reason `"lead-time"`, not a lying `"slot-taken"`.
- **On the grid a goods order is a dashed 20px pin**: moves, never resizes
  (`dragResult` preserves a moved zero-length row). The lane packer lends
  pins 15 visual minutes (`laneMinutes`) so simultaneous orders sit side by
  side — display only, the booking math never sees it.
- **UI conversion is one-way inline**: clearing a duration in the price list
  makes a good (its duration cell becomes the lead column, entered in days);
  there is deliberately no inline path back to time-bound — recreate the row.

Rejected for v1, on purpose: inventory/stock tracking, per-slot order caps,
cutoff times (Square Online has them because web checkout is unattended; the
agent can just be told hours). If demand appears, the bakery-shaped next
step is `max_per_day` per good, not slot windows.

## The mobile pass (2026-08-15) — phone rules that now hold everywhere

A full pass over the app below `sm`, measured against Nudge at identical
viewports rather than eyeballed. The rules it left behind:

- **iOS input zoom is solved in ONE place and must stay solved.** iOS Safari
  zooms the page when a focused field's text is under 16px, and never zooms
  back out. `globals.css` renders every input/textarea/select at 16px below
  sm; number spinners go with it there (~16px of a thumb-useless control);
  `RecordField`'s `compact` takes its container below sm instead of its fixed
  width. Never reintroduce a sub-16px field on a phone, and never reach for
  `maximum-scale=1` instead — that fix takes pinch-zoom away from readers who
  need it.
- **The safe area needs both halves.** `viewport-fit=cover` lives in
  `app/layout.tsx`'s viewport export; the phone tab bar pads by
  `env(safe-area-inset-bottom)`. Either alone does nothing — without the
  viewport opt-in the env() reads 0 everywhere.
- **A view that scrolls inside itself takes the phone's bottom edge.** Nudge's
  rule, ported with its reasoning: such a view has no content end to breathe
  after, so padding under it only shortens the scroll viewport. The view
  declares itself with `data-fills-pane` (Inbox, calendar grids, the customer
  drill-in) and AppShell's `main` drops its bottom padding via `has-[]`. The
  test is the view's own attribute, not a tab-id list — the customer drill-in
  fills the pane while the customers LIST does not, same tab. Reading views
  keep their padding because their content genuinely stops.
- **The scrollbar gutter is sm-and-up.** A touch scrollbar is an overlay and
  takes no width; reserving a 12px track on a phone spends real screen to
  prevent a shift that cannot happen.
- **Phone insets are Nudge's, measured:** `main` runs `px-2` below sm, `Card`
  runs `p-3` (tighter than Nudge's p-4 on purpose — our cards hold multi-column
  rows, not forms). Card content is 446px of a 500px viewport; don't spend it.
- **Phone rows are grids with FIXED tracks, never wrapping flex lines.** Each
  row is its own grid container, so columns align across rows only by asking
  for the same widths (services: `SERVICE_ROW_GRID`, reminders:
  `RULE_COLUMNS`). Every track must hold its value AND its unit at the 16px
  edit size — a too-narrow track must overflow visibly (whitespace-nowrap),
  never stack a number vertically.
- **The phone tab bar is not the sidebar.** It renders `navTabs` minus
  `drawerOnly` entries (Reminders carries it — set-once surfaces give up
  their slot first), and an entry may carry `phoneKey` for a shorter label
  (Voice agent → Agent). The drawer always shows everything under its full
  names. Open: past six visible tabs the bar still degrades; capping at
  5 + More was proposed and deferred.
- **Switches never wear their column label as a word on a phone** — a switch's
  whole job is showing its own state; the label rides `aria-label`. Values
  that cannot speak for themselves (a bare 60) keep their unit.
- **Row deletes are an ×** in a quiet h-7 square (services now matches the
  reminders table) — the word lives on `aria-label`/`title`.

**Service keys moved (Serdar, 2026-08-15).** The Services list is an owner's
price list — name · duration · price · active — and shows NO key at any
width. Keys live in `ServiceKeysCard` under Contact fields on the Voice
agent's strip, because that tab is the agent's vocabulary: everything it
knows by key. This does not re-glue the old "Services & fields" split (that
parted the price list from the field schema, and holds); names in the keys
card are read-only so the price list stays the single editing surface for
what a service is called. Don't put the key column back.

**Decided, not yet built: duration-less services.** Serdar wants services
that are goods, not time — a delivery, a cake. `durationMinutes` is
load-bearing in ~18 convex files (booking slots, overlap, reminder timing,
the agent quoting lengths, ICS end times), so this is a semantics project —
what does a booking of a timeless service mean in each reader — not a
`v.optional()` sprinkle. Spec first.

## The contact record after 2026-08-17 (Nudge's card, ported wholesale)

Serdar rebuilt Nudge's contact page and asked for the same treatment here.
Everything below is a UI port — no domain model came with it. Nudge sells
deals; we sell services, and an appointment is the thing a customer bought.

- **Appointments LEAD the record card**, above the identity fields, in Nudge's
  deal-block shape: a `text-xs font-medium` muted heading carrying the upcoming
  count, an OUTLINED `+ Add appointment` beside it, one bordered card per visit,
  and the finished ones behind a `Show N past` disclosure. Bottom rule only —
  the block sits on the card's own top edge, so a rule above it is a line drawn
  on a line, and the rule below is what stops First name / Phone / Email reading
  as though they belonged to the last visit.
  - The cost, and it is real: First name no longer starts at a fixed position.
    Where the record begins depends on how many bookings the customer has.
  - **Upcoming = ahead in time AND still scheduled or confirmed.** A cancelled
    booking next Tuesday is history: it is not going to happen, and counting it
    promises work that isn't there. Upcoming sorts soonest-first (the query hands
    back newest-first, which is right for history and backwards for plans).
  - Card: service name as the heading and the way into the booking sheet, date
    right; then a LABELLED `Status` picker with the money opposite. Labelled
    because "Confirmed" alone is a word with no question attached — on the
    calendar the column supplies that and a card has no column.
  - No Complete / No-show buttons beside the picker. Nudge has Won/Lost buttons
    AND a stage picker because those are two axes; here status is one axis, and
    a second control for it is two ways to do one thing.
- **The record's two type tiers.** Label 11px `--muted-strong`, value `text-xs`
  `--foreground`, group headings at the label's size in weight 500. Measured off
  Nudge's live DOM, not eyeballed — both apps run a 17px root, so the numbers
  transfer directly. Same size in the same weight for both halves is a FORM's
  grammar: on a form you read the question, on a record you read the answer and
  glance left to see what it answers.
  - The label TRACK is wider than Nudge's (9rem), and the smaller type is what
    buys the room. Our labels are org-authored questions ("what is your best
    friends favorite restaurant?"), not CRM property names, so they are the half
    of the row that runs long — while the values are a first name and a phone
    number and leave most of their column empty.
  - The value tier is opt-in (`dense` on `InlineEditValue` and `PhoneField`),
    never those components' default. They are also the settings screens'
    controls, and a settings row is a question you answer rather than a line you
    scan. Business, Reminders and Account keep the size they were built at.
  - This is the one place the tier doc below reads oddly: it lists "field
    labels" under `--foreground`. That means a settings row's label. A record
    card's label is a group label — navigation text — and sits at
    `--muted-strong`.
- **`InlineEditValue`'s blank option is `clearable`, default true.** It exists
  to CLEAR a value, which is right for an org field somebody filled in by
  mistake and wrong for a value the record always has. On the status picker it
  was a way to hand the server a status it rejects.
- **Notes are a chat**: bubbles, byline above (author + when), click the bubble
  to edit, delete hover-revealed on the byline. No expand/collapse — a bubble
  shows the whole note, which deleted the ResizeObserver that measured a
  snippet's overflow to decide whether to draw a chevron. One column, one bubble
  style: a mine-right/theirs-left split reads as a conversation between two
  people, and a note log is not one — everybody is writing ON the customer.
  - **The composer collapses to a `+ Add note` pill**, top of the tab, next to
    where a fresh note lands. A permanently open composer is a band of chrome
    between you and the notes you came to read. The one-line pseudo-input that
    used to sit there read as "type here" while doing nothing of the kind.
- **An open email thread is a chat**: bubbles, ours green on the right and
  theirs white on the left, oldest→newest, pinned to the bottom, with the
  subject on the card header ABOVE them. It spent one afternoon as Nudge's
  flush Gmail rows and came back (Serdar, same day). Every other thing you can
  open in this pane is a bubble — WhatsApp, and now notes — so mail arriving as
  a table made the email tab the one place the app changed grammar on you.
  - **The known cost, decided with eyes open:** the newest message sits at the
    BOTTOM, so in a long exchange the mail that decides what you do next is the
    one you scroll to. The pane opening pinned there is what makes it
    survivable. Nudge's rows exist to solve exactly this and we chose
    consistency over it. Don't "fix" it back without asking.
  - **The subject leads each bubble** (Serdar, asked for after a version without
    it). Not redundant with the card header, which names the THREAD: threads
    group on a NORMALIZED subject, so the original and its three "Re:" replies
    sit under one heading and the bubble is the only place you see which a given
    message was. It also rescues the body-never-arrived case — the provider
    hands us metadata first and the body on a second call.
  - **The header wears whatever plane is below it**: the card's white over the
    index (flush rows on white), the tinted plane over an open thread. Left
    white it cut a bright band across the top and the tint began abruptly under
    it, which read as two stacked panes rather than one conversation with a
    heading.
  - `chatOrder` is therefore WhatsApp **plus** an open email thread, and the
    bubble keeps its `emailHtml` branch (sanitised, and only inside a thread —
    in a list a formatted mail is a wall).
- **Notes are rich text too**, same editor, same `compact` mode. A note is where
  the salon writes down what matters about a person — an allergy, a price
  agreed, three things to check next time — and a list is the natural shape for
  that, which plain text could not make.
  - **There is no is-it-html flag, deliberately.** Nudge shipped one and it
    became a lie the first time somebody edited an old plain note in the rich
    editor: the row stored markup while the column still said plain, and the
    note rendered its own tags as text. `bodyIsHtml` judges the BODY, and
    requires a real tag NAME so a note reading "bütçe < 5000 TL" stays plain.
  - Nothing stored is migrated. `plainToHtml` converts a legacy note on the way
    INTO the editor, so its paragraph breaks survive and a note nobody edits is
    never rewritten.
  - `noteText` flattens for the All index and any future search — a row reading
    "<p>Amonyağa" is worse than useless. The All index's in-place expander
    renders the markup, and only for notes: a WhatsApp message is always the
    text somebody sent.
  - `hasNoteText` lives in `convex/lib/noteBody` so the mutation and the button
    share one answer about what "empty" means — an empty tiptap document is
    "<p></p>", so `!body` is the wrong test on both sides. Same arrangement
    `lib/emailInbound` already has with `normalizeSubject`.
- **Quoted replies are split at RENDER, never at ingest** (`lib/emailQuote`).
  A client does not send what somebody typed, it sends that plus the whole
  thread quoted underneath — and a bubble shows its whole body, so without this
  the third message in a thread contains the first two and a four-mail exchange
  renders as ten. The quote goes behind a "•••", the way every mail client
  draws it.
  - **Nothing is stripped on the way in.** The full mail is stored as it
    arrived. This is a pile of heuristics against a format no two clients agree
    on, and a heuristic that runs once against the database can destroy a mail;
    one that runs at render is a display bug you fix by editing the file.
  - HTML is matched on STRUCTURE (`div.gmail_quote`, `blockquote.gmail_quote`,
    `#divRplyFwdMsg`, `#appendonsend`, `.moz-cite-prefix`,
    `blockquote[type=cite]`), never on the "On … wrote:" sentence: that line
    arrives split across tags, localised and formatted, and a regex loose enough
    to catch it is loose enough to cut a mail in half at the word "on". Plain
    text has no structure, so there the attribution IS the signal — and English,
    German and Turkish disagree about word order, so the pattern requires the
    line to start with the marker and END on a colon rather than pinning the
    verb to it.
  - Two invariants, both worth keeping: `visible + quoted === input` exactly
    (trimming is the renderer's business), and **if the cut leaves nothing
    readable, show the whole mail** — a top-posted reply with nothing above the
    quote must not render an empty bubble.
  - Only email is split. A WhatsApp message that starts a line with ">" is
    somebody typing an arrow.
  - The index snippet uses `quoteFreeSnippet`: a row reading "On Mon 17 Aug,
    Barber wrote:" is describing the mail BEFORE this one.
- **The email composer is the rich editor**, `EmailBodyEditor` in `compact`
  mode: no frame of its own (the composer is already a box), no Visual/HTML
  switch (nobody hand-writes HTML in a reply — that earns its place in the
  reminder editor, where the thing being written is a template), and **no
  variable dropdown**: tokens are for a template that gets rendered per
  customer, and nothing renders a one-off reply, so an inserted `{{name}}`
  would reach the customer as those eight characters.
  - `onLiveChange` AND `onSave`. The editor only reports on BLUR, so a Send
    gated on the blur-written value sits disabled the whole time you type and
    wakes only when you click away.
  - "Empty" is not `""`. tiptap serialises a blank document as `<p></p>`, so
    Send asks whether anything was WRITTEN (tags stripped, `&nbsp;` collapsed).
  - `email.sendToCustomer` grew an optional `html`. `body` stays the plain lane
    — the chat agent and the auto-reply still send only that — and when `html`
    is present the action derives `body` from it with `htmlToText` so the feed
    index and the inbox preview read words while the thread renders markup.
    Outbound rows carry `emailHtml` now (`logOutQueued`), which is what makes
    OUR half of a thread render the way it was written.
  - It is safe to send that markup unescaped because of where it comes FROM:
    tiptap serialises its own document, and pasted markup is coerced into the
    editor's schema on the way in. Markup arriving from outside — an inbound
    mail — is sanitised at render, which is where the untrusted HTML actually
    is. Convex's runtime has no DOM, so `isomorphic-dompurify` cannot run there
    anyway; don't try to "add server-side sanitising" without reading this.
  - `compact` also drops the rule under the toolbar. It earns its place in the
    framed editor, where the toolbar is a band inside a box and something has to
    say where the band ends; in a composer there is no box and no band, so the
    line is decoration. Borders belong to containers.
  - **Reply strips existing prefixes before prepending** (`stripReplyPrefixes`,
    the un-lowercased half of `normalizeSubject`). The thread's title is the
    subject of whichever mail opened it and usually already carries a "Re:", so
    prepending blind gives "Re: Re: Saç boyası hakkında soru".
- **Feed pills are their mark and their count, nothing else.** Notes and Form
  used to carry their word (a bare pencil among channel glyphs reads as "edit
  this contact"). Four words across the row was most of the header spent
  labelling marks the reader knows, and the selected pill grew wider than its
  neighbours, so picking one moved them sideways. All keeps its word: it has no
  mark to be. Names live on `title` + `aria-label`.

### The WhatsApp tab, its order, and its wallpaper (2026-08-17)

- **The WhatsApp pill shows whether or not a number is connected.** It used to
  hide until connected — an org with no number has no history and no way to make
  any — but that contradicted the rule right beside it: an empty Call or Email
  tab means "we haven't yet", and the tab is a STANDING OFFER. Connecting a
  number is a thing the owner can go and do, and a channel hidden until it works
  is a channel nobody discovers.
- **So the composer has to answer for an unconnected org.** `waReady` (a
  connected Cloud number OR the Evolution lane) kills the composer and puts
  `contact.waNotConnected` above it — which NAMES the fix and where it lives
  rather than saying "not configured". Optimistic while the settings query is in
  flight: a false sentence that corrects itself is worse than a control that is
  briefly live. Not connected outranks the 24h window in that line — there is no
  point telling somebody to wait for a reply on a channel they cannot send on.
  - This was a real hole before the pill changed: the tab was unreachable except
    through All, where it quietly offered a Send that came back
    `wa-not-configured`.
- **Channel order is `call · whatsapp · email`** (`FeedIcon.CHANNELS`, the single
  source both the pills and the inbox's "reachable on" strip read). WhatsApp sat
  last on the grounds that many orgs never connect it — the same backwards
  reasoning that hid the pill. This is Turkey: WhatsApp is how a salon and a
  customer talk, and email is the formal fallback.
- **The WhatsApp thread wears a wallpaper** (`.chat-wallpaper`, ported from
  Nudge). Light: `--chat-paper` #f2eee7 under a veil of its OWN colour (a layer,
  never `opacity` — that would fade the messages sitting on it) and the tile at
  380px, small enough to be texture rather than drawings. Dark drops the pattern
  entirely and goes near-black paper with LIFTED bubbles; a dark tile was tried
  in Nudge and read as busy at every gain that was visible at all.
  - The composer's field is `--chat-field`, not `--card`: on dark, `--card` IS
    the bubbles and the paper, so a `--card` pill vanished into it.
  - **An open email thread keeps the flat `--thread-bg`.** Mail is not a chat,
    no client wallpapers it, and giving it one would say the two channels are
    the same thing.
  - **An OPEN CALL gets the paper too.** The rule is per SURFACE, not per tab
    (Nudge's wording): a transcript is a conversation. The calls LIST does not —
    rows on a patterned ground read as a table somebody spilled something on,
    which is the same reason the email index and notes stay on the card.
  - **The surface is painted ONCE, on the panel's root.** A repeating background
    origins at its own element, so a header, a scroller and a composer each
    tiling the doodles put three different phases of the pattern side by side
    and seamed at every boundary. One parent, one continuous sheet.
- **The opened call is Nudge's layout, ported back.** Everything the call
  PRODUCED — summary, how it ended, what it cost, what it collected — is ONE
  raised card on the paper; three separate blocks made the reader assemble that
  themselves. The transcript's bubbles then sit DIRECTLY on the paper with no
  box: a card there would be a third surface level (paper → card → bubble) and
  would leave the agent's bubble with nothing to be white against.
  - Both the card and the agent bubble read `--chat-field`, never `--card`: in
    dark, `--card` (#171717) against a #0f0f0f paper is near invisible, and
    `--chat-field` is the raised surface defined against the paper in both
    themes. This retired a short-lived `--paper` token that was solving the
    white-on-white symptom rather than the surface problem.
  - No "Transcript" heading. A column of chat bubbles is self-evidently the
    conversation, and the label was one more line of chrome between the summary
    and the thing you opened the call to read.
  - **The PANE scrolls the whole call, not just the transcript (2026-08-18).**
    It used to stand its own scrollbar down (`overflow-hidden`) for an open call
    and let the transcript scroll inside a `flex-1` — right that two scrollbars
    in one card is a trap, wrong about which one to remove. The summary card is
    `shrink-0`, so eight collected values pinned most of the pane, left the
    transcript on its 128px floor, and CLIPPED whatever the card itself could
    not fit, with no way to reach it. **The summary is read ONCE and the
    transcript is read THROUGH, so the summary is what scrolls away.**
    `CallTranscript`'s `flow` prop is that mode. Voice → Calls and the mixed
    feed keep the 24rem cap, where an uncapped transcript would bury every card
    after it.
  - `pr-3` on the transcript scroller belongs to the CAPPED mode only: there the
    caller's bubbles are right-aligned and butt against its own thumb. In `flow`
    the transcript has no thumb — the pane's scroller reserves its gutter
    outside the padding — so the bubbles run to the same edge as everything else
    on the paper.
  - **OUR side is on the RIGHT — the agent — and the caller is on the left**,
    the same arrangement the WhatsApp thread uses in the same pane. It was the
    other way round, which is what call-ANALYTICS tools do because there the
    customer is the subject being studied. This is not that tool: it is the
    salon's inbox, one pill away from a thread that already taught "right and
    emerald is you", and nobody should re-learn the sides per tab.
  - **The agent's bubbles are emerald, the caller's are `--chat-field`.** The
    caller's used to be `--accent`, which is this app's ACTION colour — Reply,
    Compose, Send, Place call are all that blue — so blue meant "click me" and
    "the customer said this" on one screen. Colour carries the PARTY (emerald is
    our side, the same as an outbound WhatsApp message) and alignment carries
    the flow, so neither does the other's job.
- **Place call shows only when the org has exactly ONE enabled voice agent**
  (Serdar's call, 2026-08-17). An org can hold several — VoiceView is a list you
  drill into — so there is no "the org's agent" to default to, and a button that
  guesses rings a real phone from the wrong line. With several, the call is
  placed from the Voice agent page, which already made you choose.
  - **It always confirms, naming the number.** `retellAgent.testCall`'s own
    comment demands it: there is no dry mode in Retell, the phone genuinely
    rings and the minutes are genuinely billed. "Call this customer" and "call
    +90 533…" are different amounts of certainty.
  - The button sits in the call tab's header on the LIST as well as inside an
    open call — the email tab's shape. List-only would put the one control you
    reach for after reading "customer did not answer" a navigation away from
    the row that said so.
  - The agent list query is owner-gated server-side, so for staff it resolves to
    undefined and the button never appears rather than appearing and failing.

### The inbox arrives with nothing selected (2026-08-17)

> **SUPERSEDED in part by "The inbox stopped being a second conversation
> screen" (2026-08-22) below.** A row does not fill the right pane any more —
> it opens the CONTACT RECORD. The pane still stands as a placeholder, so
> "arrives with nothing selected" is now its permanent state, and the
> `opened`/`selected` split described here is deleted: nothing is ever watched
> from the inbox, so the row stamps read on its way out.

Matching Nudge. It used to open the newest conversation for you, which is the
app deciding what you came here to read — and on a list whose top row moves
whenever anyone writes, the thing it opens is different every visit. An inbox is
a list you choose from; the right pane says so until you do.

- This retired the `opened` / `selected` split's original reason. `opened`
  existed to be distinguishable from an auto-selection, because the
  auto-selected conversation must NOT get a read stamp — landing on the Inbox
  would otherwise silently mark the newest thread read. With no auto-select
  there is one kind of selection left; `opened` now just means "the one you
  clicked", and it still owns the read stamps.
- **The grid is two columns from lg whether or not anything is open.** It used
  to collapse to one when nothing was selected, which was invisible while the
  only way to have nothing selected was backing out on a phone — where the
  layout is one column anyway. The moment arrival became the empty state, that
  rule put the empty pane underneath the list instead of beside it.

### A shared component must never rely on a BARE Tailwind `group`

`group-hover:` matches ANY ancestor carrying the class, not the nearest one. The
editor toolbar's tooltips used a bare `group`, and the moment that toolbar was
mounted inside the note bubble — whose row is a `group` so its delete button can
appear on hover — hovering anywhere in the note lit every tooltip at once and
stacked them on top of each other. Named groups (`group/tip`, `group/note`) only
answer to their own name. Use one in any component that can be mounted inside
something else, which is all of them.

## Business is one page (2026-08-12, later the same day)

Supersedes the chip-strip parts of the section above. Sidebar: Customers ·
Inbox · Campaigns · **Voice agent** · **Services & fields** · Revenue (flag) ·
Calendar · Reminders · Business.

- **`BusinessView` has no chip strip.** It is one page stacking three cards:
  General, Hours, Team. The strip had shrunk to three entries that all answer
  "what is this business", and it kept apart two things that are halves of one
  calculation: `getAvailableSlots` derives a bookable slot from the business
  hours AND `orgCapacity`, the count of active staff. Changing capacity used to
  mean leaving the screen showing when you are open.
- **The old objection was answered, not ignored.** Stacking Hours under General
  was declined twice on the grounds that General carried nine rows across three
  unrelated jobs, so an open/close grid appended to it landed below the fold.
  Two things changed: General shed Timezone to Hours, and the header search now
  SCROLLS to a card instead of switching sections. "Where do I change opening
  times" is one query, not a scroll hunt.
- **Timezone lives on Hours**, not General. "09:00 to 18:00" means nothing
  until you know whose 09:00, and the calendar already treats them as one
  setting when it projects closed bands from the business timezone onto the
  viewer's.
- **Services is a sidebar destination**, not a Business chip, and it holds
  services ALONE. A price list is content you maintain, not a setting you
  configure, and the voice agent plus the booking page both read it at call
  time. It sits under Voice agent for that reason. Putting it in the FOOT group
  was considered and rejected: that group means "about this business", which is
  the category it already occupied, so it would have bought one click and said
  nothing.
- **Contact fields are edited from the Customers column picker**, at its foot,
  in a Sheet. They ARE the columns of that table, and the standing rule puts
  rare actions at the foot of the picker rather than on a permanent toolbar
  button. The tab was called "Services & fields" for half a day and Serdar was
  right that it sounded stupid: the ampersand was holding two unrelated nouns
  together. Services are what the business sells; fields are what it knows
  about a customer.
  **Two homes were tried and rejected on the way**: the Voice agent strip (the
  agent's Locked / Can edit column makes it LOOK like the agent owns them, but
  it is one consumer among forms, campaigns, email, wa, mcp and the contact
  record), and a fourth Business card (re-grows the page that was just
  slimmed). `FieldsCard` still lives in `BusinessView`, which owns its helpers,
  and renders untitled because the Sheet carries the name and the (i).
- **Knowledge stays on the Voice agent strip FOR NOW, and this is temporary.**
  `convex/lib/chatAgentTemplate.ts` already reads it, so it is shared between
  the voice and chat agents today, and Serdar intends WhatsApp and email agents
  to read it too. When those ship it earns its own destination with them, and
  the Voice agent row probably becomes multi-channel. Do not file it under
  Business on the way; that was the scavenger hunt it was moved out of.
- **`?section=hours` still works.** The Calendar's "Edit hours" button deep
  links with it. There are no sections to switch to now, so the param means
  "scroll to that card" — the destination it always meant.
- **Recent activity is NOT in the tenant app.** It was a sidebar row for about
  an hour and came straight back out. An audit log is a debugging surface, its
  readers are operators, and a salon owner has no use for a page of "settings
  changed / businessHours". It lives on the platform admin's org page under
  Activity, as **Account activity** above the existing **Message activity** —
  two feeds that answer different questions and were both called activity.
  `convex/activity.ts` `enrichActivity` is shared by both reads and takes
  `maskOperator`: the salon's own feed attributes operator work to the brand
  and never ships an operator's name to that browser, while the platform feed
  names the person, which is the question that page exists to answer.
- **AI is on Account, not Business.** An MCP key is minted and revoked by one
  PERSON; `McpCard` sits outside the owner-only fieldset on purpose.
- **Nothing is closable.** `ShellHeader` has no ✕ and no `closable` prop.
  Business and Account both traded it for the header search box; the sidebar is
  the way out.
- **`TAB_IDS` in `AppHome` is a second whitelist beside the `TabId` type, and
  it fails SOFT.** A tab missing from it falls back to the calendar, so a new
  destination's sidebar row works while its deep link silently does not.
  Typecheck cannot catch this. Add the id in both places.

### Business searches from the header, and has no ✕

`BusinessView` claims the shell's search box with `useHeaderSearch`, the same
call Customers and Inbox make, so it renders the same component in the same
corner and collapses to the magnifier on phones for free. The ✕ is gone: the
header fits one control on the right, and the sidebar is the way out of every
other tab. **Account keeps its ✕** — it is the one destination with no sidebar
row to return from, so `closable` is now `tab === "account"` alone.

The search looks ACROSS sections, not inside the open one: the question is
"which screen is this setting on", so a hit renders the setting's name with its
section beside it, and picking one opens that section and clears the query.
`SEARCH_INDEX` is **hand-maintained** — the settings are spread over seven card
components with no runtime register to enumerate — so add a line when you add a
row. Forgetting costs one unfindable name and nothing else. Never index a key
that does not exist in `i18n.ts`.

### Text has three tiers, not two

Ported from Nudge the same day, and the reasoning is identical because the
palette was byte-identical. `--foreground` (#171717) is primary: page titles,
table data, field labels, active nav. `--muted-strong` (#4d4d4d light, #cccccc
dark) is text you read to NAVIGATE: idle nav, column headers, group labels.
`--muted` (#737373) is genuine de-emphasis only: timestamps, hints,
placeholders, empty and loading states.

Shipping only the outer two put navigation and table data in the timestamp
grey, which reads defensive — `--muted` on white is 4.7:1, the WCAG AA floor,
against Vercel's 8.4:1 for the same job. **Only ABSENCE is de-emphasised:** a
cell with a value is `--foreground`, its em-dash placeholder is `--muted`. A
`<td>` with `colSpan` is an empty or loading state and stays quiet; one without
is data. `--page-title` was `#334155`, slate-tinted AND lighter than the body
text beneath it; it is `var(--foreground)` now. Cross-project version lives in
Mana, `40_Patterns/preferences.md`.

## The IA after 2026-07-31 (Settings is gone — don't reintroduce it)

> **Partly superseded by the 2026-08-12 section above.** The sidebar list below
> is stale (Phone agent is Voice agent, Knowledge moved onto it, Reminders sits
> under Calendar). Everything about `VoiceAgentPage`, variables and drafts still
> holds.

Sidebar: Customers · Inbox · Campaigns · **Phone agent** · **Reminders** ·
Calendar · Revenue (flag) · Business. There is no Settings tab. Where things
went, and the reasoning to preserve:

- **Phone agent** (`VoiceView`, tab id `voice`): work, not config. Two
  sections. *Agents* is `VoiceCard` — connect/archive agents, pick the inbound
  number from the account's real numbers (never free text), enabled toggle
  (keeps the wiring, stops bookings), per-row details expansion (collected
  fields, call counts, connected date), and `VoiceAgentPage` (click the name,
  deep-linked as `?agent=`). It is a PAGE, not a sheet, and ONE COLUMN, not
  tabs: instructions → opening line → voice → variables, the order a call
  happens in. Both were tried and both failed the same way — a modal gave the
  prompt eight lines, and tabs made the first screen a lone textarea over dead
  space with the variables hidden behind a pill. One Save in the header covers
  everything; the variables editor keeps its own draft and reports dirty/busy
  up via `onSaveStateChange`. Variables publish BEFORE the prompt, because
  `publishVariables` guards on the agent's provider version and the other
  order fails with a stale-version error. Voice rides the same Save through
  `publishViaDraft`'s `agentPatch`, so voice and script land as one version.
- **An unsaved agent draft survives leaving, closing the tab and reloading**
  (`randevu.agentDraft.<agentId>` in localStorage; prompt, opening line, voice
  and variable rows). There WAS a leave-guard dialog that discarded on
  confirm — the wrong trade, since a half-written prompt is real work and the
  amber pill already stops a draft reading as live. Discard is now the only
  thing that throws work away. Deliberately per-browser, not on the server: an
  unpublished prompt is one person's thinking, and syncing it would put text
  nobody decided to ship in front of a colleague. The editor takes the
  recovered rows as `seed` while `initial` stays server truth, which is what
  makes a restored draft still report itself as unsaved.
- **Variables are edited inline, not in a sheet** — the one documented
  exception to the sheet rule below, because a grid you retype a description
  in is not a form you open. Rows group under Before / During / After by their
  MOST ACTIVE phase (`duringMode` wins, then `afterCall`, else before-only): a
  Resepta variable is a lifecycle, not one moment, and the row's popover —
  type, choices, phase, destination, required — is what moves it between
  groups. The row itself carries no state pills: what a variable is comes
  from its name (a picker selection), the rest lives in the popover. A key that is
  already published never follows a label edit; renaming it orphans every
  answer collected under the old name. **A variable's name is a selection,
  never free text**: both "+ Add variable" and every row's name cell open the
  same picker (voice customer fields → built-in context → create a field
  inline → explicit call-only name), so a variable that stores customer data
  always references the one field registry; picking or creating a field
  pre-wires prefill + ask-if-missing, the repeat-caller default, and clicking
  a row's name re-points its whole identity (label, key, type, link) at once. Deleting a referenced customer field is refused
  backend-side and the Business row hides delete while "used by" explains.
- **`PromptEditor` renders `{{tokens}}` as pills** via a mirror div under a
  text-transparent textarea. Not a contenteditable: that takes the caret, undo
  stack and IME with it. Used twice — the prompt, and the opening line in
  `singleLine` mode.
  *Calls* is a paginated table over the `calls` table, opening into
  `CallDetail`. The word "webhook" never reaches the client; broken plumbing
  renders as "call results are not reaching the app" + Fix, and only when it
  is actually broken.
- **`CallDetail` is the only way a call is rendered** (`src/components/
  CallDetail.tsx`): recording, summary, why it ended, collected values, then
  the transcript as a conversation. Used by Phone agent → Calls, the contact
  feed's expanded Calls column, and the mixed feed's card. Three surfaces used
  to render three different subsets of one row. The transcript is PARSED from
  the string already stored on `calls.transcript` (speaker-prefixed lines),
  not refetched, so it works for every call ever recorded.
  `calls.disconnectionReason` is stored raw and humanized in the UI — it is
  the only thing that explains a row with no summary and no transcript, which
  is every unanswered call.
- **Resepta is the phone-agent control plane.** The business declares customer
  information once in Resepta; provider variables, analysis fields and runtime
  tools are compiled output, never a second user-managed schema. Adding or
  fixing an agent publishes its private Resepta runtime connection. Confirmed
  details are written during the call, every signed call event first lands in
  the durable `voiceEvents` inbox, and a per-call analysis recovery closes the
  gap when the later analysis event is missed. Normal retries are invisible to
  the business; exhausted updates show a provider-free warning in Phone agent
  and raw diagnostics plus replay live only in platform admin.
  **Retell is an implementation detail.** Salon-facing UI never names Retell,
  exposes provider IDs or URLs, or asks the owner to copy provider
  configuration. Use native Resepta language such as Phone agent, Call
  results, Instructions and Variables. Provider identity and diagnostics stay
  in platform admin and backend code; existing configuration is imported
  silently into the Resepta editor.
- **Reminders** (`RemindersView`, tab id `messages`): the old SettingsView,
  renamed. Reminder rules + the WhatsApp connection.
- **Business → Team** (`PeopleCard`, rewritten 2026-08-02). ONE list of
  people, the way Fresha and Square show it: who can sign in and who can be
  booked are two COLUMNS, never two cards. The vocabulary is **Team /
  Member / Available**, fixed (see rule 5 below).

  - **Removing somebody is two surfaces, not two states of one control.** The
    Team card's row action ARCHIVES; deactivated members drop into their own
    collapsed card, and that is the only place anything is destroyed.
    `staff.remove` refuses while a member is still active. Appointment history
    does NOT block it — the confirmation names what it costs instead, from
    `roster.hasAppointments`. An earlier version blocked on history and it was
    wrong: a name is not worth making a row permanent.
  - **Members with a login pin to the top and cannot be dragged.** Row order
    is the calendar's column order, so a member floated up by having an
    account is not standing somewhere else on the rota; a handle there would
    write an order the list then refuses to show.
  - **Invites carry `staffId`.** Sent from a member's row, the accepted invite
    attaches to THAT member (`convex/auth.ts`) instead of arriving as a second
    row for one human. `team.invite` links immediately when the account
    already exists, since there is no acceptance to wait for.
  - Destructive confirmations use `useConfirm` (`ConfirmDialog.tsx`), never
    `window.confirm` — the browser's box says "localhost:3006 says" and its
    buttons cannot be worded.
- **Business → AI**: `McpCard`, self-serve MCP connector keys (Claude/ChatGPT
  paste-once flow). Lives beside Team on purpose: a connector key acts as a
  person and lands in the activity feed under their name. Not owner-gated —
  keys are per person; the backend scopes create-to-self / revoke-others-to-
  owner.

  The connector is a CONTROL surface, not a reporting one: alongside the
  customer/appointment tools it can list and create services and contact
  fields and create a phone agent (`convex/mcp.ts` → `convex/agentTools.ts`).
  Permissions are re-derived from `memberships` in `agentTools`, never read
  off the key, so the connector cannot become a way around the app's own
  owner-only rules. Phone-agent creation is journalled `reversible: false` —
  it makes a real provider resource and `undo` says so in those words.

  The surface has four more lanes, ported from Nudge (2026-08-18):

  - **Ingest** — `create_customers` seeds up to 100 people, deduped by phone,
    parsing local numbers against the org's dial code exactly as
    `update_customer` does; an unreadable number is REPORTED, never dropped.
    `log_activity` writes calls and messages that ALREADY HAPPENED. Nothing it
    writes is sendable: rows land terminal (`sent`/`received`) with none of
    `scheduledFor`, `nextAttemptAt` or `sendingAt`, which is what makes all
    three dispatch paths (`wa.ts`, `delivery.ts` ×2) structurally blind to
    them. Email logs under the `email_` prefix because `channelOfMessage`
    reads the prefix to decide the lane. `messages.occurredAt` carries the
    real moment so imported history does not stack on the import date.
    KVKK consent is never inferred from importing.
  - **Reports** — `agentReports.ts`. Counted in the database, never by the
    model, which otherwise tallies a paged list and produces a confident wrong
    number. No-show rate is taken over RESOLVED appointments only. The message
    scan is capped and says when the cap ran out before the window did.
  - **Prompt lifecycle** — `read/preview/publish_agent_prompt`. The planToken
    (`lib/planToken.ts`, vendored from Nudge) binds preview to publish: it
    hashes the exact agent and text, so a prompt cannot reach callers unless
    the shipped text is the text a human was shown. Undo of a publish branches
    in the MCP handler, not the mutation — restoring is itself a network
    publish, and a scheduled one would report success before it happened.
    `markUndone` re-checks ownership because it is a second door into the
    state change `undo` guards.
  - **Automation config** — `list_message_rules`, `get_template`,
    `set_message_rule`, `update_template`. Every rule write schedules
    `reminders.backfillOrg`, forward AND on undo, because timing is baked into
    each appointment's `nextMessageAt`. The trap the descriptions carry: a
    Meta-approved template still sends the string Meta approved, so rewriting
    `body` moves email and the shop phone and leaves Cloud WhatsApp unchanged.
    The result names which case it was.

  The tool LIST is role-scoped (`OWNER_ONLY` in `convex/mcp.ts`) so a stylist
  is not offered owner-only work. That is presentation, not permission — the
  handlers still gate.

  **The invariant that keeps the sessionless paths safe:** three internal
  functions — `voiceProvisioning.begin`, `retell.agentEditorContext` and
  `retellAgent.publishVariableSet` — accept an optional `orgId` and TRUST it.
  That is fine only because each is internal AND no public action forwards a
  caller-supplied `orgId` into one. `createAgent` and `publishVariables` must
  therefore never grow an `orgId` argument: `agentEditorContext` only checks
  that the agent belongs to the org it was handed, so a public action taking
  one would let a client edit any agent whose id they could name. Internal
  twins (`createAgentForOrg`, `publishVariablesForOrg`) exist precisely so the
  public pair never has to. Commented at both ends; move them together or not
  at all.

  Provisioning reads `agentEditorContext` at the END, for the runtime wiring.
  A sessionless caller that skips this gets the worst half: a real provider
  agent, connected and enabled, with no Resepta runtime — able to answer a
  call and neither read nor write anything.
- **Bookings (cal.com) config**: operator-only, admin console
  (`platform.setOrgConfig`). Never show a salon a cal.com key field again.
  The admin card itself is hidden too (Serdar, 2026-08-19) — the
  `SHOW_CALCOM_CARD` guard in `src/app/admin/[orgId]/page.tsx` keeps its JSX
  compiling while nobody can configure the lane. See "Appointment intake".
- **`orgs.voiceAgentSource` is DERIVED, not toggled** (2026-08-20). It was a
  Connectable-agents switch on the admin page that an operator had to
  remember, and a forgotten flip leaked other clients' agents into a salon's
  picker. `connections.setFieldInternal` now decides it the moment a Retell
  key lands: equal to the platform key ⇒ `"randevu"` (shared workspace, the
  picker scopes to agents tagged for this org), anything else ⇒ `"account"`
  (the client's own Retell account, whole workspace theirs to see).
  `stampDefaultRetellKey` sets `"randevu"` on the auto-provision path, which
  writes the connections row directly. Decided at WRITE time on purpose: a
  read-time comparison would silently reclassify every stamped org the day the
  platform key rotates. The odd case — a second key minted for the shared
  workspace — is set by hand through `platform.setOrgConfig`, which still
  accepts the field.

**An operator revocation must reach the PROVIDER, not just the row**
(2026-08-21). Taking a phone line off a tenant in /admin edited
`orgs.allowedPhoneNumbers` and nothing else, so Retell kept routing that
number to the tenant's agent: every inbound call still reached a business the
console said had been cut off, and the line could not be given to anybody
else, because binding refuses a number another agent still holds.
`setAllowedPhoneNumbers` now schedules `retellAgent.releaseOrgLines` for the
numbers the edit actually DROPS — released from every agent of that org, both
directions, app-side `agentLines` and the cached `retellAgents.inboundNumber`
cleared with it. Two things to keep: the drop set is computed BEFORE the patch
overwrites it, and it is empty when the new list is empty, because an empty
allowlist means "not restricted" rather than "no lines" — detaching everything
there would invert the operator's intent. The general rule this is an instance
of: **when an admin surface takes something away, ask what still holds it at
the provider.** A console that only edits our own row is describing a state
nobody else agreed to.

**Admin console shape** (2026-08-19/20). Per-business tabs are Setup, **Voice
agent** (agents, phone lines, and the voice meter + wallet that used to be a
separate Usage tab), **Chat agent**, Members, Sends, Logs. One Agents card
lists every agent whatever its origin — created-by-Resepta and
connected-from-Retell were two cards saying contradictory things — with
in-flight or failed provisioning jobs below it, never completed ones. Phone
lines shows only this business's numbers until "Add a phone line…" opens the
account's inventory. The Email card is GONE: both its fields are the salon's
own settings. Platform tab order is Email, AI &amp; Voice defaults (Retell key
first; each LLM provider is one row carrying key + model), WhatsApp,
Billing (voice rate lives with the Stripe keys), Kill switch alone at the
bottom, admins as a footer. **Grey text in an admin input is always a fact** —
either the stored secret's tail or the real default that applies when blank.
Never an example value; an empty field must mean empty.

Retell facts that keep getting relearned (also encoded in `convex/retellAgent.ts`
comments): a published agent/LLM refuses PATCH — every publish is
clone-draft → patch the LLM version THE DRAFT points at → publish the draft.
Retell sends `call_ended` first and analysis on a later `call_analyzed`;
`recordCall` merges the second event into fields the first couldn't know.
`calls` rows carry `retellAgentId` and `collected` since 2026-07-31 — older
rows have neither. One agent can serve only one deployment: the webhook URL
points at dev OR prod, so a dev workspace sharing prod's agent truthfully
shows "results not reaching the app" — do not "fix" it from dev, that steals
the webhook from prod. The live update-retell-llm endpoint disagrees with the
SDK docs on MCP payloads (learned 2026-07-31 from a failed prod provisioning):
each `mcps` entry needs an `id` field ("MCP id cannot be empty or null"
otherwise; docs don't list it), and `type: "mcp"` general_tools must NOT carry
an object `input_schema` — the validator wants string-valued
properties/required and 400s on objects, so omit it and let tool discovery
read the schema from `/retell/mcp`. Webhook signatures are computed with the
ONE workspace key carrying the "Webhook" badge in Retell's Settings → API
Keys, not with whichever key an org has installed — a different stored key
passes every API call yet 401s every webhook, which reads as "no call results"
with zero rows in `voiceEvents`. **The platform `retellApiKey` (the key
auto-provisioning STAMPS into every new org) must therefore BE the
webhook-badge key** — learned in prod 2026-08-21 when Sun Klinik onboarded
through the wizard with a second, non-badge key as the platform default:
`retellGuard` verifies call-inbound, call-ended AND /retell/functions against
the org's stored key, so the one wrong stamp produced the whole symptom set
at once — an agent with no ring-time context, tools that all failed ("no
access to the calendar"), and no call results. Fixed by promoting the badge
key to the platform default and re-stamping the affected orgs via
`connections:setFieldInternal`.

Native phone-agent creation is Resepta-owned. **Add agent** defaults to creating
an appointment receptionist from the versioned template in
`convex/lib/voiceAgentTemplate.ts`; connecting an existing agent is the second
path in that same sheet. `voiceAgentProvisioning` checkpoints the response
engine, agent, publication and connection behind a short lease, so retries
resume the same job instead of intentionally creating another one. The app may
assign an already-provisioned, unclaimed phone line but never buys numbers.
Provider names, ids, models and plumbing errors stay out of the salon UI; raw
setup state is visible only in platform admin.

**Platform admin 404s for everyone else.** `/admin` and `/admin/[orgId]` call
`notFound()` when the viewer is not an operator, rather than rendering "this
page is for platform operators". A refusal that explains itself tells a salon
owner the console exists and invites them to ask for a login — the same reason
a private repo 404s rather than 403s. Its tabs are Setup (credentials installed
once), Agents (running state), Members (who can sign in, with addresses — the
first thing a support call needs, and unfindable otherwise because sign-in is
Google-only) and Activity.

The complete create/connect flow, variable lifecycle, call-event pipeline and
operator verification checklist live in [`docs/phone-agent.md`](docs/phone-agent.md).

## The chat agent (2026-08-10) — invariants, spec in docs/chat-agent.md

- **Tool identity comes from the channel, never the conversation.** Every chat
  tool executes bound to the (orgId, customerId) the webhook resolved; the
  model chooses arguments, never identities. No tool reads another customer,
  and no prompt text is load-bearing for safety. Do not add a tool that takes
  a customerId or searches customers.
- **The disclosure line is mechanical.** `chatAgent.respond` prepends it to
  the first SENT message per customer; it is never the model's job and never
  removable per org (WhatsApp 2026 AI policy + EU AI Act Art. 50).
- **off → shadow → live** (`orgs.chatAgentMode`) is operator-set from /admin
  only. Shadow runs everything and sends nothing; its replies live in
  `chatAgentTurns`, the flight recorder that is also the raw LLM ledger.
  `usageMonthly` is incremented in the same mutation as the turn — never
  write one without the other.
- **The voice meter follows the same ledger rule.** `retell.meterCall`
  stamps each call ONCE per side — billed (frozen at
  `orgs.voiceRateMicroUsdPerMinute` when the duration first lands, per
  second) and Retell's own cost (`call_cost.combined_cost`, call_analyzed) —
  and bumps `usageMonthly`'s voice counters in the same mutation. Each stamp
  keys on its own field being unset: that idempotency is what makes the
  call_ended/call_analyzed double-fire and every retry safe, so never stamp
  or bump anywhere else. Months key on the call's `startedAt` in the org's
  zone (`lib/usage.ts monthKey`, shared with the chat lane). The rate
  resolves org override ?? platform default (`platformConfig
  voiceRateMicroUsdPerMinute`) ?? 0 — set the price ONCE on the Platform
  tab; an org row exists only for exceptions, and an explicit org 0 beats
  the default. Rate changes never reprice history; the activity feed
  carries the number for exactly that reason. Backfill for pre-meter calls:
  `voiceBackfill:run` (billed defaults to zero — run before setting the
  rate). Two surfaces, one boundary: /admin (fleet Calls MTD + org Usage
  tab) sees both sides including Retell's cost; the OWNER's Usage section
  on the voice page (`convex/billing.ts`, owner-only, staff get null) sees
  billed only — `retellCostMicroUsd` never reaches an org-facing read. The
  owner's soft budget (`orgs.voiceMonthlyBudgetMicroUsd`) emails owners at
  80/100% via the alerts fan-out (kind "billing", the first owner-scoped
  kind; the budget being set is the opt-in, no per-user toggle). There is
  deliberately no hard cap on the voice lane: an alerted runaway month
  beats hanging up on the salon's own customer, suspension is the human
  lever, and the meter's frozen line items + month rollups are the exact
  substrate a Stripe paid tier reads later.
- **The prepaid wallet IS that paid tier** (`orgs.billingMode`, 2026-08-15).
  Two settlement models, operator-picked per org on the /admin Usage tab:
  "invoice" (unset) is everything above, unchanged; "prepaid" adds a wallet
  (`orgs.walletBalanceMicroUsd`) the org tops up itself through Stripe
  Checkout and every billed stamp draws down — the debit happens inside
  `meterCall`, same mutation as the stamp, so the wallet can never disagree
  with the line items it paid for. Money in is `wallet.applyWalletCredit`,
  the ONE credit path shared by the Stripe webhook (`/stripe/webhook`,
  signature-verified, idempotent on the Checkout session id — Stripe
  retries are welcome) and the operator's manual credit (platform.ts).
  Enforcement is ring-time only: `beforeCallContext` resolves null at
  balance ≤ 0, the inbound webhook answers without an agent override, and
  Retell declines the ring — an in-flight call always finishes, which
  bounds the overdraft at one call, and topping up needs no re-enable
  because the next ring reads the balance again. Low/empty mails
  (`walletLow`/`walletEmpty`, kind "billing") stamp on the org and re-arm
  on top-up, not monthly; the owner's soft-budget row hides for prepaid
  orgs because its "calls are never cut off" hint is the invoice lane's
  truth. Owner surface is the Balance sidebar tab (`BillingView`, prepaid
  owners only, filtered in AppShell exactly like Revenue); Stripe's
  success_url rides back on `?tab=billing`. The wallet is deliberately
  lane-agnostic: a future metered lane debits the same balance. Config is
  `stripeSecretKey`/`stripeWebhookSecret` in platformConfig (env fallback,
  Resend doctrine), settable on the fleet Platform tab's Billing (Stripe)
  section, which also prints the webhook URL to register at Stripe
  (`<convex-site>/stripe/webhook`, event checkout.session.completed) —
  WhatsApp is NOT metered because each org's Cloud API number bills to its
  own Meta account, and email stays free.
- **The template is versioned platform code** (`lib/chatAgentTemplate.ts`),
  the voice template's twin. Behaviour changes are version bumps; owners
  never edit prompts (vertical presets are the answer to customisation).
- **LLM provider/key/model resolve in ONE place:** `lib/chatLlm.ts`
  (org `connections` "llm" rows win, then the platform's
  `chatAgentProvider` + per-provider key + optional `chatAgentModel`).
  Both dialects — Anthropic and OpenAI — live behind `lib/llm.ts`'s one
  result shape; `appendToolRound` owns their tool-replay asymmetry, and the
  agent loop must stay provider-blind. The platform keys are the Resend
  doctrine, not a hole in the connections rule. The Retell platform default
  is different: it is STAMPED into the org's connections row at
  auto-provision time, never resolved as a fallback.
- **Suspension** (`orgs.status`) stops outbound at the send chokepoints with
  visible `org-suspended` failures and keeps recording inbound. A new send
  path must add the same guard.
- **Knowledge is prose only.** Services, prices, hours and staff are read
  from their tables into the agent's context; never duplicate them into
  `knowledge` rows.

### Phone-agent variable lifecycle (decided 2026-07-31, Serdar)

Resepta is the source of truth for a phone agent's variables; Retell is the
execution target. A variable is ONE lifecycle row, never three unrelated
lists: its pre-call source, live collection policy, post-call fallback and
storage destination stay together in `voiceAgentVariables`. Before-call values
are context, not collected data. Live caller-confirmed values beat post-call
transcript inference; post-call extraction only fills a missing customer value;
pre-call context is recorded with the call but never writes back by itself.

Existing agents import Retell defaults, extract-variable tools and custom
post-call fields on first open. Publishing adopts them into the Resepta
registry, preserves unrelated Retell tools and system analysis presets, and
publishes the agent + LLM changes as one Retell draft version. New agents use
the same registry from their first publish. Customer destinations still pass
through `contactFields.source === "voice"`; phone, consent and other reserved
columns never become writable through variable configuration.

## Conventions carried over from Nudge

- `npx tsc --noEmit` must pass before every commit.
- **A push to `main` deploys the backend too — do NOT tell Serdar to run
  `npx convex deploy`** (he has been told twice; it is his one recurring
  annoyance from this file's absence). The Convex deploy rides Vercel's own
  BUILD COMMAND, which is configured in the Vercel project settings and is
  therefore invisible from this repo — `package.json` says only
  `"build": "next build"` and there is no `vercel.json`, so reading the repo
  alone gives the wrong answer. Push is the whole ship: frontend and Convex
  functions, schema and crons together.
- `convex/_generated/` is CHECKED IN — commit it alongside any backend change
  that adds/renames a function or table (Vercel's typecheck reads the committed
  copy).
- During refinement work across every feature area, commit each logical unit
  directly to `main` and never push until Serdar explicitly asks
  (Serdar, 2026-07-31).
- Use Serdar's signed-in Chrome browser for UI previews and visual verification,
  never the internal browser (Serdar, 2026-07-31).
- The user runs dev servers, not the agent.
- Phone numbers are E.164 with dial code or they don't exist (`+905...`);
  backend rejects anything else.
- No Save buttons — autosave on blur/change. Explanatory copy behind tooltips,
  not inline paragraphs.
- Small commits per logical unit.

## Editing, adding, density (recurring, stop it)

Three rules. They come up on every surface and they have had to be given more
than once, so they live here now rather than in a review comment.

**1. A value you can change is an inline edit, not a parked form control.**
`InlineEditValue` (RecordField.tsx) handles free text AND picklists — pass
`options` for a select, `labelFor` when the stored value is a slug the reader
should never see (`"owner"` → `"Yönetici"`). A row of bordered inputs reads as
a form somebody has to fill in; a value you click to correct reads as a fact.
It also deletes a border per control, which is the other half of why the
bordered version looks heavy. Reach for a bare `<input>`/`<select>` only in an
actual form — a sheet, or a genuine filter bar.

**2. Adding opens a sheet. Never a permanent empty field at the foot of a
list.** Use `Sheet` (Sheet.tsx). An always-visible "name + Add" row is a
question the page asks nobody, and it charges vertical rent on every visit to
pay for a task done twice a year. The entry point is a button; the fields
appear when you mean them. If one gesture could create two DIFFERENT kinds of
thing, the sheet asks which — do not stack both forms and hope.

**3. Vertical space is the scarce resource.** A row carrying a name and an
email is ONE line, not three: identity reads across, controls sit in columns
beside it. Before stacking anything, check it cannot read inline. This is the
same instinct as the reminders table and the customers list — the complaint is
always "why is this three rows tall".

**4. Nothing shifts under the pointer.** Switching a tab, toggling a mode,
revealing an error must not resize the container. Whatever the reader is
reaching for has to still be where they saw it. In practice: give the variants
equal height (put a second field BESIDE the first, not under it), reserve the
line an error will occupy, keep the sort caret's space whether or not it shows.
If two states genuinely cannot match, the taller one sets the height and the
shorter one pads.

**5. Use the word the industry already uses, not one you coined.** The Team
card once asked "what do you call these people?" and stored the answer as
`orgs.staffLabel`, so every surface could say "Berber" or "Stylist". It was
deleted 2026-08-02: it set exactly ONE string — the field label on the booking
sheet — and charged for it with the most prominent control on the page you
visit to manage people. The vocabulary is fixed now — **Team**, **Member**,
**Available** — which is what Fresha, Booksy and Square all say. The column
survives in the schema, dead and commented, because Convex cannot drop a field
while documents still carry values.

The rule the old note was reaching for still stands: never coin a term like
"bookable person" when the product already has a plainer one. **Name the set,
not its best-known member** — "Reminders" named a tab holding six message
types of which one was a reminder, and "Add reminder" a sheet that adds any of
the six.

**6. `ROW_GRID` is the settings-page grammar, not a universal layout.** Its
260px label column is sized for Business's longest labels ("Incoming email
address"); borrow it under short labels like "When" and "Channel" and the
column is mostly void, with values starting a hand's width from the words
naming them. Keep the grammar (label left, capped value right, never a control
stretched across the card) and size the columns to the labels you actually
have. In the same spirit, cap a control to the text it will ever hold
(`sm:max-w-72` on a name or an email local part) rather than narrowing the
shared grid — the wide rows, seven day chips on one line and the open/close
pickers, need the full 24rem.

**7. Selected state needs a shape, not only a hue.** A coloured pill reads as a
decorative tag and its unselected sibling as a button nobody has found; put a
check inside the active one. And mind what a colour already MEANS on the page
— amber is the "unsaved" signal in the message editor, so an amber ON-state
read as a warning; the active channel is emerald, which is what the app's
toggles already say by "on".

## The calendar and booking sheet after 2026-08-19 (the Google pass — read this before the 2026-07-29 section below)

Serdar's brief: make the calendar and its popup read like Google Calendar,
step by step, over one long session. What holds now:

- **Events wear their own hue: lavender.** `--event` (light `#7c5cf0`, dark
  `#8b6ef5`) plus `--event-soft` / `--event-past` / `--event-past-fg` in
  globals.css. NOT `--brand` (green means the product) and NOT `--accent`
  (blue means "do something"). The brand green no longer appears on any
  event surface.
- **Tense outranks status** (`blockStyle` in AppointmentsView). Upcoming =
  solid lavender with white text, confirmed a shade deeper than scheduled;
  past = the pale wash — decided by the block's END against the live clock,
  so a booking fades the minute it finishes, not at midnight. `no_show`
  stays red in both tenses. The draw-band is tense-aware the same way, so a
  slot drawn over yesterday is muted before it is saved.
- **The now-line is red** (`--now-line`), Google's red, and red means ONLY
  "now" — never danger. Today's circles (week header, month, year) are
  `--accent` blue.
- **Overlaps always render side by side.** The week view's "3 bookings"
  cluster chip is deleted — Serdar chose Google's behaviour: every
  overlapping booking draws in its own lane, truncates, and stays
  clickable. Each chip wears `ring-1 ring-[var(--card)]` — the white seam
  that keeps two touching solid chips readable as two.
- **Chips hug the left and leave the right free.** 1px off the left rule,
  `BLOCK_RIGHT_GUTTER_PX` (14) bare on the right, so a fully booked slot
  still has grid to press for the NEXT booking. The draft band uses the
  same insets so it lands exactly where the saved chip will.
- **The gutter corner prints the GMT offset** (`gmtLabel`), computed from
  the BUSINESS's timezone — the same zone the closed shading uses, so the
  two can never disagree.
- **Header order is Google's**: Today as an always-visible outlined pill on
  the left (`periodHasToday` is deleted — a pill that vanished made the row
  twitch), arrows + heading next, the view picker as a matching outlined
  pill on the right. **There is no "new appointment" button — don't
  reintroduce it.** The grid is the button: click or drag a slot, or a
  month cell. Serdar flip-flopped on this and landed on remove.
- **The booking sheet is a 448px Google card**: rounded-3xl, shadow-only
  edge (hairline border only in dark), X to close, blue pill Save that runs
  `reportValidity` so a missing phone is a browser bubble, not a dead click.
- **One customer field, no Existing/New toggle.** It searches as you type;
  picking a match links that record and shows NOTHING else (no phone/consent
  readback — the record holds those). No pick means the typed text IS the
  new customer's name (first word → firstName, rest → lastName) and a phone
  field waits below. The dropdown's last row says so: "+ New customer: …".
  **Consent is always true for counter-created customers** — the checkbox
  was removed on Serdar's call; the contact record is where consent is
  revoked.
- **Every popup row is two columns**: label (`w-24`) then field, all on one
  left edge. Row icons were tried the Google way and deleted — with labels
  present they were decoration, and half the rows had no natural glyph.
- **When is prose until clicked** ("Perşembe, 20 Ağustos  10:00 – 11:30"),
  then swaps to `WhenPicker` (its own file): a date chip opening a mini
  month popover, and start–end time chips that accept typed "930" / "9:30" /
  "9" or a pick from 15-minute lists (end options carry their duration).
  Duration is what WhenPicker REPORTS — the machinery still speaks minutes —
  but the owner only ever handles times. Moving the start keeps the length;
  an end at or before the start is refused, not reinterpreted (no
  cross-midnight bookings). The native datetime-local input is gone; it
  typed the year to 0025 with no way back.
- The sheet-height dependency rule below still applies: `timeEditing` and
  `picked` are in the placement effect's list now. Add anything new that
  changes height.

## The calendar (rebuilt 2026-07-29)

Four views behind one dropdown — Day, Week, Month, Year, plus List — with
shortcut letters `D W M Y L` bound on the document and `T` for today. The
letters are PRINTED in the menu, so they must stay bound: a hint beside a dead
shortcut is worse than no hint. Both stand down while a field has focus or the
booking sheet is open.

- **The toolbar owns navigation.** Heading, prev/next and Today live in
  `AppointmentsView`'s one toolbar row, not inside each view. All three are
  derivable from `anchor` alone. Stepping is not a fixed number of days —
  months and years are walked with `addMonths` / `addYears`, both of which pin
  the date before moving the unit (31 Jan + 1 month is otherwise 3 March).
- ~~Today shows only when you are elsewhere~~ Superseded 2026-08-19: Today is
  an always-visible outlined pill on the left; `periodHasToday` is deleted.
- **The query window follows the anchor**, padded a fortnight. It used to be a
  fixed window around page load, which silently returned nothing past six weeks
  out — indistinguishable from "no bookings". If you add a view, extend `range`
  with it or that view will look empty.
- **The booking sheet anchors beside its slot** (`lib/anchoredSheet.ts`, pure
  arithmetic, no DOM). It never covers the block it belongs to, draws no
  backdrop dim — the week must stay readable — and keeps the slot's band painted
  while open, which is what makes it read as attached. Under 900px there is no
  "beside", so `placeBeside` returns null and the full-width sheet is used.
- **If you add anything that changes the booking sheet's HEIGHT, add it to the
  placement effect's dependency list** (`AppointmentModal`, the
  `useLayoutEffect` around `placeBeside`). Anchored low in the grid, a sheet
  that grows without re-placing slides off the bottom of the window. A
  ResizeObserver would make the list unnecessary and does not work here — its
  callbacks are never delivered in this app, not even the initial one
  `observe()` guarantees. Worth diagnosing; until then the list is manual.
- ~~Week folds crowded clusters, day never does.~~ Superseded 2026-08-19: the
  cluster chip is deleted; overlaps always render side by side in every view.
- **The year reads from `appointments.startsInRange`**, not `listRange`.
  `listRange` resolves a customer and staff row per appointment, which is
  thousands of document reads to place dots. Bucket to local midnight on the
  client: which day a booking falls on is a question about the reader's clock.
- **The half-hour rule line matters here.** Almost every booking is 30 minutes.
  Grid rules use `--grid-line` / `--grid-line-soft`, not `--border`, which is
  tuned for card edges and reads as a spreadsheet at grid density.

## Popovers NEVER position absolute inside a card (recurring, stop it)

Every floating element — dropdown menu, tooltip, combobox list — renders
through `createPortal(document.body)` with `position: fixed`, measured from
the trigger's `getBoundingClientRect()` at open time and clamped to the
viewport. An `absolute` child clips on the nearest `overflow-hidden`/scroll
ancestor — every card and the shell's main pane are exactly that. `InfoTip`
and `RowMenu` are the reference implementations. Serdar has flagged this
repeatedly across projects; treat a clipped popup as a bug you introduced
knowingly.

**Scroll REPOSITIONS the panel; it does not close it** (`useAnchoredPanel`,
fixed 2026-08-19). Closing was the cheap answer to a fixed panel drifting away
from its trigger, and it made long lists unusable: reaching a variable below
the fold meant scrolling the page, and the scroll that brought the trigger
into view dismissed what you had just opened. Capture listeners on `scroll`
and `resize` re-measure instead. Two guards that must survive any rewrite —
a scroll whose target is INSIDE the panel is ignored (the panel's own list
scrolls, and moving the list must not move the panel), and the panel closes
only when the trigger has actually left the viewport, since a panel anchored
to an off-screen control is the drift this exists to prevent.

## Tabs are underlined, never pills

Canonical version is in Mana, `50_Knowledge/design-language.md` (2026-08-12),
because it applies to every project. Measured off Vercel, not eyeballed. A filled accent pill beside plain grey text
is two different KINDS of control in one row: the selected item reads as a
button and the rest read as labels, which is what the pill strip here looked
like until 2026-08-12.

- Strip owns the hairline: `flex items-center gap-5 border-b border-[var(--border)]`.
- Tab: `-mb-px border-b-2 px-0.5 py-2.5 text-sm`, so it overlaps the strip's
  rule and the active underline REPLACES that segment rather than sitting under
  it.
- Active: `border-[var(--foreground)] text-[var(--foreground)]`.
- Idle: `border-transparent text-[var(--muted-strong)]`, hover to
  `--foreground`. #4d4d4d is what Vercel uses for an idle tab too.
- **Weight never changes between states.** Vercel holds 400 across both and so
  do we: bolding the active tab reflows the whole strip on every switch, and
  nothing shifts is a standing rule. Darker plus an underline is the whole cue.

`VoiceView` is the reference implementation. Value pickers that happen to look
like a strip (the message-channel pills in Reminders, feed filters) are NOT
tabs and keep their own treatment.

## Every scrolling page ends with room below the last card

Canonical version is in Mana, `50_Knowledge/design-language.md` (2026-08-12),
because Serdar has asked for it on every project. `.page-stack` in
`globals.css` is 6rem of bottom padding, and it goes on the ROOT of every view
that stacks cards and scrolls.

**Do not move it onto `main` in `AppShell`.** One line there would cover every
route and it would be wrong: the master-detail views (Inbox, Calendar,
ContactView) are `h-full` and scroll inside their own cards, so shell padding
shrinks those cards and leaves a dead strip under a pane that never scrolls the
page. A card that fills the window has no last card to give room to. Opt-in is
the point.

When you add a stacked-card view, add the class. The last card butting against
the bottom of the window reads as the page being cut off rather than ending.

**It applies inside a scrolling PANE too, which the carve-out above does not
cover.** The opened call is a column inside the conversation panel's own
scroller, so `.page-stack` correctly cannot reach it — but the last thing said
still lands jammed against the pane's bottom edge, and that is the line you are
most likely to be reading, since a call ends with what was agreed. `CallDetail`'s
`flow` mode carries its own `pb-24` — the same 6rem. Free on a short call: a
column that does not overflow never scrolls, so the padding is paper that was
already empty.

## Scrollbars: two weights, width-only hover

Canonical version is in Mana, `50_Knowledge/design-language.md` (2026-08-12),
because it applies to every project. This repo holds the reference
implementation in `src/app/globals.css`. The short form:

- `.thin-scroll` is the in-card rail: 3px at rest, 6px on hover. Everything
  that scrolls inside a card uses it.
- `.page-scroll` sits on top of it for the shell's own `main` only: 6px at
  rest, 8px on hover. It overrides widths ONLY and must stay below
  `.thin-scroll` in the file, since equal specificity makes source order the
  tiebreaker.
- Hover changes width, never colour. Doing both is what makes a rail read
  heavy.
- The visible rail is carved out of a wider track by a transparent border plus
  `background-clip: padding-box`. That floats it off the card edge AND keeps
  the thumb's hit box at full track width, which is what makes a 3px bar
  clickable.
- **`scrollbar-width` must stay inside the `@supports not
  selector(::-webkit-scrollbar)` guard.** Declaring it unguarded switches
  Chrome's webkit pseudo-elements off wholesale, which is exactly how the
  previous rules sat here as dead code while Chrome painted its own 11px bar.

## A header row sits in the same column as the feed below it

`ConversationPanel`'s header slot holds a different thing per tab — the email
header, the call header, the note composer — and they carried `px-3`, `px-3` and
`px-4` against a scroller on `p-4`. So Place call hung past the right edge of the
card beneath it, the back arrow started left of it, and the row jogged sideways
when you switched tabs.

**Two things have to be matched, not one:** the scroller's padding AND the 9px
that `stable-gutter` reserves for `.thin-scroll`'s track. That gutter sits
OUTSIDE the padding, so matching `px-4` alone still lands 9px short — which is
exactly how this looked "nearly right" for months. One `FEED_COL_PAD` constant
covers all three now; keep it in step with the `threadRef` div.

Keep it as `calc(1rem + 9px)`, never a resolved pixel value. Nothing sets a root
font-size, so `rem` tracks the browser's font preference and Serdar's Chrome runs
17px, where a hardcoded 25px is out by a pixel and a half.

## Borders only when absolutely necessary (Serdar's design language)

Borders belong to CONTAINERS (cards, inputs, dropdown panels) — never to
buttons. Secondary/ghost buttons are text + hover wash
(`text-muted hover:bg-muted-bg`), primary buttons are solid accent fill.
A bordered chip where a ghost button belongs reads as sloppy; check every
new control against this before shipping it.

## Voice numbers, caller identity, and the variables doctrine (2026-08-18)

A marathon session; the durable rules it produced:

**Caller identity.** A call row's `fromNumber` is the CUSTOMER's leg —
caller for inbound, callee for outbound; `recordCall` picks by the direction
Retell reports (never assume inbound). Every voice entry point normalises
numbers with the org's dial code (`dialCodeForTimezone`): the Turkish trunk
delivers national-format caller IDs (05386906897), so "carriers always send
E.164" is disproven and must not return as an assumption. `orgOwnNumbers` is
a hard guard wherever voice creates or matches a contact — the business is
never its own customer.

**Numbers.** `agentLines` is the per-number, per-direction binding table
(inbound and outbound may be different agents), reconciled from every clean
roster read and written directly by `attachLine`/`detachLine`. Provisioning
is operator-only for shared-account orgs: `orgs.allowedPhoneNumbers`, empty
= NOTHING (default-deny); tenant pickers offer allowlist ∪ bound
(`retell.orgNumberPolicy`). Nothing in the product MOVES a line implicitly —
the agent editor's select attaches; it once moved, and silently released the
salon's main line. The inbound webhook resolves the agent from the DIALLED
number (`agentForInboundNumber`): Retell's weighted `inbound_agents` binding
sends `call_inbound` with no agent_id, and the early "unknown agent" return
was why agents ran without `{{now}}` and booked into the wrong year.

**The variables doctrine (Serdar's, hold to it).** Groups are the agent's
behaviours — Bilir / Sorar / Öğrenir. Bilir renders the runtime's injected
context as read-only rows that mirror `beforeCallContext`'s dynamicVariables
key for key; if the runtime gains a variable it must appear there or the
table is lying. Identity (name, email) and the booking's own questions need
NO registry rows and NO prompt paragraphs: identity keys are always writable
through save_customer_details, and the template + booking tools force the
asks. The registry exists ONLY to teach the post-call analysis about
org-specific fields. An empty Sorar is the healthy default, not a gap.

**Confirmations vs. late emails.** The agent asks for e-posta AFTER booking
(a booking must not wait on spelling), so booking-time confirmations can
race an empty email column and fail `no-email-address`.
`retryConfirmationsAwaitingEmail` (appointments.ts) re-fires booking rules
when an email lands — voice or staff edit — guarded on ALL confirmation
attempts having failed, so a channel that already carried the message never
double-sends. Any new email-writing path must call it.

**Two Convex/React traps that each cost hours here.** (1) Convex validates
RETURNS as strictly as arguments: extending a handler's result without
extending its `returns` validator makes every call throw at runtime, and
TypeScript cannot catch it — extra properties pass structural assignment.
When a result type changes, change the validator in the same edit. (2) A
context value's setters must be referentially stable (useCallback): a setter
minted inside the value memo re-triggers every effect that lists it in deps
— the header search's claiming effect ran per keystroke and its cleanup
wiped the query.


## An action belongs to the card it acts on (2026-08-21)

`Card` takes an **`action`** node, rendered hard right on the title line. Add
agent, Add message, Add customer, Add member, Add field, Add sale, Add product
and Add knowledge all sit there now; before this they floated above their card,
sat at the foot of a list, or were shared between two cards.

- **Two tiers, and they are different jobs.** A CARD's own action lives in the
  card header, with no `+`, and wears `.card-action` — OUTLINED, no fill. A
  SECTION's action inside a card is outlined and keeps its `+`; the contact
  record's "+ Add appointment" is the reference.
  **AMENDED 2026-08-25.** The card action was filled accent until Serdar said
  it was too strong ("should we do sort of secondary button that's sort of no
  bg for these type of cards"). The original reasoning below still holds and
  is exactly what broke: filling a SECTION action would make it the loudest
  thing on the contact page, competing with the page's real primary. Putting a
  card's action in its header multiplied that by however many cards a page
  stacks, so Voice opened on three solid blue buttons down one edge and Business
  on more. One loud thing per screen is the budget. A filled button now means
  the single action a screen is FOR: the sheet's confirm, the composer's Send,
  the Customers toolbar's Add customer (that page IS the list it adds to).
  **"No bg" means the FILL, not the outline** — a first pass dropped both and
  Serdar corrected it ("i said remove bg from secondary buttons not the border
  line"). The border is what keeps it reading as a button at rest; the fill
  was the only part shouting. So the two tiers now differ by the `+` and by
  where they sit, not by weight.
- **The header carries `min-h-8`**, so a card with an action and one without
  keep the same header height, and an action that hides itself (Contact
  fields' button, while its form is open) moves nothing.
- **`action` renders OUTSIDE the fieldset.** `Card`'s `disabled` cannot reach
  it, so an action on a card that can go read-only must gate itself —
  every current caller does (`isOwner ? … : undefined`).
- **A card that is the PAGE keeps its toolbar row instead** (Customers, Voice
  agent). Same visual corner; the difference is that a page-level table's
  controls are a toolbar, not a card header — and the Customers table is a
  `DataTable`, which has no header slot at all. Its row moved INSIDE the
  card's own padding for the same reason, and that card is now gated on
  LOADED rather than on having rows: it carries the button a salon needs
  before it has a single customer.
- **Never park an add at the foot of a list.** It puts the primary action
  below however many rows the business happens to have, and it is the branch
  that loses the button in the EMPTY state — the state where you need it most.

## One state, one hue (2026-08-21)

Amber was doing three jobs at once — unsaved draft, selected day, active
channel — and one Messages row carried two same-size amber pills meaning a
warning and a steady state. The app also disagreed with itself: expanding a
rule drew its channels emerald while the collapsed row drew them amber.

- **Emerald is ON.** Every toggle in the product already said so. Message-rule
  channels and "Days you're open" both wear it; the day chips also gained
  `role="switch"` + `aria-checked`, which they never had.
- **Amber is UNSAVED**, and only that.
- **Violet is a PIN** — mine, a debt I created and only I can clear. It is the
  inbox row's marker and the contact record's, and it is violet precisely
  because every other hue here is taken: `--accent` blue means "do something"
  (and a blue dot beside a linked name reads as an affordance, not a state),
  `--now-line` red means "now", `--brand` green means news.
- **`--brand` green means "something NEW is in there"** — the sidebar's inbox
  dot, and nothing else. Its comment used to claim it was the same green as
  the row dot, "one hue, one meaning". It never was: that dot marked a pin.
- **No check inside the day chips**, unlike the channel switches. Seven of
  them must hold ONE line inside a 24rem value column (the `ROW_GRID` note
  names this row as the reason that column is 24rem), and a 12px glyph plus
  its gap on every chip wraps the week onto two rows. Seven weekday names in
  order is not a control anyone mistakes for a row of tags.

## An inbox row says what was said (2026-08-21)

The row carried a name and an age, so every question you open the Inbox with —
who is waiting, what did they want, did that reminder actually go out — cost a
click each. `messages.conversations` had been returning `lastBody`,
`lastChannel`, `lastDirection` and `hasFailed` the whole time, and search had
been reading `lastBody` since it shipped: the row was the only thing on the
screen that could not see it.

Second line: channel glyph, `not sent` in `--now-line` when the thread holds a
failed send, `Siz:` when the newest message is ours, then the body collapsed to
one line. Two lines is iMessage's shape and the reason the density rule
("a name and an email is ONE line") does not apply — that rule is about a table
row stacking fields, this is a message preview, which is the content.

- **The glyph is not the channel strip deleted in `49ed336`.** That was a row
  of buttons offering to START a channel, an action nobody took. This is one
  un-clickable mark answering where the message happened.
- **An empty body on WhatsApp or mail previews as "Şablon mesajı"** — what
  `ConversationPanel` already calls it. A row must agree with the thread it
  opens; naming the channel there produced "Siz: WhatsApp".

## The inbox stopped being a second conversation screen (2026-08-22)

Serdar's diagnosis, and it is the important half: the Inbox and the contact
page were two master-detail screens sharing an identical right half, so going
"deeper" from a conversation showed you that same conversation again with a
record added. Arriving somewhere felt like staying put, and nobody could tell
the two screens apart.

**A row now opens the CONTACT RECORD.** The right pane is deliberately left
standing as a placeholder (Serdar's call), which also makes this three lines to
reverse rather than a screen to rebuild.

Three things had to travel with the click, and each was a separate bug when it
did not:

- **The channel.** The old split pane did `setFilter(next ?? c.lastChannel)`;
  navigating dropped it, because the filter now lives in a component the click
  unmounts. It rides as an optional 2nd argument on `onOpenContact` and lands
  as `ContactView`'s `initialFilter`. Every value `lastChannel` can hold is
  already a `FeedFilter`, calls and notes included, so nothing needs mapping.
  Undefined from the Customers table and the Calendar — neither knows which
  channel you meant, so those keep the mixed feed.
- **The width.** The Inbox carried `max-w-6xl lg:px-6` (Nudge's page cap,
  ported) and `ContactView` never did, so the same 2fr/3fr split sat in
  containers of different widths and the panes could not line up however the
  ratio was tuned. Cap removed; both resolve to 382.195px / 573.305px. **Keep
  those two grids in step** — they are the same pane one click apart.
- **The phone's starting pane.** Landing on First name after tapping a
  conversation makes you tap again. Derived from the same `initialFilter`
  flag rather than a second prop: a caller that knows which channel you meant
  knows you meant the conversation, and two flags that can only ever agree are
  one flag with a way to be wrong.

Read is stamped on the way OUT of the row now. Nothing is ever watched from
the Inbox, so the `opened` state and its re-stamp effect are deleted.

## A page title names the page, in the bar that names pages (2026-08-22)

Opening a contact left the shell header reading "Inbox" while the page was a
person, so the contact drew its own name and back arrow in a second title row
underneath — two headings, the higher one wrong, ~60px between them.

- **`AppShell` takes `overrideTitle` (a STRING) + `onOverrideBack`.** A string,
  never a node: the view supplying it renders UNDER the header, and handing
  React elements back up through state is how a render loop starts.
- **`AppHome` holds the name; `ContactView` reports it** via `onTitle`. That
  view is the only thing querying the customer — filling the heading anywhere
  else would be a second read of the same row on every contact opened.
- **`ContactView` is keyed on the id**, so opening a second contact from the
  first one's feed remounts and re-reports instead of leaving the previous
  name in the bar until the new query lands.
- **`overrideContactId` is an ID**, same discipline: the shell renders the pin
  itself (`PinDot`) and runs its own query rather than taking a control or a
  pair of callbacks from below.
- **The name carries a `›`** — the app's own "open this" mark, borrowed from
  the feed rows. A hover-underline is only found by people who already
  suspected, and clicking the name is the only route from a conversation to
  the record behind it.

## The pin, and reading it the same way twice (2026-08-22)

Ported from Nudge, violet and all. Settable from the contact record now, not
only from the Inbox list — the page where you actually decide "deal with this
later" had no way to say so.

**Since 2026-08-24 it is ONE dot per row, in the left gutter**, not a pin after
the name plus an unread dot on the left. Three states, one hit area: violet (I
pinned this) beats brand green (they wrote, I have not opened it) beats a
hollow ring that fades in on hover. The pin wins because it is a decision and
unread is a fact that clears itself the moment the row opens — if green won,
pinning a new conversation would look like the click did nothing. Nudge's inbox
is the same control with the same precedence; keep them in step.

**`messages.inboxPin`** reads ONE conversation's pin. It pays for the whole
org's entries to answer about one row, deliberately: the SPENT rule (a pin
older than the newest outbound has been paid) lives in `summariseEntries`, and
a cheaper read that skipped it would let the record show a pin the Inbox had
already retired. Two surfaces disagreeing about one pin is worse than a read
the record page makes once.

## Knowledge reads as prose, not as a form (2026-08-21)

Every block mounted a live rich-text editor permanently, so two blocks meant
two full toolbars parked on a card nobody opens to format text. Ported from
`ConversationPanel`'s note bubble: the whole bubble is the edit affordance,
click to edit, and Delete is hover-revealed on opacity so the row never shifts.

**Cancel/Save, not collapse-on-outside-click, and that is not a departure from
the no-Save-button rule for its own sake.** The editor's colour swatch and its
emoji picker both `createPortal` to `document.body`, so every "did the click
land outside" test answers YES to picking an emoji and closes the editor out
from under the thing you just reached for. Notes hit this first and answered it
with an explicit close; a second answer here would be a second pattern for one
problem.

An empty block previews its placeholder — without it, the only way to fill one
in is to delete it and add it again.

## One person, several businesses (2026-08-24)

An owner with more than one business staffs them from one screen. Two surfaces,
one write:

- **Business → the card under Team.** Lists the OTHER businesses this owner
  owns, each with the people from this team who already hold a membership there,
  by name rather than as a count. Expanding one gives every colleague the same
  three-value control the roster uses — admin, member, no access. Owners only,
  and rendered only when there IS another business.
- **The add-business wizard's team step.** Conditional: it exists only for a
  founder whose other businesses have other people in them. One control per
  person, three values, and NOBODY is picked by default — every grant mails the
  person and puts a business in their switcher, so a step somebody clicks past
  must not have told three colleagues they now work somewhere. The grants commit
  after the name save, in one transaction, so the mail carries the business name
  and a rejected name sends the wizard back with nothing sent.

A grant leaves `memberships.seenAt` unset, which is what
`users.unseenWorkspaces` and the banner already exist for, and sends the same
"you have been added" mail `team.invite` sends an existing account. The
last-admin guard runs against the org being WRITTEN TO. People with no login
never appear on either surface: there is nothing to grant them elsewhere, and
copying a rota (with its hours and its services) is a different feature.

### Impersonation beats users.orgId, and two mutations forgot (2026-08-24)

`requireOrg` resolves `actingAsOrgId` FIRST and ignores `users.orgId` while it
is set. So any mutation whose whole effect is to write `users.orgId` does
nothing visible while an operator is inside a tenant. `foundWorkspace` and
`setActiveOrg` both did exactly that: Add business minted a real draft org and
kept rendering the client, so the click read as a no-op and produced one more
unnamed org per attempt (seven, in production). Both now clear
`actingAsOrgId` — founding and switching are acts of the PERSON, not of the
business they are standing in. If you add a third mutation that changes which
workspace somebody is in, it belongs in that list.

A login also owns at most one draft now: `foundWorkspace` reuses the newest
draft that has work in it and discards every other empty solo one through
`lib/discardOrg`. Drafts read "Yeni işletme (tamamlanmadı)" in the switcher
rather than borrowing the product name.

## Deleting a business (2026-08-24)

`platform.deleteOrg` is the operator's destructive door, next to suspension in
Account status. Read it before adding a table.

**It is an action, and the order is the design.** The Retell teardown
(`retellAgent.teardownForOrg`) runs BEFORE anything is destroyed, because the
agent id lives in the rows about to be deleted — and it runs in front of the
operator, whose confirmation is the only record that survives. Provider
failures REFUSE the delete unless the operator presses again for `force`. Per
agent: unbind the number while the agent still exists, read the agent to find
its response engine, delete the agent, delete the engine. The number is
unbound, never released — releasing is the irreversible half, and an unbound
number is immediately reusable by the next business.

**`ORG_TABLES` in `convex/platform.ts` is hand-maintained.** One arrow per
org-scoped table, each reading through the index that starts with `orgId`. Add
a line when you add a table; forgetting leaves rows (and storage blobs) that
outlive their business and that nothing can find, because the org row they were
keyed by is gone. It is written as literal arrows rather than a loop over table
names on purpose: the literal is what types each row, so `storageId` narrows
and the compiler notices the day a table gains a blob.

**The purge is a scheduled job, not a transaction.** `PURGE_BUDGET` rows per
step, then it reschedules; the org row goes last. `orgs.deletingAt` marks the
row, drops it from the fleet list, and gates `purgeOrgStep` — a step that finds
no mark returns without touching anything, which is what stops a stray schedule
from eating a live salon. Suspension is set at the same moment, because that is
the switch every send path already respects.

Nothing writes an activity row for the delete: every table that could hold one
is org-scoped and is being emptied. Deleted memberships are also how the people
who worked there stop resolving into it — `lib/orgAuth` falls back to their
remaining membership, and a stale `actingAsOrgId` pointing at the deleted org
already falls through there.

## The app lives at app.resepta.xyz (2026-08-24)

Marketing left. `resepta.xyz` and `www` are a SEPARATE repo on a separate
Vercel account; this deployment is `app.resepta.xyz`, plus `demo.` and `docs.`
which `src/proxy.ts` rewrites to `/demo` and `/help`. The operational half —
`SITE_URL`, the Google callback that does NOT move, the redirects the marketing
project owes us — is in [`docs/deploy.md`](docs/deploy.md). What it changed in
here:

- **`/` is the app and nothing else.** It came off the public matcher in
  `src/proxy.ts`, so the redirect at the foot of that file sends a stranger to
  `/signin` — the same rule that guards every other route, rather than a second
  one written in the page. `src/app/page.tsx` has no auth branch left.
  `HomeClient` keeps a client-side bounce for the session that expires between
  the cookie check and the browser, and `/signin` sends an authenticated
  visitor home (the anonymous demo sign-in creates a session without ever
  navigating).
- **Signing out leaves for `resepta.xyz`** — `lib/hosts.signOutDestination`,
  used by the account menu and the wizard's way out. Every page here is behind
  auth, so staying put meant bouncing off `/signin` one click after saying you
  were done. A demo visitor goes back to the demo instead. `.then`, never
  `.finally`: a sign-out that failed has left the session standing, and
  navigating away from it lies to whoever is walking away from a shared laptop.
- **`src/components/Landing.tsx` is now unreferenced.** Left in place
  deliberately until the marketing repo has taken what it wants from it.
  `src/lib/landing.ts` is still live — SignInDialog reads its copy.
- **`src/app/sitemap.ts` and `robots.ts` still advertise the apex origin.** They
  are describing somebody else's site now. Fix them when you next touch that
  area.

## Seeding the calendar, and the rule every bulk writer inherits (2026-08-25)

`create_appointments` (MCP) brings an existing book in: up to 50 rows a call,
customer resolved by id or by the phone they are filed under, `start` read as
wall time AT THE BUSINESS (`lib/businessHours.parseLocalStart`, same reading
the voice and chat agents take), services given by the key `list_services`
publishes and SNAPSHOTTED onto the row, status defaulting off the clock.

**A SEED MUST NOT CAUSE A SEND THAT WAS DUE BEFORE THE SEED EXISTED.** This is
the rule to carry into any future bulk writer, and it exists because an
appointment is not an inert row — it is the anchor the reminder cron reads.
`lib/reminderSchedule` computes a due time on write and the cron treats "due in
the past" as DUE NOW, which is right for a booking taken two hours before it
starts and catastrophic for an import: seed six months of history and every
no-show in it is a winback going out tonight, to real customers, about
appointments they missed in March. The `no_show` trigger deliberately has NO
backward guard (switching winback on has always meant "including recent
no-shows"), so nothing upstream stops it.

So every rule whose due time for a row has already passed is stamped into
`sentRuleIds` at insert — the same double-send guard the cron itself stamps.
Rules genuinely in the future stay armed, because next week's seeded book
should still remind next week. It generalises what `after_end` already encodes
with its `at < rule._creationTime` check. Known cost: a seeded appointment
later moved far enough out that a stamped reminder would fall in the future
again keeps it suppressed, exactly as a reminder that really fired before a
reschedule does not fire twice.

**Verified against a live rule set** (dev Barberio, which carries the same
unpaused 336h no_show winback prod does), 2026-08-25. Seeding a past no-show
plus a future booking in one call produced: the past row with all three
overdue rule ids in `sentRuleIds` — the winback among them — and
`nextMessageAt` unset, so the cron's index range excludes it and no winback
can fire; the future row with `sentRuleIds` empty and `nextMessageAt` exactly
24h before its start, so the reminder is still armed. `confirmationSentAt` and
`externalUid` unset on both. Istanbul wall time parsed to the right instant,
service snapshotted with its price, three bad rows reported by number, and
undo removed both. Re-run that shape before touching this path.

Two more deliberate omissions: it never calls
`scheduleConfirmationIfConfigured` (these appointments exist already and the
customer knows), and it never touches cal.com (300 rows are not 300 provider
calls; the absent `externalUid` is what every reader already treats as "ours
alone"). Customers are never minted here — `create_customers` is the door that
asks about KVKK consent. Unplaceable rows are reported with their number and
the reason, never dropped. Undo deletes what it created, keeping anything the
customer has since been messaged about.

## The agent's capture config IS the Contact fields table (2026-08-25)

Serdar's spec, in his words: the agent should know the caller and what we
already have, collect the rest during or after the call, and the client
setting an agent up must understand it "immediately without having to read an
extensive manual". Three moves got there, in one day, in order:

1. **Knows / Asks / Learns died.** The three headings were the runtime's
   before/during/after timeline projected onto a filing system by priority;
   the editor now has two sections, "What the agent sees" (injected context,
   automatic, nothing to set up) and "What the agent fills in".
2. **Capture rows are DERIVED, not authored.** `retellAgent.deriveCaptureRows`
   builds the capture set at publish time from the org's contact fields
   (`source === "voice"`, plus unlocked identity columns as questions landing
   on the customer's own columns). The per-agent `voiceAgentVariables` rows a
   caller may still author are CONTEXT ONLY (static injections);
   `publishVariableSet` filters its input to those, so no client — editor or
   MCP — can reintroduce a second capture registry. `set_agent_variables`
   capture rows are silently superseded by field config; its tool description
   still oversells and needs a trim.
3. **The field carries its voice metadata.** `voiceDescription` (the
   extractor's instruction) and `voiceConfirm` live on `contactFields`; the
   fills section's rows write the field through the same mutations the
   Contact fields table uses. Flipping `source` to manual no longer throws
   `field-in-use` — it IS the unlink, and the next publish stops deriving.
4. **It ended as ONE MATRIX with ONE switch** (through three rounds of
   Serdar simplifying on contact): `name · type · description · Asistan`.
   Green check = the agent knows the field and fills it (org rows toggle
   `source`, identity rows toggle the lock). The intermediate two-column
   version (sees / fills) died the same day it was built — the implied-sees
   check read as "not seen" to a human scanning for green, and then the
   premise fell: "if we can see something we can fill in too". Confirm-first
   died with it, on the third complaint: extraction policy leaking into an
   owner surface. `deriveCaptureRows` always asks-when-missing; stored
   `voiceConfirm` flags are ignored, dead config. `voiceVisible` (sees
   without fills) still injects into the ring-time card for rows that hold
   it, but no UI sets it anymore. The switch control is `CheckSwitch`
   (shared component, ported from the message-rule channel toggle): boolean
   cell inside a table row; the iOS Toggle remains for labelled settings
   rows. The Knowledge tab's Active columns use it too.
   Also gone: the read-only runtime listing (one (i) sentence now — what can
   be referenced lives in the prompt's @ picker), the "+ Add default"
   statics block (a static default is prompt text with extra steps; legacy
   rows render headingless until retired), clones of provided keys (filtered
   on load against a set derived from the builtin lists), the type popover
   (selects edit options inline from the type cell), and the key column
   everywhere — the prompt editor speaks labels and translates at the
   boundary (PromptEditor's "two faces" note).
   During-vs-post was proposed as a third column and rejected:
   ask-when-missing during, transcript recovery after, always — one
   behaviour with a retry, not two decisions.
   THE REACTIVITY RULE this page taught: the matrix renders from live
   queries (`contactFields.list`, `contactFields.identityVoiceConfig`),
   never from the agent `read` action's snapshot — rendering switches from
   a snapshot is how a click "did nothing" until reload.

What did not change: runtime ring-time context (`contact`/`information`) was
already field-driven; mid-call and post-call writes still go through
`applyVoiceContactValues`. Field edits reach Retell on the agent's NEXT
publish — there is deliberately no auto-republish (version spam per keystroke);
the editor marks itself dirty via `fieldsTouched` instead. A field edited in
Business while nobody re-publishes an agent is stale at Retell until then —
same as it always was for anything else.

Lost knowingly: per-agent capture variation (nobody used it), the `required`
flag on capture rows, and hand-keyed capture rows whose destination was the
call only ("visible debt" rows — they no longer publish).

## An inbox row opens the message, not the mailbox (2026-08-24)

`messages.conversations` returns `lastId` — the id of the row its preview came
from, the same id `feedForCustomer` gives the feed — and the click passes it
through `openContact` to `ConversationPanel`, which opens that thread or that
call ONCE, when the feed first arrives. Once, because the back arrow is how the
reader leaves, and an effect that kept re-deriving from the prop would shove
them back into the call they just stepped out of.

Email and calls are the two tabs that list before they read, which is the whole
reason: a row quoting one line of a six-mail history used to land on six
subjects. WhatsApp and notes pass nothing — those open as a thread with the
newest message already at the bottom.
