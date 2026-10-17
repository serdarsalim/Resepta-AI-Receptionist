# Nudge → Resepta sync: the cloud runbook

A cloud routine starts this file every hour; the lock lets only one run work at a time, so back-to-back runs work through the backlog without a gap. It keeps Resepta up to date with
everything Nudge builds that a salon app needs, without anyone sweeping
hundreds of commits by hand. Set up 2026-10-17 at Serdar's request ("update
fully from cloud ... it should pretty much update with all features
necessary").

You are that routine. You start with no context: this file, the port plan
(`docs/nudge-port-plan.md`) and the two repos are everything you have.

## The shape

- **Branch `claude/nudge-port`** on `serdarsalim/randevu` holds all port work. Never
  commit to or push `main`. Serdar ships by merging the draft PR
  `claude/nudge-port → main` and deploying Convex himself.
- **The backlog** is the phase table at the top of `docs/nudge-port-plan.md`.
  A phase is done when its status says so there.
- **The cursor** (`docs/nudge-sync/cursor`) is the last Nudge `origin/main`
  commit already triaged. Nudge commits after it are not yet looked at.
- **The weekly triage** turns new Nudge commits into new phases, about once a
  week, so Resepta follows Nudge's settled work and not every change that
  gets reverted two days later.
- **`docs/nudge-sync/STATUS.md`** is what Serdar reads. Keep it short and in
  product words (see "Reporting").

## Every run, in order

1. **Find both checkouts.** Both repos are cloned side by side. Resepta is the
   one with `docs/nudge-sync/RUNBOOK.md`; Nudge is the one whose `AGENTS.md`
   starts "This is NOT the Next.js you know". Nudge is READ-ONLY: never edit,
   commit or push it.
2. **Get onto the branch.** In Resepta: `git fetch origin`, then
   `git checkout claude/nudge-port` (it tracks `origin/claude/nudge-port`). If the branch
   does not exist, write nothing and stop.
3. **Take the lock.** If `docs/nudge-sync/LOCK` exists and its timestamp is
   less than 3 hours old, another run is working: stop. (A working run
   rewrites that timestamp after every phase, so an older one means the run
   died.) Otherwise write the
   current UTC time and "running" into it, commit
   (`nudge-sync: run started`), push. If the push is rejected, someone else
   just took it: stop.
4. **Bring in main.** `git merge origin/main`. Serdar sometimes works on main
   directly. Resolve conflicts by keeping both behaviours. If you cannot
   resolve one safely, `git merge --abort`, note it in STATUS.md under
   "Needs Serdar", and carry on without the merge.
5. **Install.** `npm ci`, then `npm run typecheck`. If main is already red,
   say so in STATUS.md and do not build on a red base: release the lock and
   stop.
6. **Triage, if due** (see below). It is due when the newest
   `docs/nudge-sync/triage-*.md` is more than 6 days old, or there is none.
7. **Build phases.** Take the first phase in the table that is not done, not
   marked "needs Serdar", and not listed in `docs/nudge-sync/held` (phases
   being built somewhere else right now, one per line; whoever finishes one
   removes it from that file). Build it (see "Building a phase"). After each phase, rewrite `LOCK`
   with the current UTC time, commit and push it with the phase, and update
   STATUS.md. Then take the next phase. Keep going until no phase is left:
   Serdar has a long backlog and wants it finished in one go. Re-read the
   builder brief before each phase, since a long run forgets.
8. **Report.** Update STATUS.md. Update the PR description if you can reach
   GitHub's API; if not, STATUS.md is enough.
9. **Release the lock.** Delete `LOCK`, commit (`nudge-sync: run finished`),
   push.

If nothing is due and no phase is pending, steps 6–8 do nothing: release the
lock and stop. That should take a few minutes.

## Triage

1. In Nudge, list the commits from `cursor` to `origin/main` that touch
   `src/` or `convex/` (`git log --oneline <cursor>..origin/main -- src convex`).
2. Read Nudge's journal for the same days (`docs/journal/<month>.md`). From
   2026-10-17 each entry ends `Resepta: port | adapt | skip — <why>`. Trust
   that line; it was written by the session that made the change.
3. Group the commits by feature. For each, decide:
   - **port / adapt:** it changes what a business owner, their staff or their
     customer sees or gets, or it fixes a bug or a security/privacy gap in
     code Resepta shares. Includes design-system and primitive changes,
     calendar, inbox, WhatsApp thread, email composer, voice and chat agent
     behaviour, booking, bulk sends, deletion/KVKK, billing metering.
   - **skip:** Nudge-only ground. Triggers, journeys, the trigger map, step
     clocks, form restart; HubSpot, deals, owners/contact owners, fields
     registry, property history; the Google booking-accounts engine, meeting
     types, host pages, host blocks (unless Serdar has asked for per-person
     blocks); personal WhatsApp (Baileys/Evolution/wa-pair); knowledge bases
     in Retell; call reviews; the demo tenant; fleet tooling, n8n, dev
     tooling. Section A's SKIP list in the plan has the reasoning; it stands.
   - **needs Serdar:** a real product choice for Resepta (a new surface, a
     change to how businesses are billed, anything that contradicts a rule in
     Resepta's `AGENTS.md` or `docs/wwsd.md`). Don't build it; list it.
   When in doubt between port and skip, port only if a salon would notice the
   difference.
4. Write `docs/nudge-sync/triage-YYYY-MM-DD.md`: one row per feature (what it
   is in product words, Nudge commits, decision, why). Add the port/adapt
   features to the plan's phase table as new phases (P18, P19, ...), each
   with its Nudge commits and the Resepta files it touches. A fix to code an
   existing pending phase already covers goes into that phase's row instead.
5. Set `cursor` to the Nudge `origin/main` you triaged up to. Commit
   (`nudge-sync: triage to <sha>`) and push.

## Building a phase

The appendix of `docs/nudge-port-plan.md` ("builder brief") is binding: read
it in full before your first phase each run, together with Resepta's
`AGENTS.md`, the `docs/subsystems.md` sections you touch, and
`convex/_generated/ai/guidelines.md`. Port the WHOLE user-facing behaviour,
adapted to Resepta (org scoping, tr/en/de, demo org, Resepta's own names and
shape rules), never a token version.

What is different in the cloud, and overrides the brief where they disagree:

- There is no dev server, no local Convex backend, no browser and no
  provider keys. Never run `npx convex dev`, `npx convex deploy`,
  `npx convex run` or anything that talks to a deployment, Retell, Meta,
  Stripe, an email sender or an LLM.
- A new file under `convex/` needs `convex/_generated/api.d.ts` to know about
  it. Try `npx convex codegen`; if it needs a deployment, edit `api.d.ts` by
  hand, copying exactly how the existing modules are listed (an
  `import type * as x from "../x.js";` and an `x: typeof x;` entry, in
  order). A new function in an existing file needs nothing.
- "Done" for each logical unit: `npm run typecheck` clean, `npx eslint` on the
  touched files with no new errors, a commit on `claude/nudge-port` in the repo's
  style with the trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, then `git push`.
  Push after every commit, so a run that dies keeps its work.
- Stage files by name. Never `git add -A` or `git add .`.
- Mark the phase done in the plan's status line with its commit range, and
  list what it still owes: anything that can only be checked by looking at
  the screen, prod backfills, provider config. Add a dated entry to
  `docs/journal/<month>.md`. Edit any `AGENTS.md` rule you make stale in the
  same commit.
- If a phase turns out to need a product decision, stop that phase, commit
  what is safe, mark it "needs Serdar" with the question in one sentence, and
  move to the next.

## Reporting

`docs/nudge-sync/STATUS.md` is written for Serdar, who reads it in full and
does not open code. Keep the whole file under one screen:

- **Needs you** first: each open question in one sentence, or "Nothing".
- **New since last time:** what a business owner will now see or get, a line
  each. No file names, no function names.
- **Ready to look at:** what to click once he runs the app, per phase.
- **Before shipping:** prod backfills, Convex deploy order, provider config.
- **Up next:** the next two pending phases.

Plain sentences, no em dashes, no marketing tone.
