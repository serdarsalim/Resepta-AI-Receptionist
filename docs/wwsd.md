# WWSD — deciding like Serdar without asking

> **The canonical copy lives in Mana** (`/Volumes/server/SLMAI/AGENTS.md`,
> committed 2026-07-25) so it applies to EVERY project, not just this one.
> Serdar's point when he asked for it: he has repeated these same rules across
> 20+ apps. Add new rules THERE when he corrects something — this file is a
> local convenience copy.

Read this BEFORE building any surface, not after he rejects one. Every rule
below was extracted from an actual correction he made; the "because" is his
reasoning, not mine. If a decision isn't covered here, decide by extrapolating
from the closest rule — then add the new rule when he confirms or corrects it.

## The meta-rule

**He hired judgment, not typing.** Asking "should this be a tab or a card?" is
the failure. Decide, build it right, and tell him what you decided and why.
Reserve questions for things only he knows: business model, money, credentials,
what his partner will tolerate operationally.

Corollary: when he says "build the whole app," he does not mean "produce every
screen you can think of." He means "make the complete product decision set and
execute it." Extra surface area is a cost, not a deliverable.

## Product decisions

1. **Never ship a surface that's empty for a normal user.** A tab that says "no
   calls yet" because the feature isn't configured is clutter. Gate it: hide
   until the thing exists (Nudge gates tabs by flag/crmMode — same pattern).
2. **Reuse infrastructure he already owns before building new.** n8n for email,
   Retell for voice, cal.com for scheduling, Nudge's components for UI. He will
   name the tool he already pays for; if he hasn't, ask *which* one, never
   whether to build one.
3. **Don't build what isn't validated.** Evolution API was parked because the
   risk model wasn't settled. Defer with a written note, keep the branch point
   open in code, don't half-build it.
4. **Think at his operating scale, not the demo's.** He is planning for a
   partner onboarding hundreds of salons. Any flow that requires him personally
   is wrong. This is why one-login-one-client failed the sniff test and
   workspaces (Retell-style, many orgs per login) was the right model.
5. **He benchmarks against real products.** When he says "is that how fonio
   does it?" he means: go look at how a shipped product solves this, and match
   or beat it. Not "explain your version."
6. **Production-grade means finished, not functional.** Loading/empty/error
   states, mobile, both languages, no placeholder copy. "It works" is not the
   bar.

## Design language (violations he has personally flagged)

7. **Borders only when absolutely necessary.** Containers (cards, inputs,
   dropdown panels) get borders. Buttons never do — secondary is text + hover
   wash, primary is solid accent.
8. **Every popover portals to `document.body`** with fixed positioning measured
   from the trigger, viewport-clamped, closed on outside-click and scroll.
   `absolute` inside a card clips. He has flagged this across multiple projects.
9. **No horizontal rules to separate things surface contrast already
   separates.** Especially under headers.
10. **Human language, never machine language.** `24, 2` in a text field is a
    data structure leaking into the UI. Ship chips that say "1 gün önce".
11. **Blank over zero/dash noise.** Show nothing when there's nothing. Show a
    state only when it's the exception (missing consent → pill; consent present
    → nothing).
12. **Scroll containers reserve their gutter** (`scrollbar-gutter: stable`) —
    content must never shift.
13. **Explanatory copy lives behind an InfoTip**, never as a paragraph under a
    control.
14. **Autosave on blur/change with a saved indicator.** No Save buttons.
15. **If it exists in the codebase, port it exactly.** Approximating an existing
    system with a lookalike is a bug, not a shortcut. This applies to whole
    SYSTEMS (theming, shell, drag-reorder, deep links), not just components.
16. **One toolbar button per noun.** Variants live in the primary action's
    dialog footer.

## Process

17. **Small commits per logical unit, typecheck before each.** He wants to see
    progress on disk, not one omnibus commit.
18. **Write decisions into AGENTS.md as they're made**, with the date and who
    decided. The repo is the memory; a decision not written down gets
    re-litigated.
19. **Flag hack-vs-scalable explicitly.** Don't silently pick the hack; don't
    silently gold-plate either. Name the trade and recommend one.
20. **Tell him when he's on a tangent.** He asked for this directly. One
    sentence: "this is a tangent, the real question is X."
21. **Impact/effort ordering.** Do the high-impact, low-effort thing first and
    say so. Push back when he's about to sink a day into a div.

## Self-check before showing him anything

- Would this screen embarrass me if fonio's team saw it?
- Is there a border on a button? A popover that could clip? An empty state
  that shouldn't be reachable?
- Did I invent a mechanism the codebase already has?
- Is every string in both tr and en, and does the Turkish read like a person
  wrote it?
- Am I about to ask him something I could decide correctly myself?
