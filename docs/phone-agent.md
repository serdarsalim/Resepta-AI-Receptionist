# Phone agent: architecture and operator runbook

Last reconciled with the implementation: 2 August 2026.

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
in this browser's localStorage. An amber pill says they are not live. Discard
is the only thing that throws them away.

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
5. assigns the selected line, if any; and
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

## Variables have one lifecycle

`voiceAgentVariables` is the registry. One row describes one value across the
whole call instead of asking the owner to maintain separate before, during and
after lists:

| Concern | Stored meaning |
|---|---|
| Before the call | No context, static value, business/customer fact, next appointment or a configured customer field |
| During the call | Do not ask, ask only if missing, or confirm the current value |
| After the call | Whether transcript analysis may recover a missing value |
| Destination | Keep on the call or write to an allowed customer field |

Publishing Variables compiles this registry into provider defaults, live
extraction tools and post-call analysis fields. Resepta remains the editable
schema; the provider configuration is generated output.

A variable's name is always a selection, never free text: "+ Add variable"
and every row's name cell open the same picker over the org's voice customer
fields and the built-in context. Selecting an existing field links it and pre-wires the repeat-caller
path: prefill from the customer card before the call, ask only when the value
is missing, write the answer back. Typing a new name creates the customer
field inline (it appears under Business → Services & fields at the same
moment) or, as the explicit exception, adds a call-only variable that never
touches the customer card. There is one field registry; agents reference it,
they never retype it. Deleting a customer field an agent still references is
refused for the same reason.

Renaming is label-only and therefore safe: the key is the identity (stored
values and published agents address it), so editing a field's label in
Services & fields ripples into every agent's editor instantly with nothing to
republish. The key itself is derived from the label (question scaffolding
stripped, capped at a word boundary; the one rule is `lib/keys.ts`), can be
declared explicitly when the field is created, and can be edited in the table
only while no agent references the field, never colliding with another key or
a reserved system key.

The Contact fields card is one sortable table, ported from Nudge's fields
admin: system rows pinned and undeletable, org rows drag to reorder, and a
Filled by column (Staff / Voice agent) instead of separate groups. A select's
type cell reads "Select (n)" and expands into its options editor (removable
pills plus "Add an option"); the same editor appears in the agent popover, and
for a linked select both edit the field itself, which publish reads as the
live truth. A field an agent references can be neither deleted nor handed
back to staff until the agent unlinks it.

The precedence rule is fixed:

1. a value explicitly confirmed during the live call wins;
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
- `/retell/mcp` exposes only `get_call_context` and `save_customer_details`.
  The clear runtime token is written once to the provider; Resepta stores only
  its hash.
- `/retell/functions` handles appointment availability, booking, lookup,
  cancellation and rescheduling.
- `/retell/call-ended` receives both the immediate call-ended event and the
  later analyzed event.

Every signed call event first lands in `voiceEvents`. The HTTP response means
the exact payload is durable, not that all downstream writes happened inside
the request. Processing retries with backoff, materializes or merges the
`calls` row, and applies allowed customer updates. Event keys make provider
retries idempotent.

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
3. If the customer needs an inbound line, provision it in the provider account
   first and leave it unassigned. Resepta will offer it in the Create new
   picker. Number purchasing stays outside the app.
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
appointments through Resepta. Availability is truthful only when the operator
has installed that org's cal.com API key and event type in platform admin.

Without those values, a call can still create a Resepta-only appointment, but
no availability or conflict check runs. Double-booking is therefore possible.
The agent template is instructed to ask for the caller's preferred exact time
without claiming that the slot was checked.

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
