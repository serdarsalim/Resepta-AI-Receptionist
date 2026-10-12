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

## How to read this file (split 2026-09-03)

This file is the RULES: invariants, conventions, design rules, landmines. It is
loaded into every session, so it stays short. Everything else moved out:

- **[`docs/subsystems.md`](docs/subsystems.md)** — how each part works AS
  BUILT: the message model, onboarding, the current IA, the contact record,
  the chat agent, the calendar, multi-business, members, the fleet table, the
  Meta-number and prod-seeds-dev runbooks. Read the section for the area you
  are about to touch.
- **[`docs/journal/`](docs/journal/README.md)** — dated session write-ups, one
  file per month, oldest first: what changed, what was tried, what was
  superseded. Read for *why*, never for what stands today.
- **[`docs/open-issues.md`](docs/open-issues.md)** — open product questions
  and known gaps. Check before proposing work.

When a session changes a rule, EDIT the rule here in the same change and put
the story in the journal. An appended correction is not a fix; the stale line
is still the first one a reader meets.

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

## Deleting a customer deletes them (2026-10-13)

KVKK lets a person ask a business to erase them. `customers.remove`, the office
MCP's `delete_customer` and the undo of `create_customers` all go through
`beginCustomerDeletion` in [`convex/customerDeletion.ts`](convex/customerDeletion.ts);
nothing else deletes a customer row. How it runs is in `docs/subsystems.md` →
"Deleting a customer".

- **`FOOTPRINT` is the one list of every table that holds a customer**, by
  `customerId` or by their number, and it serves both the MCP preview's counts
  and the sweep. **When you add a table that references a customer, add it
  there in the same change.** Forgetting leaves their data behind under a
  customer that no longer exists.
- **Gone first, swept after.** The first transaction REPLACES the row with a
  blank carrying `deletingAt`, so nothing personal survives it; turns the phone
  into a tombstone, so `by_org_phone` stops finding them and a new message or
  call from that number starts a NEW customer; drops the thread summary
  (inbox); cancels every queued send; and deletes their appointments (calendar,
  reminders). A scheduled sweep pages through the rest, asserts `orgId` on every
  row, and deletes the row last, in the pass that finds every table empty.
- **A deleting customer is gone to every reader.** A path that loads a customer
  by id to show them, message them or attach something to them checks
  `isDeleting` (`lib/customerDeletion.ts`). `messages.logOutQueued` refuses as
  the backstop every send crosses, and `writeThread` never writes a summary
  back onto them.
- **The audit trail is emptied, not erased.** `activityLog` rows lose the
  customer and appointment link and their free-text detail (a status change and
  field names stay). `agentActions` rows lose the values a tool wrote; tools
  that journal only ids keep theirs, which is what keeps an import's undo
  working for everyone else in it. The deletion writes one `customer_deleted`
  row saying who did it and never whom.
- **An erased call stays erased.** Its provider events become one
  `customer_deleted` marker in `voiceEvents`; `voiceEvents.enqueue`,
  `retell.recordCall` and the analysis recovery check it, because a late
  webhook would otherwise write the call back with a new customer.
- **Provider copies are not touched**, as in Nudge: the phone provider keeps
  its recording and transcript, the messaging and email providers keep theirs.

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

**The agent's tools read the caller from that same leg, never from a model
argument** (2026-10-13). `/retell/functions` resolves who is calling through
`retell.callerOfCall` and ignores any `phone` an agent sends: a number read out
loud is anybody's, and the old `args.phone ?? from_number` let a caller act on
another customer's record. No usable number (hidden caller ID, web call, the
business's own line) means book, save and find/cancel/reschedule refuse with a
sentence the agent can say, which also tells it not to take a number instead.
The legacy `/retell/mcp` carries no call at all, so it identifies nobody:
`get_call_context` answers the business half and `save_customer_details`
refuses. Never add a tool argument that names a customer, a phone or an
appointment.

**Tool answers are live; tool definitions are versioned** (2026-10-13).
Whatever `/retell/functions` says reaches every agent at once, whatever
template it runs, while a tool's schema, description and holding line reach an
agent only when its owner clicks Update. So a sentence in a tool answer may
name only the five calendar tools every version has carried since v1, never
`end_call` (a business can switch it off), and new tool wording names no other
tool at all (Nudge ba2d956a). A time a tool takes is the business's wall time,
`YYYY-MM-DDTHH:MM`, never UTC.

**Recogniser hints are derived, and only ours are replaced** (2026-10-13). An
agent's `boosted_keywords` are this org's name, active team and active
services (`lib/boostedKeywords`), read by org after the agent is proven to be
the org's, never another business's: the provider account is shared. Every
publish that writes the agent doc sends them through `keywordPatch`, and a new
one must too. `retellAgents.boostedKeywords` records which words Resepta sent,
so the next publish swaps only those and keeps anything typed in the
provider's dashboard; a list that would come out empty is never sent.

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

**A non-answer is not an answer** (2026-10-13). "Belirtilmedi", "Not
specified", "Nicht angegeben" and their siblings (`lib/nonAnswer.ts`, Nudge's
list in three languages) are what a model writes when told to leave a field
empty. They are never stored: `coerceVoiceValues` drops them like empty
strings, and `applyVoiceContactValues`, the gate both lanes share, skips them
and lets a real answer replace one stored earlier. They are never read back:
the ring-time injection and `builtinAgentVariables` treat a stored one as an
empty field. "Yok", "None" and "Keine" count only where a name is expected;
in a custom field, "no allergies" is the answer a clinic needs. Any new path
that saves what an agent collected goes through those two functions.

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

## The assistants touch only the customer's own appointments (2026-10-13)

Both agents (phone and WhatsApp) find, move and cancel through
[`convex/agentAppointments.ts`](convex/agentAppointments.ts). Ported from
Nudge's `meetingTools.ts`; do not grow a second path.

- **Whose comes from the channel**, the call leg or the conversation, never a
  tool argument. **Which comes from what the agent read back**: cancel and
  reschedule take `appointment_start`, the start find_appointment /
  my_appointments gave, and act only on the customer's own open appointment
  at exactly that minute in that org, else `appointment-changed`. Never
  "whatever is next now": a repeat finds it already cancelled or moved and is
  a no-op answer. A voice engine older than template v14 has no
  `appointment_start`; it keeps "the next one" but is refused for three
  minutes after any change.
- **A move is judged in the transaction that writes it**, with the booking
  page's own helpers exported from `booking.ts`: the span fits that day's
  hours, no closure, capacity with the row not blocking itself, no clash with
  the customer's other bookings, a good's lead time.
- **Six changes a day per customer** (`customers.agentChangesAt`,
  `lib/agentChange.ts`, Nudge's number). Bookings, moves and cancels by the
  assistants, moves and cancels on the customer's own manage page
  (`/appt/<token>`) and their own WhatsApp cancel (İPTAL, the cancel button)
  all count. Past the sixth the assistants refuse moves, cancels AND new
  bookings, and the manage page refuses moves; a customer's own cancel is
  counted and never refused (Serdar's call via the coordinator, 2026-10-13).
  On the phone the team is emailed (`bookNeedsPerson`/`moveNeedsPerson`/
  `cancelNeedsPerson`, failed-send switch) because the agent promised a
  colleague; in chat the agent is told to call `escalate_to_staff`, which
  follows the handover setting.
- **A "no" about a time carries the nearest free times**
  (`retell.nearestFreeTimes`, built on the booking page's `freeStarts`, so
  what it offers the write will accept). Both lanes' `check_availability`
  answer the asked `time` through one verdict (`judgeRequestedTime`).
- **A booking asked for twice is one booking**: `voiceBook` returns the
  customer's open appointment at that exact minute with the same services (a
  recent ASAP order with the same lines) instead of making a second; a
  different visit at that minute is their own clash, and the agents obey the booking
  page's `MAX_UPCOMING_PER_PHONE` (`lib/bookingLimits`) through
  `bookingProblem`, the guard list `voiceBook` and its dry run share.
- **A chat reply that only suggests changes nothing.** In suggest and shadow
  the write tools (book, move, cancel, save) record the change on the turn
  (`chatAgentTurns.intents`) instead of making it. Sending the draft makes
  ALL of its changes in ONE transaction (`chatAgent.applyDraftChanges`): one
  refusal rolls back every change and every message they scheduled, nothing
  is sent, and only then does the composer say nothing changed. The dry run
  is the same code (`applyIntentsTx`) in a nested mutation that always throws
  (`simulateDraft`), so each change is judged after the draft's earlier ones.
  A change cal.com would have to make is refused in a draft. The composer
  shows the change above the box. Live writes as it goes. Any new write tool
  must take the draft path too.

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

## Explanations ride the (i); surfaces carry controls and facts (2026-08-25, standing)

A day of Serdar's screenshots repeated one correction until it is a rule:
**inline explainer prose goes behind an InfoTip, every time.** The billing
mode sentence, the fleet engine paragraph, the prompt card's scope note, the
number card's 24-hour promise — each was the longest thing on its surface,
explaining a control to people who mostly already know it. The reader who
needs the explanation hovers; the reader who knows scans labels. The only
prose that stays visible is a STATE the user must act on (an outage banner, a
drift warning) or a wizard step's subtitle, where explaining is the slot's
job.

Two siblings from the same day. **Money fields are short and wear their $**
(`Row money` flag: 7rem, decimal keypad, $ inside the border) — a field's
width is a promise about how much you are meant to type, and "(USD)" left the
labels once the field said it. And **each locale speaks to its own reader**:
the number-promise copy named Türkiye, Germany, Austria and the UK in all
three languages, which reads as internal coverage notes — a salon owner in
Bursa does not need the UK to upload a document. State the one fact that
matters in that reader's world; name nobody else's country.

## Bandwidth: a live query pays per re-run, not per row (audited 2026-09-03)

The deployment had read 1.14 GB of database bandwidth in ten days with one
tester on it. The usage page's per-function breakdown (team settings →
Usage → Database I/O — Insights does NOT catch this class, every single
execution was under its thresholds) put 90% of it on six functions:

| function | 10-day I/O | what it did |
| --- | --- | --- |
| voiceEvents.health | 337 MB | 200 newest voice events, each carrying the full Retell webhook body, re-run on every event write |
| messages.inboxUnseenCount | 276 MB | the org's 500 newest messages + 200 newest calls, grouped by customer, from the always-mounted shell |
| platform.orgDetail | 202 MB | the same 200-event payload scan, on the operator's page |
| messages.conversations | 97 MB | the same 700-row scan, from the Inbox |
| customers.get / customers.list | 101 MB | the same scan again, to draw one dot |
| platform.fleet | 42 MB | eight tables at a 2,000-row cap, invalidated by any write anywhere |

The shape behind all of them: a subscription whose read set is O(org) re-ran
on every write that landed inside it, and the rows it re-read carry email
HTML, call transcripts and provider payloads. Cost = clients × writes × rows,
which is quadratic on a busy day. Nudge hit the same thing at 37 GB in one
day on a 1k WhatsApp blast (its AGENTS.md, 2026-09-02).

**Three rules now hold, and the write paths carry them:**

1. **A processed voice event has no payload.** `voiceEvents.complete` nulls
   it; every fact in it is on the calls row. A failed row keeps its body so a
   retry can replay it. `health` and `orgDetail` read `by_org_status` ranges
   (failed / retrying / processing, plus queued on the operator page), which
   are empty on a healthy org. `voiceEvents:stripProcessedPayloads` is the
   one-off for rows processed before this.
2. **The inbox reads `customers.thread`, never the messages table.**
   [`lib/thread.ts`](convex/lib/thread.ts) owns the summary (newest entry,
   newest inbound/outbound/failure, latest entry per channel — every field a
   max over `at`, so one fold serves an insert and a rebuild alike). **Any
   mutation that inserts a `messages` or `calls` row calls `noteMessage` /
   `noteCall`; any that fails a row, fills a call's analysis, attaches media
   or deletes a scheduled row calls `recomputeThread`.** Same standing as
   `syncAppointmentSchedule`. `conversations`, `inboxUnseenCount`,
   `markAllConversationsRead`, `inboxPin`, `customers.list` and
   `customers.get` walk `by_org_thread_last` / `by_org_thread_inbound` and
   read exactly the customers they show. `threads:backfill` rebuilds every
   row and is idempotent — run it if a write path is ever found to have
   skipped its call.
3. **Per-agent call figures are counters.** `retellAgents.callCount` and
   `lastCallStartedAt`, bumped by `recordCall` on the INSERT only; "today"
   is a `by_org_started` range. `retell:backfillCallCounters` seeds them.

Left alone, knowingly: `platform.fleet` (operator-only, 42 MB, reads the
whole fleet by design — the fix is a per-org health row kept by triggers, not
worth it before there is a fleet); the four every-minute crons (57K of the
117K function calls, negligible I/O — function calls are not the constraint);
`orgs.current`, subscribed 17 times per client but deduplicated by the Convex
client to one subscription and 11 MB total.

How to check next time: the usage page's Database I/O breakdown by function,
not Insights, not the logs. If a query's total is out of proportion to what
its screen shows, ask what its read set is and what writes land inside it.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## 2026-10-04: Convex agent guidance (Serdar)

Installed the official Convex AI files and project-local skills for Codex and
Claude Code at Serdar's request. Keep vendor guidance in its managed section;
project-specific architecture, wrappers, development and deployment rules take
precedence over generic examples. Refresh with `npx convex ai-files update`.
