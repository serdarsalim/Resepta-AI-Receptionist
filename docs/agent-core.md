# One assistant, two lanes: what is actually shared and what is not

Exploration only. Nothing here is built. Serdar's question was "shouldn't we use
the same assistant for chat that we use for voice", and this is the first leg of
finding out. Written 2026-08-26 so a fresh session can pick it up cold.

## The short answer

The idea is right, and the thing it fixes is real. But "one assistant" is three
separate changes wearing one coat, and they have very different costs:

1. **One set of business facts and rules.** Worth doing. This is where the pain
   is, and the pain is measurable (see the lockstep bumps below).
2. **One identity to the customer.** Worth doing, cheap, and worth more than
   the deduplication. Not a code-sharing problem at all.
3. **One runtime.** Not available. Retell owns the voice turn.

## There are THREE agent surfaces, not two

Worth knowing before touching anything, because the names mislead:

| Surface | Prompt lives | LLM | Tools execute |
|---|---|---|---|
| Voice | Published to Retell, authored here | Retell's (claude-4.5-haiku, pinned for latency) | HTTP webhook → `/retell/functions` in `http.ts` |
| Chat (WhatsApp) | Composed per request in `lib/chatAgentTemplate.ts` | Ours via `lib/llm.ts` | In-process in `chatAgent.ts` |
| MCP | The client's (Claude Desktop etc.) | The client's | `convex/mcp.ts` → `convex/agentTools.ts` |

`agentTools.ts` is the MCP surface. It is NOT shared with voice or chat, despite
the name — the first wrong turn anyone will take in this codebase.

## What is already shared, written twice

Both lanes get the same facts from the same tables and expose the same verbs.
The duplication is not theoretical; it has cost real work three times:

- **Chat template v2 == voice template v4**, same day (2026-08-12). Both made
  `book_appointment` take `services` plural. Both were fixing the same live bug:
  a haircut plus a beard trim booked as two appointments put one man in two
  chairs at the same minute.
- **Chat template v3 == voice template v9.** Both the goods change: services
  without a duration take no slot, repeat-per-piece for quantity, lead time
  answered with the earliest workable day.
- **`chatAgent.ts` book_appointment re-implements the voice webhook's guards**
  line for line: the past check, the 400-day check, the open-hours check. Its
  own comments say so ("Same rule as the voice webhook", "the same tolerance the
  voice handler has"). The voice copy already carries a note that it WAS written
  twice once before and had to be consolidated.

The write itself is already shared, and the naming gives the game away: the chat
lane calls `internal.retell.voiceBook` and `internal.retell.classifyServices`.
A function named for the other lane. That seam was never designed; it leaked.

## What is genuinely different

**Delivery, not authorship.** Correcting a first reading of this: Resepta
authors every prompt. `lib/voiceAgentTemplate.codePrompt` holds the default,
`voicePrompts` + `lib/voicePromptStore` hold operator overrides, and
`retellAgent.publishPrompt` pushes text to a LIVE agent. Retell stores it. It
does not author it.

What is true is narrower and it is the actual obstacle:

- The automatic template sync **deliberately never sends prompt text**. That
  guard exists so a template version bump cannot overwrite wording a salon
  edited. See the header of `lib/voiceAgentTemplate.ts`.
- So a shared rule change would reach chat on the next message and reach an
  EXISTING voice agent never, unless something publishes it.

**Medium.** Voice: read prices aloud, no currency symbols, never recite the
whole menu, interruption sensitivity 0.4, a begin message, a hang-up policy.
Chat: no markdown, one question at a time, and a mandatory disclosure line that
WhatsApp's 2026 AI policy and EU AI Act Article 50 both require.

**Editability.** Salons edit voice prompts. `lib/chatAgentTemplate.ts` says
flatly that Resepta owns the chat text and no salon edits it.

## The seam that already exists and should be used

The voice lane solved the freshness problem years before this question came up,
and the answer is sitting there: **dynamic variables**. `retell.beforeCallContext`
injects `{{services}}`, `{{knowledge}}`, `{{staff}}`, `{{contact}}`, `{{now}}`,
`{{information}}` at RING TIME from live data. Edit a service and the very next
call has it, with no republish and without touching the salon's wording.

The chat lane does the same thing by composing them into the system prompt on
every request.

So the facts are already effectively shared. What is duplicated is the
**rendering** of those facts (spoken vs written) and the **rules**.

The proposal, then:

- **One context module** producing services, knowledge, staff, hours, the
  customer card and history, with two renderers: spoken (`spokenDuration`,
  `spokenPrice`, semicolon-joined) and written (bulleted, prices as symbols).
  Both renderers exist today, in different files.
- **Rules move into an injected variable.** The behavioural rules that keep
  bumping in lockstep — several services is one booking, goods take no slot,
  never invent a slot or price, confirm before booking — become `{{rules}}`,
  injected at ring time exactly like `{{services}}`. Then a rule fix reaches
  every existing voice agent AND chat at once, with no publish and no risk to a
  salon's edited prose. This is the change that kills the lockstep bumps.
- **Style and runtime stay per lane.** They are the parts that genuinely differ.

Open question for whoever builds it: how much of the current prompt text is
rules (movable) versus voice-specific style (not). Rough read of the Turkish
`codePrompt` is that a majority of the numbered rules are business rules that
chat also states in its own words, but that needs a line-by-line pass.

## The better idea underneath, which is not about code

Right now the two lanes are **two different assistants to the customer**:

- Voice has a persona name the salon sets (`orgs.personaName`, injected as
  `{{agent_name}}`). Elif answers the phone.
- Chat is explicitly told not to introduce itself and has no name. The
  disclosure line says "the digital assistant for {business}" and that is all.

A customer who rings Bella and talks to Elif, then WhatsApps an hour later and
gets an anonymous bot, is dealing with two businesses.

**Memory runs one way too.** `chatAgentSystemPrompt` takes `recentCalls` and
prints "Recent phone calls with the business". The voice built-ins have no
equivalent: no recent messages, nothing from WhatsApp. So chat knows you rang,
and Elif does not know you wrote this morning.

One name and a two-way memory is a smaller change than the shared core and a
bigger difference to a customer. It is probably the right first move.

## What has NOT been checked

- Line-by-line comparison of the Turkish/English/German `codePrompt` rules
  against `chatAgentSystemPrompt`'s rules, to size the movable set.
- Whether `{{rules}}` as one injected blob degrades voice adherence. The voice
  prompt is a numbered list and models follow those well; a blob dropped into
  the middle may not do as well. Worth an A/B on real calls, the way v3's model
  swap was done.
- Token cost on the chat side if the shared context grows.
- Whether a salon that edited its voice prompt would end up with rules stated
  twice, once in their prose and once injected.
