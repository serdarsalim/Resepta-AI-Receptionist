# Resepta — working in this codebase

> **Brand and infrastructure (Serdar, 2026-08-05):** the public product is
> **Resepta**, canonical frontend `https://resepta.xyz`. The repo, directory,
> Vercel project and some internal identifiers keep the former `randevu`
> name; do not rename infrastructure to match the brand.

> **Public help center:** `https://docs.resepta.xyz`, rewritten to `/help` in
> `src/proxy.ts`, content in `src/components/HelpCenter.tsx`. `docs/` is
> operator material, not a public site: translate its product facts into
> customer steps; never expose provider names, credentials, internal IDs, or
> platform-admin recovery.

> **Public demo:** `https://demo.resepta.xyz` rewrites signed-out root
> requests to `/demo`, then signs visitors anonymously into the isolated
> showroom org, on the production deployment by design. Preserve all three
> safety boundaries under "The demo org" and never add credentials to it.

> **Read [`docs/wwsd.md`](docs/wwsd.md) FIRST.** It is the decision model:
> how Serdar picks, what he rejects, the design violations he has flagged.
> Consult it before building a surface, not after it gets rejected.

> **Public landing hierarchy (Serdar, 2026-08-05):** the headline is the first
> text in every hero and section intro; never a kicker or eyebrow above it.
> Product imagery supports the hero copy at a smaller scale and must not
> compete with the headline. Keep decorative layers and idle motion quiet.

WhatsApp appointment automation for SMBs (salons, barbers, dentists). One
shared deployment serves EVERY business: the multi-org sibling of Nudge
(`../nudge`), which is instance-per-tenant. The two do not share a codebase;
Resepta borrows Nudge's pieces (the wa_cloud sender, config conventions) by
copy, not import.

## How to read this file (split 2026-09-03)

This file is the RULES: invariants, conventions, design rules, landmines. It
is loaded into every session, so it stays short.

- **[`docs/subsystems.md`](docs/subsystems.md)**: how each part works AS
  BUILT. Read the section for the area you are about to touch.
- **[`docs/journal/`](docs/journal/README.md)**: dated session write-ups.
  Read for *why*, never for what stands today. The stories that used to sit
  beside these rules are in `2026-11.md`, entry 2026-11-01.
- **[`docs/open-issues.md`](docs/open-issues.md)**: open questions and known
  gaps. Check before proposing work.

When a session changes a rule, EDIT the rule here in the same change and put
the story in the journal. An appended correction is not a fix.

## The one invariant that matters

**Every table except `orgs` and the auth tables carries `orgId`, and every
query filters by it.** There is no cross-org read path. A new table gets
`orgId`, an index starting with it, and a line in `ORG_TABLES`
(`convex/platform.ts`) so deleting the business deletes its rows; the
typecheck fails, naming the table, until you do. A new query/mutation
resolves the caller's org via `requireOrg(ctx)` (convex/lib/orgAuth.ts) and
scopes every read and write to it. An unscoped query is a data leak between
businesses.

## Product boundaries (decided 2026-07-25, Serdar)

- Scope is appointment automation: customers, appointments, WhatsApp
  confirmations + reminders, confirm/cancel by reply. NOT lead qualification,
  deal stages or HubSpot; that belongs in Nudge.
- **The public product is vertical-agnostic** (Serdar, 2026-07-31). Lead with
  the call → booking → follow-up workflow and product UI, never one
  industry's lifestyle photo. Industry photography only inside labelled
  use-case tabs, never inside the product demo.
- Self-serve, **Google OAuth only** (no passwords, no reset flow ever). First
  sign-in creates the org unnamed; the AppShell onboarding gate asks one
  question (business name). No invites, no fleet provisioning, no operator in
  the loop. If a partner-operated model wins, add a second provider then.
- **Appointment intake is NATIVE; cal.com is parked, not removed** (Serdar,
  2026-08-19). New features build native-only and MUST NOT fork on
  `org.calcomApiKey`. The integration stays, gated on
  `org.calcomApiKey && org.calcomEventTypeId`: `convex/calcom.ts` handles
  BOOKING_CREATED / RESCHEDULED / CANCELLED, the org resolved from a per-org
  webhook token (`orgs.calcomWebhookToken`, since cal.com's payload carries no
  tenant), its admin card behind `SHOW_CALCOM_CARD`. The salon's calendar is
  fed by email: `users.notifyNewBooking` mails an ICS invite per
  system-sourced booking and its retraction on cancel
  (`scheduleLifecycleMessages` → `lib/alerts.ts`); `appointments.icsSequence`
  bumps on every startAt change.
- **The salon-facing calendar judges every create and move, for every
  business** (`schedule.judgeSlot`; with no cal.com key `schedule.create`
  takes its no-key path). Hours, blocked
  time, the customer's or the member's clash, or a fully busy team come back
  `canForce`; the sheet asks "Book it anyway?" and the same call with `force`
  books it. The SERVER refuses without `force`: `prepareCreate`,
  `finishCreate` and `finishMove` in the writing transaction, `updateDetails`
  for a change of person. Only these signed-in staff writes take `force`;
  the booking page and assistants never can; cal.com refusals ride the same
  `canForce`. A past start or a time inside minimum notice is never refused
  here, only noted. Not judged: the MCP's `create_appointments` and reopening
  a cancelled booking. Manual entry stays for walk-ins
  (`appointments.source`); `externalUid` is cal.com's booking uid.
- **Blocked time is the business's `closures`, never a fake appointment.** A
  closure row (weekdays, or a date with optional last day; a window or all
  day), drawn with `BlockSheet`, refused by the booking page and both agents,
  shaded on the grid; booking or dropping onto it asks first (verdict
  `closed`). It is BUSINESS-wide, even when drawn in one person's column.
  Per-person blocks (Nudge's `hostBlocks`) are an open call for Serdar; no
  staff field on closures without it. `appointments.customerId` stays
  required.
- **A booking whose start has passed is a record, not news** (2026-10-13).
  `scheduleLifecycleMessages` sends nothing for it on the booking trigger or
  on a cancel the business makes (`byBusiness`). A customer's own late cancel
  still gets its answer; an ASAP order is never past. Book, move and cancel
  through that function.
- **The Cloud lane's token is PLATFORM-level with a per-org override.**
  `waAccounts.accessToken` is optional; `resolveWaAccount`
  (`lib/platformConfig.ts`) hands every loader query the row's token or the
  platform `whatsappAccessToken`, else null ("Cloud off", never a
  Bearer-less request). A hosted business needs only `phoneNumberId` +
  `wabaId`. Resolve in the QUERY, never the action (no `ctx.db`). A LIVE
  fallback, unlike the Retell key's stamp, so one rotation reaches every org.
- WhatsApp runs on TWO lanes (`convex/lib/waLane.ts`): Meta Cloud
  (`waAccounts`, operator-installed at /admin) and the shop phone on an
  Evolution instance (operator-provisioned, linked by QR in Reminders). A
  reply goes out the lane it came in on; business-initiated prefers Cloud,
  because Evolution silently drops first contact (ACK 463). Cloud sends ride
  approved **Meta template messages**; shop phone and email send the template
  row's authored body. `orgs.messageChannel` (whatsapp | email | both, unset
  = both) picks the CHANNEL; email-only skips the WhatsApp attempt and its
  failure rows, and logs `email-not-configured` / `no-email-address` when the
  email half is missing.
- **A number shared with Nudge keeps Resepta's Meta callback.** Only explicit
  `WA_WEBHOOK_MIRRORS` routes copy its scoped events, signed and retried;
  never forward another business's batch.

## Delivery is a queue, not a fire-and-forget

`messages.applySendResult` is the ONE place a send outcome is decided (retry,
dead-letter, failure alert). Never alert from a call site.

- [`lib/sendFailure.ts`](convex/lib/sendFailure.ts) classifies. **Permanent**
  (unsubscribed, no approved template, shut 24h window, bad token, other 4xx)
  fails terminally. **Transient** (5xx, 429, Meta rate limits, a thrown fetch)
  backs off ~1m/5m/15m/1h/3h, then dead-letters.
- **A retrying row keeps status `queued`, not `failed`.**
- `convex/delivery.ts` re-POSTs the EXISTING row, never re-runs the action
  (that logs a second row). Rows store `templateParams` so a retry replays
  the same words.
- `sendingAt` marks a row in flight; the reaper FAILS rows stuck past 2h,
  never retries them (Meta has no idempotency key). The retry queue
  deliberately differs: losing a reminder is worse than a duplicate.
- **A composed email is parked before it goes.** `email.sendToCustomer`
  writes it queued with `scheduledFor` (ten seconds for Undo, or the
  scheduled time) and `email.claimParked` re-checks every refusal when it
  goes. WhatsApp's parked sweep leaves `email_reply` rows alone; a new parked
  kind gets its own claim on the same pattern.

## Cron cost must track work, not org count

A cron that scans "all rows in a window" costs in proportion to every
customer on the deployment, and `.take()` truncates in SILENCE.
`appointments.nextMessageAt` ([`lib/reminderSchedule.ts`](convex/lib/reminderSchedule.ts))
holds when a booking next owes the customer something; the cron reads an
index range of exactly the due rows.

**Any mutation that changes `startAt`, `status`, `reminderSentOffsets` or
`winbackSentAt` must call `syncAppointmentSchedule` after its patch.** It is
idempotent; `reminders.reconcile` repairs what a write path forgets.

## Cross-org reads live in exactly one file

The single exception to `requireOrg` is `convex/platform.ts`, gated by
`requirePlatformAdmin` ([`lib/platformAuth.ts`](convex/lib/platformAuth.ts)):
an env allowlist (`PLATFORM_ADMIN_EMAILS`), never an org role or DB flag (an
org-scoped mutation could reach a column). Unset denies everyone. It may also
gate an OPERATOR-ONLY WRITE surface that reads one org or none:
`convex/connections.ts` (per-org provider credentials the salon must never
see) and `convex/platformConfig.ts` (deployment-global settings).
`lib/orgAuth.ts` and `lib/activity.ts` import only `emailIsPlatformAdmin`,
which touches no database. Do not widen further without the same argument:
name the surface, show it is operator-only, show it reads one org or none.

**Widened once (2026-08-24), and this is the whole of it.** The sharing block
at the foot of [`convex/team.ts`](convex/team.ts) (`sharedAccess`,
`setAccessElsewhere`, `shareCandidates`, `shareIntoThisBusiness`) reads and
writes MEMBERSHIPS across orgs. The gate is ownership of BOTH ENDS, read from
`memberships` rows the caller cannot mint; only a person already a member of
an org the caller owns can be moved. `sharedAccess` returns ids and roles,
never names. Anything beyond memberships belongs in `platform.ts`.

## Deleting a customer deletes them (2026-10-13)

KVKK erasure. `customers.remove`, the MCP's `delete_customer` and the undo of
`create_customers` all go through `beginCustomerDeletion`
([`convex/customerDeletion.ts`](convex/customerDeletion.ts)); nothing else
deletes a customer row. Mechanics: `docs/subsystems.md` → "Deleting a
customer".

- **Owner only, checked on the server.** `customers.remove` takes
  `requireOwner`; `preview_delete_customer` and `delete_customer` re-derive
  the role from `memberships` (`assertOwner`) every call. A new door gets the
  same check. Exception: the undo of `create_customers` stays with whoever
  ran the import, and removes only rows that call created with nothing
  (appointment, message, call, note) since.
- **`FOOTPRINT` is the one list of every table that holds a customer** (by
  `customerId` or number). **A new table that references a customer goes
  there in the same change.**
- **Gone first, swept after.** The first transaction replaces the row with a
  `deletingAt` blank, tombstones the phone (`by_org_phone` misses it, so a new
  message or call starts a NEW customer), drops the thread summary, cancels
  queued sends and deletes their appointments. The sweep asserts `orgId` on
  every row and deletes the customer row last.
- **A deleting customer is gone to every reader.** A path that loads a
  customer by id to show, message or attach to them checks `isDeleting`
  (`lib/customerDeletion.ts`). `messages.logOutQueued` refuses as the
  backstop; `writeThread` never writes a summary back.
- **The audit trail is emptied, not erased.** `activityLog` rows lose the
  customer/appointment link and free text; `agentActions` rows lose the
  values a tool wrote (id-only journals stay, for undo). One
  `customer_deleted` row says who, never whom.
- **An erased call stays erased.** Its events become one `customer_deleted`
  marker in `voiceEvents`; `voiceEvents.enqueue`, `retell.recordCall`,
  `updateContactFromVoice` and the analysis recovery check it. A late
  assistant turn keeps no row (`recordTurn` returns null) and sends nothing.
- **Provider copies are not touched.**

## "No AI calls" is its own fact, never Unsubscribe (2026-10-13)

`customers.noAiCallsAt`: NOT Unsubscribe, never folded into it (a customer
who refuses robot calls may still want offers). Neither stops reminders.

- **Every AI dial-out path checks it.** Bulk runs via `bulkRuns.skipReason`
  (launch, fan-out, every `claimNextCall`); callbacks via
  `bulkRuns.reachReason`. `retellAgent.testCall` refuses `no-ai-calls` unless
  sent `callAnyway`, which Place call sends only after the person confirms. A
  new dial-out path checks it before Retell.
- **The phone agent can set it, never clear it**: `resepta_no_ai_calls`
  (template v15) reaches the record only as a yes, via
  `retell.markNoAiCallsFromCall`. Only a person clears it
  (`customers.setNoAiCalls`, any member).
- Nothing changes in the demo org, which never dials.

## A bulk call rings only when it should (2026-10-17)

`bulkRuns.claimNextCall` is the one place a run decides to dial, and every
guard lives in its claiming transaction (the reaper restarts runs every five
minutes and a resume dials at once). Mechanics: `docs/subsystems.md` → "Bulk
call runs".

- **Only while the business is open** in its timezone (hours minus closures,
  else its send window). Closed, the run is HELD on its row (`heldUntil` /
  `heldReason`) with one wake-up at opening (`lib/businessHours.nextOpenAt`).
- **Who is rung is judged at their turn**: `skipReason` (Unsubscribe, No AI
  calls), then `turnSkipReason` (an open booking ahead, or already called
  today). Every skip is a reason the run detail prints.
- **A refused dial is not a call.** No free line (429, 5xx, full pool,
  provider ending it for lines) requeues via `requeueRefusedCall`, up to six
  tries; a thrown fetch is never re-dialled (it may be ringing).
- **Outcome comes from the disconnect code** (`lib/callOutcome`), never a
  transcript; only a call that reached the phone counts as done.
- **One call per run**, plus the operator's platform-wide limit
  (`platformConfig` `bulkCallConcurrency`). A new automated dial-out path
  takes the same guards.

## The For next time note is the AI's draft and a person's last word (2026-10-31)

`customers.nextTimeNote` (`convex/nextTimeNotes.ts`; subsystems → "For next
time notes"). Rewritten after an answered call and after a WhatsApp chat is
quiet 15 minutes; read as `{{for_next_time}}` and in the assistant prompt.

- **Every write goes through `landNote`**: refuses when the note changed
  since the rewrite read it (a person's edit wins), writes nothing for a
  deleting customer, and lets "nothing worth keeping" clear only AI words
  (`nextTimeNotes.aiText`).
- **Only words the customer said**: an answered call by disconnect code, a
  TYPED WhatsApp reply (never a button tap), never a browser test or the
  demo. One AI request per call and per quiet chat, metered, stopped by the
  assistant budget; no model key, no note.
- A new reader goes through `assistantNoteSection` or the ring variable and
  never quotes it to the customer.

## A requested callback is one call, guarded like a bulk call (2026-10-18)

`convex/callbacks.ts`; subsystems → "Requested callbacks". The analysis field
`resepta_callback_time` (template v16, business wall time) becomes ONE
`callbacks` row via `callbacks.requestFromCall`: answered calls only, never
the demo, only a customer `bulkRuns.reachReason` allows. One queued per
customer; a newer request replaces it.

- **`callbacks.claim` holds every guard** in its claiming transaction: open
  hours (`bulkRuns.callWindowAt`), No AI calls and a usable number
  (`reachReason`; Unsubscribe never cancels a call the customer asked for),
  another automated call ringing them, the operator's limit (bulk items and
  callbacks counted together, both sides), the agent and its line. Dial
  pinned to the published version (`placeCall`); no free line requeues up to
  six tries. No "already called today" skip.
- **What cancels it**: a real conversation after the request
  (`stampCallClocks`, either direction), a person's own dial (`testCall`),
  the record's Cancel (any member), the customer's deletion; each leaves its
  reason. A new person-triggered dial path cancels them too.

## Consent is not a gate; Unsubscribe stops marketing (Serdar, 2026-10-21)

Every customer a business reaches has already agreed to hear from it.
`customers.consentAt` is dead (nothing reads or writes it; kept because rows
carry it). İYS marketing consent is the business's duty; the privacy notice
says so.

- **Booking messages and replies reach every customer**: confirmations,
  reminders, follow-ups, cancellation notices, the away reply, the
  assistants, a person's own message.
- **Marketing is `lib/marketing`**: campaigns, bulk messages and calls,
  win-backs (`isMarketingKind`: its WhatsApp kinds plus `lib/email`'s; a new
  marketing kind joins one set). It skips the unsubscribed (`isUnsubscribed`,
  on `customers.marketingEmailOptOutAt`) on every channel:
  `bulkRuns.skipReason`, campaigns at segment and each row,
  `wa.sendAppointmentMessage` for a win-back, and `delivery.claimForRetry` as
  backstop. A new marketing path checks it before the provider. Read the
  helper, never the field.
- **A requested callback is not marketing**: `bulkRuns.reachReason`, never
  `skipReason`.
- `customers.create`, `customers.update` and `schedule.create` accept and
  ignore a `consent` flag. `no-consent` stays classified for old rows.

## Marketing email carries an unsubscribe link (2026-10-13)

`lib/email.isMarketingEmailKind` (`email_campaign`, `email_bulk`,
`email_winback`) carries a visible unsubscribe link and the
`List-Unsubscribe` + `List-Unsubscribe-Post` headers. Other mail carries
neither and never stops for an opt-out. A new marketing kind joins that set.

- **The link is the message's token and nothing else**: `/e/u/<trackingToken>`;
  `messages.unsubscribeTarget` resolves it to the row's org and customer,
  checks they match, accepts only a marketing row's token. All businesses
  share one sending domain: never key an unsubscribe on the address, never
  name any business but the token's. GET asks; POST unsubscribes.
- **Customer-mail links live on the app's origin, never convex.site.**
  `lib/email.emailLinkOrigin` builds them on `SITE_URL`; `src/proxy.ts`
  rewrites exactly `/e/o/<token>`, `/e/u/<token>` and `/e/i/<assetId>` to the
  same Convex routes, method and body intact. The Convex routes never move
  (sent mail points at them). A new link takes a route in `convex/http.ts`
  plus one line in the proxy's pattern. **Images too**: Insert photo stores a
  RELATIVE `/e/i/<assetId>`, `sendEmail` makes it absolute
  (`withAbsoluteEmailImages`), and the route streams only library images
  (`media.emailImage`), never a storage URL or inbound file. `media.remove`
  refuses an image a template still shows.
- **The link and the record's Unsubscribe switch set one fact**
  (`customers.marketingEmailOptOutAt`), stopping marketing on every channel;
  the page names email, WhatsApp and phone. The switch is any member's
  (`customers.setMarketingEmailOptOut`); turning it OFF asks first; both
  directions write an activity row.

## Only the embedded booking page may be framed (2026-10-17)

`next.config.ts` sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`
everywhere and lifts both for exactly `/book/<slug>/embed` (`public/embed.js`,
`lib/embed.ts`). The embed holds no session, shows only what the business
publishes, and tells the website what was booked, never who. A new
embeddable surface gets its own route and line, never a wider pattern, and
posts nothing personal to its parent.

## Two kinds of template, never conflate them

- **Meta template messages**: business-initiated, filled BY POSITION
  (`{{1}}` first name, `{{2}}` business, `{{3}}` appointment time). Meta
  approved that exact string; we never rewrite it.
- **Everything else** (away-reply, composer, campaign line, email body) takes
  NAMED tokens (`[ad]`, `[isletme]`, `[tarih]`) via
  [`lib/renderTokens.ts`](convex/lib/renderTokens.ts). Token names never
  translate. An unresolved token renders as nothing.

**A token is stored by its key and shown by its label.** Plain-text boxes are
`TokenTextField`, the email body `EmailBodyEditor` with the `VariableToken`
chip; both read `useMessageVariables()`, open on "@", save the `[key]`
(`lib/tokenLabels`, `lib/emailTokens`). A new token box uses one of the two,
never a bare textarea.

Campaigns on the Cloud lane MUST ride an approved template; its `{{3}}` is a
free line, so one approval covers every campaign.

The `waTemplates` row bridges the kinds: per (kind, language) the AUTHORED
`body` and `subject` (shop phone, email, demo), and optional
`metaName`/`status`/`bodyPreview` as the Cloud registration, gating only the
Cloud send (`bodyPreview` is the legacy fallback for an unauthored body). Rule, campaign and bulk email carry an
open pixel (`/e/o/<token>`, `messages.recordEmailOpen`, 15s prefetch guard);
opens show as a RATE on template and campaign rows, never a per-customer
"opened" badge (prefetch makes it a guess).

## The business address is three lines stored, one line shown (2026-10-21)

`orgs.address` keeps up to three lines (`lib/businessAddress`,
`normaliseAddress`). Every one-line reader goes through `addressOneLine`: the
ICS LOCATION (`lib/ics`), the `[address]` token (`lib/renderTokens`), and the
booking, manage and link-preview queries in `booking.ts`. A new one-line
reader uses it too (Meta refuses a newline in a parameter).

## i18n — two layers, don't conflate them

1. **Customer-facing.** Language is `customers.language ?? orgs.language`.
   The content row is an EXACT match on `(kind, language)` with **no
   cross-language fallback**: a missing template logs a failed message. The
   Cloud send also needs `status === "approved"` and a `metaName` on that
   row. Dates format through `convex/lib/format.ts` in the ORG's timezone and
   the message language.

   **Who sets `customers.language`.** A person (record, `customers.update`,
   office connector, import), which clears `languageLearnedAt`. The system
   only through `learnCustomerLanguage` (`lib/customerLanguage`): a typed
   WhatsApp reply or the customer's words on an answered call, read by
   `lib/textLanguage`, only while unset, never in the demo, and only when
   `orgCanSendIn` finds wording (and Meta approval where needed) for every
   kind the business sends. Nothing calls an LLM to guess a language.
2. **App UI.** A typed dictionary in `src/lib/i18n.ts` (`tr`/`en`/`de`)
   behind `LanguageProvider` + `useT()`; a missing key or language is a
   compile error. Values go through the translator, never `.replace("{x}")`:
   `t("bulk.counts", { done, total, failed, skipped })`. A count that changes
   the words is `<base>.one` / `<base>.other` via `t.plural(base, count)`.
   Public booking and manage pages use `createTranslator(pageLanguage)`.
   Deliberately NOT next-intl. The app follows `me.language ?? orgs.language`;
   sign-in falls back to localStorage, then the browser language.

## The demo org

`orgs.demoMode` marks a showroom org: sends simulated, replies invented,
rebuilt nightly from `devSeed`. **Its safety story is NOT Nudge's**: the same
deployment holds real salons, so the boundary is org scoping, plus no
`waAccounts` row for the demo org, plus every send path checking `demoMode`
BEFORE the credentials check. Anonymous walk-in sign-in exists only when
`DEMO_ORG_ID` is set. Never set `demoMode` on an org with credentials. Its
session stays on `demo.resepta.xyz`, so it never replaces an owner's
`resepta.xyz` session.

**The showroom is Real Estate Co.; its phone side is a fixture** (Serdar,
2026-10-27). `lib/demoVoice` holds it; every voice read that would ask
the provider (`retell.listAgents`, `retellAgent.read`, `listVersions`,
`readVersion`, `browserTestVariables`, `browserTestResult`) answers from it
first via `demo.agentView`, before any credential check. The agent page's READS
(`agentTests.listForAgent`, `agentReviews.list`/`get`) take
`requireOwnerOrDemoReader`; every write stays `requireOwner`. Demo agent ids
carry the org id and its numbers are Ofcom's drama range.

## The mobile pass (2026-08-15) — phone rules that now hold everywhere

- **iOS input zoom is solved in ONE place** (`globals.css`: every field 16px
  below sm; `RecordField`'s `compact` takes its container). Never a sub-16px
  field on a phone; never `maximum-scale=1`.
- **The safe area needs both halves**: `viewport-fit=cover` in
  `app/layout.tsx`'s viewport export and the tab bar padding by
  `env(safe-area-inset-bottom)`.
- **A view that scrolls inside itself declares `data-fills-pane`** (Inbox,
  calendar grids, customer drill-in) and AppShell's `main` drops its bottom
  padding via `has-[]`. The test is the view's attribute, not a tab list.
- **The scrollbar gutter is sm-and-up.**
- **Phone insets**: `main` `px-2` below sm, `Card` `p-3`.
- **Phone rows are grids with FIXED tracks, never wrapping flex lines**
  (services: `SERVICE_ROW_GRID`). Every track holds value AND unit at 16px; a
  too-narrow track overflows visibly (whitespace-nowrap), never stacks.
- **The tab bar is not the sidebar**: `navTabs` minus `drawerOnly` (set-once
  surfaces give up their slot first), `phoneKey` for a shorter label; the
  drawer shows everything. 5 + More was deferred.
- **Switches never wear their column label as a word on a phone**
  (`aria-label` carries it); values that cannot speak for themselves keep
  their unit.
- **Row deletes are an ×** in a quiet h-7 square, the word on
  `aria-label`/`title`.

**Service keys (Serdar, 2026-08-15).** Services is an owner's price list
(name · duration · price · active) with NO key at any width. Keys live in
`ServiceKeysCard` under Contact fields on the Voice agent's strip, names
read-only there. Don't put the key column back.

**Decided, not built: duration-less services.** `durationMinutes` is
load-bearing in ~18 convex files: a semantics project, not a `v.optional()`
sprinkle. Spec first.

## Conventions carried over from Nudge

- `npx tsc --noEmit` must pass before every commit.
- **A push to `main` deploys the backend too. Do NOT tell Serdar to run
  `npx convex deploy`.** The deploy rides Vercel's BUILD COMMAND in the
  project settings, invisible from this repo (`package.json` says only
  `"build": "next build"`; no `vercel.json`). Push is the whole ship.
- `convex/_generated/` is CHECKED IN: commit it with any backend change that
  adds or renames a function or table.
- During refinement work, commit each logical unit directly to `main` and
  never push until Serdar asks (Serdar, 2026-07-31).
- Use Serdar's signed-in Chrome for UI previews and visual verification,
  never the internal browser (Serdar, 2026-07-31).
- The user runs dev servers, not the agent.
- Phone numbers are E.164 with dial code (`+905...`) or they don't exist.
- No Save buttons: autosave on blur/change. Explanatory copy behind tooltips.
  Exceptions, each because one press puts words live: the voice agent's
  Publish, the automation editor's Save, the knowledge editor's Cancel/Save.
  Their controls are `EditorSaveBar` with ONE boxed thing, the action that
  ends the state; the state is an amber dot and a sentence; Discard is
  `quiet`, never red.
- Small commits per logical unit.

## Editing, adding, density (recurring, stop it)

**1. A value you can change is an inline edit, not a parked form control.**
`InlineEditValue` (RecordField.tsx) handles text and picklists (`options`;
`labelFor` when the stored value is a slug). A bare `<input>`/`<select>` only
in an actual form (a sheet, a filter bar).

**2. Adding opens a sheet** (`Sheet`, Sheet.tsx); never a permanent empty
field at the foot of a list. If one gesture could create two kinds of thing,
the sheet asks which. A sheet holding typed words passes `dirty` (Escape and
backdrop leave it open; only Cancel closes). Writing to ONE customer is the
compose dock (`ComposeDock`): bottom-right, never closes on an outside click
or Escape, keeps its draft in the browser. A new one-person composer takes
the dock.

**3. Vertical space is the scarce resource.** A name and an email are ONE
line; controls sit in columns beside identity. Check inline before stacking.

**4. Nothing shifts under the pointer.** Switching, toggling or revealing an
error never resizes the container: equal-height variants (a second field
BESIDE the first), reserved error lines, the sort caret's space kept. If
states cannot match, the taller sets the height.

**5. Use the industry's word, not a coined one.** The vocabulary is fixed:
**Team**, **Member**, **Available**. `orgs.staffLabel` is dead in the schema
(Convex cannot drop a field rows still carry). **Name the set, not its
best-known member.**

**6. `ROW_GRID` is the settings-page grammar, not a universal layout.** Keep
the grammar (label left, capped value right, never a control stretched
across the card) and size columns to the labels you have. In a settings card
every field is ONE width, the value column's 24rem (Serdar, 2026-10-21). A
row holding two things splits that width; a suffix (@domain, a unit) sits
INSIDE the box. The label is a `ControlLabel` (RowLabel.tsx).

**7. Selected state needs a shape, not only a hue**: a check in the active
pill. Mind what a colour already means: amber is "unsaved", so the active
channel is emerald.

## Popovers NEVER position absolute inside a card (recurring, stop it)

Every floating element renders through `createPortal(document.body)` with
`position: fixed`, measured from the trigger's `getBoundingClientRect()` and
clamped to the viewport; an `absolute` child clips on the nearest
`overflow-hidden`/scroll ancestor, which every card is. `InfoTip`
and `RowMenu` are the references. A clipped popup is a bug.

- **Every menu goes through `useAnchoredPanel`; none positions itself.**
  Options: `prefer: "above"`, `gap`, `anchorRect` (off the caret),
  `triggerRef`, `show()`, `room`, `minWidth`; it re-places a panel whose size
  changes. A ⋯ of verbs is `RowMenu`.
- **Scroll REPOSITIONS the panel; it does not close it.** Two guards survive
  any rewrite: a scroll INSIDE the panel is ignored, and the panel closes only
  when the trigger has left the viewport.
- **A floating list wears `.menu-surface`**, never a spelled
  `border bg-[var(--card)] shadow-lg`. Tooltips keep theirs.
- **A short pick list is `SearchableSelect`**, never a native select or a
  copy (`searchable={false}`, option `group`, `values` + `triggerLabel`,
  `menuWidth="trigger"` with `menuMinWidth`).

## A hover label is one look (2026-10-17)

A control's hover LABEL is `HoverTip` (`src/components/HoverTip.tsx`): dark
chip (`TOOLTIP_LOOK`), instant, centred and clamped, via a portal.
`side="right"` is the folded sidebar's; only the fold toggle waits 500ms.
`ActionTip` wears the same chip (`TOOLTIP_CHIP`).

- **Never a native `title` on an icon-only control**: `HoverTip` plus
  `aria-label`.
- The wrapper is `inline-flex`; a full-width row takes
  `className="flex w-full"`, a grid or absolute child `"contents"`. A
  disabled button gets `disabled:pointer-events-none` and the wrapper owns
  the hover.
- An explanation is InfoTip's (i), not a label. Data previews may keep a
  native `title`.

## Tabs are underlined, never pills

Canonical in Mana, `50_Knowledge/design-language.md`.

- Strip: `flex items-center gap-5 border-b border-[var(--border)]`.
- Tab: `-mb-px border-b-2 px-0.5 py-2.5 text-sm`.
- Active: `border-[var(--foreground)] text-[var(--foreground)]`.
- Idle: `border-transparent text-[var(--muted-strong)]`, hover `--foreground`.
- **Weight never changes between states** (400 in both).

`VoiceView` is the reference. Value pickers that look like a strip (channel
pills, feed filters) are NOT tabs.

**A one-of-N track is `SegmentedControl`, never a copy.** Its own tokens
(`--segment-track`, `--segment-thumb`, `--segment-thumb-shadow`), never
`--muted-bg`; ONE thumb MEASURED from the picked cell, never placed by index;
`rounded-xl` cells for a stacked icon row; every cell font-medium;
`semantics` says radio, tabs or menuitemradio; a radio group has one tab stop
and arrow keys.

## Every scrolling page ends with room below the last card

Canonical in Mana. `.page-stack` (`globals.css`, 6rem bottom padding) goes on
the ROOT of every stacked-card view that scrolls. **Never on AppShell's
`main`**: master-detail views (Inbox, Calendar, ContactView) are `h-full` and
scroll inside their own cards. A scrolling PANE needs it too: `CallDetail`'s
`flow` mode carries `pb-24`.

## Scrollbars: two weights, width-only hover

Canonical in Mana; reference implementation in `src/app/globals.css`.

- `.thin-scroll`, the in-card rail: 3px, 6px on hover. Everything scrolling
  inside a card uses it.
- `.page-scroll`, the shell's `main` only: 6px, 8px on hover. Widths ONLY,
  and it stays below `.thin-scroll` in the file.
- Hover changes width, never colour.
- The rail is carved from a wider track (transparent border +
  `background-clip: padding-box`), keeping the full-width hit box.
- **`scrollbar-width` stays inside the `@supports not
  selector(::-webkit-scrollbar)` guard**, or Chrome drops its webkit styling.

## A header row sits in the same column as the feed below it

Bands under `ConversationPanel`'s header match the scroller's padding AND the
9px `stable-gutter` reserves for `.thin-scroll`. One `FEED_COL_PAD` constant
(`calc(1rem + 9px)`, never a resolved pixel value) covers them; keep it in
step with the `threadRef` div.

**The resting action is not in that column.** Compose, Place call and Add
note ride the right end of the header row (`px-3`); a new tab's resting
button goes there. Exception (Serdar, 2026-11-01): the Inbox's action row
under the header (`actionsBelow`) takes `FEED_COL_PAD`.

## The WhatsApp thread copies WhatsApp, measured (2026-10-17)

`#f5f2ec` paper, no doodles, Roboto (`.chat-font`), WhatsApp's tail SVG on a
run's first bubble with that corner squared, 2px within a run and 12px
between runs (margins collapsing with `space-y-2`), a 65% cap. Bodies render `*bold*`, `_italic_`, `~strike~`,
```` ```mono``` ```` through `src/lib/waFormat.tsx`, used by every surface
showing a body as the customer sees it. A failed send's cause comes from
`lib/waFailure` (only codes we are sure of). Measure against WhatsApp Web
before changing any of it.

## Two faces, each with a job (2026-10-17)

**Inter** (`--font-app-sans`, latin + latin-ext) is the app's face, public
pages included. **Roboto** (`.chat-font`, `--font-chat`) is the COMMS face
only: the Inbox list and pills, the conversation pane on every tab, the email
dock. Nunito only on the wordmark. Never add a fourth; any new face carries
latin-ext. Re-measure widths that were measured in Geist.

## Borders only when absolutely necessary (Serdar's design language)

Borders belong to CONTAINERS (cards, inputs, dropdown panels), never buttons.
A button that needs an edge gets DEPTH: primary is crisp (`--primary-bg`,
`--solid-shadow`, `--primary-hover`), secondary is RAISED (`--raised`,
`--raised-shadow`). Rings, never borders. Ghost buttons are text on
`--control-hover`, not `--muted-bg`. Check every new control against this.

## Controls have three heights, and the height is declared (2026-10-13)

`src/components/Control.tsx`: `buttonClass` / `iconButtonClass` /
`fieldClass` / `controlClass`. `xs` 28px dense chrome, `sm` 32px default,
`md` 36px the booking sheet's footer. A size names its `h-*`; padding sets
only horizontal rhythm. One type size, `text-sm`. `ghost`/`quiet` no border,
`primary` crisp, `outline` raised (`.card-action` in globals.css is `outline`
at sm and must agree), `pill` is a VIEW control, `danger` muted until hover.
`rounded-lg` does work, `rounded-full` chooses what you see. `FIELD`
(RowLabel) is `fieldClass("sm")`. Take sizes from here, and never stack a
colour utility on a variant.

## The shell is one frame; the cards are the paper (2026-10-13, joined 2026-10-21)

- No shell padding, gap or rounded sheet: the rail and the `h-12` top bar
  are ONE flat frame (`.app-pane`); `main` wears `--content-bg` (`bg-fixed`;
  the calendar uses plain `--pane`), `md:rounded-tl-xl` and `.workspace-boundary`. No inset sheet unless the
  cards go first. `data-app-shell` hands back the scrollbar track.
- **Sidebar glyphs are 16px at stroke 2** (`makeIcon`), 18px in the tab bar;
  normalise borrowed glyphs at the call site. **Row weight never changes
  between states** (font-medium; wash, tier and glyph say selected). Each tab
  keeps its hue.
- **No product mark inside the app** (Serdar, 2026-10-21). The rail's first
  row is `h-12`, level with the top bar, holding only the fold toggle; the
  business switcher is the row under it. Brand stays on sign-in, onboarding
  and customer pages. Folded, switching business waits for the rail to open.
  Keep the rail's first row and the top bar one height.
- **The header search** is `SearchInput` (DataTable.tsx): `rounded-full`,
  `h-8`, `--card` fill, fixed `w-40`/`lg:w-48`, never sized to its text. The
  one round field; fields in cards stay boxed.
- **`main` is `relative`**; keep it so, and keep `sr-only` labels positioned
  under it.
- **Inbox and record share one split**, `TWO_PANE_COLUMNS` (ContactView);
  change it there only. **Each is ONE card holding both panes**
  (`JOINED_PANES`, `PANE_DIVIDER` from lg); never `card-raised` on a pane. In
  dark the tabs sit on `--conversation-paper` and the card wears one
  half-`--border` outline.
- **An Inbox row opens its conversation beside the list** (Serdar,
  2026-10-27). The record is the header's last pill, **Details**, showing
  `ContactRecord` IN PLACE of the feed via `ConversationPanel`'s `details`
  (feed stays mounted, so a draft survives). Anywhere a record shows mounts
  that component, never a copy. The full page is the name (no ›) and the row
  menu's Open customer. The open tab's action sits on its own row
  (`actionsBelow`); the contact page keeps it on the pills' row.
- **The rail's two menu controls look alike**: business switcher and account
  row wear `--pane-field` with the up/down chevron (Serdar, 2026-11-01). The
  account row is name · address with the Google photo, initials as fallback.

## Voice numbers, caller identity, and the variables doctrine (2026-08-18)

**Caller identity.** `fromNumber` is the CUSTOMER's leg; `recordCall` picks
by the direction Retell reports, never assuming inbound. Every voice entry
point normalises numbers with `dialCodeForTimezone` (carriers do not always
send E.164). `orgOwnNumbers` is a hard guard: the business is never its own
customer.

**Tools read the caller from that leg, never a model argument.**
`/retell/functions` resolves via `retell.callerOfCall` and ignores any
`phone` argument. No usable number (hidden ID, web call, own line): book,
save and find/cancel/reschedule refuse with a sayable sentence that also says
not to take a number. The legacy `/retell/mcp` identifies nobody:
`get_call_context` answers the business half, `save_customer_details`
refuses. Never add a tool argument that names a customer, phone or
appointment.

**Tool answers are live; tool definitions are versioned.** A tool answer may
name only the five calendar tools every version has carried since v1, never
`end_call`; new tool wording names no other tool. Tool times are business
wall time `YYYY-MM-DDTHH:MM`, never UTC.

**Publishing.** Every agent-page edit goes through
`retellAgent.applyAgentEdits`: one draft, one named publish, mirrors written
after the provider accepts. Read an LLM at its agent doc's version
(`lib/retellDraft.llmPath`), never bare. A new outbound dial path passes
`override_agent_version` for the published version, as `testCall` and
`placeCall` do.

**A browser test is never a call** (subsystems → "Testing an agent in the
browser"). `retellAgent.startBrowserTest` marks it (`lib/browserTest`, an
`agentTests` row); its tools answer DRY (`agentTests.noteAction`) and the
webhook stops before `voiceEvents`. Metered into `usageMonthly.voiceTest*`
as a share, never an addition. A new write in the functions route checks
`isTest` first; a marked call with no row of this org is still a test. The
Testing tab stays mounted and only hidden, never in anything that unmounts
it.

**A review is the team's, kept on its row** (subsystems → "Reviews and the
Notes tab"). On `calls` via `calls.setReview` (any member, the call's own
org, refused while the customer is deleting); on `agentTests` via the
owner-only `agentTests.setReview`, same contract: whichever half changed,
`verdict: null` takes it back, the `note*` stamps sign it and go when
emptied. `action`/`doneAt` via `agentReviews.setAction`; `agentReviews.list`;
both owner-only. One editor, `ReviewNotes`. The Notes tab has no charts or rates.
Never show a review to the chat or phone agent.

**A person's dial says who placed it.** `testCall` sets
`lib/browserTest.PLACED_BY_MARKER`; `recordCall` keeps
`calls.placedByUserId` only for a member of the call's org. Bulk calls are
named by run (`bulkRunItems.by_retell_call`). A new person-triggered dial
path carries the marker.

**The first sentence is Resepta's; there are two clocks.**
`retell.beforeCallContext` always sets `{{opener}}` (`lib/opener.chooseOpener`,
never empty; sentences in `retellAgents.openers`, provider default
`openerFallback`, never a variables row). `customers.lastConversationAt` only
from `call_successful`; `lastCallAttemptAt` only from a placed call that
reached the phone; both by `recordCall` alone, forward only, never for a test
or the demo. A new dial path passes `direction`; a new ring-time key joins
the read-only rows in `VoiceVariablesEditor`.

**Recogniser hints are derived; only ours are replaced.** `boosted_keywords`
= the org's name, active team and services (`lib/boostedKeywords`), read
after the agent is proven the org's. Every agent-doc publish sends them via
`keywordPatch`. `retellAgents.boostedKeywords` records what we sent, so only
those are swapped; an empty list is never sent.

**Numbers.** `agentLines` binds per number and direction, reconciled from
clean roster reads and written by `attachLine`/`detachLine`. Shared-account
provisioning is operator-only: `orgs.allowedPhoneNumbers`, empty = NOTHING;
pickers offer allowlist ∪ bound (`retell.orgNumberPolicy`). Nothing MOVES a
line implicitly; the editor's select attaches. Inbound resolves the agent
from the DIALLED number (`agentForInboundNumber`).

**The variables doctrine (Serdar's, hold to it).** Groups: Bilir / Sorar /
Öğrenir. Bilir mirrors `beforeCallContext`'s dynamicVariables key for key,
read-only; a new runtime variable must appear there. Identity (name, email)
and the booking's questions need NO registry rows or prompt paragraphs
(save_customer_details, template v17, names the keys). Caller first/last name
are our analysis fields on every agent (`callerNameAnalysisFields`), so a
said name reaches an EMPTY card regardless of script or switches. A
switched-off identity column (`voiceLockedIdentity`) means never CHANGE a
saved value, never "may not fill an empty one"; `applyVoiceContactValues` and
`{{information}}` read it so. The registry exists ONLY to teach post-call
analysis org-specific fields. An empty Sorar is healthy.

**A non-answer is not an answer.** "Belirtilmedi", "Not specified",
"Nicht angegeben" and siblings (`lib/nonAnswer.ts`) are never stored
(`coerceVoiceValues` drops them; `applyVoiceContactValues` skips them and
lets a real answer replace one) and never read back (ring-time injection and
`builtinAgentVariables` treat them as empty). "Yok"/"None"/"Keine" count only
where a name is expected. Every path saving agent-collected values goes
through those two functions.

**A call summary is in the business's language** (template v17).
`resepta_call_summary` uses `retellAgents.summaryLanguage` (part of the one
Publish; the business's own language stores unset), else the business's
language (`lib/voiceAgentTemplate.summaryLanguageFor`), never the agent's
spoken language or the UI language. Every path that writes the analysis list
resolves it there.

**Confirmations vs. late emails.** The agent asks for e-posta AFTER booking.
`retryConfirmationsAwaitingEmail` (appointments.ts) re-fires booking rules
when an email lands, only if ALL confirmation attempts failed. Every new
email-writing path calls it.

**Three Convex/React traps.** (1) Convex validates RETURNS strictly: change
the `returns` validator in the same edit as the result type (TypeScript
cannot catch it). (2) Context setters must be referentially stable
(useCallback). (3) Error TEXT does not survive a function boundary: a refusal
a caller branches on is RETURNED (`{ ok: false, code }`) or a `ConvexError`
read from `.data`. The frontend's `raw.includes("code")` checks stay; an
error handed to a model or stored goes through `cleanError`
(lib/mcpProtocol).

## The assistants touch only the customer's own appointments (2026-10-13)

Both agents find, move and cancel through
[`convex/agentAppointments.ts`](convex/agentAppointments.ts). No second path.

- **Whose comes from the channel**, never a tool argument. **Which comes from
  what the agent read back**: cancel and reschedule take `appointment_start`
  and `appointment_services` and act only on the customer's own open
  appointment at exactly that minute with those services, else
  `appointment-changed`. Several matches, or a bare start at a minute changed
  within `REPEAT_WINDOW_MS` (three minutes), answers `appointment-ambiguous`
  with the list; identical twins go to a person. Never "whatever is next
  now". Engines older than template v14 keep "the next one" but are refused
  for three minutes after any change, and that refusal emails the team.
- **A move is judged in its writing transaction** with `booking.ts`'s
  helpers: minimum notice, the day's hours, closures, capacity (the row not
  blocking itself), the customer's other bookings, a good's lead time.
- **Minimum notice binds every customer-facing door** (`orgs.minNoticeHours`,
  `lib/minNotice`): booking and manage pages, assistant bookings
  (`bookingProblem`, drafts judged when sent) and moves (`too-soon`, with
  nearest free times). Unset = one hour, 0 = none, ASAP exempt. Only the
  team's calendar may book inside it. A new door reads the same helper.
- **Six changes a day per customer** (`customers.agentChangesAt`,
  `lib/agentChange.ts`): assistant bookings, moves and cancels, manage-page
  (`/appt/<token>`) moves and cancels, and the customer's WhatsApp cancel
  (İPTAL, the button) all count. Past six, assistants refuse moves, cancels
  AND bookings and the manage page refuses moves; a customer's own cancel is
  counted, never refused (Serdar, 2026-10-13). Judged with the change, AFTER
  a repeat is recognised; never pre-checked in a lane; `checkChange` asks
  both before cal.com is told. Phone refusals email the team
  (`bookNeedsPerson`/`moveNeedsPerson`/`cancelNeedsPerson`, failed-send
  switch); in chat the agent calls `escalate_to_staff`.
- **A "no" about a time carries the nearest free times**
  (`retell.nearestFreeTimes`, on `freeStarts`). Both lanes'
  `check_availability` answer through `judgeRequestedTime`.
- **A booking asked for twice is one booking**: `voiceBook` returns the
  existing open appointment at that minute with the same services (or a
  recent identical ASAP order). `MAX_UPCOMING_PER_PHONE` (`lib/bookingLimits`)
  applies via `bookingProblem`, shared by `voiceBook` and its dry run.
- **A chat reply that only suggests changes nothing.** In suggest and shadow,
  write tools record intents (`chatAgentTurns.intents`). Sending the draft
  applies ALL of them in ONE transaction (`chatAgent.applyDraftChanges`); one
  refusal rolls back everything and nothing is sent. The dry run is the same
  code (`applyIntentsTx`) in an always-throwing nested mutation
  (`simulateDraft`). A change cal.com would make is refused in a draft. Any
  new write tool takes the draft path. `chatAgent.simulateTurn` rides it too
  (`loadTurnContext` with `simulate` reads as suggest, writes no row; cost
  counts like a shadow turn, not billed).

## A list's add sits above its card (Serdar, 2026-10-21)

Title, (i) and creating action sit in a row ABOVE the card; the card holds
the list only (`ListHead` in BusinessView, same markup in `KnowledgeCard`).

- **The row**: `min-h-8`, 8px over its card, lists 1rem apart. Page-level:
  view controls left, add right. Titled: title and (i) left. One row at every
  width; menus portal. A selection's verbs replace the whole row.
- **It does not wait on the list**: drawn before rows arrive and when empty,
  so Add shows in the EMPTY state. Exceptions: Products (appears once a
  product exists), Automations (whole page waits on data).
- **One loud thing per screen** (Serdar, 2026-08-25). Filled where the list
  is the screen's point (Customers, Voice agents, Automations, Team, Contact
  fields, Services on Knowledge); outlined (raised ring, no fill) for a
  further list (Products, Knowledge under Services).
- **Adding opens a sheet**; no form unfolds in the card.
- **A form card has no such row** (General, Hours). Team keeps "Team (i)".
- **A SECTION's action inside a card stays inside**, outlined with its `+`
  (`buttonClass("outline", "xs")`, "+ Add sale"). Revenue's history too.
- **The add sits outside the card's fieldset**; an add a member may not use
  gates itself (`isOwner ? … : undefined`).
- **Read-only reads as facts, not a dimmed form** (Serdar, 2026-10-14).
  `Card`'s `disabled` puts `.readonly-form` on its fieldset, not
  `opacity-70`: values (`data-value`) at full strength, a disabled action
  keeps its disabled look, a change-only control carries `data-edit-only` and
  is gone; "View only" once (`ViewOnlyPill`). A new ×, add or remove control
  on a member-readable card carries `data-edit-only`.
- **Customers wears Nudge's Contacts head**: views as underlined tabs (All,
  Muted when anyone is, saved views from `customerViews`, +), Add customer at
  the strip's right, count left with Clear filters and Columns right. A view
  saves column filters and sort, shared by the business; its saver or an
  owner may change or delete it. Columns stay per person.
- **Never park an add at the foot of a list.**

## One state, one hue (2026-08-21)

- **Emerald is ON** (channel switches, "Days you're open"; day chips carry
  `role="switch"` + `aria-checked`).
- **Amber is UNSAVED**, only that.
- **Violet is a PIN** (inbox row and record). `--accent` blue = do
  something, `--now-line` red = now.
- **`--brand` green = something NEW in there**: the sidebar's inbox dot only.
- **No check inside the day chips**: seven must fit ONE line in 24rem. The
  blocked-time sheet's weekdays match (emerald on, empty well off).
- **A team member's colour means WHO, nothing else.** Google's palette,
  lavender first, tomato left out (`lib/staffColors.ts`): bookings, the Team
  dot, the side panel and day-view columns. Never a state; tense and status
  set the shade; a no-show stays red. Unique among the ACTIVE team;
  `staff.setColor` and `staff.remove` freeze unset colours first. Never key a
  colour on a service.

## An inbox row says what was said (2026-08-21)

Second line: channel glyph, `not sent` in `--now-line` for a failed send,
`Siz:` when the newest is ours, the body on one line. The glyph is an
un-clickable mark, not channel buttons. An empty WhatsApp or mail body
previews as "Şablon mesajı", matching `ConversationPanel`.

## A page title names the page, in the bar that names pages (2026-08-22, breadcrumb 2026-10-17)

- **`AppShell` takes `overrideTitle` (a STRING) + `onOverrideBack`**; never a
  node (render loop).
- **The way back is a breadcrumb, not an arrow**: `Inbox › Ayşe Yılmaz`,
  every step clickable, title size and weight, steps in `--muted`; below `sm`
  only `‹ Inbox`. Crumb labels are strings.
- **A record open INSIDE a tab** (voice agent, message rule, bulk run) calls
  `useHeaderTrail` (`src/lib/headerTrail.tsx`) with its name, close handler
  and optional `backLabel`, and draws NO back control. An opened review
  shows `<agent> › <customer>`. A new drill-in uses the hook. One trail per
  slot; a customer record replaces the tab's view (`AppHome`). Exceptions:
  the Inbox's phone back to the list, a sheet's own step back.
- **One title inset on every tab.**
- **`AppHome` holds the name; `ContactView` reports it** via `onTitle`, is
  keyed on the id, and `overrideContactId` is an ID (the shell renders
  `PinDot` and runs its own query).
- **The Inbox conversation's name carries a `›`** leading on to the record.

## The pin, and reading it the same way twice (2026-08-22)

**ONE dot per row, left gutter, NAME line** (8px dot, 14px target): violet
(pinned) beats brand green (unread) beats a hover ring. Keep Nudge's inbox in
step. The lit row is `--row-active-bg`, never a left bar.

**A row has a menu; Mark as unread is a FLAG.** Right-click (touch: the
chevron; no hover chevron) opens one portalled `ContextMenu`: Open customer,
Pin, Mark as read / unread, Mute. `inboxReads.unreadAt` is per person,
checked AHEAD of the read floor, unioned into `inboxUnseenCount`,
`inboxCounts` and the Unread page, cleared by `stampConversationRead` (every
read path uses it). New read paths and counts honour it. Chips: All / Unread
/ Pinned, always three, one lit, a lit chip never toggles off. A WhatsApp
bubble's menu: Reply, Copy, React, Add to note, each per its gate, React only
where `canReact` says it reaches the customer. Menus share
`components/ContextMenu.tsx`.

**A pin lasts until it is unpinned**; no outbound spends it.
`messages.inboxPin` and `conversations` both read a pin row as a pin.

## Knowledge reads as prose, not as a form (2026-08-21)

The bubble is the edit affordance; Delete is hover-revealed on opacity.
**Cancel/Save, not collapse-on-outside-click**, because the editor's swatch
and emoji picker portal to `document.body`; Notes use the same close. An
empty block previews its placeholder.

## Seeding the calendar, and the rule every bulk writer inherits (2026-08-25)

`create_appointments` (MCP): up to 50 rows a call, customer by id or phone,
`start` as business wall time (`lib/businessHours.parseLocalStart`), services
by `list_services` key and SNAPSHOTTED, status off the clock.

**A SEED MUST NOT CAUSE A SEND THAT WAS DUE BEFORE THE SEED EXISTED.** The
cron treats "due in the past" as DUE NOW, and `no_show` has NO backward
guard, so every rule already due for a row is stamped into `sentRuleIds` at
insert; future rules stay armed. Known cost: a seeded booking later moved
out keeps a stamped reminder suppressed.

It never calls `scheduleConfirmationIfConfigured`, never touches cal.com,
never mints customers (`create_customers` does, deduping on number), and
reports unplaceable rows by number and reason. Undo deletes only what is
still as written (not moved, cancelled, re-staffed, changed or messaged
about; hourly auto-completion is not a change). Undoing `create_customers`
keeps anyone with activity since and deletes the rest through the customer
deletion. Re-run the verification (journal, 2026-11-01) before touching this.

## Explanations ride the (i); surfaces carry controls and facts (2026-08-25, standing)

**Inline explainer prose goes behind an InfoTip, every time.** Visible prose
only for a STATE the user must act on, or a wizard step's subtitle. **Money
fields are short and wear their $** (`Row money`: 7rem, decimal keypad, $
inside). **Each locale speaks to its own reader**: name nobody else's
country.

## Bandwidth: a live query pays per re-run, not per row (audited 2026-09-03)

An O(org) subscription re-runs on every write inside it (audit: journal,
2026-11-01).

1. **A processed voice event has no payload.** `voiceEvents.complete` nulls
   it; a failed row keeps it for retry. `health` and `orgDetail` read
   `by_org_status` ranges. One-off: `voiceEvents:stripProcessedPayloads`.
2. **The inbox reads `customers.thread`, never the messages table**
   ([`lib/thread.ts`](convex/lib/thread.ts)). **Any mutation that inserts a
   `messages` or `calls` row calls `noteMessage` / `noteCall`; any that fails
   a row, fills a call's analysis, attaches media or deletes a scheduled row
   calls `recomputeThread`.** The Inbox queries (`inboxPage`, `inboxCounts`,
   `inboxSearch`, `inboxConversation`), `inboxUnseenCount`,
   `markAllConversationsRead`, `inboxPin`, `customers.listPage` and
   `customers.get` walk `by_org_thread_last` / `by_org_thread_inbound`.
   `threads:backfill` rebuilds idempotently.
3. **Customer search reads the search index.** `customers.searchText`
   (`lib/customerSearch`, `search_text` index by `orgId`). **Any mutation
   that inserts a customer or changes a first name, last name, phone or email
   calls `syncCustomerSearch`.** `customers:backfillSearch` rebuilds.
4. **Per-agent call figures are counters**: `retellAgents.callCount` and
   `lastCallStartedAt`, bumped by `recordCall` on INSERT only; "today" is a
   `by_org_started` range. `retell:backfillCallCounters` seeds them.

How to check: the usage page's Database I/O breakdown by function, not
Insights or logs; compare a query's total with what its screen shows.

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
