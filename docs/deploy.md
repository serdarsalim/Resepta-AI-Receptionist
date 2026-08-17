# Deploying and operating Resepta

Last reconciled with the implementation: 31 July 2026.

This is the current production runbook. The phone-agent-specific setup and
recovery paths are expanded in [`phone-agent.md`](phone-agent.md).

## 1. Pre-deploy checks

Run the same check required before every commit:

```bash
npm run typecheck
```

`convex/_generated` is checked in. A backend change that adds or renames a
function or table must include the regenerated files before Vercel builds the
frontend.

## 2. Deploy Convex

```bash
npx convex deploy
```

Keep both URLs from the target deployment:

- `https://<deployment>.convex.cloud` is the application API URL.
- `https://<deployment>.convex.site` is the HTTP-action URL used by OAuth,
  webhooks and the private phone-agent runtime.

The hosted Convex deployment supplies `CONVEX_SITE_URL` to backend functions.
Native phone-agent creation stops with `deployment-site-url-missing` if the
backend cannot determine its own HTTP origin.

## 3. Convex deployment environment

Set deployment-wide values on the target Convex deployment, not in a checked-in
file:

```bash
npx convex env set --prod AUTH_GOOGLE_ID <Google OAuth web client id>
npx convex env set --prod AUTH_GOOGLE_SECRET <Google OAuth web client secret>
npx convex env set --prod PLATFORM_ADMIN_EMAILS <comma-separated operator emails>
npx convex env set --prod WA_APP_SECRET <Meta app secret>
npx convex env set --prod WA_WEBHOOK_VERIFY_TOKEN <random retained value>
npx convex env set --prod RESEND_API_KEY <Resend API key>
npx convex env set --prod RESEND_INBOUND_DOMAIN <shared inbound email domain>
npx convex env set --prod RESEND_WEBHOOK_SECRET <Resend whsec value>
npx convex env set --prod SITE_URL <public Resepta app origin>
```

Optional:

```bash
npx convex env set --prod DEMO_ORG_ID <demo org id>
```

Only set `DEMO_ORG_ID` after the target org has `demoMode` enabled and has no
real messaging credentials. With it unset, anonymous demo sign-in is not
registered and Google is the only auth provider.

The production demo origin is `https://demo.resepta.xyz`. It serves `/demo` to
signed-out visitors and the normal app root after anonymous sign-in. Point it
at the same Vercel project as `resepta.xyz`; the data boundary is the isolated
demo org, not a second frontend deployment.

The Google Cloud authorized redirect URI is:

```text
https://<deployment>.convex.site/api/auth/callback/google
```

`WA_APP_SECRET` is required, not just in production: the Meta route returns 503
without it. It used to log a warning and process unsigned payloads, so a
deployment that forgot the variable had a forgeable endpoint reaching contact
creation, the 24-hour session window and appointment cancellation.

The Evolution lane has no HMAC of its own, so its endpoint is authenticated by a
per-org token in the URL — the same shape cal.com uses. Generate it per org from
the WhatsApp (Evolution API) panel in `/admin/<org>` and paste the URL into
Evolution's webhook settings; until it exists that route refuses every call.
The instance name is now only a label, checked against the payload, and is no
longer what identifies the tenant.

The phone-agent routes have no equivalent deployment-wide key: they resolve the
agent to an org, require that org's provider key and fail closed if the key or
signature is missing.

`RESEND_API_KEY` enables customer email and owner alerts. The From domain used
by an org must be verified in Resend. `RESEND_INBOUND_DOMAIN` is the one shared
domain customers write to; routing happens on each org's local part.

## 4. Deploy the frontend

Set these Vercel values for the target environment:

```bash
npx vercel link
npx vercel env add NEXT_PUBLIC_CONVEX_URL production
npx vercel env add NEXT_PUBLIC_CONVEX_SITE_URL production
npx vercel --prod
```

- `NEXT_PUBLIC_CONVEX_URL` is the `.convex.cloud` URL.
- `NEXT_PUBLIC_CONVEX_SITE_URL` is the matching `.convex.site` URL.

The client can derive the second URL in hosted Convex, but setting it explicitly
prevents a deployed screen from displaying a loopback URL left over from local
development.

## 5. External endpoints

All endpoints below use the production `.convex.site` origin:

| Integration | Endpoint | Setup |
|---|---|---|
| Meta WhatsApp | `/whatsapp/webhook` | Configure in the Meta app. The verification token must equal `WA_WEBHOOK_VERIFY_TOKEN`. |
| Resend inbound | `/email/inbound` | Subscribe a Resend webhook to `email.received`; store its signing secret as `RESEND_WEBHOOK_SECRET`. |
| cal.com | `/calcom/webhook?token=<org token>` | Operator-only per-org setup. Subscribe to created, rescheduled and cancelled booking events. |
| Phone agent | `/retell/inbound`, `/retell/functions`, `/retell/mcp`, `/retell/call-ended` | Resepta publishes these automatically when an agent is created, connected or fixed. Never ask a salon owner to copy them. |

The cal.com token is how an inbound booking resolves to an org because the
payload does not carry tenant identity. A missing or unknown token is rejected.
cal.com API keys and event-type IDs are installed per org in platform admin;
they are not salon-facing settings.

For cal.com event types used by Resepta:

- disable cal.com's attendee emails so Resepta remains the customer-messaging
  owner; and
- include every service duration in the event type's duration options so a
  90-minute service does not occupy only the default slot length.

## 6. Per-org onboarding

Open `/admin` as an email in `PLATFORM_ADMIN_EMAILS`, then choose the org.

1. Install the org's phone-provider API key under Voice. There is no shared
   fallback key.
2. Install cal.com API and event-type values if verified availability and
   collision prevention are required.
3. Install the Meta account values and confirm the approved message-template
   names in the org's Reminders experience.
4. Install outbound/inbound email addresses if the email lane is part of the
   customer setup.
5. Provision an inbound phone line externally if needed. Leave it unassigned
   so the org owner can select it while creating a Phone agent. Resepta does
   not buy numbers.
6. Let the org owner create the appointment receptionist under
   **Phone agent → Add agent**. Connecting an existing agent is the second path.

Platform admin shows native-creation checkpoints, runtime connection state,
the latest call events and raw failed-event diagnostics. Salon-facing screens
show only provider-free health and a Fix action.

## 7. Demo data

`convex/devSeed.ts` builds a sample business with customers, appointments and
message history:

```bash
npx convex run devSeed:seed
```

It targets the first org unless `orgId` is passed and refuses to run twice
without `force`. Never seed an org used by a real customer.

## 8. Production smoke test

Run these against a dedicated test org before onboarding a customer:

1. Sign in with Google and finish the business-name gate.
2. From platform admin, install the org's phone-provider key.
3. In the org, create a new Phone agent without a line. Confirm the setup
   survives a refresh and opens the native Instructions and Variables sheet.
4. Create or connect an agent with an unclaimed line and place a call from an
   unknown E.164 number.
5. Confirm one customer and one call row appear. The same call must gain its
   summary and extracted values later, not become a second call.
6. Configure one variable for live confirmation and one for post-call recovery.
   Confirm the live value wins and post-call analysis only fills a missing
   customer field.
7. If cal.com is connected, ask for availability, book, reschedule and cancel;
   verify both systems agree. If it is not connected, confirm the agent does
   not claim a time was checked.
8. Send a WhatsApp confirmation/reminder and exercise Confirm and Cancel.
9. Send an inbound email and confirm it attaches to the correct customer in
   the correct org.
10. Move and resize calendar appointments and verify external scheduling when
    cal.com is configured.

Do not use **Fix** from a development deployment on an agent shared with
production. One agent can publish only one call-result URL, so development
would take the events away from production.

## 9. Recovery and rollback

- Failed phone-agent call updates retain their signed payload in `voiceEvents`.
  Use **Retry failed updates** in platform admin to replay them.
- Retrying outbound messages remain `queued`; exhausted sends become failed and
  are visible in fleet health.
- Promote the prior Vercel deployment for a frontend rollback.
- Deploy the prior code commit to Convex for a backend rollback. Convex does not
  offer a one-command schema rollback, so destructive schema changes require a
  forward repair plan.

There is currently no automated regression suite in `package.json`; the
TypeScript check and the smoke test above are the release gate.
