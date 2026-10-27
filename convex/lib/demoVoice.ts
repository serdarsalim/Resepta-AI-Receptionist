// The showroom's phone agents (Real Estate Co., the public demo).
//
// The demo org holds no provider credentials, so every voice surface that
// normally reads the provider (the roster, the agent page, its version
// history, a test's ring-time values) answers from this file instead, and the
// rows that normally arrive by webhook (calls, test results, reviews) are
// seeded from it by devSeed. Nothing here is ever sent anywhere.
//
// Agent ids carry the org id: retellAgents.by_agent is how the webhook finds
// an org, so two demo orgs must never share one.
//
// Numbers are Ofcom's drama range (+44 20 7946 0xxx), reserved for fiction,
// so a seeded line can never be a real business's phone.

import type { Id } from "../_generated/dataModel";

export type DemoAgentKey = "frontDesk" | "followUp";

export const DEMO_INBOUND_LINE = "+442079460123";
export const DEMO_OUTBOUND_LINE = "+442079460456";

export function demoAgentId(orgId: Id<"orgs"> | string, key: DemoAgentKey): string {
  return `agent_demo_${key === "frontDesk" ? "frontdesk" : "followup"}_${orgId}`;
}

// Which fixture an id belongs to, or null when it is not a demo agent of
// this org.
export function demoAgentKeyOf(
  orgId: Id<"orgs"> | string,
  agentId: string,
): DemoAgentKey | null {
  if (agentId === demoAgentId(orgId, "frontDesk")) return "frontDesk";
  if (agentId === demoAgentId(orgId, "followUp")) return "followUp";
  return null;
}

export const DEMO_VOICES = [
  { id: "demo-voice-ellie", name: "Ellie", gender: "female", accent: "British", previewUrl: null },
  { id: "demo-voice-sam", name: "Sam", gender: "male", accent: "British", previewUrl: null },
  { id: "demo-voice-grace", name: "Grace", gender: "female", accent: "American", previewUrl: null },
];

type DemoAgent = {
  name: string;
  persona: string;
  voiceId: string;
  version: number;
  collects: string[];
  openers: { cold?: string; followUp?: string; missed?: string; inbound?: string };
  beginMessage: string;
  prompt: string;
  versions: { title: string; description: string; daysAgo: number }[];
};

const FRONT_DESK_PROMPT = `## Who you are
You are {{agent_name}}, the voice on the front desk at {{business_name}}, an estate agency in London. You answer every call to the office. Callers are buyers, renters, landlords and people thinking of selling.

## What you know before the call
- Today is {{now}} (London time).
- Caller: {{customer_name}}. Their next booking with us: {{next_appointment}}.
- What we already have on file: {{information}}

## What you do
1. Find out what they're after: buying, renting, selling or letting.
2. Buyers and renters: ask the area, budget and number of bedrooms. Then offer a viewing on a listed property, or a call back from a negotiator if nothing fits yet.
3. Sellers and landlords: offer a free market valuation at the property. Ask for the postcode.
4. Book with check_availability, then book_appointment. Read the time back once before you book it.
5. Existing booking? Use find_appointment, then reschedule or cancel if they ask.

## How you speak
- Short sentences. One question at a time.
- British English. Prices in pounds, said the way people say them: "four-fifty", not "four hundred and fifty thousand pounds".
- Never guess a price, a fee or whether an offer will be accepted. Say a negotiator will call them back and use escalate_to_staff.
- Don't read out the listing description. Give the two or three facts they asked for.

## Never
- Never confirm a viewing you haven't booked with the tool.
- Never take card details or a holding deposit on the phone.
- If they ask to stop being called, say you'll make a note of it, and do.`;

const FOLLOW_UP_PROMPT = `## Who you are
You are {{agent_name}} from {{business_name}}. You ring people the day after a viewing, and people who asked for a valuation but never booked one.

## What you know before the call
- Today is {{now}} (London time).
- You're calling {{customer_name}}. Their last booking: {{last_appointment}}.
- What we already have on file: {{information}}

## The call
1. Open with {{opener}}. Then check it's a good time. If not, ask when to ring back and end politely.
2. After a viewing: ask what they thought. If they liked it, offer a second viewing or a call from the negotiator about an offer. If not, ask what was missing and note it.
3. Valuation leads: offer two times this week with check_availability and book the one they pick.
4. Keep it under three minutes.

## How you speak
- Warm and brief. You are following up, not selling.
- If they're no longer looking, thank them and stop. Don't push.

## Never
- Never discuss offers, other bidders or the seller's position.
- If they say "don't call me again", agree, end the call, and that's that.`;

export const DEMO_AGENTS: Record<DemoAgentKey, DemoAgent> = {
  frontDesk: {
    name: "Front desk",
    persona: "Ellie",
    voiceId: "demo-voice-ellie",
    version: 7,
    collects: ["area", "budget", "bedrooms", "buyer_type"],
    openers: {
      inbound: "Real Estate Co., Ellie speaking. How can I help?",
      followUp: "Hi {{customer_first_name}}, it's Ellie from Real Estate Co. again.",
      cold: "Hi, it's Ellie calling from Real Estate Co.",
    },
    beginMessage: "{{opener}}",
    prompt: FRONT_DESK_PROMPT,
    versions: [
      { title: "Valuations ask for the postcode", description: "Agents kept driving to the wrong street.", daysAgo: 1 },
      { title: "Prices said the way people say them", description: "", daysAgo: 4 },
      { title: "Hand off price questions to a negotiator", description: "It was guessing asking prices.", daysAgo: 9 },
      { title: "Shorter answers about listings", description: "", daysAgo: 14 },
      { title: "Added rentals", description: "Lettings team joined.", daysAgo: 22 },
      { title: "Booking tools on", description: "", daysAgo: 30 },
      { title: "First version", description: "", daysAgo: 35 },
    ],
  },
  followUp: {
    name: "Viewing follow-up",
    persona: "Sam",
    voiceId: "demo-voice-sam",
    version: 4,
    collects: ["viewing_feedback", "interest_level", "budget"],
    openers: {
      followUp: "Hi {{customer_first_name}}, it's Sam from Real Estate Co. You came to see a flat with us yesterday.",
      missed: "Hi {{customer_first_name}}, it's Sam from Real Estate Co. I tried you earlier.",
      cold: "Hi {{customer_first_name}}, it's Sam calling from Real Estate Co.",
    },
    beginMessage: "{{opener}}",
    prompt: FOLLOW_UP_PROMPT,
    versions: [
      { title: "Stop when they're no longer looking", description: "", daysAgo: 3 },
      { title: "Valuation leads added", description: "", daysAgo: 11 },
      { title: "Three-minute cap", description: "", daysAgo: 19 },
      { title: "First version", description: "", daysAgo: 26 },
    ],
  },
};

// What each agent collects, as the agent page's variables table shows it.
export function demoVariableItems(key: DemoAgentKey) {
  const all = {
    area: {
      key: "area",
      label: "Area",
      description: "The neighbourhood or postcode they want to live in.",
      type: "string" as const,
    },
    budget: {
      key: "budget",
      label: "Budget",
      description: "Their top price, or monthly rent for renters.",
      type: "string" as const,
    },
    bedrooms: {
      key: "bedrooms",
      label: "Bedrooms",
      description: "How many bedrooms they need.",
      type: "number" as const,
    },
    buyer_type: {
      key: "buyer_type",
      label: "Looking to",
      description: "What they want to do.",
      type: "enum" as const,
      choices: ["Buy", "Rent", "Sell", "Let"],
    },
    viewing_feedback: {
      key: "viewing_feedback",
      label: "Viewing feedback",
      description: "What they thought of the property, in a sentence.",
      type: "string" as const,
    },
    interest_level: {
      key: "interest_level",
      label: "Interest",
      description: "How keen they are after the viewing.",
      type: "enum" as const,
      choices: ["Wants to offer", "Second viewing", "Still looking", "Not interested"],
    },
  };
  return DEMO_AGENTS[key].collects.map((name) => {
    const row = all[name as keyof typeof all];
    return {
      ...row,
      required: false,
      beforeSource: "none" as const,
      duringMode: "if_missing" as const,
      afterCall: true,
      destination: "call" as const,
    };
  });
}

// ── Seeded calls ────────────────────────────────────────────────────────────

export type DemoCall = {
  agent: DemoAgentKey;
  direction: "inbound" | "outbound";
  // Index into devSeed's customer list.
  customer: number;
  minutesAgo: number;
  durationSec: number;
  // Retell's call_successful, stored as the string.
  successful: boolean;
  disconnectionReason: string;
  summary: string;
  transcript?: string;
  collected?: Record<string, string | number>;
  review?: { verdict: "pass" | "miss"; note: string; action?: string; done?: boolean };
};

export const DEMO_CALLS: DemoCall[] = [
  {
    agent: "frontDesk",
    direction: "inbound",
    customer: 0,
    minutesAgo: 12,
    durationSec: 148,
    successful: true,
    disconnectionReason: "user_hangup",
    summary:
      "Emily wants to buy a two-bed flat in Islington, up to £650k. Booked a viewing at 14 Canonbury Grove on Saturday at 11:00.",
    transcript: `Agent: Real Estate Co., Ellie speaking. How can I help?
User: Hi, I saw the flat on Canonbury Grove online. Is it still available?
Agent: It is. Are you looking to buy?
User: Yes. Two bedrooms, Islington or close to it.
Agent: Lovely. And what's your top budget?
User: Six-fifty, maybe a little over for the right place.
Agent: Canonbury Grove is on at six-twenty-five, so that fits. Would you like to see it?
User: Yes please. Saturday if you can.
Agent: I have Saturday at eleven or at two. Which suits you?
User: Eleven.
Agent: Saturday at eleven at 14 Canonbury Grove. Shall I book that?
User: Yes.
Agent: Done. You'll get a WhatsApp confirmation in a minute. Anything else?
User: No, that's great. Thanks.`,
    collected: { area: "Islington", budget: "£650k", bedrooms: 2, buyer_type: "Buy" },
    review: { verdict: "pass", note: "Exactly right. Qualified her in four questions and booked." },
  },
  {
    agent: "frontDesk",
    direction: "inbound",
    customer: 5,
    minutesAgo: 95,
    durationSec: 211,
    successful: true,
    disconnectionReason: "agent_hangup",
    summary:
      "Daniel owns a three-bed house in Walthamstow and is thinking of selling. Booked a free valuation on Thursday at 17:30.",
    transcript: `Agent: Real Estate Co., Ellie speaking. How can I help?
User: Hi. I'm thinking about selling my house and wanted to know what it's worth.
Agent: We can do a free valuation at the property. What's the postcode?
User: E17 4PL.
Agent: Thanks. How many bedrooms?
User: Three. And a garden.
Agent: When suits you for one of our agents to come round? I have Thursday at half five, or Friday morning.
User: Thursday's good.
Agent: Thursday at five-thirty, E17 4PL. Booked. Is there anything you'd like the agent to know before they come?
User: The loft's been converted. Does that change much?
Agent: It can. The agent will look at it on the day and talk you through it.
User: Great, thanks.`,
    collected: { area: "Walthamstow, E17 4PL", bedrooms: 3, buyer_type: "Sell" },
  },
  {
    agent: "frontDesk",
    direction: "inbound",
    customer: 10,
    minutesAgo: 60 * 5,
    durationSec: 96,
    successful: false,
    disconnectionReason: "user_hangup",
    summary:
      "Leo asked what the seller would accept on the Bow flat. The agent gave a guess instead of passing him to a negotiator.",
    transcript: `Agent: Real Estate Co., Ellie speaking. How can I help?
User: Hi, the flat on Roman Road, would the owner take four-twenty?
Agent: It's listed at four-forty, so four-twenty might well be accepted.
User: Right. OK, I'll think about it.
Agent: Is there anything else I can help with?
User: No, thanks.`,
    collected: { area: "Bow", budget: "£420k", buyer_type: "Buy" },
    review: {
      verdict: "miss",
      // Open on purpose: the Notes tab opens on Misses, and a showroom whose
      // first view is empty shows nothing.
      note: "Never say what a seller might accept. Should have handed him to a negotiator.",
      action: "Added a rule: price questions go to a negotiator. Check the next few calls.",
    },
  },
  {
    agent: "frontDesk",
    direction: "inbound",
    customer: 15,
    minutesAgo: 60 * 26,
    durationSec: 174,
    successful: true,
    disconnectionReason: "user_hangup",
    summary:
      "Hannah is renting: one-bed in Hackney, up to £2,100 a month, from March. No listing fits yet, so a lettings negotiator will call her back.",
    transcript: `Agent: Real Estate Co., Ellie speaking. How can I help?
User: Hi, I'm looking for a one-bed to rent in Hackney.
Agent: Sure. What's your monthly budget?
User: Around two thousand. Twenty-one hundred at most.
Agent: And when would you like to move?
User: March.
Agent: We don't have anything listed in Hackney at that price right now. I can get one of our lettings team to call you as soon as something comes in. Would that help?
User: Yes, please.
Agent: Done. They'll call you on this number.`,
    collected: { area: "Hackney", budget: "£2,100 pcm", bedrooms: 1, buyer_type: "Rent" },
  },
  {
    agent: "followUp",
    direction: "outbound",
    customer: 3,
    minutesAgo: 40,
    durationSec: 132,
    successful: true,
    disconnectionReason: "agent_hangup",
    summary:
      "Amelia liked the Highbury flat but wants to see it again with her partner. Booked a second viewing on Sunday at 12:00.",
    transcript: `Agent: Hi Amelia, it's Sam from Real Estate Co. You came to see a flat with us yesterday. Is now a good time?
User: Yes, go on.
Agent: What did you think of it?
User: I loved the kitchen. The second bedroom's a bit small, but I want my partner to see it.
Agent: Of course. Would a second viewing on Sunday work? I have twelve or three.
User: Twelve is perfect.
Agent: Sunday at twelve, booked. You'll both get a confirmation on WhatsApp.
User: Thanks Sam.`,
    collected: {
      viewing_feedback: "Loved the kitchen, second bedroom small",
      interest_level: "Second viewing",
    },
    review: { verdict: "pass", note: "Good. Didn't oversell, got the second viewing." },
  },
  {
    agent: "followUp",
    direction: "outbound",
    customer: 8,
    minutesAgo: 60 * 3,
    durationSec: 22,
    successful: false,
    disconnectionReason: "voicemail_reached",
    summary: "Reached voicemail. Left a short message asking Grace to call back.",
  },
  {
    agent: "followUp",
    direction: "outbound",
    customer: 12,
    minutesAgo: 60 * 7,
    durationSec: 88,
    successful: true,
    disconnectionReason: "user_hangup",
    summary:
      "Lucas viewed the Stratford flat and isn't interested: too far from the station. Still looking in E15 and E20, budget £500k.",
    transcript: `Agent: Hi Lucas, it's Sam from Real Estate Co. You came to see a flat with us yesterday. Got a minute?
User: Yeah. It was nice, but honestly it's too far from the station.
Agent: Fair enough. Are you still looking around Stratford?
User: Yes. E15 or E20. Up to five hundred.
Agent: Noted. I'll pass that on so we only send you places closer to the station.
User: Great.`,
    collected: {
      viewing_feedback: "Too far from the station",
      interest_level: "Still looking",
      budget: "£500k",
    },
  },
  {
    agent: "followUp",
    direction: "outbound",
    customer: 17,
    minutesAgo: 60 * 28,
    durationSec: 74,
    successful: false,
    disconnectionReason: "user_hangup",
    summary:
      "Jack has already bought elsewhere. The agent kept offering other listings after he said he wasn't looking.",
    transcript: `Agent: Hi Jack, it's Sam from Real Estate Co. Is now a good time?
User: I'm not looking any more, we bought somewhere last week.
Agent: Congratulations! We also have a lovely two-bed in Leyton that just came on.
User: No, really, we're done. Thanks.
Agent: Of course. Well, if anything changes...
User: Bye.`,
    review: {
      verdict: "miss",
      note: "He said he'd bought. Should have thanked him and ended the call.",
      action: "Version 4: stop when they're no longer looking.",
    },
  },
];

// ── Seeded browser tests ────────────────────────────────────────────────────

export type DemoTest = {
  agent: DemoAgentKey;
  direction: "inbound" | "outbound";
  // Index into devSeed's customer list; undefined = a stranger.
  customer?: number;
  version: number;
  draft: boolean;
  hoursAgo: number;
  durationSec: number;
  successful: boolean;
  disconnectionReason: string;
  summary: string;
  // Speaker-prefixed lines, the way the Testing tab shows a finished test.
  transcript: string;
  collected?: Record<string, string | number>;
  actions?: { tool: string; detail: string; ok: boolean }[];
  review?: { verdict: "pass" | "miss"; note: string; action?: string; done?: boolean };
};

export const DEMO_TESTS: DemoTest[] = [
  {
    agent: "frontDesk",
    direction: "inbound",
    version: 7,
    draft: false,
    hoursAgo: 2,
    durationSec: 104,
    successful: true,
    disconnectionReason: "user_hangup",
    summary: "Seller asked for a valuation. The agent asked for the postcode first, then booked Friday at 10:00.",
    transcript: `Agent: Real Estate Co., Ellie speaking. How can I help?
User: Hi, I'd like to know what my flat is worth.
Agent: We can do a free valuation at the property. What's the postcode?
User: N16 8JH.
Agent: Thanks. How many bedrooms?
User: Two.
Agent: I have Friday at ten or Saturday at two. Which suits you?
User: Friday at ten.
Agent: Friday at ten, N16 8JH. That's booked. See you then.`,
    collected: { area: "N16 8JH", buyer_type: "Sell", bedrooms: 2 },
    actions: [
      { tool: "check_availability", detail: "Fri 10:00", ok: true },
      { tool: "book_appointment", detail: "Fri 10:00 · Market valuation", ok: true },
    ],
    review: { verdict: "pass", note: "Postcode asked up front now. Fixed." },
  },
  {
    agent: "frontDesk",
    direction: "inbound",
    customer: 2,
    version: 6,
    draft: false,
    hoursAgo: 30,
    durationSec: 141,
    successful: false,
    disconnectionReason: "user_hangup",
    summary: "Valuation booked without a postcode. The agent couldn't say where the visit was.",
    transcript: `Agent: Real Estate Co., Ellie speaking. How can I help?
User: Can someone come and value my house?
Agent: Of course. I have Thursday at four. Shall I book it?
User: Yes.
Agent: Booked for Thursday at four.
User: Don't you need my address?
Agent: The agent will be in touch before the visit.`,
    collected: { buyer_type: "Sell" },
    actions: [{ tool: "book_appointment", detail: "Thu 16:00 · Market valuation", ok: true }],
    review: {
      verdict: "miss",
      note: "No postcode, so the agent would turn up nowhere.",
      action: "Version 7 asks for the postcode before booking.",
      done: true,
    },
  },
  {
    agent: "frontDesk",
    direction: "inbound",
    version: 5,
    draft: false,
    hoursAgo: 80,
    durationSec: 63,
    successful: true,
    disconnectionReason: "user_hangup",
    summary: "Asked what the seller would accept. The agent said a negotiator would call back.",
    transcript: `Agent: Real Estate Co., Ellie speaking. How can I help?
User: The flat on Roman Road. Would they take four-twenty?
Agent: I can't speak for the seller, I'm afraid. One of our negotiators will call you back today to talk it through.
User: OK, fine.
Agent: They'll ring you on this number. Anything else?
User: No, thanks.`,
    actions: [{ tool: "escalate_to_staff", detail: "Price question", ok: true }],
    review: { verdict: "pass", note: "Handed off instead of guessing. Good." },
  },
  {
    agent: "frontDesk",
    direction: "inbound",
    customer: 6,
    version: 5,
    draft: false,
    hoursAgo: 150,
    durationSec: 118,
    successful: true,
    disconnectionReason: "user_hangup",
    summary: "Rescheduled a Saturday viewing to Sunday at 14:00.",
    transcript: `Agent: Hi Mia, Real Estate Co., Ellie speaking.
User: Hi, I need to move my viewing on Saturday.
Agent: I can see Saturday at eleven. When would suit you better?
User: Sunday afternoon?
Agent: Sunday at two is free. Shall I move it?
User: Yes please.
Agent: Done. Sunday at two.`,
    actions: [
      { tool: "find_appointment", detail: "Sat 11:00 · Property viewing", ok: true },
      { tool: "reschedule_appointment", detail: "Sun 14:00", ok: true },
    ],
  },
  {
    agent: "followUp",
    direction: "outbound",
    customer: 17,
    version: 4,
    draft: false,
    hoursAgo: 20,
    durationSec: 31,
    successful: true,
    disconnectionReason: "agent_hangup",
    summary: "Caller said they'd already bought. The agent thanked them and ended the call.",
    transcript: `Agent: Hi Jack, it's Sam from Real Estate Co. Is now a good time?
User: We're not looking any more, we bought last week.
Agent: Congratulations! Thanks for letting me know. Good luck with the move.
User: Thanks, bye.`,
    review: { verdict: "pass", note: "Stops when it should now." },
  },
  {
    agent: "followUp",
    direction: "outbound",
    customer: 3,
    version: 3,
    draft: false,
    hoursAgo: 75,
    durationSec: 96,
    successful: true,
    disconnectionReason: "agent_hangup",
    summary: "Liked the flat. Booked a second viewing on Sunday at 12:00.",
    transcript: `Agent: Hi Amelia, it's Sam from Real Estate Co. You came to see a flat with us yesterday.
User: Yes! I liked it.
Agent: Great to hear. Would you like a second viewing?
User: Yes, with my partner. Sunday?
Agent: Sunday at twelve is free. Booked.`,
    collected: { interest_level: "Second viewing" },
    actions: [{ tool: "book_appointment", detail: "Sun 12:00 · Second viewing", ok: true }],
  },
];

// The values a test would hand the agent, for the Testing tab's "What the
// agent knows" box.
export function demoTestVariables(
  orgName: string,
  key: DemoAgentKey,
  customer: { name: string; phone: string } | null,
  direction: "inbound" | "outbound",
): Record<string, string> {
  const agent = DEMO_AGENTS[key];
  const firstName = customer?.name.split(" ")[0] ?? "";
  const now = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const name = customer?.name ?? "";
  const opener =
    direction === "inbound"
      ? agent.openers.inbound ?? agent.openers.cold ?? ""
      : customer
        ? (agent.openers.followUp ?? agent.openers.cold ?? "").replace(
            "{{customer_first_name}}",
            firstName,
          )
        : (agent.openers.cold ?? "").replace("{{customer_first_name}}", "");
  return {
    opener,
    agent_name: agent.persona,
    business_name: orgName,
    now,
    customer_name: name,
    customer_first_name: firstName,
    customer_phone: customer?.phone ?? "",
    next_appointment: customer ? "Saturday 11:00, Property viewing" : "",
    last_appointment: customer ? "Yesterday 18:00, Property viewing" : "",
    information: customer ? "Looking to buy · 2 bedrooms · Islington" : "",
  };
}

// A seeded test's callId names its fixture: devSeed writes
// `demo-test-<orgId>-<index>`.
export function demoTestByCallId(orgId: Id<"orgs"> | string, callId: string): DemoTest | null {
  const prefix = `demo-test-${orgId}-`;
  if (!callId.startsWith(prefix)) return null;
  return DEMO_TESTS[Number(callId.slice(prefix.length))] ?? null;
}
