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
- **Appointment intake is cal.com by design, but cal.com IS NOT WIRED YET.**
  Read this before designing anything around availability. The integration
  exists in code and is entirely gated on `org.calcomApiKey &&
  org.calcomEventTypeId`: `convex/calcom.ts` handles BOOKING_CREATED /
  RESCHEDULED / CANCELLED, and the org is resolved from a per-org token in the
  webhook URL (`orgs.calcomWebhookToken`) because cal.com's payload carries no
  tenant identity. `getAvailableSlots` is called from `convex/http.ts` for the
  public booking page only.

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
- **"Message variables" is gone; its two fields went where they belong.** That
  card named the `[booking_link]` and `[phone]` TOKENS rather than the things
  themselves, and filed a salon's own phone number in Reminders where no owner
  would look for it. No mature appointment product has a screen for setting
  the value of a template token. The number customers call is a row in
  Business → General beside the business name (agent-line chips included — a
  number an agent answers around the clock is the one worth printing), and
  online booking is its own card next to the request form. **The booking link
  is a CHOICE, not an override**: Resepta page / my own link / off, with the
  URL box only under the second and the derived link shown as a fact to copy.
  Do not re-pair a toggle with a free-text URL as equals; that shape is what
  made it read as an override, and neither said which a message would use.
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
- **Only tokens that can honestly be blank get a row.** Not `[business]` (an
  org always has a name), not `[date]` (every lifecycle send has a time), not
  `[booking_link]`/`[phone]` (configuration — a blank one means go and set it
  in Business settings, not write a sentence about not having it), not
  `[manage_link]` (structural), and not `[name]` (the renderer already tidies
  "Hello [name]!" down to "Hello!"). What is left: the org's own contact
  fields, and the booking facts an appointment can genuinely lack.
- **The preview always draws.** It used to demand a contact and a booking,
  refusing to invent names and prices — right about invention, wrong about
  refusing. It now auto-picks one of the salon's REAL bookings (soonest ahead
  that actually has line items, since a booking with no services previews
  every price token as an empty slot), and where there is nothing to fill
  from, a built-in previews as its own label in guillemets — ⟨Services with
  prices⟩ — never as silence. Reading order is **real value → the owner's
  default → the labelled slot**, so the preview shows what would actually
  send. Contact fields deliberately keep resolving to nothing: the preview
  speaks about a real customer, and a field that person never answered is
  honestly blank for them.

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

### The inbox arrives with nothing selected (2026-08-17)

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
with zero rows in `voiceEvents`.

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
"bookable person" when the product already has a plainer one.

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
- **Today shows only when you are elsewhere** (`periodHasToday`). It sits at the
  end of a right-aligned cluster so its appearing moves nothing.
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
- **Week folds crowded clusters, day never does.** A cluster block is a door
  into the day, not a booking: it has no drag and it stops its own pointerdown,
  or the press reaches the column and offers to add to the fullest slot on
  screen.
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
the trigger's `getBoundingClientRect()` at open time, clamped to the viewport,
closed on outside-mousedown AND on scroll (capture). An `absolute` child
clips on the nearest `overflow-hidden`/scroll ancestor — every card and the
shell's main pane are exactly that. `InfoTip` and `RowMenu` are the reference
implementations. Serdar has flagged this repeatedly across projects; treat a
clipped popup as a bug you introduced knowingly.

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

## Borders only when absolutely necessary (Serdar's design language)

Borders belong to CONTAINERS (cards, inputs, dropdown panels) — never to
buttons. Secondary/ghost buttons are text + hover wash
(`text-muted hover:bg-muted-bg`), primary buttons are solid accent fill.
A bordered chip where a ghost button belongs reads as sloppy; check every
new control against this before shipping it.
