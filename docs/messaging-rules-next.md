# Handoff: message types, and where the rules table got to

Written 2 Aug 2026 at the end of a long session. Recorded here rather than in
`.remember/remember.md` because that file has been truncated to zero twice
today.

## The open question, in Serdar's words

Messages should be typed by **lifecycle stage**, not by exact timing:

- **confirmation** — "this is your appointment for ‹service›, reply if
  something is wrong"
- **reminder before** — can be several rows (1 day before, 2 hours before),
  and they should be able to say DIFFERENT things: "your appointment is
  tomorrow" is not "see you in 2 hours". How a row is tied to its own wording
  is exactly what is unresolved
- **after the appointment** — "leave us a review", a rebooking nudge
- **after a no-show** — the existing win-back

Two things do not exist yet: the "after the appointment" type, and any way for
one reminder row to word itself differently from another.

One idea raised and NOT settled: put `offsetHours` on a template row, so a
template can belong to one specific reminder timing, with the generic reminder
text as the fallback for rows that have none. Serdar has not accepted or
rejected it — he wants to work the whole model out from scratch in a fresh
chat. Treat it as one option, not the plan.

The thing to resolve first is what a "message" is keyed by. Today it is
(kind, language). If each reminder row can say something different, it becomes
(kind, language, + something that identifies the row) — and what that
something is drives everything else, including whether the rules stay three
hardcoded org fields or become one list.

### What "after the appointment" needs

1. A fourth `kind` on `waTemplates`: `"review"` (or `"followup"` — name it with
   him). Same shape as the others: authored `body`, `subject`, per language.
2. A schedule anchor. Everything today anchors on `startAt`;
   this one anchors on the appointment **ending** — `startAt + durationMinutes`
   — plus an offset. `convex/lib/reminderSchedule.ts` is where that goes,
   beside `nextReminderAt` and `winbackDueAt`.
3. **Only on `completed`.** Never a no-show, never a cancellation. The win-back
   already models this pattern (`appointment.status !== "no_show"` → skip).
4. A one-shot marker on the appointment, like `winbackSentAt`, so it cannot
   fire twice. Follow `syncAppointmentSchedule`'s existing rule: every write
   that moves `startAt`, `status` or a sent-marker must call it afterwards.
5. One new org field for the review URL, same shape as `orgs.bookingUrl`.

### The anchor model, if it is worth generalising

Serdar sketched every rule as an anchor plus an offset:

```
at booking          →  confirmation
before the start    →  reminder      (24h, 2h, …)
after the end       →  review / rebooking nudge
after a no-show     →  win-back
```

That would make all rows the same kind of thing and remove the last of the
special-casing. It is a real refactor — the three hardcoded org fields
(`sendBookingConfirmation`, `reminderOffsetsHours`, `winbackEnabled`) become
one list. **Not started.** Weigh it against just adding the fourth kind.

Serdar also wants the defaults trimmed to **two rules** for a new org:
confirmation plus one reminder. Today `DEFAULT_REMINDER_OFFSETS = [24, 2]`
gives two reminders.

### Also asked for, not built

Expand/collapse per rule row, with that rule's message edited inline, instead
of the separate "Message templates" card lower down the page. Blocked only on
deciding the message types above — once each row maps to one message, the
panel is obvious.

## State of the rules table (built this session)

`src/components/RemindersView.tsx`, commit `ac51545` — **committed, NOT
pushed**, on Serdar's instruction. Everything before it is pushed.

Every row now has two controls with distinct meanings:

- a **switch** under an `Active` header — pauses without losing anything
- a separate **×** — takes the row off the table

Before this, a reminder's switch silently deleted the row, because reminders
are stored as an array of offsets with no way to say "exists but off".

Storage, and why it is two arrays rather than one nicer one:

- `orgs.reminderOffsetsHours` — which reminder rows exist
- `orgs.pausedReminderHours` — the subset switched off, keeping row and wording
- `orgs.removedRules` — `"confirmation"` / `"winback"` taken off the table.
  Reminders are absent from this by design; dropping the offset removes them.

**A reminder is identified by its HOUR, and that must stay true.**
`appointments.reminderSentOffsets` keys the double-send guard on the hour.
Re-keying it is the migration `lib/reminderSchedule.ts` warns about, and a
second array costs far less than being clever with the first.

Removed singletons return from the same row of `+` chips that adds a reminder,
so there is one place to add a rule.

## The rest of the session, for context

Email went from never having sent anything to fully wired:

- The whole template engine port from Nudge (bodies + subjects in named tokens,
  the email lane, the editor, open-pixel tracking on win-back and campaign mail).
- `orgs.messageChannel` — WhatsApp, email, or both, per org.
- **Prod had no Resend key at all**, which is why nothing had ever sent. The key,
  sending domain, webhook secret and product name now live in `platformConfig`
  and are set from **/admin → Email (Resend)**, env vars kept as fallback.
- Sending domain is **`autotakt.xyz`**, verified, on the Resend account under
  `mansureastman@gmail.com`. DNS is in Porkbun. See
  [`email-lane-setup.md`](email-lane-setup.md).
- `customerSender` resolves a From in three tiers, so no salon needs DNS of
  their own: their domain → `‹inbound›@autotakt.xyz` → `noreply@`.
- An org with no incoming address now gets one assigned from its name.
- Fixed in passing: the admin console could point one salon's mail into
  another salon's inbox (`platform.setOrgConfig` skipped the uniqueness check).

## Do this first in the new chat

1. `npx convex deploy` — **prod has not been deployed since the platformConfig
   work.** Pushing does not deploy the Convex backend; `docs/deploy.md` step 2
   is manual. Until it runs, prod `/admin` calls functions that do not exist.
2. Decide the message types above with Serdar before writing anything.
