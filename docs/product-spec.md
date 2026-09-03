# Resepta production spec

Last reconciled with the shipped product: 2 August 2026.

## 1. Product

Resepta is an AI front desk for appointment businesses, starting with salons,
barbers, dentists and clinics in Türkiye. One shared, multi-org deployment gives
each business a phone receptionist, customer records, appointments, WhatsApp
confirmations and reminders, an inbox and a calendar.

- **Business owner:** the phone and customer messaging are handled, bookings
  land in one calendar, and customer details stay current.
- **Automation partner:** install the customer's external accounts once, then
  let the business configure and operate its own front desk in Resepta.
- **Platform:** voice, WhatsApp, email, forms and staff actions write into one
  org-scoped customer and appointment model.

This remains an appointment product. Lead qualification, deal stages and CRM
pipeline features belong elsewhere.

## 2. Product boundaries

### Account and tenancy

- Google OAuth is the normal sign-in path. There are no passwords or reset
  flows.
- A first sign-in creates an unnamed org, then the app asks for the business
  name.
- Every app table except `orgs` and auth-owned tables carries `orgId`; every
  customer-facing query resolves and filters by the caller's org.
- Membership and invite infrastructure exists, but invitations are not part of
  the default self-serve onboarding promise while the operator model remains an
  open product decision.
- Cross-org reads exist only in the platform-admin layer and are protected by
  the `PLATFORM_ADMIN_EMAILS` deployment allowlist.

### Scheduling

- cal.com is the intended availability and external-calendar system.
- Its adapter, webhook and voice booking path exist, but an org is connected
  only when an operator installs both `calcomApiKey` and `calcomEventTypeId`.
- Without those values, manual and phone-created appointments are stored only
  in Resepta. No conflict check runs, so double-booking is possible.
- Walk-in entry remains native to Resepta. `appointments.source` distinguishes
  manual, voice and external bookings.
- Blocked time is not modelled. Do not create fake-customer appointments for
  breaks; revisit the cal.com availability decision before adding closures.

### Messaging

- WhatsApp production delivery uses the Meta Cloud API lane.
- Business-initiated confirmation, reminder, win-back and campaign sends use
  approved Meta templates.
- Customer language resolves from the customer first, then the org. Missing
  template language fails visibly; Resepta never falls back to the wrong
  language.
- Inbound WhatsApp resolves the org from Meta's phone-number ID, never from the
  customer's number alone.
- Delivery is queued with retries and dead-lettering. `messages.applySendResult`
  is the one authority for final send outcomes.
- Email delivery and inbound email use Resend. Each org has its own sender and
  inbound local part on a deployment-wide verified domain.

### Phone agent

- Resepta is the phone-agent control plane. The execution provider is hidden
  from salon users.
- The owner can create a native appointment receptionist or connect an existing
  agent from **Phone agent → Add agent**.
- New agents start from a versioned Resepta template and can speak Turkish,
  English or German.
- Resepta owns Instructions, Variables, runtime tools, call history and customer
  writes. Provider configuration is compiled output.
- A variable is declared once across before-call context, live collection,
  post-call fallback and storage destination.
- Signed call events first land in a durable inbox, then update the call and
  customer with retries. Live caller-confirmed values beat transcript
  inference; post-call analysis only fills missing customer data.
- Resepta can assign an unclaimed line but does not purchase phone numbers.

See [`phone-agent.md`](phone-agent.md) for the full architecture and operator
runbook.

## 3. Shipped product surface

The signed-out `/` route is a vertical-agnostic product landing page. Its hero
uses Resepta's own call, calendar and follow-up interface rather than an
industry photo. Beauty, clinic and local-service photography appears only in
the use-case tabs below the product story. Turkish, English and German copy is
written for each market rather than translated line by line. Landing media is
public under `/images`; the proxy must never redirect those asset requests to
sign-in.

The public `/help` route is the customer-facing Resepta help center and is also
served at `https://docs.resepta.xyz`. It turns the product facts in this file and
the other technical runbooks into customer-safe setup and operating guidance.
Provider identities, platform-admin controls, credentials and raw recovery
steps stay out of the public help center.

The signed-in sidebar is:

1. **Customers**: customer table, custom information fields and history. The
   table shows name, phone and email by default; everything else, including
   every contact field the business defines, is one tick away in the Columns
   picker. Contact fields used to arrive as visible columns, which meant the
   table only ever got wider.
2. **Inbox**: WhatsApp and email conversation work.
3. **Campaigns**: approved-template outreach.
4. **Phone agent**: Agents and Calls in one destination.
5. **Reminders**: reminder rules, templates and WhatsApp connection.
6. **Calendar**: Day, Week, Month, Year and List views plus manual booking.
7. **Revenue**: feature-flagged takings view.
8. **Business**: business facts, services, Team, contact fields and AI
   connectors. Team is one list — who can sign in and who can be booked are
   columns, not separate cards — and members are archived before they can be
   deleted. The connector beside it can read and build all of this, including
   creating a phone agent; see [`phone-agent.md`](phone-agent.md).

The public booking page at `/book/<slug>` is the only surface a customer
reaches without a link from a message. It is a three-step wizard in one
fixed-height card — service, time, details — and as of 2026-08-20 the service
step is MULTI-SELECT: a haircut plus a beard trim is one appointment with two
lines, one calendar block and one reminder, which is what `appointments.items`
has modelled since long before the page could express it. Services and products
are separate groups (a product books no time), quantity is goods-only, the list
searches behind a magnifier, and the details step takes an optional note that
lands on the customer's record rather than on the appointment. The page's
address is `slugify(orgs.name)` and follows the business name, which is why
business names are unique.

There is no Settings destination. Do not reintroduce it. Configuration belongs
next to the work it controls, while operator-only credentials live in `/admin`.

The app UI dictionary supports Turkish, English and German. The CUSTOMER
language is a separate per-org setting (Business → General, renamed from
"Message language" on 2026-08-20 because it names more than messages): it
drives the messages sent, the booking page and the appointment-management page,
while the owner reads the app in whatever their account menu says. Prices are
written per-org too — `orgs.priceDecimals`, off by default, beside the currency
select — and the formatter never rounds, so the option only ever removes
zeroes.

## 4. Phone-agent user experience

### Agents

- **Add agent** and the icon-only refresh action sit outside the agents table.
- Add agent opens a sheet with **Create new** as the default and **Connect
  existing** as the second path.
- Create new asks for name, language, voice and an optional available line.
- Agent rows show a native name, assigned line, enabled state and details. Raw
  provider identifiers never appear.
- Clicking the name opens the agent's own page: Instructions, Opening line,
  Voice, Variables, plus call-result health and a test-call action. Variables
  are edited in place, grouped by when in the call they are captured.
- Unsaved edits are kept until saved or discarded, and are marked as not live.
- Broken delivery is described as call results not reaching Resepta and has a
  one-click Fix. Raw webhook language is platform-admin-only.
- Archive hides unused external agents from the picker. Disconnect removes the
  Resepta connection without deleting the external resource.

### Calls

- Calls are paginated and open into recording, summary, why the call ended,
  collected values and the transcript read as a conversation. The contact's
  activity feed shows the same record.
- The immediate call-ended event and later analyzed event merge into one row.
- Failed downstream updates retry invisibly. An exhausted update appears as a
  provider-free warning for the owner and a replayable diagnostic for the
  platform operator.

## 5. Core data model

| Table | Role |
|---|---|
| `orgs` | Business identity, locale, scheduling and message defaults. The one app table without `orgId`. |
| `memberships`, `invites` | Google-account access to orgs. |
| `connections` | Per-org operator-installed provider credentials. Never falls back to another org's deployment secret. |
| `customers`, `contactFields` | Customer identity plus business-defined information and its allowed source. |
| `appointments` | One calendar for manual, phone and external bookings. `nextMessageAt` drives work-proportional reminders. |
| `messages` | Outbound queue and inbound conversation history with retry/dead-letter state. |
| `retellAgents` | Internal provider-to-org mapping and phone-agent health. Provider-specific by design, never salon-facing. |
| `voiceAgentProvisioning` | Durable checkpoints and lease for native agent creation. |
| `voiceAgentVariables` | Resepta-owned variable lifecycle registry. |
| `calls` | One row per phone call with recording, transcript, summary and collected values. |
| `voiceEvents` | Idempotent durable inbox for ended, analyzed and recovery events. |

Any mutation changing an appointment's `startAt`, `status`, reminder stamps or
win-back stamp must call `syncAppointmentSchedule`.

## 6. Operator boundary

`/admin` **does not exist for anybody else** — it renders a 404 rather than
explaining that it is operator-only, because a refusal that explains itself
tells a customer the console is there and invites them to ask for a login.

Its tabs are Setup, Agents, Members and Activity. The platform operator uses it
to:

- install per-org phone-provider, WhatsApp, email and cal.com configuration;
- inspect native phone-agent provisioning checkpoints;
- see provider IDs and raw call-event errors;
- see who can sign in to an org and at which address — sign-in is Google-only,
  so there is no way to find that from the other side;
- replay exhausted phone-call updates; and
- work inside an org when support is required.

The business uses Resepta to create agents, edit instructions and variables,
connect a line, run calls, manage reminders and work its calendar. It should not
need to know which voice provider executes the calls.

## 7. Production exit criteria

- [ ] `npm run typecheck` passes and generated Convex API files are committed.
- [ ] Google OAuth works on the production Convex and frontend origins.
- [ ] Meta webhook signatures are enforced and one pilot WABA has the required
      approved templates.
- [ ] One org creates a new Phone agent from Resepta, receives a real call and
      gets one durable call row plus the later analysis merge.
- [ ] A live-confirmed variable updates an allowed customer field and post-call
      extraction fills only a missing value.
- [ ] Failed call updates and failed messages are visible and replayable from
      the appropriate operator surface.
- [ ] cal.com is either connected and verified end to end, or the pilot is
      explicitly run with the known no-conflict-check limitation.
- [ ] Turkish, English and German UI changes are reviewed together.

## 8. Open product decisions

1. **Operator model:** pure self-serve, partner-operated agency or a hybrid.
2. **WABA ownership:** DECIDED 2026-08-26: the platform acts as Tech Provider.
   One system-user token in platformConfig fronts every hosted number; a
   business with its own Meta app pastes its own token, which always wins.
3. **Template approval:** DECIDED 2026-08-26/27: centrally managed. The Cloud
   wording is platform text (one text per kind per language, the /admin
   Templates tab edits it fleet-wide), which is what keeps Meta approval per
   WABA instead of per client.
4. **Phone-number onboarding:** the app currently assigns existing unclaimed
   lines but does not buy or provision them.
5. **Scheduling activation:** cal.com is the chosen system but still needs a
   real operator playbook and a production pilot.
6. **Voice-quality gate:** noisy Turkish names, dates and numbers require live
   pilot validation even when the software path is correct.
7. **Billing:** intentionally later; pilot businesses can be hand-billed.

## 9. Roadmap

What is deliberately not being worked on, and what is next. A parked item is
finished thinking, not unfinished work: the state below is enough to resume
without re-deriving it.

### Parked

- **Campaigns** (Serdar, 2026-08-27; wrapper already parked 2026-08-26,
  "don't worry about campaign bro"). The lane is BUILT end to end: composer,
  per-run wrapper fill, batched sends with counts, the single card at the
  foot of Otomasyonlar. The one thing between built and live is submitting
  the campaign wrapper template for Meta review: the tr and en rows sit in
  draft, and the fleshed wrapper text (greeting + closing line, the
  fixed-text ratio Meta wants) has been in CAMPAIGN_BODIES since the older
  all-parameter body was refused with "too many variables for its length".
  Un-parking is one per-row Submit on the /admin Templates tab per language,
  then waiting out review. Spend nothing here until Serdar says otherwise.
- **Showcase-number takeover affordance** (offered 2026-08-26, undecided).
  One-click /admin move of the floating showcase number between real
  accounts. Do not build unless he asks.

### Next

- **Two-way memory, voice side** (design agreed 2026-08-27): a
  {{recent_chat}} ring-time variable carrying the customer's recent WhatsApp
  thread, bounded three ways: last 7 days, max 10 messages, ~800 chars total,
  oldest trimmed first. Trim, never summarize (a rolling LLM summary is a
  second artifact that costs money and can be wrong). Chat already reads the
  last 3 calls, so this closes the loop.
- **Meta business verification, then display name → Resepta** (external, at
  Meta, currently pending on Meta's side). The growth axis: it gates hosted
  number count and messaging tiers, which the shared-WABA template play
  depends on. Display name must move before verification completes
  (`subsystems.md` → "Wiring a Meta Cloud number" documents the three-step dance and the PIN).
- **Voice-note recording** in the composer (playback shipped; recording is
  the missing half, and it is why audio stayed out of the media library when
  video went in, 2026-08-27).
- **Voice-side {{rules}} freshness gap** (docs/agent-core.md open list).
