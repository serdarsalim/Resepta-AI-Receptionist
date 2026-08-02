# Message rules: decided and built (2 Aug 2026)

The open question from the last session — what a "message" is keyed by — got
its answer: **a rule is a document.** The `messageRules` table holds one row
per automated message (anchor + offset + channel + paused), wording binds to a
rule via `waTemplates.ruleId`, and the double-send guard moved from the hour
to the rule id (`appointments.sentRuleIds`). The offsetHours-on-template idea
was dropped; the full refactor won.

## The model

```
booking        →  confirmation            fires from the mutation
before_start   →  reminder (n rows)       cron, startAt − offset
after_end      →  follow-up (n rows)      cron, startAt + duration + offset, completed only
cancellation   →  cancellation notice     fires from the mutation
no_show        →  win-back                cron, startAt + offset
```

- Channel (whatsapp / email / both) is **per rule**; `orgs.messageChannel` is
  only the default stamped onto new rows.
- Content resolves (ruleId, language) → (kind, language). The kind row is the
  fallback wording; a rule gets its own row the first time its editor opens
  (`messageRules.ensureTemplate`, copies from the fallback).
- The Cloud lane resolves its Meta registration SEPARATELY and falls back to
  the kind row: custom wording rides email + Evolution immediately, while
  WhatsApp Cloud keeps sending the approved template until the rule's own
  wording is registered and approved. The editor says this in one line.
- Follow-up rules apply forward only (guarded on `rule._creationTime`) so
  adding one does not mass-mail 90 days of completed appointments. Win-back
  deliberately keeps its retroactive reach, as it always had.
- Legacy orgs (no `orgs.rulesMigratedAt`) still run the old trio end to end —
  scheduler, sender, and the old rules card render untouched for them.

## The tab

One rules list (`RulesCard` in `src/components/RemindersView.tsx`): each row
has its timing (inline-editable for follow-up hours and win-back days), a
channel select, the pause switch, the ×, and a chevron opening the inline
editor — token chips, live preview through the same `renderTokens` the send
path uses, WhatsApp-bubble or email dress per the rule's channel. The lower
templates card is now the Meta registration desk plus the campaign row.

New orgs seed confirmation + one 24h reminder (`seedDefaultRules`), trimmed
from the legacy three on purpose.

## Deploy run-book (in order)

1. `npx convex deploy` — prod is still behind from the platformConfig session
   AND now the rules work. Until this runs, prod /admin calls functions that
   do not exist.
2. `npx convex run messageRules:migrateAll --prod` — lifts every org onto the
   rules model (idempotent; schedules its own per-org backfill). Until it
   runs, orgs stay on the legacy path and the tab shows the old card behind
   an amber note.
3. Push the branch. Commits since the last push start at `ac51545`.
4. Dev deployment: the schema very likely synced already (convex dev /
   codegen); run `npx convex run messageRules:migrateAll` there too to see
   the new tab locally.

## Loose ends, none blocking

- Per-rule Meta approval is operator work: registering a second reminder's
  wording with Meta gets it its own metaName on the rule's template row via
  the existing status fields — no new UI was built for that.
- Win-back open counters: historical counts live on the kind row (visible
  while a Cloud number shows the Meta card); new sends count on the rule's
  own row and show in its editor.
- The editor edits the ORG language's wording, as the old card did. Customers
  in another language still resolve per send against exact-language rows.
- Legacy org fields (`reminderOffsetsHours`, `pausedReminderHours`,
  `sendBookingConfirmation`, `winbackEnabled`, `winbackDaysAfter`,
  `removedRules`) can be dropped from the schema once every org carries
  `rulesMigratedAt` and nobody needs the rollback window anymore.
