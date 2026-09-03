# Session journal

Dated session write-ups, one file per month, oldest first within a file:
what changed, what was tried, what was superseded, what it cost. A newer
entry overrides an older one.

**This is the story, not the rules.** When a session changes a rule, the rule
is edited in [`../../AGENTS.md`](../../AGENTS.md) in the same change; when it
changes how something works, [`../subsystems.md`](../subsystems.md) is edited.
Nobody should have to read the journal to know what stands today. Read it for
*why*, or for what a previous attempt at the same thing ran into.

Find an entry by its date:

```bash
grep -n '^## .*2026-08-21' docs/journal/2026-08.md
```

| Month | Entries | Size |
|---|---|---|
| [`2026-07.md`](2026-07.md) | 2 | 21 KB |
| [`2026-08.md`](2026-08.md) | 14 | 34 KB |
| [`2026-09.md`](2026-09.md) | 3 | 6 KB |

## Writing an entry

Append a `## <what changed> (YYYY-MM-DD)` section to the current month's file.
Say what was found before what was done; name the files; record what was
rejected and why. Then go back to `AGENTS.md` and `docs/subsystems.md` and
EDIT whatever the session changed — an appended correction is not a fix.
