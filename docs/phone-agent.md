# Phone agent: architecture and operator runbook

Last reconciled with the implementation: 20 August 2026.

This is the canonical handoff for Resepta's phone-agent lane. Salon owners use
one native Resepta surface. The current execution provider is an implementation
detail that appears only in backend code and the platform-admin console.

## Product contract

- Resepta is the source of truth for business instructions, customer fields,
  variable lifecycle, call history and appointment writes.
- A salon owner can create a new appointment receptionist or connect an
  existing agent from **Phone agent**.
- The salon-facing UI says Phone agent, Instructions, Variables and Call
  results. It never asks the owner for provider IDs, URLs, credentials or
  webhook configuration.
- Provider credentials and raw setup diagnostics belong to the platform
  operator at `/admin`.
- Resepta may assign an already-provisioned, unclaimed phone line. It does not
  buy or import a new number.
- An agent detects an answering machine on an outbound call and hangs up
  (template v13). It leaves no message: message wording is a per-business
  decision, and a control for it on the agent page is open work.
- No call runs past ten minutes (template v14): the provider ends it, and the
  call record says "Hit the maximum call length".
- A business requests its phone number by uploading a company registration
  document. The tenant sees three states — received, approved, live — and is
  never told which parts of the pipeline are people. Operator reality: the
  approve button reviews the DOCUMENT only; nothing in provisioning reads that
  status. The grant is the Phone lines checklist in `/admin`.

The Phone agent destination has two sections:

1. **Agents**: create/connect, line assignment, enabled state, details.
   Clicking an agent's name opens its own page (`?agent=`), described below.
2. **Calls**: paginated call history. A row opens into `CallDetail`, the one
   component every call renders through.

## The agent page

One column, no tabs: **Instructions → Opening line → Voice → Variables**, the
order a call happens in. It was tried as a modal and as two tabs; both hid the
thing the page exists for. `{{variables}}` render as pills in the instructions
and the opening line, and `@` inserts them.

One **Save** in the header publishes everything, and **Variables publish before
the prompt** — `publishVariables` guards on the agent's provider version, so
the other order fails with a stale-version error nobody caused. Voice rides the
same publish via `publishViaDraft`'s `agentPatch`, so voice and script land as
one version rather than leaving a window where a caller hears the new voice
reading the old script.

Variables are edited **inline**, grouped under Before / During / After by each
row's most active phase. Because a Resepta variable is a lifecycle rather than
one moment, the row's popover — type, choices, phase, destination, required —
is what moves it between groups; the row itself carries only its name (a
picker selection) and description. A published key never follows a label edit; renaming it
orphans every answer collected under the old name.

**Unsaved edits survive leaving, closing the tab and reloading**, kept per agent
in this browser's localStorage. The page's save bar (`EditorSaveBar`) says
they are not live with an amber dot and "Unsaved". Discard is the only thing
that throws them away.

## The call record

`CallDetail` is the only way a call is rendered — Phone agent → Calls, the
contact feed's expanded Calls column, and the mixed feed's card. Recording,
summary, why the call ended, collected values, then the transcript laid out as
a conversation. The transcript is parsed from the string already on
`calls.transcript`, not refetched, so it works for every call ever recorded;
speaker labels are read from the transcript itself rather than matched against
an English word list, because a Turkish call comes back `Ajan:` / `Müşteri:`.
`calls.disconnectionReason` is stored raw and humanized in the UI — on an
unanswered call it is the only thing there is to show.

## Create and connect flows

**Create new** is the default path in the Add agent sheet. The owner chooses a
name, Turkish/English/German, a voice and optionally an unclaimed line. Resepta
then:

1. compiles the versioned appointment-receptionist template in
   `convex/lib/voiceAgentTemplate.ts`;
2. creates the response engine and agent;
3. publishes the initial agent version;
4. connects the new agent to the org;
5. assigns the selected line, if any, once `retell.lineUsable` and the
   provider both accept it. A refused line is let go of rather than failing
   the job (`voiceProvisioning.dropNumber`): the agent finishes without one,
   the result names why (`lineRefused`), and the owner attaches a line
   afterwards through the usual picker; and
6. publishes the private Resepta runtime connection and call-result route.

`voiceAgentProvisioning` checkpoints every external resource ID and protects
the job with a short lease. A refresh, duplicate click or retried request
continues the same job instead of intentionally creating another agent. The
states are `pending`, `creating_engine`, `creating_agent`, `publishing`,
`connecting`, `complete` and `failed`.

**Connect existing** lists agents in that org's provider account. Adding one is
one operation from the owner's perspective: Resepta creates the org mapping,
adopts its current line and publishes the call-result route plus the private
runtime tools. Existing provider variables are imported on first open. The
first Variables publish adopts them into Resepta without removing unrelated
provider tools or system analysis presets.

Archive and disconnect are deliberately non-destructive. Archive only hides an
unconnected provider agent from the normal picker. Disconnect removes the
Resepta mapping; neither action deletes the underlying provider resource.

## Variables are derived from the Contact fields table (2026-08-25)

The capture registry is gone as an authored thing. What the agent collects is
DERIVED at publish time (`retellAgent.deriveCaptureRows`) from the org's
contact fields: every field whose switch is on becomes prefill-for-repeat-
callers + ask-when-missing + post-call transcript recovery, landing on its own
field; the unlocked identity columns (first name, last name, email) ride along
as questions landing on the customer's own columns. Phone is never derived —
the caller is matched by it. `voiceAgentVariables` still exists as storage,
but publish overwrites it with derived rows plus any legacy static context;
hand-authored capture rows are filtered out and cannot come back through any
door, the MCP tool included.

The owner surface is the Variables matrix on the agent page: one row per
field, `name · type · description · Asistan`, one green check. The description
is the extractor's instruction and lives ON the field
(`contactFields.voiceDescription`; identity's three live on the org as
`voiceIdentityDescriptions`). Select options edit inline from the type cell
and the published enum rebuilds from them. The same switch is the Contact
fields table's Voice column — one mutation, two renderings, and the matrix
reads LIVE queries, so a flip repaints instantly and needs no publish to be
stored (Retell learns about it on the agent's next publish).

Publishing compiles the derived set into provider defaults, the live
extraction tool and post-call analysis fields. Resepta remains the editable
schema; the provider configuration is generated output — the analysis list in
the Retell console is rebuilt IN FULL on every publish, so console edits there
are overwritten.

Confirm-first no longer exists as configuration: extraction always
asks-when-missing during the call, and the transcript pass fills only what
was missed. Stored `voiceConfirm` flags are ignored.

Renaming is label-only and therefore safe: the key is the identity (stored
values and published agents address it), so editing a field's label —
Customers → Contact fields, or the matrix — ripples everywhere instantly with
nothing to republish. The key itself is derived from the label (the one rule
is `lib/keys.ts`), can be declared explicitly when the field is created, and
can move only while nothing addresses it. Handing a field back to staff is
NOT guarded anymore: switching its check off IS the unlink, and the next
publish stops deriving it.

The Contact fields table lives under Customers (its own tab since
2026-08-25): system rows pinned, org rows drag to reorder, and a Voice agent
column that is the same switch the matrix renders.

The precedence rule is fixed:

1. a value the caller gives during the live call wins;
2. post-call transcript extraction only fills a missing customer value; and
3. before-call context is recorded with the call but never writes back by
   itself.

Customer writes are permissioned by `contactFields.source === "voice"`.
Reserved identity and compliance fields, including phone, email and consent,
cannot be made writable through Variables. Every variable is also retained on
the call row so the transcript and recording have an auditable per-call value.

## The connector can do all of this without a browser

Everything above is reachable from the MCP connector as well as the UI:
`list_phone_agents`, `list_voices`, `create_phone_agent`,
`list_agent_variables`, `set_agent_variables`, `assign_phone_number`, plus the
services and contact fields an agent reads at call time. That exists so a
business can be stood up end to end — fields, services, agent, line — without
anybody clicking through the app.

**The invariant that makes it safe.** Three internal functions —
`voiceProvisioning.begin`, `retell.agentEditorContext` and
`retellAgent.publishVariableSet` — accept an optional `orgId` and TRUST it.
That holds only because each is internal AND no public action forwards a
caller-supplied `orgId` into one. `createAgent` and `publishVariables` must
never grow an `orgId` argument: `agentEditorContext` only checks that the agent
belongs to the org it was handed, so a public action taking one would let a
client edit any agent whose id they could name. The internal twins
(`createAgentForOrg`, `publishVariablesForOrg`, `assignLineForOrg`) exist so
the public pair never has to.

Two things worth knowing before using it:

- `set_agent_variables` takes contact field KEYS, not variable rows, and
  rebuilds the set from them. `business_name` is always included: publishing
  recompiles the provider's default dynamic variables from the given set
  alone, so a set without it silently blanks `{{business_name}}` and the agent
  opens by greeting nobody.
- Agents are addressed by their RESEPTA id, never the provider's. Making an
  owner pass provider ids around would be the loudest possible violation of
  "Retell is an implementation detail".

Provisioning reads `agentEditorContext` at the END, for the runtime wiring. A
sessionless caller that could not reach it got the worst half: a real provider
agent, connected and enabled, with no Resepta runtime — able to answer a call
and neither read nor write anything.

## Runtime and call-result flow

The runtime connection is private and agent-specific:

- `/retell/inbound` injects current before-call context for an incoming caller.
- `/retell/mcp` exposes only `get_call_context` and `save_customer_details`,
  and only to agents published before template v10. The clear runtime token is
  written once to the provider; Resepta stores only its hash. The token names
  the agent, not the call, so since 2026-10-13 neither tool identifies a
  caller: `get_call_context` returns the business context only, and
  `save_customer_details` refuses (the caller used to be whatever `phone` the
  model passed). One publish moves an agent to the custom function, which
  reads its caller from the call.
- `/retell/functions` handles appointment availability, booking, lookup,
  cancellation and rescheduling. It knows the caller from the call leg Retell
  signs (`retell.callerOfCall`), never from a tool argument; a call with no
  usable number gets spoken refusals from every tool that needs one.
- `/retell/call-ended` receives both the immediate call-ended event and the
  later analyzed event.

Every signed call event first lands in `voiceEvents`. The HTTP response means
the exact payload is durable, not that all downstream writes happened inside
the request. Processing retries with backoff, materializes or merges the
`calls` row, and applies allowed customer updates. Event keys make provider
retries idempotent.

A value that says the call did not establish something ("Belirtilmedi", "Not
specified", "Nicht angegeben", `lib/nonAnswer.ts`) is dropped everywhere a
collected value is handled: the live save, the post-call inference, the
call's own collected list and the booking name. One stored before
2026-10-13 counts as an empty field: the next real answer replaces it, and it
is never injected into a call.

The provider sends `call_ended` before its analysis is ready. Resepta records
the call immediately, then waits for `call_analyzed`. If that later event is
missed, a bounded recovery fetches the provider's per-call analysis. Exhausted
updates produce a provider-free warning for the salon and retain raw details
plus a replay action in platform admin.

## Tenant isolation and authentication

- Every voice table carries `orgId`; all customer-facing reads and writes are
  scoped through the caller's org.
- An inbound provider payload names an agent, never an org. Resepta resolves
  the globally unique agent ID to its org and then verifies the signature with
  that org's own API key.
- Provider keys live in org-scoped `connections` rows. There is no shared
  deployment-key fallback because that could expose one customer's account to
  another org.
- Runtime bearer tokens resolve to exactly one connected agent and are stored
  as one-way hashes.
- Provider IDs, setup errors and event payload diagnostics are restricted to
  the platform-admin surface.

## Operator setup

1. Add the operator email to the Convex deployment's
   `PLATFORM_ADMIN_EMAILS` allowlist.
2. Open `/admin`, choose the org and install that customer's provider API key
   under Voice. The secret is stored per org and only shown back as a masked
   tail.
3. If the customer needs an inbound line: when they uploaded a registration
   document, review it under Phone lines (Accept document / Reject document
   with a note they will read). Then buy the number at the provider, and tick
   it in the same card's checklist — that tick is the actual grant, and their
   request card flips to "live" with the number printed. A line another
   business holds can be taken directly: click it, click again to confirm,
   and `platform.claimPhoneNumber` moves the allowlist entry and releases the
   loser's binding at the provider in one act. Number purchasing stays
   outside the app.
4. Have the org owner open **Phone agent → Add agent** and create the native
   receptionist. Connecting an existing agent is the fallback path.
5. In platform admin, confirm the provisioning job completed, the Resepta
   runtime is connected, and call-result events are arriving.
6. Make a test call. Confirm the call appears under Calls, allowed customer
   details update, and a later analysis enriches the same call instead of
   creating a duplicate.

For an exhausted event, use **Retry failed updates** in the org's admin page.
The durable payload is replayed; the provider does not need to resend it.

An agent can point to only one deployment. Do not use **Fix** in development
for an agent that production also uses: that moves its call-result URL to the
development deployment and steals results from production.

## Scheduling dependency

The default receptionist knows how to check, create, cancel and reschedule
appointments through Resepta. Two availability lanes exist:

- **cal.com connected**: `check_availability` asks cal.com for the day's real
  slots and offers up to ten.
- **No cal.com**: Resepta's own appointments table is the calendar. The tool
  answers with the day's FULL blocks (capacity-aware), the open hours and
  closed days, and — since 20 August 2026 — `suggested_slots`: two or three
  concrete free times computed server-side (`suggestFreeSlots` in
  `convex/lib/businessHours.ts`, first/middle/last of the free half-hours).
  Slot picking is deterministic code, not model judgment, because on a live
  call an empty Friday came back as `booked_slots: []` and the agent recited
  the opening hours at the caller. The chat agent shares the same helper.
- **The asked time, and the nearest free ones (2026-10-13, template v14).**
  The tool takes the caller's `time` as chat's does, and its description has
  the agent ask which day and time suit the caller before listing any. That
  time is answered as a fact (`requested_time`, `judgeRequestedTime`, one
  verdict for both lanes); a taken or shut time, and every booking or move
  refused for its time, comes back with `nearest_free`: two free times either
  side (`retell.nearestFreeTimes`, the booking page's own `freeStarts`, the
  asked day first, then outward). Days are listed Monday first everywhere the
  agents read hours.

Booking writes re-verify everything server-side (hours, closed days,
capacity, lead time) regardless of which lane answered the availability
question.

## Which model an agent runs

Three layers, resolved wherever a model id is written to the provider —
`agent.llmModel ?? platformConfig "voiceModel" ?? VOICE_AGENT_MODEL`:

1. **Per-agent override** (`retellAgents.llmModel`): the Model picker on the
   agent's card in `/admin/[orgId]` → Voice agent. Set through
   `platform.setAgentModel`, which publishes to the provider first and stamps
   the row only after the provider says yes. Survives template syncs.
2. **Fleet default** (`platformConfig` key `voiceModel`): the Voice agent
   model picker in `/admin` → AI & Voice defaults. Moves an agent on its next
   publish or template sync, never by itself. Table-only, no env fallback.
3. **The constant** (`VOICE_AGENT_MODEL` in `convex/lib/voiceAgentTemplate.ts`):
   what everything falls back to, and the only layer that needs a deploy to
   change.

The pickers are built from `convex/lib/voiceModels.ts` — the catalogue of ids
the live API actually accepts. The API rejects unknown ids but the SDK types
the field as a bare string, so the catalogue is the real guard. A stored id
that later leaves it stops resolving (`resolvePlatformVoiceModel`) instead of
reaching a provider PATCH.

**Reading the provider's allowlist beats probing it.** POST a made-up model id
and the 400 names every allowed value in one line. Done 24 Aug 2026: all 21
text ids in the catalogue are on it. The catalogue deliberately omits the
superseded generations that list still carries (gpt-4o, gpt-4o-mini,
claude-4.0-sonnet, the gemini-2.x line), so the picker offers what a business
should be running rather than everything the provider still answers to.

Prices render through `formatVoicePrice`: three decimals, four below a cent.
gpt-5.6-luna is $0.0064/min and three decimals round that to $0.006, which is
6% light on a model whose whole pitch is the price.

## Which tier it runs at

Retell sells a second, faster price on the same model — `model_high_priority`,
labelled **Fast tier** in its dashboard. It is not a model and not a quality
setting: same model, same voice, same prompt, less time queued.

It resolves through the same three layers as the model, in the same order —
`agent.llmHighPriority ?? platformConfig "voiceHighPriority" ??
VOICE_AGENT_HIGH_PRIORITY`. Both stored layers are **tri-state**: unset means
inherited, not off. The constant has been `true` since template v11 (20 Aug
2026), so reading an empty row as false would silently downgrade the fleet.

**One picker, not two** (24 Aug 2026, Serdar). The console offers an ENGINE —
a model and the tier it runs at, as one choice — because that is one decision
and splitting it let an operator read a model's price without the tier that
doubles it. `voiceEngineChoices` expands the catalogue into rows, each fast
variant sitting immediately under its standard row; the value grammar is a
suffix (`gpt-5.1:fast`), chosen so every standard row's value stays
byte-identical to what the picker stored before the tier existed. Per-agent is
`platform.setAgentEngine`, one provider round trip and one published version
for both settings. The fleet control writes the two config rows in sequence,
model first.

The cost of this shape, since it is a real one: **"explicit model, inherited
tier" is no longer expressible.** Picking a model pins its tier too, so a fleet
tier change stops reaching any agent that pinned one. Inheritance survives on
the "Platform default" row, which follows both. `setAgentModel` and
`setAgentHighPriority` remain as single-knob doors for the CLI.

**Which models have one is DATA, not a rule** (`fastUsdPerMinute` in
`lib/voiceModels`). Membership is read off Retell's own picker, where a row
with a chevron opens a Default/Fast submenu and a row without has no tier to
choose. Ten ids have one as of 24 Aug 2026: gpt-5.5, gpt-5.4, gpt-5.4-mini,
gpt-5.2, gpt-5.1, gpt-5, gpt-5-mini, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano.

Do not turn this back into a heuristic. A `gpt-` prefix rule shipped here
first and invented two tiers that do not exist: **gpt-4.1-nano has a fast tier
and gpt-5-nano does not.** Membership follows neither family nor generation
nor size, so only the picker knows.

The prices are doubling, and only gpt-5.1 has been read directly ($0.040
against $0.080 in its submenu). The pricing page describes the OpenAI fast
tier that way for the line. Each is one number to correct the day a submenu
says otherwise.

Claude and Gemini have no fast tier at all. Retell's API takes
`model_high_priority: true` on them regardless (verified 23 Aug 2026 with a
throwaway LLM per family: all five echoed `true`), but an unvalidated field is
not a feature. Those ids simply contribute no second row to the picker, which
is how Retell shows the same fact.

Orgs pay one flat `voiceRateMicroUsdPerMinute` per called minute regardless,
so the tier difference is margin, not invoice. That is the argument for having
the dial at all: the latency was bought for a live salon line, and it was
being paid for on every demo agent and idle trial org too.

**Every engine publish carries both values.** `enginePatchFor` is the single
function all three paths use — birth, `syncTemplate`, and the model/tier
publish — because an omitted field survives the PATCH. The model publish
originally sent the engine fields alone, which is how a model change quietly
inherited whatever tier the engine already had.

**Realtime (s2s) entries** are in the same picker with an `(s2s)` label
suffix. They live in the provider's `s2s_model` field, not `model`, and the
two are mutually exclusive: `enginePatchFor` decides the field and nulls the
other, and both fields ride every engine PATCH because the provider keeps an
omitted field (verified live — sending only the new one leaves both engines
configured). An s2s agent speaks with the model's own voices; the configured
voice stops applying. The fast-tier knob does not apply to them — it belongs
to the STT→LLM→TTS pipeline an s2s agent replaces, so `enginePatchFor` drops
it and the per-agent control is not rendered. Two operational facts from the
20 Aug live test:
Retell rejects s2s calls on free trial credits (`no_valid_payment` — a
payment method must be on file), and `gpt-realtime-2.1-mini` on a real
Turkish booking call was slower than Haiku (p50 1664ms vs 1586, p90 3.1s)
and collapsed on instruction-following. Haiku remains the default on
evidence, not inertia; the picker makes re-testing a ten-second flip.

## Voicemail (template v13, 2026-08-25)

`voicemail_option` is an agent-doc field, so it rides the same PATCH
`syncTemplate` already sends: existing agents pick it up when their owner
clicks update, new agents are born with it. Two facts learned from Nudge's
implementation, both verified there against the live API:

- **There is no boolean.** The field's PRESENCE arms detection; an explicit
  `null` disarms it. An off switch must SEND null — omitting the key patches
  nothing and would appear to work.
- **A write that omits `detection_prompt` deletes it.** That field defines
  what counts as an answering machine and is only writable in the provider's
  dashboard, so `syncTemplate` reads the live agent and re-attaches it — the
  same merge bargain as the analysis fields: ours replaces ours, theirs
  survives.

The template hangs up rather than leaving a message, deliberately: a message
guessed in shared code would be worse than the silence it replaced, and an
empty one records a beep the salon paid for. A per-business message wants a
control on the agent page (Nudge's `setVoicemail` is the shape to copy).

## Template v14 (2026-10-13)

P1 opened v14 with the asked time and the nearest free times (Scheduling
dependency above); P1c folded in the rest of Nudge's voice work before it
shipped, so an owner clicks Update once. Every piece is a tool or agent-doc
field, so `syncTemplate` delivers all of it to existing agents.

- **A ten-minute ceiling.** `max_call_duration_ms` on the agent doc
  (`MAX_CALL_DURATION_MS`, Nudge's number), riding the same PATCH as the
  voicemail field. A booking takes two or three minutes; the cap meets only a
  call that has gone wrong and bounds what it costs.
- **A holding line on the five calendar tools.** Each one speaks during
  execution with a prompt-type message in the agent's language
  (`HOLDING_LINES`): a few words, never a day or a time, because the
  confirmation after the tool says those once (Nudge f2a44605).
  `save_customer_details` keeps its v10 silence.
- **`start` is the business's wall time.** `book_appointment` and
  `reschedule_appointment` ask for `YYYY-MM-DDTHH:MM`, no zone and no Z, the
  shape chat's tools already ask for; the server reads a zone-less stamp at
  the business (`parseLocalStart`) and still takes a stamp with an explicit
  offset as the instant it names.
- **The recogniser is told the business's words.** The agent's
  `boosted_keywords` are the business name, its active team and its active
  services (`lib/boostedKeywords`, Nudge 3379705e and 61788709), read from
  this org's rows only. Derived, never edited: `syncTemplate` sends them, and
  so does every other publish that writes the agent doc (prompt save, fields
  publish, rename, webhook fix, which is also the end of provisioning), so a
  new service reaches the recogniser the next time anything is published.
  Ours replaces ours and anybody else's survives: `retellAgents.boostedKeywords`
  remembers what Resepta sent, and only those words are swapped. A list that
  would come out empty is never sent, and the list stops at fifty, inside the
  sixty-one Nudge runs in production, because a list the provider refused
  would fail the whole publish. The engine-only toggles (hang-up switch,
  operator model change) do not carry them.
- **Wording never names another tool.** Tool answers from `/retell/functions`
  reach every template version at once, while descriptions and holding lines
  arrive with their own tools, so only the five calendar tools (present since
  v1) may be named in a live answer, and `end_call` never, since a business
  can switch it off (Nudge ba2d956a).

## Current limits

- Resepta does not purchase phone numbers.
- Native creation currently supports `tr-TR`, `en-US` and `de-DE`.
- Detailed audio engineering such as latency and interruption behavior remains
  provider-operated.
- Existing conversation-flow or custom-engine agents can be connected, but the
  native Instructions editor cannot publish a prompt for an unsupported engine
  shape.
- Disconnecting or archiving does not delete external resources.

## Code map

| Area | Primary files |
|---|---|
| Salon UI | `src/components/VoiceView.tsx`, `VoiceCard.tsx`, `VoiceAgentPage.tsx`, `VoiceVariablesEditor.tsx`, `CallDetail.tsx` |
| Native template and orchestration | `convex/lib/voiceAgentTemplate.ts`, `convex/voiceProvisioning.ts`, `convex/retellAgent.ts` |
| Org mapping and variable registry | `convex/retell.ts`, `convex/schema.ts` |
| Runtime tools | `convex/voiceMcp.ts`, `convex/http.ts` |
| Durable call results | `convex/voiceEvents.ts`, `convex/retell.ts` |
| Operator diagnostics | `convex/platform.ts`, `src/app/admin/[orgId]/page.tsx` |
