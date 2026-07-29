# Randevu — working in this codebase

> **Read [`docs/wwsd.md`](docs/wwsd.md) FIRST.** It is the decision model —
> how Serdar picks, what he rejects, and the design-language violations he has
> personally flagged. Every rule there came from a real correction. Consult it
> before building a surface, not after it gets rejected.

WhatsApp appointment automation for SMBs (salons, barbers, dentists). One shared
deployment serves EVERY business — this is the multi-org sibling of Nudge
(`../nudge`), which is instance-per-tenant. The two products deliberately do not
share a codebase; Randevu borrows Nudge's proven pieces (the wa_cloud sender,
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
  and the appointment is Randevu's alone. **Consequence: today nothing checks
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
- WhatsApp is the wa_cloud lane ONLY (Meta Cloud API). Business-initiated sends
  (reminders, confirmations) use pre-approved **template messages** — that is
  the core send path here, unlike Nudge where template sends are unbuilt. Each
  org connects its own WABA number (`waAccounts`); the org enters its approved
  template names in Settings.

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
Do not import `lib/platformAuth` anywhere else.

## Two kinds of template, never conflate them

- **Meta template messages** are business-initiated, registered with Meta and
  filled BY POSITION: `{{1}}` first name, `{{2}}` business, `{{3}}` appointment
  time. Meta approved that exact string; we do not rewrite it.
- **Everything else** — away-reply, composer text, campaign line, email body —
  is ours and takes NAMED tokens (`[ad]`, `[isletme]`, `[tarih]`) via
  [`lib/renderTokens.ts`](convex/lib/renderTokens.ts). Token names deliberately
  do not translate: the stored string cannot be right in three languages at
  once. An unresolved token renders as nothing, never as itself.

Campaigns are business-initiated, so they MUST ride an approved template. The
campaign template's `{{3}}` is a free line the campaign supplies, which is what
makes one Meta approval cover every campaign the salon will ever run.

## i18n — two layers, don't conflate them

1. **Customer-facing (WhatsApp).** Language resolves per customer:
   `customers.language ?? orgs.language`. Template selection is an EXACT match
   on `(kind, language, status="approved")` with **no cross-language
   fallback** — a missing template logs a failed message rather than shipping
   the wrong language (the Nudge lesson). Dates inside messages format through
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

## Open product questions (unresolved as of 2026-07-25)

These change what gets built next — don't paper over them:

- **Operator model.** Self-serve (current) vs partner-operated agency vs
  hybrid. Affects whether a super-admin surface exists at all.
- **WABA ownership.** Does each salon go through Meta embedded signup, or does
  the partner hold numbers as a Tech Provider? This is the real onboarding
  bottleneck and it is unvalidated.
- **Template approval.** Every org currently types its own Meta-approved
  template names into Settings. If the partner owns the WABA, templates are
  approved once centrally and this UI gets much smaller.

## Conventions carried over from Nudge

- `npx tsc --noEmit` must pass before every commit.
- `convex/_generated/` is CHECKED IN — commit it alongside any backend change
  that adds/renames a function or table (Vercel's typecheck reads the committed
  copy).
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

**5. Never invent a word the UI already asks the user for.** The People card
asks "what do you call these people?" and stores it as `staffLabel` — so the
add sheet says "Personel"/"Berber"/"Stylist", not a coined term like "bookable
person". Check whether the product already has the user's own word before
naming something.

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

## Borders only when absolutely necessary (Serdar's design language)

Borders belong to CONTAINERS (cards, inputs, dropdown panels) — never to
buttons. Secondary/ghost buttons are text + hover wash
(`text-muted hover:bg-muted-bg`), primary buttons are solid accent fill.
A bordered chip where a ghost button belongs reads as sloppy; check every
new control against this before shipping it.
