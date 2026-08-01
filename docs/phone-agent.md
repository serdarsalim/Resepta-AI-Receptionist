# Phone agent: architecture and operator runbook

Last reconciled with the implementation: 31 July 2026.

This is the canonical handoff for Randevu's phone-agent lane. Salon owners use
one native Randevu surface. The current execution provider is an implementation
detail that appears only in backend code and the platform-admin console.

## Product contract

- Randevu is the source of truth for business instructions, customer fields,
  variable lifecycle, call history and appointment writes.
- A salon owner can create a new appointment receptionist or connect an
  existing agent from **Phone agent**.
- The salon-facing UI says Phone agent, Instructions, Variables and Call
  results. It never asks the owner for provider IDs, URLs, credentials or
  webhook configuration.
- Provider credentials and raw setup diagnostics belong to the platform
  operator at `/admin`.
- Randevu may assign an already-provisioned, unclaimed phone line. It does not
  buy or import a new number.

The Phone agent destination has two sections:

1. **Agents**: create/connect, line assignment, enabled state, details,
   instructions, variables, connection health and test calls.
2. **Calls**: paginated call history with recording, collected information,
   summary and transcript.

## Create and connect flows

**Create new** is the default path in the Add agent sheet. The owner chooses a
name, Turkish/English/German, a voice and optionally an unclaimed line. Randevu
then:

1. compiles the versioned appointment-receptionist template in
   `convex/lib/voiceAgentTemplate.ts`;
2. creates the response engine and agent;
3. publishes the initial agent version;
4. connects the new agent to the org;
5. assigns the selected line, if any; and
6. publishes the private Randevu runtime connection and call-result route.

`voiceAgentProvisioning` checkpoints every external resource ID and protects
the job with a short lease. A refresh, duplicate click or retried request
continues the same job instead of intentionally creating another agent. The
states are `pending`, `creating_engine`, `creating_agent`, `publishing`,
`connecting`, `complete` and `failed`.

**Connect existing** lists agents in that org's provider account. Adding one is
one operation from the owner's perspective: Randevu creates the org mapping,
adopts its current line and publishes the call-result route plus the private
runtime tools. Existing provider variables are imported on first open. The
first Variables publish adopts them into Randevu without removing unrelated
provider tools or system analysis presets.

Archive and disconnect are deliberately non-destructive. Archive only hides an
unconnected provider agent from the normal picker. Disconnect removes the
Randevu mapping; neither action deletes the underlying provider resource.

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
extraction tools and post-call analysis fields. Randevu remains the editable
schema; the provider configuration is generated output.

The precedence rule is fixed:

1. a value explicitly confirmed during the live call wins;
2. post-call transcript extraction only fills a missing customer value; and
3. before-call context is recorded with the call but never writes back by
   itself.

Customer writes are permissioned by `contactFields.source === "voice"`.
Reserved identity and compliance fields, including phone, email and consent,
cannot be made writable through Variables. Every variable is also retained on
the call row so the transcript and recording have an auditable per-call value.

## Runtime and call-result flow

The runtime connection is private and agent-specific:

- `/retell/inbound` injects current before-call context for an incoming caller.
- `/retell/mcp` exposes only `get_call_context` and `save_customer_details`.
  The clear runtime token is written once to the provider; Randevu stores only
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

The provider sends `call_ended` before its analysis is ready. Randevu records
the call immediately, then waits for `call_analyzed`. If that later event is
missed, a bounded recovery fetches the provider's per-call analysis. Exhausted
updates produce a provider-free warning for the salon and retain raw details
plus a replay action in platform admin.

## Tenant isolation and authentication

- Every voice table carries `orgId`; all customer-facing reads and writes are
  scoped through the caller's org.
- An inbound provider payload names an agent, never an org. Randevu resolves
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
   first and leave it unassigned. Randevu will offer it in the Create new
   picker. Number purchasing stays outside the app.
4. Have the org owner open **Phone agent → Add agent** and create the native
   receptionist. Connecting an existing agent is the fallback path.
5. In platform admin, confirm the provisioning job completed, the Randevu
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
appointments through Randevu. Availability is truthful only when the operator
has installed that org's cal.com API key and event type in platform admin.

Without those values, a call can still create a Randevu-only appointment, but
no availability or conflict check runs. Double-booking is therefore possible.
The agent template is instructed to ask for the caller's preferred exact time
without claiming that the slot was checked.

## Current limits

- Randevu does not purchase phone numbers.
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
