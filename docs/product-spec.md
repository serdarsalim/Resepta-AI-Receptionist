# Randevu production spec

Last reconciled with the shipped product: 31 July 2026.

## 1. Product

Randevu is an AI front desk for appointment businesses, starting with salons,
barbers, dentists and clinics in Türkiye. One shared, multi-org deployment gives
each business a phone receptionist, customer records, appointments, WhatsApp
confirmations and reminders, an inbox and a calendar.

- **Business owner:** the phone and customer messaging are handled, bookings
  land in one calendar, and customer details stay current.
- **Automation partner:** install the customer's external accounts once, then
  let the business configure and operate its own front desk in Randevu.
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
  in Randevu. No conflict check runs, so double-booking is possible.
- Walk-in entry remains native to Randevu. `appointments.source` distinguishes
  manual, voice and external bookings.
- Blocked time is not modelled. Do not create fake-customer appointments for
  breaks; revisit the cal.com availability decision before adding closures.

### Messaging

- WhatsApp production delivery uses the Meta Cloud API lane.
- Business-initiated confirmation, reminder, win-back and campaign sends use
  approved Meta templates.
- Customer language resolves from the customer first, then the org. Missing
  template language fails visibly; Randevu never falls back to the wrong
  language.
- Inbound WhatsApp resolves the org from Meta's phone-number ID, never from the
  customer's number alone.
- Delivery is queued with retries and dead-lettering. `messages.applySendResult`
  is the one authority for final send outcomes.
- Email delivery and inbound email use Resend. Each org has its own sender and
  inbound local part on a deployment-wide verified domain.

### Phone agent

- Randevu is the phone-agent control plane. The execution provider is hidden
  from salon users.
- The owner can create a native appointment receptionist or connect an existing
  agent from **Phone agent → Add agent**.
- New agents start from a versioned Randevu template and can speak Turkish,
  English or German.
- Randevu owns Instructions, Variables, runtime tools, call history and customer
  writes. Provider configuration is compiled output.
- A variable is declared once across before-call context, live collection,
  post-call fallback and storage destination.
- Signed call events first land in a durable inbox, then update the call and
  customer with retries. Live caller-confirmed values beat transcript
  inference; post-call analysis only fills missing customer data.
- Randevu can assign an unclaimed line but does not purchase phone numbers.

See [`phone-agent.md`](phone-agent.md) for the full architecture and operator
runbook.

## 3. Shipped product surface

The signed-in sidebar is:

1. **Customers**: customer table, custom information fields and history.
2. **Inbox**: WhatsApp and email conversation work.
3. **Campaigns**: approved-template outreach.
4. **Phone agent**: Agents and Calls in one destination.
5. **Reminders**: reminder rules, templates and WhatsApp connection.
6. **Calendar**: Day, Week, Month, Year and List views plus manual booking.
7. **Revenue**: feature-flagged takings view.
8. **Business**: business facts, services, people, fields and AI connectors.

There is no Settings destination. Do not reintroduce it. Configuration belongs
next to the work it controls, while operator-only credentials live in `/admin`.

The app UI dictionary supports Turkish, English and German. Customer-facing
message language is a separate per-customer/per-org decision.

## 4. Phone-agent user experience

### Agents

- **Add agent** and the icon-only refresh action sit outside the agents table.
- Add agent opens a sheet with **Create new** as the default and **Connect
  existing** as the second path.
- Create new asks for name, language, voice and an optional available line.
- Agent rows show a native name, assigned line, enabled state and details. Raw
  provider identifiers never appear.
- Clicking the name opens Instructions, Variables, call-result health and a
  test-call action.
- Broken delivery is described as call results not reaching Randevu and has a
  one-click Fix. Raw webhook language is platform-admin-only.
- Archive hides unused external agents from the picker. Disconnect removes the
  Randevu connection without deleting the external resource.

### Calls

- Calls are paginated and include recording, summary, transcript and collected
  values.
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
| `voiceAgentVariables` | Randevu-owned variable lifecycle registry. |
| `calls` | One row per phone call with recording, transcript, summary and collected values. |
| `voiceEvents` | Idempotent durable inbox for ended, analyzed and recovery events. |

Any mutation changing an appointment's `startAt`, `status`, reminder stamps or
win-back stamp must call `syncAppointmentSchedule`.

## 6. Operator boundary

The platform operator uses `/admin` to:

- install per-org phone-provider, WhatsApp, email and cal.com configuration;
- inspect native phone-agent provisioning checkpoints;
- see provider IDs and raw call-event errors;
- replay exhausted phone-call updates; and
- work inside an org when support is required.

The business uses Randevu to create agents, edit instructions and variables,
connect a line, run calls, manage reminders and work its calendar. It should not
need to know which voice provider executes the calls.

## 7. Production exit criteria

- [ ] `npm run typecheck` passes and generated Convex API files are committed.
- [ ] Google OAuth works on the production Convex and frontend origins.
- [ ] Meta webhook signatures are enforced and one pilot WABA has the required
      approved templates.
- [ ] One org creates a new Phone agent from Randevu, receives a real call and
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
2. **WABA ownership:** each business owns its Meta account, or the partner acts
   as a Tech Provider.
3. **Template approval:** per-business templates versus centrally managed
   approvals if the partner owns WABA infrastructure.
4. **Phone-number onboarding:** the app currently assigns existing unclaimed
   lines but does not buy or provision them.
5. **Scheduling activation:** cal.com is the chosen system but still needs a
   real operator playbook and a production pilot.
6. **Voice-quality gate:** noisy Turkish names, dates and numbers require live
   pilot validation even when the software path is correct.
7. **Billing:** intentionally later; pilot businesses can be hand-billed.
