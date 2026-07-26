# Randevu — production spec (v1)

**Product:** AI front desk for appointment businesses (salons, barbers, dentists,
clinics) in Türkiye first. Fonio-parity target: the AI answers the business's
phone, books appointments, and runs the WhatsApp side — confirmations,
reminders, replies. One multi-org deployment, self-serve signup, partner-assisted
onboarding at scale.

**Decided:** 2026-07-25 (Serdar): full fonio.ai parity as the target; spec-first,
then sustained implementation. Working name Randevu; brand green; Google-only
auth; cal.com as external booking intake; Evolution API parked (dedicated-number
strategy documented in session notes, revisit post-launch).

---

## 1. The product in one sentence per audience

- **Salon owner:** "Your WhatsApp and your phone answer themselves — bookings
  land in your calendar, customers get reminded, no-shows drop."
- **Partner (reseller):** provision a salon in minutes: connect a number, pick a
  voice, hand over a login.
- **Us:** one Convex deployment, org-scoped everything, three channels (voice /
  WhatsApp / manual UI) writing into one appointments table.

## 2. Feature ladder (build order)

### Phase A — production foundation (no new product surface)
- **Multi-user orgs:** invites table + join flow (port Nudge's invite gate:
  owner enters email → that address's Google sign-in joins the org as `staff`
  instead of creating a new org). Team card in Settings: members list, pending
  invites, revoke; owner-only.
- **Prod deployment:** Convex prod deployment in team `randevu`, Vercel project,
  domain (needs Serdar: name + DNS), env promotion checklist, `_generated`
  committed, deploy script (`predeploy` typecheck).
- **Webhook hardening:** Meta `X-Hub-Signature-256` verification (env
  `WA_APP_SECRET`), cal.com secret header check, Retell webhook signature.
  All three fail-closed in prod, fail-open in dev with a console warning.
- **State completeness:** every view gets loading / empty / error states;
  mutations get inline error surfaces (no silent catch); mobile pass on every
  screen; Turkish + English copy reviewed together.
- **Theme preference on the user row** (`users.themePreference`, port from
  Nudge) so appearance follows the account across devices.
- **Ops:** basic health query + failure surfacing (failed sends count on the
  Messages tab badge), Convex log-based alerting hook for dead sends.

### Phase B — WhatsApp lane complete
- **Template sends live end-to-end** on one pilot org (needs Serdar/partner:
  WABA + approved `randevu_onay` / `randevu_hatirlatma` templates).
- **Conversations inbox:** per-customer thread view (messages table already
  two-way); session replies from the UI inside the 24h window (`sendWaCloudText`
  exists); template-only nudge outside the window.
- **No-show winback** (v2 of reminders): optional template X days after a
  `no_show`, org toggle, same scheduler pattern.
- **Quiet hours:** org-level send window for reminders (Türkiye default
  09:00–21:00); the tick already stamps offsets, it just holds dispatch.
- **Email connector: BUILT (2026-07-25), delivery direct to Resend** (the n8n
  hop was dropped 2026-07-26 — it forwarded one HTTP POST to another and bought
  no retry or routing we used). Deployment env `RESEND_API_KEY` + per-org
  `orgs.emailFrom` on a Resend-verified domain; sends ride alongside
  WhatsApp whenever the customer has an email, using the template row's text
  (no Meta approval applies to email). Channels attempt independently — an
  unconfigured WhatsApp no longer blocks the email.
- **Evolution API lane: probable-later, NOT in v1** (Serdar, 2026-07-25).
  When it lands it's a second provider on the send path (dedicated-number
  strategy per the session notes), mirroring Nudge's per-number provider
  branch. Nothing in Phase B may assume wa_cloud is the only provider —
  keep the branch point.

### Phase C — voice receptionist (the fonio core)
- **Retell agent per org:** `retellAgents` table (agentId, voice, language,
  greeting, transfer number, inbound number). Nudge's Retell integration is the
  prior art (REST direct with `RETELL_API_KEY`).
- **Inbound flow — DECIDED: agent routes through Randevu, not cal.com
  directly.** Number → Retell agent → custom function calls into Randevu's
  Convex HTTP endpoints → our cal.com adapter. Rationale: the agent needs
  OUR data (caller recognition by phone, the caller's existing appointments
  for cancel/reschedule, consent state) and every function call must be
  logged on our side for debugging; cal.com only knows slots. Functions:
  `check_availability(date)` → cal.com slots API via org's key;
  `book_appointment(name, phone, service, slot)` → cal.com booking API, echo
  deduped by externalUid, source `"voice"`; `cancel/reschedule` by phone
  lookup in OUR appointments table; `transfer_to_human` → org's transfer
  number.
  **Exception:** the week-one Turkish test call uses Retell's NATIVE cal.com
  tools (zero code) purely to validate voice quality and flow — production
  never ships on the native tools.
- **Post-call:** webhook → call row (transcript, summary, outcome, recording
  URL) + optional WhatsApp confirmation to the caller (booking confirmations
  are template sends — same lane as everything else).
- **Calls tab:** list with outcome badges, transcript drawer, recording player.
- **Numbers: DECIDED (2026-07-25, Serdar) — TR numbers come in via SIP trunk
  to Retell.** Serdar owns provisioning. The agent/number management layer is
  a PORT of Nudge's Retell subsystem (`retellAgentNumbers`: agent-first model,
  number pinning, hourly binding sync, working-hours clamp) — reuse, don't
  redesign.
- **Availability: DECIDED (2026-07-25, Serdar) — cal.com IS the scheduling
  system.** No in-app availability model. The voice agent's
  `check_availability` calls cal.com's slots API and `book_appointment`
  creates the booking via cal.com's API (per-org API key + event type in
  Settings → Bookings); the booking echoes back through our existing webhook
  and the upsert-by-externalUid already dedupes it. cal.com owns working
  hours, staff schedules, collisions, and Google Calendar sync.
- **Remaining voice risk — Turkish call quality:** fonio works because German
  ASR/TTS is excellent. Turkish speech recognition with noisy salon callers
  (names, dates, phone numbers spoken aloud) is the product-quality gate. Do a
  scripted Turkish test call in week one of Phase C, before building the tab.

### Phase D — deeper cal.com integration (shrunk: cal.com is the scheduler)
- Per-org cal.com API key + event-type mapping UI (entered in Settings →
  Bookings alongside the webhook URL; validated with a live slots call).
- Booking page = the org's cal.com hosted page; we surface/QR the link in
  Settings rather than building our own (revisit only if pilot orgs reject
  cal.com's page).
- In-app "next free slots" preview on the Appointments tab (read-only, via the
  org's API key) so staff quote availability without leaving Randevu.
- **Onboarding dependency (partner playbook):** every org needs a cal.com
  account + event type before voice booking works. This is a provisioning
  step, not code — belongs in the partner's setup checklist next to WABA.

### Phase E — parity extras
- Multi-language voice agents (agent language per org).
- Dashboard: bookings/week, no-show rate, calls answered, response times.
- Billing (iyzico or Stripe TR) — deliberately last; pilot orgs are hand-billed.

## 3. Data model deltas

| Table | Change |
|---|---|
| `invites` | NEW: orgId, email, role, invitedBy, acceptedAt?, acceptedUserId? — index by_email, by_org |
| `users` | + `themePreference` |
| `orgs` | + `workingHours` (per-weekday ranges), + `quietHours`, + `transferNumber?`, + `slug?` (booking page) |
| `retellAgents` | NEW (Phase C): orgId, retellAgentId, inboundNumber, voice, language, greeting |
| `calls` | NEW (Phase C): orgId, customerId?, direction, startedAt, durationSec, outcome, summary, transcript, recordingUrl, appointmentId? |
| `appointments.source` | widen: `"manual" \| "calcom" \| "voice" \| "booking_page"` |
| `services` | + `priceMinor?` (booking page display) |

Auth change (Phase A, subtle): `createOrUpdateUser` checks `invites` by email
FIRST — match → join that org as invited role; no match → create new org
(current behavior). Same shape as Nudge's gate, minus the bootstrap-admin list.

## 4. Screen inventory (each ships with loading/empty/error/mobile states)

1. Sign-in (Google, language toggle) — exists, polish only.
2. Onboarding gate (business name → working hours next) — extend.
3. Appointments (day-grouped list, quick-add, status actions) — exists; add
   filters (status), week nav, per-appointment message history drawer.
4. Customers (list, consent, add/edit) — exists; add detail drawer with thread
   + appointment history.
5. Conversations (Phase B) — NEW.
6. Calls (Phase C) — NEW.
7. Settings: Business / Team (Phase A) / Reminders / WhatsApp / Templates /
   Bookings / Voice agent (Phase C) — RowLabel grid, autosave, InfoTips.
8. Public booking page (Phase D) — NEW, unauthenticated.

## 5. Production checklist (Phase A exit criteria)

- [ ] Convex prod deployment + Vercel project + domain, deploy documented in README
- [ ] All three webhooks signature-verified in prod
- [ ] Invite flow: second user joins org, staff role enforced (owner-only:
      Settings mutations, invites, WhatsApp credentials)
- [ ] `npx tsc --noEmit` green; every view has all four states; tr+en complete
- [ ] Pilot org live with real WABA credentials and approved templates
- [ ] Failure visibility: failed sends surface in UI within one cron cycle

## 6. Needs Serdar / partner (not blockable by code)

1. Domain name for the product.
2. WABA path for pilot org #1 (Meta Business verification + 2 template approvals).
3. ~~TR inbound numbers~~ — DECIDED: SIP trunk into Retell, Serdar provisions.
4. Pricing intent (affects nothing until Phase E, informs partner pitch now).
5. fonio.ai account walkthrough if possible — screenshots of their onboarding
   would sharpen Phase C scope.
