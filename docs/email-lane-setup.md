# The email lane needs three env vars, and prod has none of them

Found 2 Aug 2026 while wiring the template port. Recorded here rather than in
`.remember/` because that file keeps getting truncated.

## What is actually wrong

Email is fully built and has never sent anything from production.

```
$ npx convex env list --prod        # expert-poodle-803, getrandevu.vercel.app
SITE_URL=https://getrandevu.vercel.app
```

That is the whole list. No `RESEND_API_KEY`, so `emailLaneConfigured()` in
[`convex/lib/email.ts`](../convex/lib/email.ts) returns false and every send
path skips: appointment reminders, campaign mail, the composer, team invites,
and the owner's own failed-send alerts. Nothing errors. Nothing is logged where
a salon would see it. It simply does not happen.

Dev is no better — `RESEND_INBOUND_DOMAIN=mail.example.com` is the literal RFC
placeholder domain (it is what renders as `@mail.example.com` under Incoming
email address on the Business page), `RESEND_WEBHOOK_SECRET` is base64 of
"testsecretforlocalverify", and there is no API key there either.

## The fix: /admin, no terminal needed

Set it in the operator console — **/admin → Email (Resend)** — on each
deployment. Four fields: API key, sending domain, inbound webhook secret,
product name. They are stored in `platformConfig` and read in preference to
the env vars, which remain as a fallback.

Needs a Resend account and a domain verified there. A subdomain is the
convention, so customer mail and the app's own domain do not share a sending
reputation: `mail.example.com`. Until Randevu has its own domain, pointing this
at an already-verified sibling domain works — set the product name to match so
the invites and alerts do not sign themselves with the wrong name.

The webhook secret is only for INBOUND mail (customer replies landing in the
Inbox via `/email/inbound`). Outbound works without it.

The env vars still work if you prefer them, and the console shows which values
are coming from the environment rather than a row:

```bash
npx convex env set RESEND_API_KEY re_xxxxxxxx --prod
```

In Resend itself: verify the domain (DKIM + SPF records), and point an inbound
route at `https://expert-poodle-803.convex.site/email/inbound` with the signing
secret above.

## What the code already does, so nothing else is needed

As of `60255be` a salon needs no DNS of its own. `customerSender()` resolves the
From address in three tiers:

1. `orgs.emailFrom` — the salon's own verified domain, if they ever set one up.
2. `<inboundAddress>@RESEND_INBOUND_DOMAIN` — the address they already have.
   From and Reply-To match, so a customer hitting reply lands in the Inbox.
3. `noreply@RESEND_INBOUND_DOMAIN` — for a salon that has set nothing at all.

`productSender()` is `Randevu <noreply@RESEND_INBOUND_DOMAIN>` and carries mail
Randevu writes to the owner: invites and alerts.

So the moment those two variables exist on prod, email works for every org
without anyone touching a salon's settings.

## How to tell it worked

1. Book an appointment for a customer who has an email address, with the org's
   send channel on Email or Both. The Fleet page should stop showing the amber
   "no email lane" banner as soon as the key is saved.
2. The message row appears in that customer's thread with kind `email_*`. Status
   `sent` means Resend accepted it; `failed` puts the provider's own reason in
   the row, which is usually `email-http-403` for an unverified domain.
3. Reply to the mail. It should appear in the Inbox thread — that is the
   webhook secret and the inbound route working.
4. Win-back and campaign mail carries the open pixel; opening one should tick
   the rate on the win-back template in Reminders after ~15 seconds (hits
   inside that window are dropped as relay prefetch).
