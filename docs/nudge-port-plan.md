# Nudge → Resepta port: plan and status

Paused 2026-10-13 at Serdar's request, then P3, P4 and P5 finished the same day. Done: P1, P1c, P2, P2b, P2c (commits e0e6083..f1279d2), P3 (0f1fdcd, then a9c8bdb..2b75ebf and 79c88c4), P4 (d166b40..f21fb2d and the commit that records this range) and P5 (8114672..796390b and the commit that records this range); see docs/journal/2026-10.md. P6 is built and documented (commits 043cb45..448ac6e, d70dd24 and 438dd22); only Serdar's click-through is owed. P6b is built (commits eda2a31..44d0cce, docs in f1db07a); Serdar's click-through and a first real call run are owed. P7 onward are built by the cloud sync (docs/nudge-sync/RUNBOOK.md), one phase at a time. The rules every phase builder followed are in the appendix.

P6b status (2026-10-17, built while Serdar's dev server was down). Done and committed: (1) a call run rings only while the business is open: its opening hours with closures cut out, in its timezone, or its send window when it set no hours; closed, the run is held on its own row with one wake-up for the opening, read in `claimNextCall` so the reaper cannot dial through it (eda2a31); (2) each row says what the call came to, from the disconnect code (`lib/callOutcome`: answered, voicemail, busy, declined, no answer, refused, failed), never Sent, and a call that never reached the phone counts as failed; the MCP report counts answered and voicemail the same way (454ef64); (3) at each customer's turn, anyone with an open booking ahead or a call with them already that day is skipped with a reason (304068b); (4) a dial refused for want of a free line (429, 5xx, a full pool, `concurrency_limit_reached`) goes back in line, the run waiting a minute longer per try, six tries, a thrown fetch never re-dialled, an account refusal pausing the run (4c86d23, 5d0b555, and 44d0cce so a finished run carries no hold); (5) an optional platform-wide limit on bulk calls at once, /admin → Platform → Bulk calls, unset = today's behaviour (a5b59c2); (6) docs: `docs/subsystems.md` → "Bulk call runs", an AGENTS.md rule, a help-centre article, the journal (f1db07a). Verified by tsc, eslint, a node test for the outcome leaf and, in a scratch copy, 13 `nextOpenAt` cases and 13 queue scenarios against an in-memory database; nothing dialled. Still owed for P6b:
- Click-through at localhost:3006: the call composer's (i) in tr/en/de; a run launched after closing (list says Waiting, detail says "Closed now. Calling resumes …" on the business's clock); a run's rows (skip reasons, outcome words, "Trying again shortly", the red Refused hover); /admin → Platform → Bulk calls (a number saves, "0" is refused with a sentence, empty clears).
- A first real run: it dials real phones, so it is Serdar's to start. Codes the run reads that Resepta's own data has not shown yet (`user_declined`, the refusal codes) come from Nudge and the provider's list; a code nobody has met reads by duration.
- Not ported, on purpose: Nudge's per-number caps and calls-per-second gap (a run makes one call at a time), a person's dial cancelling queued automated calls (none exist outside a run), transcript reading for silent calls (English word lists). Leaving a voicemail is P7.
- No prod backfill or env. Optional after deploy: set Bulk calls at once below the provider account's concurrency, with room for inbound.

P8 status (cloud sync, 2026-10-17): backend built, commit 7ab4099 and the commit that records it. `startBrowserTest` (web call, ring-time variables of a chosen customer or a stranger, overrides, draft or published version), the `agentTests` log, dry tools on a marked call as the chosen customer with would-be actions noted, the call-ended divert, metering into `usageMonthly.voiceTest*`, `browserTestResult` with the transcript on demand; purge and footprint coverage. Typechecked and linted only, no web call made. Owed: the UI (P9); a first real test to confirm `v3/create-web-call`'s answer, the metadata coming back on function calls and webhooks, and `v2/get-call`'s statuses; staged variable rows reaching the registry on `publishDraft`; a disabled agent cannot be tested.

P7 status (cloud sync, 2026-10-17): built, commits 7555f53..932012b and the commit that records this range. One Publish is one provider version titled with what changed; version history with Restore into the editor; a provider draft shows as "Unpublished draft" with Publish and Discard; voicemail as one four-answer dropdown kept by the template update; test calls and bulk dials pinned to the published version; every LLM read at its agent's LLM version; the prompt in the sans face. Typechecked and linted only. Still owed for P7: everything on screen (save bar draft state, history popover in light/dark/375px/tr/en/de, Restore, the voicemail row, the @ pills still sitting on their text in the sans prompt); one real Publish to confirm a single version with its title appears at the provider; whether inbound calls (`override_agent_id`, no version) answer with the published version or a draft, before P8 leaves drafts sitting; P8 must carry staged variable rows to their publish (`publishDraft` refreshes only the prompt mirror). No prod backfill.

P6 status (session ended 2026-10-13 by Serdar; docs finished 2026-10-17). Done and committed: (1) minimum notice per business, set on Business's General card in hours or days, unset = the old 1 hour, 0 = none, obeyed by the booking page, the manage page, both assistants' bookings (`too-soon` with nearest free times) and their moves, and `check_availability` (043cb45, ca54a7b); (2) past bookings are quiet: no confirmation for a start already passed, no cancellation notice when the business cancels one, the bin's question says so (3203e8d); (3) the conflict verdict: `schedule.judgeSlot` (outside hours, blocked time, customer busy, team member busy, full) enforced on the server in create, move and a change of person, `force` only on those signed-in writes, AGENTS.md's "nothing checks for conflicts" rule rewritten (18ee6a6), and the sheet's live verdict line, its "Book/Move/Save it anyway?" question, the drag's "Move it anyway?" dialog and the help centre's staff step (448ac6e); (4) checked: a staff move re-sends the booking confirmation verbatim at the new time ("Your appointment at [business] is booked for [date]", ICS at a bumped sequence). Resepta has no reschedule message kind (no such `waTemplates` kind or `messageRules` trigger), so none was invented. Verified on the local backend as Serdar inside Bella with no-consent customers (every verdict case, force, the walk-in and the move into the past sending nothing; all test bookings deleted). Still owed for P6 (Serdar's click-through):
- The sheet and the drag were typechecked and linted only: never clicked through at localhost:3006. Check the verdict line (Free, each conflict, past, inside the notice) and the foot's question on a new booking, an edited time, a changed team member and from a customer record; a refused drag's dialog; the Business card's notice row in tr/en/de, at 375px and as a member.
- Docs: done 2026-10-17. `docs/subsystems.md`'s calendar section now describes the verdict (`schedule.judgeSlot`'s five conflicts and where the server enforces them), the signed-in-only "Book/Move/Save it anyway?" question and `force`, and the past-is-quiet rule; the minimum notice keeps its bullet beside lead time.
- The quiet cancel was verified by reading only: Bella has no cancellation rule.
- Not judged, deliberately or for later: reopening a cancelled booking from the list view, and the office MCP's `create_appointments` (an import of an existing book). No prod backfill: both new `orgs` fields are optional and unset keeps today's behaviour.

P5 (the calendar's look, side panel and team colours) was checked in Serdar's Chrome at his 17px base font, 1280px wide, in dark and in light (the `.dark` class taken off by hand), on Bella in English: the 1px `#dde3ea` hour lines (and dark's `#2e2e2e`, which now show across closed hours), the big day header and 22px period, the thinner now-line without its badge, the viewer's GMT offset in the corner; both sheets on the tinted 16px chrome with aligned 5rem labels, the block sheet's four rows holding 363px through every repeat and All day, the date range month (From handing on to To, flipping above for room), the time lists, Escape closing a list, a month or the delete confirm before the sheet, one test block saved and deleted; the booking sheet's When as a date and two times on one line, typed "1000" moving 15:30 to 10:00 with the length kept, the band following the sheet's time and team member, Save at one height (436px, same point) across the kind switch at 1280px and at 600px; the Team card's dots and picker (only active colleagues' colours greyed; Serdar set to Peacock froze Bella's other rows and moved nobody); five test bookings for customers without consent (each refusal logged at the gate, nothing queued, sent or alerted, and moves re-fired the confirmation into the same refusal) drawn in Peacock, Flamingo, Basil and lavender on the week, month and list, cancelled through the bin, dragged across days and resized in week view, dragged in day view (kept its person's column), then deleted; the side panel's month, team and service filters on every view including the year's server-side dots, the last row's lock, ☰ and the filters surviving a reload, the toolbar pickers when closed and at 600px; the block sheet in light; the booking sheet opened from a customer record (new chrome, the colour square, no tabs). No console errors on a fresh load (the dev log held six from hot reloads mid-edit, each fixed before its commit). Still owed for P5 (never click Update, Fix, Publish, Send or the like):
- Turkish and German on screen. The 5rem label column and the one-line When row were measured from text widths in all three languages, not seen.
- 375px: the window narrowed only to 600px (below sm at Serdar's 17px, so the phone layout was seen, not a real phone width).
- As a member (staff): the panel without colour pickers, the Team card's read-only dots, no kind tabs (so no height floor).
- A day-view Unassigned column with a booking in it, and an existing booking's bin opened from a customer record.

Deferred from P5, for Serdar: per-person blocked time (Nudge's `hostBlocks`; closures stay business-wide, and AGENTS.md now says so); Google's capitals on the weekday (not taken: no uppercase anywhere); Nudge's Peacock as the default booking colour (lavender stays first; one line in `lib/staffColors.ts` if he wants Google's blue); Nudge's calendar-settings gear (the view's own comment rejected "Edit hours" in this header); Nudge's pencil in the booking popover (the When row is already click-to-edit). The test bookings left five "no-consent" message records on Bella's customers Hediye Eryurt, Kemal Sen, Ali Takat, Huseyin Polat and Osman Kara (never shown in a thread, never alerted), and Bella's staff colours are now stored rather than resolved (Serdar Peacock; the rest as they resolved).

P4 (shell and sidebar) was checked in Serdar's Chrome at his 17px base font and 1280px window, in dark and in light (the `.dark` class taken off the page by hand, so his stored theme was never written): both panes flush with the hairline between them, the content reaching x 1280 now that the document reserves no scrollbar track under the shell (/admin still does), the product name and the page title centred at 31.88px on all eight tabs and on a customer record, every sidebar row at weight 500 with 16px/1.5 glyphs and a label that keeps its width when selected, the collapsed rail, the account row's resting surface, chevron, hover title, Google photo (and its initials when the photo fails) and the account menu without its Appearance heading, the Inbox's left column stopping at 32rem (by forcing its container's width), and `main` relative with no absolutely positioned box on any tab depending on the body; no console errors. Still owed for P4 (never click Update, Fix, Publish, Send or the like):
- Everything at 375px: the window still would not narrow (resize_window had no effect). Above all the phone tab bar, whose glyphs stay 18px but take the 1.5 stroke and whose labels are font-medium in both states now, and the drawer's product row and account row.
- As a member (staff): the sidebar without Billing.
- A real wide monitor for the 32rem cap, and the customer record's footer pairs there.

Deferred from P4, for Serdar: the account menu as wide as the account row (Nudge 6a01dbfa) and Nudge's 15rem rail (f041326f). This rail is 13rem, and the menu's stacked theme switch needs its 224px for German "Automatisch", so the menu still reaches about 11px past the hairline; a 15rem rail would make the row exactly 224px at a 16px base, at the cost of 2rem on every page. Not taken: the help centre moved under the account row and then unlinked in Nudge (615321e2, d991324e), because Nudge's help screenshots no longer match its app; Resepta's help centre has no screenshots and stays in the menu. Nudge 1a6c46ce's record labels widened to 8rem go with P12's property editors.

P3 was built while Serdar's dev server was down (tsc and eslint pass over all of src); it came up at the end and these were checked in his Chrome at his 17px base font, in dark (light only on Business and Automations): Business and Hours fields, every booking-sheet field and chip (all 2rem, the notes box's one row included), the record's Add sale and ⋯, the options pills and the add-field form's source switch, the Automations switches (where the browser found a stretched track, fixed in f46fd7f) and an opened rule's foot, the agent page's header and foot, its save bar with the @ menu (which follows a wheel scroll; Discard then exposed an old bug, fixed in 2b75ebf), the account menu and business switcher, the calendar view menu staying open on scroll, the agents table's number pickers, the inbox ⋯, the bulk composer keeping a typed draft through two Escapes and a backdrop click (and an empty one still closing on Escape), the console's Platform rows, its engine picker (search, arrows, Escape) and the template editor's lane and Visual/HTML/Preview switches; no console errors. Still owed for P3 (never click Update, Publish, Send or the like):
- Light mode for everything above except Business and Automations.
- Everything at 375px: Serdar's window would not narrow and the app refuses to be framed. Above all the Automations editor's header with Discard and Save in Turkish and German, and the booking sheet as a bottom sheet.
- As a member (staff): the "View only" pill on Business, Automations, Knowledge.
- Needs data Bella lacks: the calendar List view's row ⋯ (no appointments), the composer's + and its Emoji grid (WhatsApp not connected), the agent Connect sheet's tabs (one mode only), the variable type picker (no context rows), an editable rule's header save bar.
- The country code picker following a scroll on the record's phone.

Deferred from P3, with the phase that first needs them: DateRangeField and TimeSelect go to P5 (first user: the block sheet's From/To date and time fields; the Hours card's native time fields were a height problem the scale fixed). Later candidates for them: the composer's "schedule at" (a native datetime-local) and the date box on /appt/<token>. SearchableSelect's groups, multiple picks, typed values and inline mode, Avatar's machine tone and TagPillsEditor's suggestions and rename go to P12 (the record's picklists and signed notes). The email editor's ToolbarButton tooltip is still an absolute child (not a menu, left alone). A product call for Serdar from P3: a member's read-only cards still disable and dim their controls, where Nudge removes them ("read-only forms that stay readable" in area 2). Note for P5: the booking sheet changes height between Appointment and Blocked time.

# Nudge → Resepta port plan (2026-10-13)

Scope: 880 src/convex commits in Nudge since 357b85a (09-02) to a8086264 (10-13), +88k/-20k lines. About
two thirds is Nudge-only (triggers/journeys, the Google meetings engine, HubSpot/CRM/team, demo, personal
WhatsApp). Roughly 15k Nudge lines are portable. All paths below are absolute.

## Phase order (orchestrator's final order; supersedes section C below)

Items marked (+) come from the completeness sweep; details in section E. A Nudge commit hash after an item
means "read that commit".

| Phase | Area | Notes |
|---|---|---|
| P1 | 1. Appointment-tool hardening (+ sweep gaps, inbound dedupe) | security; backend |
| P1c | (+) Voice template v14 + boosted keywords + LLM model guard | E.5, E.flip.3, E.8 |
| P2 | 10. Customer deletion (hard delete + MCP delete with preview) | KVKK; backend; no trash yet |
| P2b | (+) "No AI calls" per customer + marketing-mail unsubscribe + Delete control on the customer page (owner-only, confirm sheet shows P2's preview counts; P2 left deletion reachable only via MCP) + org purge completeness (P2 found `platform.ts` purge misses bulkRuns, bulkRunItems, closures; sweep every org-scoped table) | E.2, E.9 |
| P2c | (+) Public pages tell the truth (help center + legal facts) | section F; legal contact email pending from Serdar |
| P3 | 2. Design primitives + i18n interpolation/plural helper + (+) UI bundle P3 items | E.12 |
| P4 | 3. Shell and sidebar (flush) + (+) left pane cap 32rem + `main` relative (cbbacbcc) | Serdar explicitly asked for the new sidebar + card design: CONFIRMED |
| P5 | 8a. Calendar visuals, left panel, staff colours + (+) 8fee4481, ac51b3c9, c49864af | |
| P6 | 8b. Conflict verdict + "book anyway" + (+) past bookings are quiet + minimum notice in hours/days | edit the AGENTS.md "nothing checks for conflicts" rule in the same change |
| P6b | (+) Bulk-call guardrails + honest outcomes + requeue/optional platform cap | E.1, E.flip.1, E.flip.2 |
| P7 | 6. Voice-agent drafts, versions, dial pinning (6f02acca) + (+) voicemail message + prompt in sans font | E.10. **Done 2026-10-17** (7555f53..932012b); screen checks owed |
| P8 | 7a. Browser-test backend | **Done 2026-10-17** (7ab4099); first real test owed |
| P9 | 7b. Browser-test UI (test card, preview card) | **Done 2026-10-17** (b4d10b3 and the UI commit after it); screen checks and a first real test owed |
| P9b | (split from P9) (+) Chat simulator: the owner chats with the WhatsApp assistant in the app, sees the reply and what it would book; nothing is sent. Test turns stay out of the disclosure check, the rate limit and the inbox; refuse the demo org; meter to the org (N 3951e57c; R chatAgent.ts, RemindersView) | E.flip.4. **Done 2026-10-17**; screen checks and a first real turn owed |
| P10 | 4. WhatsApp thread + formatter (+ 0772ac98) + (+) failed sends say why + Meta template category/rejection webhooks (a720be3b) + (triage 10-17) narrow chat spacing and joined tails (92ae96d2), Roboto inside the chat only (3298a228, d55ab896) | E.3, E.found. **Done 2026-10-17** (355f5bc..the thread-look commit); screen checks owed; the stamp's line name not ported (Resepta names no line) |
| P11 | 5a. Call cards + (+) who placed a call | **Done 2026-10-17** (the P11 commit); screen checks and a first placed call owed |
| P12 | 5b. Notes, property editors, tab title + read-only cards for members show plain values with a ViewOnlyPill instead of dimmed controls (Serdar chose this 2026-10-14, Nudge's way) + + (+) channel pills not greyed, copy phone, customer deep link + cmd-click | **Done 2026-10-17** (16d8a7f..the read-only commit); screen checks owed |
| P13 | 9. Inbox paging + customer search index + (+) customers list paging + pins persist + inbox row + find customer from any tab + HTML-only email previews | E.4, E.7. **Done 2026-10-17** (278a39d..2f4f93f); the row-dot sizes (c47c694c, 2ef5a0b4) ride P21, which resizes them again; prod owes `customers:backfillSearch` and `threads:backfill` |
| P13b | (+) Bulk run outcomes + follow-up selection | E.flip.6. **Done 2026-10-17** (b785257); screen check and a first real run owed |
| P14 | 11. Media library + (triage 10-17) Word, PowerPoint and text files from either tab (57bd2d2a) | |
| P15 | 12. Token chips | |
| P16 | (+) Address on invites (`[adres]` token + ICS LOCATION) | E.flip.8 |
| P17 | (+) Seal provider secrets at rest (optional; needs a dedicated env key and a safe rollout) | E.11 |
| P18 | (triage 10-17) Stay signed in across browser restarts: the auth cookie gets Convex Auth's 30-day lifetime (ee5537f0). R: `src/proxy.ts` | |
| P19 | (triage 10-17) Dropdown lists lift off the card in dark mode (`.menu-surface`, 04fda8a7); the country code picker types in its box, keeps open on list scroll, opens upward hugging the box, shows five rows (900c472f, a7926b1e, 7c97b857). R: `src/app/globals.css`, the country code picker in `RecordField.tsx`/`PhoneField`, menus using `useAnchoredPanel` | |
| P20 | (triage 10-17) One hover-label look: dark chip, instant, centred under the control, never a native `title` on an icon-only button; the collapsed sidebar shows its labels at once (15d2d8b7, 57b6347d, 5ffe0877, fa6a0d95, 258c9316). R: a `HoverTip` primitive, `AppShell.tsx`, icon buttons | |
| P21 | (triage 10-17, after P13) Inbox: All / Unread / Pinned always shown with one active, smaller unread and pin dots, counts without `+`, opened rows kept for this Unread visit, rounded fill on the open row, visible hover, fainter dividers from the name, a row menu (right-click or chevron: Open customer, Pin, Mark as read / unread, Mute) with Mark as unread as `inboxReads.unreadAt` honoured by every read path (4b2c868c, fe3baf2d, 63893624, bff29139, 0ed5a4bd, ea44f67c, af43925b, a868cc38, b6fcaa09, efc036f1, 0e6126a8, d4365e9a, 91735572, 2a94bb92). Owner-scope pill is Nudge-only. R: `InboxView.tsx`, `convex/messages.ts`, `lib/thread.ts`, schema `inboxReads` | |
| P22 | (triage 10-17) The Inbox and the customer record each join their two panes in one card (rounded outside only, desktop divider), dark conversation ground with one subtle border, conversation action buttons aligned with the channel pills, no "Properties" title (2e5b63e7, 46293b4d, 5b81beea, aea8bafd, bb817de5, a958416f, 18dfc375, 9ca6311e). R: `ContactView.tsx` (`TWO_PANE_COLUMNS`), `InboxView.tsx`, `ConversationPanel.tsx`, `globals.css`; edit AGENTS.md's shell section | |
| P23 | (triage 10-17, after P10) WhatsApp bubble menu: right-click or corner chevron, Reply, Copy, React (WhatsApp's quick reactions, no negative ones), Add to note; sent link buttons open from the thread without counting (daddc71e, e02706eb, b12d5cdb). One `ContextMenu` shared with P21's row menu. Reply/react only where the lane supports them. R: `ConversationPanel.tsx`, `convex/wa.ts` | |
| P24 | (triage 10-17) Calendar frame follow-ups: 0.5px hairline grid lines, toolbar above the grid card on the pane ground, compact 192px side panel with 24px mini-month rows, the panel slides open and closed (f360cad5, 5904ddbc, 14e9ee88, dda32be5). R: `AppointmentsView.tsx`, the calendar grid and side panel components | |
| P25 | (triage 10-17) A record opened over a tab names the path in the navbar as a clickable breadcrumb (`Inbox › Name`, `‹ Inbox` below sm) instead of a back arrow; the sidebar width stays fixed whatever the account name; one title inset on every tab (cba4af4c, bb22fa8b, 763509b5, 7a123cf0, 9cff4d72, 5976b84e, ca95e0f8). R: `AppShell.tsx` (`overrideTitle`/`onOverrideBack`), `AppHome`, record views; edit AGENTS.md "A page title names the page" | |
| P26 | (triage 10-17) Email editor tools: the link button opens the app's dialog (no `window.prompt`), Insert photo with Gmail's image menu and corner resize handles, one header row with a Visual / HTML segmented switch, icon tools, a picked variable goes in as the customer's value in a one-customer composer (541748dc, b4dac12e, 49c31c26, ec043a82, 1f4fafcf, 4a232eae). No dock. R: the email editor component, `ConversationPanel.tsx`, template editor | |
| P27 | (triage 10-17) Link previews: the booking page's link shows the business and what it offers on a generated card; the manage page's card names nobody and never carries its token (fbeae989). R: `src/app/book/[slug]`, `src/app/appt/[token]`, a `lib/linkPreview` | |
| P28 | (approved by Serdar 2026-10-17) Gmail-style docked email window: compose bottom-right in a dock that never closes on outside click, Sending… Undo notice, schedule send, drafts per customer, personal signatures per team member with a default per sender (0af64cfe..525197d8, a1f2e400, f762edab, d2f22780, cc709ea8, 366e1013, 4f69d1e2) | org-scoped signatures; tr/en/de |
| P29 | (approved by Serdar 2026-10-17) Booking page in cal.com's layout (month grid, time list, time zone search, terms line), embeddable on the business's website through one embed script, slot spacing by length, a Booking link button in every composer (a1ff675d, e04cce31, b1d8ff55, 84cc50fb, e3cdf771, 21041e54, 3afd3e60, c7459ed2, 77165aaa, 6387c9ad). Keep Resepta's service-first flow; only the embedded route may be framed | framing headers: only the embed route |
| P30 | (approved by Serdar 2026-10-17) Learn a customer's language from their own WhatsApp reply or answered call; a guess is replaced by evidence, a person's edit is never overridden (9670941f, 6840d688) | marker field optional; demo org untouched |
| P31 | (approved by Serdar 2026-10-17) Inter as the app's one typeface (61db65c1, bb55d8f6, d55ab896) | edit Resepta's type rule in AGENTS.md / design-language in the same change |
| P32 | (approved by Serdar 2026-10-17) List toolbars sit above the card, view controls left, the creating action right (e07ff7ae, 9afbcf03, 13bcfad1, 1c099a69) | rewrite Resepta's 'toolbar inside the card' rule in AGENTS.md in the same change |
| P33 | (approved by Serdar 2026-10-17) Each team member can upload their own photo; one resolver picks uploaded photo, then Google picture, then initials (df492c1c, b95b7aaa, 0c2ec1c7, 63cac371, 867f90d6, 2f11958a) | storage scoped by org; a member edits only their own |

## A. Feature areas

**1. Appointment-tool hardening (fixes flowing back to Resepta) — PORT.** Agents act only on the caller's own
next appointment, identified from the call or conversation. Suggest and shadow drafts change nothing until
approved, moves re-check availability, and there is a daily change cap.
- Nudge: `/Users/slm/my-portfolio/nudge/convex/meetingTools.ts`, `/Users/slm/my-portfolio/nudge/convex/lib/{meetingChange,chatEngine}.ts` (~1.1k; take the pattern, not the code).
- Resepta, confirmed by the planner in code:
  - `/Users/slm/my-portfolio/randevu/convex/http.ts` `/retell/functions` trusts a model-supplied `args.phone` before `from_number`.
  - `/Users/slm/my-portfolio/randevu/convex/voiceMcp.ts` makes `phone` a required model argument.
  - `/Users/slm/my-portfolio/randevu/convex/chatAgent.ts` runs `executeTool` writes (book/cancel/reschedule) in every mode, so a suggested reply has already changed the calendar.
  - No daily change cap found in `/Users/slm/my-portfolio/randevu/convex/booking.ts`.
- Nudge's 10-11 journal deliberately did not copy these gaps.

**2. Design primitives — ADAPT.** Fixed control heights (28/32/36px), one save bar for draft/publish editors,
read-only forms that stay readable, selects that search in place, date-range and time fields.
- Nudge: `/Users/slm/my-portfolio/nudge/src/components/{Control,EditorSaveBar,ViewOnlyPill,SearchableSelect,MultiSelectDropdown,TagPillsEditor,Avatar,DateRangeField,TimeSelect}.tsx` (~1.9k).
- Resepta: `/Users/slm/my-portfolio/randevu/src/components/{Card,RowLabel,Sheet,SegmentedControl,InfoTip}.tsx`; it has no control scale. Take the heights and the save bar; keep Resepta's shape rules.

**3. Shell and sidebar — ADAPT.** Sidebar and content run flush to the window edges with a hairline between
them; 16px icons at 1.5 stroke; row weight never changes.
- Nudge: `/Users/slm/my-portfolio/nudge/src/components/AppSidebar.tsx` (~0.3k).
- Resepta: `/Users/slm/my-portfolio/randevu/src/components/AppShell.tsx` still has the inset, rounded panes and stroke-2 icons. Serdar chose flush for Nudge on 10-12, and asked for it in Resepta too.

**4. WhatsApp thread and formatting — PORT.** The thread is matched to WhatsApp itself: plain paper, system
font, bubble tails, run spacing, 65% width, one bubble layout. The sending number shows only where it changes
or on click. Bold, italic, strike and mono render as WhatsApp would.
- Nudge: `/Users/slm/my-portfolio/nudge/src/lib/waFormat.tsx`, bubble code in `/Users/slm/my-portfolio/nudge/src/components/LeadActivityPanel.tsx` (~0.4k).
- Resepta: `/Users/slm/my-portfolio/randevu/src/components/ConversationPanel.tsx` (doodle wallpaper), no formatter. Frontend only.

**5. Contact record — ADAPT.** Call cards (outcome row, facts left, summary right, recording loaded on demand,
transcript below). Notes become signed rows instead of bubbles. Picklists become searchable menus that don't
change row height. Enter/Tab saves and moves to the next field. The contact's name goes in the browser tab.
- Nudge: `/Users/slm/my-portfolio/nudge/src/components/{CallRecording,CallPartiesLine,ContactView,TenantTitle}.tsx`, `/Users/slm/my-portfolio/nudge/src/lib/usePropertyEditor.ts`, plus parts of LeadActivityPanel (~2.1k).
- Resepta: ConversationPanel, `/Users/slm/my-portfolio/randevu/src/components/{CallDetail,ContactView,RecordField}.tsx`.
- "Booked on this call" maps to `calls.appointmentId`; Resepta stores transcripts, Nudge fetches them.

**6. Voice-agent drafts and versions — ADAPT.** Edits wait on a Retell draft. Publish creates one named
version, there is a history with restore, and Discard deletes the draft.
- Nudge: `/Users/slm/my-portfolio/nudge/convex/lib/{retellDraft,versionNote,retellAgents}.ts`, `publishDraft`/`listVersions` in `/Users/slm/my-portfolio/nudge/convex/retellStudio.ts`, `/Users/slm/my-portfolio/nudge/src/components/AgentVersionHistory.tsx` (~0.8k).
- Resepta: `publishViaDraft` in `/Users/slm/my-portfolio/randevu/convex/retellAgent.ts` publishes immediately; `/Users/slm/my-portfolio/randevu/src/components/VoiceAgentPage.tsx` keeps a browser draft and an in-session undo. Area 7 needs this to test unpublished edits.

**7. Voice-agent browser test — ADAPT.** A web call from the agent page, so no phone rings. Variables come from
a chosen customer, tests are logged with playback, and a card shows what the call would have done
(appointment, saved fields, messages).
- Nudge: `startBrowserTest` in retellStudio.ts, `/Users/slm/my-portfolio/nudge/convex/{agentTests,callPreview}.ts`, `/Users/slm/my-portfolio/nudge/convex/lib/{callVariables,callMeter}.ts`, `/Users/slm/my-portfolio/nudge/src/components/{AgentTestPanel,AgentTestsCard,TestResultView,CallChangesCard}.tsx` (~2.8k).
- Table: new `agentTests`.
- Resepta: `testCall` rings a real phone and the minutes are billed.

**8. Calendar back-port and conflict guard — ADAPT.** This is Resepta's own calendar after a month of work in Nudge.
- Visual changes:
  - Hour lines become 1px `#dde3ea` borders (Resepta's gradient lines blur at browser zoom).
  - The now-line loses its clock badge; the header gets a big date.
  - A left panel with a mini month and staff/service tick lists.
  - A colour per staff member.
  - From/To date and time fields in the booking and block sheets.
- Conflict guard: each slot gets a verdict (past, booked, outside hours, closed), and only a signed-in person can choose "book anyway".
- Nudge: `/Users/slm/my-portfolio/nudge/src/components/meetings/{TimeGrid,MonthGrid,CalendarPanel,MeetingSheet,BlockSheet,HostColorPicker}.tsx` (~2.4k), `/Users/slm/my-portfolio/nudge/convex/lib/{hostColors,meetingSlots}.ts`.
- Table: optional `staff.color`.
- Resepta: `/Users/slm/my-portfolio/randevu/src/components/{AppointmentsView,AppointmentModal,BlockSheet,WhenPicker}.tsx`, `/Users/slm/my-portfolio/randevu/convex/schedule.ts`.

**9. Inbox paging — ADAPT.** Pages of 50 load on scroll; filters and counts run on the server with capped
totals; the selected row is restored even if it's past the loaded pages; pins reachable from anywhere;
shift-click ranges.
- Nudge: `listInboxPage`/`inboxCounts` in `/Users/slm/my-portfolio/nudge/convex/leads.ts`, `/Users/slm/my-portfolio/nudge/src/components/{InboxView,PinnedJump}.tsx` (~1.2k).
- Resepta: `conversations` in `/Users/slm/my-portfolio/randevu/convex/messages.ts` stops at 200 conversations; `customers.quickSearch` loads every customer in the org.

**10. Customer deletion — ADAPT.** One paged pass over every table that holds a customer, an optional 30-day
restorable trash, and MCP delete behind a preview step.
- Nudge: `contactFootprint` in leads.ts, `/Users/slm/my-portfolio/nudge/convex/contactTrash.ts`, `/Users/slm/my-portfolio/nudge/convex/lib/contactFootprint.ts` (~0.6k).
- Resepta, confirmed: `remove` in `/Users/slm/my-portfolio/randevu/convex/customers.ts` deletes appointments and the customer row only. Messages, calls, notes, inbox pins/reads, chat turns and bulk-run items are left behind. This is a KVKK (Turkish data-protection) issue.

**11. Media library — ADAPT.** The library opens inside the dialog that asked for it; paste or drop uploads and
attaches; large images shrink in the browser; identical files reuse the existing asset.
- Nudge: `/Users/slm/my-portfolio/nudge/src/components/MediaLibrary.tsx`, `/Users/slm/my-portfolio/nudge/src/lib/mediaFiles.ts` (~1.3k).
- Table: `mediaAssets.sha256`, `lastUsedAt`.
- Resepta: `/Users/slm/my-portfolio/randevu/convex/media.ts`, with pickers in `/Users/slm/my-portfolio/randevu/src/components/BusinessView.tsx` and ConversationPanel.

**12. Token chips — ADAPT, last.** Typing `@` inserts a variable as a labelled chip in plain text, email and
notes; the stored text keeps the key.
- Nudge: `/Users/slm/my-portfolio/nudge/src/components/{TokenTextField,TokenSuggestMenu,VariableToken}.tsx`, `/Users/slm/my-portfolio/nudge/src/lib/tokenLabels.ts` (~0.9k).
- Resepta: `/Users/slm/my-portfolio/randevu/src/components/PromptEditor.tsx` already has a label @-picker; the message editors use VariableInsertDropdown. Chips would hide untranslated keys like `[isletme]`.

**SKIP (planner's list; a second-look sweep is re-checking it)**
- Triggers, Journeys canvas, trigger map, step clocks, form restart (~13k): lead-state automation.
- Bulk Action tap replies, follow-ups, link-click counting (~2k): lead-qualification campaigns.
- Activity feed rework, counters on a trigger wrapper, hourly dashboard (~4k): Resepta's thread summary already bounds its reads.
- Meta header/footer/button authoring and the templates library columns and guards (~5k): Resepta's templates are per kind, with buttons defined in code.
- Chat-agent rewrite (~5.5k changed): built on Nudge's template-button → reply-trigger flow.
- Knowledge bases and boosted keywords (~2.8k): Resepta injects its own knowledge on every call, and Retell's bases would sit in the one Retell account all businesses share.
- Call reviews / agent Notes tab (~1.9k): operator QA; if wanted, it belongs in `platform.ts`.
- Google booking accounts, meeting types, host blocks, per-contact booking links, meeting tokens (~9k): Resepta already has native booking, `/book/[slug]`, `/appt/[token]` and lifecycle rules. Google sync and per-staff availability are open product calls.
- ComposeDock, call concurrency caps, silent-call detection, stickers, dark-mode token order.
- HubSpot, deals, owners, forms, fields, property history, Baileys/Evolution, fleet tooling, demo tenant, n8n, dev tooling.

## B. Multi-tenant hazards

- **Every ported backend file:**
  - Nudge mutations import from `/Users/slm/my-portfolio/nudge/convex/functions.ts` (a trigger wrapper) and auth from `lib/functions` (`approvedQuery`, `getEffectiveUserId`). Rewrite to `_generated/server` plus `requireOrg`/`requireOwner`.
  - Nudge's deployment-wide `settings` row and feature flags become `orgs` fields.
  - Build return validators from the schema, never by hand.
- **1:** Resolve the org from the Retell agent row, and the customer from the call leg by direction, or from the conversation. Key the change cap on org + customer.
- **2–5, 12:**
  - No tables.
  - Nudge's fields are 14px; Resepta's "16px below sm" input rule (stops iOS zoom) must still win.
  - Menus go through `useAnchoredPanel`, where scroll repositions rather than closes.
  - Staff names come only from this org's memberships.
- **6:** One Retell account serves every org.
  - Resolve agent → org in a query before every Retell call, and never show account-wide lists.
  - Once drafts can sit unpublished, pin `testCall` and the bulk-run `placeCall` to the latest published version.
  - Verify which version inbound calls answer with, or a half-edited draft talks to customers.
- **7:**
  - `agentTests` carries `orgId`, indexed `by_org_agent_started` and `by_call`. Check `orgId` after every `by_call` read, since webhooks and polls have no session.
  - Starting a test checks the agent belongs to the org; "call as" searches this org's customers only.
  - Divert web tests in `/retell/call-ended` or the voiceEvents processor before `recordCall`, so no calls row, thread entry or rule appears.
  - `/retell/functions` answers dry for test calls.
  - Fetch transcripts only for this org's call ids.
  - Debit the org's wallet once, at its own rate, and record a test share in `usageMonthly`.
  - The demo org makes no provider call.
  - Can't be per-org: Retell's account-wide concurrency limit.
- **8:** Colours are resolved among the org's own staff. The verdict reads appointments `by_org_start`, Resepta's headcount capacity, and `closures.forOrg`. "Book anyway" exists only on the signed-in path.
- **9:** Paginate `by_org_thread_last` with an `orgId` prefix. Add a customers search index with `orgId` as a filter field (none exists today). Counts are scoped and capped.
- **10:** Assert `orgId` on every row, page through the scheduler, delete stored files, and clear queued sends. Resepta has no trigger wrapper, so a trash guard would have to sit at every send path; ship hard delete first.
- **11:** The dedupe index must be `by_org_sha256`. Nudge's global index would hand one salon another salon's file.

## C. Planner's original order (superseded by the table at the top)

0a tool hardening; 0b hard delete + MCP delete; 1 i18n helper + primitives; 2 shell/sidebar; 3 thread; 4a call
cards, 4b notes/editors/title; 5 media; 6 inbox paging; 7 voice drafts; 8a/8b browser test; 9a/9b calendar; 10 chips.

## D. Cross-cutting

- **npm:** add `convex-helpers` (inbox paging) and `retell-client-js-sdk` (browser test). Add `vitest`, `convex-test` and `jsdom` only if Nudge's tests come too. Don't add `use-intl`, `@xyflow/react` or `@tiptap/markdown`.
- **Schema (all additive):** new `agentTests` table; `mediaAssets` hash fields plus index, with a paged backfill per org; `staff.color`; customer search field and search index, with a backfill; test-share fields on `usageMonthly`; optional `customers.deletedAt`. Commit `convex/_generated` with each new module.
- **Env vars:** none; web calls use the existing platform Retell key.
- **Crons and HTTP routes:** none new.
- **i18n:** Nudge uses use-intl with ICU messages namespaced per view, English as master and de/tr typed against it. Resepta has one flat typed tr/en/de dictionary in `src/lib/i18n.ts`, `useT()` returning strings, `.replace("{x}")` in 47 places, no plurals, Turkish as default. Copy Nudge's strings into flat keys and split out the plurals.
- **Conflicts with Resepta's AGENTS.md:**
  - `VoiceAgentPage` is "one column, no tabs" by decision, so testing goes in a card or sheet, not Nudge's tabs.
  - Keep Resepta's pill Save on the booking sheet and its outlined `.card-action`; don't adopt Nudge's rounded-lg actions rule.
  - Area 8's conflict guard changes the documented "nothing checks for conflicts" rule; edit that rule in the same change.
  - "Blocked time is deliberately not modelled" is already out of date (closures shipped 2026-08-31); per-staff blocks still need Serdar's call.
  - The demo org shares production, so tests must check `demoMode` first.
  - The i18n section says tr/en, but the dictionary also carries de.

## E. Completeness-sweep additions (R = randevu, N = nudge)

1. **Bulk-call guardrails** (P6b). Runs stop at closing time and skip anyone rung today or already booked. A refused dial (Retell 429/5xx, carrier) goes back in the queue instead of using up the customer. Rows say voicemail, busy or refused instead of "Sent". N: b013a43b, 69100df8, ac5988a5, abbbbdff (requeue only), f6394537. R: convex/bulkRuns.ts:918-977 (no time check; a failure redials at once) and :102-113; quiet hours are read only in reminders.ts:30; BulkActions.tsx:640-652; agentReports.ts:67-70. ~150 lines. Hazards: use the org's timezone; the hold must sit inside claimNextCall because the reaper restarts runs every 5 min; keep one call per run.
2. **"No AI calls" per customer** (P2b). Honours "don't call me" without stopping reminders; today consent is the only switch and it blocks every channel (wa.ts:981-985). N: a66b71e0, 1bbb4797, b77fd4d2. R: customers schema; bulkRuns.ts:102-113; ContactView; BulkActions. ~120 lines. Hazards: its own field, never consentAt; the agent can set it but not clear it; does nothing in the demo.
3. **Failed sends say why** (P10). "Not on WhatsApp", "window closed", "opted out of marketing" instead of a bare "not sent"; the alert email stops printing `wa-cloud-http-400-131026`. N: 76762ef1 (lib/waFailure.ts). R: ConversationPanel.tsx:78-97; webhook.ts:131 drops Meta's code; lib/alerts.ts:241. ~130 lines. No provider names in copy; add codes 131049/131050.
4. **Pins persist** (P13). Today every outbound message (reminders, away-replies included) unpins a conversation (R lib/thread.ts:213, messages.ts:886,1044). Nudge 0e23423f: a pin lasts until you unpin it. AGENTS.md says keep Resepta's pin in step with Nudge's: port it and edit the pin rule (the SPENT rule) in AGENTS.md.
5. **Voice template v14** (P1c). A hard call-length cap (none set, R lib/voiceAgentTemplate.ts:474); a quiet holding line while tools run; local times in tool arguments; non-answers like "Belirtilmedi" are no longer stored and read back (R lib/voicePayload.ts:13-15). N: f2a44605, 7bf2c681, 3e61d794. ~60 lines. Existing businesses get it only through the Update banner; new wording must not name tools that older template versions lack (N ba2d956a).
6. **P1 gaps** (sent to the P1 builder): voice availability like chat; nearest times when taken; idempotent double-booking; 5-upcoming cap for agent bookings; tool-call side text not sent; approved suggestion books before sending; activity row on agent cancels; /appt changes count against the cap. N: 0cce0bf1, 158a7eb9.
7. **Customers list paging** (P13). Customers list and the booking picker reach every customer, not only the newest 1,000; the 1,000-row read stops re-running on every message (R customers.ts:169-178). N: 5cf7d77c, bf8d6ded, 8d56ec35. R: customers.ts list/options, CustomersView, useTableState, AppointmentModal. ~400 lines. Needs the org-filtered search index.
8. **LLM model guard** (P1c). Haiku 4.5 rejects `effort` (R lib/llm.ts:209) yet /admin offers it (platformConfig.ts:314); the 5.5 models meter at $0 and slip past the budget cap. N: 08311abc. ~10 lines. Don't change the default model (Serdar's call); make the guard and the metering correct.
9. **Marketing-mail unsubscribe** (P2b; Nudge code from before the base commit, 357b85a:convex/http.ts:210-246). Bulk and winback emails carry an unsubscribe link and a List-Unsubscribe (+ One-Click) header. R: http.ts, lib/email.ts, schema, skipReason. ~130 lines. Every org sends from one shared domain; marketing kinds only; resolve the token to its org.
10. **Voicemail message** (P7). Call runs leave a message instead of hanging up. N: 8782af94, 42f9f6a7. R: retellAgent.ts (syncTemplate overwrites voicemail_option, :1786-1813), VoiceAgentPage. ~170 lines. Check agent → org before writing; demo guard.
11. **Seal secrets at rest** (P17, optional). WhatsApp, Evolution, cal.com keys are plain text today (R schema.ts:327,697,800,1569). N: 85123109 (lib/secretBox.ts). Use a DEDICATED env key (Nudge derives from JWT_PRIVATE_KEY; here a rotation would cut off every org). Reads must accept both sealed and plain values so deploy order can't break sending.
12. **UI bundle.** P3: segmented control visible in dark mode (globals.css:154,158); borderless picker buttons and a 14px (i); Escape keeps a typed bulk draft (Sheet.tsx:43,70); menus reposition instead of closing on scroll (AppointmentsView.tsx:684, InboxView.tsx:106). P4: left pane capped at 32rem; `main` relative (cbbacbcc). P12: live channel pills not greyed out (FeedFilterPills.tsx:128); copy phone; customer deep link and cmd-click (the link must carry the org). P11: who placed a call. P7: prompt in the sans font. P13: inbox row matches Nudge's; find a customer from any tab; clean previews for HTML-only email. N: b43691f4, de116934, 68e5f13c, ca1c1621, 1a6c46ce, 1a1b00dd, fb9e9f20, 593a8107, 8b9eb339, d496e615, c47c694c, 2ef5a0b4, bde0a4ea, 2bae1a45.
- **found**: Resepta ignores Meta's template category and rejection webhooks (R webhook.ts:92-111; N a720be3b) → P10.

Flipped skips:
- flip.1 **Concurrency → requeue + optional platform-wide cap** (P6b). N abbbbdff. The shared Retell account also carries every org's inbound calls.
- flip.2 **Honest outcomes** (P6b) read from disconnect codes, not Nudge's English transcript word lists. N 96b2012a.
- flip.3 **Boosted keywords** (P1c). Speech-recognition hints from the business, service and staff names, set at publish. N 3379705e, 61788709. R retellAgent.ts:1786-1816. Only this org's rows; never overwrite an existing list with `[]`.
- flip.4 **Chat simulator** (P9). The owner chats with the assistant in the app and sees the reply and what it would book; nothing is sent. N 3951e57c. R chatAgent.ts, RemindersView. ~400 lines. Test turns stay out of the disclosure check, the rate limit and the inbox; refuse the demo org; meter to the org.
- flip.5 **Inbound dedupe** (sent to P1).
- flip.6 **Run outcomes + follow-up** (P13b). See who replied or booked after a run, filter on it, "select these" for a second run; fixes the "Replied" label that never shows (R email.ts:150-159 needs a templateId bulk rows don't have). N 2eeef0a7, 12eb5b78, d8348836. ~250 lines. Check item.orgId; ignore MCP-seeded appointments.
- flip.7 **Past bookings are quiet** (P6). Logging yesterday's walk-in no longer texts "confirmed" (R schedule.ts:235; only reminders check for the past, wa.ts:868). N c8e1e523.
- flip.8 **Minimum notice in hours or days** (P6). Per org; booking page fixes it at 1h today (booking.ts:55) and agents only refuse past times. N d76a2ad8. R booking.ts, http.ts, chatAgent.ts.
- flip.9 **Address on invites** (P16). ICS LOCATION + an `[adres]` token. N e88fe333. R lib/ics.ts, lib/renderTokens.ts.

## F. Unbacked public claims (P2c)

Help center (`src/components/HelpCenter.tsx`, served at docs.resepta.xyz) and legal pages (`src/lib/legal.ts`) are in this repo; `src/lib/landing.ts` is rendered only by the unused Landing.tsx (the live resepta.xyz is a separate marketing repo, not on this machine).
- legal.ts: "There is no charge at present" (366/444/524) is false (trial credit + Stripe top-ups, convex/lib/foundOrg.ts:31-45, wallet.ts).
- legal.ts: "cal.com handles the calendar side" and cal.com as a sub-processor (326,360,121 / 404,438,200 / 484,518,279): cal.com is parked.
- legal.ts sub-processor and stored-data lists (97-123 / 176-202 / 255-281) leave out OpenAI and Anthropic (receive customer messages), Stripe, Evolution and outbound calls. KVKK risk.
- legal.ts "No consent, no message… a lock in the code" (108/187/266): away-replies and assistant replies skip consent by design (wa.ts:693).
- legal.ts "deleted within thirty days… can be recovered"; "close your account whenever you like" (129,385 / 208,463 / 287,543): only the operator can delete and the purge starts at once (platform.ts:2251-2254).
- legal.ts "we will answer within thirty days" (136/215/294) with `LEGAL_CONTACT_EMAIL = ""` (legal.ts:26): no address shown. NEEDS Serdar's address.
- HelpCenter.tsx 45,49,98,100,105,279: "conflict checking requires a connected scheduling account" / "double-booking protection is not available": false (voice, chat and booking page check capacity; cal.com hidden). Re-check after P6 adds the staff-side verdict.
- HelpCenter.tsx 232: "New workspaces begin with a confirmation and one 24-hour reminder": five rules are created (messageRules.ts:155-159).
- i18n.ts 1334-1336 "Your confirmation is on its way by WhatsApp or email": overstated (paused rule, no channel, missing consent).
- landing.ts (unused): Google Calendar sync (136,157 / 248,269 / 360,381), $49/$99/$199 plans (145-180…), "taking bookings through WhatsApp/email is next" (140/252/364, out of date the other way).


---

# Appendix: builder brief

# Porting Nudge into Resepta: rules for every phase

You are porting ONE phase of Nudge's Sept-Oct 2026 work into Resepta. Serdar (the
product owner) asked for everything relevant, necessary and useful for Resepta,
with nothing left out. Port the full user-facing behaviour of your phase, adapted
to Resepta, not a token version of it.

## Repos

- **Resepta** = THIS repo, `/Users/slm/my-portfolio/randevu` (brand Resepta; the
  repo and infra keep the old "randevu" name). Multi-tenant: ONE Convex
  deployment serves every business.
- **Nudge** = `/Users/slm/my-portfolio/nudge`. READ-ONLY source, never modify it.
  Single-tenant (one deployment per client), so its code never scopes by org.
  Base commit for "what changed since": `357b85acbeeaf6603a7d0c87b7b7fd110e4fbb2c`.
- The plan (areas, hazards, order, cross-cutting) is `plan.md` next to this file.
  Your phase's area there is your spec; the hazards (section B) for your area
  are mandatory.

## Read before writing code

1. `randevu/AGENTS.md` in full. These are the rules: the org-scoping invariant,
   the delivery queue, cron cost, the two kinds of template, i18n, the demo org,
   the mobile rules, editing/adding/density, popovers, tabs, page-stack,
   scrollbars, borders, card action tiers, one state one hue, explanations behind
   InfoTip, and the bandwidth rules (thread summary via noteMessage/noteCall/
   recomputeThread; syncAppointmentSchedule).
2. The `randevu/docs/subsystems.md` sections for the area you touch.
3. `randevu/convex/_generated/ai/guidelines.md` (Convex rules). The project pins
   convex ^1.37: don't use APIs newer than what `node_modules/convex` ships.
4. Nudge's WHY: grep `nudge/docs/journal/2026-09.md` and `2026-10.md` for your
   area, and the `nudge/AGENTS.md` rules for it. Then read the Nudge code.
5. Resepta's existing code for the area. The two share ancestry and have diverged
   in both directions. Merge Nudge's improvements INTO Resepta's current code;
   never overwrite Resepta-only behaviour (multi-business, demo mode, operator
   surfaces, per-org settings, the native booking lane).

## Hard rules

- **Mechanisms, not Nudge's IA.** Fit Resepta's surfaces, names and vocabulary
  (Team / Member / Available; Customers, not Contacts; appointments, not
  meetings; services, not meeting types).
- **Org scoping.** Every new table has `orgId` and an index whose first field is
  `orgId`. Every public query/mutation/action resolves the caller's org with
  `requireOrg(ctx)` (or the owner/role helper Resepta's equivalents use) from
  `convex/lib/orgAuth.ts`, and scopes every read and write to it. Webhook, HTTP
  and internal paths resolve the org from a trusted row (agent row, phone-number
  binding, token), never from client or LLM input. After any lookup by a non-org
  key (by id, by call id), assert `row.orgId === orgId`. Cross-org reads live only
  in `convex/platform.ts`.
- Nudge's `convex/functions.ts` trigger wrapper and its `lib/functions` auth
  helpers (`approvedQuery`, `getEffectiveUserId`) do not exist here: use
  `_generated/server` + `requireOrg`. Nudge's deployment-global `settings` row and
  flags become per-org fields on `orgs` (or `platformConfig` if truly
  operator-global).
- **Schema changes are additive.** New fields on existing tables are
  `v.optional(...)`. Any backfill is an idempotent, paged internalMutation that
  reschedules itself. Run backfills only against the local dev deployment, and
  list in your report the ones prod will need.
- `returns` validators must match handler results exactly. Convex validates
  returns at runtime and TypeScript cannot catch an extra property.
- Writes that insert messages/calls call `noteMessage`/`noteCall`; writes that
  change `startAt`/`status`/`reminderSentOffsets`/`winbackSentAt` call
  `syncAppointmentSchedule` (see AGENTS.md).
- **i18n.** Every user-facing string goes through `useT()` with keys in `tr`, `en`
  AND `de` in `src/lib/i18n.ts`. Turkish is the default language: write natural
  Turkish and German, not literal translations. Nudge's use-intl ICU messages
  become flat keys; plurals become separate keys or a small helper.
- **UI.** Card `action` slot with `.card-action`; floating panels through
  `createPortal` + `useAnchoredPanel` (never `absolute` inside a card); tabs
  underlined; 16px inputs below `sm`; nothing shifts under the pointer;
  explanations behind `InfoTip`; no borders on buttons; emerald = on,
  amber = unsaved, violet = pin; `.page-stack` on stacked-card views.
- **Copy:** plain and specific, no marketing tone, no em dashes in UI copy.
- **Demo org:** any path that would reach a provider checks `orgs.demoMode`
  first, before credentials.
- **SAFETY.** Resepta has NO real customers: every business, agent and customer,
  prod included, is test data (Serdar, 2026-10-13). Still, the local dev
  deployment now holds Bella's real Retell key, and its agents are the SAME Retell
  agents prod's test setup uses. Syncing or publishing from dev re-points those
  agents at the local backend, which Retell cannot reach, and breaks them for
  prod. So: READ-only provider calls (e.g. listing Retell numbers, fetching an
  agent) are fine for verification. Never trigger a provider WRITE (publish,
  sync, update agent, dial, send WhatsApp/email, charge) from a script, a
  `npx convex run`, or a test. Never `npx convex run` anything that sends,
  publishes, dials or mutates a provider. LLM calls cost money: don't make them.
- **Servers.** Don't start or stop any. Serdar's `npm run dev` is running: Next on
  :3006 plus a local Convex backend that auto-pushes `convex/` on save. Never push
  git, never deploy, never touch prod.
- **Git.** You are the only agent editing this repo right now. Stage files
  explicitly (`git add <paths>`), never `git add -A` or `git add .`, and never
  commit scratch files.

## Definition of done, per logical unit (commit as you go, one unit per commit)

1. `npx convex codegen` if `convex/` changed; commit `convex/_generated` with it.
2. `npx tsc --noEmit` is clean.
3. `npx eslint <touched files>` shows no new errors.
4. Commit to `main`. Message style (see `git log`): a plain sentence saying what
   changed for the user, a short body with the why, and this trailer line:
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
5. If you changed behaviour that an AGENTS.md rule describes (or made one stale),
   edit that rule in the same commit and add a dated entry to
   `docs/journal/2026-10.md` (follow the existing journal format; create the month
   file if it is missing).

## Report (your final message, max 400 words)

Commits (hash + subject); what a business owner will see; what you deliberately
did not port and why; prod follow-ups (backfills to run, env, provider config);
risks; and a precise click-path for verifying at http://localhost:3006 (Serdar is
signed in as the platform operator, viewing the Bella workspace).
