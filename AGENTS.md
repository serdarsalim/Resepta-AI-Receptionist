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
  the chat agent, the calendar, multi-business, members, bulk call runs, the
  fleet table, the Meta-number and prod-seeds-dev runbooks. Read the section for the area you
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
`orgId` and an index starting with it, and a line in `ORG_TABLES`
(`convex/platform.ts`) so deleting the business deletes its rows; the typecheck
fails, naming the table, until you do. When you add a query/mutation, resolve the
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
  and the appointment is Resepta's alone. **The salon-facing calendar judges
  every create and move itself, for every business** (2026-10-13, P6 of the
  Nudge port; `schedule.judgeSlot`, built on the booking page's own helpers):
  outside that day's opening hours, blocked time, the customer already booked
  then, the team member picked already booked then, or every active team
  member busy. Any of those comes back `canForce` with the verdict; the sheet
  asks "Book it anyway?" (a drag asks "Move it anyway?") and the same call
  with `force` books it. The server refuses without `force`, not the UI:
  `prepareCreate` before a new customer is written, `finishCreate` and
  `finishMove` again in the transaction that writes, `updateDetails` for a
  change of person alone. Only these signed-in staff writes take `force`; the
  booking page and the assistants never can, and cal.com's own refusals ride
  the same `canForce`. A start in the past and a time inside the minimum
  notice are never refused here; the sheet only says so. Not judged: the
  office MCP's `create_appointments` (an import of a book that already
  exists) and reopening a cancelled booking from the list.

  Manual entry in the app stays for walk-ins; `appointments.source`
  distinguishes them and `externalUid` is cal.com's booking uid.
- **Blocked time is the business's `closures`, never a fake appointment**
  (2026-08-31; this line said "not modelled" until P5 found it stale). A lunch
  break, a holiday or a morning off is a closure row (weekdays, or a date with
  an optional last day; a window or all day), drawn on the calendar where an
  appointment would be (the Blocked time half of the sheet a drawn slot opens,
  `BlockSheet`) and refused by the booking page and both agents. The owner's
  own grid shades it, and booking or dropping onto it asks first (the
  calendar verdict's `closed`). It is BUSINESS-wide: a
  block drawn in one person's day-view column still shuts the whole business.
  Per-person blocks (Nudge's `hostBlocks`) are an open call for Serdar; do not
  add a staff field to closures without it. `appointments.customerId` stays
  required: a block is availability, not an appointment.
- **A booking whose start has passed is a record, not news** (2026-10-13,
  Nudge c8e1e523). `scheduleLifecycleMessages` sends the customer nothing for
  it on the booking trigger (yesterday's walk-in, a move into the past) or on
  a cancel the business makes in the app (`byBusiness`). A customer's own
  late cancel still gets its answer, and an ASAP order is never past. Book,
  move and cancel through that function and the rule comes with it.
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
- **A number shared with Nudge keeps Resepta's Meta callback.** Only explicit
  `WA_WEBHOOK_MIRRORS` routes copy its scoped events, signed and retried; never
  forward another business's batch. See `docs/subsystems.md` → Message model.

## Delivery is a queue, not a fire-and-forget

`messages.applySendResult` is the ONE place a send outcome is decided — retry
policy, dead-lettering and the failure alert all have to agree, and one
function is the only way to guarantee they do. Never alert from a call site.

- Failures are classified in [`lib/sendFailure.ts`](convex/lib/sendFailure.ts).
  **Permanent** (unsubscribed, no approved template, shut 24h window, bad token,
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
- **A composed email is parked before it goes** (2026-10-17, P28). The
  compose window's Send holds it ten seconds for Undo and Schedule send holds
  it until its time: `email.sendToCustomer` writes the row queued with
  `scheduledFor`, and `email.claimParked` re-checks every refusal at the
  moment it goes. WhatsApp's parked sweep must leave `email_reply` rows
  alone, and a new parked kind needs its own claim on the same pattern.

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

KVKK lets a person ask a business to erase them. `customers.remove` (the
customer record's ⋯ → Delete customer), the office MCP's `delete_customer` and
the undo of `create_customers` all go through `beginCustomerDeletion` in
[`convex/customerDeletion.ts`](convex/customerDeletion.ts); nothing else deletes
a customer row. How it runs is in `docs/subsystems.md` → "Deleting a customer".

- **Deleting a customer is an owner's decision, checked on the server** (since
  2026-10-13; it was any member). `customers.remove` takes `requireOwner`, and
  the MCP's `preview_delete_customer` and `delete_customer` re-derive the role
  from `memberships` (`assertOwner`) on every call. A new door gets the same
  check. The one exception is the undo of `create_customers`, which stays with
  whoever ran the import: it removes only rows that same call created and that
  nothing has happened to since (no appointment, message, call or note), so it
  cannot erase a customer the business holds.

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
  `retell.recordCall`, the post-call `updateContactFromVoice` and the analysis
  recovery check it, because a late webhook or a processor already in flight
  would otherwise write the call, or its answers, back onto a new customer.
  Likewise an assistant turn that finishes after the deletion keeps no row
  (`recordTurn` returns null) and sends nothing.
- **Provider copies are not touched**, as in Nudge: the phone provider keeps
  its recording and transcript, the messaging and email providers keep theirs.

## "No AI calls" is its own fact, never Unsubscribe (2026-10-13)

`customers.noAiCallsAt`: the customer asked not to be called by the AI. It is
NOT Unsubscribe and must never be folded into it: a customer who refuses robot
calls may still want offers by message, and Unsubscribe stops marketing on
every channel, bulk calls included. Neither stops their reminders.

- **Every path where the AI dials out checks it.** Bulk call runs skip them
  through `bulkRuns.skipReason` (launch, fan-out and every `claimNextCall`, so a
  request made mid-run holds), and a requested callback is refused or
  cancelled through `bulkRuns.reachReason`. `retellAgent.testCall`, the one
  door where a person places an AI call by hand, refuses `no-ai-calls` unless
  the caller sends `callAnyway`, which the record's Place call does only after
  the person confirms. A new dial-out path gets the same check before it
  reaches Retell.
- **The phone agent can set it and never clear it.** The post-call analysis
  field `resepta_no_ai_calls` (a boolean, template v15) reaches the record only
  as a yes, through `retell.markNoAiCallsFromCall`. Only a person clears it, on
  the record's switch (`customers.setNoAiCalls`, any member).
- It changes nothing in the demo org, which never dials.

## A bulk call rings only when it should (2026-10-17)

`bulkRuns.claimNextCall` is the one place a call run decides to dial, and
every guard lives in it, in the transaction that claims: the reaper restarts
every running run every five minutes and a resume dials at once, so a guard
kept anywhere else is dialled straight through. How it runs is in
`docs/subsystems.md` → "Bulk call runs".

- **Only while the business is open**, in its own timezone: its opening
  hours with closures cut out, or its send window when it set no hours.
  Closed, the run is HELD on its own row (`heldUntil` / `heldReason`) with
  one wake-up for the minute it opens (`lib/businessHours.nextOpenAt`).
- **Who is rung is judged at their turn**, not at fan-out: Unsubscribe and No
  AI calls (`skipReason`), then `turnSkipReason` (an open booking ahead, or a
  call with them already today). Every skip is a reason the run detail prints.
- **A refused dial is not a call.** No free line (429, 5xx, a full pool, the
  provider ending it for want of lines) puts the customer back in line
  through the same hold (`requeueRefusedCall`) instead of failing them, for
  up to six tries; a thrown fetch is never re-dialled, since that call may be
  ringing.
- **What a call came to is read from the disconnect code** (`lib/callOutcome`),
  never from a transcript, and only a call that reached the phone counts as
  done.
- **One call per run**, plus the operator's optional platform-wide limit
  (`platformConfig` `bulkCallConcurrency`): one provider account carries every
  business's calls and every inbound call. A new automated dial-out path
  takes the same guards before it reaches the provider.

## A requested callback is one call, guarded like a bulk call (2026-10-18)

"Call me back tomorrow at four" (P36, `convex/callbacks.ts`; how it runs is
in `docs/subsystems.md` → "Requested callbacks"). The post-call analysis
field `resepta_callback_time` (template v16, the business's wall time)
becomes ONE `callbacks` row through `callbacks.requestFromCall`, and only
for an answered call, outside the demo, for a customer the AI may call
(`bulkRuns.reachReason`). One queued per customer; a newer request replaces it.

- **`callbacks.claim` holds every guard**, in the transaction that claims,
  for the bulk queue's reason: open hours (`bulkRuns.callWindowAt`, held to
  the opening), No AI calls and a usable number (`bulkRuns.reachReason`;
  Unsubscribe never cancels a call the customer asked for), another
  automated call ringing them, the operator's limit (which now counts bulk
  items and callbacks together, both sides), the agent and its line. The
  dial is pinned to the published version (`placeCall`) and a refusal for
  want of a line requeues up to six tries. Not the bulk "already called
  today" skip: this call was asked for.
- **What cancels it** is a real conversation after the request
  (`stampCallClocks`, either direction), a person's own dial (`testCall`),
  the record's Cancel (any member) and the customer's deletion, each leaving
  its reason on the row. A new dial path a person triggers cancels them too.

## Consent is not a gate; Unsubscribe stops marketing (2026-10-21)

Serdar removed the record's Consent switch and the gate behind it: every
customer a business reaches out to has already agreed to hear from it, so
`customers.consentAt` mostly stopped reminders reaching people added by hand
or imported. Nothing reads or writes it now; it stays in the schema, dead,
because rows still carry it. Recording marketing consent where the law asks
for it (İYS) is the business's duty, and the privacy notice says so.

- **Booking messages and replies reach every customer**: confirmations,
  reminders, follow-ups, cancellation notices, the away reply, the
  assistants, a person's own message.
- **Marketing is `lib/marketing`**: campaigns, bulk messages and bulk calls,
  win-backs (`isMarketingKind`: its own WhatsApp kinds plus the email kinds
  from `lib/email`; a new marketing kind joins one of the two sets). It skips
  a customer who unsubscribed (`isUnsubscribed`, on
  `customers.marketingEmailOptOutAt`, whose name still says email) on every
  channel: `bulkRuns.skipReason` (launch, fan-out, every call claim),
  campaigns at the segment and again at each row, `wa.sendAppointmentMessage`
  for a win-back, and `delivery.claimForRetry`, the backstop every queued
  message crosses. A new marketing path checks it before the provider. Read
  the helper, never the field.
- **A requested callback is not marketing**: `callbacks.ts` asks
  `bulkRuns.reachReason` (deleted, No AI calls, a usable number), never
  `skipReason`.
- `customers.create`, `customers.update` and `schedule.create` still accept a
  `consent` flag and ignore it, for tabs loaded before 2026-10-21. `no-consent`
  stays classified (sendFailure, alerts, the thread) for old rows.

## Marketing email carries an unsubscribe link (2026-10-13)

Marketing mail is `lib/email.isMarketingEmailKind`: `email_campaign`,
`email_bulk`, `email_winback`. It carries a visible "unsubscribe" link and the
`List-Unsubscribe` + `List-Unsubscribe-Post` (one-click) headers. Everything
else a business emails (confirmations, reminders, follow-ups, cancellation
notices, composer replies) carries neither and never stops for an opt-out. A
new marketing kind goes into that set.

- **The link is the message's token and nothing else.** `/e/u/<trackingToken>`
  on the app's own origin (below); `messages.unsubscribeTarget` resolves it to the
  row's org and the row's customer, checks they match, and accepts only a
  marketing row's token. Every business sends from one shared domain, so never
  key an unsubscribe on the email address, and never let the page name any
  business but the one the token resolved to. The GET only asks; the POST (the
  page's button, or the mail client's one-click) unsubscribes.
- **Links in customer mail live on the app's origin, never on convex.site**
  (2026-10-13). `lib/email.emailLinkOrigin` builds the unsubscribe link and the
  open pixel on `SITE_URL`, and `src/proxy.ts` rewrites exactly `/e/o/<token>`,
  `/e/u/<token>` and `/e/i/<assetId>` to the Convex routes of the same name,
  method and body intact. A bare `*.convex.site` link reads as unbranded and
  costs every business deliverability, since they all send from our one
  domain. The Convex routes never move: mail already sent points at them
  directly. A new link in customer mail takes the same path, a route in
  `convex/http.ts` plus one line in the proxy's pattern.
  **Images too** (2026-10-17, P26): the email editor's Insert photo stores a
  library image as a RELATIVE `/e/i/<assetId>`, `sendEmail` makes it absolute
  on `SITE_URL` (`withAbsoluteEmailImages`, so the first attempt and every
  retry get it), and the route streams only library images
  (`media.emailImage`), never a storage URL and never a customer's inbound
  file. `media.remove` refuses an image an email template still shows.
- **The link and the record's Unsubscribe switch set one fact**
  (`customers.marketingEmailOptOutAt`), and it stops marketing on every
  channel ("Consent is not a gate", above). The page says so, naming email,
  WhatsApp and phone. The switch is any member's
  (`customers.setMarketingEmailOptOut`), for a request made in person.
  Turning it OFF puts someone back on marketing, so it asks first; both
  directions write an activity row.

## Only the embedded booking page may be framed (2026-10-17)

`next.config.ts` sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`
on every path, and lifts both for exactly one: `/book/<slug>/embed`, which
`public/embed.js` puts inside a business's own website (P29, `lib/embed.ts`).
The app, the plain booking page and the manage page stay unframeable, since a
page layered under an invisible overlay is a page whose buttons a stranger
can get clicked. The embed is safe to frame because it holds no session and
shows only what the business publishes, and it tells the website what was
booked, never who. A new embeddable surface gets its own route and its own
line there, never a wider pattern, and posts nothing personal to its parent.

## Two kinds of template, never conflate them

- **Meta template messages** are business-initiated, registered with Meta and
  filled BY POSITION: `{{1}}` first name, `{{2}}` business, `{{3}}` appointment
  time. Meta approved that exact string; we do not rewrite it.
- **Everything else** — away-reply, composer text, campaign line, email body —
  is ours and takes NAMED tokens (`[ad]`, `[isletme]`, `[tarih]`) via
  [`lib/renderTokens.ts`](convex/lib/renderTokens.ts). Token names deliberately
  do not translate: the stored string cannot be right in three languages at
  once. An unresolved token renders as nothing, never as itself.

**A token is stored by its key and shown by its label** (2026-10-17, P15).
The plain-text message boxes are `TokenTextField` and the email body is
`EmailBodyEditor` with the `VariableToken` chip; both read
`useMessageVariables()` (the dropdown's own list), show `[business]` as
"İşletme adı" in the reader's language, open the list on "@", and save the
`[key]` (`lib/tokenLabels`, `lib/emailTokens`). An alias in an old body shows
as its variable's chip. A new box that holds tokens uses one of the two,
never a bare textarea.

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
number is connected. Rule, campaign and bulk email carries an open pixel
(`/e/o/<token>` on the app's origin, routed to `convex/http.ts`,
`messages.recordEmailOpen`, 15s prefetch guard); opens surface as a RATE on
the template row and the campaign row — never as a per-customer "opened"
badge, because relay prefetch makes the individual fact a guess. The same token is what the unsubscribe link at the
foot of marketing mail resolves ("Marketing email carries an unsubscribe
link", above).

## The business address is three lines stored, one line shown (2026-10-21)

`orgs.address` keeps up to three lines (`lib/businessAddress`,
`normaliseAddress` on save: blank lines dropped, anything past the third
folded onto it, 200 characters). Every reader that shows it on one line goes
through `addressOneLine`, which joins the lines with commas: the ICS LOCATION
(`lib/ics`), the `[address]` token (`lib/renderTokens`, so every message and
Meta parameter), and the booking, manage and link-preview queries in
`booking.ts`. A new one-line reader uses it too: a raw newline breaks a
sentence, is refused in a Meta parameter, and collapses to a space in HTML.

## i18n — two layers, don't conflate them

1. **Customer-facing (WhatsApp).** Language resolves per customer:
   `customers.language ?? orgs.language`. The content row is an EXACT match on
   `(kind, language)` with **no cross-language fallback** — a missing template
   logs a failed message rather than shipping the wrong language (the Nudge
   lesson). The Cloud send additionally requires `status === "approved"` plus
   a `metaName` on that same row. Dates inside messages format through
   `convex/lib/format.ts` in the ORG's timezone and the message language.

   **Who sets `customers.language`** (2026-10-17, P30). Unset is the
   business's language, a guess. A person sets it (the record's Language
   row, `customers.update`; the office connector; an import), and that clears
   `languageLearnedAt`. The system sets it only through
   `learnCustomerLanguage` (`lib/customerLanguage`): from a typed WhatsApp
   reply (never a button tap) or the customer's own words on a call whose
   disconnect code says answered, read by the local detector
   `lib/textLanguage`, only while the field is unset, never in the demo org,
   and only when `orgCanSendIn` finds wording (and Meta approval where the
   business's own language has it) for every kind the business sends. A new
   path that learns a language goes through that function; nothing calls an
   LLM to guess one.
2. **App UI.** A typed dictionary in `src/lib/i18n.ts` (`tr`/`en`/`de`)
   behind `LanguageProvider` + `useT()`. Adding a language = adding a column;
   adding a string = adding a key (the union type makes a missing key or a
   missing language a compile error). Values go through the translator, never
   `.replace("{x}")`: `t("bulk.counts", { done, total, failed, skipped })`,
   with the placeholder names read off the dictionary's literal types, so a
   missing or misspelled value fails the typecheck too. A count that changes
   the words is a `<base>.one` / `<base>.other` pair read with
   `t.plural(base, count)` (the language's own plural rule, {n} filled with
   the count in local digits); "1 days" was on screen until 2026-10-13. The
   public booking and manage pages build theirs with
   `createTranslator(pageLanguage)`. Deliberately NOT next-intl: no
   locale-prefixed routes and no SEO surface in a logged-in app. A future
   PUBLIC booking page can adopt next-intl on its own without touching this.
   The signed-in app follows the person's own language, else the business's
   (`me.language ?? orgs.language`); the sign-in screen falls back to
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
  for the same widths (services: `SERVICE_ROW_GRID`). Every track must hold its value AND its unit at the 16px
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
  not inline paragraphs. Deliberate exceptions, each because one press puts
  words live: the voice agent's Publish (a new version at the provider, which
  every next call speaks) and the automation editor's Save (customers keep
  getting the last saved message until it is pressed); plus the knowledge
  editor's Cancel/Save, for the portal reason given under "Knowledge reads as
  prose". Where an exception applies the controls are `EditorSaveBar`, and
  ONE thing in that row is boxed: the action that ends the state. The state
  is an amber dot and a sentence, unboxed; Discard is `quiet`, never red
  (Nudge, 2026-09-21; here 2026-10-13).
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
thing, the sheet asks which — do not stack both forms and hope. A sheet that
holds typed words passes `dirty` (the bulk and campaign composers do): Escape
and a backdrop click then leave it open and only Cancel closes it, because
Escape is also how the variable and emoji menus inside it close (2026-10-13).
Writing to ONE customer is not a sheet at all: the email compose window
(`ComposeDock`, P28) docks bottom-right over a usable page, never closes on an
outside click or Escape, and keeps its draft in the browser. A new composer
for one person takes the dock, not a sheet.

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
have. In a settings card every field is ONE width, the value column's 24rem
(Serdar, 2026-10-21, after Nudge's Branding card; capping each box to its own
text had given the General card five widths). A row that holds two things
(Industry and its Reset, Currency and Show decimals) splits that width instead
of adding to it, and a suffix (the incoming address's @domain, the notice's
unit) sits INSIDE the box, one shell drawing the border and the focus. The
label is a `ControlLabel` (RowLabel.tsx): on its control's text line from
sm, and close over its own field on a phone.

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

**A floating list wears `.menu-surface`** (2026-10-17, P19, Nudge
04fda8a7): the card fill, border and shadow in light, and in dark a fill a
step lighter than the card with a visible edge, because a dark shadow
vanishes and a panel filled like the card it opens over reads as part of it.
A new dropdown, menu or list panel takes the class instead of spelling
`border bg-[var(--card)] shadow-lg`. Tooltips are not lists and keep theirs.

**Every menu goes through the hook; none positions itself** (2026-10-13).
Twelve had hand-rolled their own placement. Ten closed on any scroll: the
calendar's row ⋯ and view menu, the inbox ⋯, the emoji picker, the account
menu, the business switcher, the composer's +, the country code picker, the
prompt editor's @ menu and the console's engine picker. The two console model
pickers were `absolute` children of their field instead. The hook covers what
they needed: `prefer: "above"` for a
drop-up, `gap`, `anchorRect` for a panel hung off the caret, `triggerRef` for
a component that reads its own trigger, `show()` to open or re-place, `room`
for a list that shrinks to fit, `minWidth` for a trigger-wide panel that
needs a floor (2026-10-21), and it re-places a panel whose size changes
while open. A ⋯ of verbs is `RowMenu`, not a new copy.

**A short pick list is `SearchableSelect`, not a native select or a copy**
(2026-10-21): `searchable={false}` drops the search box for a handful of
options, an option's `group` draws a heading, and `values` + `triggerLabel`
hold one pick per group in one menu that stays open (the Testing tab's
Audio). `menuWidth="trigger"` with `menuMinWidth` keeps a list of long names
from being narrower than they need.

## A hover label is one look (2026-10-17)

A LABEL a control wears on hover is `HoverTip` (`src/components/HoverTip.tsx`,
Nudge's, P20 of the port): a dark chip (`TOOLTIP_LOOK`), instant, centred
under the control and clamped by its measured width, through a portal like
every popover. `side="right"` is the folded sidebar's: every row, the
account row and the operator chip name themselves beside the icon at once
(folded, the rail has no business switcher since 2026-10-21). The fold
toggle alone waits 500ms, because the pointer crosses it on the way into the
rail. `ActionTip` wears the same chip (`TOOLTIP_CHIP`, which may wrap).

- **Never a native `title` on an icon-only control.** It waits about a
  second and wears the operating system's look. Wrap the control in
  `HoverTip` and keep the words on `aria-label`.
- The wrapper is `inline-flex` by default. A full-width row takes
  `className="flex w-full"`; a child placed absolutely or by a grid takes
  `"contents"`, so the wrapper adds no box. A disabled button fires no mouse
  events: put `disabled:pointer-events-none` on it and let the wrapper own
  the hover, as the taken team colours do.
- An explanation is not a label: that is InfoTip's (i), a card that opens on
  click. Data previews (a calendar booking's chip, a truncated name's full
  text) may keep a native `title`; they are not controls.

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

**A one-of-N choice drawn as a track is `SegmentedControl`, never a copy**
(2026-10-13; Nudge's sliding pill since 2026-10-21). Eight hand-made ones were
folded into it, and every one drew its track with `--muted-bg`, which in dark
IS `--card`: the track vanished and the picked cell was near-black on
near-black. It runs on its own tokens: a round track (`--segment-track`,
light `#efeff1`) and ONE thumb (`--segment-thumb`, white with
`--segment-thumb-shadow`) MEASURED from the picked cell, never placed by
index, which slides to a new pick; a stacked row with icons (the theme row)
uses `rounded-xl` cells. Every cell stays font-medium so a click never
changes a cell's width, `semantics` says what it is (radio, tabs that swap
content, or menuitemradio inside a menu), and a radio group keyboards like
native radios: one tab stop on the pick, arrows to move it.

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
covers the bands that open below the header (the email and note composers, an
open thread's back-and-subject); keep it in step with the `threadRef` div.

**The resting action is not in that column** (P22, 2026-10-17; Nudge
18dfc375). Compose, Place call and Add note ride the right end of the header
row itself (`px-3`), so they end where the channel pills' row ends. Nudge's
pane had them on the feed column's inset, about 50px in under nothing, and
moved them out; Resepta already had them on the header row and keeps them
there. A new tab's resting button goes on that row, never into a band of its
own at `FEED_COL_PAD`.

Keep it as `calc(1rem + 9px)`, never a resolved pixel value. Nothing sets a root
font-size, so `rem` tracks the browser's font preference and Serdar's Chrome runs
17px, where a hardcoded 25px is out by a pixel and a half.

## The WhatsApp thread copies WhatsApp, measured (2026-10-17, P10)

Nudge's thread, measured off WhatsApp Web, brought back: plain `#f5f2ec`
paper with no doodles, Roboto (`.chat-font`, `--font-chat` from
`app/layout.tsx`; since P31 the whole conversation pane wears it, see "Two
faces" below), WhatsApp's own tail SVG on the first
bubble of a run with that top corner squared, 2px between bubbles of a run
and 12px between runs (margins collapsing with the list's `space-y-2`), and a
65% cap. Bodies render WhatsApp's `*bold*`, `_italic_`, `~strike~` and
```` ```mono``` ```` through `src/lib/waFormat.tsx`, which every surface that
shows a WhatsApp body the way the customer sees it uses (bubbles, quotes,
the message preview). A failed send's cause comes from `lib/waFailure` (Meta
codes we are sure of, never a guess), in the bubble and in the alert mail.
Measure against WhatsApp Web before changing any of it.

## Two faces, each with a job (2026-10-17, P31)

**Inter** (`--font-app-sans`, latin + latin-ext) is the app's face: every
page, the sidebar and header, and the public booking, manage, help and legal
pages. **Roboto** (`.chat-font`, `--font-chat`) is the COMMS face and only
that: the Inbox list and its pills, the conversation pane on every channel
tab, and the docked email window, so a person reads and writes every message
in one face (Nudge d55ab896, where Serdar settled it). Nunito stays on the
six letters of the wordmark. Never add a fourth. Geist went with this
change: it loaded the latin subset only, so ş, ğ, ı and İ dropped to a
fallback mid-word. Any new face must carry latin-ext. A width measured in
Geist (a column sized to its labels) wants re-measuring before it is trusted.

## Borders only when absolutely necessary (Serdar's design language)

Borders belong to CONTAINERS (cards, inputs, dropdown panels), never to
buttons. A button that needs an edge gets DEPTH instead (Nudge 2026-10-20,
Serdar after Attio; here 2026-10-21): the filled primary is crisp
(`--primary-bg`, `--solid-shadow`: a darker edge and a faint light line along
its top, `--primary-hover` darkening it), a secondary is RAISED (`--raised`,
`--raised-shadow`: white, a hairline ring, a soft drop; dark lifts with a
lighter surface and a top highlight, since a drop shadow vanishes on black).
Rings, never borders, so a button keeps its declared box. Ghost buttons stay
text on a hover wash, `--control-hover`, not `--muted-bg`, which in dark IS
`--card` and hovered to nothing. A bordered chip where a ghost button belongs
reads as sloppy; check every new control against this before shipping it.

## Controls have three heights, and the height is declared (2026-10-13)

`src/components/Control.tsx`, Nudge's control scale with this file's rules:
`buttonClass` / `iconButtonClass` / `fieldClass` / `controlClass` in three
sizes. `xs` 28px is dense chrome (an editor toolbar's pickers, a section
action beside a ⋯), `sm` 32px is the default (every control row, every
settings field, the booking sheet), `md` 36px is the booking sheet's footer.
A size names its `h-*` and padding sets only the horizontal rhythm: a height
built from padding and line-height drifts the moment the type changes, and a
native `<select>` ignores line-height altogether, which is how the Business
card's inputs and selects came out 34px and ~31px from the same classes. One
type size, `text-sm`; below sm the iOS rule in globals.css still wins.
Variants keep the border rule above: `ghost` and `quiet` have none, `primary`
is crisp and `outline` raised (both rings; `.card-action` in globals.css is
`outline` at sm and must agree with it), `pill` is a VIEW control, the
switch's thumb as a round raised button (the calendar's Today, its view menu
and team picker, a table's Columns), `danger` is muted until hovered. Shape
carries meaning: `rounded-lg` does work, `rounded-full` chooses what you see,
which is why `SegmentedControl` and the header search are round too. `FIELD`
(RowLabel) is `fieldClass("sm")`. Take a size from here for any new button or
field, and never stack a colour utility on a variant: two utilities at one
specificity are decided by Tailwind's order, not the class string.

## The shell is one frame; the cards are the paper (2026-10-13, joined 2026-10-21)

Nudge's shell (flush 607c9708, joined frame 5668cdfd; here 2026-10-13 and
2026-10-21). The frame meets the window edge: no shell padding, no gap, no
rounded sheet. The sidebar rail and a fixed 48px top bar (`h-12`) are ONE
frame in one flat fill, `.app-pane` (light `#f8f8f9`, dark the `#25272b`
charcoal, lighter than the near-black workspace and the cards so the frame
reads as its own plane). `main` is the workspace: the `--content-bg` wash
(`bg-fixed`, so it stays put while the cards scroll; the calendar ground
drops it for plain `--pane`), a 12px upper-left corner from md
(`md:rounded-tl-xl`), and `.workspace-boundary`, one line at half `--border`
along its top and, from md, its left. The rail draws no edge of its own: the
line follows the corner instead of cutting through the band the rail and the
bar share. Every view already puts its content in cards, so an inset sheet
would be a card holding cards: don't bring one back without taking the cards
out first. The shell root carries `data-app-shell`, which hands back the
document's reserved scrollbar track (globals.css): the shell never scrolls the
document, and with classic scrollbars the track was a 15px strip of
`--background` at the right edge.

**Sidebar glyphs are 16px at stroke 1.5** (`makeIcon`, Nudge 451ab041);
normalise a borrowed glyph at its call site rather than draw it heavier than
the rows around it. The phone tab bar draws the same glyphs at 18px. **Row
weight never changes between states**, in the sidebar and in the phone bar:
font-medium throughout, and the wash, the darker tier and the glyph at full
strength say "selected". Each tab keeps its one hue; Nudge tried monochrome
and Serdar kept the hues, because they make a row findable without reading it.

**No product mark inside the app; the rail's top row is the fold arrow**
(Serdar, 2026-10-21). The rail's first row is `h-12`, level with the top bar,
and holds only the fold toggle at its right end, Nudge's chevron (it points
where the rail will go: left to fold, right to open). The business switcher
is its own row under it. No Resepta logo or wordmark: the top-left belongs to
the business, and the brand stays on sign-in, the onboarding wizard and the
pages customers see. Folded, the rail shows the arrow and no mark, and
switching business waits for the rail to open. Keep the rail's first row and
the top bar one height if either moves.

**The header search is one round field** (Nudge's, 2026-10-21). `SearchInput`
(DataTable.tsx), shared by the shell header and the operator console:
`rounded-full`, `h-8`, the `--card` fill so it reads raised on the frame, and a
fixed narrow width (`w-40`, `lg:w-48`), never sized to its text: a box that
grew with the typed value re-laid the header on every keystroke. It is chrome,
like an address bar, so it is the one round field; a field inside a card
stays boxed. Only the phone's expanded search fills the row.

**`main` is `relative`** (Nudge cbbacbcc), so it is the containing block for
every absolutely positioned box in a view. Keep it so, and keep anything
between it and an `sr-only` label from being un-positioned by accident: with
the body as the containing block, a label deep in a scrolled list stretches
the DOCUMENT to reach it, and the shell's overflow cannot clip that.

**The Inbox and the customer record share one split**, `TWO_PANE_COLUMNS` in
ContactView (Nudge 1a6c46ce): 40/60 from lg, the left column capped at 32rem,
the conversation taking the rest inside its own 56rem measure. A row in the
Inbox opens the record, so the two right-hand panes are one pane a click
apart; change the split there, never in one view.

**Each of the two is ONE card holding both panes** (P22, 2026-10-17; Nudge
2e5b63e7). `JOINED_PANES` (next to `TWO_PANE_COLUMNS`) puts the card on the
grid: no gutter, rounded corners only on the outside, and from lg one
`PANE_DIVIDER` line between the panes. Neither pane is a card of its own; do
not put `card-raised` back on one. In dark the conversation's tabs all sit on
the chat's near-black paper (`--conversation-paper`; light keeps the card's
white for All and notes, the beige paper for WhatsApp, email and calls), so
the joined card wears one outline at half `--border` and the divider goes to
half strength with it. Light has neither extra. Below lg the panes still swap
inside the same card, and the phone still runs edge to edge.

**The rail's two menu controls look alike**: the business switcher at the top
and the account row at the foot wear `--pane-field` at rest with the up/down
chevron, so each reads as a button rather than a caption (Nudge's account row
took a 4% ink tint for this; ink on this pane read as a pressed row here). In
dark `--pane-field` steps UP from the charcoal rail (`#303237`, hover
`#393b41`); the old `#232323` sat below it and read as a hole. The
account row is always titled name · address, and shows the person's Google
photo with the initials as the fallback.

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

**An agent edit lands on its draft and goes live as one named version**
(2026-10-17, P7 of the Nudge port). Everything the agent page publishes goes
through `retellAgent.applyAgentEdits` (`docs/subsystems.md` → "Publishing an
agent"): one draft, one publish titled with what changed, mirrors written
after the provider accepts it. A new agent-page edit joins that edit set
rather than publishing on its own. Read an LLM at the version its agent doc
names (`lib/retellDraft.llmPath`), never bare: after a discard the bare read is
the orphan. A new outbound dial path passes `override_agent_version` for the
published version, as `testCall` and `placeCall` do.

**A browser test is never a call** (2026-10-17, P8 of the Nudge port). The
agent page tests an agent as a WEB call (`retellAgent.startBrowserTest`)
carrying our marker (`lib/browserTest`) and an `agentTests` row. Its tools
answer DRY in `/retell/functions`, as the customer the owner chose to call as:
nothing is booked, moved, cancelled or saved and the team is not emailed;
what they would have done goes on the row (`agentTests.noteAction`). The
post-call webhook completes that row and stops before `voiceEvents`, so no
calls row, thread entry or customer field comes of it. It is metered like a
call into `usageMonthly.voiceTest*`, a share of the voice totals, never an
addition. A new write in the functions route checks `isTest` first; a marked
call with no row of this org is still a test. The test lives on the agent page's
Testing tab, mounted beside Setup and Notes and only hidden (P35), so never
move it back into a sheet or anything that unmounts it: closing the sheet
ended the call. The tab is Nudge's (2026-10-21): ONE Call setup card (Call as,
Direction and Audio on one row; the microphone and speaker are one picker,
remembered per browser), What the agent knows in a bordered box inside it
(the opening line, then every value the call carries, editable for this test
only), Start test under both. A value is READ when the prompt, the opening
line or a first sentence on screen names it in braces (`{{when}}` is the
openers' own word, not a value); values with nothing in them fold behind "N
more it doesn't know", values nothing names behind "N more sent along, not
read by this agent". The values are read only while the tab shows and no call
is up. Test results holds the running test as its open top row. The draft
state, Discard and Publish ride the end of the tab row on every tab. Ringing
a real phone stays a link at the foot of Call setup: it rings the PUBLISHED
version, so it proves the line, never the draft.

**A review is the team's, one per call or test, kept on its row**
(2026-10-21, Nudge's call reviews). A note and a Pass or Miss live on the
`calls` row, written by any member through `calls.setReview` (`requireOrg`,
the call's own org, refused while its customer is being deleted), and on the
`agentTests` row through the owner-only `agentTests.setReview`, same contract:
whichever half changed, `verdict: null` takes it back, the `note*` stamps sign
it and go when it is emptied. What was done about it, and whether that is
done, sit beside it (`action`, `doneAt`; `agentReviews.setAction`,
owner-only). So a review goes with its row: deleting the customer deletes
it, and no table needs a place in the sweep. The call card and the opened
test both draw it with `ReviewNotes`. The agent page's Notes tab
(`agentReviews.list`, owner-only) is the work queue over them: Misses first,
where a note with no verdict counts as a Miss, and no charts or rates, since
reviewed calls are a hand-picked sample. Never put a review in front of the
chat or phone agent: it is the team's talk about a call, not something the
customer said.

**A person's dial says who placed it** (2026-10-17, P11). `testCall` (the
record's Place call and the agent page's test call) puts the caller's user id
in the dial's metadata (`lib/browserTest.PLACED_BY_MARKER`); the webhook
brings it back and `recordCall` keeps it as `calls.placedByUserId` only when
that user is a member of the call's org. Bulk calls are named by their run
(`bulkRunItems.by_retell_call`). A new dial path a person triggers carries the
marker too.

**The first sentence is Resepta's, and there are two clocks** (2026-10-18,
P34; Nudge 3ae8dcd). `retell.beforeCallContext` always sets `{{opener}}`
(`lib/opener.chooseOpener`): a call we place opens with the agent's follow-up
sentence after a real conversation, its missed sentence after attempts only,
a call in with its inbound sentence, else the cold one, else the template's
greeting tail, never empty. `customers.lastConversationAt` is stamped only
from the provider's `call_successful`, never a connected line (a hang-up on
hello is not "we spoke"); `lastCallAttemptAt` only from a call we placed that
reached the phone. Both are written by `recordCall` alone, forward only,
never for a test or the demo. The sentences are `retellAgents.openers`,
Resepta's like `personaName` (no publish), heard only where the opening line
says `{{opener}}`; the provider's default for it is a fallback the publish
keeps in step (`openerFallback`), never a variables row. A new dial path
passes `direction` to `beforeCallContext`, and a new ring-time key joins the
read-only rows in `VoiceVariablesEditor`.

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
through save_customer_details, whose own description names them (template
v17), and the template + booking tools force the asks. The caller's first and
last name are analysis fields of OURS on every agent
(`callerNameAnalysisFields`, under the identity keys), so a name the caller
said reaches an EMPTY card whatever the owner's script or the matrix switches
say. A switched-off identity column (`voiceLockedIdentity`) means the agent
never CHANGES a saved value, never that it may not fill an empty one:
`applyVoiceContactValues` and the ring-time `{{information}}` list both read
it that way. The registry exists ONLY to teach the post-call analysis about
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

**A call summary is in the business's language** (2026-10-21, template v17).
`resepta_call_summary` is written in the agent's SUMMARY language: the agent
page's Summary language (`retellAgents.summaryLanguage`, part of its one
Publish; picking the business's own language stores unset), else the
business's language (`lib/voiceAgentTemplate.summaryLanguageFor`), never the
language the agent speaks. It used to be compiled from the agent's language
at publish time, so Estate Emlak's agent, born English and switched to Turkish
in the provider's dashboard, wrote English summaries for a Turkish business.
Birth, Update, a variables publish and a summary-language publish all resolve
it there, and a new path that writes the analysis list does too. The app's UI
language never changes it, and a summary already written stays as written.

**Confirmations vs. late emails.** The agent asks for e-posta AFTER booking
(a booking must not wait on spelling), so booking-time confirmations can
race an empty email column and fail `no-email-address`.
`retryConfirmationsAwaitingEmail` (appointments.ts) re-fires booking rules
when an email lands — voice or staff edit — guarded on ALL confirmation
attempts having failed, so a channel that already carried the message never
double-sends. Any new email-writing path must call it.

**Three Convex/React traps that each cost hours here.** (1) Convex validates
RETURNS as strictly as arguments: extending a handler's result without
extending its `returns` validator makes every call throw at runtime, and
TypeScript cannot catch it — extra properties pass structural assignment.
When a result type changes, change the validator in the same edit. (2) A
context value's setters must be referentially stable (useCallback): a setter
minted inside the value memo re-triggers every effect that lists it in deps
— the header search's claiming effect ran per keystroke and its cleanup
wiped the query. (3) An error's TEXT does not survive a function boundary: a
message thrown in a mutation arrives in the calling action as "Uncaught
Error: <msg>\n at handler …", so `err.message === "code"` or an anchored
regex silently never matches (the assistants' booking refusals did exactly
this until 2026-10-13). A refusal a caller branches on is RETURNED as data
(`{ ok: false, code }`) or thrown as a `ConvexError` and read from `.data`.
The frontend's `raw.includes("code")` checks survive the framing and stay;
anything handing an error to a model or a stored reason goes through
`cleanError` (lib/mcpProtocol).

## The assistants touch only the customer's own appointments (2026-10-13)

Both agents (phone and WhatsApp) find, move and cancel through
[`convex/agentAppointments.ts`](convex/agentAppointments.ts). Ported from
Nudge's `meetingTools.ts`; do not grow a second path.

- **Whose comes from the channel**, the call leg or the conversation, never a
  tool argument. **Which comes from what the agent read back**: cancel and
  reschedule take `appointment_start` and `appointment_services`, as
  find_appointment / my_appointments gave them, and act only on the
  customer's own open appointment at exactly that minute with those services
  in that org, else `appointment-changed`. A minute is not an identity (two
  orders share 10:00): when what was named fits more than one appointment,
  or a bare start meets a minute where something changed in the last three
  minutes (`REPEAT_WINDOW_MS`), the tool answers `appointment-ambiguous` with
  the list and the agent asks; identical twins go to a person. Never
  "whatever is next now": a repeat finds it already cancelled or moved and is
  a no-op answer. A voice engine older than template v14 has neither
  parameter; it keeps "the next one" (pinned by that row's services) but is
  refused for three minutes after any change, and that refusal promises a
  colleague, so it emails the team like every other phone handover.
- **A move is judged in the transaction that writes it**, with the booking
  page's own helpers exported from `booking.ts`: the business's minimum
  notice, the span fits that day's hours, no closure, capacity with the row
  not blocking itself, no clash with the customer's other bookings, a good's
  lead time.
- **The business's minimum notice binds every customer-facing door**
  (`orgs.minNoticeHours`, `lib/minNotice`, 2026-10-13): the booking page and
  its manage page, both assistants' bookings (`bookingProblem`, so a draft
  is judged by it when it is sent) and moves (`too-soon`, with the nearest
  free times). Unset is one hour, 0 is none, an ASAP order is exempt. Only the
  team's calendar may book inside it, and its verdict says so. A new door
  that takes a time from a customer or an assistant reads the same helper.
- **Six changes a day per customer** (`customers.agentChangesAt`,
  `lib/agentChange.ts`, Nudge's number). Bookings, moves and cancels by the
  assistants, moves and cancels on the customer's own manage page
  (`/appt/<token>`) and their own WhatsApp cancel (İPTAL, the cancel button)
  all count. Past the sixth the assistants refuse moves, cancels AND new
  bookings, and the manage page refuses moves; a customer's own cancel is
  counted and never refused (Serdar's call via the coordinator, 2026-10-13).
  The cap is judged with the change, AFTER a repeat is recognised: a retry
  or a second "yes" is answered "already done" and never meets it. Never
  pre-check it in a lane; before cal.com is told, `checkChange` asks both.
  On the phone the team is emailed (`bookNeedsPerson`/`moveNeedsPerson`/
  `cancelNeedsPerson`, failed-send switch) because the agent promised a
  colleague; in chat the agent is told to call `escalate_to_staff`, which
  follows the handover setting.
- **A "no" about a time carries the nearest free times**
  (`retell.nearestFreeTimes`, built on the booking page's `freeStarts`, so
  what it offers the write will accept). Both lanes' `check_availability`
  answer the asked `time` through one verdict (`judgeRequestedTime`), which
  also answers a time inside the minimum notice as `too-soon`.
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
  must take the draft path too. The owner's chat simulator (`chatAgent.simulateTurn`,
  2026-10-17, P9b) rides the same path: `loadTurnContext` with `simulate`
  reads as suggest, every write is a draft never sent, and the turn writes no
  row (the page holds the conversation), so it never meets the disclosure,
  the rate limit or the inbox. Its cost counts toward the month like a shadow
  turn; it is not billed.

## A list's add sits above its card (2026-08-21; above the card since 2026-10-21)

Every list carries its title, its (i) and its creating action in a row ABOVE
its card, and the card holds the list and nothing else (Serdar, 2026-10-21:
"we don't put a button inside a list"; Nudge 13bcfad1 and e07ff7ae).
Customers and the Voice agents table moved first (P32); Automations,
Knowledge, Services, Products, Team and Contact fields followed on 2026-10-21
(`ListHead` in BusinessView, the same markup in `KnowledgeCard`). From
2026-08-21 until then these adds sat on their card's title line through
`Card`'s `action`, which no view passes now; before that they floated above
their card, sat at the foot of a list or were shared between two cards.

- **The row.** `min-h-8`, 8px over its card, lists a card gap (1rem) apart,
  so a title reads as the head of the card under it and not as the foot of
  the one above. A page-level list's row holds view controls left and the add
  right (Customers' Columns; the Voice agents' Refresh and Try the WhatsApp
  assistant; Automations' add alone, since the tab names the list); a titled
  list's row holds the title and its (i) left. One row at every width. Every
  menu in it portals, so leaving the card clips nothing. A selection's verbs
  replace the whole row while it stands (Customers' bulk bar), never sit
  beside Add.
- **It does not wait on the list.** Drawn before the rows arrive and when
  there are none, so the first row arriving moves nothing and Add is on
  screen in the EMPTY state, the one state where it is the only way forward;
  the card says "none yet" inside. Two exceptions: Products appears once a
  product exists (the first goes in through Add service's Type), and
  Automations' whole page waits on its data, so there the row arrives with
  the list.
- **One loud thing per screen.** The add is filled where the list is what
  the screen is for (Customers, Voice agents, Automations, Team, Contact
  fields, and Services on Knowledge) and outlined for a further list on a
  screen that already has its filled one (Products and Knowledge, under
  Services). Filling every card's add once put three solid blue buttons down
  Voice and more down Business (Serdar, 2026-08-25: "secondary button that's
  sort of no bg"): a filled button means the single action a screen is FOR,
  as the sheet's confirm and the composer's Send do. The outlined one keeps
  an edge at rest, now the raised ring (Serdar, the same day: remove the
  fill, "not the border line").
- **Adding opens a sheet**; a form never unfolds inside the card. Contact
  fields' inline form became `NewFieldSheet`, since under a button above the
  card it would have opened a list's length away from it.
- **A form card has no such row.** General and Hours hold settings, not a
  list, and under a tab of the same name they carry no title either. Team
  keeps "Team (i)" above its card under the Team tab, because that (i) is
  the one explanation of logins against bookable people.
- **A SECTION's action inside a card stays inside**, outlined and keeping its
  `+`: the record's "+ Add sale" (`buttonClass("outline", "xs")`). Revenue's
  history keeps its row inside too: it adds nothing, and its select-all sits
  in the checkbox column, where the position is the label.
- **The add sits outside the card's fieldset**, so `Card`'s `disabled` cannot
  reach it: an add a member may not use gates itself
  (`isOwner ? … : undefined`).
- **Read-only reads as facts, not a dimmed form** (2026-10-17, P12; Serdar
  chose Nudge's way 2026-10-14). `Card`'s `disabled` puts `.readonly-form` on
  its fieldset, not `opacity-70`: fields, switches and inline values
  (`data-value`) stay at full strength with a default cursor, a disabled
  ACTION button keeps its own disabled look, and a control that only ever
  changes something carries `data-edit-only` and is gone. The page says
  "View only" once (`ViewOnlyPill`). A new row ×, add or remove control on a
  card a member can read carries `data-edit-only`.
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
  order is not a control anyone mistakes for a row of tags. The blocked-time
  sheet's weekly days are the same kind of row (P5): emerald when on, an
  empty well when off, one line.
- **A team member's colour means WHO, and nothing else** (P5,
  2026-10-13). Google's event palette with lavender first
  (`lib/staffColors.ts`): a booking wears its person's colour, an unassigned
  one the lavender every booking had, and the same colour is the dot before
  the name on the Team card, the calendar's side panel and a day-view column.
  It never marks a state. Tense and status still decide the shade (solid,
  the scheduled mix, the pale past wash), and a no-show stays red whoever's
  it is. Tomato is left out of the palette: red here is a no-show or "now".
  A colour is unique among the ACTIVE team; `staff.setColor` and
  `staff.remove` freeze every unset colour first, so a change moves only the
  person it names. Never key a colour on a service.

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

## A page title names the page, in the bar that names pages (2026-08-22, breadcrumb 2026-10-17)

Opening a contact left the shell header reading "Inbox" while the page was a
person, so the contact drew its own name and back arrow in a second title row
underneath — two headings, the higher one wrong, ~60px between them.

- **`AppShell` takes `overrideTitle` (a STRING) + `onOverrideBack`.** A string,
  never a node: the view supplying it renders UNDER the header, and handing
  React elements back up through state is how a render loop starts.
- **The way back is the path you came by, not an arrow** (P25, Nudge
  cba4af4c). The title bar draws a breadcrumb before the title, every step
  clickable: `Inbox › Ayşe Yılmaz` for a customer opened over a tab. "← Name"
  read as "go to Name". Steps take the title's size and weight and only step
  down in colour, to `--muted`; below `sm` only the nearest step shows, as
  `‹ Inbox`. Crumb labels are strings for the same reason the title is.
- **A record open INSIDE a tab names itself the same way**: a voice agent, an
  opened message rule, a bulk run call `useHeaderTrail`
  (`src/lib/headerTrail.tsx`) with their name, their close handler and, when
  the tab's title is not the list's name, a `backLabel` (`Bulk › <run>`
  inside Customers). They draw NO back control of their own. An opened
  review on an agent's Notes tab swaps the agent's trail for
  `<agent> › <customer>` (2026-10-21). A new drill-in uses the hook, never an
  arrow. The slot holds one trail; a customer record
  replaces the tab's view (`AppHome`), so a trail and a customer never stack.
  Exceptions: the Inbox's phone back from a thread to the list, and a sheet's
  own step back (the booking sheet).
- **One title inset on every tab** (Nudge ca95e0f8). The header no longer
  follows the Inbox's and the record's 8px card frame (`.gutter-flush` is
  gone), so switching tabs never moves the title.
- **`AppHome` holds the name; `ContactView` reports it** via `onTitle`. That
  view is the only thing querying the customer — filling the heading anywhere
  else would be a second read of the same row on every contact opened.
- **`ContactView` is keyed on the id**, so opening a second contact from the
  first one's feed remounts and re-reports instead of leaving the previous
  name in the bar until the new query lands.
- **`overrideContactId` is an ID**, same discipline: the shell renders the pin
  itself (`PinDot`) and runs its own query rather than taking a control or a
  pair of callbacks from below.
- **The Inbox conversation's name carries a `›`** — the app's own "open this"
  mark, borrowed from the feed rows. The breadcrumb does not replace it: the
  crumb leads back to where you came from, the name leads on to the record,
  and a hover-underline is only found by people who already suspected.

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
is the same control with the same precedence; keep them in step. Since P21
(2026-10-17) the dot sits on the NAME line, an 8px dot in a 14px target, and
the lit row (its menu open, or open beside the list) is a rounded neutral
fill (`--row-active-bg`), never a left bar.

**A row has a menu, and Mark as unread is a FLAG** (P21, Nudge 2a94bb92).
Right-click a row or its chevron for one portalled `ContextMenu`: Open
customer, Pin, Mark as read / unread, Mute. Mark as unread is
`inboxReads.unreadAt`, per person, checked AHEAD of the read floor, unioned
into `inboxUnseenCount`, `inboxCounts` and the Unread page (marked rows below
the floor join its last page), and cleared by `stampConversationRead`, which
every read path goes through. A new read path or unread count must honour it;
a deleted stamp cannot make an old conversation unread, because the floor
already calls it read. The Inbox's chips are All / Unread / Pinned, always
all three, exactly one lit, and a lit chip never toggles off.
A WhatsApp MESSAGE has one too (P23, Nudge daddc71e): right-click a bubble
or its corner chevron for Reply, Copy, React (the quick reactions sit above
the items, the full panel swaps in on "+") and Add to note. Both menus share
`components/ContextMenu.tsx`; a new context menu uses it. Each item follows
its bubble's own gate, and React shows only where the server's `canReact`
says a reaction can reach the customer.

**A pin lasts until it is unpinned** (2026-10-17, P13; Nudge 0e23423f). It
used to be SPENT by the next outbound, and every outbound counts, reminders
and away-replies included, so a pinned conversation unpinned itself
overnight without anybody answering it. `messages.inboxPin` (the record) and
`conversations` (the Inbox) both read a pin row as a pin, so the two
surfaces cannot disagree.

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
alone"). Customers are never minted here: `create_customers` is the door
that takes a name and a number and dedupes on the number. Unplaceable rows
are reported with their number and the reason, never dropped. Undo deletes
what it created that is still as it wrote it: an appointment the business has
since moved, cancelled, re-staffed or otherwise changed stays, and so does one
the customer has been messaged about.
The journal records what each row was written as (since 2026-10-13), and the
hourly auto-completion of a past booking is not a change; an import journalled
earlier is judged by the activity feed alone. Undoing `create_customers` keeps
anyone with an appointment, message, call or note since and deletes the rest
through the customer deletion, never a bare row delete.

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
   `syncAppointmentSchedule`. The Inbox's queries (`inboxPage`,
   `inboxCounts`, `inboxSearch`, `inboxConversation`), `inboxUnseenCount`,
   `markAllConversationsRead`, `inboxPin`, `customers.listPage` and
   `customers.get` walk `by_org_thread_last` / `by_org_thread_inbound` and
   read exactly the customers they show. `threads:backfill` rebuilds every
   row and is idempotent — run it if a write path is ever found to have
   skipped its call.
3. **Customer search reads the search index, never the book** (2026-10-17,
   P13). `customers.searchText` is the folded name, address and phone forms
   (`lib/customerSearch`) under the `search_text` index filtered by `orgId`.
   **Any mutation that inserts a customer or changes a first name, last name,
   phone or email calls `syncCustomerSearch` after it**, same standing as
   `noteMessage`. `customers:backfillSearch` rebuilds every row and is
   idempotent; run it once after the deploy that adds the field.
4. **Per-agent call figures are counters.** `retellAgents.callCount` and
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
