# Subsystem reference — how Resepta works, as built

One section per subsystem or surface, as it stands today. Read the section
for the area you are about to touch. The rules that govern all of it are in
[`../AGENTS.md`](../AGENTS.md); the story of how each got this way is in the
[journal](journal/README.md).

When a session changes how something works, EDIT its section here in the
same change — a stale paragraph here is worse than none. Sections carry the
date they were written or last rebuilt; a newer section on the same surface
wins. Moved out of AGENTS.md on 2026-09-03, text as it stood then.

## Message model

- Outbound rides Meta template messages: `waCloudTemplatePayload` in
  `convex/lib/waCloud.ts`. Body variable convention is fixed: `{{1}}` customer
  first name, `{{2}}` business name, `{{3}}` appointment date+time (formatted in
  the org's timezone/locale). Quick-reply buttons carry
  `confirm:<appointmentId>` / `cancel:<appointmentId>` payloads.
- Inbound comes through one webhook (`convex/http.ts`, `/whatsapp/webhook`),
  resolved to an org by `metadata.phone_number_id` — never by guessing from the
  customer's number alone. Button payloads confirm/cancel the exact
  appointment; bare "EVET"/"İPTAL" text answers the appointment the latest
  WhatsApp reminder or confirmation to that customer was about
  (`webhook.typedReplyTarget`, 2026-10-13). An İPTAL whose appointment was
  cancelled inside the last three minutes of the customer's changes is the
  same İPTAL again and changes nothing. With no such message the next upcoming
  appointment is used only when it is the only one; with several, nothing is
  guessed and the text goes to the assistant or the team like any other.
- **A delivery seen twice is one message (2026-10-13).** Meta retries a
  webhook it did not see acknowledged and Evolution replays events, so
  `webhook.processInboundMessage` (both lanes' one entry) returns at once when
  a row in the SAME org already holds the message's wamid. Before that every
  retry was a second bubble, a second staff alert and a second agent turn.
  `by_wamid` spans all orgs, so the org is matched in code.
- **A number may also receive in Nudge (2026-10-15).** Operator env
  `WA_WEBHOOK_MIRRORS` is an optional JSON array of `{phoneNumberId,wabaId,url}`.
  After signature verification, `/whatsapp/webhook` durably schedules a copy
  containing only the matched number's messages/statuses and its WABA's
  template review events. Other businesses' entries never cross over. The copy
  is signed with the existing app secret and retries failures at 10s, 1m, 5m,
  15m, 1h and 3h. Removing a route also stops its queued retries. Resepta's
  processing and Meta callback stay in place; both apps can send independently.
  Enabling a second automatic assistant is a separate configuration decision.
  Current route: Autotakt `+90 224 322 05 71` → Takt (`abundant-eel-649`).
  An additional route copies `+43 5372 23555` (phone `1324083350787919`, WABA
  `2227815671344503`) to Takt too. Meta phone verification and explicit Cloud
  API registration completed on 2026-10-15; Graph reports CONNECTED / VERIFIED.
  It has no `waAccounts`
  row in Resepta: this is forwarding through the platform app, not a claim that
  an appointment workspace there has the Austrian number assigned.
- **Attachments, both directions (2026-08-26).** Meta hangs every media type
  under a key named after `message.type` with the SAME shape — `{ id, mime_type,
  caption?, filename? }` — so `webhook.ts` reads it generically rather than
  branching per type. `id` is a handle, not the file: it resolves to a URL that
  lives ~5 minutes and only serves to a request carrying the access token, which
  is why bytes are copied into Convex storage at arrival and never linked
  (`wa.downloadInboundMedia` → `lib/waCloud.fetchWaMedia`, capped at 20 MB and
  checked twice — `file_size` is Meta's claim, the byte count is the fact).
  - `messages.mediaContentType` is written at ARRIVAL from the webhook, not at
    download. That is what lets a failed fetch render "voice message · could not
    be loaded" instead of a blank bubble, and blank bubbles previewed as
    "Şablon mesajı", which named the one thing they definitely were not.
  - `mediaFileName` is documents-only and is the name the CUSTOMER sees. Its
    presence is also how a voice NOTE is told from an audio FILE: a recording
    carries no filename because nobody named it.
  - One renderer, `src/components/MessageMedia.tsx`, over the shared kind rules
    in `convex/lib/mediaKind.ts` (imported by both server and client on purpose;
    a client copy is what drifts). Voice notes arrive as OGG/Opus — Safari may
    refuse to decode, and a refused `<audio>` still RENDERS as a dead player, so
    a decode error falls back to the file chip.
  - Outbound, a document is its own Meta payload with a `filename`, NOT an image
    with a different link — sending a PDF through the image payload is rejected.
    Both send sites branch on it: `wa.sendSession` and the scheduled dispatch.
    The scheduled one reads `mediaFileName` off the ROW, so renaming a library
    asset between composing and sending cannot change what goes out.
  - Sends only work from a DEPLOYED backend. Meta fetches the file from the URL
    itself, and in dev `ctx.storage.getUrl` returns a 127.0.0.1 address.
- **Reading a thread you are already in (2026-08-26).** The inbox dot's read
  stamp and the blue-tick receipt are both keyed on the NEWEST INBOUND item in
  `ConversationPanel`, not on `ContactView` mounting. The mount stamp covered
  every case except the commonest: the customer answers while you sit in their
  thread typing back, and the dot then re-lit behind the reader for a message
  on the screen in front of them (Serdar hit this live on 2026-08-26).
  - Two separate keys. The dot's is every channel — an inbound CALL lights it
    too — while the tick's is WhatsApp only, because a call has nothing on
    WhatsApp to acknowledge.
  - Both gated on `useWindowPresence` (visible AND focused). A thread parked on
    a second monitor all afternoon must not answer for a person who is not
    there — and with receipts live, an unfocused window would be telling the
    customer a human read them when nobody did.
  - `ContactView`'s mount stamp stays. It costs one write and it covers a
    contact whose panel renders no inbound rows at all.
- **Read receipts / blue ticks (2026-08-26).** `wa.markThreadRead` (mutation,
  decides) → `wa.sendReadReceipt` (action, tells Meta) → `stampReadReceipt`.
  Marking ONE message read marks every earlier message in that conversation, so
  only the newest inbound wamid is ever sent, and the high-water mark lives on
  `customers.lastReadReceiptWamid` — a per-message `readReceiptAt` stamped on
  the newest row alone would be a field whose name lies.
  - **Deliberately NOT `messages.markConversationRead`**, which is the inbox
    dot. That fires once on contact-page mount; blue ticks are keyed on the
    newest inbound message instead, because one arriving while the thread is
    already open has to tick immediately and the dot has no reason to move.
  - Fires on every render of an open thread by design; the wamid comparison is
    the guard.
  - Failures are swallowed with a warn — no row, no alert, no retry. Meta
    refuses receipts for messages older than roughly a day, so a thread nobody
    opened for a week would otherwise log failures nobody can act on, and the
    visible cost of a miss is two grey ticks for another minute.
  - Cloud lane only. Evolution is a linked handset that owns its own read
    state, and Baileys needs the full message key this lane never stored.
- **Reactions (2026-08-26).** A reaction is not a message and never becomes a
  row: it carries an emoji plus the wamid of the message it belongs to, so
  `webhook.ts` looks that row up on `by_wamid` and patches
  `messages.reactionEmoji`. An EMPTY emoji is how Meta signals one being taken
  back, and patching to `undefined` deletes the field, which is the right
  behaviour here (elsewhere it is a trap).
  - ONE field, and `direction` says whose emoji is in it — the customer's on an
    outbound row, ours on an inbound one. That invariant is why `reactToMessage`
    refuses to react to our own messages: it would overwrite theirs.
  - The reaction path stamps `lastInboundAt` (a person who reacts has engaged)
    but does NOT alert staff or wake the chat agent. Paging someone for a
    thumbs-up teaches them to ignore the alerts that matter.
  - Outbound reactions write only AFTER Meta accepts. Write-then-rollback would
    put an emoji on the salon's screen that the customer never saw, and a
    reaction is exactly the signal nobody goes back to verify.
  - The Evolution lane refuses (`EVOLUTION_NO_REACTION`): reacting over Baileys
    needs the full message key, which that lane never stored.
- **Template approval (2026-08-26, `convex/waTemplates.ts` +
  `convex/lib/metaTemplate.ts`).** A `waTemplates` row IS the submission:
  `submit` converts the authored named-token body to Meta's positional
  placeholders, attaches a worked example per variable, and POSTs to
  `/<WABA_ID>/message_templates`. Status arrives three ways and all three are
  handled — the create response (Meta sometimes auto-approves inline), the
  `message_template_status_update` webhook (dispatched in `webhook.ts` BEFORE
  the phone_number_id guard, because a template verdict carries no
  phone_number_id and was being dropped by it), and `syncFromMeta`.
  - **`metaParams` is the contract.** It records which canonical token sits
    behind each `{{n}}`, and the send replays it. Unset means the old hardcoded
    triple ({{1}} first name, {{2}} business, {{3}} date+time), which is exactly
    what every hand-registered template declares — so those keep sending. Read
    off the row that owns the metaName (`metaSource`), never off the content
    row: those two legitimately differ, and crossing them fills one template's
    placeholders with another's tokens.
  - **Declare exactly what the send passes.** `sendAppointmentMessage` attaches
    two quick replies on every lifecycle send, and Meta refuses a send whose
    button components the approved template does not declare.
    `metaTemplate.buttonsFor` is the one answer both sides read.
  - **Meta rejects an empty body parameter (132000) and fails the whole send**,
    so a token with no value falls to the owner's `variableDefaults` and then to
    a dash. `defaultForKey` exists because that table is keyed by the token AS
    TYPED ("ad") while metaParams is canonical ("firstName").
  - **Newlines and 4+ spaces in a parameter are also rejected.** Tokens that
    render multi-line ([service], [pricelist]) or get stripped by review (the
    links) are in `metaTemplate.UNSENDABLE` and refuse the submission by name.
    They stay legal in the same body on email and Evolution, which have no
    approval and no parameter rules. **Known live consequence:** a campaign's
    {{3}} is the whole typed message, so a campaign written with line breaks is
    refused per recipient. One paragraph sends. See `CAMPAIGN_BODIES`.
  - `campaign` registers a fixed WRAPPER, not the row's words — that is what
    makes one approval serve every run. `out_of_hours` is never templated: the
    customer just wrote, so the window is open.
  - Status normalises Meta's nine values into four. `status === "approved"`
    gates every Cloud send, and a fifth value would have to be handled correctly
    at each read or a template would quietly become unsendable; the raw word
    survives in `metaStatusDetail` for display.
- Reminders are cron-driven (`convex/crons.ts` → `reminders.tick`, every 5
  min): offsets come from `orgs.reminderOffsetsHours` (default 24h and 2h
  before start). The tick stamps `reminderSentOffsets` BEFORE scheduling the
  send — that ordering is the double-send guard across overlapping ticks; keep
  it.
- Status moves on its own in ONE direction: `appointments.completePast`
  (hourly) marks `scheduled`/`confirmed` bookings `completed` once their day is
  over in the ORG's timezone. `no_show` stays manual and that is the point —
  `reminders.tick` sends a win-back only for `no_show`, so it is the one status
  worth a tap, and the owner has until closing to mark it. Nothing ever moves a
  booking back to live; `cancelled` and `no_show` are left alone.

## Onboarding (built 2026-08-21) — the wizard, presets, billing for everyone

Serdar's brief, built overnight: a world-class first-run. What holds now:

- **The one-question gate is a five-step wizard** (`OnboardingWizard.tsx`,
  still gated on `org.name === ""` in AppShell): language → business name →
  industry + prefilled-or-blank → business info → phone number. The NAME is
  saved LAST, deliberately: naming unlocks the shell and schedules voice
  auto-provisioning, so it is the commit point for everything the wizard
  collected, and an abandoned wizard simply reopens next visit (every earlier
  write is idempotent or additive). The language step persists `org.language`
  immediately so provisioning and every later write happen in it. The name
  step pre-checks availability (`onboarding.nameAvailable` — same one-bit
  answer the name-taken error already discloses; the definitive check stays
  in `orgs.update`). Replay it in dev with
  `npx convex run devSeed:resetOnboarding '{}'` (`wipe:true` also clears the
  catalog; `devSeed:setOrgName` puts a name back without walking the wizard).
  - **The language step STAYS a step, PRESELECTED with the landing's
    language** (Serdar, 2026-08-21, after weighing dropping it entirely and
    a field-on-the-name-step): the agent and every customer message are born
    in this language, which earns it a screen. What protects the first
    impression is around the step, not the step: AppShell's language sync
    STANDS DOWN while the org is unnamed — new orgs are born `language:
    "tr"`, and before this a German visitor's wizard flipped to Turkish the
    moment settings loaded. A header-pills version of the control shipped
    for an hour and died (three bare two-letter codes explain nothing);
    a no-step inherit-only version died in review the same day.
  - **The card holds ONLY the step, and its heading is the step's QUESTION.**
    "Welcome!" as the title with the real question demoted to subtext, plus
    language pills and sign-out crammed into the card's title row, was three
    unrelated things fighting on one line (Serdar, same day, in those
    words). Brand mark and sign-out are PAGE chrome — top-left / top-right,
    outside the card. The card sizes to its step between a floor
    (min-h-[340px]) and the viewport — NOT /book's fixed height: that rule
    was written for steps that hold similar amounts, and one input vs eight
    industry options is not that, so a fixed card left the name step crammed
    at the top of a void.
- **Sign-in is the /signin page** (`SignInCard.tsx`). It was also a dialog
  over the landing from this day until the landing left for the marketing
  repo (2026-08-24); the dialog and the leftover landing component were
  deleted on 2026-10-13, so the card on /signin is the one place the OAuth
  flow starts. The privacy/terms links live INSIDE the card because Google's
  consent-screen review wants them wherever that flow starts. The Google
  button wears Google's own G on a bordered button, not an anonymous accent
  block. The product mark is shared from `BrandMark.tsx` (/signin and the
  wizard chrome). `app.tagline` says "AI front desk",
  matching lib/brand's DEFAULT_TITLE; it read "WhatsApp appointment
  reminders" long after the product outgrew it.
- **Industry presets are ORG DATA, seeded once** (`lib/industryPresets.ts`, a
  PURE module the browser may import; applied by `convex/onboarding.ts`).
  Seven verticals × three languages seed services and voice-sourced contact
  fields; field KEYS are fixed in the module (language-stable addresses),
  services dedupe by key so re-applying never doubles a price list. NO PRICES
  seeded, ever — an invented price is a claim about the business; durations
  are a guess the owner corrects in seconds. `orgs.industry` remembers the
  answer; Business → General grows an Industry row whose select only records
  and whose "Reset to defaults" re-seeds behind a confirmation naming the
  cost (services deleted — safe, appointments snapshot their lines; fields a
  voice agent references SURVIVE the reset, deleting them would wedge the
  next publish).
  - **The catalogue stays in CODE; /admin → Onboarding is an OVERRIDE layer**
    (Serdar, 2026-08-22: "realistically Claude will still own updates to the
    prompts and verticals, but I should be able to quickly see or do quick
    edits or add verticals for later"). A vertical with no row in the
    `industryPresets` table is served straight from `lib/industryPresets.ts`,
    so a catalogue commit still reaches everything nobody has edited, and
    Revert-to-code is deleting a row. Resolution lives in
    `lib/industryPresetStore.ts` (the pure module stays pure); the Convex
    surface is `convex/industryPresets.ts`, wrapping it the way
    `platformConfig.ts` wraps `lib/platformConfig.ts` — but with the fallback
    pointing the OTHER way, because here the code is the artifact people can
    see, diff and revert.
    - `edited` compares CONTENT, not row existence, so switching a vertical
      off does not report drift it does not have. The console shows the
      Edited chip and an "improvements no longer reach these" banner, and the
      editor emits the TypeScript literal to paste back into the module —
      porting is the intended end of an override's life, not an afterthought.
    - `active: false` hides a vertical from the wizard and keeps it resolving,
      so a business already on a retired vertical keeps its reset working.
      Business settings passes its own answer as `catalogue({ include })` so
      that vertical still has a NAME in the picker.
    - The wizard and Business settings read the catalogue from the SERVER
      now. They used to import the module into the bundle, which meant a
      vertical added or retired in /admin reached nobody until a deploy.
      `catalogue` is deliberately unauthenticated: it is the same data the
      browser already downloaded, and it must answer for a user whose org is
      still unnamed.
- **The Bella port**: the two prompt refinements Serdar hand-tuned into the
  prod "Bella Randevu Asistanı" (de_autotakt workspace) live in the template
  now — `{{next_appointment}}` in the context block and greet-a-known-caller-
  by-name-once — in all three languages, prompt-text only, no version bump.
  `DEFAULT_VOICE_IDS` gives auto-provisioning a curated voice per language
  (tr keeps Bella's minimax-Camille) instead of `voices[0]`.
  - **⚠️ The preview clips NAME THE PROVIDER, and that is unfixed** (Serdar,
    2026-08-21, on hearing the new picker: "all agents say that they're from
    retellai"). `previewUrl` is Retell's own ~7s marketing sample hosted on
    their S3, and the voice in it introduces itself as a Retell AI agent —
    so the one surface that plays audio to a salon owner breaks this file's
    own rule that Retell is an implementation detail salon-facing UI never
    names. It cannot be fixed at Retell: their API has list / retrieve /
    clone / search-community and NO synthesize endpoint, so there is no way
    to ask them for a different sentence in the same voice. The shape of the
    real fix, when it is worth doing: these are minimax voices, so generate
    the clips through MINIMAX's own TTS API with the same voice ids, saying
    a receptionist line per language, store them in Convex storage and serve
    `previewUrl` from us. That also upgrades the sample from a vendor ad
    to the thing the owner is actually buying. Until then the leak stands and
    is known — do not "discover" it again.
  - **The voice catalogue is MINIMAX-ONLY** (lib/voiceCatalogue, Serdar,
    2026-08-21): the old "platform-maintained" filter excluded every minimax
    voice, so the curated default was never in the tenant's picker and Sun
    Klinik's Turkish agent was born speaking retell-Alejandro. One engine
    family, multilingual, the one Bella was tuned on. `keepId` still lets an
    agent already on an off-list voice show what it actually uses.
  - **Auto-provisioned agents are named after the BUSINESS** ("Sun Klinik
    Sesli Asistanı", not "Randevu asistanı" — same day): every new agent
    sharing one neutral name filled the shared Retell workspace with
    indistinguishable rows.
- **Knowledge reaches the VOICE agent at ring time**: `{{knowledge}}` is a
  built-in in `beforeCallContext` (capped ~8k chars, cut between blocks) with
  its prompt line in all three GENERAL_PROMPTS — an edit reaches the very
  next call with no republish, like services and staff. The Knowledge editor
  is the rich editor now (`EmailBodyEditor` compact, no token dropdown), on
  the notes model exactly: no is-it-html flag, `bodyIsHtml` judges the body,
  and EVERY agent read — `knowledge.forAgent`, chatAgent's own query, the
  ring-time builtin — flattens through `noteText`, so what reaches a model or
  provider is words only. Do not let a send path read the raw column.
- **Billing is every owner's tab, glued above the profile** (BILLING_TAB in
  AppShell, rendered inside the account-edge container above UserMenu — not
  a foot tab). Prepaid owners see the wallet (unchanged); invoice owners see
  the meter + soft budget, ported off the voice strip, WHICH LOST ITS BILLING
  CHIP — the bill belongs to the business, not to one channel. Staff never
  see money; the deep-link guard redirects them.
- **Billing mode has a platform default, STAMPED at founding sign-in**
  (`defaultBillingMode` in platformConfig, pills on the Platform tab's
  Billing section). Stamped, never resolved at read time: flipping the
  default must not silently switch existing tenants to prepaid with a zero
  wallet, which declines their calls at ring time. `trialCreditUsd` rides
  beside it: an org born prepaid gets the welcome credit once, through
  `applyWalletCredit` (the one credit path) with the new source `"trial"`,
  scheduled from auth.ts so it runs in a real mutation ctx.
- **Number provisioning is a request with a document**
  (`convex/numberRequests.ts`, table `numberRequests`): the wizard's last
  step and the Voice tab's card (`NumberRequestCard`, which also owns the
  shared upload hook) take the company registration (PDF/photo, 10 MB —
  required in Türkiye, same flow for DACH/UK) and promise a number within
  24h. One live request per org; re-uploading replaces anything not yet
  approved. The operator's half lives in platform.ts (the standing rule):
  `orgNumberRequests` + `decideNumberRequest`, rendered as a "Number
  provisioning" card on the admin org page's Voice agent tab — download,
  approve, or deny with a note the salon reads. The decision is the
  operator's cue to go buy the line at the provider; the app still never
  purchases numbers.

## Wiring a Meta Cloud number (walked end to end 2026-08-26)

The first real Cloud API number went live for the **Bella** workspace on this
date. The env vars and the code were never the hard part; the two traps below
were, and **neither writes a log line anywhere on either side**. Meta reports
the message as sent, the app receives nothing, and no error exists to find.

**Trap 1: the app must be subscribed to the WABA.** The webhook-field toggles
in the app dashboard (`messages` and friends) are app-level settings meaning
"when I get events, send me these fields". They do not link the app to a
specific WABA. Granting the system user full access to the WABA does not do
it either — that grants permission to act, not event delivery. It is a
separate call, and nothing in Meta's UI hints at the distinction:

```bash
# empty data array = this is the bug
curl -s "https://graph.facebook.com/v25.0/<WABA_ID>/subscribed_apps" \
  -H "Authorization: Bearer <SYSTEM_USER_TOKEN>"
curl -X POST "https://graph.facebook.com/v25.0/<WABA_ID>/subscribed_apps" \
  -H "Authorization: Bearer <SYSTEM_USER_TOKEN>"
```

**Trap 2: an unpublished Meta app delivers no production webhooks.** Meta's
own warning sits on the webhook config screen and is easy to scroll past:
while unpublished, only test webhooks sent from the dashboard arrive, and no
production data reaches the endpoint even for app admins and developers.

**One app secret, fleet-wide.** `convex/http.ts` verifies every inbound
signature against a single `WA_APP_SECRET`, so ONE Meta app fronts every
org's number. A business that insists on its own Meta app cannot be onboarded
without adding a per-org app secret first. This is the Tech Provider shape the
`waAccounts` row already assumes.

**Diagnosing "nothing arrives".** `npx convex logs --prod` streams and never
exits, so it hangs a foreground shell; bound it, and do not pipe it through
`tail` while doing so (`tail` buffers to EOF and a killed process flushes
nothing):

```bash
perl -e 'alarm 20; exec @ARGV' npx convex logs --prod --success --history 200 > out.txt 2>&1
```

HTTP routes log as `H(POST /whatsapp/webhook)`, so their **absence is
evidence** that Meta is not delivering — provided some other `H(...)` line is
present to prove routes are being logged at all. A healthy inbound message is
two lines, `H(POST /whatsapp/webhook)` then `M(webhook:handleWhatsappEvent)`.
The Convex MCP server refuses `data`, `logs` and `runOneoffQuery` against
prod, so the CLI is the only route to prod logs.

**Changing a display name is a three-step dance, not a field edit.**
`POST /<PHONE_NUMBER_ID>?new_display_name=…` submits it, the name goes to
`PENDING_REVIEW`, and it does not take effect until you re-register the number
after approval (`POST /<PHONE_NUMBER_ID>/register`, 14-day window; registering
before approval does nothing). Re-registration needs the number's 6-digit
two-step verification PIN, which is set at first registration and is the step
people discover at the worst moment — a new PIN can be set with the same token
via `POST /<PHONE_NUMBER_ID>` with `pin=…`, no knowledge of the old one
required. Limit is 10 name changes per 30 days. Do name changes BEFORE
completing business verification: once verification lands, Meta initiates
display name review across every number on the account and each later change
is reviewed before it can be used.

Ownership specifics for the live Autotakt/Bella number (WABA id, app id, which
Meta account holds what) live in Mana's `20_Projects/Resepta.md`, not here —
they are account facts, not repo facts.

## Operational readiness (audited 2026-08-20) — read before "why didn't it send"

A three-way audit (onboarding path, silent-failure surfaces, config surface)
against the live prod deployment. Everything here is a KNOWN state, not a
discovery to re-make. Re-verify before acting — items get fixed.

**Dead in prod at audit time, config not code:**
- ~~`WA_APP_SECRET` and `WA_WEBHOOK_VERIFY_TOKEN` are UNSET~~ **FIXED
  2026-08-26.** Both are set on prod and the first real number is live — see
  "Wiring a Meta Cloud number" above. Neither has an admin field by design;
  they are `convex env set --prod`.
- No LLM key of either provider ⇒ every chat-agent turn logs a
  `llm-not-configured` skip. The provider pill says OpenAI.
- `voiceRateMicroUsdPerMinute` unset ⇒ the meter resolves org ?? platform ??
  **0**, so every call bills zero and a prepaid wallet never draws down. Run
  `voiceBackfill:run` BEFORE setting a rate.
- Platform `whatsappAccessToken` unset (harmless until the first hosted org).
- Stripe IS wired and endpoint-verified (2026-08-20) — first lane proven end
  to end. Email is fully configured but has still never sent from prod.

**Silent-failure gaps, in severity order.** These are design holes, not bugs
to hunt — each was traced to a file:
1. **No cron heartbeat anywhere.** Seven jobs run the product's promises; a
   throwing `reminders.tick` sends nothing fleet-wide, forever, with every
   screen looking normal. Compounding: the tick is ONE mutation across all
   orgs, so one malformed row rolls back every salon's reminders.
2. `delivery.reapStuck` dead-letters by patching the row directly, bypassing
   `messages.applySendResult` — the only caller of `alertFailedSend`. Violates
   this file's own "never a second dead-lettering site" rule; ~5 lines to fix.
3. The alert lane is fail-silent about ITSELF: `alertHealth` exists and is
   wired to no screen, and `deliverOrgAlert` discards `sendEmail`'s result
   inside a bare catch, so a revoked key produces no log line at all.
4. `/admin` failed/dead-lettered counts key on `_creationTime`, missing every
   old row that fails today; the "Stuck" column counts all in-flight sends,
   so it reds on normal traffic and zeroes once the reaper hides a real one.
5. Inbound WhatsApp for an unknown `phone_number_id` vanishes with no log. An
   expired WABA token alert-storms (one email per failed row × every member).
   Orphaned `voiceEvents` lose the transcript AND the cost meter — unbilled
   minutes. Org-setup failures alert once ever (last-40-rows window, not time).

**Known product gaps:** staff can still double-book on the app's own grid
(every customer-facing lane checks overlap; `schedule.create`'s no-key path
does not — `overlapCount` already exists). Blocked time is still
unrepresentable and its "wait for cal.com" reasoning died with cal.com; a
`blocks` table that `freeStarts` subtracts is the shape, and the write must
be owner-authenticated only — a customer-facing agent that can create
closures is a prompt-injection hole (Serdar, 2026-08-20: "someone could call
and say your business is off next week"). Meta template approval remains
fully manual per org and is the real onboarding bottleneck.

**Doc drift found:** `deploy.md` predates the whole platformConfig
console and describes env vars as the primary path when they are now the
fallback. `email-lane-setup.md` is accurate but dated.

## The IA after 2026-08-14 (inbox, reminders, message variables)

Four moves, each made because a surface was named after its implementation
rather than after what it does.

- **Unread is per CONVERSATION, and the old boundary is a frozen floor.**
  `inboxVisits` (seenAt/leftAt) was the whole model: a row counted as new when
  its latest inbound landed after you last LEFT the Inbox. That answers "have
  you visited lately", so switching tabs marked everything read — markers went
  out with nobody having opened a conversation, and a filter over it would
  empty itself on every navigation. Nudge shipped that same model, found it
  wrong, and replaced it; this is the port of the replacement.
  `inboxReads` holds one stamp per (org, user, customer) and a conversation is
  new when its latest inbound is newer than MY stamp for it — per user, like
  the pins beside it, because a colleague reading a message does not mean I
  have. **`inboxVisits` is never written again**: it survives only as the
  floor under the new model (`inboxReadFloor` = max(leftAt, seenAt,
  user._creationTime)), which is what stopped every existing salon waking up
  to its whole history lit green. A moving floor silently marks things read —
  that is the bug being replaced. `markInboxSeen`/`markInboxLeft` are gone;
  `markConversationRead` is the only writer, called on an explicit row click
  and on a reply landing in the thread you are already looking at. **One rule,
  two readers:** `messages.conversations` and `messages.inboxUnseenCount` run
  the same test over the same rows, so the sidebar can never dot something the
  tab cannot show. Read stamps are POINT LOOKUPS behind the floor test, never
  collected — cost stays bounded by the conversation window rather than
  growing with every conversation a salon has ever opened.
- **The inbox has All / Unread / Pinned chips**, persisted per browser
  (`randevu.inbox.view.v1`), in the `h-9` track that exists to line the two
  cards up — one line only, or the chips spill out of it. Counts are computed
  over the UNFILTERED list, because a chip advertises what switching to it
  would show and cannot count through itself. **A live search overrides the
  chip**, per `useTableState`'s rule that a query must never fail to find a
  match that exists in the data. The open conversation falls back outside the
  filtered list, or reading an unread one under the Unread chip would blank
  the pane as its own row dropped out.
- **"Message variables" is gone, and so is setting `[phone]` at all
  (2026-08-19).** That card named the `[booking_link]` and `[phone]` TOKENS
  rather than the things themselves. The phone field then moved to Business →
  General with agent-line chips — and got deleted too, because it re-asked a
  question the voice-agent table already answers: the number customers call IS
  the enabled agent's inbound line. `[phone]` now resolves at send time in
  `convex/lib/publicPhone.ts` (first enabled agent's inbound number, stored
  `orgs.publicPhone` only as the legacy pre-agent fallback; nothing writes it
  any more). Do not add a phone settings field back. **Online booking is a
  card with ONE switch**: the Resepta page, on or off, the derived link shown
  as a fact to copy. "My own link" died 2026-08-19 — it meant switching the
  page off while messages kept printing a URL, off here and on in the
  customer's inbox. The request-form toggle and embed snippet left General the
  same day: `/r` and `/book` were two public channels for the same job and
  the booking page is the one that stayed.

  **The `/r` route is RETIRED** (2026-08-19, Serdar: "I used it nowhere").
  `convex/forms.ts` and `src/app/r/` are deleted, `/r/(.*)` is out of
  `proxy.ts`'s public matcher, and `orgs.formEnabled` is dead-and-commented in
  the schema (Convex cannot drop a field while documents carry values).
  `publicSlug` is LIVE — the booking page uses the same slug, and `slugify`
  moved to `convex/lib/publicSlug.ts`. The `"form"` FEED channel stays wired end to end (`messages.channelOfMessage`,
  `FeedIcon`, `FeedFilterPills`): `form_request` rows are historical data and
  must still render, and the filter pill already hides itself for a customer
  who has none. Do not rebuild a second public page that collects a name and a
  service without writing an appointment — that was the whole shape, and it
  put a stranger's request in a queue for staff to retype.

- **The booking link FOLLOWS the business name, and the name is UNIQUE**
  (Serdar, 2026-08-20). `/book/<slug>` is `slugify(orgs.name)`, re-derived
  whenever the name changes — `convex/lib/publicSlug.ts` owns the rule, and
  `resolvePublicSlug` throws `name-taken` rather than let two businesses land
  on one page. Do NOT add a field for editing the slug on its own: a second
  place to type it is a second answer to one question, and the answer is the
  name. The slug used to be minted once, from whatever the name was the day
  the booking switch went on, and never re-derived — which left a renamed
  salon advertising a business that no longer exists in every link it sends.
  The cost that buys: renaming MOVES the page, so links already sent stop
  opening. That is stated on the name field's hint and is the accepted trade.
  Three things must stay wired together or the fix reintroduces its own bug:
  (1) `orgs.update` patches `publicSlug` and rewrites `orgs.bookingUrl` in the
  SAME patch, because `[booking_link]` resolves through `bookingUrl` and a
  rename that missed it points every reminder at a dead page; (2) the sync in
  `orgs.update` is self-healing, not just a backfill — orgs that renamed
  before this rule have a correct name and a stale slug, so waiting for a
  rename would never reach them — and `slugMatchesName` guards it with a
  string compare so the whole-table scan in `assignPublicSlug` does not run on
  every settings save; (3) both client callers of `orgs.update({ name })` (the
  Business name field, `AppShell`'s onboarding gate) render the `name-taken`
  refusal, since an unhandled rejection here is a save that silently did not
  happen.

- **Money: `orgs.priceDecimals`, OFF by default** (Serdar, 2026-08-20). A
  Türkiye salon prices in whole lira and ".00" on every row was noise on the
  page a stranger reads to decide whether to book. The switch lives beside the
  currency select in Business → General, on one line with it, because the three
  answer together: currency picks the symbol, language picks the separators,
  this picks how much of the number to write. `lib/money` NEVER ROUNDS — the
  option only removes zeroes, so a price genuinely carrying kuruş still shows
  them, which is the only version of it that can be trusted on a public page.
  The flag defaults to the product default rather than the old behaviour, so a
  call site that forgets to thread it errs toward one salon seeing a rounded
  price instead of every salon's every message carrying ".00". It reaches all
  eight `formatMoney` sites, `moneyInputValue` (the editor has to agree with
  the display, and it is one Save from becoming the price), `booking.page`,
  `reports.revenue` and the chat agent. Deliberately NOT the platform's own USD
  figures — voice minutes, wallet, admin billing are what we charge the salon,
  not what the salon charges anyone — and not the voice lane, which drops
  trailing zeroes unconditionally because nobody says "üç bin tam sıfır sıfır".

- **`orgs.language` is the CUSTOMER language, and it drives the public pages**
  (renamed from "Message language", 2026-08-20). `/book/<slug>` and
  `/appt/<token>` formatted times and prices through it while taking their
  WORDS from `useLanguage()` — the viewer's app setting — so a salon's booking
  page greeted its customers in whatever the owner last picked in their own
  account menu, and the manage page opened from a Turkish reminder answered in
  English one tap later. Both bind `t()` to the org's language and fall back to
  the viewer's only for the states that render before the org is known. `lang`
  rides as an attribute on each page's own `<main>`: LanguageProvider owns
  `<html lang>` and a parent's effect runs after a child's, so an effect here
  loses the race every mount.

- **The customer-facing tabs wear the SALON**: their name as the title, their
  logo as the favicon, via `generateMetadata` in each route's layout
  (`booking.brand` for the slug, `manage` for the token). SERVER metadata, not
  a `document.title` effect — React owns the `<title>` and icon links it
  renders from metadata, so a client write is reverted the next time the tree
  reconciles, which on these pages is every query update. It also means a
  booking link pasted into WhatsApp unfurls as the salon. The signed-in app
  makes the OPPOSITE call and that split is the point: the owner is hunting
  Resepta among thirty tabs, so the tab strip keeps our mark, while the sidebar
  — already inside the app — wears the org's logo.

- **Services and Products are SEPARATE CARDS in Business settings**, mirroring
  the booking page's split. A product books no time, holds no chair, and
  answers a different question in every column the table has; mixed in, the
  only thing marking it out was an empty Duration cell. That cell is now empty
  for a good — unless it carries a lead time, which is a real fact about the
  row — and a unit never renders without a value to qualify ("— days ahead" and
  a lone "₺" both read as fields that failed rather than fields nobody set).
  The Products card appears only once a product exists. There is deliberately
  NO "Add product" button: the Add sheet has had a Service/Product Type switch
  since before the card existed, and a second button would be a second door
  onto one form.

- **`/book/<slug>` is a THREE-STEP WIZARD, not a growing page** (Serdar,
  2026-08-20, reversing this file's own "each answer reveals the next
  question" doctrine). Service → time → details: the header chevron goes back,
  and the screen SWAPS so nothing ever reflows. Tapping an answer IS the
  advance on the TIME and DETAILS steps, which ask for one answer each — the
  service step is the amended exception below. The old reveal-downward design grew the card
  on every selection and — because crossing the fold summoned the document
  scrollbar — shoved it sideways too; `html { scrollbar-gutter: stable }` in
  globals.css fixes the second half and must stay. Fresha and Booksy both
  work this way; do not rebuild the accordion.
  - **The service step is MULTI-SELECT** (2026-08-20, amending the no-Continue
    rule for this step only). `appointments.items` has modelled a visit as
    several lines since long before this page could express it — "a haircut
    plus a beard trim is ONE appointment with two lines" — and the staff sheet
    always wrote them; the public page took a single `serviceId` and sent a
    customer who wanted both back round to book twice. A choice you can add to
    cannot also be the advance, so this step alone ends on the sticky bar's
    Continue. `booking.slots` takes `serviceIds` and `booking.book` takes
    `lines`, both resolving through `resolveLines`: duration SUMS and lead time
    takes the MAX, and both endpoints read the same helper so the grid cannot
    offer a 30-minute gap for a 105-minute booking. Quantity stays goods-only
    (two haircuts is two visits) and lives on the row as a stepper, not on the
    details step two screens after the thing was picked.
  - **Services and products are separate groups**, headed only when the salon
    sells both. They are not the same purchase — one books a chair for a length
    of time, the other is handed over and adds no minutes — and with the
    duration line as the only tell, a product read as a service someone forgot
    to time. Duration is its own line under the name, in words
    (`Intl` unit, "1 hr 30 min" / "1 sa 30 dk"): "30′" was a prime symbol the
    width of a comma, greyed out against the price, carrying the one fact a
    customer needs to know whether they have time today.
  - **The card is FIXED-HEIGHT AT EVERY WIDTH and its middle scrolls** (Serdar,
    2026-08-20). Every step holds a different amount — six services, a slot
    grid, four fields — so the card resized under the reader at every tap, and
    fixing it per step meant another reserved height guessing at content the
    page does not control. One height for the whole wizard costs one guess
    instead of three; measured identical on all three steps. A salon with
    thirty services scrolls the list inside the card rather than growing it
    past the fold. The scroller wears `thin-scroll stable-gutter`, the pair
    every in-card scroller in the app already uses.

    It shipped desktop-only for an hour, with the phone keeping page scroll and
    a viewport-fixed bar. That was wrong in the way only a phone shows: the
    card ended halfway up the screen and the bar sat at the bottom with a
    hand's width of plane between them, reading as two unrelated surfaces
    rather than one card with a footer. `100dvh` is what makes the single
    version safe — it tracks the address bar instead of fighting it. The
    fixed/sticky/static split and the backdrop blur went with it; all three
    existed to fake an attachment the layout now has.
  - **The bar's action button is always in the bottom-right corner, greyed
    until it can be used, and BACK sits opposite it.** The button used to
    appear on the service step, vanish on the time step and return on the
    details step, so the bar's right edge was a different shape on each of
    three screens. Always-there-and-disabled says "there is a next step, not
    yet"; absent says nothing. The time step's is a formality — tapping a slot
    still advances, so it is only ever seen disabled — and that is the point:
    it holds the corner. Both sit on their OWN row under the summary, because
    at the end of one line the primary was wedged against the total and the two
    loudest things on the card fought for one corner.

    Back is in that row and NOT in the header. As a chevron beside the logo it
    pushed the logo and the salon's name right on every step that had somewhere
    to go back to, so the card's identity moved while its content changed;
    reserving an empty slot fixed the shift and left a hole. Back and forward
    are the same kind of thing and this is the row that holds them.
  - **The service list searches behind a magnifier.** The heading row IS the
    search row: collapsed it is "What would you like?" plus a glyph, open it is
    the field. No row-count threshold — collapsing to a glyph is itself the
    answer to a short list. Matching runs BOTH sides through `lib/publicSlug`'s
    slugger, which folds Turkish to ASCII, so a customer typing "sac" on a
    phone keyboard finds "Saç kesimi". It closes on blur only when empty: a
    filter still narrowing the list has to survive the tap that picks a row.
  - **The details step takes an optional NOTE, and it lands on the customer's
    record** — not on the appointment. The record is where the salon already
    reads everything else about them, and a note shows in the conversation feed
    beside the messages that follow. `notes.authorId` is optional for this, and
    unset means the CUSTOMER wrote it: a stranger on a public page is not a row
    in `users`. Nothing else may leave it blank, and `messages.feedForCustomer`
    resolves an author-less note to the customer's own name rather than to
    "System". The write is LAST in `booking.book` and never fatal — a note is
    the least important thing that mutation does and must not cost a slot.
  - **Never import a value from `convex/<name>.ts` in `src/`.** It drags that
    file's whole import graph into the client bundle — booking.ts →
    lib/newCustomer → lib/alerts, which defines an `internalQuery` — and Convex
    logs "functions should not be imported in the browser". Shared values live
    in a `convex/lib/*` module with no Convex imports; `lib/bookingLimits.ts`
    exists for exactly this, holding the cap the page and the server must
    agree on.
  - **Prices ARE published** on the public page (same date, reversing the
    forms.ts-era "duration yes, price no" rule): rows carry duration and
    `formatMoney(service.price)`, and a service with no price shows duration
    alone rather than a made-up zero. Hiding price only moved the question to
    the phone.
  - Times shelve into morning/afternoon/evening at 12:00 and 17:00 (labels
    group, hours define); the day strip is 14 civil days from the lead-time
    floor, stepped in 24h and deduped so a DST fall-back cannot mint the same
    date twice.
  - The sticky bottom bar carries the running BASKET across steps: the lines
    joined (not counted — "2 services" makes the customer open the step back up
    to remember which two), the running duration until a time is picked and the
    time after, and the summed price held out on the right. Its button is
    Continue on the service step and, on the last one, IS the submit
    (`form="booking-form"`) — never add an in-form twin button to race it. It
    carries no "pick a day and time" prompt: on the step where that is the next
    move the Continue button says so, and on the next step the heading does.
  - **`orgs.logoStorageId`** is the salon's logo, uploaded by the owner in
    Business → General through `media.generateUploadUrl` → `orgs.setLogo`,
    resolved to a URL by `booking.page` and `orgs.current`. `setLogo` DELETES
    the file it replaces — logos get re-uploaded until the crop looks right,
    and each abandoned attempt would otherwise sit in storage forever.
- **Reminders rules open as a PAGE, not an expanding row.** The id lives in
  the URL (`?rule=`) like the app's tab does, so a refresh or a trip to
  another tab and back returns to the rule. A row that navigates must not also
  hold controls: timing and channel switches live inside the page, the row
  states what the rule does and which lanes it is on, and there is no chevron
  because the whole row is the affordance.

## Message tokens: the preview, and the defaults (2026-08-14)

- **`renderTokens` is shared by the send path and the preview** and must stay
  that way, or the preview becomes a second opinion. An unknown token stays
  LITERAL (so a typo stays visible); a known token with no value renders as
  nothing, and the whitespace cleanup makes the sentence survive it.
- **`waTemplates.variableDefaults` is the "when empty, print…" table**, one
  row per token the body actually uses, authored under the body it repairs.
  The wording is EDITORIAL — what reads correctly depends on the sentence and
  the language — which is why it lives on the template and not on the field.
  A default only fires for a token the renderer already knows THAT RESOLVED TO
  EMPTY. Threaded through every send path (`wa.ts`, `campaigns.ts`,
  `lib/awayReply.ts`); add it to any new one.
- **Only tokens that sit MID-SENTENCE and can honestly be blank get a row**
  (narrowed 2026-08-19). Not `[business]` (an org always has a name), not
  `[date]` (every lifecycle send has a time), not `[booking_link]`/`[phone]`
  (configuration — a blank one means go and set it in Business settings, not
  write a sentence about not having it), not `[manage_link]` (structural), and
  not `[name]` (the renderer already tidies "Hello [name]!" down to "Hello!").
  `[service]`, `[pricelist]` and `[price]` went too: the stock texts give them
  their own LINE, and a line that resolves to nothing collapses cleanly — a
  missing list is less information, not a broken sentence, and a fallback
  there papers over an appointment with no line items, which is data to fix
  rather than write around. What is left is the honest list: `[staff]` ("your
  appointment with [staff]" → "your appointment with", which the whitespace
  cleanup does NOT repair — it fixes spaces and punctuation, never a dangling
  preposition) and the org's own contact fields. Stored defaults keep firing
  at send time whatever the editor offers; narrowing the list only stops it
  soliciting new ones.
- **The preview invents the PERSON and reads the salon's real SERVICES**
  (2026-08-19). Three answers were tried in order: invent everything (a €350
  haircut in a shop charging €35 reads as a pricing bug in the product, and
  you cannot tell a broken `[pricelist]` from an invented number), refuse to
  draw without a real booking, then auto-pick a real customer — which put
  someone's actual name in a settings screen, unasked, to make a template
  legible. The rule that survives is narrower than "never invent": **inventing
  a price is a claim about the business; inventing a first name is not.** So a
  fictional customer (per language, `settings.previewFirstName`) books the
  org's own first active service at its own price, in its currency, language
  and timezone. Everything an owner could mistake for their data still is
  their data. Reading order is **sample value → the owner's default → the
  labelled slot**, so a token with nothing behind it previews as ⟨Services
  with prices⟩, never as silence. Contact fields get the guillemets too now:
  they were exempt while the pane spoke about a real person (a field they
  never answered is honestly blank — information, not a gap), and with nobody
  real to be honest about, a silently empty `[hair_type]` is indistinguishable
  from one misspelled.

## Messages: the tab, the editor, the draft buffer (2026-08-19)

- **The tab is Messages, not Reminders.** Six message types live there and
  exactly one is a reminder; the tab was named after its smallest member,
  leaving the confirmation, cancellation notice, follow-up, win-back and away
  reply with no word on the sidebar — and making "when booked" read as a
  strange kind of reminder. The nav `id` has been `"messages"` all along. Its
  symbol is a speech bubble, not a bell: a bell says "we will nudge you",
  which describes one of the six.
- **Wording is edited through a DRAFT BUFFER, never live** (`waTemplates.draft`
  + `draftUpdatedAt`, ported from Nudge's `templates.draft`). Reminders send
  from a cron, so writing straight to the live row on blur meant a body caught
  mid-sentence was a body a customer could receive — you were editing
  production one keystroke at a time. Blur writes the buffer; the live fields
  do not move until `orgs.commitTemplateDraft`. **No send path may read
  `draft`.** Three bugs are already paid for and must not be reintroduced:
  (1) a draft equal to live is CLEARED rather than stored, or type-then-delete
  pins the "Unsaved" pill forever; (2) the equality check compares the row **as
  it would look after commit**, not the blob alone — a draft is partial (body
  edits buffer `body` + `bodyHtml` and nothing else), so comparing it bare
  reads every untouched field as cleared; (3) Discard re-seeds the editor from
  the LIVE fields rather than waiting for the cleared row, because the
  subscription can still be emitting the blob being thrown away. Meta
  registration (`metaName`, approval `status`) deliberately bypasses the
  buffer and writes live — publishing WORDS must never cost an approval that
  took weeks.
- **The preview is a TAB, not a second column.** Visual | HTML | Preview,
  inside the editor's own frame. The old split rendered the same formatted
  message twice side by side and gave the box you type in half the width;
  Visual already shows the email as it looks, and what the preview alone can
  say is that `[name]` becomes a name and `[date]` becomes a date — a
  different VIEW of the body, which is what a tab is for. Switching to Preview
  and back must never re-parse, or a round trip rewrites the author's HTML
  with tiptap's serialization of it. A WhatsApp-only rule keeps its pane below
  the textarea: there it duplicates nothing, being the only rendering. The
  paper carries no border of its own — inside the editor's panel it would be
  three rectangles drawn around one message.
- **Adding a message shows the words first, in two steps.** Step one picks the
  type; step two carries it as a heading with Back, plus timing and the
  seeded subject/body. One growing form pushed the list, the option just
  clicked and the Add button down the page — the dialog moved under the
  pointer while being read. The seed resolves **this org's own kind-level
  fallback, then stock** — the same order `ensureTemplate` uses, or the sheet
  previews one thing and saves another. Stepping back and re-picking the same
  type keeps your edits; only a genuine change of type re-seeds.
- **Stock wording lives in `convex/lib/templateTexts.ts`, a PURE module**, so
  the browser can read it without pulling the server file's mutations and
  generated api into the bundle. Every lifecycle message ends with the ACTION
  it is trying to cause, on its own line so `renderTokens` drops it cleanly:
  the reminder carries `[manage_link]` (a reminder you cannot act on is how a
  no-show happens instead of a reschedule) and the follow-up carries
  `[booking_link]` (a thank-you that never invites the next visit spends a
  send on nothing). Both used to end on "reply to us", which hands the work
  back to the salon.
- **"Reset to defaults" is gone.** It offered to throw away every rule and
  every word an owner had written in exchange for a state reachable one rule
  at a time. A destructive button does not earn its place under a list by
  being quiet. `messageRules.resetToDefaults` stays for support to call.
- **`booking` / `cancellation` / `out_of_hours` fire immediately and have no
  timing control** (`clampOffset` pins them to 0). A confirmation minutes late
  reads as the booking not having worked — the customer is still holding their
  phone. If a real case appears, it is a suppression rule, not a delay.

## Goods (2026-08-15) — services without a duration

Resepta sells two kinds of thing now: SERVICES (time — a haircut, blocks the
calendar) and GOODS (things — a chocolate cake, a delivery). A good is a
`services` row with **no `durationMinutes`**; the writers floor a real
duration at 5, so the catalog is unambiguous. The model follows Square (one
catalog, two kinds), Shopify (due-time as an attribute on the order, not a
calendar entity) and bakery order-ahead systems (lead time as the only
capacity control worth having).

The invariants, and where they live:

- **On the appointment the sentinel is an explicit `durationMinutes: 0`,
  never unset.** Legacy rows use unset to mean "assume 30", and 0 flows
  through every `?? 30` fallback untouched (`0 ?? 30 === 0`). If you write a
  goods booking, write the zero.
- **A goods order occupies nobody, in both directions.** `overlapCount`
  (booking.ts), `customerConflict` (lib/overlap.ts), voiceBook's guards and
  `bookedBetween` (retell.ts) all skip explicit-0 rows AND zero-length
  candidates. Ten cakes at Saturday 15:00 is fine; a cake never blocks a
  haircut, a haircut never blocks a cake. Guard checks use `!== 0`, not
  falsy — unset must keep meaning "legacy, assume 30".
- **Quantity rides the line, price stays per unit.** `items[].quantity`
  (unset = 1), goods only — "two haircuts" is two visits. `itemsTotal`/
  `lineWorth` (appointments.ts), the revenue report and the WhatsApp
  receipt tokens all multiply; if you sum prices anywhere new, multiply.
- **The voice/chat agents order multiples by REPEATING the name** in the
  `services` array — matchServices accumulates repeats of a good into
  quantity and still dedupes repeated time-bound services. That is why the
  tool schema never changed and deployed agents kept working (template
  bumps: voice v9, chat v3).
- **⚠️ Still open from the build session, verify before trusting goods in
  prod.** (1) **Existing Retell agents are still on template v8** — v9 reaches
  a deployed agent only when its owner clicks the update banner, so until then
  those agents still refuse same-time repeats. Harmless, just stale, but it
  means "goods work" is false for any workspace that has not clicked.
  (2) **None of this has been walked against a live DB.** Schema and function
  changes went in untested: walk one flow of each kind — create a good in
  Business, book it three times at the same time from the calendar, once from
  the /book page with a quantity, and a voice sim if you can get one.
  (3) `chatAgentTemplate`'s service list renders lead time in English
  ("order 1 day(s) ahead") even inside tr/de prompts — cosmetic and
  prompt-internal. Consciously rejected for v1: stock tracking, per-slot caps,
  cutoff times; the next bakery-shaped step if asked is `max_per_day` per good.
- **Goods never touch cal.com.** No zero-length representation exists there,
  and an externalUid makes voiceBook skip its own guards. http.ts and
  chatAgent.ts ask `retell.classifyServices` first; schedule.create skips
  cal.com when the prepared duration is 0.
- **Lead time (`services.leadMinutes`) is the goods capacity control**,
  enforced on customer-facing paths only (booking page, voice, chat,
  self-serve reschedule) — the owner's own calendar may always take a rush
  job. The voiceBook refusal is a sentence naming the remedy; the booking
  page gets reason `"lead-time"`, not a lying `"slot-taken"`.
- **The business's minimum notice is the same control for everything**
  (`orgs.minNoticeHours`, `lib/minNotice`, 2026-10-13): how soon after the
  moment of booking a visit may start, set in hours or days beside the booking
  page switch on Business's General card. Unset is one hour, the booking
  page's old fixed floor; 0 is none. It binds the same customer-facing paths
  as lead time, both assistants included, and a good takes the larger of the
  two. The owner's calendar is not bound by it; its verdict only says so.
- **On the grid a goods order is a dashed 20px pin**: moves, never resizes
  (`dragResult` preserves a moved zero-length row). The lane packer lends
  pins 15 visual minutes (`laneMinutes`) so simultaneous orders sit side by
  side — display only, the booking math never sees it.
- **UI conversion is one-way inline**: clearing a duration in the price list
  makes a good (its duration cell becomes the lead column, entered in days);
  there is deliberately no inline path back to time-bound — recreate the row.

Rejected for v1, on purpose: inventory/stock tracking, per-slot order caps,
cutoff times (Square Online has them because web checkout is unattended; the
agent can just be told hours). If demand appears, the bakery-shaped next
step is `max_per_day` per good, not slot windows.

## The contact record after 2026-08-17 (Nudge's card, ported wholesale)

Serdar rebuilt Nudge's contact page and asked for the same treatment here.
Everything below is a UI port — no domain model came with it. Nudge sells
deals; we sell services, and an appointment is the thing a customer bought.

- **Appointments LEAD the record card**, above the identity fields, in Nudge's
  deal-block shape: a `text-xs font-medium` muted heading carrying the upcoming
  count, an OUTLINED `+ Add appointment` beside it, one bordered card per visit,
  and the finished ones behind a `Show N past` disclosure. Bottom rule only —
  the block sits on the card's own top edge, so a rule above it is a line drawn
  on a line, and the rule below is what stops First name / Phone / Email reading
  as though they belonged to the last visit.
  - The cost, and it is real: First name no longer starts at a fixed position.
    Where the record begins depends on how many bookings the customer has.
  - **Upcoming = ahead in time AND still scheduled or confirmed.** A cancelled
    booking next Tuesday is history: it is not going to happen, and counting it
    promises work that isn't there. Upcoming sorts soonest-first (the query hands
    back newest-first, which is right for history and backwards for plans).
  - Card: service name as the heading and the way into the booking sheet, date
    right; then a LABELLED `Status` picker with the money opposite. Labelled
    because "Confirmed" alone is a word with no question attached — on the
    calendar the column supplies that and a card has no column.
  - No Complete / No-show buttons beside the picker. Nudge has Won/Lost buttons
    AND a stage picker because those are two axes; here status is one axis, and
    a second control for it is two ways to do one thing.
- **The record's two type tiers.** Label 11px `--muted-strong`, value `text-xs`
  `--foreground`, group headings at the label's size in weight 500. Measured off
  Nudge's live DOM, not eyeballed — both apps run a 17px root, so the numbers
  transfer directly. Same size in the same weight for both halves is a FORM's
  grammar: on a form you read the question, on a record you read the answer and
  glance left to see what it answers.
  - The label TRACK is wider than Nudge's (9rem), and the smaller type is what
    buys the room. Our labels are org-authored questions ("what is your best
    friends favorite restaurant?"), not CRM property names, so they are the half
    of the row that runs long — while the values are a first name and a phone
    number and leave most of their column empty.
  - The value tier is opt-in (`dense` on `InlineEditValue` and `PhoneField`),
    never those components' default. They are also the settings screens'
    controls, and a settings row is a question you answer rather than a line you
    scan. Business, Reminders and Account keep the size they were built at.
  - This is the one place the tier doc below reads oddly: it lists "field
    labels" under `--foreground`. That means a settings row's label. A record
    card's label is a group label — navigation text — and sits at
    `--muted-strong`.
- **`InlineEditValue`'s blank option is `clearable`, default true.** It exists
  to CLEAR a value, which is right for an org field somebody filled in by
  mistake and wrong for a value the record always has. On the status picker it
  was a way to hand the server a status it rejects.
- **Notes are a chat**: bubbles, byline above (author + when), click the bubble
  to edit, delete hover-revealed on the byline. No expand/collapse — a bubble
  shows the whole note, which deleted the ResizeObserver that measured a
  snippet's overflow to decide whether to draw a chevron. One column, one bubble
  style: a mine-right/theirs-left split reads as a conversation between two
  people, and a note log is not one — everybody is writing ON the customer.
  - **The composer collapses to a `+ Add note` pill**, top of the tab, next to
    where a fresh note lands. A permanently open composer is a band of chrome
    between you and the notes you came to read. The one-line pseudo-input that
    used to sit there read as "type here" while doing nothing of the kind.
- **An open email thread is a chat**: bubbles, ours green on the right and
  theirs white on the left, oldest→newest, pinned to the bottom, with the
  subject on the card header ABOVE them. It spent one afternoon as Nudge's
  flush Gmail rows and came back (Serdar, same day). Every other thing you can
  open in this pane is a bubble — WhatsApp, and now notes — so mail arriving as
  a table made the email tab the one place the app changed grammar on you.
  - **The known cost, decided with eyes open:** the newest message sits at the
    BOTTOM, so in a long exchange the mail that decides what you do next is the
    one you scroll to. The pane opening pinned there is what makes it
    survivable. Nudge's rows exist to solve exactly this and we chose
    consistency over it. Don't "fix" it back without asking.
  - **The subject leads each bubble** (Serdar, asked for after a version without
    it). Not redundant with the card header, which names the THREAD: threads
    group on a NORMALIZED subject, so the original and its three "Re:" replies
    sit under one heading and the bubble is the only place you see which a given
    message was. It also rescues the body-never-arrived case — the provider
    hands us metadata first and the body on a second call.
  - **The header wears whatever plane is below it**: the card's white over the
    index (flush rows on white), the tinted plane over an open thread. Left
    white it cut a bright band across the top and the tint began abruptly under
    it, which read as two stacked panes rather than one conversation with a
    heading.
  - `chatOrder` is therefore WhatsApp **plus** an open email thread, and the
    bubble keeps its `emailHtml` branch (sanitised, and only inside a thread —
    in a list a formatted mail is a wall).
- **Notes are rich text too**, same editor, same `compact` mode. A note is where
  the salon writes down what matters about a person — an allergy, a price
  agreed, three things to check next time — and a list is the natural shape for
  that, which plain text could not make.
  - **There is no is-it-html flag, deliberately.** Nudge shipped one and it
    became a lie the first time somebody edited an old plain note in the rich
    editor: the row stored markup while the column still said plain, and the
    note rendered its own tags as text. `bodyIsHtml` judges the BODY, and
    requires a real tag NAME so a note reading "bütçe < 5000 TL" stays plain.
  - Nothing stored is migrated. `plainToHtml` converts a legacy note on the way
    INTO the editor, so its paragraph breaks survive and a note nobody edits is
    never rewritten.
  - `noteText` flattens for the All index and any future search — a row reading
    "<p>Amonyağa" is worse than useless. The All index's in-place expander
    renders the markup, and only for notes: a WhatsApp message is always the
    text somebody sent.
  - `hasNoteText` lives in `convex/lib/noteBody` so the mutation and the button
    share one answer about what "empty" means — an empty tiptap document is
    "<p></p>", so `!body` is the wrong test on both sides. Same arrangement
    `lib/emailInbound` already has with `normalizeSubject`.
- **Quoted replies are split at RENDER, never at ingest** (`lib/emailQuote`).
  A client does not send what somebody typed, it sends that plus the whole
  thread quoted underneath — and a bubble shows its whole body, so without this
  the third message in a thread contains the first two and a four-mail exchange
  renders as ten. The quote goes behind a "•••", the way every mail client
  draws it.
  - **Nothing is stripped on the way in.** The full mail is stored as it
    arrived. This is a pile of heuristics against a format no two clients agree
    on, and a heuristic that runs once against the database can destroy a mail;
    one that runs at render is a display bug you fix by editing the file.
  - HTML is matched on STRUCTURE (`div.gmail_quote`, `blockquote.gmail_quote`,
    `#divRplyFwdMsg`, `#appendonsend`, `.moz-cite-prefix`,
    `blockquote[type=cite]`), never on the "On … wrote:" sentence: that line
    arrives split across tags, localised and formatted, and a regex loose enough
    to catch it is loose enough to cut a mail in half at the word "on". Plain
    text has no structure, so there the attribution IS the signal — and English,
    German and Turkish disagree about word order, so the pattern requires the
    line to start with the marker and END on a colon rather than pinning the
    verb to it.
  - Two invariants, both worth keeping: `visible + quoted === input` exactly
    (trimming is the renderer's business), and **if the cut leaves nothing
    readable, show the whole mail** — a top-posted reply with nothing above the
    quote must not render an empty bubble.
  - Only email is split. A WhatsApp message that starts a line with ">" is
    somebody typing an arrow.
  - The index snippet uses `quoteFreeSnippet`: a row reading "On Mon 17 Aug,
    Barber wrote:" is describing the mail BEFORE this one.
- **The email composer is the rich editor**, `EmailBodyEditor` in `compact`
  mode: no frame of its own (the composer is already a box), no Visual/HTML
  switch (nobody hand-writes HTML in a reply — that earns its place in the
  reminder editor, where the thing being written is a template), and **no
  variable dropdown**: tokens are for a template that gets rendered per
  customer, and nothing renders a one-off reply, so an inserted `{{name}}`
  would reach the customer as those eight characters.
  - `onLiveChange` AND `onSave`. The editor only reports on BLUR, so a Send
    gated on the blur-written value sits disabled the whole time you type and
    wakes only when you click away.
  - "Empty" is not `""`. tiptap serialises a blank document as `<p></p>`, so
    Send asks whether anything was WRITTEN (tags stripped, `&nbsp;` collapsed).
  - `email.sendToCustomer` grew an optional `html`. `body` stays the plain lane
    — the chat agent and the auto-reply still send only that — and when `html`
    is present the action derives `body` from it with `htmlToText` so the feed
    index and the inbox preview read words while the thread renders markup.
    Outbound rows carry `emailHtml` now (`logOutQueued`), which is what makes
    OUR half of a thread render the way it was written.
  - It is safe to send that markup unescaped because of where it comes FROM:
    tiptap serialises its own document, and pasted markup is coerced into the
    editor's schema on the way in. Markup arriving from outside — an inbound
    mail — is sanitised at render, which is where the untrusted HTML actually
    is. Convex's runtime has no DOM, so `isomorphic-dompurify` cannot run there
    anyway; don't try to "add server-side sanitising" without reading this.
  - `compact` also drops the rule under the toolbar. It earns its place in the
    framed editor, where the toolbar is a band inside a box and something has to
    say where the band ends; in a composer there is no box and no band, so the
    line is decoration. Borders belong to containers.
  - **Reply strips existing prefixes before prepending** (`stripReplyPrefixes`,
    the un-lowercased half of `normalizeSubject`). The thread's title is the
    subject of whichever mail opened it and usually already carries a "Re:", so
    prepending blind gives "Re: Re: Saç boyası hakkında soru".
- **Feed pills are their mark and their count, nothing else.** Notes and Form
  used to carry their word (a bare pencil among channel glyphs reads as "edit
  this contact"). Four words across the row was most of the header spent
  labelling marks the reader knows, and the selected pill grew wider than its
  neighbours, so picking one moved them sideways. All keeps its word: it has no
  mark to be. Names live on `title` + `aria-label`.

### The WhatsApp tab, its order, and its wallpaper (2026-08-17)

- **The WhatsApp pill shows whether or not a number is connected.** It used to
  hide until connected — an org with no number has no history and no way to make
  any — but that contradicted the rule right beside it: an empty Call or Email
  tab means "we haven't yet", and the tab is a STANDING OFFER. Connecting a
  number is a thing the owner can go and do, and a channel hidden until it works
  is a channel nobody discovers.
- **So the composer has to answer for an unconnected org.** `waReady` (a
  connected Cloud number OR the Evolution lane) kills the composer, and the
  dead pill says why in its own PLACEHOLDER (`contact.waNotConnectedShort`,
  `contact.sessionClosedShort`) — the prose lines that used to sit above it
  were cut on 2026-08-31 (Serdar: "I don't want unnecessary things"). A dead
  box explaining itself twice is chrome; the placeholder is one line and the
  whole story. Optimistic while the settings query is in flight: a false
  sentence that corrects itself is worse than a control that is briefly live.
  Not connected outranks the 24h window — there is no point telling somebody
  to wait for a reply on a channel they cannot send on.
  - This was a real hole before the pill changed: the tab was unreachable except
    through All, where it quietly offered a Send that came back
    `wa-not-configured`.
- **Channel order is `call · whatsapp · email`** (`FeedIcon.CHANNELS`, the single
  source both the pills and the inbox's "reachable on" strip read). WhatsApp sat
  last on the grounds that many orgs never connect it — the same backwards
  reasoning that hid the pill. This is Turkey: WhatsApp is how a salon and a
  customer talk, and email is the formal fallback.
- **The WhatsApp thread wears a wallpaper** (`.chat-wallpaper`, ported from
  Nudge). Light: `--chat-paper` #f2eee7 under a veil of its OWN colour (a layer,
  never `opacity` — that would fade the messages sitting on it) and the tile at
  380px, small enough to be texture rather than drawings. Dark drops the pattern
  entirely and goes near-black paper with LIFTED bubbles; a dark tile was tried
  in Nudge and read as busy at every gain that was visible at all.
  - The composer's field is `--chat-field`, not `--card`: on dark, `--card` IS
    the bubbles and the paper, so a `--card` pill vanished into it.
  - **An open email thread keeps the flat `--thread-bg`.** Mail is not a chat,
    no client wallpapers it, and giving it one would say the two channels are
    the same thing.
  - **An OPEN CALL gets the paper too.** The rule is per SURFACE, not per tab
    (Nudge's wording): a transcript is a conversation. The calls LIST does not —
    rows on a patterned ground read as a table somebody spilled something on,
    which is the same reason the email index and notes stay on the card.
  - **The surface is painted ONCE, on the panel's root.** A repeating background
    origins at its own element, so a header, a scroller and a composer each
    tiling the doodles put three different phases of the pattern side by side
    and seamed at every boundary. One parent, one continuous sheet.
- **The opened call is Nudge's layout, ported back.** Everything the call
  PRODUCED — summary, how it ended, what it cost, what it collected — is ONE
  raised card on the paper; three separate blocks made the reader assemble that
  themselves. The transcript's bubbles then sit DIRECTLY on the paper with no
  box: a card there would be a third surface level (paper → card → bubble) and
  would leave the agent's bubble with nothing to be white against.
  - Both the card and the agent bubble read `--chat-field`, never `--card`: in
    dark, `--card` (#171717) against a #0f0f0f paper is near invisible, and
    `--chat-field` is the raised surface defined against the paper in both
    themes. This retired a short-lived `--paper` token that was solving the
    white-on-white symptom rather than the surface problem.
  - No "Transcript" heading. A column of chat bubbles is self-evidently the
    conversation, and the label was one more line of chrome between the summary
    and the thing you opened the call to read.
  - **The PANE scrolls the whole call, not just the transcript (2026-08-18).**
    It used to stand its own scrollbar down (`overflow-hidden`) for an open call
    and let the transcript scroll inside a `flex-1` — right that two scrollbars
    in one card is a trap, wrong about which one to remove. The summary card is
    `shrink-0`, so eight collected values pinned most of the pane, left the
    transcript on its 128px floor, and CLIPPED whatever the card itself could
    not fit, with no way to reach it. **The summary is read ONCE and the
    transcript is read THROUGH, so the summary is what scrolls away.**
    `CallTranscript`'s `flow` prop is that mode. Voice → Calls and the mixed
    feed keep the 24rem cap, where an uncapped transcript would bury every card
    after it.
  - `pr-3` on the transcript scroller belongs to the CAPPED mode only: there the
    caller's bubbles are right-aligned and butt against its own thumb. In `flow`
    the transcript has no thumb — the pane's scroller reserves its gutter
    outside the padding — so the bubbles run to the same edge as everything else
    on the paper.
  - **OUR side is on the RIGHT — the agent — and the caller is on the left**,
    the same arrangement the WhatsApp thread uses in the same pane. It was the
    other way round, which is what call-ANALYTICS tools do because there the
    customer is the subject being studied. This is not that tool: it is the
    salon's inbox, one pill away from a thread that already taught "right and
    emerald is you", and nobody should re-learn the sides per tab.
  - **The agent's bubbles are emerald, the caller's are `--chat-field`.** The
    caller's used to be `--accent`, which is this app's ACTION colour — Reply,
    Compose, Send, Place call are all that blue — so blue meant "click me" and
    "the customer said this" on one screen. Colour carries the PARTY (emerald is
    our side, the same as an outbound WhatsApp message) and alignment carries
    the flow, so neither does the other's job.
- **Place call shows only when the org has exactly ONE enabled voice agent**
  (Serdar's call, 2026-08-17). An org can hold several — VoiceView is a list you
  drill into — so there is no "the org's agent" to default to, and a button that
  guesses rings a real phone from the wrong line. With several, the call is
  placed from the Voice agent page, which already made you choose.
  - **It always confirms, naming the number.** `retellAgent.testCall`'s own
    comment demands it: there is no dry mode in Retell, the phone genuinely
    rings and the minutes are genuinely billed. "Call this customer" and "call
    +90 533…" are different amounts of certainty.
  - The button sits in the call tab's header on the LIST as well as inside an
    open call — the email tab's shape. List-only would put the one control you
    reach for after reading "customer did not answer" a navigation away from
    the row that said so.
  - The agent list query is owner-gated server-side, so for staff it resolves to
    undefined and the button never appears rather than appearing and failing.

### The inbox arrives with nothing selected (2026-08-17)

> **SUPERSEDED in part by the journal entry (`journal/2026-08.md` → 2026-08-22) "The inbox stopped being a second conversation
> screen" (2026-08-22) below.** A row does not fill the right pane any more —
> it opens the CONTACT RECORD. The pane still stands as a placeholder, so
> "arrives with nothing selected" is now its permanent state, and the
> `opened`/`selected` split described here is deleted: nothing is ever watched
> from the inbox, so the row stamps read on its way out.

Matching Nudge. It used to open the newest conversation for you, which is the
app deciding what you came here to read — and on a list whose top row moves
whenever anyone writes, the thing it opens is different every visit. An inbox is
a list you choose from; the right pane says so until you do.

- This retired the `opened` / `selected` split's original reason. `opened`
  existed to be distinguishable from an auto-selection, because the
  auto-selected conversation must NOT get a read stamp — landing on the Inbox
  would otherwise silently mark the newest thread read. With no auto-select
  there is one kind of selection left; `opened` now just means "the one you
  clicked", and it still owns the read stamps.
- **The grid is two columns from lg whether or not anything is open.** It used
  to collapse to one when nothing was selected, which was invisible while the
  only way to have nothing selected was backing out on a phone — where the
  layout is one column anyway. The moment arrival became the empty state, that
  rule put the empty pane underneath the list instead of beside it.

### A shared component must never rely on a BARE Tailwind `group`

`group-hover:` matches ANY ancestor carrying the class, not the nearest one. The
editor toolbar's tooltips used a bare `group`, and the moment that toolbar was
mounted inside the note bubble — whose row is a `group` so its delete button can
appear on hover — hovering anywhere in the note lit every tooltip at once and
stacked them on top of each other. Named groups (`group/tip`, `group/note`) only
answer to their own name. Use one in any component that can be mounted inside
something else, which is all of them.

## The chat agent (2026-08-10) — invariants, spec in docs/chat-agent.md

- **Tool identity comes from the channel, never the conversation.** Every chat
  tool executes bound to the (orgId, customerId) the webhook resolved; the
  model chooses arguments, never identities. No tool reads another customer,
  and no prompt text is load-bearing for safety. Do not add a tool that takes
  a customerId or searches customers. Existing appointments go through
  `convex/agentAppointments.ts`, shared with the phone agent: only the
  customer's own appointment at the exact start and services the assistant
  read back (`appointment_start`, `appointment_services`), found again in the
  write and asked about when they fit more than one, moves judged at the moment
  of the change, six changes a day (AGENTS.md, "The assistants touch only the
  customer's own appointments").
- **The disclosure line is mechanical.** `chatAgent.respond` prepends it to
  the first SENT message per customer; it is never the model's job and never
  removable per org (WhatsApp 2026 AI policy + EU AI Act Art. 50).
- **off → shadow → live** (`orgs.chatAgentMode`) is operator-set from /admin
  only. Shadow runs everything, sends nothing and (since 2026-10-13) WRITES
  nothing: its booking, move, cancel and save tools record what they would
  have done on the turn (`chatAgentTurns.intents`) instead of doing it. Its
  replies live in `chatAgentTurns`, the flight recorder that is also the raw
  LLM ledger.
  `usageMonthly` is incremented in the same mutation as the turn — never
  write one without the other.
- **The voice meter follows the same ledger rule.** `retell.meterCall`
  stamps each call ONCE per side — billed (frozen at
  `orgs.voiceRateMicroUsdPerMinute` when the duration first lands, per
  second) and Retell's own cost (`call_cost.combined_cost`, call_analyzed) —
  and bumps `usageMonthly`'s voice counters in the same mutation. Each stamp
  keys on its own field being unset: that idempotency is what makes the
  call_ended/call_analyzed double-fire and every retry safe, so never stamp
  or bump anywhere else. Months key on the call's `startedAt` in the org's
  zone (`lib/usage.ts monthKey`, shared with the chat lane). The rate
  resolves org override ?? platform default (`platformConfig
  voiceRateMicroUsdPerMinute`) ?? 0 — set the price ONCE on the Platform
  tab; an org row exists only for exceptions, and an explicit org 0 beats
  the default. Rate changes never reprice history; the activity feed
  carries the number for exactly that reason. Backfill for pre-meter calls:
  `voiceBackfill:run` (billed defaults to zero — run before setting the
  rate). Two surfaces, one boundary: /admin (fleet Calls MTD + org Usage
  tab) sees both sides including Retell's cost; the OWNER's Usage section
  on the voice page (`convex/billing.ts`, owner-only, staff get null) sees
  billed only — `retellCostMicroUsd` never reaches an org-facing read. The
  owner's soft budget (`orgs.voiceMonthlyBudgetMicroUsd`) emails owners at
  80/100% via the alerts fan-out (kind "billing", the first owner-scoped
  kind; the budget being set is the opt-in, no per-user toggle). There is
  deliberately no hard cap on the voice lane: an alerted runaway month
  beats hanging up on the salon's own customer, suspension is the human
  lever, and the meter's frozen line items + month rollups are the exact
  substrate a Stripe paid tier reads later.
- **The prepaid wallet IS that paid tier** (`orgs.billingMode`, 2026-08-15).
  Two settlement models, operator-picked per org on the /admin Usage tab:
  "invoice" (unset) is everything above, unchanged; "prepaid" adds a wallet
  (`orgs.walletBalanceMicroUsd`) the org tops up itself through Stripe
  Checkout and every billed stamp draws down — the debit happens inside
  `meterCall`, same mutation as the stamp, so the wallet can never disagree
  with the line items it paid for. Money in is `wallet.applyWalletCredit`,
  the ONE credit path shared by the Stripe webhook (`/stripe/webhook`,
  signature-verified, idempotent on the Checkout session id — Stripe
  retries are welcome) and the operator's manual credit (platform.ts).
  Enforcement is ring-time only: `beforeCallContext` resolves null at
  balance ≤ 0, the inbound webhook answers without an agent override, and
  Retell declines the ring — an in-flight call always finishes, which
  bounds the overdraft at one call, and topping up needs no re-enable
  because the next ring reads the balance again. Low/empty mails
  (`walletLow`/`walletEmpty`, kind "billing") stamp on the org and re-arm
  on top-up, not monthly; the owner's soft-budget row hides for prepaid
  orgs because its "calls are never cut off" hint is the invoice lane's
  truth. Owner surface is the Balance sidebar tab (`BillingView`, prepaid
  owners only, filtered in AppShell exactly like Revenue); Stripe's
  success_url rides back on `?tab=billing`. The wallet is deliberately
  lane-agnostic: a future metered lane debits the same balance. Config is
  `stripeSecretKey`/`stripeWebhookSecret` in platformConfig (env fallback,
  Resend doctrine), settable on the fleet Platform tab's Billing (Stripe)
  section, which also prints the webhook URL to register at Stripe
  (`<convex-site>/stripe/webhook`, event checkout.session.completed) —
  WhatsApp is NOT metered because each org's Cloud API number bills to its
  own Meta account, and email stays free.
- **The template is versioned platform code** (`lib/chatAgentTemplate.ts`),
  the voice template's twin. Behaviour changes are version bumps; owners
  never edit prompts (vertical presets are the answer to customisation).
- **LLM provider/key/model resolve in ONE place:** `lib/chatLlm.ts`
  (org `connections` "llm" rows win, then the platform's
  `chatAgentProvider` + per-provider key + optional `chatAgentModel`).
  Both dialects — Anthropic and OpenAI — live behind `lib/llm.ts`'s one
  result shape; `appendToolRound` owns their tool-replay asymmetry, and the
  agent loop must stay provider-blind. The platform keys are the Resend
  doctrine, not a hole in the connections rule. The Retell platform default
  is different: it is STAMPED into the org's connections row at
  auto-provision time, never resolved as a fallback.
- **Suspension** (`orgs.status`) stops outbound at the send chokepoints with
  visible `org-suspended` failures and keeps recording inbound. A new send
  path must add the same guard.
- **Knowledge is prose only.** Services, prices, hours and staff are read
  from their tables into the agent's context; never duplicate them into
  `knowledge` rows.

### Phone-agent variable lifecycle (decided 2026-07-31, Serdar)

Resepta is the source of truth for a phone agent's variables; Retell is the
execution target. A variable is ONE lifecycle row, never three unrelated
lists: its pre-call source, live collection policy, post-call fallback and
storage destination stay together in `voiceAgentVariables`. Before-call values
are context, not collected data. Live caller-confirmed values beat post-call
transcript inference; post-call extraction only fills a missing customer value;
pre-call context is recorded with the call but never writes back by itself.

Existing agents import Retell defaults, extract-variable tools and custom
post-call fields on first open. Publishing adopts them into the Resepta
registry, preserves unrelated Retell tools and system analysis presets, and
publishes the agent + LLM changes as one Retell draft version. New agents use
the same registry from their first publish. Customer destinations still pass
through `contactFields.source === "voice"`; phone, consent and other reserved
columns never become writable through variable configuration.

### Publishing an agent: one draft, one named version (P7, 2026-10-17)

Every edit the agent page makes goes through `retellAgent.applyAgentEdits`:
the prompt, the opening line, the voice, the variables and the voicemail
answer land together on the agent's draft (`lib/retellDraft.draftVersionFor`:
the latest version when it is unpublished, else a clone of it) and go live as
ONE version whose `version_title` names what changed (`lib/versionNote`).
Resepta's mirrors (the chat lane's prompt copy, `voiceAgentVariables`, the
boosted keywords, `retellAgents.voicemail`) move only after the provider
accepted that publish. `publishPrompt`, `publishVariables` and the office
MCP's `publishPromptForOrg` / `publishVariablesForOrg` are wrappers over the
same core; `publishAgent` with `stage: true` writes the draft and stops.

- The page's version number opens `listVersions` (this agent only, never an
  account list); Restore reads a version (`readVersion`) into the editor as
  unsaved edits and never publishes.
- A draft found at the provider shows as "Unpublished draft"; `publishDraft`
  puts it live, `discardDraft` deletes it and refuses on a never-published
  agent.
- LLM reads carry the version their agent doc points at (`llmPath`): a bare
  read answers the latest LLM version, the orphan of a discarded draft.
- `testCall` and `bulkRuns`' `placeCall` dial with `override_agent_version`
  set to the published version. Inbound is not pinned yet (see the P7
  journal entry).
- Voicemail: `retellAgents.voicemail` (off / hangup / static_text / prompt
  with its text) is the business's choice; unset is the template's hang-up,
  and `syncTemplate` applies the stored choice, keeping any
  `detection_prompt` the live agent carries.

### Testing an agent in the browser (P8, 2026-10-17)

`retellAgent.startBrowserTest` mints a web call (`v3/create-web-call`) for one
of this org's agents, owner-only and never in the demo org: variables from
`beforeCallContext` for the chosen customer's phone (or none, a stranger), the
owner's typed overrides applied last (a blank removes a variable), the version
asked for (the draft after `publishAgent` with `stage`) or the published one.
It refuses (`test-unavailable`) whenever a real ring would: the agent off, the
business suspended, a prepaid wallet empty. The `agentTests` row is written
before the browser joins and is fatal if it fails.

- `/retell/functions`: a call carrying `metadata.resepta_browser_test` is a
  test. The caller is the test row's customer (`agentTests.testOfCall`);
  booking runs `checkBook` and answers a clear plan as booked; save, cancel
  and move answer done after the same whose/which checks; refusals answer as
  usual. Each is noted on the row. No cal.com hold, no write, no team email.
- `/retell/call-ended`: a marked call goes to `retell.completeBrowserTest`
  and returns. `browserTestResult` (the page's poll) fetches the transcript
  from the provider for this org's test only, completes the row too, and
  never stores the words.
- Metering: `meterCall` with `test`: same rate, budget alerts and wallet
  debit as a call, plus `usageMonthly.voiceTestCalls/Seconds/BilledMicroUsd`.
- Deletion: `agentTests` is in `ORG_TABLES` and in the customer `FOOTPRINT`
  (rows run as a customer go with them).

## The calendar and booking sheet after 2026-08-19 (the Google pass — read this before the 2026-07-29 entry in `journal/2026-07.md`)

Serdar's brief: make the calendar and its popup read like Google Calendar,
step by step, over one long session. Nudge then ported this calendar for its
Meetings tab, measured it against Google side by side, and P5 of the port
(2026-10-13) brought that month back. What holds now:

- **A booking wears its team member's colour; lavender is the default.**
  `--event` (light `#7c5cf0`, dark `#8b6ef5`) plus `--event-fg`,
  `--event-soft` / `--event-past` / `--event-past-fg` in globals.css, NOT
  `--brand` (green means the product) and NOT `--accent` (blue means "do
  something"). Each person has a colour from Google's event palette with
  lavender first (`convex/lib/staffColors.ts`): `staff.color` when chosen,
  otherwise RESOLVED, the first colour nobody in this business holds, oldest
  row first, so nobody repaints when someone joins. A chip sets `--event` and
  `--event-fg` inline (`lib/staffTint.ts`) and `.staff-tint` re-derives the
  washes on the chip. Unassigned bookings, and the year view's dots, stay
  lavender. Only an ACTIVE colleague's colour is taken when picking;
  `staff.setColor` and `staff.remove` freeze every unset colour first, so a
  change moves only the person it names. Picked from the dot before a name on
  the Team card or the side panel (`StaffColorPicker`).
- **Tense outranks status** (`blockStyle` in AppointmentsView). Upcoming =
  solid with `--event-fg` text, confirmed a shade deeper than scheduled;
  past = the pale wash — decided by the block's END against the live clock,
  so a booking fades the minute it finishes, not at midnight. `no_show`
  stays red in both tenses. The draw-band is tense-aware the same way, so a
  slot drawn over yesterday is muted before it is saved.
- **The now-line is red** (`--now-line`, Google's `#ea4335`), and red means
  ONLY "now", never danger: a 1.5px line and a 10px dot, with no clock badge
  in the gutter (it sat on an hour label for twenty minutes of every hour).
  Today's circles (week header, month, year) are `--accent` blue.
- **Hour lines are 1px borders in Google's `#dde3ea`** (dark `#2e2e2e`), one
  per hour, drawn after the closed shading so they show across it. They were
  a repeating gradient, which smeared over two pixels at browser zoom; the
  half-hour line is gone as clutter, and drags still snap to 15 minutes.
- **The day header is a small weekday over a 22px date** in a 40px circle
  (today filled accent, its weekday accent), sentence case, and the period
  heading beside the arrows is 22px regular. Chips read who before when:
  "Ayşe Yılmaz, 10:00" on a short chip, the name over "10:00 – 10:30" on a
  tall one.
- **Overlaps always render side by side.** The week view's "3 bookings"
  cluster chip is deleted — Serdar chose Google's behaviour: every
  overlapping booking draws in its own lane, truncates, and stays
  clickable. Each chip wears `ring-1 ring-[var(--card)]` — the white seam
  that keeps two touching solid chips readable as two.
- **Chips hug the left and leave the right free.** 1px off the left rule,
  `BLOCK_RIGHT_GUTTER_PX` (14) bare on the right, so a fully booked slot
  still has grid to press for the NEXT booking. The draft band uses the
  same insets so it lands exactly where the saved chip will.
- **The gutter corner prints the VIEWER's GMT offset** (`gmtLabel`), because
  the grid is drawn in the viewer's clock: every column is a local day and
  every hour label a local hour. It printed the business's zone until
  2026-10-13 (P5), so an owner checking an Istanbul salon from Kuala Lumpur
  read "GMT+03" over Malaysian hours. The closed shading is still computed in
  the business's zone and projected onto the viewer's day.
- **Header order is Google's**: the side panel's ☰, then Today as an
  always-visible outlined pill (`periodHasToday` is deleted — a pill that
  vanished made the row twitch), arrows + heading next, the view picker as a
  matching outlined pill on the right. **There is no "new appointment" button
  — don't reintroduce it.** The grid is the button: click or drag a slot, or
  a month cell. Serdar flip-flopped on this and landed on remove.
- **The side panel** (`CalendarPanel`, md and up): a small month (today
  circled, the days on screen banded), the team as a colour-keyed tick list
  (then anyone deactivated a booking in range names, then Unassigned), and
  the services. The lists filter every view, the year's dots on the server
  (`appointments.startsInRange` takes `staffIds` / `serviceIds`). Empty means
  all; the last ticked row cannot be unticked. ☰ folds the panel away; while
  it is closed, and on a phone, two toolbar pickers (`FilterPicker`) stand in,
  so a filter is never out of sight. Panel state per browser, filters per
  browser per business, both in localStorage.
- **Day view's columns are the shown TEAM**, in the Team card's order, booked
  that day or not (an empty column answers "who is free"), each headed by a
  dot of their colour; Unassigned trails when something that day has nobody;
  a business with no team is one plain column. A click in a person's column
  opens the sheet with them picked. The drawn band lives in ONE column (a
  `columnKey` on the drag and the band): in the column of the person the
  open sheet has picked, so it follows the Team member select; a move never
  crosses columns in day view. The grid's width is measured, not estimated.
- **The booking sheet is a 448px Google card**: the shared `AnchoredSheet`
  (also the blocked-time sheet's), a 16px radius on `--sheet-bg`, a step
  darker than the grid so its fields read as white wells, shadow-only edge
  (hairline border only in dark), X to close, blue pill Save that runs
  `reportValidity` so a missing phone is a browser bubble, not a dead click.
  An existing booking has Google's bin beside the X, which asks in the sheet
  ("If the cancellation notice is on, it goes to the customer") with Keep it
  and a red Cancel appointment where Save was, and a square of its team
  member's colour before the customer's name. Escape closes the topmost
  thing: a confirm, or a menu marked `data-nested-menu`, before the sheet.
- **Save never moves between Appointment and Blocked time.** Each sheet
  reports its natural height (`onNaturalHeight`), the calendar keeps the
  larger as a floor while the kind tabs are up, and both are drawn at least
  that tall, the space opening above the footer. The drawn band follows the
  booking sheet's date, times and team member (`onSlotChange`), and the kind
  switch carries them across.
- **One customer field, no Existing/New toggle.** It searches as you type;
  picking a match links that record and shows NOTHING else (no phone/consent
  readback — the record holds those). No pick means the typed text IS the
  new customer's name (first word → firstName, rest → lastName) and a phone
  field waits below. The dropdown's last row says so: "+ New customer: …".
  **Consent is always true for counter-created customers** — the checkbox
  was removed on Serdar's call; the contact record is where consent is
  revoked.
- **Every popup row is two columns** (`SHEET_ROWS`, `SheetRow`): a label
  column as wide as the longest label with a 5rem floor, which covers every
  label of both sheets in all three languages ("Team member" is 4.97rem), so
  the two sheets start their values at one x. Row icons were tried the
  Google way and deleted — with labels present they were decoration.
- **When is prose until clicked** ("Perşembe, 20 Ağustos  10:00 – 11:30"),
  then swaps, on one line, to a `DateField` (a small Monday-first month whose
  heading drills to months and years) and start and end `TimeSelect`s, which
  take typed "930" / "9:30" / "1:15pm" or a pick from 15-minute lists (end
  options carry their length, "1 hr 15 min"). The machinery still speaks
  minutes, but the owner only ever handles times. Moving the start keeps the
  length; an end at or before the start is refused, not reinterpreted (no
  cross-midnight bookings).
- **Blocked time is four rows** (`BlockSheet`): Reason, Repeats (the
  segmented control: Once, Every week, Every day), Dates (a `DateRangeField`,
  From handing on to To, the last day starting equal to the first) or Days
  (seven toggles on one line), and Time (two `TimeSelect`s, All day beside
  them). Every repeat keeps one row, so the sheet's height never changes
  inside it.
- **Every create and move is judged, for every business** (P6 of the Nudge
  port, 2026-10-13). Until then nothing checked this calendar unless cal.com
  was connected, which no business is. `schedule.judgeSlot` returns one
  verdict (`lib/slotVerdict`), most fundamental first, so the sheet names
  the thing a person can act on: `outside-hours` (the visit does not fit
  that day's opening hours), `closed` (it runs into blocked time, with the
  closure's reason as `closedReason`), `customer-busy` (the customer already
  has an open booking overlapping it), `staff-busy` (the team member picked
  already has one) and `full` (as many bookings overlap it as there are
  active team members). The helpers are the booking page's and the
  assistants' moves' own (`fitsOpenHours`, `closureBlocks`,
  `customerConflict`, `overlapCount` against `orgCapacity`, plus
  `staffConflict` in `lib/overlap`), so the three lanes agree about what is
  taken. Three differences, on purpose: a business that never set opening
  hours is bound only by its closures; the team member's clash is judged
  because only this calendar names a person; and the clock is not read, so
  the query stays cacheable. A good (no duration) holds no chair and no
  person, so only hours and closures can refuse it.
- **The server refuses, not the sheet.** `prepareCreate` judges before a new
  customer is written, so a refused booking leaves nothing behind;
  `finishCreate` and `finishMove` judge again in the transaction that writes
  (skipped once cal.com has agreed, `providerConfirmed`); `schedule.move`
  judges before cal.com hears anything and carries a new team member with
  the new time; `appointments.updateDetails` judges a change of person alone
  (`staffOnly`: only that person's clash, since the time is not moving),
  through `internal.schedule.judge`. A refusal comes back
  `{ ok: false, canForce: true, verdict }`. Not judged: the office MCP's
  `create_appointments` (an import of a book that already exists) and
  reopening a cancelled booking from the list.
- **Only a signed-in person can book anyway.** `force` exists only on those
  staff writes (`loadWriteContext`'s `requireOrg`); the booking page, its
  manage page and both assistants have none, and their own guards refuse a
  taken time with no way past. cal.com's own overrulable refusals (busy, out
  of its bounds) ride the same `canForce`. On the sheet, a line under Team member answers the slot live
  (`schedule.slotVerdict`): Free in emerald, a conflict in amber naming who
  or why ("Ayşe already has an appointment then", "Blocked time: Lunch"),
  and in grey two facts that never need a confirm, worked out on the sheet's
  own clock: a start already passed (no confirmation goes out) and a time
  inside the minimum notice. A new booking always has the line; an existing
  one gains it when its time or person changes, the saves the server judges.
  The last answer stays up while the next loads. Save on a conflict swaps
  the foot for the question, with the reason and Back: "Book it anyway?" for
  a new booking, "Move it anyway?" for a new time, "Save it anyway?" for a
  new person. A conflict only the server saw (a booking landed in between)
  comes back and asks the same way, and changing the time, the customer or
  the person withdraws the question. An edit moves first and saves the
  details after, so a refused move saves nothing. A drag the calendar
  refuses snaps back and asks "Move it anyway?" in the app's dialog
  (`useConfirm`), then moves with `force`.
- **Past bookings are quiet** (Nudge c8e1e523). An appointment whose start
  has passed is a record being kept: `scheduleLifecycleMessages` schedules
  nothing for the customer on the booking trigger (yesterday's walk-in, a
  move into the past, which would re-send the confirmation) or on a cancel
  the business makes in the app (`byBusiness`, passed by `setStatus`, and by
  `markCancelled` when a person in the business started the cancel on the
  cal.com lane). The owner's own invite mail is
  unchanged, a customer's own late cancel still gets its answer, and an ASAP
  order is never past (its start is when it was placed). The bin asks the
  same question on a started booking but says the customer will not be told.
  Only staff can put a booking in the past: every customer-facing door
  refuses one.
- The sheet-height dependency rule below still applies, as AnchoredSheet's
  `measureKey`: `timeEditing`, `picked`, the line count, the error, the
  cancel question, the book-anyway question and whether the verdict line is
  shown are in the booking sheet's key. Add anything new that changes
  height.

## One person, several businesses (2026-08-24)

An owner with more than one business staffs them from one screen. Two surfaces,
one write:

- **Business → the card under Team.** Lists the OTHER businesses this owner
  owns, each with the people from this team who already hold a membership there,
  by name rather than as a count. Expanding one gives every colleague the same
  three-value control the roster uses — admin, member, no access. Owners only,
  and rendered only when there IS another business.
- **The add-business wizard's team step.** Conditional: it exists only for a
  founder whose other businesses have other people in them. One control per
  person, three values, and NOBODY is picked by default — every grant mails the
  person and puts a business in their switcher, so a step somebody clicks past
  must not have told three colleagues they now work somewhere. The grants commit
  after the name save, in one transaction, so the mail carries the business name
  and a rejected name sends the wizard back with nothing sent.

A grant leaves `memberships.seenAt` unset, which is what
`users.unseenWorkspaces` and the banner already exist for, and sends the same
"you have been added" mail `team.invite` sends an existing account. The
last-admin guard runs against the org being WRITTEN TO. People with no login
never appear on either surface: there is nothing to grant them elsewhere, and
copying a rota (with its hours and its services) is a different feature.

### Impersonation beats users.orgId, and two mutations forgot (2026-08-24)

`requireOrg` resolves `actingAsOrgId` FIRST and ignores `users.orgId` while it
is set. So any mutation whose whole effect is to write `users.orgId` does
nothing visible while an operator is inside a tenant. `foundWorkspace` and
`setActiveOrg` both did exactly that: Add business minted a real draft org and
kept rendering the client, so the click read as a no-op and produced one more
unnamed org per attempt (seven, in production). Both now clear
`actingAsOrgId` — founding and switching are acts of the PERSON, not of the
business they are standing in. If you add a third mutation that changes which
workspace somebody is in, it belongs in that list.

A login also owns at most one draft now: `foundWorkspace` reuses the newest
draft that has work in it and discards every other empty solo one through
`lib/discardOrg`. Drafts read "Yeni işletme (tamamlanmadı)" in the switcher
rather than borrowing the product name.

## Deleting a business (2026-08-24)

`platform.deleteOrg` is the operator's destructive door, next to suspension in
Account status. Read it before adding a table.

**It is an action, and the order is the design.** The Retell teardown
(`retellAgent.teardownForOrg`) runs BEFORE anything is destroyed, because the
agent id lives in the rows about to be deleted — and it runs in front of the
operator, whose confirmation is the only record that survives. Provider
failures REFUSE the delete unless the operator presses again for `force`. Per
agent: unbind the number while the agent still exists, read the agent to find
its response engine, delete the agent, delete the engine. The number is
unbound, never released — releasing is the irreversible half, and an unbound
number is immediately reusable by the next business.

**`ORG_TABLES` in `convex/platform.ts` lists every org-scoped table, and the
compiler checks that it does** (since 2026-10-13). One arrow per table whose
rows carry a required `orgId`, each reading through an index that starts with
`orgId`. `OrgScopedTable` derives that set from the schema's own types, and
`PurgeCoversEveryOrgTable` fails the typecheck, naming the table, when a table
with an `orgId` has no line. Forgetting used to leave rows (and storage blobs)
that outlive their business and that nothing can find, because the org row they
were keyed by is gone: `bulkRuns`, `bulkRunItems`, `closures` and
`demoProspects` all did. `users` is not on the list: its `orgId` is optional, a
person's active workspace rather than ownership. It is written as literal
arrows rather than a loop over table names on purpose: the literal is what
types each row, so `storageId` narrows and the compiler notices the day a table
gains a blob.

**The purge is a scheduled job, not a transaction.** A step iterates the tables
in order and stops after `PURGE_BUDGET` rows, or sooner when
`lib/txBudget.nearTransactionLimit` says the transaction is near a limit (a
message can carry a megabyte of email HTML), then reschedules; the org row goes
last, on a pass that finds nothing. Every row is checked against the org before
it is deleted, and a mismatch stops the job with `purge-org-mismatch` rather
than delete another business's row. Files go with their rows: inbound media
(`messages.mediaStorageId`), library images (`mediaAssets.storageId`), number
documents (`numberRequests.storageId`) and the logo. `orgs.deletingAt` marks the
row, drops it from the fleet list, and gates `purgeOrgStep` — a step that finds
no mark returns without touching anything, which is what stops a stray schedule
from eating a live salon. Suspension is set at the same moment, because that is
the switch every send path already respects.

Nothing writes an activity row for the delete: every table that could hold one
is org-scoped and is being emptied. Deleted memberships are also how the people
who worked there stop resolving into it — `lib/orgAuth` falls back to their
remaining membership, and a stale `actingAsOrgId` pointing at the deleted org
already falls through there.

## Deleting a customer (2026-10-13)

The rules are in AGENTS.md → "Deleting a customer deletes them"; this is how
it runs. Code: `convex/customerDeletion.ts`, vocabulary in
`convex/lib/customerDeletion.ts`.

**Doors.** `customers.remove` (owners only), the office MCP's
`preview_delete_customer` → `delete_customer` pair (owners only, role re-read
from `memberships` per call), the undo of `create_customers` (whoever ran the
import; it only takes rows nothing has happened to), and the operator's
`voiceBackfill.removeOwnNumberContacts`. Each calls
`beginCustomerDeletion(ctx, customer, how)`. A customer already being deleted
is a no-op.

**The record's Delete** (2026-10-13). The customer record card carries a ⋯
(`RowMenu`, on `useAnchoredPanel`) at the right of its first line, drawn only
for owners. Its one item opens `CustomerDeleteSheet`, which subscribes to
`customers.deletionPreview` only while open: the same `customerFootprint`
counts the MCP preview shows, per kind, with "+" on a capped kind, kinds with
nothing left out, and the emptied audit rows as one line. Cancel takes focus,
not the red button, because there is no undo. The confirm runs
`customers.remove` and then `onDeleted`, which `AppHome` answers by closing the
record and opening the Customers tab; `ContactView` renders nothing in the
moment between the record's query answering null and the page moving, so the
deleted person never flashes "No customers".

**Step one, inside the caller's transaction.** The row is `replace`d with
`{ orgId, firstName: "", phone: "deleted:<id>", deletingAt, deletingPhone }`,
so every column the row had or gains later is gone in this commit. Every
`queued` message is deleted (`by_customer_status`), which is how a send is
cancelled here. Up to 100 appointments are deleted, which takes them off the
calendar and ends their reminders (the cron only reads appointments). One
`customer_deleted` activity row is written (actor only, no detail), and the
sweep is scheduled. Nothing is sent: no cancellation notice, no retracted
invite.

**Step two, `customerDeletion.sweep`.** Every pass walks `FOOTPRINT` from the
top, so a row written into an already-swept table while the sweep ran is still
caught. A pass clears up to 200 rows and stops early when
`ctx.meta.getTransactionMetrics()` says reads or writes are close to a limit
(rows range from a pin to a message carrying a megabyte of email HTML), then
reschedules itself. The pass that finds every table empty deletes the row in
the same transaction.

| Table | Found by | What happens |
|---|---|---|
| `customers` | the row | blanked in step one, deleted last |
| `messages` | `by_customer_status` (queued, step one), `by_customer` newest first | deleted; an inbound file in `_storage` goes with it unless a library asset or another message holds it |
| `appointments` | `by_customer` | deleted, manage token included; first 100 in step one |
| `calls` | `by_customer` | deleted; its `voiceEvents` replaced by one `customer_deleted` marker |
| `voiceEvents` | `by_org_call` per call; `by_org_status` (queued, processing, retrying, failed) matched on `deletingPhone` | deleted, a marker left per call; the status scan resumes by `_creationTime` across passes |
| `chatAgentTurns` | `by_customer_at` | deleted |
| `notes` | `by_customer` | deleted; their `add_note` journal rows redacted first |
| `bulkRunItems` | `by_org_customer` | deleted; the run's totals stay |
| `inboxPins`, `inboxReads` | `by_org_customer` | deleted |
| `activityLog` | `by_customer` | `customerId` and `appointmentId` unset; `detail` dropped except on `appointment_status` and `customer_updated` |
| `agentActions` | `by_target` (`customers`) | `args`, `before`, `after` become `{"redacted":"customer-deleted"}`, `reversible: false`; id-only tools (`create_customers`, `create_appointments`, `log_activity`, `delete_customer`) are kept whole |

Not touched: `mediaAssets` (the business's library), `bulkRuns`, `campaigns`,
`usageMonthly` and the `waTemplates` counters (aggregates; bills read
`usageMonthly`, so a deletion never changes what a business was charged),
`demoProspects`. Recordings are never in our storage; a call keeps the
provider's URL.

**A stalled sweep.** A pass that throws stops the chain (a scheduled mutation
that fails is not retried). The customer stays hidden and blank and the rest
waits. Restart it on the deployment with
`npx convex run customerDeletion:sweep '{"orgId":"…","customerId":"…"}'`;
the customers to restart are the rows with `deletingAt` set.

**Known gaps.** Messages and calls logged before unknown senders got a record
(before 2026-07-25) can carry no `customerId`, and nothing ties them to a
person. A call still ringing at the moment of deletion ends afterwards and
starts a new customer from that number, as any new call would; so does a
booking a live assistant makes in the seconds a turn was already running
(the agents book by number). That turn itself keeps no row and its reply is
never sent. Owner calendar
invites for deleted bookings are not retracted, and a booking cal.com holds
(parked lane) is not cancelled there. `voiceBackfill.run` and
`sendBackfill.run` rebuild usage counters from rows, so re-running them after
deletions would undercount.

## How a customer limits contact: No AI calls, marketing email (2026-10-13)

The rules are in AGENTS.md; this is how it runs.

**No AI calls** (`customers.noAiCallsAt`, set = asked, the timestamp is when).

| Door | What it does |
|---|---|
| Record footer switch | `customers.setNoAiCalls` (any member), both directions. Keeps the first time it was asked when switched on again. |
| Phone agent | Template v15 adds `resepta_no_ai_calls` (boolean) to the post-call analysis, next to the summary. `voiceEvents.process` lifts it out of the analysis bag (so it never becomes a contact field or a "collected" value on the call card) and, on a yes only, runs `retell.markNoAiCallsFromCall`: org from the agent row, customer by the call leg with the org's dial code, never the org's own line, a deleting customer, an erased call or the demo org; creates nobody; writes one `customer_updated` activity row (`detail: "noAiCalls"`, system). |
| Bulk call run | `bulkRuns.skipReason(customer, "call")` answers `no-ai-calls` (after `customer-deleted` and `no-consent`). Read at launch (the composer's count mirrors it in `BulkActions.canReach`), at fan-out, and again in `claimNextCall` before each dial. The run detail shows "Asked for no AI calls". |
| Place call on the record | The confirm swaps its body for the request, its button for "Call anyway" (red), and puts focus on Cancel (`ConfirmDialog`'s `focusCancel`). Confirmed, it sends `callAnyway: true`. |
| `retellAgent.testCall` | After `editorContext` (which refuses the demo org and resolves the org from the agent), and before anything reaches Retell, `customers.noAiCallsForNumber` looks the number up in that org; a flagged customer without `callAnyway` throws `no-ai-calls`. The agent page's test call shows a sentence pointing to the record. |

Every publish path treats the field as ours, like the summary
(`TEMPLATE_ANALYSIS_FIELDS`): `syncTemplate` replaces both and keeps the rest,
the registry publish rebuilds both, and `importVariables` never offers either
to the owner as a field. An agent gets it at creation, on Update (v15), or the
next time its variables are published; until then only the switch sets it.

**Marketing email** (`customers.marketingEmailOptOutAt`, set = unsubscribed).

| Piece | How |
|---|---|
| Which mail | `lib/email.isMarketingEmailKind`: `email_campaign`, `email_bulk`, `email_winback`. |
| The link | `unsubscribeUrl(trackingToken)` → `${SITE_URL}/e/u/<token>`, the app's own origin (`emailLinkOrigin`, falling back to `CONVEX_SITE_URL` when `SITE_URL` is unset); `src/proxy.ts` rewrites it, and `/e/o/<token>`, to the Convex route of the same name (2026-10-13). Mail sent before that links to convex.site directly, which still answers. Bulk and campaign rows mint the token at fan-out; the win-back mints one even when untracked. `withUnsubscribeFooter` appends a small grey "Abonelikten çık" / "Unsubscribe" / "Abmelden" in the customer's language (`customers.language ?? orgs.language`) after the body and before the open pixel; `sendEmail({ unsubscribeUrl })` adds `List-Unsubscribe: <url>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (Resend `headers`). First sends (`wa.sendAppointmentMessage` for the win-back) and the queue (`delivery.attempt`, which sends every bulk and campaign mail and every retry) both do it. |
| The routes | `GET /e/u/<token>` renders a confirm page (`lib/unsubscribePage`) and changes nothing; `POST` (the button, or a mail client's one-click) runs `messages.unsubscribeByToken`. Both resolve through `unsubscribeTarget`: the row by `by_tracking_token`, outbound, marketing kind, with a customer in the row's own org and not being deleted. Anything else gets a page naming no business, in the visitor's `Accept-Language` (tr/en/de, else tr). The first unsubscribe stamps the field once and writes one system `customer_updated` activity row (`detail: "marketingEmailOptOut"`). |
| Respected | Bulk email: `skipReason` → `unsubscribed` (composer mirror `canReach`, run detail "Unsubscribed"). Campaign email: fan-out writes no email row. Win-back: `emailVerdict({ unsubscribed })`, silent on "both", a refusal row on email-only. Queue: `claimForRetry` refuses a queued marketing mail with `unsubscribed`; a bulk item refused that way becomes `skipped`, not failed (`noteBulkItemResult`). `unsubscribed` is a local refusal (permanent), a steady-state failure (no alert) and, like `no-consent`, never shown in the thread (`neverLeftSilently`). |
| Shown and set by hand | The record footer's Unsubscribed switch (`customers.setMarketingEmailOptOut`, any member), the date on hover. On is immediate (a request made in person); off asks first (`ConfirmDialog` with `focusCancel`) because it puts the customer back on marketing mail. Both write a `customer_updated` activity row with the acting member. |

## Bulk call runs: when they ring, who they skip, what they report (2026-10-17)

A call run (Customers, tick people, Call, pick an agent: `bulkRuns.launch`)
has no message queue under it, so `convex/bulkRuns.ts` is its own: one
`bulkRunItems` row per customer, ONE call in flight per run (an item in
`dialing` is the token), the chain moved on by the `call_ended` webhook
(`finishByCallId`), by a placement failure inside `dialNext`, or by the
five-minute reaper (`reapStuckCalls`). Every guard below sits in
`claimNextCall`, the one transaction that decides a dial, because the reaper
restarts every running run and a resume dials at once: a guard anywhere else
is dialled straight through (P6b of the Nudge port).

- **Hours.** `callHoursFor`: the business's opening hours when they carry
  clock times (`hasBusinessHours` and `hasClockBounds`), with its closures
  cut out, in `orgs.timezone`; otherwise the message send window
  (`quietHoursStart` / `quietHoursEnd`, 09:00 to 21:00 by default), and an
  overnight send window reads as that default. `callWindowAt` asks
  `lib/businessHours.nextOpenAt` once, which answers "now" or the minute the
  business next opens (a lunch closure answers its end, a holiday the next
  working day, nothing within 60 days null). Closed, the run gets
  `heldUntil` and `heldReason` ("closed", or "no-opening" with a six-hour
  look-again) and ONE scheduled `dialNext` at that minute. A hold still in
  force answers "held" and schedules nothing; the reaper leaves a run alone
  while its hold stands and restarts it after, the net under a lost wake-up;
  `setStatus` clears any hold, so a resume judges the clock afresh.
- **Who is skipped, at their turn.** First `skipReason` (deleted, no consent,
  No AI calls, a bad number), read at launch, at fan-out and at the claim.
  Then `turnSkipReason`, read only at the claim because "today" is the day
  the phone would ring: `already-booked` (an open booking still ahead of
  them, the booking page's reading of upcoming, an open ASAP order included)
  and `called-today` (a calls row with them today in the business's day, in
  either direction, unless it never reached the phone; or another run's
  item `dialing` them now, since a calls row appears only when a call ends).
  Every skip is the item's reason, shown in the run detail.
- **A refusal is not a call.** At dial time `lib/callOutcome.isRetryableDialError`
  (a 429, a 5xx, a full pool named in the body) and at call end
  `isRetryableCallEnd` (`concurrency_limit_reached`,
  `telephony_provider_unavailable`) send the item through
  `requeueRefusedCall`: back to `pending` at the head of the line (its
  `_creationTime` is its place), the run held `busy` one minute longer per
  try, and on the sixth refusal the item rests `failed` with the last
  refusal as its reason and the run moves on. A 4xx about the request and a
  thrown fetch are terminal (`failItem`; the second because that call may
  be ringing). `no_valid_payment` (`isAccountRefusal`) is the account's, so
  the item goes back in line and the run pauses.
- **What a call came to.** `callOutcome(disconnectionReason, durationSec)`:
  answered, voicemail, busy, declined, no-answer, refused or failed, from the
  provider's code, with the duration deciding only for a code nobody has met
  or a row from before the code was kept. Never from a transcript: Nudge's
  word lists are English. `finishByCallId` marks a call that reached the
  phone `done` and one that did not `failed` (with the code as its reason),
  and the counters follow. The run detail prints the outcome (Talked 95s,
  Voicemail, Busy, Declined, No answer, Refused by the network), never Sent
  for a call. The MCP `activity_report` counts answered and voicemail by it,
  and each call in `customerHistory` carries its `result`.
- **The platform's limit.** `platformConfig` key `bulkCallConcurrency`
  (/admin, Platform, Bulk calls, "Bulk calls at once"; a whole number from
  1, parsed by `lib/platformConfig.bulkCallLimitOf`). Unset reads nothing.
  Set, the claim counts live bulk calls through `bulkRunItems.by_status`
  (cross-org, a count and nothing else) and at the limit holds the run
  `busy` for 30 seconds. One provider account carries every business's
  calls and every inbound call, so this is what leaves lines for callers.
- **On screen.** The run list says Waiting for a held running run. The detail
  says "Closed now. Calling resumes Tue 14 Oct, 09:00." (the business's
  clock), "No free line right now. Trying again at 10:42." or "No opening
  hours in the coming weeks"; a customer back in line reads "Trying again
  shortly". The composer's hint says calls ring one at a time, during
  opening hours, and who is skipped.

Not here, on purpose: Nudge's per-number caps and calls-per-second gap (a run
makes one call at a time), a person's dial cancelling queued automated calls
(nothing queues a call outside a run), and leaving a voicemail (P7).

## The app lives at app.resepta.xyz (2026-08-24)

Marketing left. `resepta.xyz` and `www` are a SEPARATE repo on a separate
Vercel account; this deployment is `app.resepta.xyz`, plus `demo.` and `docs.`
which `src/proxy.ts` rewrites to `/demo` and `/help`. The operational half —
`SITE_URL`, the Google callback that does NOT move, the redirects the marketing
project owes us — is in [`deploy.md`](deploy.md). What it changed in
here:

- **`/` is the app and nothing else.** It came off the public matcher in
  `src/proxy.ts`, so the redirect at the foot of that file sends a stranger to
  `/signin` — the same rule that guards every other route, rather than a second
  one written in the page. `src/app/page.tsx` has no auth branch left.
  `HomeClient` keeps a client-side bounce for the session that expires between
  the cookie check and the browser, and `/signin` sends an authenticated
  visitor home (the anonymous demo sign-in creates a session without ever
  navigating).
- **Signing out leaves for `resepta.xyz`** — `lib/hosts.signOutDestination`,
  used by the account menu and the wizard's way out. Every page here is behind
  auth, so staying put meant bouncing off `/signin` one click after saying you
  were done. A demo visitor goes back to the demo instead. `.then`, never
  `.finally`: a sign-out that failed has left the session standing, and
  navigating away from it lies to whoever is walking away from a shared laptop.
- **The landing's leftovers are gone (2026-10-13).** `src/components/Landing.tsx`
  had no importer since this split, and `src/lib/landing.ts` was read only by
  it and by the sign-in dialog it opened. Both were deleted with the dialog;
  they still advertised Google Calendar sync and $49/$99/$199 plans the
  product does not have. Git history keeps both if the marketing repo still
  wants anything from them.
- **`src/app/sitemap.ts` and `robots.ts` still advertise the apex origin.** They
  are describing somebody else's site now. Fix them when you next touch that
  area.

## The agent's capture config IS the Contact fields table (2026-08-25)

Serdar's spec, in his words: the agent should know the caller and what we
already have, collect the rest during or after the call, and the client
setting an agent up must understand it "immediately without having to read an
extensive manual". Three moves got there, in one day, in order:

1. **Knows / Asks / Learns died.** The three headings were the runtime's
   before/during/after timeline projected onto a filing system by priority;
   the editor now has two sections, "What the agent sees" (injected context,
   automatic, nothing to set up) and "What the agent fills in".
2. **Capture rows are DERIVED, not authored.** `retellAgent.deriveCaptureRows`
   builds the capture set at publish time from the org's contact fields
   (`source === "voice"`, plus unlocked identity columns as questions landing
   on the customer's own columns). The per-agent `voiceAgentVariables` rows a
   caller may still author are CONTEXT ONLY (static injections);
   `publishVariableSet` filters its input to those, so no client — editor or
   MCP — can reintroduce a second capture registry. `set_agent_variables`
   capture rows are silently superseded by field config; its tool description
   still oversells and needs a trim.
3. **The field carries its voice metadata.** `voiceDescription` (the
   extractor's instruction) and `voiceConfirm` live on `contactFields`; the
   fills section's rows write the field through the same mutations the
   Contact fields table uses. Flipping `source` to manual no longer throws
   `field-in-use` — it IS the unlink, and the next publish stops deriving.
4. **It ended as ONE MATRIX with ONE switch** (through three rounds of
   Serdar simplifying on contact): `name · type · description · Asistan`.
   Green check = the agent knows the field and fills it (org rows toggle
   `source`, identity rows toggle the lock). The intermediate two-column
   version (sees / fills) died the same day it was built — the implied-sees
   check read as "not seen" to a human scanning for green, and then the
   premise fell: "if we can see something we can fill in too". Confirm-first
   died with it, on the third complaint: extraction policy leaking into an
   owner surface. `deriveCaptureRows` always asks-when-missing; stored
   `voiceConfirm` flags are ignored, dead config. `voiceVisible` (sees
   without fills) still injects into the ring-time card for rows that hold
   it, but no UI sets it anymore. The switch control is `CheckSwitch`
   (shared component, ported from the message-rule channel toggle): boolean
   cell inside a table row; the iOS Toggle remains for labelled settings
   rows. The Knowledge tab's Active columns use it too.
   Also gone: the read-only runtime listing (one (i) sentence now — what can
   be referenced lives in the prompt's @ picker), the "+ Add default"
   statics block (a static default is prompt text with extra steps; legacy
   rows render headingless until retired), clones of provided keys (filtered
   on load against a set derived from the builtin lists), the type popover
   (selects edit options inline from the type cell), and the key column
   everywhere — the prompt editor speaks labels and translates at the
   boundary (PromptEditor's "two faces" note).
   During-vs-post was proposed as a third column and rejected:
   ask-when-missing during, transcript recovery after, always — one
   behaviour with a retry, not two decisions.
   THE REACTIVITY RULE this page taught: the matrix renders from live
   queries (`contactFields.list`, `contactFields.identityVoiceConfig`),
   never from the agent `read` action's snapshot — rendering switches from
   a snapshot is how a click "did nothing" until reload.

What did not change: runtime ring-time context (`contact`/`information`) was
already field-driven; mid-call and post-call writes still go through
`applyVoiceContactValues`. Field edits reach Retell on the agent's NEXT
publish — there is deliberately no auto-republish (version spam per keystroke);
the editor marks itself dirty via `fieldsTouched` instead. A field edited in
Business while nobody re-publishes an agent is stale at Retell until then —
same as it always was for anything else.

Lost knowingly: per-agent capture variation (nobody used it), the `required`
flag on capture rows, and hand-keyed capture rows whose destination was the
call only ("visible debt" rows — they no longer publish).

## Members, from the operator's side (2026-08-25)

`/admin/<org>` → Members could list who can sign in and do nothing about it, so
"add my new receptionist" — which arrives by WhatsApp, not through the app —
was answered by signing into the client's own workspace and using their Team
card. That is the exact state `lib/activity` spends its length keeping out of a
tenant's feed, done deliberately, for a two-second edit.

**The writes live in [`convex/lib/members.ts`](convex/lib/members.ts) and
nothing else re-implements them.** `upsertMembership`, `setMemberRole`,
`revokeMembership`, `addMemberByEmail`, `revokeInviteRow`. None of them check
who is asking, by design — "owner of this org" and "platform admin" are not the
same question and neither belongs inside a write. `convex/team.ts` keeps every
gate it had and lost the bodies; `convex/platform.ts` adds the same operations
behind `requirePlatformAdmin`.

The reason it is one file rather than a second copy in platform.ts: membership
carries four rules that are quiet, load-bearing and exactly the kind that get
left out of a copy. An org must never lose its last owner. A staff row keeps
its appointments when the login behind it is revoked. A new membership's
`seenAt` stays UNSET so the person is TOLD rather than handed a workspace
silently. An address with no account gets a TOKEN, never a seat.

Two things the operator door does differently, both deliberate:

- The invite mail carries `OPERATOR_ACTOR_NAME`, not the operator's own name.
  It lands in a client's inbox as "you have been added to X" and the client did
  not ask who was at the keyboard.
- `platform.orgMemberCandidates` makes the EXISTING-ACCOUNT pool the easy path,
  because most people being added already hold a login from another business
  and adding one of those is a membership with nothing to accept. Each row
  names the other businesses that account is in — an operator reading a bare
  address cannot tell a client's staff from a stranger with a similar name. It
  is a bounded scan (`users` has an exact-email index and nothing else), and it
  says when it capped.

`team.writeAccess` keeps its own cross-org guard (owner of BOTH ends, read
fresh) because that guard is the whole reason that block is allowed to exist
outside platform.ts. Its demo check stays a `not-found` rather than the lib's
`demo-workspace`: that card must not advertise the showroom's existence.

**Scar, and it is about editing this repo rather than about members.** The
Members swap was made with a python slice — everything before the block, plus
everything from the next tab guard onward — and `.index` searches from position
ZERO, so `end` landed on the Setup guard 1,500 lines ABOVE the block. `end <
start` does not throw; it silently returns the region between them a second
time. `[orgId]/page.tsx` went from 1,422 to 2,200 lines with every card below
the agents tab duplicated, and NOTHING downstream could see it: duplicated JSX
is valid JSX, tsc passed, eslint passed, no export was duplicated because the
copy was inside one component's return. Serdar saw two Members cards on screen.
Anchor the second search (`s.index(needle, start)`) and assert `end > start`.

## The fleet table answers who uses this (2026-08-25)

It had nine columns and five of them were flavours of a message breaking:
Setup, Failed, Gave up, Retrying, Stuck. On a healthy fleet all four failure
columns are em dashes, so a third of the table said nothing, and Serdar's first
question about the screen was what "Stuck" means.

Now: **Business · Members · Email · WhatsApp · Calls · Booked · Errors · Last
activity**, plus a hover-only icon that opens the client's own app.

- **Setup is deleted.** "email only" was a setup-checklist word sitting in a
  row of counts; everything it encoded is on the business's own Setup tab,
  where the credentials that produce it are.
- **Errors** folds the four failure columns into one cell: blank when nothing
  is wrong, `2 dead-lettered · 3 failed` when it is. Tone is the worst thing
  present, not a colour per phrase — a row is glanced at, and three colours in
  one cell is a legend. **The words are the ones the CODE uses.** This screen
  has one reader and he greps `deadLetteredAt`; "gave up" was client-facing
  softening that cost him the ability to match what he reads to what he
  searches for.
- **Email / WhatsApp / Calls are ALL-TIME**, summed from every `usageMonthly`
  row. Month-to-date was the first cut and it answered the wrong question: on
  the 3rd it cannot tell a business that sent four thousand messages last year
  from one that has never sent anything, and adoption is why the columns exist.
  The month-by-month breakdown stays on the org's own page.
- **The counters are `usageMonthly.emailSent` / `waSent`**, fed from
  `messages.applySendResult` — the one site every send path already reports to,
  so retries cannot inflate them. NOT counted off `messages`: that table's cost
  is proportional to history, and this page's own comments record it throwing
  around thirty businesses when it last did per-org message scans.
  `usageMonthly` is read ONCE fleet-wide and bucketed by org, the same pattern
  memberships and templates use here, which made this cheaper — `healthFor`
  lost its per-org point read. `sendBackfill:run` rebuilds history and is safe
  to run twice. A staff reply typed on the salon's own phone and echoed back by
  Evolution is deliberately not counted: nothing was sent from this product.

**Two layout corrections, and the second reverses the first.** The open-app
action shipped as a 90px "Open app ↗" button in a column of its own, which ate
the table; it is an icon in a `w-px` cell, revealed on row hover, slot held
open at rest so nothing shifts under the pointer, permanently visible on touch.
Then Business was given `w-full` on the "one flexible column" rule — **and that
was the wrong rule.** One flexible column plus nowrap everywhere else is what
you do to a table that OUTGROWS its card; it is the fix for a horizontal
scrollbar. This table has never outgrown anything, so the rule bought nothing
and put all the spare width in one cell: a fleet of one business drew
"Barberio" across half the card. Auto layout, as before. **A rule that solves a
problem you do not have will cause one.**

`?tab=` deep links work on the org page now (read once on mount, in an effect —
the `useState` initializer also runs during SSR, where there is no location, so
reading it there is a hydration mismatch).

## Prod seeds dev: the scrubbed-snapshot runbook (2026-08-25)

`npx convex export --prod --include-file-storage --path prod.zip`, scrub,
re-zip, `npx convex import --replace-all -y` into the local deployment. The
scrub is NOT optional and exists because dev runs the same crons prod does —
reminders tick every five minutes, and a snapshot that carries credentials has
dev double-sending real WhatsApp and email to real customers before you have
closed the terminal. What gets emptied or filtered, and why:

- `platformConfig`: drop the secret rows (Resend, Stripe, Retell, LLM keys,
  WhatsApp token), keep the settings rows (rate, modes, product name).
- `connections`: emptied whole — every per-org provider secret lives here.
- `mcpConnections`: emptied — it holds CLEAR `mk_` bearer keys, not hashes.
- `authRefreshTokens`, `authSessions`, `authVerifiers`, `authVerificationCodes`,
  `authRateLimits`: emptied — refresh tokens are live bearer secrets, and every
  client just signs in fresh. `users` and `authAccounts` STAY, so Google
  sign-in matches the imported account by provider id.

`--replace-all` wipes the dev seed org. Do NOT re-run `devSeed:seed` blindly
afterwards: it targets the FIRST org when none is passed, which after an
import is a real client's data.

## One number, one business — without the operator as the transaction (2026-08-26)

The Phone lines checklist refuses to tick a line another org holds, which is
the right invariant with the wrong remedy: the fix was a four-step trip
through the other business with the line half-assigned in between.
`platform.claimPhoneNumber` does both edits in one mutation and schedules the
same `releaseOrgLines` that `setAllowedPhoneNumbers` runs — without the
release the loser's agent keeps answering on a line the console gave away.
Arm-then-confirm on the row (self-disarming, like Suspend), and BOTH orgs get
an activity row; the loser's is the one that matters, because a number
vanishing with no record is a support call about missed calls.

Two facts worth not re-deriving: `[]` and `undefined` are the SAME allowlist
to every reader (`?? []` then `.length`), so write `undefined` when a list
empties, matching `setAllowedPhoneNumbers` — two forms pretending to differ is
its own bug. And an empty list does not hand a shared-account org the pool:
`lineUsable` refuses everything to an empty list unless the org is on its own
Retell account, where the numbers are its property anyway.

The number-request flow closed its loop the same day. The tenant card promised
"your number will appear here" and never showed one — the number lands on the
agents table, so a finished request read as stuck. `retell.myNumbers` (union
of allowlist and bound lines, the same set `orgNumberPolicy` computes) lets
approved split into accepted vs live-with-the-number. `orgLines` could not
answer this: it reads `agentLines`, which has no row until a number is BOUND
to an agent, and provisioned-but-unwired is exactly the gap being reported.
Admin buttons renamed Accept document / Reject document, because approving
decides the document and nothing else — see docs/phone-agent.md.

## A towel stops booking a chair: goods orders got a fulfillment (2026-08-28)

The booking page's wizard forks on a goods-only basket. Nothing in the basket
books a chair, so instead of marching a towel through the calendar the page
asks how the order reaches its customer — Gel al / Teslimat — and then when:
"En kısa sürede" above the day strip, or a slot on the same grid as before.
Mixed baskets keep the old flow untouched; the good rides along to the visit,
which is correct. The fork's storage is `appointments.fulfillment`
(`{kind: pickup|delivery, asap?, address?}`), only ever written on a basket
whose duration sums to 0 — `booking.book` drops it silently otherwise.

Facts the next reader should not re-derive:

- ASAP means `startAt` records when the order was PLACED, not a promised
  minute; the flag carries the promise. The server stamps `now` itself
  (`startMs` became optional on `book`), skips the notice/open-hours/capacity
  guards (all no-ops at duration 0 anyway), and still refuses ASAP against
  `leadMinutes` — the page hides the button for the same reason.
- Anything reading `startAt > Date.now()` to mean "still upcoming" is wrong
  for an ASAP order — it is in the past the moment it exists. /appt/<token>
  hit exactly this and now lets status alone decide for asap orders.
  Rescheduling an ASAP order to a real minute clears the flag: startAt goes
  back to meaning what it means everywhere else.
- The delivery address is a snapshot on the ORDER, deliberately not a field
  on `customers` — it is where this order goes, not who the person is.
- Order surfaces speak order words: Siparişi ver / Siparişiniz alındı on the
  page, Siparişi iptal et on /appt, a read-only Teslim row on the owner's
  appointment sheet (through `listRange`'s `enrichedAppointment`). The
  confirmation message renders [date] as "en yakın zaman" (per language) for
  ASAP orders, confirmation kind ONLY — the phrase is chosen to sit in each
  stock text's [date] slot without breaking its grammar, and the other kinds'
  slots ("[date] tarihli", "am [date]") cannot take a phrase.
- Delivery is a FIRST-CLASS mode, not a salon oddity (Serdar, 2026-08-28:
  "resepta is a versatile app that will work for restaurants too"). Which
  modes a business offers is `orgs.pickupEnabled` / `orgs.deliveryEnabled`,
  and UNSET MEANS ON — the opposite of `bookingEnabled`, deliberately: that
  switch publishes something new, these narrow something already live, so a
  default of off would have broken goods ordering everywhere the day it
  shipped. Both off is refused in `orgs.update`; the second switch disables
  itself rather than refusing after the tap. `booking.page` resolves the pair
  server-side and the page reads two plain booleans; `book` re-checks, because
  offering delivery a business does not do is a promise in its voice.
  A business offering only ONE mode never sees the fulfillment step — the
  answer is still recorded, it just costs no tap (`soleMode` in the page).
  The rows appear in Business → General only once the org sells a good.
- The CHAT lane learned it the same day (template v6): `book_appointment` took
  `fulfillment`/`asap`/`address`, `start` stopped being required, and the
  PRODUCTS section of the system prompt is written only for an org that sells
  goods — and names only the modes it offers. The gate is the SERVER's, not
  the model's: the handler classifies the order and answers
  `not-a-product-order` for a service, and `voiceBook` drops a fulfillment
  that arrives beside one. Chat needs no republish (tools are composed per
  request), which is exactly why it went first.
- Still open, by choice: the stock texts still say "randevunuz" over an order
  (a real order-confirmation template kind means Meta review machinery —
  Serdar's call), and the VOICE lane still books goods without asking — it
  shares `voiceBook`, so the mutation is already done, but the tool schema
  lives at Retell and needs a republish. Design it before building: a spoken
  street address is the weak link, and reading it back beats trusting a
  transcript.

The same day, the details form went phone-first (Telefon → Adınız → E-posta →
Not) and learned device memory: a successful booking writes name/phone/email
and the delivery address to localStorage (`resepta.bookingContact`, one key
product-wide) and the next visit prefills, `PhoneInput` re-splitting the
stored E.164 via a new
`defaultValue` prop. Deliberately NOT a server lookup by phone: echoing a name
back to whoever types a number is a doxxing endpoint. The server already
dedupes by phone on submit; nothing needed to change there.

## The agent gets three gears, and the owner holds one of them (2026-08-29)

The chat agent was one switch for a whole workspace and only the operator
could reach it. A business either had an agent answering every customer by
itself, or had nothing. That is now two questions with two owners, and a third
asked per conversation.

`orgs.chatAgentMode` (off/shadow/live) stays exactly where it was — /admin,
operator-only — because it is also the **entitlement gate**. This is the whole
reason the obvious design (extend that one union with "suggest" and let the
owner write it) is wrong: the moment a tenant can write the field that means
"do I have an agent", they can switch a paid feature on for themselves, and
there is no other gate behind it. Shadow stays a fleet-QA state the tenant is
never shown.

`orgs.chatAgentBehavior` (off/suggest/live) is the owner's, in Settings →
Messages, and is read ONLY when the mode above is "live".

Facts the next reader should not re-derive:

- **Unset behaviour means LIVE, not suggest**, and that is a migration
  decision rather than a preference. Every org already in live is answering
  customers today; defaulting them to drafts would have silenced a working
  agent on deploy day with nobody told. New orgs get the careful default
  another way — `platform.setChatAgentMode` stamps `suggest` the first time an
  operator brings an org live, and only ever over an absence, so an owner who
  has since chosen keeps their choice through any number of mode flips. This
  is why "unset" means different things depending on when the org arrived; the
  schema comment says so out loud rather than leaving it to be discovered.
- **Precedence lives in exactly one leaf function**, `convex/lib/agentMode.ts`
  → `conversationAgentMode()`. Four callers ask "who answers this
  conversation": the webhook deciding whether to schedule, the turn deciding
  whether to run, the thread UI drawing its control, and the takeover write.
  Three copies of that rule is how those four start disagreeing about which
  conversations the agent is in. It imports types and nothing else, on
  purpose — a value imported across a cycle is `undefined` while the importing
  module's top level runs, and a precedence rule resolving to undefined is an
  agent that either goes mute or talks over a human.
- **Off and shadow are CEILINGS, not defaults.** An override cannot lift them.
  A per-conversation pin that could make a shadow org send would defeat the
  point of shadow, and one that could make a non-entitled org answer would
  defeat the gate.
- **The per-conversation override is stored only when it DIFFERS from the
  default, and cleared when it matches.** That is what buys inheritance with
  no UI for it: there is no fourth "follow the business" pill to explain,
  because choosing the value the business already has *is* following it. An
  untouched thread moves when the owner changes the default; a decided one
  keeps its decision; undoing costs one click.
- It is a full mode and not a pause switch because **a default you can only
  switch off is not one you can disagree with**. A business answering live
  still has the awkward thread it wants drafted first, and one on drafts has
  the regular it is happy to let run.
- **`customers.agentPausedAt` stops deciding anything** and becomes the "since
  when". It is still read exactly one way: a row stamped before
  `agentModeOverride` existed has no override, so the resolver reads the stamp
  as an implied "off". Without that shim every conversation a human had taken
  over would have been handed back to the agent, silently, mid-repair, on
  deploy day. Nothing else reads it.
- **The turn row IS the draft queue.** No second table: `chatAgentTurns`
  status "suggested" with `suggestionOutcome` UNSET is a pending draft, and
  that absence is how the thread finds the one live one. A draft therefore
  cannot exist without the tokens, tool calls and prompt version that produced
  it sitting beside it. Retiring the previous pending draft happens inside
  `recordTurn`, in the same transaction as the insert, so a thread can never
  show two and nobody can send one written for a message already followed up.
- **A draft changes nothing until it is sent** (2026-10-13, Nudge's Approve
  rule). In suggest the write tools record the change on the turn
  (`intents`) instead of making it; the composer shows it above the box
  ("Sending this books …", with an × that drops it by retiring the draft).
  `sendSuggestion` makes the changes FIRST and ALL OR NOTHING: one mutation
  (`applyDraftChanges` → `applyIntentsTx`) makes every change in the model's
  order, each judged against the calendar as the ones before it left it, and
  stamps `intentsAppliedAt` in the same transaction. A refusal throws, rolls
  back every change and every message they scheduled, retires the draft with
  the reason and sends nothing; a send that fails after the change says so
  (`changed-not-sent`) and puts the words back without making the change
  twice. The dry run at generation is the same function inside a nested
  mutation that always throws (`simulateDraft` / `simulateDraftInner`), so a
  draft is judged exactly as sending will judge it and keeps nothing; a
  scheduled job inside a rolled-back nested mutation does not survive
  (checked on the local backend, 2026-10-13). A change cal.com would have to
  hold is refused in a draft: it cannot be part of a transaction. An attachment, quote
  or scheduled send cannot carry the change, so the composer refuses those
  while one is pending. The automation stand-down is LIVE ONLY now, and fires
  only when a write scheduled the business's own message to the customer AND
  that message will land in their WhatsApp conversation, judged by the send
  path's own predicates (`confirmation_sent`; `lib/lifecycleSend`
  `lifecycleReaches`, whose `lifecycleTemplates` / `whatsappVerdict` /
  `emailVerdict` are what `wa.sendAppointmentMessage` branches on): consent,
  suspension, the rule's channel, a lane, words for the shop phone, an
  approved Meta template in the customer's language. Never on "a rule
  exists", and never on a message bound to fail or to go by email only. The
  phone agent's "a message will follow" counts any channel. The public
  booking and manage pages read the same judgement per channel
  (`lifecycleChannels`, of which `lifecycleReaches` is the yes/no), returned
  as `confirmBy` by `booking.book` and `booking.reschedule`, to name the
  channel the confirmation is coming by and to say nothing when none is
  (2026-10-13). A dry tool tells
  the model a business rule will send the confirmation once the draft is
  sent, so the draft stays short instead of vanishing.
- **An edited send still records as "sent".** The acceptance rate asks "was
  this worth sending", not "did the model get every word right" — a rate that
  only counted untouched drafts would punish exactly the edit that made one
  usable. It is a reading, not a feedback loop: nothing trains on it.
- **The claim happens before the send, not after.** `sendSuggestion` flips the
  outcome to "sent" in a serializable mutation first, so two staff on one
  thread cannot both win; the loser is told the draft is gone rather than
  sending it twice. On a send failure it releases the claim, or a WhatsApp
  outage would quietly eat every draft it prevented.
- **A staff reply takes the conversation over only when the agent was answering
  LIVE.** In suggest a person is reading every draft already, so typing means
  they are working the thread the way the mode intends — silencing the agent
  there would turn "I sent one myself" into "the drafts stopped and nobody said
  why". Two things happen regardless of mode, because they are about the human
  who just wrote: the flag clears, and any pending draft is retired. Otherwise
  answering a message in suggest mode costs two actions, the reply and then
  tidying up a proposal for a message already handled.

### The grace window is the load-bearing part

`AUTO_SEND_GRACE_MS = 15_000`, in `lib/chatAgentTemplate.ts`. It used to be a
debounce on the OTHER side — every turn slept fifteen seconds before
generating, coalescing a thought typed as four fragments into one answer —
and the owner saw nothing until the reply had already gone. Serdar moved the
wait (2026-08-31): the webhook schedules `respond` at zero delay, the draft
is on screen the moment it exists, and the fifteen seconds now sit between
"generated" and "sent" on live threads, counted down in the composer where
Stop, a keystroke, a colleague's reply or a newer customer message can all
defuse it (`fireAutoSend`, a durable scheduled job, never a sleep).

The fragment problem is still covered, just later: every inbound schedules
its own turn carrying its own message id, a turn whose message is no longer
the newest stands down (at load, and again after generation), and `recordTurn`
retires whatever draft was pending in the same transaction it records the
newer one. A stood-down turn writes no row, deliberately, exactly like
`agent-off`: a sentence finished in a second thought is a normal way to type,
not an event worth four entries in the flight recorder. The cost of the move
is a generation per fragment instead of one per thought; the owner seeing
every draft immediately is what that buys.

A live pending reply is a `chatAgentTurns` row with status "suggested" AND
`autoSendAt` — the same queue, supersede rules and discard as a suggest-mode
draft, with a fuse attached. Billing for an auto-sent turn lands at fire
time (`applyAutoSendOutcome`), not at record time, because the send is what
the org pays for; a failed fire falls back to a plain pending draft rather
than eating the text.

The newest-inbound check reads the same 30 rows the prompt's history already
needed; they were two separate `take(30)` calls on one index for one moment
until they were hoisted into one.

### Asking for a person stopped meaning "stop"

Escalating used to pause the agent, always. So a customer who asked one thing
the agent could not price lost the agent for *everything else too*, including
the opening hours it knew perfectly well. That is now
`orgs.chatAgentStopOnHandover`, and it defaults to **keep answering**: the
agent says a person is needed, stamps `customers.agentFlaggedAt`, and carries
on. Existing live orgs feel this change; it is the direction worth being wrong
in, because silence is the more destructive of the two to get by accident.

Two positive options in the UI, never a checkbox — both are real products a
business might want, and phrasing one as the absence of the other makes the
default look like the setting nobody got round to.

Three things about the tool itself:

- **It returns FACTS, never a sentence.** It used to return `note: "Tell the
  customer the team will follow up."` and the model wrote that line verbatim
  every single time. It now returns `{handedOver, keepAnswering,
  alreadyFlagged}` and the wording is the model's job.
- **Its description changes with the policy.** A description promising to hand
  the conversation over, while the business has it set to keep answering,
  would have the model writing goodbyes into a conversation it is about to
  continue.
- **The write happens in LIVE only.** In suggest there is nothing to stop and
  nothing to flag — a human is reading every draft — and stamping there would
  quietly switch off an agent nobody took over. When it does stop, it stops
  with `force`, because the assistant asking for a human is a later and more
  specific statement than whoever earlier pinned the thread to live; without
  that, pinning a chat to live would silently mean "and it can never hand
  over".

`alreadyFlagged` rides into the tool result so the model is told plainly that
it has already announced a colleague. That is the whole difference between
flagging something once and nagging about it every turn. And the invitation to
escalate "when you are unsure" is gone from both the tool description and the
channel rules — a door that is always open, and the model walked through it on
questions it could have answered. Template v7.

The flag notifies nobody, deliberately. Staff read their own chats; it is an
amber line on a surface somebody already has open.

### The LLM seam had three things wrong (same day)

Carried back from the Nudge port, which found them:

- `claude-sonnet-5` was priced at **3/15 — Sonnet 4.6's rate**, inherited when
  the model name changed and the numbers did not. Every Sonnet turn was
  metered at 1.5x its real cost. Turns snapshot their own rate, so correcting
  the table is forward-only and rewrote nothing. Correct rates as of
  2026-08-28: opus-5 5/25, fable-5 10/50, sonnet-5 2/10, sonnet-4-6 3/15,
  haiku-4-5 1/5, gpt-5.2 1.75/14. `PRICE_TABLE_VERSION` was 3; the table
  grew to every listed model on 2026-10-13 (next section).
- **An unpriced model made the budget cap a decoration.** An unknown model
  metered at zero, zero never accumulates, and the cap never tripped, behind
  a confident $0.00. Since 2026-10-13 it fails closed instead (next section).
- **`output_config.effort` was never set**, so every receptionist turn ran at
  the API default of "high". It is now `"low"`. Thinking stays ON: disabling
  it is *accepted* on Sonnet 5, but a model with thinking off sometimes writes
  a tool call into its visible text instead of a `tool_use` block — the turn
  succeeds, the tool never runs, nothing errors, and the customer is told
  about a booking nobody made. This agent has seven tools. `budget_tokens` is
  not the dial either; it is rejected with a 400 on the current models. And
  `MAX_COMPLETION_TOKENS` went 1024 → 2048, because thinking tokens draw from
  that same budget and 1024 is a reply truncated mid-sentence — one we would
  still send.

### Each model gets the request it accepts; an unpriced one never runs (2026-10-13)

`/admin` offers every model the platform key lists, and two of them broke the
seam above. Haiku 4.5 answers `output_config.effort` with a 400, so picking it
silenced every org's assistant; the 5.5 family had no price row, so picking
one metered every turn at $0 and the budget never closed. Nudge found both
(08311abc). What stands now, all in `convex/lib/llm.ts`:

- **One table, `MODELS`, per model: its price and what it accepts.** A model
  is either fully known or not at all, because a priced-but-undescribed model
  gets a request it may refuse and a described-but-unpriced one runs free.
  `anthropicModelParams` sends `effort` only where the model takes it (not
  Haiku 4.5 or Sonnet 4.5) and sends `thinking: {type: "adaptive"}` to Opus
  4.6 to 4.8 and Sonnet 4.6, which otherwise answer with thinking OFF, the
  visible-tool-call failure above. A model it does not know gets neither.
  Dated ids are rows of their own, never matched by stripping the date.
- **Priced per completion, summed per turn** (`meteredMicroUsd` in
  `chatAgent.respond`), because Haiku 5.5 bills a request whose prompt passes
  100K tokens at its long rate, and the turn's summed tokens would put a
  five-round turn on that rate when no request was long.
- **An unpriced model fails closed.** The turn context skips with
  `model-unpriced` before any spend, `platformConfig.listModels` offers only
  priced models, and the org page's model pill says why turns are skipping.
  `costMicroUsd` bills a model with no row at the table's dearest rate, so a
  future caller that forgets the gate is overcharged, never free.
- **The default stays `claude-sonnet-5`** (Serdar's call); Nudge moved its own
  to Haiku 5.5, which is not a decision this port makes.

### Where the controls live, and why not elsewhere

Nudge's standing rule applies in this direction too: **port the mechanisms and
the hard-won facts, never port where a control lives.** Nudge is one
deployment per tenant, so its Settings *is* its admin panel and it keeps the
brief, the budget, the model and the turn log there. Resepta is one deployment
serving many tenants. So: the owner sees three pills and a handover policy;
the budget, the model, the turn log, the acceptance count and shadow stay
operator-only behind /admin.

The per-conversation control renders even when the business default is "off",
because a control that vanishes at "off" cannot be used to switch a single
conversation ON — which is half of what a per-conversation override is for. It
renders nothing at all when the org has no agent, rather than a disabled
control for a feature they do not have.

`SegmentedControl` was extracted from BusinessView's field-source picker so
the settings row and the thread strip cannot drift into looking like different
decisions. A segmented control rather than a switch whenever **off is a state
rather than the absence of the control**. Since 2026-10-13 it is the only
segmented control in the app (eight hand-made copies were folded into it), on
its own `--segment-*` tokens so it shows in dark mode; the thread strip wears
its xs size.

The thread strip is ONE control. The bar it replaces was a status sentence
*plus* a Take over button — two controls changing one state from opposite
directions, where reading it meant working out which of the two you were being
told. Its label says "in this chat", and that is load-bearing: without it the
pills read as the business setting and somebody muting one awkward
conversation would think they had switched the assistant off for everybody.
The draft docks above the composer rather than at the end of the message list,
because a draft is a proposal about the NEXT message and one you have to
scroll to find is one you miss on a busy morning. Its textarea re-seeds on the
draft's **identity, never its text** — keyed on the text, a model that produced
the same sentence twice would silently throw away whatever the reader typed
over it.

### What an adversarial pass found, same day

Eight defects, all with reproductions, all fixed. The four worth knowing about
because the same shape will recur:

- **"Newest inbound" is not "newest inbound that scheduled a turn".** The
  debounce first compared the turn's message against the newest `direction:
  "in"` row, and stand-downs write no row — so any inbound that logs a row
  WITHOUT scheduling a turn silently killed the turn that was pending and put
  nothing in its place. A voice note or photo (the webhook reads `text` from
  `message.text.body` only; media goes to `mediaCaption`, so `text` is empty
  and nothing schedules — but a row with body `[audio]` is written), a Confirm
  or İPTAL tap (resolves an appointmentId, so the whole `if (!appointmentId)`
  block containing the scheduler is skipped), and an inbound EMAIL on the same
  customer all did it. Customer asks a question, sends a voice note four
  seconds later, gets no answer and there is nothing in the flight recorder to
  find. Fixed with `customers.agentTurnScheduledFor`, stamped in the same
  mutation that schedules: the check now compares against what actually took
  over from it. **The general shape: a guard that says "stand down, something
  newer is handling this" must be reading the thing that IS handling it, not a
  proxy that correlates most of the time.**
- **A go-live stamp fired on every off→live flip.** `setChatAgentMode` stamped
  `chatAgentBehavior: "suggest"` whenever behaviour was unset — which is
  exactly the state of every org the `?? "live"` default exists to protect. An
  operator toggling a long-live org off for ten minutes to look at a bad reply
  and back on would have demoted it to drafts nobody knew to read. It now
  stamps only when `chatAgentMode` itself was undefined, the one state that
  means "never enabled".
- **Accepting a draft could switch the agent off.** Drafts go out through
  `wa.sendSession` — deliberately, so the session window and lane rules are the
  ones already in force — and that path calls `pauseForCustomer`, which reads a
  human sending into a LIVE thread as a takeover. A draft pending while the
  thread reads live (staff hit the Answers pill, or the owner flipped the
  business default) meant accepting it pinned that conversation Off, pills
  jumping with no explanation. Two fixes, both worth keeping: a mode change
  retires pending drafts, and `stateForCustomer` only offers a draft while the
  thread is actually on drafts.
- **Retiring the draft before the send destroyed it.** The first version put
  `supersedePendingSuggestions` in `pauseForCustomer`, which runs BEFORE the
  send and therefore before `session-window-closed`, `no-consent`,
  `wa-not-configured` and Meta itself. Staff typing their own reply into a
  thread whose 24h window had closed lost the message AND the draft AND the
  flag. Moved to `messages.applySendResult`'s ok branch — the one place every
  send path already reports, which is why the send-usage and open-rate counters
  live there too. **Retire content on the branch that means it landed, never on
  the branch that means somebody tried.**

Three smaller ones: `releaseSuggestion` could restore a claim on top of a
newer pending draft, leaving two pending with the thread rendering the stale
one (it now supersedes instead, and `pendingSuggestionsFor` returns newest
first); the draft's Send button had no `try/finally`, so a thrown action left
both buttons disabled until remount; and a live turn had no freshness check
between the debounce test and the send, so "merhaba" at t=0 and the real
question at t=20s produced two replies, the first answering a thread that had
moved on.

And one that is worth its own paragraph, because it is the kind of hole a
mechanical guarantee grows when a human is added to the loop. **The AI
disclosure was bypassable in suggest mode.** The line is prepended
mechanically when a draft is generated — never left to the model, because that
would make compliance a probability — but a draft lands in a textarea, and a
staff member who finds the sentence clumsy could delete it and send. The turn
still recorded as the sent one, so `disclosed` became true forever and no
message that customer ever received carried it. `claimSuggestion` now returns
the line still owed and `sendSuggestion` re-prepends it when it is missing.
The rule generalises: **anything the system guarantees mechanically has to be
re-guaranteed at the point a human can edit it.**
