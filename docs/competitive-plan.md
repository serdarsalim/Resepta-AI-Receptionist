# Randevu competitive plan

Written 25 July 2026, from twelve research passes plus a read of this repo at commit `7f29b2c`.

Read this once, then work section 10. Everything before it exists to justify section 10.

Two conventions. Effort is in **developer-weeks**, where a developer-week means four focused
days of coding by one person who is also selling and supporting. FX: EUR/TRY 53.85, USD/TRY 47.3.
Those two imply USD/EUR 1.138; the euro figures below were computed at 1.10, so every euro COGS
number is about 3% too high. Left alone deliberately, because it errs against us.

---

## 1. What fonio actually is

fonio is a Vienna company selling an AI that answers a German-speaking small business's phone,
founded by Daniel Keinrath and Matthias Gruber, first paying customer late 2023, reported in press
coverage at roughly $2M ARR before raising €3M in December 2025 and $17M at a $140M valuation from
20VC in June 2026 (the ARR figure is journalism, not a filing; treat it as an order of magnitude).
It publishes 9,500+ customers, 2M+ calls automated per month, and ships two to three
changelog entries a week with about 50 people. The product is a form-and-prompt builder: you pick
a voice and language, paste your website URL so it scrapes your opening hours and services into a
knowledge base, buy a fonio number, and forward your existing business line to it. Behaviour is
configured by writing if-then sentences in English or German prose inside a prompt field, which
their own help center admits fails in documented ways. Voice costs €99, €299, or €499 per month
for 1,000, 3,000, or 5,000 minutes; a **separate** WhatsApp chatbot product costs €79, €249, or
€449 for 800, 2,500, or 4,500 conversations. There is no free trial, only a 30-day money-back
guarantee, and they also sell done-for-you setup at €1,000 to €2,500 plus a €99/month care
package, which tells you what the "60 seconds to set up" claim is really worth. They operate in
Austria, Germany, Switzerland, Poland, Italy, France, the UK, the Netherlands, Spain, and Brazil.
Across every fonio-owned page eight researchers fetched, Turkish appears zero times.

---

## 2. What fonio does well that Randevu does not

Ranked by how much it costs you to be behind.

**1. It works, at volume, in production.** fonio has processed millions of calls. This repo is
40 commits, all dated 25 July 2026, about 12,000 lines, zero test files, and `.env.local` points at
`CONVEX_DEPLOYMENT=local:local-randevu-randevu_tr` on a laptop. No Meta webhook, no cal.com
webhook, and no Retell webhook has ever arrived. Every claim
in the product spec about what is "built" means "typechecks," never "has run." Right now
`SettingsView.tsx` hands a salon owner `http://127.0.0.1:3213/calcom/webhook?token=...` to paste
into cal.com. Nothing else on this list matters until this one is closed.

**2. Onboarding that a non-technical owner completes.** Paste your website URL, hit Generate, and
the knowledge base fills itself. One agency reviewer on OMR reported about 30 minutes per business
end to end; that is a single self-reported data point, not a measured benchmark. Randevu's
equivalent is an empty settings form and a text box where you paste a Retell agent id. The website
scrape is the mechanic worth copying, with one caveat section 5 item 6 spells out: it assumes the
business has a website.

**3. Failure is visible to the customer.** fonio's Conversations view has outcome filters
including `Appointment Booked`, `Transferred`, `Abandoned`, `Spam`, a waveform player, an AI
summary, and a usage meter. Randevu's worst failure modes are silent, and two of them share one
line of code. An inbound WhatsApp from a number not already in `customers` is written with
`customerId: undefined` (`webhook.ts:75`), and an inbound call from an unrecognised number gets a
`calls` row with `customerId` undefined (`retell.ts:455`). Both rows exist; both are then dropped
by the single `if (!customerId) return;` guard inside `push` at `messages.ts:235`, so neither ever
appears in the inbox. Separately, a cal.com booking whose attendee has no E.164 phone returns
`{ ok: false, reason: "attendee-phone-missing-or-not-e164" }` from `calcom.ts` with no row written
anywhere, under a code comment that says it records why. A salon owner sitting in this app
cannot tell "working perfectly" from "dropping every message." That, not the missing Calls tab,
is what loses a pilot.

**4. A reseller channel that reaches businesses which cannot configure software.** Free instant
partner signup, 15 to 35% lifetime commission or 20 to 35% resale discount, battlecards, objection
handling, a proposal template, an NFR licence with test credits, and a Demo Builder that generates
a prospect-specific demo agent in under a minute. A real Gold partner publicly quotes €800 setup
plus €0.15/min. This is how a self-serve product gets sold to people who will never self-serve,
and it is the part of fonio worth studying hardest.

**5. Trust artifacts.** OMR "#1 Software Tool of the Year 2026" from over 10,000 companies,
Trustpilot 4.9 across 400+ reviews, Volkswagen and Deutsches Rotes Kreuz logos, "Made in Austria",
servers in Nuremberg, DSGVO and EU AI Act claims on the homepage. You have one client.

**6. Voice maturity.** 20+ voices, 25 to 35 languages depending on which of their own pages you
read, mid-call language switching, transfer targets with prompt-defined rules, voicemail detection
at 2 to 3 seconds, an interruption-disable toggle, KYC-gated outbound, contact blocking, and
UK/US accent splits. Randevu has no `reschedule` function (`http.ts` falls through to
`unknown-function`), no `transfer_to_human` despite storing `transferNumber` in the schema, no
Calls destination, and no number management.

**7. Its own scheduler, which does reschedule and cancel.** Their calendar doc says plainly that
cal.com and Calendly "can only book appointments" and that reschedule and cancel are reserved for
fonio Scheduler. Note that this is a fonio limitation, not a cal.com one, which makes it item 2 in
the next section rather than a real advantage.

**8. Public proof you can call.** +49 511 1665 3819 rings their agent. Call it before you read
further.

---

## 3. Where fonio is genuinely weak or absent

Evidence first, conclusion second.

**Voice and WhatsApp do not talk to each other, and they say so.** Their WhatsApp help article
lists under "Upcoming features": "Voice + WhatsApp: Send WhatsApp templates during or after a call,
directly from the voice assistant" and "Outbound Messages: Create workflows to proactively send
messages to your contacts." Read literally, that means fonio cannot today send a WhatsApp
confirmation off the back of a phone booking, and cannot send outbound WhatsApp reminders at all.
The two products are bought separately and billed separately.

This one help-center list is the load-bearing fact under the entire wedge, and it is an inference
from a roadmap label on a page that could be months stale. €178 buys one month of both products
and settles it in an afternoon. Do that in week one. And note the clock: they announced it, so the
gap has a publicly declared expiry date.

**cal.com is a degraded path inside fonio.** Direct quote from `fonio.info/articles/calendar`:
cal.com "Can only book appointments." Their own scheduler only launched 17 April 2026 and
reschedule/cancel controls landed 6 June 2026. That is a three-month-old capability, not a moat.

**The €99 tier allows one concurrent call.** The marketing pages advertise "15 Parallele Anrufe."
Both facts are on the same website. Concurrency reaches 3 only at €299/month. A two-chair salon on
Solo drops the second simultaneous caller.

**Analytics is a call counter.** Their own analytics doc says "Coming soon: expect more charts,
deeper breakdowns and richer analytics in the coming releases." There is no booking funnel, no
no-show rate, no service mix, no revenue attribution. A salon owner cannot answer "how many
appointments did this book me and what were they worth."

**There is no native CRM.** The complete first-class integration list is email, SMS, HTTP request,
web search, and Google Sheets. HubSpot and Salesforce are marketing words backed by "build a Make
or n8n scenario." Their own roadmap says AI-native CRM by end of Q3 2026, which means it does not
exist now.

**Speech recognition on names, numbers, emails, and addresses is their most-cited complaint.** Six
separate reviewers on Capterra and OMR raise it independently. Six more raise dialects and accents,
which in a German review corpus means German regional dialects, not foreign accents. They only
added UK and US English accent recognition on 23 July 2026, which suggests accent handling is
configured per language rather than robust by default.

**Setup requires prompt-engineering skill, and their customers say so.** Six reviewers name it.
One asks for drag-and-drop instead of a prompt field. Two report backend fields are poorly
explained with no context-sensitive help. Meanwhile fonio sells a €1,000 setup SKU for "simple use
cases like a secretariat, appointment scheduling or simple FAQs." If it took minutes, that SKU
would not exist.

**Billing is aggressive and there is no trial.** When included minutes run out, 100-minute packages
at €15 are added automatically. Test calls have been billed. Reviewers name a former €300 minimum
top-up. At least six reviewers complain about the absence of a trial. One OMR reviewer states
flatly that the billing logic "reagiert an einigen Stellen zu aggressiv."

**GDPR and AI Act paperwork is not readily available.** A management-consulting reviewer, 30 June
2025: the documents needed for DSGVO conformity and EU AI Act documentation "sind nicht einfach
verfügbar." This is notable because compliance is their loudest marketing claim, and EU AI Act
Article 50 transparency obligations apply from **2 August 2026**, eight days from now.

**Turkey and Turkish.** No Turkish in the language switcher, no Turkish site locale, no +90 numbers
in the changelog, no Turkish customer, no roadmap mention. Every one of eighteen named customer
stories is Germany or Austria. State this correctly: this is absence of evidence across eight
independent research passes, not a confirmed exclusion, because the definitive country list sits
behind their app login. But at $140M post-money, Turkish SMB ACVs cannot move their revenue
multiple, so they have little reason to go there soon.

**Not verified, do not repeat as fact:** whether fonio has any payments, deposits, or no-show fee
feature (found nothing, which is not the same as confirmed absent); their AGB contract terms
(both `/agbs` and `/de/agbs` returned navigation shells to three separate researchers, so the
12-month term with 3-month notice comes from a 2025 partner order form and may not apply to
self-serve); whether the English-homepage testimonials with American names are real customers.

---

## 4. The wedge

### First, the case against the obvious answer

The obvious wedge is "Turkey is WhatsApp-first, fonio is phone-first and DACH-only, so own WhatsApp
booking in Turkey." I think that is wrong as a business, and the numbers say so.

Turkish SMB software pricing is anchored at ₺419 to ₺1,590 per month with credible free tiers.
Salon Randevu Silver is ₺779, Hızlıappy Profesyonel is ₺799 with a free 100-appointment tier,
Kuaför Asistan is ₺419. That is €8 to €30. The category is crowded: Wabo does WhatsApp-only AI
booking at ₺799, Planris at ₺820, SalonAppy claims 16,000+ professionals across all 81 provinces,
Salonora just launched with TÜBİTAK backing, and Fresha is already live and bookable in Istanbul
with commercial terms nobody in this research could retrieve.

Then Meta shipped the generic version for free. Meta Business Agent went globally available on
3 June 2026 across WhatsApp, Messenger, and Instagram, after piloting with over a million
businesses. Meta's own copy: it "books appointments and qualifies incoming leads." Setup is inside
the WhatsApp Business app, no BSP, no developer. Getting started is free.

And voice, the thing that would let you charge more, is arithmetically unsellable in Turkey.
Twilio inbound to a Turkish landline is $0.0701/min against $0.0100 in Germany. Add Retell's
realistic stack ($0.055 infrastructure + $0.045 GPT-4.1 + $0.015 platform TTS = $0.115) and a
Turkish voice minute costs you **$0.185, which is ₺8.75**. A salon taking 150 calls a month at
2.5 minutes burns ₺3,281 in COGS against a market that pays ₺799 for all its software. Transfer
to the owner's mobile is $0.2875/min, ₺13.60, so a five-minute handoff costs more than a day of AI.

Now the scale problem, which is the number that should decide this. Say you need €4,000/month of
recurring revenue to meaningfully extend runway. At ₺899/month (net of 20% KDV, ₺749, which is
€13.90) you need **258 Turkish salons**. At €79/month in DACH you need **51**. You are one person
doing assisted onboarding over screen share. 258 is not a number a solo operator reaches; 51 is.

So Turkey-only, WhatsApp-only, is a market where you are the fifth cheap entrant, competing with
free, at a price that requires five times more customers than you can onboard, with your COGS in
USD against a lira that loses 20 to 30% a year.

### The wedge I would actually take

**Randevu should be the only product that closes the whole appointment loop, in Turkish and German,
sold to Turkish-owned service businesses in Austria and Germany.**

"The whole loop" is specific: a call or a message comes in, the AI resolves it against **real
availability** in cal.com, books it, sends a WhatsApp confirmation with confirm and cancel buttons,
the tap writes back to the calendar, the reminder fires at T-24h and T-2h inside quiet hours, and
the owner sees all of it as one thread per person with calls folded in. Not a phone product and a
chat product. One conversation, one calendar, one bill.

Three claims support it, and each is falsifiable.

**Claim one: nobody closes this loop today, and the two biggest players have publicly said they
cannot.** fonio's own docs list voice-to-WhatsApp and outbound WhatsApp as upcoming, and lock
reschedule/cancel away from cal.com. WhatsApp's own blog describes future work on "connecting with
the tools to manage your calendar," meaning Meta Business Agent can capture a booking intent but
cannot resolve it against staff availability. term-in.app at €29 is chat-only with no voice.
Wabo and Planris are WhatsApp-only. Salon Randevu gates WhatsApp behind its ₺2,400 tier and the
online booking site behind ₺3,480. The cal.com brain you already have plus the confirm/cancel
button loop you already wrote is the exact thing missing everywhere else.

**Claim two: a solo operator can hold it and a funded competitor structurally will not.** The loop
is not an ML problem or a feature. It is unglamorous backend discipline: acknowledge the calendar
write before the agent says the words, idempotency keys per call, never let a barge-in confirm
anything, delivery status per message, template language pinned to the org, timezone-correct day
boundaries. A company shipping two to three releases a week across six new offices does not invest
in the seam between two products it sells separately, because merging them destroys ARPU. fonio
charges €99 + €79 = €178 for both channels. A single bill at €79 is a 55% price cut on their own
revenue, which is a decision a 20VC-backed board does not make. That is the durable part: their
business model defends your wedge for you.

**Claim three: the geography makes the price work and makes your identity load-bearing.** Turkish-
owned barbers, salons, and garages in Vienna, Berlin, Cologne, and Duisburg pay DACH prices and
have a language problem nobody serves. fonio's ASR complaints are dominated by dialects and
accents, and they only shipped UK/US accent handling two days ago; Turkish-accented German is
precisely the failure mode their reviewers describe and their roadmap ignores. term-in ships
Turkish as a checkbox in a language list, not as a go-to-market. You are Turkish, you live in
Austria, you speak German. In this segment that is the moat rather than a footnote, and the
segment is far too small to justify a funded company's attention at a $140M valuation.

Turkey is not discarded. **Turkey is where you prove the loop cheaply; DACH-Turkish is where you
sell it at 5x the price.** Your one existing client is Turkish, Turkish WhatsApp utility messages
cost $0.0009 each so testing is free, and Turkish ASR is the harder of your two languages, so if
it works there it works in Vienna. Sell Turkey at ₺899 as a WhatsApp-and-calendar product with
voice metered separately, expect it to be roughly break-even at low volume, and treat it as the
lab plus a source of testimonials in the right language.

### The single biggest hole in this argument

**Nobody measured the DACH Turkish-owned SMB population.** No researcher produced a count of
Turkish-owned salons, barbers, or garages in Austria and Germany, their density, or their
willingness to pay. I am not going to invent one. This is the first thing to test, it costs zero
code, and section 9 says how.

---

## 5. The build plan

The spec in `docs/product-spec.md` names "full fonio.ai parity" as the target. **Delete that
sentence.** Parity with a 50-person funded company is not a plan for one person, and the parity
ladder is what has you building a Calls tab instead of a working webhook.

### Track zero: things that are calendar time, not developer time. Start today.

These block everything and none of them are code.

- **Apply for Meta Tech Provider status.** Roughly 2 days of your time, €0 in fees: business
  verification, an app icon, a privacy policy, and two screen recordings (one sending a message,
  one creating a template). Meta explicitly allows a recording of the API Setup cURL script. This
  unlocks Embedded Signup and, critically, **coexistence**, which lets a salon keep its existing
  WhatsApp Business app and number while you add automation. Without it your onboarding pitch is
  "give up the number that's on your shop window." Solution Partner status is out of reach for you
  and you do not need it.
- **Start WABA and template approval for pilot org one.** Template review takes up to 24 hours;
  business verification takes an undocumented 2 to 14 days. This is the long pole.
- **Verify Embedded Signup v2 sunsets 15 October 2026** and build on v4. Two researchers flagged
  this date; one could not open the changelog to confirm it first-hand.
- **Check Meta's "pricing policy for AI Providers"** dated 16 February 2026, updated 12 May 2026.
  One researcher found the link and could not retrieve the substance. You have an AI voice lane.
  This is the one unknown that could reprice you without warning.

### Track one: what wins the first paying customer

Total: about **6 developer-weeks**. Nothing here is a new product surface. All of it is the
difference between a demo and something a salon can run unattended for a month.

| # | Item | Weeks | What it unlocks commercially |
|---|---|---|---|
| 1 | **Deploy.** Convex prod, Vercel, domain, real env vars including the missing `RETELL_API_KEY`, `predeploy` typecheck. | 0.5 | Everything. Today no external system can reach this code. |
| 2 | **Kill the three silent failures.** Auto-create a customer row on first unknown inbound and first unknown caller with `consentAt` left unset. Write a visible row on every non-ok return in `calcom.ts` and surface "last event received / last rejection" in Settings → Bookings next to the E.164 phone-question instruction nobody documented. | 0.75 | The owner can distinguish working from broken. Highest-value fix in the repo. |
| 3 | **Failure visibility.** `messages.failedCount` is computed and referenced by nothing. Wire it into the sidebar next to `attentionCount`, set `N8N_EMAIL_WEBHOOK_URL` and the pilot org's `emailFrom`, send yourself a real alert. Add the missing `ERROR_KEY` entries so a failed bubble states a reason instead of "not sent." | 0.25 | You find out about a dead pilot in an hour instead of a month. |
| 4 | **Correctness fixes.** Pin template language to the org's language and stop copying `attendee.language` onto the customer. Fix both `take()` budgets in `reminders.ts` (winback takes the oldest 200 rows *before* filtering by status, so it stops working at roughly 200 appointments in 45 days). Remove `if (!waAccount) return;` in `appointments.ts:130` so the email lane fires on confirmations. Fix the UTC day boundary in `check_availability`, which is three hours off for Europe/Istanbul. | 0.5 | The product does what the spec says on month two, not just week one. |
| 5 | **One end-to-end handover checklist, executed by hand.** Create customer, book, confirmation lands on a real phone, tap confirm, status flips, reminder fires at both offsets, reply "İPTAL" cancels. With zero tests this is your only regression net. | 0.25 | You can promise a month unattended and mean it. |
| 6 | **Website-scrape onboarding.** One URL field, one extraction pass, prefills services, hours, and the knowledge text. Copy fonio's mechanic exactly. | 1.5 | Turns a 3-hour setup into a 30-minute one. This is the number an agency reviewer measured on fonio and it is the benchmark to hit. |
| 7 | **Embedded Signup v4 with coexistence.** Gated on Tech Provider approval. | 2 | "Keep your number, keep the app on the counter, we add the automation." Without it, onboarding asks for something a salon will not give up. |
| 8 | **Turkish call-quality test.** One Retell agent, one afternoon, call it from a barbershop with clippers running, read ten Turkish names and ten phone numbers aloud, count the errors. | 0.25 | A gate, not a feature. If Turkish ASR fails on a real salon line, the voice half of the wedge is dead and you should know that in week two, not month six. |

### Track two: what wins the tenth customer

Do none of this until track one is done and one person is paying. Total about **6 developer-weeks**.

| # | Item | Weeks | What it unlocks commercially |
|---|---|---|---|
| 9 | **Voice lane hardened.** Sign the Retell webhook (today `RETELL_API_KEY` is not in `.env.example`, so `/retell/functions` and `/retell/call-ended` accept unsigned requests, and those endpoints book and cancel appointments; on a public URL that is an unauthenticated write path gated only by knowing an agent id). Add `reschedule` and `transfer_to_human`. Move to one shared Retell agent resolved by `to_number` via the inbound-call webhook instead of one hand-created agent per org. | 1.5 | Removes a security hole and removes the manual console step that blocks self-serve. |
| 10 | **The loop dashboard.** Bookings made, confirmations delivered, taps received, no-shows, no-shows recovered by winback, per week. Not a call counter. | 1 | This is the renewal conversation and the thing fonio self-describes as "coming soon." A salon owner who can see recovered bookings does not churn. |
| 11 | **Vertical setup templates.** Kuaför, berber, oto servis, Friseur, Zahnarzt. The owner fills five fields, never a prompt box. | 1 | The single loudest complaint in fonio's own review corpus, and it is packaging, not engineering. |
| 12 | **Compliance artifacts, generated at signup.** Spoken AI disclosure toggle (EU AI Act Article 50 applies 2 August 2026), consent-gated recording with a retention setting, a downloadable AVV/DPA, and a filled KVKK standard contract PDF with filing instructions (Turkey has no adequacy decision for any country and signed standard contracts must be notified to the Board within 5 business days). | 1 | fonio's own customers complain they cannot get these. In DACH it is a trust asset; in Turkey it is the only cheap answer to a real legal exposure. |
| 13 | **Honest billing.** Hard monthly spend cap, a "your assistant is paused, top up" message, no auto-charged minute packs, free test calls. | 0.5 | Six-plus fonio reviewers are publicly asking for exactly this. It costs you a weekend and it is a slide in every pitch. |
| 14 | **Payments.** iyzico or PayTR for TRY, Stripe for EUR. Check first that you can charge a Turkish card on a recurring basis; if not, self-serve in Turkey is dead on arrival regardless of everything else. | 1.5 | Stops hand-billing. Defer until customer four or five. |

### What to cut, plainly

- **The Evolution API lane.** Section 7 has the evidence. Cut it, and remove the "keep the branch
  point" instruction from the spec.
- **A separate Calls tab.** Calls already fold into the conversation, which is the better design
  and is literally the wedge. Building a separate destination argues against your own positioning.
- **The public booking page and the slug.** cal.com hosts one. Surface the link.
- **In-app next-free-slots preview.** Nice, worth nothing to a buyer.
- **Multi-language voice beyond Turkish and German.** Every extra language is an ASR risk you
  cannot test.
- **Turkish dentists.** Best budget in the market (₺4,799 to ₺6,399/month at DoktorTakvimi) and the
  worst fit: mandatory e-Nabız data submission with a fine of 1% of the previous month's gross
  service revenue, special-category health data, VERBİS registration at the 10-employee threshold,
  and entrenched incumbents. You clear none of those gates. Salons, barbers, and garages have no
  equivalent barrier.
- **Turkish garages as a system-of-record sale.** Their software (OtoMixSQL, İndemSoft, Myndos) is
  ERP-shaped: work orders, parts inventory, cari hesap, e-Fatura. A booking-first product is an
  add-on there, not a replacement. Sell them the communication layer or skip them.
- **The word "parity" in `product-spec.md`.**

---

## 6. Voice providers

**Recommendation: do not add a second provider. Build the seam that makes adding one cheap, then
stop.**

The seam is about **1.5 developer-weeks** and pays for itself even if you never add a provider:

1. **Ingest recordings into Convex file storage on receipt** rather than storing a URL. Retell's
   URLs can be signed and expiring, Vapi purges call history after 14 days on its Build plan, and
   ElevenLabs never gives you a URL at all (post-call audio arrives base64 in a separate webhook).
   Half a day, and it is also your GDPR and KVKK deletion story.
2. **Rename and extract.** `retellAgents` becomes `voiceAgents` with a `provider` field,
   `retellAgentId` becomes `externalAgentId`, `retellCallId` becomes `providerCallId`, indexes
   become `by_provider_agent` and `by_provider_call`. Move the `if (name === ...)` chain out of
   `http.ts` into `convex/voice/tools.ts` as `handleTool(ctx, org, name, args, callerPhone)`. One
   Convex route with `pathPrefix: "/voice/"`, keeping `/retell/*` as an alias so you do not have
   to reconfigure a live agent on ship day. About one day, mostly cut and paste.
3. **A `CallRecord` normalizer** with fields for provider, callRef, direction, from/to, duration,
   disconnect reason, outcome, summary, transcript, collected variables, transfer target, and
   recording as either a URL or inline base64. Every provider maps into it.

**What genuinely cannot be abstracted**, so do not try: prompt and flow authoring (Retell LLM vs
Conversation Flow vs Vapi assistant vs Bland Pathways have no useful common denominator); voice
identity, since voice ids are vendor-scoped and switching changes how the business sounds to its
own regulars; warm transfer and whisper; interruption and endpointing tuning, which use different
units everywhere; mid-call language switching (and note Deepgram excludes Turkish from its
multilingual code-switching set, so a Vienna salon switching TR to DE mid-sentence is a
provider-and-STT-specific capability, not a setting); signature verification; and data residency,
which is a legal fact that leaks into your sales conversation and no interface hides.

**The per-org setting: yes, but it is an ops lever, not a product feature.** A salon owner must
never see a dropdown reading "Retell or xAI." Store `provider` per org so you can move one customer
at a time when a real reason appears. The honest triggers are: a German prospect refuses US data
processing (Retell states plainly "we do not currently operate services within the European Union"
and runs on AWS US; Vapi has an EU region at `api.eu.vapi.ai`), or a blind Turkish listening test
with your client's staff says another provider is materially better. Note that the second trigger
is usually satisfied by switching Retell's TTS provider to ElevenLabs for $0.025/min more, which
is a config change and not an integration.

**One thing that matters more than multi-provider support**, and it is inside item 9 above: today
`retellAgents` is one hand-created agent per org, which means every signup requires you to open the
Retell console. Retell's inbound-call webhook lets you run one agent for everyone and inject
per-org `dynamic_variables` at call time, resolved by `to_number`. That is the same pattern your
WhatsApp lane already uses (one Meta app fronting every org, routed by `metadata.phone_number_id`).
One caution when you make that change: `coerceContactValues` merges `retell_llm_dynamic_variables`
into the values written to the customer. It is harmless today because only keys present in
`contactFields` are written, but once you start injecting per-org variables, an org whose contact
field key collides with an injected variable name gets your injected value written onto their
customer record.

### xAI, honestly

**xAI can do telephony today**, so the "what if it cannot" branch does not apply: it terminates SIP
directly at `sip.voice.x.ai`, sends a signed `realtime.call.incoming` webhook, and exposes
`/refer` and `/hangup` for transfer and hangup, with BYO trunk from Twilio, Telnyx, or Plivo (it
does not sell numbers, but neither does Retell outside the US and Canada, so that is a
non-difference for Turkey).

The rest of the verdict:

- **Price looks better and partly is not.** Realtime is $0.05/min against a realistic Retell
  Turkish config near $0.115/min. But every `conversation.item.create` costs $0.004, and each
  function-call result you push back is one. A booking call that checks availability, offers slots,
  and confirms fires five to ten of those, which is $0.02 to $0.04 on a call costing $0.15 in
  audio: 15 to 25% overhead invisible on the headline rate. Still cheaper. Not half.
- **Turkish is listed as supported** in speech-to-speech, TTS, and STT. Nobody publishes a Turkish
  naturalness benchmark for any vendor, so "supports Turkish" and "sounds right to a salon
  customer in Izmir" are different claims and only a test call settles it.
- **The region question is unresolved and it is the one that matters.** The voice agent model page
  names the `us-east-1` cluster; the regions doc describing `eu-west-1` 404'd on both paths a
  researcher tried. If realtime voice is US-only, a call from Istanbul or Vienna carries roughly
  100 to 150ms of transatlantic round-trip on top of model latency, on every turn. Ask xAI directly
  before betting anything on it.
- **It is beta.** The Voice Agent Builder was announced 1 July 2026, three weeks ago. Expect
  breaking changes.

**Verdict: keep Retell, build the seam, and spend one afternoon making a Turkish call through xAI
before deciding anything else.** Do not port the Retell lane before that call. Do not design
around xAI as a plan.

**Do not pick any provider on published latency.** Every latency figure any researcher found came
from vendor blogs or SEO listicles, including the widely-cited "500 production calls, March 2026"
study nobody could reach in primary form. On a Turkish GSM leg, carrier latency will dominate any
platform difference anyway. Measure on your client's actual phone.

---

## 7. WhatsApp lanes

### Cloud API versus Evolution

**Cloud API. Evolution is not a lane for this product.** Three findings settle it, and none of them
is a judgement call.

**Reply buttons do not work on Evolution's Baileys connector.** `sendButtons` returns HTTP 201 and
never delivers. Evolution issue #2404, open since 3 February 2026, still open. Randevu's entire
confirm/cancel loop is quick-reply buttons (`wa.ts` sends them, `webhook.ts` maps the payload back
to an appointment). The community workarounds are a stranger's unaudited Docker image and a
"DM me on Discord for the solution" comment. You are not putting a salon's session keys in a
stranger's container.

**Outbound to people who have never messaged you is exactly what WhatsApp's new Reachout Timelock
blocks, and it fails silently.** ACK error 463. Baileys issue #2707, filed 14 July 2026, open;
Evolution issues #2650 (17 July) and #2653 (22 July, three days ago, on v2.3.7) describe an
instance showing `open`, receiving fine, sends returning success, and nothing arriving. Your
connection-state alerting would report that number as perfectly healthy. Every first reminder
Randevu sends is a cold reachout, because a walk-in customer has never messaged the salon.

**The economics never justified it.** Meta's own live pricing endpoint returns **$0.0009** per
Turkish utility message. A salon doing 400 appointments a month with a confirmation and a reminder
sends 800 messages for **$0.72**. And utility templates inside an open 24-hour customer service
window are free, so every confirm or cancel tap makes the next message free. Note a researcher
disagreement here: two passes used $0.0014 for Turkey from third-party rate-card aggregators; the
pass that read Meta's own endpoint got $0.0009. Trust $0.0009, and re-check quarterly, because
Meta can only change rates on 1 January, April, July, or October with one month's notice.

What you would additionally be signing up for: a Postgres plus Redis plus Docker host you keep
alive at 2am, on a residential IP because datacenter IPs look bot-like, whose downtime stops
*every* customer's reminders; a rate-limiting layer with jittered per-number gaps that is directly
at odds with "the 10:00 reminder goes out at 10:00"; a licence condition requiring you to display
"powered by Evolution API" to admins in your closed-source SaaS; a v2.4 that mandates activation
against a licensing server with a 30-minute heartbeat; and a documented terms violation on your
customer's primary business number, which is on their shop window, their Instagram bio, and in two
thousand phones. Baileys' own maintainers state in their README that they discourage automated
messaging use.

**Where Evolution is still right, and it is narrow:** inbound-only, where a business wants replies
flowing into an inbox and reminders ride the Cloud API; a burner number you own and can afford to
lose; or a customer who already runs Evolution and asks you to plug in, where the risk decision is
theirs and predates you. None of those is Randevu's product.

### What the per-org switch should actually control

Not Cloud versus Evolution. **Who owns the WABA.**

**Default: BYO via Embedded Signup with coexistence.** The customer's own WABA, their own number,
their own credit card with Meta, their own quality rating. Five reasons, in order of how hard they
bite:

1. A business portfolio starts capped at **2 registered phone numbers**, rising to 20 after
   verification. If you hold the numbers, your 21st customer needs an arrangement with Meta you
   have no leverage to get.
2. The **250 unique recipients per 24 hours** messaging limit is shared across every number in a
   portfolio. Twenty salons at 30 reminders a day is 600, so you would blow past 250 before your
   fifth customer.
3. Quality rating is portfolio-level, so one customer who imports a scraped list drags down
   deliverability for everyone else.
4. Near-identical reminder templates inside one WABA get rejected as duplicates. Separate WABAs
   make this a non-problem.
5. Display name policy requires the relationship between "Salon Ayşe" and your business to be
   evident on your website. Workable at five customers, absurd at two hundred.

**Exception, capped: a concierge tier.** For owners who genuinely will not create a Meta account,
keep a Randevu-held portfolio, cap it at **15 numbers** so you never touch the 20 ceiling, price it
high enough to cover message spend plus the shared-limit risk, and never market it as the default.

Be honest with yourself about "self-serve." The BYO flow is a Facebook login, seven screens, SMS
number verification, and then **entering a credit card into WhatsApp Manager**, which is a Meta
property you do not control. That last step is where signups die and nothing you build fixes it.
Plan assisted onboarding over screen share for your first twenty customers, instrument the drop,
and only then decide whether self-serve is real.

---

## 8. Pricing

Two markets, two products, two price lists. They are economically different and one price list
will be wrong in both places.

### The cost inversion that drives everything

| Per unit | Turkey | Germany | Ratio |
|---|---|---|---|
| Inbound voice minute (Twilio local) | $0.0701 | $0.0100 | Turkey 7x worse |
| WhatsApp utility message (Meta endpoint) | $0.0009 | $0.0550 | Germany 61x worse |
| WhatsApp marketing message | $0.0109 | $0.1365 | Germany 13x worse |

Austria is not a named market in Meta's list and falls into "Rest of Western Europe" at €0.0142
utility, which would make it about three times cheaper than Germany. **That bucket assignment is a
researcher's inference from Meta's market list, not a Meta statement. Verify it before you price
an Austrian customer**, because if it holds, Vienna is your cheapest DACH city to operate in as
well as your home one.

Turkey: WhatsApp is free and voice is unsellable. Germany: voice is cheap and WhatsApp is
expensive. Randevu is currently built WhatsApp-first with a voice lane, which is exactly right for
Turkey and exactly backwards for Germany.

### Turkey

Market anchors, all verified on vendor pricing pages: Salon Randevu ₺779 / ₺1,590 / ₺2,400 /
₺3,480 KDV dahil with WhatsApp gated at ₺2,400 or sold as a ₺225 add-on; Hızlıappy free (100
appointments) / ₺799 / ₺1,250; Kuaför Asistan ₺419; Wabo ₺799. 2026 net minimum wage is ₺28,075.50,
so ₺899 is 3.2% of one net wage and about 1% of a three-person salon's payroll.

**Free tier:** 50 appointments per month, no voice. Copy Hızlıappy's cap mechanic, because a free
tier is table stakes for signup in this market.

**Randevu TR: ₺899/month, KDV dahil.** Unlimited WhatsApp confirmations and reminders, cal.com
calendar, inbox, winback.

```
Price to customer          ₺899   (KDV dahil)
Net of 20% KDV             ₺749
WhatsApp COGS               ₺34   800 utility msgs x $0.0009 x 47.3
Platform amortized          ₺50   Convex + Vercel + domain across ~20 orgs
Gross margin                ₺665  = 89%
```

**Voice in Turkey: metered, not bundled, and expect almost nobody to buy it.**

```
Cost per voice minute     $0.185  = $0.115 Retell (infra + GPT-4.1 + platform TTS)
                                  + $0.0701 Twilio TR inbound landline
In lira                    ₺8.75
Sell at                     ₺18/min  (51% GM)
A salon at 150 calls x 2.5 min = 375 min = ₺6,750/month
```

₺6,750 is more than eight times the entire software budget of the salon you are selling to. Do not
put voice minutes in a Turkish flat tier under any circumstances. If you ever find wholesale
Turkish SIP termination at a fifth of Twilio's rate, this changes; that is the single highest-value
cost investigation available in Turkey, and nobody in this research verified whether Turkish DIDs
are practically obtainable at all (Twilio offers only +90850 national and +90800 toll-free, no
geographic Istanbul or Ankara numbers, and a Telnyx help-center snippet suggests Turkish DIDs need
a local company registration number, which an Austrian entity does not have).

**Price in TRY with a re-index every six months.** Your COGS is USD and the lira loses 20 to 30%
a year. Turkish SaaS vendors re-price annually and customers expect it. Do not sign a 12-month
fixed-price TRY contract.

### DACH

Market anchors: Shore €59.90 booking / €79.90 / €129.90; Treatwell from €49.90; fonio €99 voice
**plus** €79 WhatsApp = €178 for both; term-in.app €29 chat-only.

**Randevu DACH: €79/month, one bill, both channels.** 200 voice minutes, 400 WhatsApp utility
messages, then metered.

```
Price to customer          €79.00   net, plus VAT
Voice COGS                 €22.73   200 min x $0.125 (Retell $0.115 + Twilio DE $0.010) / 1.10
WhatsApp COGS (worst case) €20.00   400 msgs x $0.055 / 1.10
Total COGS                 €42.73
Gross margin               €36.27  = 46%
```

Two things move that number, and one is worth real work:

**The 24-hour service window.** A confirm or cancel button tap opens a 24-hour window in which
utility templates are free. A T-24h reminder sent to someone who confirmed yesterday costs nothing.
If half your German reminders land inside a window, WhatsApp COGS halves to €10 and gross margin
goes to 62%. **I cannot verify the hit rate; nobody has measured it. Instrument it from day one
and sequence your sends against the window.** In Turkey this optimisation is worth ₺17 a month and
you should ignore it entirely.

**Austria at the inferred €0.0142.** Same 400 messages costs €5.16 instead of €20, taking margin
to 65%. If you start in Vienna, verify this rate first, because it materially changes what you can
promise.

**Overage: €15 per 100 minutes.** Copy fonio's structure exactly. It bills simply, carries ~70%
margin, and pushes upgrades.

**Annual: 15% off for a 12-month commitment.** Also copied, also works.

**No free trial in DACH, 30-day money-back instead.** A free trial generates support load from
people who will never pay and you have no support team. The money-back guarantee filters to buyers
and carries the risk on your side, which reads as confidence.

**Do not copy fonio's reseller contract terms** (12-month minimum with 3-month notice). That is an
enterprise artifact and it is poison for self-serve SMB, and you have no sales team to justify it.

### Why €79 and not €99

€79 undercuts fonio's combined €178 by 55% and their voice-only €99 by 20%, on a bundle they
cannot match without cutting their own ARPU in half. It sits just above Shore's €59.90, so you are
a step up from booking software rather than a second subscription on top of it. And it is 51
customers to €4,000/month instead of 258.

**Do not anchor the business on per-minute margin.** fonio's effective price per included minute
fell about 50% in nine months (a reseller order form dated 3 October 2025 shows €99 for 500
minutes; today it is €99 for 1,000). Minutes get cheaper. Build on subscription capacity that goes
partly unused, which is where fonio's real 75 to 85% blended margin comes from.

---

## 9. Risks that kill this, ranked

**1. The DACH Turkish-owned SMB segment is too thin, too scattered, or does not buy.** This is the
wedge's load-bearing assumption and nobody measured it.
*Cheapest test:* two Saturdays walking Vienna's 10th, 15th, and 16th districts with a phone. Twenty
conversations. Ask three things: who answers your phone when you are cutting hair, how many people
do not show up in a week, and would you pay €79 a month to fix it. Zero code, zero euros. If you
cannot get twenty conversations in two Saturdays, the segment is too thin and you should know that
before writing a line of Embedded Signup.

**2. Turkish ASR fails on a real salon phone line.** Names and phone numbers are the top complaint
in fonio's German review corpus, and German ASR is far better resourced than Turkish. Turkish is
agglutinative, so a single misheard suffix flips "randevumu iptal et" into "randevum ne zaman."
*Cheapest test:* one afternoon. One Retell agent, `tr-TR`, called from a barbershop with clippers
running. Read ten Turkish given names and ten phone numbers. Count errors. Then repeat with Azure
and Soniox as the ASR, since Retell supports four and no published Turkish WER benchmark exists
comparing them, so you have to generate your own. Seed the keyterm list with saç kesimi, fön,
keratin, periyodik bakım, öbür gün, haftaya salı.

**3. You spend the runway building instead of selling.** Twelve researchers just handed you a
hundred things to build. The parity ladder in the current spec is the shape of this failure.
*Cheapest test:* a rule you enforce on yourself. No feature ships that is not blocking a **named**
prospect. Write the name in the commit message. Review it monthly.

**4. Meta closes the calendar gap in Business Agent.** They said publicly they are working on
"connecting with the tools to manage your calendar," with no date.
*Cheapest test:* read WhatsApp's business blog on the first of each month. Note that this wounds
rather than kills, because your value is the resolved calendar plus the voice lane plus the German
market, not the chat itself. If Meta ships salon-grade multi-staff availability resolution for
free, reprice toward voice and DACH.

**5. Tech Provider approval fails or stalls for a solo Austrian entity.** Everything in the BYO
onboarding plan depends on it, and nobody verified how hard it is to obtain solo.
*Cheapest test:* apply this week. Two days. If it stalls, you find out in week two rather than
month three, and the fallback is the capped concierge tier.

**6. term-in.app takes the DACH-Turkish segment first.** €29, German and Turkish already shipped,
salons and barbers named, 14-day trial, claims 250+ German cities.
*Cheapest test:* take their trial. Book a Turkish appointment through it. Find out in an hour
whether it actually resolves availability or just captures intent. If it resolves availability,
your wedge narrows to voice plus the loop, and €79 gets harder to defend against €29.

**7. The credit-card step in Embedded Signup kills conversion.** It happens inside Meta's UI, not
yours.
*Cheapest test:* screen-share the first five signups and write down exactly where they stop. Do not
build a self-serve funnel until you have watched five people fail at the assisted one.

**8. Callers refuse to talk to a bot.** Verified qualitative hostility on Hacker News, including
someone who now refuses contractors that use AI receptionists and someone specifically naming
boutique garages. A JAMA Network Open study of roughly 1,300 participants found patients rated
physicians as less competent and less trustworthy when AI use was disclosed, **including for
administrative tasks only**, and EU AI Act Article 50 forces that disclosure from 2 August 2026.
The quantitative survey data circulating on this was commissioned by a human answering service, so
do not use those numbers.
*Cheapest test:* this is why WhatsApp leads and voice is the fallback. Measure hang-ups in the
first minute at your pilot and compare against the WhatsApp reply rate. If voice hang-ups exceed
30%, sell the WhatsApp product and keep voice as an after-hours net.

**9. KVKK cross-border transfer.** Turkey has issued **no adequacy decision for any country**,
confirmed on kvkk.gov.tr. Every transfer needs a Board standard contract, notified within 5
business days. Your whole stack (Convex, Meta, Retell, cal.com) is offshore. Fines run to
₺17,092,242 for data security violations at 2026 rates.
*Cheapest test:* one hour of a Turkish lawyer's time on two questions. Does a vertical booking bot
need İYS registration (the statute enumerates email and SMS, not OTT messaging, and no researcher
found a Board decision placing WhatsApp in scope), and is generating a filled standard contract at
signup a defensible posture. Then build the PDF generator, which no competitor advertises.

**10. Retell's US-only processing blocks a German sale.** Their docs state plainly they do not
operate services in the EU.
*Cheapest test:* mention it unprompted to your first three German prospects. If none of them care,
this risk is theoretical. If one walks, Vapi's EU region is a two-week port on top of the seam.

**One structural warning about the evidence behind all of this.** The fonio complaint list in
section 3 comes from OMR and Capterra, both of which run voucher-for-review programmes. Those are
the complaints of customers who **stayed** and still liked it enough to write. Nobody could reach
Reddit (crawler-banned), Trustpilot (403 on three domains), G2 (403), or X. The people who ripped
fonio out are not in this data. Treat every weakness in section 3 as a floor, not a ceiling.

---

## 10. The next two weeks

Do these in order. Do not start the next one until the previous is done.

**Week one**

1. Call +49 511 1665 3819. Listen to fonio's agent for five minutes. Take notes on what it does
   when you interrupt it and when you spell a name.
2. Apply for Meta Tech Provider status. Business verification, privacy policy, app icon, two screen
   recordings. Budget two days, do not perfect it.
3. Start WABA setup and submit `randevu_onay` and `randevu_hatirlatma` for approval on the pilot
   org. This is the long pole and it is waiting on Meta, not on you.
4. Deploy. Convex prod, Vercel, a domain, real env vars, and put `RETELL_API_KEY` in
   `.env.example` where it should already be. Half a day.
5. Spend one afternoon on the Turkish call test. Clippers running, ten names, ten phone numbers,
   count the errors, write the number down.

**Week two**

6. Fix the three silent failures. Auto-create a customer on unknown inbound and unknown caller;
   write a visible row on every cal.com rejection and surface it in Settings → Bookings. This is
   the highest-value day of coding in the repo.
7. Turn on failure visibility. Wire `failedCount` into the sidebar, set `N8N_EMAIL_WEBHOOK_URL` and
   the pilot org's `emailFrom`, send yourself a real alert and confirm it arrives.
8. Fix the four correctness bugs: template language pinned to the org, both `take()` budgets in
   `reminders.ts`, the `if (!waAccount) return;` guard on confirmations, and the UTC day boundary
   in `check_availability`.
9. Run the end-to-end checklist by hand, on a real phone, start to finish. Write down every step
   that surprised you; that list is your onboarding script.
10. Two Saturdays of door-knocking in Vienna. Twenty conversations, three questions each. Start
    this in week two, not after the code is done, because the answer decides whether the code
    matters.

**Delete from `docs/product-spec.md` this week:** the phrase "full fonio.ai parity as the target,"
the Evolution API branch-point instruction, the Calls tab, and the public booking page. They are
each a week you do not have.
