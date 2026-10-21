"use client";

import { useMemo, useState } from "react";

type Article = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  note?: string;
  keywords: string[];
};

type Category = {
  id: string;
  title: string;
  description: string;
  articles: Article[];
};

const CATEGORIES: Category[] = [
  {
    id: "start",
    title: "Start here",
    description: "Set up the business basics and understand what Resepta connects.",
    articles: [
      {
        id: "create-workspace",
        title: "Create your Resepta workspace",
        summary: "Sign in with Google and give the workspace your business name.",
        steps: [
          "Open app.resepta.xyz and choose Continue with Google.",
          "Use the Google account that should own the business workspace.",
          "Enter the business name when Resepta asks for it. You can update the business details later under Business.",
        ],
        keywords: ["sign in", "google", "account", "workspace", "business name"],
      },
      {
        id: "setup-order",
        title: "Recommended setup order",
        summary: "A short path from a new workspace to the first connected appointment.",
        steps: [
          "Add the services customers can book and the team members who deliver them.",
          "Set your opening hours and mark the team members who take appointments as Available.",
          "Add any customer information fields the voice agent should collect.",
          "Ask your Resepta operator to connect the phone line, WhatsApp number or email your setup needs.",
          "Create the voice agent, assign an available line, and make a test call.",
          "Review the default confirmation and reminder rules before going live.",
        ],
        note: "Bookings from your booking page, the phone agent and the WhatsApp assistant are checked against your opening hours and the number of team members marked Available, so set both before customers start booking.",
        keywords: ["setup", "onboarding", "checklist", "go live", "opening hours"],
      },
    ],
  },
  {
    id: "business",
    title: "Business setup",
    description: "Tell Resepta what you offer, who can be booked, and what you need to know about customers.",
    articles: [
      {
        id: "services-team",
        title: "Add services, products and team members",
        summary: "Create the bookable work that appears in appointments and voice-agent conversations.",
        steps: [
          "Open Business and use Add service. Give each one a clear name and duration.",
          "For something you sell rather than book time for, such as a shampoo or a gift box, set Type to Product. It takes no time on the calendar and gets its own card in Business and its own group on your booking page.",
          "Prices are optional. Leave one blank while you decide; a blank price is different from a price of zero.",
          "Prices are written without decimals unless you ask for them; the switch sits beside Currency in Business. A price that genuinely has kuruş always shows them.",
          "Add your team on the same page, marking the people customers can book.",
          "Archive a team member when they should stop appearing in new bookings. Archive before deleting so historic appointments stay understandable.",
        ],
        keywords: [
          "service",
          "product",
          "duration",
          "price",
          "decimals",
          "team",
          "staff",
          "bookable",
        ],
      },
      {
        id: "customer-fields",
        title: "Choose the customer details Resepta keeps",
        summary: "Add fields such as preferences, notes, or identifiers and decide how they can be filled.",
        steps: [
          "Open Voice agent from the sidebar and choose Contact fields.",
          "Create a field with a name, type, and choices where needed.",
          "Choose whether staff, the voice agent, or both may fill it.",
          "Use the Customers table Columns menu to show the fields that matter for day-to-day work.",
        ],
        note: "A field used by a published voice agent keeps its internal key even if you later rename its label. This protects previously collected answers.",
        keywords: ["customer field", "custom field", "columns", "variables", "information"],
      },
      // What is checked lives in its own steps and who is checked in the last
      // one, so the day the calendar checks staff entries too, that one step
      // is the edit (docs/journal/2026-10.md, P2c).
      {
        id: "double-booking",
        title: "How double bookings are prevented",
        summary: "What Resepta checks before a booking is made, and where you still need to look yourself.",
        steps: [
          "Set your opening hours in Business, on the Hours tab, under Days you're open. Without them your booking page asks customers to call or message you instead, and the assistants can book any time of day.",
          "Add lunch breaks, holidays and other closed times in Calendar: select the time, then choose Blocked time.",
          "Mark each team member who takes appointments as Available in Business, on the Team tab. Resepta counts them: with two people available, two appointments can overlap, and a third at the same time is refused.",
          "Every booking made on your booking page, by the phone agent or by the WhatsApp assistant is checked against your opening hours, your blocked times, how many team members are available, and the customer's other appointments. Moves made by the assistants, or by the customer from their appointment link, are checked the same way.",
          "When a time is taken, the phone agent and the WhatsApp assistant offer the nearest free times instead.",
          "Appointments your team adds or moves in the calendar are checked the same way, and against the team member picked. The booking sheet says whether the time is free as you pick it. If it is not, Resepta asks before booking it anyway, and dragging a booking onto a taken time asks too.",
        ],
        note: "Bookings from your booking page and the assistants are not given to a named team member. Decide who takes each one when you plan the day.",
        keywords: [
          "double booking",
          "conflict",
          "availability",
          "capacity",
          "opening hours",
          "blocked time",
          "closed",
          "available",
          "calendar",
        ],
      },
    ],
  },
  {
    id: "phone",
    title: "Voice agent",
    description: "Create the receptionist, shape the conversation, and review every call result.",
    articles: [
      {
        id: "create-agent",
        title: "Create or connect a voice agent",
        summary: "Start with a new Resepta receptionist or connect one that already exists.",
        steps: [
          "Open Voice agent and choose Add agent.",
          "Choose Create new, then select a name, language, and voice. Connect existing is available when an agent is already prepared for the business.",
          "Assign an available phone line if one has been provisioned for the workspace.",
          "Wait for setup to finish, then open the agent by selecting its name.",
        ],
        note: "Resepta can assign an available line, but phone-number purchasing and regulatory setup are completed outside the app.",
        keywords: ["phone", "voice", "agent", "line", "number", "create"],
      },
      {
        id: "agent-instructions",
        title: "Edit instructions, opening line, and voice",
        summary: "Control how the receptionist sounds and what it should do during a call.",
        steps: [
          "Open Voice agent, then select the agent name.",
          "Write the business instructions and the opening line in the order a real receptionist would use them.",
          "Insert customer or business variables with @ where the conversation needs them.",
          "Choose the voice and save once. Resepta publishes the voice and script together.",
        ],
        keywords: ["instructions", "prompt", "opening line", "voice", "publish"],
      },
      {
        id: "agent-openers",
        title: "Open each call with the right first sentence",
        summary: "Say something different to a first-time caller, someone you spoke to last week and someone you could not reach.",
        steps: [
          "Open the agent and put Opener in the opening line with @, where the changing part should be said.",
          "Fill the four sentences under it: when you have not spoken before, when you have spoken before, when you tried but did not speak, and when they call you.",
          "Use When in a sentence to say how long ago, for example \"we spoke yesterday\" or \"I tried you on Tuesday\".",
          "Save. The next call uses the new sentences; no new version is needed.",
        ],
        note: "A call only counts as spoken when the customer really talked to the agent. A missed call, voicemail or hang-up counts as a try.",
        keywords: ["opener", "first sentence", "greeting", "follow-up", "callback", "opening line"],
      },
      {
        id: "agent-variables",
        title: "Collect information during calls",
        summary: "Use variables to pass known context in, confirm details live, and save new answers.",
        steps: [
          "Open the agent and find Variables.",
          "Add the customer field the agent needs and describe the exact information to collect.",
          "Choose whether it is known before the call, confirmed during the call, recovered after the call, and where it should be stored.",
          "Save the agent so the updated variables and instructions become live together.",
        ],
        note: "Caller-confirmed information wins. After-call analysis fills missing information instead of overwriting a value the customer confirmed live.",
        keywords: ["variable", "collect", "call", "customer details", "before", "during", "after"],
      },
      {
        id: "review-calls",
        title: "Review calls and fix missing results",
        summary: "Read the recording, summary, transcript, collected values, and end reason in one place.",
        steps: [
          "Open Voice agent and switch to Calls.",
          "Open a call to see its recording, summary, collected values, transcript, and why it ended.",
          "Open the same call from the customer activity history when you need the surrounding context.",
          "If Resepta reports that call results are not arriving, open the agent and choose Fix, then place another test call.",
        ],
        keywords: ["calls", "recording", "transcript", "summary", "fix", "webhook"],
      },
    ],
  },
  {
    id: "work",
    title: "Appointments and customers",
    description: "Keep the working day and each customer’s history in one shared record.",
    articles: [
      {
        id: "appointments",
        title: "Create and manage appointments",
        summary: "Add walk-ins or phone bookings and work from day, week, month, year, or list views.",
        steps: [
          "Open Calendar and choose the view that matches the work you are doing. The panel on the left jumps to any date and shows or hides each team member and service. The menu button above it folds the panel away.",
          "Select an empty time to add a booking. In Day view each team member has a column, and a time selected in someone's column books them.",
          "Choose the customer, service, team member, date, and start and end times.",
          "Each team member's bookings wear their own color. To change it, open Business, go to the Team tab and select the dot before their name.",
          "Move, resize, complete, cancel, or mark the appointment as a no-show as the day changes.",
          "An appointment whose start time has already passed, such as yesterday's walk-in, is kept as a record. The customer gets no confirmation for it, and cancelling it later sends no cancellation notice.",
        ],
        keywords: ["appointment", "calendar", "walk in", "reschedule", "cancel", "no show", "colour", "color", "filter", "team"],
      },
      {
        id: "booking-page",
        title: "Share your online booking page",
        summary:
          "One link customers open to pick what they want, choose a time, and book themselves in.",
        steps: [
          "Open Business and switch Taking bookings on. The link appears beside the switch with a Copy button. Put it in your Instagram bio, your WhatsApp profile, or on a card.",
          "The address comes from your business name, so renaming the business renames the link. The old one stops opening, so update it wherever you have shared it.",
          "Customers can choose more than one thing at once. A haircut and a beard trim arrive as one appointment on your calendar, with the times added together.",
          "Anything you sell without booking time for it, such as a shampoo or a gift box, appears under Products, with a quantity picker instead of a duration.",
          "Set your opening hours first. Without them the page tells customers to call you instead of showing times it cannot honestly offer.",
          "Customers can leave a note when they book. It lands on their customer record, so you read it in the same place as everything else about them.",
          "Customers pick a day from a month where every day with a free time is filled in, then a time from that day's list. Someone abroad can switch the time zone to read the times on their own clock; the appointment is the same either way.",
          "Your address from Business shows beside the time, on the confirmation and on the customer's appointment page.",
          "To link your own terms and privacy pages, fill in Terms and privacy under the booking switch. The page then says, above the Book button, that booking agrees to them.",
          "To show the page on your own website, select the code button beside Copy and paste what it copies into your website where the calendar should go. It opens in your website's language when that is Turkish, English or German.",
        ],
        note: "The page shows the times that are genuinely free, using your opening hours and how many people are on the roster. Bookings need at least your minimum notice, set under Business: an hour unless you change it.",
        keywords: [
          "booking page",
          "online booking",
          "link",
          "share",
          "self service",
          "products",
          "note",
          "embed",
          "website",
          "time zone",
          "terms",
          "privacy",
        ],
      },
      {
        id: "customers",
        title: "Work with customer records",
        summary: "See contact details, appointments, messages, calls, and custom information together.",
        steps: [
          "Open Customers and search by name, phone number, email, or a visible custom field.",
          "Use Columns to keep the table focused on the information your team uses most.",
          "Open a customer to review appointments, calls, WhatsApp, email, and notes in context.",
          "Keep phone numbers and email addresses unique so new messages land on the correct person.",
        ],
        keywords: ["customer", "contact", "history", "phone", "email", "search"],
      },
      {
        id: "delete-customer",
        title: "Delete a customer",
        summary:
          "Erase a customer and everything held on them, for example when they ask you to under KVKK.",
        steps: [
          "Open their record, choose ⋯ at the top right of the record, then Delete customer. Only the business owner sees this.",
          "The confirmation lists what goes with them: appointments, messages, calls, notes and assistant replies. Choose Delete permanently to erase it all.",
          "Their record leaves every list and search at once, and anything still waiting to be sent to them is cancelled. Nothing is sent to the customer about it.",
        ],
        note: "Deleting cannot be undone. Copies kept by the phone, WhatsApp and email services are not touched.",
        keywords: ["delete", "erase", "remove", "privacy", "kvkk", "gdpr", "data request", "forget"],
      },
      {
        id: "no-ai-calls",
        title: "When a customer asks not to be called by the AI",
        summary: "Stop AI calls to one customer and keep their reminders and messages going.",
        steps: [
          "Turn on No AI calls at the bottom of their record. Bulk call runs skip them, and their reminders and messages keep going.",
          "A phone agent with its latest update turns No AI calls on by itself when a caller asks for it on a call. Only someone on your team can turn it off.",
          "To call a customer who asked for no AI calls, use Place call on their record and choose Call anyway. Do that only when they agreed to the call.",
        ],
        keywords: ["do not call", "no ai calls", "call anyway", "robot", "opt out", "bulk call"],
      },
      {
        id: "callbacks",
        title: "When a caller asks to be called back",
        summary: "The phone agent calls a customer back once, at the time they asked for on a call.",
        steps: [
          "When a customer on a call asks to be called back at a day and time, an agent with its latest update notes the time. Nothing is booked for a vague \"call me later\".",
          "The customer's record shows the callback as Queued at the top of the Calls tab: when it rings, which agent rings, and the call it was asked on.",
          "It rings once, during your opening hours. A time when you are closed moves to your next open hour, and the card says so. Customers without consent or with No AI calls are never called back.",
          "If you talk to them before then, or call them yourself, the callback is cancelled. Press Cancel on the card to stop it by hand.",
          "The call they asked on reads \"Asked to be called back\", and the callback's own call says it was the callback they asked for.",
        ],
        keywords: ["callback", "call back", "call me later", "queued", "requested call", "ring back"],
      },
      {
        id: "bulk-calls",
        title: "Call a list of customers",
        summary: "Let the phone agent call the customers you tick, one at a time, while you are open.",
        steps: [
          "In Customers, tick the people to call, choose Call, pick the agent and confirm. Only customers who gave consent and did not ask for No AI calls are included.",
          "Calls ring one at a time and only during your opening hours, with your blocked time left out. A list started after closing waits and begins when you open. Without opening hours, calls ring during your message sending hours, 09:00 to 21:00 unless they were changed.",
          "When a customer's turn comes, they are skipped if they already have an appointment coming up or have already had a call with you that day.",
          "If no phone line is free at that moment, the customer goes back in line and is tried again a few minutes later. They are not counted as called.",
          "Open the Bulk tab in Customers to follow a list. Each person shows what happened: how long you talked, voicemail, busy, declined, no answer, refused by the network, or why they were skipped. Pause or stop the list there.",
        ],
        keywords: ["bulk call", "call list", "call customers", "outbound", "opening hours", "voicemail", "skipped", "busy"],
      },
      {
        id: "unsubscribe",
        title: "Marketing email and unsubscribing",
        summary: "Customers can stop your campaign, bulk and win-back emails with one link.",
        steps: [
          "Campaign, bulk and win-back emails end with an unsubscribe link. When a customer uses it, Unsubscribed turns on at the bottom of their record and those emails stop for them.",
          "Confirmations, reminders and WhatsApp messages keep going.",
          "If a customer asks you in person to stop marketing emails, turn on Unsubscribed yourself. Turn it off only if they ask to get those emails again; Resepta asks you to confirm.",
        ],
        keywords: ["unsubscribe", "marketing email", "opt out", "newsletter", "campaign", "win back"],
      },
    ],
  },
  {
    id: "messages",
    title: "Messages and reminders",
    description: "Confirm bookings, remind customers, follow up, and keep replies in the Inbox.",
    articles: [
      {
        id: "rules",
        title: "Set confirmation and reminder rules",
        summary: "Choose when each message runs, which channel it uses, and what it says.",
        steps: [
          "Open Automations. A new business starts with five messages switched on: a confirmation when an appointment is booked, reminders 24 hours and 2 hours before it, a cancellation notice, and a win-back message 14 days after a no-show.",
          "An away reply for messages that arrive while you are closed is there too, switched off until you turn it on.",
          "Add or open a rule, then choose its timing and WhatsApp, email, or both.",
          "Edit the wording and use the preview to check customer details and appointment tokens.",
          "Pause a rule when it should stop sending without deleting its setup.",
        ],
        keywords: [
          "reminder",
          "confirmation",
          "cancellation",
          "follow up",
          "win back",
          "away reply",
          "rule",
          "timing",
          "automations",
        ],
      },
      {
        id: "whatsapp",
        title: "Understand WhatsApp templates and languages",
        summary: "Business-initiated WhatsApp messages use approved templates in the customer’s language.",
        steps: [
          "Connect the business WhatsApp account with your Resepta operator.",
          "Register and approve the templates used for confirmations, reminders, cancellations, and campaigns.",
          "Keep a matching template for every customer language you serve.",
          "A customer's language is the business language until they write or speak in another. Their own WhatsApp reply or an answered call sets it when the business has templates in that language, and you can change it on the customer record under Language.",
          "Check failed messages in the customer conversation when a template is missing or rejected.",
        ],
        note: "Resepta does not send a template in the wrong language as a fallback. A missing language fails visibly so the customer never receives misleading copy.",
        keywords: ["whatsapp", "meta", "template", "language", "approval"],
      },
      {
        id: "inbox-campaigns",
        title: "Use the Inbox and campaigns",
        summary: "Continue customer conversations and send approved outreach without losing the customer record.",
        steps: [
          "Open Inbox to see every conversation, newest first. Each row shows the channel it happened on and the last thing that was said.",
          "A ✕ on a row means that message could not be sent. Open the conversation to see why and send it again.",
          "On a call, an arrow says which way it went: up and to the right means you called them, down and to the left means they called you.",
          "Click a conversation to open that customer's record, with the thread already on the channel their last message came in on.",
          "All, Unread and Pinned choose what the list shows. A conversation you open from Unread stays there without its dot until you pick another filter or leave the Inbox.",
          "Right-click a conversation, or the small arrow at the end of its last line, to pin it, mark it as read or unread, mute it or open the customer. Marking as unread only changes your own Inbox, not your colleagues'.",
          "Right-click a WhatsApp message, or the small arrow in its corner, to reply to it, copy it, react to it or save it as a note on the customer. Reactions reach the customer only on a connected WhatsApp Business number, so the shop phone does not offer them.",
          "To email a customer, open their Email tab and click Compose, or Reply on one of their emails. The email opens in a window at the bottom right that you can shrink or enlarge while you keep using the page. Closing it keeps what you wrote on this computer until you send it or delete it with the bin.",
          "After you click Send you have ten seconds to click Undo at the bottom left. The arrow beside Send schedules the email for later instead; a scheduled email waits in the customer's Email tab, where Cancel stops it.",
          "Use the pen on the email window's bar to add a signature. Each person keeps their own, only for themselves or shared with the team, and the star chooses the one your emails start with.",
          "Reply from the connected channel and use the attention marker to find conversations that still need someone.",
          "Open Automations when a WhatsApp number is connected. Campaigns live at the foot of that page; choose an approved template for outreach.",
          "Review send outcomes on the customer timeline instead of treating the campaign as a separate list.",
        ],
        keywords: ["inbox", "reply", "campaign", "email", "conversation", "failed", "unread", "pin", "mute", "react", "copy", "note", "compose", "undo send", "schedule send", "draft", "signature"],
      },
    ],
  },
  {
    id: "assistants",
    title: "What the assistants may change",
    description: "How the phone agent and the WhatsApp assistant handle bookings, and what waits for you.",
    articles: [
      {
        id: "assistant-own-appointments",
        title: "The assistants act only for the person they are talking to",
        summary:
          "The phone agent and the WhatsApp assistant book, move and cancel appointments only for that customer, and only their own.",
        steps: [
          "The phone agent knows the caller by the number they are calling from, and the WhatsApp assistant knows the customer by their chat. Neither acts on a phone number someone reads out or types, so nobody can reach another person's appointments by quoting their number.",
          "If a call shows no number, for example a hidden caller ID, the phone agent books and changes nothing and asks the caller to ring back from their own phone with caller ID on.",
          "An assistant moves or cancels only that customer's own upcoming appointments. It names the appointment by its day, time and services, and asks which one when more than one could fit.",
          "A move is checked like a new booking: opening hours, blocked times, how many team members are available, and the customer's other appointments. When the time is taken, the assistant offers the nearest free times.",
          "Asking for the same booking twice makes one booking. The assistants and your booking page book nothing new for a customer who already has five upcoming appointments; your team can still add more in the calendar.",
        ],
        keywords: [
          "assistant",
          "phone agent",
          "whatsapp assistant",
          "caller",
          "hidden number",
          "own appointment",
          "reschedule",
          "cancel",
          "security",
        ],
      },
      {
        id: "suggested-replies",
        title: "Suggested replies change nothing until you send them",
        summary:
          "When the WhatsApp assistant suggests a reply, any booking, move or cancellation in it waits for you.",
        steps: [
          "If your business has the WhatsApp assistant, choose under Automations whether it Suggests or Answers. Any single chat can be set differently above its message box.",
          "In Suggests, the assistant writes a draft into the message box for each new message. Nothing is sent, and nothing in your calendar changes, until someone presses Send.",
          "When the draft would book, move or cancel an appointment, or save a detail to the customer's record, a line above the message box says what sending it will change.",
          "Choose × on that line to keep the words without the change. The message then goes out as an ordinary one.",
          "Sending makes all of the draft's changes or none of them. If the calendar changed in the meantime, for example the time was taken, nothing is sent and the message box says why.",
          "In Answers, the reply goes out by itself after a short countdown. Choose Stop in the message box to keep it as a draft instead.",
        ],
        keywords: ["suggest", "draft", "whatsapp assistant", "approve", "send", "ai reply", "answers", "countdown"],
      },
      {
        id: "change-limit",
        title: "The daily limit on changes",
        summary:
          "A customer can make six changes a day through the assistants or on their own. After that, your team takes over.",
        steps: [
          "Every booking, move or cancellation the phone agent or the WhatsApp assistant makes for a customer counts. So does every move or cancellation the customer makes from their appointment link, or by replying to cancel on WhatsApp.",
          "After six in 24 hours, the assistants stop booking, moving or cancelling for that customer and pass the request to your team. The phone agent tells the caller someone will be in touch and emails everyone with Failed message alerts on. The WhatsApp assistant hands the chat over the way your When a person is needed setting says.",
          "From their appointment link, the customer can no longer move the appointment that day and is asked to call you. Cancelling always works.",
          "Changes your team makes in the app never count and are never limited. The count looks back 24 hours, so it frees up by itself.",
        ],
        note: "The limit stops a customer, or a phone line stuck on repeat, from cancelling and rebooking over and over, with a new message going out each time.",
        keywords: ["limit", "six", "too many changes", "changes", "cancel", "reschedule", "rebook", "handover"],
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    description: "The fastest checks for the issues that can interrupt a booking or message.",
    articles: [
      {
        id: "common-problems",
        title: "Common problems and first checks",
        summary: "A compact checklist for availability, calls, messages, and sign-in.",
        steps: [
          "Double booking: check your opening hours and who is marked Available on the Team card. A booking someone chose to make anyway, after the calendar asked, is the other way it happens.",
          "No call result: open the voice agent, check its result health, choose Fix if offered, and place a fresh test call.",
          "WhatsApp failed: open the customer conversation and check that the exact language template is approved.",
          "Email failed: confirm the customer has an email address and ask your operator to verify the workspace email connection.",
          "Cannot sign in: use the Google account that belongs to the workspace. Resepta does not use password-based accounts.",
        ],
        keywords: ["problem", "error", "failed", "double booking", "sign in", "support"],
      },
    ],
  },
];

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="var(--logo)" />
      <path d="M18 20 32 32 18 44" stroke="white" strokeWidth="6.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M33 20 47 32 33 44" stroke="white" strokeWidth="6.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity=".6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function HelpCenter() {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const categories = useMemo(() => {
    if (!normalized) return CATEGORIES;
    return CATEGORIES.map((category) => ({
      ...category,
      articles: category.articles.filter((article) =>
        [article.title, article.summary, ...article.steps, article.note ?? "", ...article.keywords]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      ),
    })).filter((category) => category.articles.length > 0);
  }, [normalized]);

  const resultCount = categories.reduce((total, category) => total + category.articles.length, 0);

  // lang="en" because this page is English and nothing here goes through
  // i18n — every string below is written inline. The document tag says
  // whatever the visitor's own preference is (LanguageProvider sets it), so a
  // Turkish owner reading these guides would otherwise have a screen reader
  // pronouncing English prose with Turkish phonetics.
  return (
    <div lang="en" className="min-h-dvh bg-[var(--pane)] text-[var(--foreground)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_88%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <a href="https://docs.resepta.xyz" className="flex items-center gap-3">
            <Mark />
            <span className="text-lg font-bold tracking-tight">Resepta</span>
            <span className="hidden h-5 w-px bg-[var(--border)] sm:block" />
            <span className="hidden text-sm text-[var(--muted)] sm:block">Help Center</span>
          </a>
          <a href="https://resepta.xyz" className="rounded-lg bg-[var(--muted-bg)] px-3.5 py-2 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--brand-soft)]">
            Open Resepta <span aria-hidden>↗</span>
          </a>
        </div>
      </header>

      <section className="border-b border-[var(--border)] bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--brand)_16%,transparent),transparent_36%),radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--accent)_14%,transparent),transparent_34%),var(--background))]">
        <div className="mx-auto max-w-4xl px-5 py-16 text-center sm:px-8 sm:py-20">
          <h1 className="text-4xl font-bold tracking-[-0.045em] sm:text-5xl">How can we help?</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">Practical guides for setting up your AI front desk, managing the working day, and keeping every customer informed.</p>
          <label className="mx-auto mt-8 flex max-w-2xl items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 text-[var(--muted)] shadow-[0_18px_48px_color-mix(in_srgb,var(--foreground)_9%,transparent)] focus-within:border-[var(--brand)] focus-within:ring-4 focus-within:ring-[color-mix(in_srgb,var(--brand)_10%,transparent)]">
            <SearchIcon />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search setup, voice agent, reminders…" className="w-full border-0 bg-transparent p-0 text-base text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:ring-0" />
          </label>
          {normalized && <p className="mt-3 text-sm text-[var(--muted)]">{resultCount} {resultCount === 1 ? "guide" : "guides"} found</p>}
        </div>
      </section>

      <main className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:py-16">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible">
            {CATEGORIES.map((category) => <a key={category.id} href={`#${category.id}`} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-[var(--card)] hover:text-[var(--foreground)] lg:block">{category.title}</a>)}
          </nav>
          <div className="mt-8 hidden rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)] lg:block">
            <p className="font-semibold text-[var(--foreground)]">Still stuck?</p>
            <p className="mt-1 leading-relaxed">Open Resepta and share the exact screen, customer, call, or message involved with your operator.</p>
          </div>
        </aside>

        <div className="min-w-0 space-y-14">
          {categories.length ? categories.map((category) => (
            <section key={category.id} id={category.id} className="scroll-mt-28">
              <h2 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">{category.title}</h2>
              <p className="mt-2 max-w-2xl leading-relaxed text-[var(--muted)]">{category.description}</p>
              <div className="mt-6 grid gap-4">
                {category.articles.map((article) => (
                  <details key={article.id} id={article.id} className="group scroll-mt-28 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_6px_20px_color-mix(in_srgb,var(--foreground)_3.5%,transparent)] open:border-[color-mix(in_srgb,var(--brand)_42%,var(--border))] open:shadow-[0_12px_32px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-5 p-5 sm:p-6 [&::-webkit-details-marker]:hidden">
                      <span><span className="block text-lg font-semibold tracking-[-0.015em]">{article.title}</span><span className="mt-1.5 block leading-relaxed text-[var(--muted)]">{article.summary}</span></span>
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--muted-bg)] text-lg text-[var(--muted)] transition group-open:rotate-45 group-open:bg-[var(--brand-soft)] group-open:text-[var(--brand)]">+</span>
                    </summary>
                    <div className="border-t border-[var(--border)] px-5 pb-6 pt-5 sm:px-6">
                      <ol className="space-y-4">
                        {article.steps.map((step, index) => <li key={step} className="flex gap-3 text-[15px] leading-relaxed text-[var(--foreground)]"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]">{index + 1}</span><span>{step}</span></li>)}
                      </ol>
                      {article.note && <div className="mt-5 rounded-xl bg-[color-mix(in_srgb,#f59e0b_12%,var(--card))] px-4 py-3 text-sm leading-relaxed text-[var(--foreground)]"><strong>Good to know:</strong> {article.note}</div>}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )) : (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-10 text-center">
              <h2 className="text-xl font-semibold">No guide matched that search</h2>
              <p className="mt-2 text-[var(--muted)]">Try a shorter phrase such as “phone”, “calendar”, or “reminder”.</p>
              <button type="button" onClick={() => setQuery("")} className="mt-5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)]">Clear search</button>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-[var(--border)] bg-[var(--card)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5"><Mark /><span className="font-semibold text-[var(--foreground)]">Resepta</span></div>
          <nav className="flex flex-wrap gap-5"><a href="https://resepta.xyz/privacy" className="hover:text-[var(--foreground)]">Privacy</a><a href="https://resepta.xyz/terms" className="hover:text-[var(--foreground)]">Terms</a><a href="https://resepta.xyz" className="hover:text-[var(--foreground)]">Product</a></nav>
        </div>
      </footer>
    </div>
  );
}
