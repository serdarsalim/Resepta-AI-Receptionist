# Chat agent — spec and architecture

Written 10 August 2026 from the ideation session with Serdar. This is the ONE
consolidated spec for the AI chat lane: the customer-facing WhatsApp agent, its
knowledge base, the control plane that keeps it honest, per-org metering, Retell
auto-provisioning, and suspension. Read it with [`product-spec.md`](product-spec.md)
(current product) and [`phone-agent.md`](phone-agent.md) (the voice lane whose
discipline this lane copies).

Items deliberately NOT in v1 are listed at the end with their blockers. They are
decisions, not omissions.

---

## 1. What the finished v1 does

**Customers: the chat answers like a good receptionist.**

- A customer writes on the salon's WhatsApp and gets an answer in seconds, any
  hour: prices, hours, services, and real booking — the agent offers actual free
  slots, books, reschedules, cancels.
- The agent's first-ever reply to a customer includes one plain line that this
  is the business's digital assistant. After that it just talks, in the
  customer's language (`customers.language ?? orgs.language`).
- The customer can only ever see and change THEIR OWN appointments. This is
  enforced by the tool layer, not by the prompt (§4).
- Booked by phone, changed by chat: the agent's context includes the customer's
  calls and appointments, so a reply to a voice booking's confirmation is
  handled with full knowledge of that booking.
- The moment staff send a manual reply in a conversation, the agent goes silent
  there until it is handed back. Per-org mode and a platform kill switch sit
  above that (§5).
- When unsure or out of scope, the agent says it will pass the question to the
  team and stops. The inbox attention dot — already lit by any unanswered
  inbound — is the escalation surface.

**Owner: the business writes down what it knows.**

- A **Knowledge** section in Business: plain text blocks (policies, parking,
  FAQ answers). Services, prices, hours, and staff are NOT retyped there — the
  agent reads those from the structured tables, so prose can never contradict
  the calendar.

**Operator: nothing changes agent behaviour except a recorded, reversible
action.** Mode per org (off → shadow → live), full flight recorder per turn,
metering per org, kill switches at three levels (§5).

## 2. Where it hooks into the message model

Inbound WhatsApp already lands in ONE place: `processInboundMessage`
(convex/webhook.ts), for both lanes. The agent is a new branch at the point
where today the message either matched a confirm/cancel intent or fell through
to the away-reply:

1. Button payloads and bare EVET/İPTAL keep their existing deterministic
   handling. The agent NEVER handles a confirm/cancel tap — those paths are
   cheaper, safer and already correct.
2. If nothing deterministic matched and the org's agent is **live**, the agent
   action is scheduled (`ctx.scheduler.runAfter(0, …)`, same pattern as the
   away-reply). The away-reply is suppressed for live orgs — the agent answers
   at any hour, which supersedes "we're closed, book here".
3. If the org's agent is in **shadow**, existing behaviour is fully unchanged
   (away-reply included) AND the agent runs without sending: the generated
   reply lands as a turn row for the operator to read.
4. If **off** (unset): today's behaviour exactly.

The reply itself is a free-form session text — the customer just wrote, so
Meta's window is open by construction; consent is not required for a reply, on
the same doctrine as the away-reply (`wa.ts sendAwayReply`). It goes out the
lane the customer wrote in on (`laneForReply`), is logged through
`messages.logOutQueued` with `kind: "chat_agent"`, and lands its outcome in
`messages.applySendResult` like every other send in the product.

**Demo orgs are excluded in v1.** The public demo is anonymous and free to
drive, which makes a live LLM on it an abuse vector, not a showroom. Revisit
with per-visitor rate limits if the demo needs it.

## 3. The LLM seam

- `convex/lib/llm.ts` — provider-neutral `chatComplete()` over the Anthropic
  Messages API (fetch from actions only). Model, prices and the template
  version are recorded on every turn.
- **Key resolution (two patterns, each matching an existing doctrine):**
  - The platform key lives in `platformConfig` (`anthropicApiKey`, env fallback
    `ANTHROPIC_API_KEY`) — the Resend pattern: one deployment-wide key shared
    BY INTENT, because the platform owns the LLM relationship and tokens are
    metered per org (§6).
  - A per-org override lives in `connections` (`llm.apiKey`), set by the
    operator only. When a row exists it wins. This is the escape hatch for a
    future agency/enterprise client on their own billing; no UI ever shows it
    to a salon.
  - This is NOT the forbidden connections fallback: that rule protects
    per-tenant credentials from leaking across tenants. The platform LLM key is
    not a tenant's credential.
- Default model: `claude-sonnet-5`. The price table in `lib/llm.ts` is
  versioned; every turn snapshots the rate it was billed at, so a later price
  change never rewrites history.

## 4. Isolation — the invariant that makes the agent safe

**The customer's identity comes from the channel, never from the conversation.**
The webhook resolved the org from `phone_number_id` and the customer from their
phone. Every tool the model can call is a server-side function already bound to
that `(orgId, customerId)`:

- `check_availability(date)` — same data the voice lane serves: cal.com slots
  when connected, otherwise full-slot arithmetic from our own table
  (`retell.bookedBetween`) plus open hours.
- `book_appointment(start, service?, name?)` — books for THIS customer's phone.
- `my_appointments()` — this customer's upcoming appointments only.
- `cancel_appointment` / `reschedule_appointment(start)` — refuse any
  appointment row not owned by this customer; cal.com is told first when an
  `externalUid` exists, exactly like the voice tools in `convex/http.ts`.
- `save_my_details(...)` — writes only voice-sourced contact fields and the
  customer-name/email columns, through the same gate as the voice lane.
- `escalate_to_staff(reason)` — stamps the conversation for takeover and stops
  the agent; the attention dot does the rest.

There is no customer search, no read of any other customer, no org
configuration surface. A fully manipulated model can at worst mismanage the
manipulator's own appointments — visible in the thread, reversible by the
salon. Prompt injection is contained by what the tools refuse, never by prompt
language.

**The model never sees another customer's data** for the same reason: context
assembly reads only this customer's rows.

## 5. Control plane (the "no YOLO" section)

- **Versioned template.** `convex/lib/chatAgentTemplate.ts`, key + version,
  the voice template's twin. Changing agent behaviour is a version bump; a
  turn records the version that produced it.
- **Lifecycle per org: off → shadow → live** (`orgs.chatAgentMode`, unset =
  off). Shadow generates and records but never sends — pre-launch QA, the
  owner trust ramp, and canarying in one state. Operator-set from /admin.
- **Flight recorder.** Every turn writes a `chatAgentTurns` row: trigger
  message, tool calls with arguments and results, the reply, tokens, cost,
  latency, model + template version, shadow/sent/skipped/error status. This is
  the replay surface for "why did it say that", and the raw event under
  metering (§6).
- **Guardrails as data.** Per-customer reply rate limit (default 10/hour,
  checked against turns) and a per-org monthly token budget (soft default in
  code, override on the org). Exceeding either pauses the agent politely and
  flags the conversation.
- **Kill chain.** Per conversation (staff reply = automatic takeover, stamped
  `customers.agentPausedAt`; cleared from the conversation header), per org
  (mode → off), platform-wide (`platformConfig.chatAgentDisabled = "true"`,
  checked on every turn). Every operator flip lands in the org's activity log.
- **Retention.** Turn rows carry customer text, so they join the org's data
  story: platform admin can prune, and org deletion takes them along.

## 6. Metering

- `chatAgentTurns` is the raw ledger for LLM usage (tokens + cost snapshot per
  turn). `usageMonthly` is the rollup: one row per (org, month), counters
  incremented in the same mutation that writes the turn — per-org-per-month
  documents, so there is no cross-org write contention.
- Costs are stored in **micro-USD** integers. Meta/WhatsApp fees can join the
  same monthly row later with their own counters; the shape is the per-org cost
  ledger, not an LLM-only artifact.
- Sold as conversations, metered as tokens: owner-facing packaging never
  mentions tokens. The admin panel shows both.

## 7. Retell auto-provisioning

When onboarding completes (the first `orgs.update` that gives an unnamed org a
name), the org schedules an auto-provision:

1. Skip if the org already has a `retellAgents` row or any provisioning job.
2. If the org has no `retell.apiKey` connection row, **stamp the platform
   default into one** (`platformConfig.retellApiKey`, env fallback
   `RETELL_API_KEY` — the shared workspace whose signing key already verifies
   webhooks). The stamp, not a fallback: `connectionField` resolution stays
   exactly as the doctrine demands, the operator can re-key any single client
   later, and `voiceAgentSource`'s "randevu" default already scopes a shared
   workspace to the org's own agents.
3. Run the existing checkpointed provisioning job
   (`voiceAgentProvisioning`) from the versioned template with the org's name
   and language; pick the first catalogue voice for the language. Failures
   land in the admin panel's provisioning list like any other job.
4. Lines remain manual: the app assigns an unclaimed number but never buys one
   ("auto-agent, assisted dial tone").

## 8. Suspension

`orgs.status`: unset/`"active"` | `"suspended"`. Suspension stops SPEND and
OUTBOUND; inbound keeps recording so un-suspending restores a complete world.

Guards sit at the chokepoints the product already funnels through: the
appointment send action, session/composer sends, the away-reply, campaign
dispatch, and the chat agent turn. A suspended org's queued sends fail
permanent with `org-suspended` — visible, not silent. Operator toggle lives on
the org page header with a confirm; every flip is an activity row.

## 9. Admin panel additions

Org page (`/admin/[orgId]`):

- **Assistant tab** — chat agent mode (off / shadow / live), the last turns
  with status, tokens, cost and expandable tool calls, the month's usage, and
  the per-org token budget override.
- **Header** — suspend/unsuspend with confirm.
- **Setup tab** — the `llm.apiKey` override row appears with the other
  connection secrets automatically (it is a `CONNECTION_SPECS` entry).

Platform level: `chatAgentDisabled` kill switch (Setup on the fleet page).
Operator actions write `settings_changed` activity rows as `viaOperator`.

## 10. Not in v1 — deferred with blockers, not forgotten

| Item | Why deferred | Unblocks when |
|---|---|---|
| **Owner alerts + copilot on a Resepta WhatsApp number** | Needs a platform-owned WABA + number + approved alert templates. Also §"cost": free-form owner chat in DACH ≈ €20–30/mo in Meta fees at current rates. | Meta business verification + platform WABA (Serdar task); start with one-way digest + urgent pings; conversational copilot ships in-app first. |
| **Instagram DM channel** | Meta app review / access level for Instagram messaging unverified; possible Business Partner requirement. | The access question answered on the real app. The agent itself is channel-ready (same loop, new inbound adapter). |
| **Email agent (draft mode)** | Wants the inbox-draft surface ("copilot") which is not built; email tolerates latency so drafts-first is the right ramp. | Inbox draft UI. |
| **WhatsApp Flow date-picker finish** | Flows need per-org Meta Flow assets + a public endpoint for dynamic slots; conversational booking works without it. | First real orgs live on the agent; measure completion, then decide. |
| **Billing / Stripe / self-serve payments** | Everything is hand-invoiced today by decision; no Stripe account wired. The metering in §6 is deliberately the substrate a paid tier reads. | Pricing decision + Stripe account. Sell in conversations/month, meter in tokens. |
| **Demo-org agent** | Public anonymous demo + live LLM = abuse vector. | Per-visitor rate limits and a spend cap for the showroom org. |
| **Owner-configurable persona/prompt** | The template is versioned platform code (§5); letting owners edit prose reopens the fonio prompt-box failure the product exists to avoid. | Probably never; vertical presets instead. |

## 11. Operator runbook (v1)

- Set `ANTHROPIC_API_KEY` on the deployment (or the `anthropicApiKey` platform
  row). Without it, turns fail with `llm-not-configured` and the agent stays
  effectively off.
- Per org: flip to **shadow**, read a week of turns in the Assistant tab, then
  go **live**. Going live without shadow is possible and inadvisable.
- The disclosure line is not removable per org. WhatsApp's 2026 AI policy and
  EU AI Act Article 50 (in force 2 Aug 2026) both require it; it is one
  sentence and then out of the way.
- Kill order when something misbehaves: conversation (staff just reply), org
  (mode off), platform (`chatAgentDisabled`). All are immediate.
