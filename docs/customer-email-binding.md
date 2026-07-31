# Binding a customer to their email address

**Status:** scoped, not started. Rewritten 2026-07-27 after narrowing the scope.
**Read first:** [`AGENTS.md`](../AGENTS.md), then this whole file before touching code.

---

## Which email this is about

There are two unrelated "email" problems in this product. This doc is only
about the second one.

**The salon's own address is already settled.** `orgs.inboundAddress` is what
customers write to, `orgs.emailFrom` is what goes out, one of each per org.
Staff sign in with Google and there can be five of them, but a login address is
not a sending address and never becomes one — a five-chair salon still has one
or two real mailboxes, not five. More addresses per org is a someday feature,
not this one. Nothing here touches it.

**This doc is about the customer's address**: the one Ayşe writes to the salon
*from*.

## The problem

A salon has Ayşe on file with her phone and her personal Gmail. She emails
about a colour appointment from her work address.

`email.recordInbound` matches the From address against `customers.email`, finds
nothing, and creates a second customer — `phone: ""`, no consent, her work
address. The salon now has two Ayşes. WhatsApp history on one, the email thread
on the other, neither record showing the whole person. Nobody notices until
someone opens the wrong one.

## What already works — don't rebuild it

Inbound email → customer binding exists and is mostly right:

| Piece | Where |
|---|---|
| Org resolved from the To address's local part | `email.orgByInboundAddress`, `http.ts` inbound route |
| Webhook signature verified (Svix/Resend) | `lib/emailInbound.ts` `verifyResendSignature` |
| Body fetched separately (Resend sends metadata only) | `lib/emailInbound.ts` `fetchReceivedEmail` |
| Customer matched on the From address | `email.recordInbound`, [`email.ts:68`](../convex/email.ts) |
| Unknown sender still gets a record | same, [`email.ts:83`](../convex/email.ts) |
| Thread grouping across `Re:`/`Yn:` | `normalizeSubject` |
| Dedupe on Resend's `emailId` | `messages.by_email_id` |

Transport, routing and threading are fine. What's missing is an identity model.

---

## The decision: phone and email are both unique, phone wins ties

One email per customer. No second table, no address list.

- **Both fields are unique within an org.** No two customers share a phone, no
  two share an email. Phone already works this way — `customers.create` throws
  `phone-exists` and `update` refuses a taken number. Email gets the same
  treatment, same error shape (`email-exists`).
- **Either one is enough.** At least one of the two must be present. Somebody
  who phones in is never asked for an email, and a stranger who emails in still
  gets a record.
- **Phone wins a tie.** A form arrives with a phone on Ayşe and an email on
  Zeynep. Match the phone, leave the email alone, don't try to be clever. Phone
  is the channel that actually sends and the one we validate, so it's the
  stronger key. This case only exists *because* both fields are unique.
- **Email is the fallback lookup**, used when there's no phone match to be had:
  an inbound email, or a form filled in with an address and no number.

### Why phone is primary

Every path that creates a customer already has a phone — voice, WhatsApp,
cal.com, the public form, staff typing. Inbound email is the single exception.
So phone is effectively mandatory by circumstance, and the schema shouldn't
pretend otherwise by storing `""` for the one case that genuinely has none.

### A customer with no phone is half a customer

No WhatsApp, so no confirmation, no reminder, no campaign. That record should
say so on its face rather than sitting there looking complete. The pattern
already exists for missing consent (`customers.cannotBeMessaged` in
`src/lib/i18n.ts`) — same treatment, new string.

This is also how the record heals itself: Ayşe emails, the salon replies,
somebody types in her number during the conversation. No migration needed.

## What changes

### Schema

```ts
customers: defineTable({
  // ...
  // E.164 with dial code, or absent. Absent is legitimate for a customer who
  // only ever emailed us — but it means no WhatsApp, so the UI flags it.
  phone: v.optional(v.string()),
  email: v.optional(v.string()),   // lowercased via bareAddress() on every write
  // ...
})
  .index("by_org", ["orgId"])
  .index("by_org_phone", ["orgId", "phone"])
  .index("by_org_email", ["orgId", "email"]),   // new
```

`by_org_email` is what kills the full-table scan at
[`email.ts:69`](../convex/email.ts) — today that's `.collect()` over every
customer in the org, so 5,000 document reads per inbound email once a salon
grows. Same shape as the cron bug fixed in `ee4ae5a`: cost tracking the customer
base rather than the work.

### Capture points

Four places write a customer's email, and each needs the uniqueness check:

- `customers.create` / `customers.update` — staff typing it
- `forms.submit` — the public form
- `calcom.ts` (~line 158) — the cal.com attendee
- `email.recordInbound` — an unknown sender

The phone-agent variable registry can write custom fields marked
`contactFields.source === "voice"`, but canonical email remains a reserved
identity field in `retell.applyVoiceContactValues`. A variable may keep an
email-like answer on the call; it cannot silently replace `customers.email`.
Adding a caller-confirmed email flow later must reuse the uniqueness and
phone-wins rules in this document rather than bypassing them as a generic voice
field.

## What we are deliberately not building

- **A `customerEmails` table.** One address per customer is enough. A salon
  writing back to the wrong one of Ayşe's two addresses is not a real problem.
- **Merge.** The identity model above prevents most new duplicates but cannot
  undo the ones already on disk — if the salon has Ayşe's Gmail and she writes
  from work, that still makes a second record. Merge is the only cure, it's the
  riskiest thing in the original plan (re-pointing appointments, messages,
  notes, calls and activity log, paged), and it should wait until a real salon
  actually reports the problem. When it comes: manual only, never auto-merge on
  a name match. Two customers called Mehmet Yılmaz is normal, and a wrong merge
  destroys history that can't be recovered.
- **Address verification.** The salon typed it, or the customer wrote to us from
  it. That's better evidence than a confirmation link.

## Work breakdown

| # | Step | Notes |
|---|---|---|
| 1 | `phone` → `v.optional`, backfill `""` → unset | one commit, together — two representations of "no phone" is worse than one |
| 2 | Fix the ~18 `customer.phone` read sites TypeScript now flags | `wa.ts`, `schedule.ts`, `delivery.ts`, `campaigns.ts`, `messages.ts`, `appointments.ts`, `reports.ts` |
| 3 | Add `by_org_email`, rewrite the `recordInbound` lookup | kills the scan |
| 4 | Uniqueness + at-least-one enforced at all four capture points | mirror the existing `phone-exists` shape |
| 5 | Flag phone-less customers in the UI | new i18n key beside `customers.cannotBeMessaged` |

Steps 1–2 are mechanical and want their own commit — the compiler finds every
site, which is the whole reason to do this before anything else touches these
files.

## How to verify

No test suite, so this is manual. The cases that matter:

1. Customer with phone + email A. Mail from A lands on them, no new row.
2. Mail from an unknown address creates a customer with an email and no phone,
   and that record visibly reads as unmessageable.
3. Mail from that same unknown address a second time lands on the row from (2).
4. Email B is on customer X; try to put it on customer Y → refused, same way a
   duplicate phone already is.
5. Form filled in with a phone on one customer and an email on another → the
   phone wins, the email is untouched.
6. `npx tsc --noEmit` and `npm run build` clean before each commit.

## Watch out for

- **Never run the email lookup without an address.** Every customer with no
  email shares `undefined` in `by_org_email`, so a `.unique()` there throws.
  Exactly the landmine `phone: ""` is today, just moved — guard it at the call
  site, the way `assertE164` already guards every `by_org_phone` read.
- **`bareAddress()` and lowercase on every write.** `"Ayşe <a@b.com>"` must
  never be stored. A mixed-case row is a row the index will never find. The
  helper is in `lib/emailInbound.ts`.
- **The synthetic cal.com address.** [`calcomApi.ts:91`](../convex/lib/calcomApi.ts)
  sends `+905551234567@noemail.randevu.app` when a customer has no email, and
  cal.com can echo it back into [`calcom.ts:163`](../convex/calcom.ts). Reject
  that domain on write, or a stranger who guesses the pattern binds themselves
  to a real customer. Making `phone` optional also breaks line 91 outright —
  decide there what a cal.com booking sends for an email-only customer.
- **Existing data may already break uniqueness.** Email has never been checked.
  Query for orgs with two customers sharing an address before turning the rule
  on.
- **Don't touch the WhatsApp lane.** Phone binding works. This is email only.
- **The org invariant.** Every new query filters by `orgId` and every new index
  starts with it.
