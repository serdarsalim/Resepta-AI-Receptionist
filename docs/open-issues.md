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
