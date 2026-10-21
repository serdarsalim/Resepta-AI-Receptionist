# Open, not fixed

Open product questions and known gaps. Check before proposing work; delete
from here when something is decided or built, and write it up in the
[journal](journal/README.md).

## Open product questions (unresolved as of 2026-07-25)

These change what gets built next — don't paper over them:

- **Operator model.** Self-serve (current) vs partner-operated agency vs
  hybrid. Affects whether a super-admin surface exists at all.
- **WABA ownership.** Does each salon go through Meta embedded signup, or does
  the partner hold numbers as a Tech Provider? This is the real onboarding
  bottleneck and it is unvalidated. **Partially answered 2026-08-26:** the
  manual path is now walked end to end (see "Wiring a Meta Cloud number") and
  costs about an hour per business. Embedded Signup was deliberately deferred
  — it needs App Review plus business verification, which is disproportionate
  with one number live. Revisit at business three, or the first time a
  prospect refuses to grant access to their own WABA. Two facts to price in
  before selling it: it does NOT set the profile picture or description
  (separate Business Profile API call, which this app could own), and it fails
  outright if the salon's number is already on consumer WhatsApp or the
  WhatsApp Business app, which is how that flow usually derails.
- **Template approval.** Every org currently types its own Meta-approved
  template names into the Reminders tab. If the partner owns the WABA,
  templates are approved once centrally and this UI gets much smaller.

## Owed after the 2026-10-21 review

- **Nothing from 2026-10-21 is pushed.** The deploy builds two new indexes,
  `by_org_agent_reviewed` on `calls` and on `agentTests`; the calls one
  backfills over every call row.
- **After the deploy, press Update on every phone agent** (template v17: the
  caller's name, the save tool's description, the summary language), then
  make one real call to Estate Emlak and check that the name lands on an
  empty card and the summary comes back in Turkish.
- **Autotakt's business language is English**, so after Update its two
  Turkish agents ("Randevu Asistanı", "Booking assistant") write English
  summaries until Summary language is set to Türkçe on each. Estetik
  International's switched-off "Daniel" (en-US) will summarise in Turkish.
- **Never press Update, Fix or Start test from localhost.** The dev
  deployment's agents are the same provider agents prod's businesses answer
  with.
- **The branches' screens were seen only in previews**: the Testing and
  Notes tabs, Business's tabs and the record footer want a look in the real
  app, and the live browser test is Serdar's to run (an agent → Testing →
  Start test, talk, Hang up; then open an older test and set Pass or Miss
  with a note).
- **`convex/_generated/api.d.ts` was edited by hand** for `agentReviews`,
  `lib/businessAddress` and `lib/marketing`, because codegen fails in a
  worktree. Run `npx convex codegen` once on main and commit any difference.
- **The ignored `consent` flag** on `customers.create`, `customers.update`
  and `schedule.create` is there for tabs loaded before 2026-10-21; drop it
  once those are gone.

## Known gaps (2026-10-21)

- **The Add agent sheet defaults the agent's language to the app's language
  for whoever opens it** (their own setting, else the business's), not to
  the business's language. Should it be the business's?
- **On a phone the Team list takes three lines per person** (name, switch,
  access): the roster row is a grid only from sm.
- **Two stale help centre lines**: "Open Business and use Add service"
  (services live on Knowledge since 2026-08-22, and the same article adds the
  team "on the same page") and "switch Taking bookings on" (the row is
  "Online booking page").
- **The Calendar's "Edit hours" deep link no longer has a button.**
  `?section=hours` still opens the Hours tab, but nothing in the calendar
  links there.
- **Voice → Calls still says Successful / Unsuccessful**, while the call
  cards say what happened on the line (Completed, No answer, Voicemail…).
- **The shop-phone lane may not support Reply and React the way Cloud
  does.** React is never offered on a shop-phone message (no stored message
  key), and Reply quotes by the message id alone; neither was checked on a
  linked handset.
- **Hours' time inputs looked clipped in a 390px preview**; check on a real
  phone.
- **Nudge's `fieldShellClass` and `fieldClass({ bare })` belong in
  Control.tsx**; BusinessView keeps local copies (`FIELD_SHELL`,
  `SHELL_CONTROL`) until then.
- **Two filled adds missed the button depth**: Add customer and Add agent
  are hand-rolled accent buttons, not `buttonClass("primary")`, so they lack
  the crisp edge the other filled adds have, and Add customer (h-9, in a
  `min-h-9` row) stands taller than the 32px Columns pill beside it.
- **Retell's built-in `call_summary` stays English**, and summaries written
  before v17 are not rewritten.
