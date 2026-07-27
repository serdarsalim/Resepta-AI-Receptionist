# Binding a customer's real email address

**Status:** scoped, not started. Written 2026-07-27 for a fresh session to pick up.
**Read first:** [`AGENTS.md`](../AGENTS.md), then this whole file before touching code.

---

## The problem, concretely

A salon has Ayşe on file with her phone and her personal Gmail. She emails the
salon from her work address about a colour appointment.

What happens today: `email.recordInbound` matches the From address against
`customers.email`, finds nothing, and **creates a second customer row** — with
`phone: ""`, no consent, and her work address. The salon now has two Ayşes. Her
WhatsApp history sits on one, her email thread on the other, and neither record
shows the whole person. Nobody notices until someone opens the wrong one.

That is the bug. Everything below is in service of fixing it.

## What already works — don't rebuild it

Inbound email → customer binding EXISTS and is basically right:

| Piece | Where |
|---|---|
| Org resolved from the To address's local part | `email.orgByInboundAddress`, `http.ts` inbound route |
| Webhook signature verified (Svix/Resend) | `lib/emailInbound.ts` `verifyResendSignature` |
| Body fetched separately (Resend sends metadata only) | `lib/emailInbound.ts` `fetchReceivedEmail` |
| Customer matched on the From address | `email.recordInbound`, [`email.ts:68`](../convex/email.ts) |
| Unknown sender still gets a record | same, [`email.ts:83`](../convex/email.ts) |
| Thread grouping across `Re:`/`Yn:` | `normalizeSubject` |
| Dedupe on Resend's `emailId` | `messages.by_email_id` |

The transport, the routing and the threading are all fine. **The gap is that a
customer can only hold ONE address.**

## Where a customer's email is written today

Any change has to keep all five of these working:

- `customers.create` / `customers.update` — staff typing it
- `forms.submit` — the public request form
- `calcom.ts` (~line 163) — the cal.com attendee
- `email.recordInbound` — an unknown sender
- Voice does NOT capture email (`retell.applyVoiceContactValues` handles custom
  contact fields and phone only). Worth adding later; out of scope here.

And where it is read: `email.loadSendContext`, `delivery.claimForRetry`,
`campaigns.fanOut`, `wa.sendAppointmentMessage`'s email lane, `schedule.ts`
(passed to cal.com), `messages.ts` (~line 570).

## Three defects, ranked

### 1. One address per customer — the actual ask

`customers.email` is a single optional string. Every additional address a
person writes from becomes a new customer. **This is the whole reason this doc
exists.**

### 2. The lookup is a full table scan

[`email.ts:69`](../convex/email.ts) does `.collect()` over every customer in
the org and finds the match in JS. There is no `by_org_email` index. At 200
customers that is invisible; at 5,000 it is 5,000 document reads per inbound
email. Same shape as the cron bug fixed in `ee4ae5a` — cost tracking the
customer base rather than the work.

### 3. `phone: ""` is a lie in a required field

`customers.phone` is `v.string()`, required, and `AGENTS.md` says a stored
number carries a dial code or does not exist. `email.recordInbound` is the ONE
place that writes `phone: ""` ([`email.ts:93`](../convex/email.ts)).

It is currently harmless-by-luck: every path that queries `by_org_phone` runs
`assertE164` or a regex first, so nothing ever looks up `""`. But two
email-only customers in one org means two rows sharing `phone: ""`, and the
first `.withIndex("by_org_phone", …).unique()` written against an unknown or
empty phone will **throw**. It is a landmine, not a live bug.

---

## Decisions needed before coding

Both are Serdar's call. Recommendations given; do not start until confirmed.

### A. Addresses model — recommend the `customerEmails` table

Options:

1. **Separate `customerEmails` table** *(recommended)*. One row per address.
   `customers.email` stays as the denormalised PRIMARY — the address we send
   to — so nothing downstream changes. Same denormalisation trick Nudge uses
   for `leads.phone`. Lookup becomes an indexed point read, which also kills
   defect 2 for free.
2. **An `emails: v.array(v.string())` on the customer.** Cheaper to write,
   but Convex cannot index into an array, so the inbound lookup stays a scan
   and defect 2 survives. Rejected for that reason.

### B. What to do about `phone: ""` — recommend making phone optional

1. **`customers.phone: v.optional(v.string())`** *(recommended)*. Honest: an
   email-only contact genuinely has no phone. Costs a pass over ~8 read sites.
2. Keep `""` as a sentinel and document it. Cheaper now, and every future
   author has to know. This is how defect 3 became a landmine in the first
   place.

### C. Merge trigger — recommend manual only, no auto-merge

Start with an explicit "this is the same person as…" action on the contact
page. **Do not auto-merge on a name match.** Two customers called Mehmet
Yılmaz is normal in a Turkish salon, and an incorrect merge destroys history
that cannot be recovered. A "possible duplicate" *hint* is fine later; the
merge itself stays a human decision.

---

## Proposed design

### Schema

```ts
// One address a customer can be reached at or writes from. Separate table
// rather than an array on the customer because Convex cannot index into an
// array, and the inbound lookup has to be a point read.
customerEmails: defineTable({
  orgId: v.id("orgs"),
  customerId: v.id("customers"),
  address: v.string(),            // always lowercased via bareAddress()
  source: v.union(
    v.literal("manual"), v.literal("form"),
    v.literal("calcom"), v.literal("inbound"),
  ),
})
  .index("by_org_address", ["orgId", "address"])   // the inbound lookup
  .index("by_customer", ["customerId"]),           // the contact page + merge
```

`customers.email` **stays**, meaning "the address we send to". Keeping it is
what makes this change small: every send path keeps working untouched.

### Behaviour

- **Inbound** looks up `by_org_address`. Hit → file on that customer. Miss →
  create the customer as today AND write a `customerEmails` row.
- **Adding an address** to an existing customer (staff, form, cal.com) writes a
  `customerEmails` row and sets `customers.email` if it is the first one.
- **An address belongs to at most one customer per org.** Writing one that is
  already claimed is refused, not silently moved — that is what merge is for.
- **No verification.** The salon typed it, or the customer emailed us from it,
  which proves it more directly than a confirmation link would.

### Merge

`customers.merge({ keepId, mergeId })`, owner-only:

- Re-point `appointments`, `messages`, `notes`, `calls`, `activityLog`,
  `customerEmails` from `mergeId` to `keepId`. **Page it** — a long-standing
  customer can exceed one mutation's write limit; follow the
  `reminders.backfillOrg` tail-reschedule pattern.
- `consentAt` = the EARLIEST non-null of the two. It is evidence of when
  someone agreed; the later stamp would overstate it.
- `lastInboundAt` = the later of the two. `phone` = whichever is non-empty.
- Delete the merged row, write an `activityLog` entry (`customer_deleted` or a
  new `customer_merged` kind).
- Irreversible, so the UI confirms with both names spelled out.

---

## Work breakdown

| # | Step | Notes |
|---|---|---|
| 1 | `customerEmails` table + indexes | schema only |
| 2 | Backfill existing `customers.email` into it | one-shot internal mutation, per org, paged |
| 3 | Rewrite `email.recordInbound` lookup to `by_org_address` | kills defect 2 |
| 4 | Write a row from all four capture points | create/update, form, cal.com, inbound |
| 5 | Contact-page UI: list addresses, add, remove, set primary | follow the `RecordField` inline-edit rule in AGENTS.md |
| 6 | `customers.merge` + paged re-pointing | the risky one; write it carefully |
| 7 | Merge UI + confirm dialog | contact page action |
| 8 | Decision B: `phone` optional + fix read sites | separate commit; ~8 sites |

**Effort:** steps 1–5 are a session. Steps 6–8 are a second. Do not try to land
all of it in one commit — step 6 alone deserves its own review.

## How to verify

There is no test suite in this repo, so verification is manual and the
following cases are the ones that matter:

1. Customer with phone + email A. Email arrives from A → lands on that customer,
   no new row.
2. Same customer, email arrives from B → creates a customer (expected). Merge
   the two → one record holds both addresses, both threads, both appointments.
3. Address B already on customer X; try to add it to customer Y → refused.
4. Merge a customer with 500+ messages → completes, nothing orphaned.
5. `npx tsc --noEmit` and `npm run build` clean before each commit.

## Watch out for

- **`bareAddress()` on every write.** `"Ayşe <a@b.com>"` must never be stored
  as an address. It already exists in `lib/emailInbound.ts`; use it.
- **Lowercase on every write and every lookup.** A mixed-case row is a row the
  index will never find.
- **Do not touch the WhatsApp lane.** Phone binding works; this is email only.
- **The org invariant.** Every new query filters by `orgId` and every new index
  starts with it. `customerEmails` is no exception.
