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
          "Open resepta.xyz and choose Start with Google.",
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
          "Add any customer information fields the voice agent should collect.",
          "Ask your Resepta operator to connect scheduling, phone, WhatsApp, or email accounts that your setup needs.",
          "Create the voice agent, assign an available line, and make a test call.",
          "Review the default confirmation and reminder rules before going live.",
        ],
        note: "Resepta can store appointments without an external calendar, but conflict checking requires a connected scheduling account.",
        keywords: ["setup", "onboarding", "checklist", "go live"],
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
        title: "Add services and team members",
        summary: "Create the bookable work that appears in appointments and voice-agent conversations.",
        steps: [
          "Open Services from the sidebar.",
          "Add each service with a clear name and duration.",
          "Open Business and add your team, marking the people customers can book.",
          "Archive a team member when they should stop appearing in new bookings. Archive before deleting so historic appointments stay understandable.",
        ],
        keywords: ["service", "duration", "team", "staff", "bookable"],
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
      {
        id: "scheduling",
        title: "Connect scheduling and availability",
        summary: "Use a connected scheduling account when the agent must check real availability and prevent collisions.",
        steps: [
          "Ask your Resepta operator to connect your scheduling account and event type.",
          "Make sure every service duration you offer is allowed by that event type.",
          "Disable duplicate attendee emails in the scheduling tool when Resepta owns confirmations and reminders.",
          "Test creating, moving, and cancelling one appointment before opening the phone line to customers.",
        ],
        note: "Without a connected scheduling account, manual and phone-created appointments still appear in Resepta, but double-booking protection is not available.",
        keywords: ["calendar", "cal.com", "availability", "double booking", "conflict"],
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
          "Open Calendar and choose the view that matches the work you are doing.",
          "Select an empty time or use the new-appointment action to add a booking manually.",
          "Choose the customer, service, team member, date, and duration.",
          "Move, resize, complete, cancel, or mark the appointment as a no-show as the day changes.",
        ],
        keywords: ["appointment", "calendar", "walk in", "reschedule", "cancel", "no show"],
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
          "Open Messages. New workspaces begin with a confirmation and one 24-hour reminder.",
          "Add or open a rule, then choose its timing and WhatsApp, email, or both.",
          "Edit the wording and use the preview to check customer details and appointment tokens.",
          "Pause a rule when it should stop sending without deleting its setup.",
        ],
        keywords: ["reminder", "confirmation", "follow up", "win back", "rule", "timing"],
      },
      {
        id: "whatsapp",
        title: "Understand WhatsApp templates and languages",
        summary: "Business-initiated WhatsApp messages use approved templates in the customer’s language.",
        steps: [
          "Connect the business WhatsApp account with your Resepta operator.",
          "Register and approve the templates used for confirmations, reminders, cancellations, and campaigns.",
          "Keep a matching template for every customer language you serve.",
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
          "Open Inbox to work with WhatsApp and email replies in the same customer context.",
          "Reply from the connected channel and use the attention marker to find conversations that still need someone.",
          "Open Campaigns when a WhatsApp number is connected and choose an approved template for outreach.",
          "Review send outcomes on the customer timeline instead of treating the campaign as a separate list.",
        ],
        keywords: ["inbox", "reply", "campaign", "email", "conversation", "failed"],
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
          "Double booking: confirm that scheduling is connected and the service duration exists in the external event type.",
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
