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

### Phase C — voice receptionist (the fonio core)
- **Retell agent per org:** `retellAgents` table (agentId, voice, language,
  greeting, transfer number, inbound number). Nudge's Retell integration is the
  prior art (REST direct with `RETELL_API_KEY`).
- **Inbound flow:** number → Retell agent → function calls into Randevu:
  `check_availability(date)` → free slots from the availability model,
  `book_appointment(name, phone, service, slot)` → same `appointments` insert
  path as every other channel (source `"voice"`), `cancel/reschedule` by phone
  lookup, `transfer_to_human` → org's transfer number.
- **Post-call:** webhook → call row (transcript, summary, outcome, recording
  URL) + optional WhatsApp confirmation to the caller (booking confirmations
  are template sends — same lane as everything else).
- **Calls tab:** list with outcome badges, transcript drawer, recording player.
- **RISK (validate before building):** Turkish inbound numbers. Retell's
  number inventory is US-centric; TR numbers likely need a local SIP trunk
  (Netgsm/Bulutfon) bridged via Retell SIP. Partner should confirm the
  provisioning path for ONE real number before this phase starts. Turkish
  voice quality on ElevenLabs/Retell also needs a listen test.

### Phase D — calendar & availability
- **In-app availability model:** org working hours + per-staff schedules +
  service durations → slot computation (feeds both the voice agent and a
  booking UI).
- **cal.com two-way** (API, not just webhooks) OR native Google Calendar sync —
  decide when a pilot org actually asks; webhook intake stays regardless.
- **Public booking page** (`/b/<org-slug>`): mobile-first, Turkish, books
  straight into availability. This replaces cal.com for orgs that don't have it.

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
3. TR inbound number provisioning path confirmed (Phase C gate).
4. Pricing intent (affects nothing until Phase E, informs partner pitch now).
5. fonio.ai account walkthrough if possible — screenshots of their onboarding
   would sharpen Phase C scope.
