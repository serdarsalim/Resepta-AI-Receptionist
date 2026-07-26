# Deploying Randevu

Written 26 July 2026, for the first deploy. Nothing here has been run yet — this
is the sequence, not a report.

The state it starts from: `.env.local` points at
`CONVEX_DEPLOYMENT=local:local-randevu-randevu_tr`, there is no `.vercel`
directory, and no Meta, cal.com or Retell webhook has ever reached this code.
Until that changes, a demo cannot happen inside the app, because Retell has no
URL to call.

## The order matters

Both webhook guards **fail open when their env var is missing** and both write
appointments. `retellGuard` skips signature verification entirely when
`RETELL_API_KEY` is unset (`convex/http.ts`), and the Meta webhook does the same
without `WA_APP_SECRET`. So the env vars go on in the same sitting as the deploy,
not the next day. An unsigned POST to a live deployment can create bookings.

## 1. Convex production deployment

```bash
npx convex deploy
```

First run prompts for the production deployment in the `randevu` team. It reads
`convex/schema.ts` and pushes functions. Note the deployment URL it prints —
both the `.convex.cloud` (client) and `.convex.site` (webhooks) forms.

## 2. Set the deployment env vars

Every one of these lives on the **Convex deployment**, never in `.env.local`, and
never per-org (per-org WhatsApp credentials go in Settings → WhatsApp).

```bash
npx convex env set --prod AUTH_GOOGLE_ID <from Google Cloud OAuth web client>
npx convex env set --prod AUTH_GOOGLE_SECRET <same client>
npx convex env set --prod RETELL_API_KEY <Retell dashboard>
npx convex env set --prod WA_APP_SECRET <Meta app secret>
npx convex env set --prod WA_WEBHOOK_VERIFY_TOKEN <any random string, kept>
npx convex env set --prod RESEND_API_KEY <Resend dashboard, API keys>
npx convex env set --prod RESEND_INBOUND_DOMAIN <the domain customers write to>
npx convex env set --prod RESEND_WEBHOOK_SECRET <whsec_… from the webhook you add>
```

`RETELL_API_KEY` and `WA_APP_SECRET` are the two that close the fail-open holes.
`RESEND_API_KEY` is what turns the email lane and the owner alerts on; unset
means alerts are logged and dropped. The domain in each org's `emailFrom` must
also be verified in Resend (DNS: SPF + DKIM records it gives you), or sends come
back 403 and land in the message row's error column.

Inbound email needs two more things beyond the key. `RESEND_INBOUND_DOMAIN` is
the domain customers write TO — one verified domain serves every org, because
routing happens on the LOCAL PART (each org's `inboundAddress`, set in Business
settings). And in Resend, add a webhook for `email.received` pointing at
`<your convex site url>/email/inbound`; the `whsec_…` it gives you is
`RESEND_WEBHOOK_SECRET`. Unset means the route answers 503 and mail is
dropped rather than silently accepted unverified.

Google OAuth redirect URI, added in Google Cloud console:

```
https://<your-deployment>.convex.site/api/auth/callback/google
```

## 3. Vercel project

```bash
npx vercel link
npx vercel env add NEXT_PUBLIC_CONVEX_URL production
npx vercel --prod
```

`NEXT_PUBLIC_CONVEX_URL` is the `.convex.cloud` URL, and it is the only one the
frontend needs. `SettingsView` derives the `.convex.site` webhook addresses from
it by string replacement, so getting this one wrong hands an owner webhook URLs
that silently never fire.

`NEXT_PUBLIC_CONVEX_SITE_URL` exists in the local `.env.local` but **no code
reads it** — don't bother setting it on Vercel. Worth deleting from `.env.local`
so the next person doesn't assume it matters.

## 4. Point the three webhooks at it

All three are `https://<deployment>.convex.site/...`:

| Provider | URL | Configured where |
|---|---|---|
| Meta | `/whatsapp/webhook` | Meta app → WhatsApp → Configuration. Verify token must match `WA_WEBHOOK_VERIFY_TOKEN` |
| cal.com | `/calcom/webhook?token=<per-org>` | Generated per org in Settings → Bookings. Subscribe BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED |
| Retell | `/retell/functions` and `/retell/call-ended` | Retell dashboard, per agent. Settings → Voice prints both |

The cal.com token is per-org and is how a booking resolves to a business —
cal.com's payload carries no tenant identity. Rotating it in Settings
invalidates the old URL.

## 4b. cal.com event type: two settings that are not optional

Both are consequences of Randevu writing to cal.com rather than reading from it.

**Turn OFF cal.com's attendee emails** for the Randevu event type. Randevu owns
every message to the customer — that is the product — and a phone-only walk-in
is booked with a placeholder address (`…@noemail.randevu.app`) that cal.com would
otherwise try to email and bounce. cal.com keeps the calendar; Randevu keeps the
conversation.

**Add duration options covering your service lengths.** Set
`lengthInMinutesOptions` on the event type to include every duration in
Settings → Services (30, 45, 60, 90…). cal.com takes `lengthInMinutes` on a
booking only when the event type declares it, so without this a 90-minute colour
books as the event type's default length and the salon's Google Calendar is
wrong about how long the chair is busy. A resize that cal.com will not accept is
refused with a readable reason rather than moving the block and lying.

## 4c. Backfill staff

One-shot, after the first deploy of the staff table. Turns the old free-text
`staffName` into one row per person per org and links every appointment.

```bash
npx convex run migrations:backfillStaff
```

Idempotent, and it leaves `staffName` in place so a rollback still renders.

## 5. Seed the demo org

`convex/devSeed.ts` already builds a believable business: services, 20 Turkish
customers, a week of appointments in both directions, message history. An empty
appointments app is a bad screen-share.

```bash
npx convex run devSeed:seed
```

Targets the first org unless `orgId` is passed, and refuses to run twice without
`force`. It is dev data — do not point it at an org a real customer uses.

## 6. Smoke test, in this order

Each step is the first live exercise of code that has only ever typechecked.

1. **Sign in with Google.** Confirms the OAuth redirect URI.
2. **Call the Retell number from a phone the app has never seen.** The call
   should appear in the inbox against a new contact. This is the one that used to
   fail silently — the row was written with no `customerId` and the inbox groups
   by customer, so the agent booked and the screen stayed empty.
3. **Ask the agent for availability "tomorrow".** Slots should be tomorrow in the
   org's timezone, not UTC.
4. **Book by voice.** Check the booking appears in cal.com *and* in Randevu, once
   — not twice. The dedupe is by `externalUid`.
5. **Cancel by voice.** Check the slot frees up **in cal.com**, not just in
   Randevu. A failure returns a reason like `calcom-cancel-http-403` to the agent
   rather than going quiet.
6. **Reschedule from cal.com's own confirmation email.** Should move the existing
   appointment, not create a second one.
7. **Tap Confirm on a WhatsApp reminder**, then Cancel on another, and check
   cal.com again.
8. **Message the number outside business hours** with something that isn't
   EVET/İPTAL. Expect one away-reply with the booking link, and only one.
9. **Click an empty slot on the calendar**, book, and confirm the booking appears
   in cal.com with the right *length*, not just the right start.
10. **Drag a block to a new time.** It should move instantly, then stay. Watch
    cal.com: the old slot frees, the new one blocks.
11. **Drag a block onto an occupied slot.** It should snap back with a reason and
    offer "book anyway"; taking that offer should double-book deliberately.
12. **Drag a block's bottom edge.** This is cancel-and-rebook underneath, so
    check cal.com ends up with exactly one booking at the new length.

Write down every step that surprised you. That list is the onboarding script.

## What is not covered

- **No tests exist in this repo.** Step 6 above is the entire regression net.
- Meta template sends need an approved WABA and approved template names entered
  per org. Business verification is the long pole (2–14 days) and blocks the
  reminder path, not the voice path.
- Rollback is `npx convex deploy` from the previous commit plus a Vercel
  promote of the prior deployment. Convex has no one-command rollback; a schema
  change that drops a field is not reversible by redeploying.
