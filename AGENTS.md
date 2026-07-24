# Randevu — working in this codebase

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
- Self-serve: a salon signs up (email + password via Convex Auth Password
  provider), which creates its org. No invites, no fleet provisioning, no
  operator in the loop.
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
