# Port Nudge's template engine into Resepta

Scoped with Serdar on 2 Aug 2026, against real code — paths verified. Build
order: schema + send path → email lane → editor UI → pixel tracking last.
Push as soon as it typechecks; Serdar tests in prod only, Convex deploys on
push.

## Why

Resepta's "Message templates" card is a transcription of Meta's dashboard:
metaName + hand-set approval status, no body anywhere. Email can't send at all
(`ruleChannels` in RemindersView requires a `bodyPreview` nothing can create).
The card also mislabels the winback row as "Reminders" — fix in passing.

## What to port (from /Users/slm/my-portfolio/nudge)

- `convex/templates.ts` (865 lines) + `templates` table in `convex/schema.ts`
  (~line 891). Take: `channel` (whatsapp|email), `subject`, `localizedBodies`
  (per-language body+subject variants), token rendering at send time.
  Leave: triggers, audiences, HubSpot metadata (types/courses/countries),
  media library, send-stats denormalization.
- Email open tracking: `messages.recordEmailOpen` + pixel route. Serdar wants
  it. Caveat agreed: Apple/Gmail prefetch inflates opens — show rates on
  campaign/winback templates only, never per-customer "opened" badges.
- Nudge has TWO WhatsApp lanes: Cloud API (Meta-approved templates) and
  Evolution native instance (free-form, no approval). Resepta already has the
  Evolution lane (ShopPhoneCard, admin-provisioned) BUT convex/evolution.ts is
  provisioning/status/qr only — NO send function exists. The port must add
  the Evolution send (copy from Nudge's send path) and route reminder/
  confirmation sends through it when the instance is linked. Bodies sent via
  Evolution need NO Meta approval — that's what makes authored-in-Resepta
  bodies viable. metaName+status survive only for the Cloud API lane, demoted
  to a technical detail row shown only when that lane is active.

## Copy agreed with Serdar

Salon never sees vendor words (Evolution, Cloud API, Meta Business Manager).
Lane surfaces as one status line per template:

- Shop phone linked: en "Sends from your shop phone." /
  tr "Dükkan telefonunuzdan gönderilir." /
  de "Wird von Ihrem Betriebstelefon gesendet."
- Cloud only: en "Sends from your WhatsApp Business number. The wording needs
  Meta's approval first." / tr "WhatsApp Business numaranızdan gönderilir.
  Metnin önce Meta onayından geçmesi gerekir." / de "Wird über Ihre
  WhatsApp-Business-Nummer gesendet. Der Text braucht zuerst Metas Freigabe."
- Neither: reuse existing amber "We handle the WhatsApp setup — get in touch."

Channel column in the rules table stays plain "WhatsApp · Email" — lanes are
plumbing, never shown there.

## Resepta integration points

- `convex/schema.ts` — extend existing `templates` table (kind, language,
  metaName, status, bodyPreview today).
- `convex/wa.ts` — `sendAppointmentMessage` is the send path; wire the email
  lane to render authored bodies; org.emailFrom gates email.
- Token vocabulary: reuse Resepta's voice-variable names (customer name,
  appointment time, service, business name) — NOT Nudge's token names. One
  vocabulary across screens is a hard rule.
- Editor UI replaces the name/status rows in `src/components/RemindersView.tsx`
  (now a flat page, no tabs). AGENTS.md rule: port from Nudge by copy.

## Context from 2 Aug (already shipped, don't redo)

- Voice agent: capture variables MUST land in a contact field or customer
  column (firstName/lastName/email) — call-only capture is validator-rejected.
  First/Last name are separate variables; the agent splits, code never does.
- check_availability falls back to Resepta's own appointments when no cal.com;
  voiceBook rejects overlapping slots and past/far-future dates.
- Hours moved to Business → Hours; Reminders is flat; WhatsApp credentials
  are /admin-only (salon UI shows a read-only connected line).
- Standing rules: one vocabulary across screens (agent variable labels ==
  Business field labels); no invisible orphan data; prod-only testing.
