# Randevu

Randevu is an AI front desk for appointment businesses such as salons,
barbers, dentists and clinics. One multi-org deployment gives each business a
native phone agent, customer records, appointments, WhatsApp confirmations and
reminders, an inbox and a working calendar.

The phone agent can be created or connected from Randevu, follows the
business's instructions, reads and updates configured customer information and
writes call results back durably. The current voice provider is intentionally
hidden from salon users. WhatsApp business-initiated messages use approved Meta
templates, and customers can confirm or cancel by reply.

cal.com is the intended availability system, but it is not assumed to be
connected. Without an org API key and event type, Randevu can still hold manual
and phone-created appointments but does not prevent double-booking.

The app UI supports Turkish, English and German. Customer-facing message
language resolves per customer, then falls back to the business language.

## Stack

Next.js App Router, React, Convex, Convex Auth with Google OAuth, Tailwind CSS
and TypeScript.

## Local setup

```bash
npm install
npx convex dev --once --configure=new
```

Copy `.env.example` into the environment used by the local Convex and Next.js
processes, then add the Google OAuth values to the Convex deployment. The user
runs the development servers:

```bash
npm run dev
```

This starts the frontend at [http://localhost:3006](http://localhost:3006) and
the Convex backend together. Run `npm run dev:backend` and
`npm run dev:frontend` separately when one process needs its own terminal.

## Configuration boundaries

- Deployment-level secrets include Google OAuth, Meta webhook verification,
  Resend and the platform-admin email allowlist.
- WhatsApp account credentials and approved template names are per business.
  The business manages its messaging rules under **Reminders**.
- Phone-provider credentials are per business and installed once by the
  platform operator at `/admin`. They are never shown to the salon owner.
- cal.com credentials are per business and operator-managed in platform admin.

There is no deployment-wide voice-provider key fallback. Each agent is resolved
to its org before that org's credential is used, which prevents one customer's
provider account from becoming visible to another.

## Read before changing the app

- [`AGENTS.md`](AGENTS.md): invariants, current IA and product decisions.
- [`docs/wwsd.md`](docs/wwsd.md): the design decision model.
- [`docs/product-spec.md`](docs/product-spec.md): current product scope and
  shipped-state summary.
- [`docs/phone-agent.md`](docs/phone-agent.md): phone-agent architecture,
  variable lifecycle and operator runbook.
- [`docs/deploy.md`](docs/deploy.md): deployment, integration and smoke-test
  checklist.

The critical engineering invariant is unchanged: every app table except `orgs`
and the auth tables carries `orgId`, and every query is scoped to the caller's
org. Run `npm run typecheck` before every commit.
