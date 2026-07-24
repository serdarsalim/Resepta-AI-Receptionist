# Randevu

WhatsApp appointment automation for small businesses — salons, barbers,
dentists. One multi-org deployment, self-serve signup, per-business WhatsApp
Cloud API number. Booking confirmations and reminders go out as Meta template
messages; customers confirm or cancel by tapping a reply button.

Working name. Sibling product to Nudge (full automation platform,
instance-per-tenant); Randevu is deliberately small and shared.

## Stack

Next.js (App Router) + Convex + Convex Auth (password) + Tailwind 4.

## Setup

```bash
npm install
npx convex dev --once --configure=new   # provision the Convex project (interactive, once)
```

Env (Convex deployment):

- `WA_WEBHOOK_VERIFY_TOKEN` — the verify token you enter in the Meta app's
  webhook config, pointing at `<convex-site-url>/whatsapp/webhook`.

Per org (entered in Settings → WhatsApp, stored in `waAccounts`): access token,
phone number ID, WABA ID, and approved template names.

## Dev

The user runs the dev servers (`npx convex dev` + `next dev -p 3014`). See
AGENTS.md before writing code — the org-scoping invariant is non-negotiable.
