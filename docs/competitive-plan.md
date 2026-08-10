# Resepta competitive plan

Written 25 July 2026, from twelve research passes plus a read of this repo at commit `7f29b2c`.

> **Historical research snapshot.** The market research and strategic argument
> remain useful, but statements about the repository describe commit `7f29b2c`,
> not the current product. By 31 July 2026 Resepta had shipped native phone-agent
> creation and existing-agent connection, a Resepta-owned variable registry, a
> private runtime connection, a durable call-event inbox and operator recovery.
> Agents and Calls now live as two sections inside one **Phone agent** sidebar
> destination; there is no separate Calls destination and no Settings page.
> Shared `RETELL_API_KEY`, manual webhook-copying and paste-an-agent-ID guidance
> below are superseded and must not be implemented. Use
> [`product-spec.md`](product-spec.md), [`phone-agent.md`](phone-agent.md) and
> `AGENTS.md` for current product and implementation decisions.

Read this once, then work section 10. Everything before it exists to justify section 10.

Two conventions. Effort is in **developer-weeks**, where a developer-week means four focused
days of coding by one person who is also selling and supporting. FX: EUR/TRY 53.85, USD/TRY 47.3.
Those two imply USD/EUR 1.138; the euro figures below were computed at 1.10, so every euro COGS
number is about 3% too high. Left alone deliberately, because it errs against us.

---

## 1. What fonio actually is

fonio is a Vienna company selling an AI that answers a German-speaking small business's phone,
founded by Daniel Keinrath and Matthias Gruber, first paying customer late 2023, reported at
roughly $2M ARR (journalism, not a filing) before raising €3M in December 2025 and $17M at a $140M
valuation from 20VC in June 2026. It publishes 9,500+ customers and 2M+ calls automated per month,
and ships two to three changelog entries a week with about 50 people. The product is a
form-and-prompt builder: pick a voice and language, paste your website URL so it scrapes hours and
services into a knowledge base, buy a fonio number, forward your business line to it. Behaviour is
configured by writing if-then sentences in prose inside a prompt field, which their own help center
admits fails in documented ways. Voice costs €99, €299, or €499 per month for 1,000, 3,000, or
5,000 minutes; a **separate** WhatsApp chatbot product costs €79, €249, or €449 for 800, 2,500, or
4,500 conversations. No free trial, a 30-day money-back guarantee, and done-for-you setup at €1,000
to €2,500 plus a €99/month care package, which tells you what "60 seconds to set up" is worth. They
operate in Austria, Germany, Switzerland, Poland, Italy, France, the UK, the Netherlands, Spain, and
Brazil. Across every fonio-owned page eight researchers fetched, Turkish appears zero times.

---

## 2. What fonio does well that Resepta does not

Ranked by how much it costs you to be behind.

**1. It works, at volume, in production.** fonio has processed millions of calls. This repo is
40 commits, all dated 25 July 2026, about 12,000 lines, zero test files, and `.env.local` points at
`CONVEX_DEPLOYMENT=local:local-randevu-randevu_tr` on a laptop. No Meta, cal.com, or Retell webhook
has ever arrived. Every claim in the spec about what is "built" means "typechecks." Right now
`SettingsView.tsx` hands a salon owner `http://127.0.0.1:3213/calcom/webhook?token=...` to paste
into cal.com. Nothing else on this list matters until this one is closed.

**2. Onboarding that a non-technical owner completes.** Paste your website URL, hit Generate, and
the knowledge base fills itself. One agency reviewer on OMR reported about 30 minutes per business
end to end, which is a single self-reported data point, not a benchmark. Resepta's equivalent is an
empty settings form and a box where you paste a Retell agent id. The scrape is worth copying, with
the caveat section 5 item 6 spells out: it assumes the business has a website.

**3. Failure is visible to the customer.** fonio's Conversations view has outcome filters
(`Appointment Booked`, `Transferred`, `Abandoned`, `Spam`), a waveform player, an AI summary, and a
usage meter. Resepta's worst failure modes are silent, and two of them share one line of code. An
inbound WhatsApp from an unknown number is written with `customerId: undefined` (`webhook.ts:75`),
and an inbound call from an unknown number gets a `calls` row the same way (`retell.ts:455`). Both
rows exist; both are dropped by the single `if (!customerId) return;` guard inside `push` at
`messages.ts:235`, so neither reaches the inbox. Separately, a cal.com booking whose attendee has no
E.164 phone returns `{ ok: false, reason: "attendee-phone-missing-or-not-e164" }` with no row
written anywhere, under a code comment claiming it records why. A salon owner cannot tell "working
perfectly" from "dropping every message." That, not the missing Calls tab, is what loses a pilot.

**4. A reseller channel that reaches businesses which cannot configure software.** Free instant
partner signup, 15 to 35% lifetime commission or 20 to 35% resale discount, battlecards, a proposal
template, an NFR licence with test credits, and a Demo Builder that generates a prospect-specific
demo agent in under a minute. A Gold partner publicly quotes €800 setup plus €0.15/min. This is how
a self-serve product gets sold to people who will never self-serve, and nothing in this plan
answers it: sections 5 and 10 say what to build and how to validate the segment, and nothing about
where customers 2 through 51 come from. Largest hole in the document, first item in the last one.

**5. Trust artifacts.** OMR "#1 Software Tool of the Year 2026", Trustpilot 4.9 across 400+ reviews,
Volkswagen and Deutsches Rotes Kreuz logos, "Made in Austria", servers in Nuremberg, DSGVO and AI
Act claims on the homepage. You have one client.

**6. Voice maturity.** 20+ voices, 25 to 35 languages depending on which of their pages you read,
mid-call language switching, prompt-defined transfer targets, voicemail detection at 2 to 3
seconds, an interruption toggle, KYC-gated outbound, contact blocking, UK/US accent splits. Resepta
has no `reschedule` (`http.ts:309` falls through to `unknown-function`), no `transfer_to_human`
despite storing `transferNumber`, and no number management.

**7. Its own scheduler, which does reschedule and cancel.** Their calendar doc reserves reschedule
and cancel for fonio Scheduler. A fonio limitation, not a cal.com one, so it belongs in section 3.

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

This help-center list is the load-bearing fact under the entire wedge, and it is an inference from
a roadmap label on a page that could be months stale. €178 buys one month of both products and
settles it in an afternoon. Do that in week one. And note the clock: they announced it, so the gap
has a declared expiry date.

**cal.com is a degraded path inside fonio.** From `fonio.info/articles/calendar`: cal.com "Can only
book appointments." Their own scheduler launched 17 April 2026 and reschedule/cancel landed 6 June
2026. A three-month-old capability, not a moat.

**The €99 tier may allow only one concurrent call**, reaching 3 at €299, while the marketing pages
advertise "15 Parallele Anrufe." Both numbers sit on the same website and no researcher resolved
which governs. If the low one is real, a two-chair salon on Solo drops the second simultaneous
caller. A sales question, not a fact to repeat.

**Analytics is a call counter.** Their analytics doc says "Coming soon: expect more charts, deeper
breakdowns and richer analytics." No booking funnel, no no-show rate, no revenue attribution. A
salon owner cannot answer "how many appointments did this book me and what were they worth."

**There is no native CRM.** The first-class integration list is email, SMS, HTTP request, web
search, and Google Sheets. HubSpot and Salesforce are marketing words backed by "build a Make or
n8n scenario." Their roadmap says AI-native CRM by end of Q3 2026, which means not now.

**Speech recognition on names, numbers, emails, and addresses is their most-cited complaint.** Six
separate reviewers on Capterra and OMR raise it independently. Six more raise dialects and accents,
which in a German review corpus means German regional dialects, not foreign accents. They only
added UK and US English accent recognition on 23 July 2026, which suggests accent handling is
configured per language rather than robust by default.

**Setup requires prompt-engineering skill, and their customers say so.** Six reviewers name it, one
asks for drag-and-drop, two report backend fields poorly explained. Meanwhile fonio sells a €1,000
setup SKU for "simple use cases like a secretariat, appointment scheduling or simple FAQs." If it
took minutes, that SKU would not exist.

**Billing is aggressive and there is no trial.** When included minutes run out, 100-minute packages
at €15 are added automatically, and test calls have been billed. Reviewers name a former €300
minimum top-up, at least six want a trial, and one says the billing logic "reagiert an einigen
Stellen zu aggressiv."

**GDPR and AI Act paperwork is not readily available.** A management-consulting reviewer, 30 June
2025: the documents needed for DSGVO conformity and EU AI Act documentation "sind nicht einfach
verfügbar." Compliance is their loudest marketing claim, and Article 50 transparency obligations
apply from **2 August 2026**, eight days from now.

**Turkey and Turkish.** No Turkish in the language switcher, no Turkish locale, no +90 numbers in
the changelog, no Turkish customer, no roadmap mention, and all eighteen named customer stories are
German or Austrian. Absence of evidence across eight research passes, not a confirmed exclusion,
since the definitive country list sits behind their app login. But at $140M post-money, Turkish SMB
ACVs cannot move their multiple, so they have little reason to go there soon.

**Not verified, do not repeat as fact:** whether fonio has any payments, deposits, or no-show fee
feature (found nothing, which is not confirmed absent); their AGB terms (both `/agbs` and
`/de/agbs` returned navigation shells to three researchers, so the 12-month term with 3-month notice
comes from a 2025 partner order form and may not apply to self-serve); whether the English-homepage
testimonials with American names are real customers.

---

## 4. The wedge

### First, the case against the obvious answer

The obvious wedge is "Turkey is WhatsApp-first, fonio is phone-first and DACH-only, so own WhatsApp
booking in Turkey." The numbers say that is wrong as a business.

Turkish SMB software pricing is anchored at ₺419 to ₺1,590 per month with credible free tiers:
Salon Randevu Silver ₺779, Hızlıappy Profesyonel ₺799 with a free 100-appointment tier, Kuaför
Asistan ₺419. That is €8 to €30. The category is crowded. Wabo does WhatsApp-only AI booking at
₺799, Planris at ₺820, SalonAppy claims 16,000+ professionals, Salonora just launched with TÜBİTAK
backing, and Fresha is already bookable in Istanbul.

Then Meta shipped the generic version for free. Meta Business Agent went globally available on
3 June 2026 across WhatsApp, Messenger, and Instagram. Meta's own copy: it "books appointments and
qualifies incoming leads." Setup is inside the WhatsApp Business app, no BSP, no developer, free.

And voice, the thing that would let you charge more, is arithmetically unsellable in Turkey.
Twilio inbound to a Turkish landline is $0.0701/min against $0.0100 in Germany. Add Retell's
realistic stack ($0.055 infrastructure + $0.045 GPT-4.1 + $0.015 platform TTS = $0.115) and a
Turkish voice minute costs **$0.185, which is ₺8.75**. A salon taking 150 calls a month at
2.5 minutes burns ₺3,281 in COGS against a market that pays ₺799 for all its software.

Now the scale problem, which is the number that should decide this. Say you need €4,000/month of
recurring revenue to meaningfully extend runway. At ₺899/month (net of 20% KDV, ₺749, which is
€13.90) you need **288 Turkish salons**. At €79/month in DACH you need **51**. You are one person
doing assisted onboarding over screen share. 288 is not a number a solo operator reaches; 51 is.

So Turkey-only, WhatsApp-only, is a market where you are the fifth cheap entrant, competing with
free, at a price that needs nearly six times more customers than you can onboard, with your COGS in
USD against a lira that loses 20 to 30% a year.

### The wedge I would actually take

**Resepta should be the only product that closes the whole appointment loop, in Turkish and German,
for Turkish-owned service businesses in Austria and Germany.**

"The whole loop" is specific: a call or a message comes in, the AI resolves it against **real
availability** in cal.com, books it, sends a WhatsApp confirmation with confirm and cancel buttons,
the tap writes back to the calendar, the reminder fires at T-24h and T-2h inside quiet hours, and
the owner sees it as one thread per person with calls folded in. One conversation, one calendar,
one bill, instead of a phone product plus a chat product. Three falsifiable claims support it.

**Claim one: nobody closes this loop today, and the two biggest players have publicly said they
cannot.** fonio's docs list voice-to-WhatsApp and outbound WhatsApp as upcoming and lock
reschedule/cancel away from cal.com. WhatsApp's blog describes future work on "connecting with the
tools to manage your calendar," so Meta Business Agent can capture a booking intent but not resolve
it against staff availability. term-in.app at €29 is chat-only. Wabo and Planris are WhatsApp-only.
Salon Randevu gates WhatsApp behind its ₺2,400 tier. The cal.com brain and the confirm/cancel
button loop you already wrote are the exact thing missing everywhere else.

**Claim two: a solo operator can hold it and a funded competitor structurally will not.** The loop
is not an ML problem or a feature. It is unglamorous backend discipline: acknowledge the calendar
write before the agent says the words, idempotency keys per call, never let a barge-in confirm
anything, delivery status per message, template language pinned to the org, timezone-correct day
boundaries. fonio charges €99 + €79 = €178 for both channels, so a single bill at €79 cuts their
own combined ARPU by 55%, which is not a decision a 20VC-backed board makes.

**This is the weakest of the three claims.** The €178 argument only bites if a meaningful share of
fonio's voice customers also buy the WhatsApp product, and nobody measured that attach rate. If it
is 5%, bundling costs fonio almost nothing and they ship the bridge as a feature rather than a
discount. So do not plan as if the bridge is permanently yours. The durable part is claim three:
fonio can copy the loop in a quarter and cannot copy being Turkish in Vienna. Build the loop
because it wins the next twelve months, and spend those months turning the segment relationship
into the reason people renew.

**Claim three: the geography makes the price work and makes your identity load-bearing.** Turkish-
owned barbers, salons, and garages in Vienna, Berlin, and Duisburg pay DACH prices and have a
language problem nobody serves. fonio's reviewers complain about accents and dialects and they only
shipped UK/US accent handling two days ago, so Turkish-accented German is a plausible instance of a
failure class they handle per-language. Plausible, not confirmed: no researcher tested it. term-in
ships Turkish as a checkbox in a language list, not as a go-to-market. You are Turkish, you live in
Austria, you speak German, and a funded company cannot buy that. Whether the segment is big enough
to live on is risk 1.

**Turkey is a lab, not a market, until DACH pays.** No Turkish free tier, no TRY self-serve, no
iyzico, no Turkish marketing. Your existing client and any friend-of-a-friend salon runs on a
hand-written invoice at ₺899 and exists to produce Turkish call recordings, Turkish templates, and
a testimonial in the right language. Turkish utility messages cost $0.0009, so the lab is free to
run, and Turkish ASR is the harder of your two languages, so what survives Izmir survives Vienna.
Revisit Turkish self-serve when DACH revenue covers your rent, because every hour on TRY billing is
an hour not spent on the 51 customers who fund the company.

### The holes in this argument

**Nobody measured the DACH Turkish-owned SMB population.** No count of Turkish-owned salons,
barbers, or garages in Austria and Germany, no density, no willingness to pay. I am not going to
invent one. **Nobody measured fonio's WhatsApp attach rate either**, which is what decides whether
€79 is really unmatched. And **nothing here says how you reach these businesses at all.** All three
are in the last section with a test each.

---

## 5. The build plan

The spec in `docs/product-spec.md` names "full fonio.ai parity" as the target. **Delete that
sentence.** Parity with a 50-person funded company is not a plan for one person, and the parity
ladder is what has you building a Calls tab instead of a webhook that works.

### Track zero: things that are calendar time, not developer time. Start today.

These block everything and none of them are code.

- **Apply for Meta Tech Provider status.** Roughly 2 days, €0 in fees: business verification, an app
  icon, a privacy policy, and two screen recordings (Meta allows a recording of the API Setup cURL
  script). It unlocks Embedded Signup and **coexistence**, which lets a salon keep its existing
  WhatsApp Business app and number while you add automation. Without it your onboarding pitch is
  "give up the number that's on your shop window." You do not need Solution Partner status.
- **Start WABA and template approval for pilot org one.** Template review takes up to 24 hours,
  business verification an undocumented 2 to 14 days. The long pole.
- **Verify Embedded Signup v2 sunsets 15 October 2026** and build on v4. Two researchers flagged the
  date; neither confirmed it in the changelog first-hand.
- **Read Meta's "pricing policy for AI Providers"** (16 February 2026, updated 12 May). A researcher
  found the link and could not retrieve the substance. You run an AI voice lane, so this is the one
  unknown that could reprice you without warning.

### Track one: what wins the first paying customer

Total: about **7 developer-weeks**. Nothing here is a new product surface. All of it is the
difference between a demo and something a salon can run unattended for a month.

| # | Item | Weeks | What it unlocks commercially |
|---|---|---|---|
| 1 | **Deploy, with both fail-open guards closed.** Convex prod, Vercel, domain, `predeploy` typecheck. `retellGuard` in `http.ts` verifies signatures but skips verification entirely when `RETELL_API_KEY` is unset; `WA_APP_SECRET` behaves the same way. Set both on the prod deployment in the hour you deploy, and add `RETELL_API_KEY` to `.env.example`. | 0.5 | Everything. Today no external system can reach this code, and the moment one can, an unsigned POST can write appointments. |
| 2 | **Kill the silent failures.** Auto-create a customer row on unknown inbound (`webhook.ts:75`) and unknown caller (`retell.ts:455`), `consentAt` unset, so the `messages.ts:235` guard stops swallowing them. Write a visible row on every non-ok return in `calcom.ts` and surface "last event received / last rejection" in Settings → Bookings, beside the E.164 phone-question instruction nobody documented. | 0.5 | The owner can distinguish working from broken. Highest-value fix in the repo. |
| 3 | **Failure visibility.** No failed-message count exists: `messages.ts` exports `attentionCount` and nothing else, and the sidebar shows one dot. Add a `failedCount` query beside it, set `N8N_EMAIL_WEBHOOK_URL` and the pilot org's `emailFrom`, send yourself a real alert. Fill in the `ERROR_KEY` map in `ConversationPanel.tsx` so a failed bubble gives a reason instead of "not sent." | 0.25 | You find out about a dead pilot in an hour instead of a month. |
| 4 | **Correctness fixes.** Pin template language to the org and stop copying `attendee.language` onto the customer. Fix both `take()` budgets in `reminders.ts` (winback takes the oldest 200 rows *before* filtering by status, so it dies at roughly 200 appointments in 45 days). Remove `if (!waAccount) return;` at `appointments.ts:130` so the email lane fires on confirmations. Fix the UTC day boundary in `check_availability`, three hours off for Europe/Istanbul. | 0.5 | The product still does what the spec says in month two. |
| 5 | **One end-to-end handover checklist, run by hand.** Create customer, book, confirmation lands on a real phone, tap confirm, status flips, reminder fires at both offsets, reply "İPTAL" cancels. With zero tests this is your only regression net. | 0.25 | You can promise a month unattended and mean it. |
| 6 | **Scrape onboarding, with the right source.** One URL field, one extraction pass, prefills services, hours, knowledge text. fonio's mechanic assumes a website; a Turkish-owned barbershop in Vienna often has an Instagram page and a Google Business Profile and nothing else. Sample 30 target businesses on Google Maps first and count the websites. Under half, and Google Business Profile is the primary source. | 1.5 | Turns a 3-hour setup into something closer to 30 minutes. Worthless if it only works for businesses your segment does not include. |
| 7 | **Embedded Signup v4 with coexistence.** Gated on Tech Provider approval. | 3 | "Keep your number, keep the app on the counter, we add the automation." Without it, onboarding asks for something a salon will not give up. Budgeted at 3, not 2: this is Meta OAuth, token exchange, and coexistence error states, first time, with no one to ask. |
| 8 | **Turkish call-quality test.** One Retell agent, one afternoon, called from a barbershop with clippers running: ten Turkish names, ten phone numbers, count the errors. | 0.25 | A gate, not a feature. If Turkish ASR fails on a real salon line, the voice half of the wedge is dead and you want to know in week two, not month six. |

### Track two: what wins the tenth customer

Do none of this until track one is done and one person is paying. Total about **5.5 developer-weeks**.

| # | Item | Weeks | What it unlocks commercially |
|---|---|---|---|
| 9 | **Voice lane hardened.** Add `reschedule` and `transfer_to_human` (`http.ts:309` falls through to `unknown-function` for both). Move to one shared Retell agent resolved by `to_number` via the inbound-call webhook instead of one hand-created agent per org. Signature verification is not here: it is one env var and it belongs in item 1. | 1 | Removes the manual Retell-console step that blocks self-serve. |
| 10 | **The loop dashboard.** Bookings made, confirmations delivered, taps received, no-shows, no-shows recovered by winback, per week. Not a call counter. | 1 | The renewal conversation, and the thing fonio calls "coming soon." An owner who can see recovered bookings does not churn. |
| 11 | **Vertical setup templates.** Kuaför, berber, Friseur, oto servis. The owner fills five fields, never a prompt box. | 1 | The loudest complaint in fonio's review corpus, and it is packaging, not engineering. |
| 12 | **Compliance artifacts, generated at signup.** Spoken AI disclosure toggle (EU AI Act Article 50 applies 2 August 2026), consent-gated recording with a retention setting, a downloadable AVV/DPA, and a filled KVKK standard contract PDF with filing instructions (no adequacy decision exists for Turkey, and signed contracts must reach the Board within 5 business days). The week is code only; the AVV and KVKK text are a lawyer's hours, unbudgeted. | 1 | fonio's own customers complain they cannot get these. A trust asset in DACH, a legal necessity in Turkey. |
| 13 | **Honest billing.** Hard monthly spend cap, a "your assistant is paused, top up" message, no auto-charged minute packs, free test calls. | 0.5 | Six-plus fonio reviewers are publicly asking for exactly this. |
| 14 | **Payments, Stripe and EUR only.** No iyzico, no PayTR, per the Turkey decision in section 4. | 1 | Stops hand-billing. Defer until customer four or five. |

### What to cut, plainly

- **The Evolution API lane.** Section 7 has the evidence. Remove the "keep the branch point"
  instruction from the spec with it.
- **A separate Calls tab.** Calls already fold into the conversation, which is the better design and
  is the wedge. A separate destination argues against your own positioning.
- **The public booking page and the slug.** cal.com hosts one. Surface the link.
- **In-app next-free-slots preview.** Nice, worth nothing to a buyer.
- **Voice languages beyond Turkish and German.** Each one is an ASR risk you cannot test.
- **Turkish dentists.** Best budget in the market (₺4,799 to ₺6,399/month at DoktorTakvimi) and the
  worst fit: mandatory e-Nabız submission with a fine of 1% of the previous month's gross service
  revenue, special-category health data, VERBİS registration, entrenched incumbents. You clear none
  of those gates; salons and barbers have no equivalent barrier.
- **Turkish garages as a system-of-record sale.** Their software (OtoMixSQL, İndemSoft, Myndos) is
  ERP-shaped. A booking-first product is an add-on there, not a replacement.
- **The word "parity" in `product-spec.md`.**

---

## 6. Voice providers

**Recommendation: do not add a second provider. Build the seam that makes adding one cheap, then
stop.** The seam is **3 days** (half a day, one day, one day) and pays for itself even if you never
add a provider. It is deliberately not in either track table: do it the week you touch the voice
lane for item 9, not as a project of its own.

1. **Ingest recordings into Convex file storage on receipt** rather than storing a URL. Retell's
   URLs can expire, Vapi purges call history after 14 days on Build, and ElevenLabs never gives you
   a URL at all. Half a day, and it doubles as your GDPR and KVKK deletion story.
2. **Rename and extract.** `retellAgents` becomes `voiceAgents` with a `provider` field,
   `retellAgentId` becomes `externalAgentId`, `retellCallId` becomes `providerCallId`. Move the
   `if (name === ...)` chain out of `http.ts` into `convex/voice/tools.ts` as
   `handleTool(ctx, org, name, args, callerPhone)`, behind one route with
   `pathPrefix: "/voice/"` and `/retell/*` kept as an alias so no live agent needs reconfiguring on
   ship day. One day, mostly cut and paste.
3. **A `CallRecord` normalizer** with fields for provider, callRef, direction, from/to, duration,
   disconnect reason, outcome, summary, transcript, collected variables, transfer target, and
   recording as either a URL or inline base64. Every provider maps into it. One day.

**What cannot be abstracted**, so do not try: prompt and flow authoring, voice identity (ids are
vendor-scoped, and switching changes how the business sounds to its regulars), warm transfer,
endpointing tuning, signature verification, data residency. Mid-call language switching too:
Deepgram excludes Turkish from its code-switching set, so a Vienna salon switching TR to DE
mid-sentence is a provider-specific capability, not a setting.

**The per-org setting: yes, but it is an ops lever, not a product feature.** A salon owner must
never see a dropdown reading "Retell or xAI." Store `provider` per org so you can move one customer
at a time. Two triggers justify moving anyone: a German prospect refuses US data processing (Retell
states plainly it does not operate services in the EU; Vapi has `api.eu.vapi.ai`), or a blind
Turkish listening test says another provider is materially better. The second is usually satisfied
by switching Retell's TTS to ElevenLabs for $0.025/min more, which is config, not integration.

**One thing matters more than multi-provider support**, and it sits inside item 9: `retellAgents`
is one hand-created agent per org, so every signup requires you to open the Retell console. Retell's
inbound-call webhook lets one agent serve everyone with per-org `dynamic_variables` injected at call
time, resolved by `to_number`, exactly as your WhatsApp lane already routes by
`metadata.phone_number_id`. One caution: `coerceContactValues` merges those injected variables into
what gets written to the customer, so an org whose `contactFields` key collides with an injected
variable name gets your value written onto their customer record.

### xAI, honestly

**xAI can do telephony today**: SIP termination at `sip.voice.x.ai`, a signed
`realtime.call.incoming` webhook, `/refer` and `/hangup`, BYO trunk. It does not sell numbers, but
neither does Retell outside the US and Canada.

- **Price looks better and partly is not.** Realtime is $0.05/min against Retell near $0.115, but
  every `conversation.item.create` costs $0.004 and each function-call result is one. A booking call
  fires five to ten, so $0.02 to $0.04 of overhead invisible on the headline rate. Cheaper, not half.
- **Turkish is listed as supported** in speech-to-speech, TTS, and STT. Nobody publishes a Turkish
  naturalness benchmark for any vendor, so only a test call settles it.
- **The region question is unresolved and it is the one that matters.** The voice agent model page
  names `us-east-1`; the regions doc describing `eu-west-1` 404'd on both paths a researcher tried.
  If realtime voice is US-only, every turn of a call from Istanbul or Vienna carries roughly 100 to
  150ms of transatlantic round-trip on top of model latency. Ask xAI directly.
- **It is beta.** The Voice Agent Builder was announced 1 July 2026. Expect breaking changes.

**Verdict: keep Retell, build the seam, spend one afternoon making a Turkish call through xAI.** Do
not port the Retell lane before that call, and do not design around xAI as a plan.

**Do not pick any provider on published latency.** Every latency figure any researcher found came
from vendor blogs or SEO listicles, including a widely-cited "500 production calls, March 2026"
study nobody could reach in primary form. On a Turkish GSM leg, carrier latency dominates any
platform difference. Measure on your client's actual phone.

---

## 7. WhatsApp lanes

### Cloud API versus Evolution

**Cloud API. Evolution is not a lane for this product.** Three findings settle it, none a judgement
call.

**Reply buttons do not work on Evolution's Baileys connector.** `sendButtons` returns HTTP 201 and
never delivers. Evolution issue #2404, open since 3 February 2026. Resepta's entire confirm/cancel
loop is quick-reply buttons (`wa.ts` sends them, `webhook.ts` maps the payload back to an
appointment). The community workarounds are a stranger's unaudited Docker image and a "DM me on
Discord" comment. You are not putting a salon's session keys in a stranger's container.

**Outbound to people who have never messaged you is what WhatsApp's Reachout Timelock blocks, and
it fails silently.** ACK error 463. Baileys issue #2707 (14 July 2026) and Evolution #2650 and #2653
(22 July, v2.3.7) all describe an instance showing `open`, receiving fine, sends returning success,
nothing arriving. Your connection-state alerting would call that number healthy. Every first
reminder Resepta sends is a cold reachout, because a walk-in has never messaged the salon.

**The economics never justified it.** Meta's live pricing endpoint returns **$0.0009** per Turkish
utility message, so a salon doing 400 appointments a month sends 800 messages for **$0.72**, and
templates inside an open 24-hour window are free on top of that. Two research passes used $0.0014
from third-party aggregators; the pass that read Meta's own endpoint got $0.0009. Trust $0.0009 and
re-check quarterly, since Meta can change rates only on 1 January, April, July, or October.

On top of that you would run a Postgres, Redis, and Docker host on a residential IP, kept alive at
2am, whose downtime stops *every* customer's reminders, under a licence that makes you display
"powered by Evolution API" in your closed-source SaaS, in documented violation of WhatsApp's terms
on your customer's primary business number. Baileys' maintainers say in their README that they
discourage automated messaging.

### What the per-org switch should actually control

Not Cloud versus Evolution. **Who owns the WABA.**

**Default: BYO via Embedded Signup with coexistence.** The customer's own WABA, their own number,
their own credit card with Meta, their own quality rating. Five reasons, in order of how hard they
bite:

1. A business portfolio starts capped at **2 registered phone numbers**, rising to 20 after
   verification. If you hold the numbers, customer 21 needs an arrangement with Meta you have no
   leverage to get.
2. The **250 unique recipients per 24 hours** starting limit, which one researcher reported as
   shared across a whole portfolio while Meta's docs describe it per number. If portfolio-wide,
   twenty salons at 30 reminders a day is 600 and you break it by customer five. Read the real limit
   in WhatsApp Manager before relying on either. Reasons 1, 3, 4, and 5 decide this anyway.
3. Quality rating is portfolio-level, so one customer importing a scraped list drags down
   deliverability for everyone else.
4. Near-identical reminder templates inside one WABA get rejected as duplicates.
5. Display name policy requires the relationship between "Salon Ayşe" and your business to be
   evident on your website. Workable at five customers, absurd at two hundred.

**Exception, capped: a concierge tier.** For owners who will not create a Meta account, keep a
Resepta-held portfolio capped at **15 numbers** so you never touch the 20 ceiling, priced high
enough to cover message spend plus the shared-limit risk, never marketed as the default.

Be honest about "self-serve." The BYO flow is a Facebook login, seven screens, SMS verification,
and then **entering a credit card into WhatsApp Manager**, a Meta property you do not control. That
step is where signups die and nothing you build fixes it. Plan assisted onboarding over screen
share for the first twenty customers, instrument the drop, then decide whether self-serve is real.

---

## 8. Pricing

Two markets, two price lists. They are economically different and one list will be wrong in both.

### The cost inversion that drives everything

| Per unit | Turkey | Germany | Ratio |
|---|---|---|---|
| Inbound voice minute (Twilio local) | $0.0701 | $0.0100 | Turkey 7x worse |
| WhatsApp utility message (Meta endpoint) | $0.0009 | $0.0550 | Germany 61x worse |
| WhatsApp marketing message | $0.0109 | $0.1365 | Germany 13x worse |

Two cautions. Meta quotes in USD, so the Austrian €0.0142 below needs converting before you compare
it to the Germany row; and the Turkish voice minute assumes you can buy a Turkish inbound number at
all, which the end of this section says you probably cannot.

Austria is not a named market in Meta's list and falls into "Rest of Western Europe" at €0.0142
utility, about three times cheaper than Germany. **That bucket assignment is a researcher's
inference, not a Meta statement. Verify it before you price an Austrian customer**, because if it
holds, Vienna is your cheapest DACH city as well as your home one.

Turkey: WhatsApp is free and voice unsellable. Germany: voice cheap, WhatsApp expensive. Resepta is
built WhatsApp-first with a voice lane, right for Turkey and backwards for Germany.

### Turkey

Market anchors, all verified on vendor pricing pages: Salon Randevu ₺779 / ₺1,590 / ₺2,400 / ₺3,480
KDV dahil, WhatsApp gated at ₺2,400 or a ₺225 add-on; Hızlıappy free / ₺799 / ₺1,250; Kuaför Asistan
₺419; Wabo ₺799. 2026 net minimum wage is ₺28,075.50, so ₺899 is 3.2% of one net wage.

**No free tier and no self-serve, per section 4.** A free tier is table stakes for signup here,
which is one more reason not to open the market yet. Below is the reference price for hand-invoiced
lab customers.

**Resepta TR: ₺899/month, KDV dahil.** Unlimited WhatsApp confirmations and reminders, cal.com
calendar, inbox, winback.

```
Price to customer          ₺899   (KDV dahil)
Net of 20% KDV             ₺749
WhatsApp COGS               ₺34   800 utility msgs x $0.0009 x 47.3
Platform amortized          ₺50   Convex + Vercel + domain across ~20 orgs
Gross margin                ₺665  = 89%
```

**Voice in Turkey: metered, never bundled, and expect nobody to buy it.**

```
Cost per voice minute     $0.185  = $0.115 Retell (infra + GPT-4.1 + platform TTS)
                                  + $0.0701 Twilio TR inbound landline
In lira                    ₺8.75
Sell at                     ₺18/min  (51% GM)
A salon at 150 calls x 2.5 min = 375 min = ₺6,750/month
```

₺6,750 is more than eight times the entire software budget of the salon you are selling to. Do not
put voice minutes in a Turkish flat tier under any circumstances.

The cost model above may be moot. Twilio offers only +90850 national and +90800 toll-free numbers,
no geographic Istanbul or Ankara number, and a Telnyx help-center snippet suggests Turkish DIDs
require a local company registration number an Austrian entity does not have. The $0.0701/min rate
is the price of a line you may not be allowed to buy. One support ticket each to Twilio and Telnyx
settles it, before anyone quotes Turkish voice to anyone.

**Price in TRY, re-indexed every six months, never on a 12-month fixed contract.** Your COGS is USD
and the lira loses 20 to 30% a year. Turkish vendors re-price and customers expect it.

### DACH

Market anchors: Shore €59.90 booking / €79.90 / €129.90; Treatwell from €49.90; fonio €99 voice
**plus** €79 WhatsApp = €178 for both; term-in.app €29 chat-only.

**Resepta DACH: €79/month, one bill, both channels.** 200 voice minutes, 400 utility messages, then
metered.

```
Price to customer          €79.00   net, plus VAT
Voice COGS                 €22.73   200 min x $0.125 (Retell $0.115 + Twilio DE $0.010) / 1.10
WhatsApp COGS (worst case) €20.00   400 msgs x $0.055 / 1.10
Total COGS                 €42.73
Gross margin               €36.27  = 46%
```

Two things move that number:

**The 24-hour service window.** A confirm or cancel tap opens a 24-hour window in which utility
templates are free, so a T-24h reminder to someone who confirmed yesterday costs nothing. If half
your German reminders land inside a window, WhatsApp COGS halves to €10 and margin goes to 62%.
**Nobody has measured the hit rate. Instrument it from day one and sequence your sends against the
window.** In Turkey the same optimisation is worth ₺17 a month; ignore it there.

**Austria at the inferred €0.0142.** The same 400 messages cost €5.16 instead of €20, taking margin
to 65%. Verify the rate before you promise anything to a Viennese customer.

**Overage: €15 per 100 minutes**, copied from fonio. **Annual: 15% off for twelve months**, also
copied. **No free trial, 30-day money-back instead**, because a trial generates support load from
people who will never pay and you are the support team. **Do not copy fonio's reseller contract
terms** (12-month minimum, 3-month notice); that is an enterprise artifact and poison for
self-serve SMB.

### Why €79 and not €99

€79 undercuts fonio's combined €178 by 55%, on a bundle they cannot match without cutting their own
ARPU in half. It sits just above Shore's €59.90, so you are a step up from booking software rather
than a second subscription on top of it. And it is 51 customers to €4,000/month instead of 288.

Be careful with the other comparison. €79 is 20% under fonio's voice-only €99, but €99 buys 1,000
minutes and this buys 200. Per minute you are dearer, and a prospect who only wants a phone
answerer will notice. Sell the loop or do not sell. If 200 minutes proves stingy in pilots, raise
the allowance and let the 46% margin absorb it rather than raising the price.

**Do not anchor the business on per-minute margin.** fonio's effective price per included minute
fell about 50% in nine months (a reseller order form dated 3 October 2025 shows €99 for 500
minutes; today it is €99 for 1,000). Minutes get cheaper. Build on subscription capacity that goes
partly unused, which is where fonio's real 75 to 85% blended margin comes from.

---

## 9. Risks that kill this, ranked

**1. The DACH Turkish-owned SMB segment is too thin, too scattered, or does not buy.** The wedge's
load-bearing assumption, and nobody measured it.
*Cheapest test:* two Saturdays walking Vienna's 10th, 15th, and 16th districts. Twenty
conversations, three questions: who answers your phone when you are cutting hair, how many people
do not show up in a week, would you pay €79 a month to fix it. Zero code, zero euros. If twenty
conversations are hard to get in two Saturdays, the segment is too thin, and you want that answer
before writing a line of Embedded Signup.

**2. The bridge stops being a gap.** fonio lists voice-to-WhatsApp and outbound WhatsApp as
upcoming; Meta says it is working on "connecting with the tools to manage your calendar." Neither
has a date. fonio is the more dangerous: German SMB distribution, two products it already ships,
and an announcement that means the work is funded.
*Cheapest test:* buy one month of both fonio products (€178) in week one, try to make a phone
booking send a WhatsApp confirmation, then watch their changelog weekly. This wounds rather than
kills: what is left when the bridge closes is the resolved calendar, the voice lane, Turkish, and
knowing these owners. If fonio ships it inside six months, stop selling the loop and sell the
segment.

**3. Turkish ASR fails on a real salon phone line.** Names and phone numbers are the top complaint
in fonio's German review corpus, and German ASR is far better resourced than Turkish. Turkish is
agglutinative, so a single misheard suffix flips "randevumu iptal et" into "randevum ne zaman."
*Cheapest test:* one afternoon. One `tr-TR` Retell agent called from a barbershop with clippers
running, ten Turkish given names, ten phone numbers, count errors. Repeat with Azure and Soniox,
since no published Turkish WER benchmark compares them and you have to generate your own. Seed the
keyterm list with saç kesimi, fön, keratin, periyodik bakım, öbür gün, haftaya salı.

**4. You spend the runway building instead of selling.** Twelve researchers just handed you a
hundred things to build, and the parity ladder is the shape of this failure.
*Cheapest test:* a rule. No feature ships unless it blocks a **named** prospect, and the name goes
in the commit message.

**5. Tech Provider approval fails or stalls for a solo Austrian entity.** The whole BYO onboarding
plan depends on it and nobody verified how hard it is to get solo.
*Cheapest test:* apply this week. Two days. If it stalls you know in week two, and the fallback is
the capped concierge tier.

**6. term-in.app takes the DACH-Turkish segment first.** €29, German and Turkish shipped, salons
and barbers named, 14-day trial, claims 250+ German cities.
*Cheapest test:* take their trial and book a Turkish appointment through it. An hour tells you
whether it resolves availability or just captures intent. If it resolves availability, your wedge
narrows to voice plus the loop and €79 gets harder to defend against €29.

**7. The credit-card step in Embedded Signup kills conversion.** It happens in Meta's UI, not yours.
*Cheapest test:* screen-share the first five signups and write down where they stop. Do not build a
self-serve funnel until you have watched five people fail at the assisted one.

**8. Callers refuse to talk to a bot.** Qualitative hostility on Hacker News, including someone who
now refuses contractors using AI receptionists. A JAMA Network Open study of roughly 1,300
participants found patients rated physicians as less competent and less trustworthy when AI use was
disclosed, **including for administrative tasks only**, and EU AI Act Article 50 forces that
disclosure from 2 August 2026. The survey numbers circulating on this were commissioned by a human
answering service, so do not use them.
*Cheapest test:* this is why WhatsApp leads and voice is the fallback. Measure hang-ups in the
first minute at your pilot and compare against the WhatsApp reply rate. If voice hang-ups exceed
30%, sell the WhatsApp product and keep voice as an after-hours net.

**9. KVKK cross-border transfer.** Turkey has issued **no adequacy decision for any country**
(kvkk.gov.tr). Every transfer needs a Board standard contract notified within 5 business days, and
your whole stack is offshore. Data-security fines run to ₺17,092,242 at 2026 rates.
*Cheapest test:* one hour of a Turkish lawyer on two questions. Does a vertical booking bot need
İYS registration (the statute enumerates email and SMS, not OTT messaging, and no researcher found
a Board decision placing WhatsApp in scope), and is a filled standard contract generated at signup
a defensible posture. Then build the PDF generator, which no competitor advertises.

**10. Retell's US-only processing blocks a German sale.** Their docs say they do not operate
services in the EU.
*Cheapest test:* mention it unprompted to your first three German prospects. If nobody cares, the
risk is theoretical. If one walks, Vapi's EU region is a two-week port on top of the seam.

**One structural warning about the evidence.** Section 3's complaint list comes from OMR and
Capterra, both of which run voucher-for-review programmes, so those are the complaints of customers
who **stayed**. Nobody could reach Reddit (crawler-banned), Trustpilot, G2, or X. The people who
ripped fonio out are not in this data. Treat every weakness in section 3 as a floor, not a ceiling.

---

## 10. The next two weeks

Do these in order. Do not start the next one until the previous is done.

**Week one**

1. Call +49 511 1665 3819. Listen to fonio's agent for five minutes. Take notes on what it does
   when you interrupt it and when you spell a name.
2. Buy one month of fonio voice and one of fonio WhatsApp, €178. Book by phone and watch whether
   any WhatsApp message follows. If a confirmation arrives, most of section 4 needs rewriting
   before you build anything.
3. Apply for Meta Tech Provider status. Business verification, privacy policy, app icon, two screen
   recordings. Budget two days, do not perfect it.
4. Start WABA setup and submit `randevu_onay` and `randevu_hatirlatma` on the pilot org. Long pole,
   waiting on Meta rather than on you.
5. Deploy, and set `RETELL_API_KEY` and `WA_APP_SECRET` on the prod deployment the same hour. Both
   guards fail open when their key is missing and both endpoints write appointments. Add
   `RETELL_API_KEY` to `.env.example` too. Half a day.
6. Spend one afternoon on the Turkish call test. Clippers running, ten names, ten phone numbers,
   count the errors, write the number down.

**Week two**

7. Fix the silent failures. Auto-create a customer on unknown inbound and unknown caller so the
   `messages.ts:235` guard stops swallowing them; write a visible row on every cal.com rejection and
   surface it in Settings → Bookings. This is the highest-value day of coding in the repo.
8. Turn on failure visibility. Add a `failedCount` query beside `attentionCount` in the sidebar, set
   `N8N_EMAIL_WEBHOOK_URL` and the pilot org's `emailFrom`, send yourself a real alert.
9. Fix the four correctness bugs: template language pinned to the org, both `take()` budgets in
   `reminders.ts`, the `if (!waAccount) return;` guard at `appointments.ts:130`, and the UTC day
   boundary in `check_availability`.
10. Run the end-to-end checklist by hand, on a real phone, start to finish. Write down every step
    that surprised you; that list is your onboarding script.
11. Two Saturdays of door-knocking in Vienna. Twenty conversations, three questions each, started in
    week two rather than after the code, because the answer decides whether the code matters. Close
    each one with "who else should I talk to" and count the names. That ratio is your only early
    read on whether this segment refers.

**Delete from `docs/product-spec.md` this week:** "full fonio.ai parity as the target," the
Evolution API branch-point instruction, the Calls tab, the public booking page. Each is a week you
do not have.

---

## 11. What we still do not know

Twelve research passes left these open. Ranked by how badly the gap hurts.

**Where customers 2 through 51 come from.** No channel, no cost per customer, no time budget for
selling. Door-knocking validates the segment; it does not scale to 51. *Test:* pick one channel and
run it two weeks. Try a barber-supply or salon-wholesale rep who already visits these shops weekly,
and the Turkish-language business owner groups on Facebook and WhatsApp in Vienna. Count replies.

**Whether fonio's voice-to-WhatsApp gap is real today.** *Test:* €178, one month of both products,
one phone booking, week one.

**fonio's WhatsApp attach rate**, which decides whether the €79 bundle is unmatchable or merely
cheap. *Test:* partner signup is free and instant. Sign up, ask a partner manager how many voice
customers also run the chatbot.

**What one salon costs you in support per month.** Nothing here models it, and at 51 customers it
binds before code does. *Test:* log every owner-initiated question at the pilot for 30 days, in
minutes.

**Whether the segment has websites at all**, which the scrape onboarding assumes. *Test:* 30 Google
Maps listings, count the website links.

**Whether an Austrian entity can buy a Turkish inbound number**, and at what rate. All Turkish voice
pricing depends on it. *Test:* one support ticket each to Twilio and Telnyx.

**The Austrian WhatsApp rate** (inferred at €0.0142) and **Meta's AI-provider pricing policy**,
whose substance nobody retrieved. *Test:* send one Austrian utility template and read the billing
line; ask about the policy in the Tech Provider application thread.

**Whether the 250-recipient limit is per number or per portfolio.** *Test:* WhatsApp Manager shows
the real number on the pilot WABA.

**Whether Turkish-accented German actually breaks fonio.** Assumed here, never tested. *Test:* call
+49 511 1665 3819 and book in accented German, twice, with two different Turkish names.
