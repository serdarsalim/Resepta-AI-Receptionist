"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { OnboardingWizard } from "./OnboardingWizard";
import { HoverTip } from "./HoverTip";
import { useLanguage, useT } from "@/lib/LanguageProvider";
import { isLanguage, type TranslationKey } from "@/lib/i18n";
import { useTheme, type Theme } from "@/lib/theme";
import { DEFAULT_TITLE, workspaceTitle } from "@/lib/brand";
import { signOutDestination } from "@/lib/hosts";
import { OperatorBanner } from "./OperatorBanner";
import { WorkspaceInviteBanner } from "./WorkspaceInviteBanner";
import { HeaderSearchProvider, useHeaderSearchSlot } from "@/lib/HeaderSearch";
import { useHeaderPanesSlot, HeaderPanesProvider } from "@/lib/HeaderPanes";
import { FeedIcon } from "./FeedIcon";
import { SegmentedControl } from "./SegmentedControl";
import { Avatar } from "./Avatar";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { SearchInput } from "./DataTable";
import { CustomerJump } from "./CustomerJump";
import { HeaderTrailProvider, type HeaderTrail } from "@/lib/headerTrail";

// Shell composition ported from Nudge (src/app/page.tsx + AppHeader there):
// a fixed-height window holding two FLUSH panes, the sidebar rail and the
// content plane, with a hairline between them, and a `main` that scrolls
// internally. Org config (Business, Settings) is a sidebar destination in its
// own group at the foot; the avatar menu is the PERSON's menu and never routes
// there.
//
// "account" is deliberately absent from the sidebar: it is reachable only from
// the avatar menu, because your own name and alert preferences are not a place
// you go to work.

export type TabId =
  | "appointments"
  | "customers"
  | "inbox"
  | "voice"
  | "messages"
  | "revenue"
  | "knowledge"
  | "billing"
  | "business"
  | "account";

const SIDEBAR_COLLAPSED_KEY = "randevu.sidebar-collapsed";

type IconProps = React.SVGProps<SVGSVGElement>;

// 16px at stroke 1.5, the size and weight every icon set in this class ships
// (Nudge 451ab041). It was 18 at stroke 2, about a quarter more ink per
// glyph, which is what made the nav read chunky beside 14px labels: the ink
// was the problem, not the hues. A glyph borrowed from elsewhere is
// normalised to this at its call site rather than drawn heavier than the rows
// around it. The phone tab bar draws the same glyphs at 18px.
function makeIcon(paths: React.ReactNode) {
  function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...props}
      >
        {paths}
      </svg>
    );
  }
  return Icon;
}

const AppointmentsIcon = makeIcon(
  <>
    <rect x="3" y="4.5" width="18" height="16" rx="2" />
    <path d="M3 9.5h18" />
    <path d="M8 2.5v4M16 2.5v4" />
    <path d="m9 14.5 2 2 4-4" />
  </>,
);
// A group of three people, same glyph Nudge uses for Contacts.
const CustomersIcon = makeIcon(
  <>
    <circle cx="12" cy="6.5" r="3" />
    <path d="M6.5 19v-.5a5.5 5.5 0 0 1 11 0v.5" />
    <circle cx="4.5" cy="9" r="2" />
    <path d="M1 17v-.3a3.3 3.3 0 0 1 3.5-3.2" />
    <circle cx="19.5" cy="9" r="2" />
    <path d="M23 17v-.3a3.3 3.3 0 0 0-3.5-3.2" />
  </>,
);
// A tray, not a speech bubble: the tab holds WhatsApp, email, and calls.
const InboxIcon = makeIcon(
  <>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </>,
);
// Sliders: the business's own shape, set once and rarely touched.
const BusinessIcon = makeIcon(
  <>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
    <path d="M1 14h6M9 8h6M17 16h6" />
  </>,
);
// A speech bubble, not a bell. A bell says "we will nudge you", and only one
// of the six messages behind this tab is a nudge — the others are what the
// salon says when a booking lands, when one is cancelled, after a visit, and
// when someone writes in while the doors are shut.
const MessagesIcon = makeIcon(
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
);

// Each tab keeps ONE hue, carried by its symbol. The active row's wash stays
// neutral — the wash, the label's darker tier and the symbol at full strength
// are the selected cue, so the sidebar never turns into a stack of coloured
// blocks. The label's WEIGHT never changes (see SidebarButton).
const RevenueIcon = makeIcon(
  <>
    <path d="M12 2v20" />
    <path d="M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6" />
  </>,
);

// A tag with its hole: a priced thing. Not a list glyph, which would describe
// the shape of the screen rather than what is on it.
// An open book, not the price tag this tab wore as Services. The tab holds a
// price list AND the prose the agents recite, and a tag only describes half of
// that; a book is the thing you look an answer up in, which is both.
const KnowledgeIcon = makeIcon(
  <>
    <path d="M12 6.5C10.4 5.2 8.5 4.5 6 4.5H3v13h3c2.5 0 4.4.7 6 2 1.6-1.3 3.5-2 6-2h3v-13h-3c-2.5 0-4.4.7-6 2z" />
    <path d="M12 6.5v12" />
  </>,
);
// A megaphone: one thing said to many people, which is exactly what separates
// this from the Inbox above it.
// A robot head, not a handset (Serdar, 2026-08-26: "a robot head, and call
// this agent only"). The same agent now answers the phone AND the WhatsApp
// thread, so the door is drawn as the worker rather than as one of its
// channels — a handset would name the half that happened to ship first.
const AgentIcon = makeIcon(
  <>
    <path d="M12 8V4H8" />
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M9 13v2" />
    <path d="M15 13v2" />
  </>,
);

// A banknote with a dollar on it. It was a bank card, briefly a receipt
// (Serdar, 2026-08-25: the receipt "looks weird"). The card said "a payment
// method is stored"; this tab is about what was charged and what is left, and
// a note is the plainest drawing of money there is.
//
// The $ has two counters, the holes in the S, and inside a 14-unit note at
// the old house stroke of 2 they closed up into a blob; every earlier attempt
// failed there rather than on the shape. So the $ was drawn at 1.75 while the
// note stayed at 2, the one weight exception this file had. The house stroke
// is 1.5 now (2026-10-13), thinner than that exception, so the $ shares it:
// at 16px its counters open as wide as the judged 18px version's did.
//
// It fills nearly the whole 24 box, which for a hollow rectangle is not
// greedy — it is how it matches its neighbours. Drawn at a note's honest
// proportions it sat 14 units tall against the 20 of the $ above it in the
// strip and read as a smaller icon rather than a wider one (Serdar,
// 2026-08-25: "looks rather small"). An outline shape has to be bigger than a
// glyph to weigh the same.
const BillingNoteIcon = makeIcon(
  <>
    <rect x="1" y="3.5" width="22" height="17" rx="3" />
    <path d="M14.4 8.4h-3.3a1.9 1.9 0 0 0 0 3.8h1.8a1.9 1.9 0 0 1 0 3.8H9.6" />
    <path d="M12 6.5v11" />
  </>,
);

// Only ever rendered for platform admins (the operator's own shortcut to
// /admin), so a shield never appears in any salon's sidebar.
const AdminShieldIcon = makeIcon(
  <path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6l7-3z" />,
);

const NAV_TABS: {
  id: TabId;
  key: TranslationKey;
  Icon: (props: IconProps) => React.ReactElement;
  color: string;
  // A shorter label for the phone tab bar, where a sidebar's worth of room is
  // not on offer. Falls back to `key`.
  phoneKey?: TranslationKey;
  // Sidebar and drawer only. The phone bar fits about five labels; anything you
  // set once rather than work in gives up its slot first.
  drawerOnly?: boolean;
}[] = [
  // Inbox leads the sidebar (2026-08-21). It sat under Customers, and two
  // adjacent lists of people's names read as two versions of one screen rather
  // than two jobs: the reply queue and the customer record. The tab you open
  // every morning goes first, and Customers moves below the messaging pair so
  // the two never sit shoulder to shoulder again.
  { id: "inbox", key: "nav.inbox", Icon: InboxIcon, color: "#0ea5e9" },
  // Campaigns left the sidebar (Serdar, 2026-08-26): a whole door for a thing
  // written a few times a year read as clutter next to tabs used daily. The
  // cards live at the foot of Automations now — every message the business
  // sends on one page — and ?tab=campaigns aliases there.
  // Below the messaging tab, not above it. Customers is the record you
  // look someone up in, not the queue you work through.
  {
    id: "customers",
    key: "nav.customers",
    Icon: CustomersIcon,
    color: "#8b5cf6",
  },
  // The bread and butter of this product, so it stays a top-level destination
  // and carries its own tabs (agents, calls, fields) rather than being tucked
  // inside a group. Knowledge left that strip for the Knowledge tab below on
  // 2026-08-22; what remains is the agent, its calls and its vocabulary.
  // Off the phone bar, in the drawer (Serdar, 2026-08-26) — the Messages
  // argument, word for word: an agent you configure once and leave running is
  // not what a phone's bottom row is for, and the slot is worth more to a tab
  // you tap all day. The one daily question this tab answered on the go —
  // "did anyone call" — moved into the Inbox when calls became a channel
  // there, so the bar's first tab already answers it. phoneKey stays for the
  // day this earns its slot back.
  {
    id: "voice",
    key: "nav.voice",
    phoneKey: "nav.voiceShort",
    Icon: AgentIcon,
    color: "#10b981",
    drawerOnly: true,
  },
  // Directly under Voice agent: the agent reads all of this at call time and
  // the public booking page builds its slots from the service list. That
  // adjacency is the real relationship, not alphabetical order.
  //
  // Called KNOWLEDGE, not Services (2026-08-22). It was the price list alone,
  // and the prose the agent recites sat one tab over on the Voice strip. The
  // knowledge card's hint gave the game away — "don't repeat services, prices
  // or opening hours, the assistant already reads those from the app" — a
  // sentence that named a place the owner then had to go and find. Both halves
  // are one job now: everything the business knows, in the order it gets
  // edited (prices first, address second).
  //
  // The name also has to survive the next four channels. Chat, WhatsApp and
  // email agents all read this same body, so the door is named after the body
  // rather than after the one table that used to be behind it.
  //
  // NOT "Services & knowledge". The ampersand was the tell last time too, when
  // this was "Services & fields": two nouns held together by punctuation means
  // the tab has not decided what it is.
  {
    id: "knowledge",
    key: "knowledge.section",
    Icon: KnowledgeIcon,
    color: "#14b8a6",
  },
  {
    id: "revenue",
    key: "nav.revenue",
    Icon: RevenueIcon,
    color: "#f59e0b",
  },
  {
    id: "appointments",
    key: "nav.appointments",
    Icon: AppointmentsIcon,
    color: "var(--brand)",
  },
  // Directly below Calendar, because that is what it acts on: every rule here
  // fires off an appointment. It spent a session inside Business on the
  // argument that rules are config — true on paper, wrong in use. This is the
  // thing the product does to keep chairs full, so it stays one click away and
  // adjacent to the bookings it chases.
  //
  // Called MESSAGES, not Reminders (2026-08-19). Six message types live here
  // and exactly one of them is a reminder — the tab was named after its
  // smallest member, which left the confirmation, the cancellation notice, the
  // follow-up, the win-back and the away reply with no name on the sidebar at
  // all. The id has read "messages" the whole time; only the label lagged.
  //
  // And AUTOMATIONS since 2026-08-25, when the page started drawing each rule
  // as the flow it runs. "Messages" named the artefact; the label now names
  // the value — this sends while you sleep. The id stays put again.
  //
  // Off the phone tab bar, in the drawer with Business. That argument is about
  // where it sits in the sidebar and it still holds there; the bar is a
  // different question. Five rules you set once and leave alone is not what a
  // phone's bottom row is for, and the slot is worth more to a tab you tap all
  // day.
  {
    id: "messages",
    key: "nav.messages",
    Icon: MessagesIcon,
    color: "#6366f1",
    drawerOnly: true,
  },
];

// Config is not a place you work, so it closes the nav in its own group
// (Nudge's grammar). Both entries wear --foreground rather than a hue for the
// same reason. Business is what the business IS (details, booking page, hours,
// team) — services and contact fields have since moved to Knowledge and Voice
// respectively; Settings is what it is CONNECTED to.
//
// The tab is "business", not "workspace": Fresha, Booksy, Square and Treatwell
// all call this Business, and a salon owner does not think of the salon as a
// workspace. "Workspace" stays only where it means the switcher between
// several client businesses on one login.
// Settings is gone — dissolved into the tabs above (voice, messages) and into
// Business (AI connectors; knowledge went to the voice agent and then on to
// its own tab). One config destination remains.
// Below the divider: "about this workspace", as opposed to today's work above
// it. Recent activity spent an hour here on 2026-08-12 and went to the platform
// admin's org page instead: an audit log is a debugging surface whose readers
// are operators, and a salon owner has no use for a page of "settings changed".
const FOOT_TABS: typeof NAV_TABS = [
  {
    id: "business",
    key: "nav.business",
    Icon: BusinessIcon,
    color: "var(--foreground)",
  },
];

// Billing sits at the account edge of the sidebar, directly above the
// signed-in person — where Vercel, Stripe and OpenAI all park money (Serdar,
// 2026-08-21: "billing right above the profile"). Every OWNER sees it,
// whatever the org's billing mode: prepaid owners get the wallet, invoice
// owners get the meter (BillingView branches). Staff never see money. It is
// NOT a section on the voice page: the bill belongs to the business, and any
// future metered lane draws the same balance.
const BILLING_TAB: (typeof NAV_TABS)[number] = {
  id: "billing",
  key: "nav.billing",
  Icon: BillingNoteIcon,
  color: "var(--foreground)",
};

// The product's own mark (Nudge's glyph on --logo red) left the sidebar on
// 2026-10-21 with the wordmark beside it: the top-left belongs to the
// business now (see the sidebar's top row). The brand stays on sign-in and
// on the pages customers see.
// OrgMark lived here and is gone (2026-08-25). It resolved to the salon's logo
// with OUR chevron as the fallback, which was right while the sidebar had only
// one mark to give: the reasoning was that an owner who uploaded a logo has
// already said what their workspace looks like, so showing them our glyph
// answers a question they answered. The sidebar now carries BOTH marks, and
// that same fallback became the bug described on WorkspaceMark below.
//
// The FAVICON split it also documented still stands, and lib/brand.ts makes the
// same one for the title: the tab strip keeps Resepta constant because finding
// the app among thirty tabs is the owner's problem there, while inside the app
// the useful thing is which business you are looking at. The customer-facing
// pages invert both, since there the salon is what the reader came for.

// The mark for the WORKSPACE row, which is not OrgMark and must not become it.
// OrgMark falls back to BrandMark, and that fallback is right where the org
// mark stands alone. Under the product wordmark it is wrong twice over: a
// salon with no logo would wear Resepta's own chevrons directly beneath
// Resepta's own chevrons, and the two rows this layout exists to tell apart
// would open with the identical glyph.
//
// So the fallback is the business's own initial. Neutral rather than tinted:
// a hue here would be a colour standing for a business that never chose one,
// and every other hue in this sidebar already means something (see AGENTS.md,
// "One state, one hue").
function WorkspaceMark({
  logoUrl,
  name,
  size = 24,
}: {
  logoUrl?: string | null;
  name: string;
  size?: number;
}) {
  if (logoUrl) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- a Convex storage
         URL, not an asset next/image can optimize */
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-[0.28em] object-cover"
      />
    );
  }
  // Intl-aware rather than name[0]: a Turkish "İstanbul Kuaför" starts with a
  // dotted capital I, and slicing a code unit off a name that opens with an
  // astral character (an emoji logo typed as a name) yields half a surrogate
  // pair and renders as the replacement glyph.
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?";
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.46 }}
      className="flex shrink-0 items-center justify-center rounded-[0.28em] bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] font-semibold leading-none text-[var(--muted-strong)]"
    >
      {initial}
    </span>
  );
}

// lucide chevrons-up-down. The selector glyph, and deliberately not the ▾ this
// replaced: a single caret says "a menu drops from here", which is what the
// avatar menu and every row kebab also say. Up AND down says "swap this for
// another of the same kind", which is the one thing this control does.
const ChevronsUpDownIcon = makeIcon(
  <>
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </>,
);

// The fold toggle's glyphs, Nudge's (Serdar, 2026-10-21: "that's how I use
// it in Nudge"): the arrow points where the rail will go, left to fold it,
// right to open it again.
function SidebarArrowIcon({ open }: { open: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points={open ? "15 18 9 12 15 6" : "9 18 15 12 9 6"} />
    </svg>
  );
}

// The phone drawer's glyph. Not the fold arrows: they describe a sidebar
// that stays put and gets narrower, which is what the desktop toggle does. On a phone the same tap opens a drawer over the page, and a hamburger
// is the one icon every phone user already reads as "menu".
function MenuIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

// The header, extracted so it can read the search context — a provider
// rendered in AppShell's own output is not an ancestor of AppShell's body, so
// the consumer has to be a child component rather than an inline block.
//
// Search sits in the right-hand cluster ahead of the avatar, in the same place
// on every tab that has one, which is the whole point of moving it out of the
// views. Below sm it collapses to a magnifier and expands over the title: the
// phone header has room for a title or a search field, never both, and losing
// search on phones to gain a fixed position would be a bad trade.
// Pin this conversation for later, from the record rather than only from the
// Inbox list. Ported from Nudge's ContactView, violet and all.
//
// VIOLET because every other hue on this screen already has a job and would be
// read as that job first — Nudge's note is the canonical version and it holds
// here too: --accent blue means "do something" and a blue dot beside a name
// that is already a link reads as an affordance rather than a state; red is
// --now-line; green is --brand, which is what the Inbox's own new-reply marker
// wears. This app has one more violet than Nudge did (--event, the calendar),
// but a booking chip and a pin never share a surface.
//
// Hollow and dashed until you hover, solid once pinned: an empty slot that is
// always visible is a control asking to be used on a page you came to read.
// Same shape as the Inbox row's marker, which is the other place this pin is
// set — one gesture, two doors, and they agree because both read through the
// spent rule in messages.inboxPin.
function PinDot({ customerId }: { customerId: Id<"customers"> }) {
  const t = useT();
  const pinned = useQuery(api.messages.inboxPin, { customerId });
  const setInboxPin = useMutation(api.messages.setInboxPin);
  // Undefined while the query is in flight. Rendering the hollow state then
  // would flip a pinned dot from empty to solid in front of the reader, so the
  // slot holds its width and says nothing until it knows.
  if (pinned === undefined) return <span className="h-2.5 w-2.5 shrink-0" />;
  return (
    <HoverTip text={t(pinned ? "inbox.pinnedHint" : "inbox.pinHint")}>
    <button
      type="button"
      onClick={() => void setInboxPin({ customerId, pinned: !pinned })}
      aria-label={t(pinned ? "inbox.pinned" : "inbox.notPinned")}
      aria-pressed={pinned}
      className={
        pinned
          ? "h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full bg-violet-500 transition-transform hover:scale-125"
          : "h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full border border-dashed border-[var(--muted)] opacity-0 transition-opacity hover:border-[var(--foreground)] group-hover/title:opacity-100 [@media(hover:none)]:opacity-100"
      }
    />
    </HoverTip>
  );
}

// The names of the record header's pane switcher, which shows glyphs only.
const PANE_LABEL = {
  call: "channel.call",
  whatsapp: "channel.whatsapp",
  email: "channel.email",
  note: "notes.title",
} as const satisfies Record<string, TranslationKey>;

// One step of the title bar's breadcrumb: a label and the close it runs.
type Crumb = { label: string; onClick: () => void };

function ShellHeader({
  titleKey,
  overrideTitle,
  crumbs,
  overrideContactId,
  onOpenMenu,
}: {
  titleKey: TranslationKey;
  // A record opened ON TOP of a tab, naming itself here instead of letting the
  // tab keep the title. Opening a contact from the Inbox left this line saying
  // "Inbox" while the page was a person, so the contact drew its own name and
  // back arrow in a second title row below — two headings, the higher one
  // wrong, and a band of gradient between them.
  //
  // A string, not a node: the view supplying it lives under this header, and
  // handing React elements back UP through state is how a render loop starts.
  // Anything richer than a name belongs on the record itself.
  overrideTitle?: string;
  // The path you came by, drawn before the title as clickable steps
  // ("Inbox › Ayşe Yılmaz", "Messages › Reminder 24h before"). Replaces the
  // back arrow (P25, Nudge cba4af4c): "← Name" read as "go to Name" rather
  // than "you are on Name, this goes back". Same size and weight as the
  // title; only the colour steps down, to --muted. Below sm only the nearest
  // step shows, as "‹ Inbox", so the name keeps its room. Labels are strings
  // for the same reason the title is.
  crumbs?: Crumb[];
  // The record the override title names, so the pin beside it can read and
  // write its own state. An ID, not a rendered control or a pair of callbacks
  // — same reason overrideTitle is a string: nothing about this header should
  // depend on a child under it handing elements or closures back up.
  overrideContactId?: Id<"customers">;
  onOpenMenu: () => void;
}) {
  const { t } = useLanguage();
  const { query, setQuery, placeholder, jumpToCustomer } = useHeaderSearchSlot();
  const panes = useHeaderPanesSlot();
  const [expanded, setExpanded] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  // The search wrapper, handed to CustomerJump so its list lines up with the
  // input rather than the whole right-hand cluster. State, not a ref: the
  // list must re-render when the anchor appears.
  const [searchAnchor, setSearchAnchor] = useState<HTMLDivElement | null>(null);
  // Focus gates the recents list — the one thing shown with an empty box.
  // Blur is fine as the off switch: CustomerJump preventDefaults mousedown
  // inside the list, so a pick never blurs the input first.
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    if (expanded) searchRef.current?.focus();
  }, [expanded]);

  // A tab with no search box must not leave the phone header stuck in its
  // expanded state with nothing to type into.
  useEffect(() => {
    if (!placeholder) setExpanded(false);
  }, [placeholder]);

  return (
    // A fixed 48px band, the sidebar brand row's height, on the frame's own
    // fill (the wrapper's .app-pane), so the bar and the rail read as one
    // frame (Nudge 5668cdfd). Fixed rather than a floor: a tab with a search
    // box and one without must put their first row in the same place, or
    // switching from Customers to Automations jumps the card up the screen.
    // ONE inset on every tab, so the title never moves as you switch (P25,
    // Nudge ca95e0f8).
    <header className="gutter-align flex h-12 shrink-0 items-center justify-between gap-3 px-4">
      <div
        className={`group/title flex min-w-0 items-center gap-1.5 ${
          expanded ? "hidden sm:flex" : "flex"
        }`}
      >
        {/* Phone door to the sidebar. */}
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label={t("nav.menu")}
          className="-ml-1 rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] md:hidden"
        >
          <MenuIcon size={18} />
        </button>
        {crumbs?.length ? (
          <nav aria-label={t("nav.breadcrumb")} className="flex min-w-0 shrink items-center gap-1.5">
            {crumbs.map((crumb, i) => {
              const nearest = i === crumbs.length - 1;
              return (
                <span
                  key={i}
                  className={`min-w-0 shrink items-center gap-1.5 ${nearest ? "flex" : "hidden sm:flex"}`}
                >
                  <button
                    type="button"
                    onClick={crumb.onClick}
                    className="page-title flex min-w-0 items-center gap-0.5 rounded-md text-sm font-semibold text-[var(--muted)] transition-colors hover:text-[var(--foreground)] hover:underline hover:underline-offset-4 md:text-base"
                  >
                    {/* The phone's one step is a way back, so it says so. */}
                    {nearest && (
                      <svg className="shrink-0 sm:hidden" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m15 18-6-6 6-6" />
                      </svg>
                    )}
                    <span className="max-w-[12rem] truncate">{crumb.label}</span>
                  </button>
                  <span aria-hidden className="hidden text-sm text-[var(--muted)] sm:inline md:text-base">
                    ›
                  </span>
                </span>
              );
            })}
          </nav>
        ) : null}
        <h1 className="page-title truncate text-sm font-semibold md:text-base">
          {overrideTitle ?? t(titleKey)}
        </h1>
        {overrideContactId && <PinDot customerId={overrideContactId} />}
      </div>
      <div
        className={`flex items-center gap-2 ${expanded ? "min-w-0 flex-1 sm:flex-none" : ""}`}
      >
        {/* The contact page's pane switcher, on the title line where the
            words-in-a-band version used to spend a row (see HeaderPanes).
            Only below lg — from lg the record and the conversation share the
            screen and the card's own pills do the filtering. Gone while the
            phone search is expanded: the box takes the row, same deal the
            title accepts. */}
        {panes && !expanded && (
          <div className="flex shrink-0 items-center gap-0.5 lg:hidden">
            <HoverTip text={t("fields.title")}>
            <button
              type="button"
              onClick={() => panes.select("record")}
              aria-label={t("fields.title")}
              aria-pressed={panes.active === "record"}
              className={`rounded-md p-1.5 transition-colors ${
                panes.active === "record"
                  ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-3.9 3.6-6.5 8-6.5s8 2.6 8 6.5" />
              </svg>
            </button>
            </HoverTip>
            {(["call", "whatsapp", "email", "note"] as const).map((target) => (
              <HoverTip key={target} text={t(PANE_LABEL[target])}>
              <button
                type="button"
                onClick={() => panes.select(target)}
                aria-label={t(PANE_LABEL[target])}
                aria-pressed={panes.active === target}
                className={`rounded-md p-1.5 transition-colors ${
                  panes.active === target
                    ? "bg-[var(--accent)]/10"
                    : "hover:bg-[var(--muted-bg)]"
                }`}
              >
                <FeedIcon type={target} size={16} />
              </button>
              </HoverTip>
            ))}
          </div>
        )}
        {placeholder && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={placeholder}
            className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] sm:hidden"
          >
            <svg
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>
        )}
        {placeholder && (
          <div
            ref={setSearchAnchor}
            className={
              expanded ? "min-w-0 flex-1 sm:flex-none" : "hidden sm:block"
            }
          >
            <SearchInput
              ref={searchRef}
              value={query}
              onChange={setQuery}
              placeholder={placeholder}
              fluid={expanded}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => {
                setSearchFocused(false);
                // Collapse only when it would take nothing with it.
                if (!query) setExpanded(false);
              }}
            />
            {jumpToCustomer && (
              <CustomerJump
                query={query}
                anchor={searchAnchor}
                focused={searchFocused}
                onPick={(customerId) => {
                  // Clear the box on the way out: the term filtered the
                  // PREVIOUS page; carrying it onto the next customer would
                  // open them pre-filtered by a phrase typed to find them.
                  setQuery("");
                  jumpToCustomer(customerId);
                }}
              />
            )}
          </div>
        )}
        {/* No avatar here, on any width (Serdar, 2026-08-31). The phone used
            to keep one on the reasoning that no sidebar was showing — but the
            drawer carries the same profile row, so the header avatar was a
            second answer to "where is my account", one tap apart from the
            first. */}
      </div>
    </header>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
function AutoIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
// A single person, not a gear: this menu is about you, not the business.
function PersonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20v-.5a7 7 0 0 1 14 0v.5" />
    </svg>
  );
}
function SignOutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
function HelpIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.8 9a2.4 2.4 0 1 1 3.9 1.9c-1 .7-1.7 1.2-1.7 2.6" />
      <path d="M12 17h.01" />
    </svg>
  );
}

// Ported from Nudge's AppHeader UserMenu.
//
// Strictly the signed-in person: who you are, how the app looks to you, how to
// leave. It used to carry a Settings shortcut into the org config, which made
// the top-right corner read as a second door into the business setup. It is
// not. Business config is a sidebar destination, and phones reach it through
// the drawer.
const USER_MENU_WIDTH = 224; // w-56, used for the viewport clamp
// Only decides WHICH side the menu opens on, never where it lands — the flip
// pins the far edge, so this being approximate costs nothing.
const USER_MENU_MIN_ROOM = 280;

function UserMenu({
  name,
  email,
  image,
  remoteTheme,
  onOpenAccount,
  // "avatar" is the bare circle the phone header wears. "row" is the sidebar
  // footer: the same circle with the name beside it, because a sidebar has the
  // width to say who is signed in and a header does not.
  variant = "avatar",
  collapsed = false,
}: {
  name?: string;
  email?: string;
  // The Google photo from sign-in; the circle falls back to initials.
  image?: string;
  remoteTheme?: Theme;
  variant?: "avatar" | "row";
  collapsed?: boolean;
  onOpenAccount: () => void;
}) {
  const { t } = useLanguage();
  const { signOut } = useAuthActions();
  const { theme, setTheme, mounted } = useTheme();
  const saveTheme = useMutation(api.users.setMyTheme);
  // Portal + fixed through the shared hook, right-aligned on the avatar and
  // 8px off it. The header sits inside `flex min-h-0 flex-1 flex-col
  // overflow-hidden`, so an absolute child gets clipped at the card edge and
  // no z-index rescues it. Which side it opens on is decided by the room, not
  // by the caller: downward from the phone header, upward from the sidebar
  // footer, bottom-anchored there so nobody has to guess its height. It closed
  // on scroll until 2026-10-13; it follows the avatar now, like every menu.
  const { triggerRef: btnRef, panelRef: menuRef, pos, open, toggle, close } =
    useAnchoredPanel(USER_MENU_WIDTH, USER_MENU_MIN_ROOM - 12, "right", { gap: 8 });

  // Convex is the cross-device source of truth; localStorage (inside useTheme)
  // is the instant no-FOUC cache. Adopt the stored server preference, but hold
  // a pending ref so our own optimistic write doesn't get reverted by the
  // round-trip lag (Nudge's pattern, ported).
  const pending = useRef<Theme | null>(null);
  useEffect(() => {
    if (!mounted || !remoteTheme) return;
    if (pending.current) {
      if (remoteTheme === pending.current) pending.current = null;
      return;
    }
    if (remoteTheme !== theme) setTheme(remoteTheme);
  }, [mounted, remoteTheme, theme, setTheme]);

  const chooseTheme = (next: Theme) => {
    pending.current = next;
    setTheme(next);
    saveTheme({ theme: next }).catch(() => {
      pending.current = null;
    });
  };

  const THEME_OPTIONS: {
    value: Theme;
    key: TranslationKey;
    Icon: () => React.ReactNode;
  }[] = [
    { value: "light", key: "theme.light", Icon: SunIcon },
    { value: "dark", key: "theme.dark", Icon: MoonIcon },
    { value: "auto", key: "theme.auto", Icon: AutoIcon },
  ];

  return (
    <>
      {/* Always labelled, the folded rail included (Nudge 70e62b45): a long
          address is cut off with an ellipsis on the row, so the hover is the
          one place the whole of it can be read before opening anything. The
          rail's label sits beside it, like every folded row's (P20). */}
      <HoverTip
        text={name && email ? `${name} · ${email}` : name || email || t("menu.account")}
        side={variant === "row" ? "right" : "bottom"}
        disabled={open}
        className={variant === "row" && !collapsed ? "flex w-full" : "inline-flex"}
      >
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("menu.account")}
        // A resting SURFACE so the row reads as a control, not a caption
        // (Nudge 615321e2, Serdar there: "since this is a button we could make
        // it look like a button"). Nudge tints it with 4% ink; here it is the
        // workspace switcher's --pane-field, because Serdar read an ink wash
        // on this pane as a row somebody was already touching (globals.css).
        // The two controls on the rail that open a menu now share one
        // material and one up/down chevron. Open holds the hover step. The
        // folded rail keeps the bare circle: there the row is an avatar.
        className={
          variant === "row" && !collapsed
            ? `flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                open
                  ? "bg-[var(--pane-field-hover)]"
                  : "bg-[var(--pane-field)] hover:bg-[var(--pane-field-hover)]"
              }`
            : "group flex h-8 w-8 items-center justify-center rounded-full"
        }
      >
        {variant === "row" && !collapsed ? (
          <>
            <Avatar size="sm" name={name} email={email} image={image} />
            {/* Name over address, both truncating: the rail is 13rem wide and
                an email is however long somebody's employer made it. The end
                truncates, so the domain gives way before the name does. */}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {name || email}
              </span>
              {name && email && (
                <span className="block truncate text-xs text-[var(--muted)]">
                  {email}
                </span>
              )}
            </span>
            {/* Says "this opens a menu", as the switcher's does at the top of
                the rail (Linear, Slack and Vercel's account rows do the same).
                Dropped with the text when the rail folds. */}
            <ChevronsUpDownIcon
              width={14}
              height={14}
              strokeWidth={1.75}
              className="shrink-0 text-[var(--muted)]"
            />
          </>
        ) : (
          <Avatar
            size="md"
            name={name}
            email={email}
            image={image}
            className="transition-shadow group-hover:ring-[var(--muted)]"
          />
        )}
      </button>
      </HoverTip>
      {/* Through a portal with fixed positioning, never an absolute child: the
          sidebar and the content column are overflow-hidden, so an in-flow
          menu gets clipped at their edge (see AGENTS.md — this recurs). */}
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", ...pos }}
            className="menu-surface z-[100] overflow-hidden rounded-lg"
          >
            <div className="border-b border-[var(--border)] px-3 py-2.5">
              <div className="truncate text-sm font-medium">
                {name || email}
              </div>
              {name && email && (
                <div className="truncate text-xs text-[var(--muted)]">
                  {email}
                </div>
              )}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                onOpenAccount();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
            >
              <span className="inline-flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
                <PersonIcon />
              </span>
              {t("nav.account")}
            </button>
            {/* A segmented control, not three stacked rows. The three themes
                are one setting with one answer; stacked beside Account and
                Sign out they read as three more commands, and the checkmark
                is doing work the layout should be doing. Also buys back two
                rows of menu height.

                role="group" wrapping menuitemradio, rather than radiogroup:
                the parent is role="menu", and group is the only container it
                accepts. The radios keep their existing roles.

                Icon over label because the menu is 224px — a column is ~66px,
                which German ("Automatisch") will not share with a glyph.

                No "Appearance" heading over it (Nudge 85f5060e, Serdar
                there): Light, Dark and Auto with a sun and a moon say what
                they are. The word stays as the group's aria-label. */}
            <div className="border-t border-[var(--border)] px-3 py-2">
              {/* The shared segmented control, stacked because every option
                  carries an icon. It drew its own track with a ring and a
                  --background thumb to survive dark mode, where --muted-bg IS
                  --card; the segment tokens do that job for every copy now.
                  Before mount nothing is picked, so the server render and the
                  stored theme cannot disagree. */}
              <SegmentedControl
                semantics="menu"
                fill
                ariaLabel={t("menu.appearance")}
                value={mounted ? theme : "none"}
                onChange={(next) => {
                  if (next !== "none") chooseTheme(next);
                }}
                segments={THEME_OPTIONS.map(({ value, key, Icon }) => ({
                  id: value,
                  label: t(key),
                  icon: <Icon />,
                }))}
              />
            </div>
            {/* The Fleet entry left this menu on 2026-08-20: the operator
                already has the Admin item in the sidebar (below Business),
                and one door to the console is enough. */}
            <div className="border-t border-[var(--border)]">
              <a
                href="https://docs.resepta.xyz"
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
              >
                <span className="inline-flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
                  <HelpIcon />
                </span>
                {t("menu.helpCenter")}
              </a>
              <button
                type="button"
                role="menuitem"
                // Leaves for the marketing site, not for /signin. See
                // lib/hosts.signOutDestination — every page here is behind
                // auth, so staying put means bouncing off a sign-in screen
                // one click after saying you were done.
                //
                // .then, not .finally: a sign-out that failed has left the
                // session standing, and navigating away from a session that
                // still exists tells the person a lie about the shared laptop
                // they are walking away from.
                onClick={() =>
                  void signOut().then(() => {
                    window.location.href = signOutDestination(
                      window.location.hostname,
                    );
                  })
                }
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
              >
                <span className="inline-flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
                  <SignOutIcon />
                </span>
                {t("nav.signOut")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// Workspace switcher (Retell-style): one login, many client businesses, plus
// the "Add business" row that founds a new one. Collapses to a plain label
// only for the anonymous demo walk-in, who can neither switch nor found.
const WORKSPACE_MENU_WIDTH = 224; // w-56, used for the viewport clamp

// Expanded rail only: folded, the rail shows no mark at all (Serdar,
// 2026-10-21), so switching business waits for the rail to open.
function WorkspaceSwitcher({
  fallbackName,
  logoUrl,
}: {
  fallbackName?: string;
  logoUrl?: string | null;
}) {
  const { t } = useLanguage();
  const data = useQuery(api.users.myWorkspaces, {});
  const setActiveOrg = useMutation(api.users.setActiveOrg);
  const foundWorkspace = useMutation(api.users.foundWorkspace);
  // Portal + fixed through the shared hook, which follows the trigger when
  // the sidebar or the page scrolls; it closed instead until 2026-10-13.
  const workspaceCount = data?.workspaces.length ?? 0;
  const { triggerRef: btnRef, panelRef: menuRef, pos, open, toggle, close } =
    useAnchoredPanel(WORKSPACE_MENU_WIDTH, workspaceCount * 36 + 88);

  const active = data?.workspaces.find((w) => w.orgId === data.activeOrgId);
  const label = active?.name || fallbackName || t("app.name");

  // Plain label only while loading and for the anonymous demo walk-in. A
  // real login always gets the menu, even with a single business: the "Add
  // business" row at its foot is the only door to founding a second one, and
  // a door only multi-business operators can see is a door nobody finds.
  //
  // It keeps the mark and the padding of the real control and drops only the
  // wash and the chevron. Same box either way, so a walk-in and an owner see
  // the sidebar laid out the same, and nothing below this row moves when the
  // query lands.
  if (!data || (data.workspaces.length < 2 && !data.canFound)) {
    return (
      <div className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5">
        <WorkspaceMark logoUrl={logoUrl} name={label} size={24} />
        {/* Two lines before the ellipsis, not one: "Bella Güzellik Salo…" is
            the owner's own name cut off in their own product. The title
            carries the full name for the (rare) name that overflows two. */}
        <span
          title={label}
          className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-semibold leading-snug tracking-tight"
        >
          {label}
        </span>
      </div>
    );
  }


  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        // A resting SURFACE, not a wash. The old trigger was bare text with a
        // 10px caret parked at the far end of a flex-1 span, so at rest it read
        // as the page's title and the only thing saying "control" arrived once
        // the pointer was already on it. The first fix overcorrected into a
        // --foreground wash, which put it in the same range as the nav rows'
        // own hover and active states and read as permanently pressed. See
        // --pane-field in globals.css for why white is the material that
        // cannot be mistaken for a state.
        className="flex w-full items-center gap-2 rounded-lg bg-[var(--pane-field)] px-1.5 py-1.5 text-left text-sm font-semibold tracking-tight transition-colors hover:bg-[var(--pane-field-hover)]"
      >
        <WorkspaceMark logoUrl={logoUrl} name={label} size={24} />
        {/* Same two-line grace as the single-workspace name above. */}
        <span
          title={label}
          className="line-clamp-2 min-w-0 flex-1 break-words leading-snug"
        >
          {label}
        </span>
        {/* 1.75 at 14px, Nudge's account-row chevron: the house 1.5
            drawn two pixels smaller would go fainter than the rows. */}
        <ChevronsUpDownIcon
          width={14}
          height={14}
          strokeWidth={1.75}
          className="shrink-0 text-[var(--muted)]"
        />
      </button>
      {/* Through a portal with fixed positioning, never an absolute child: the
          sidebar is overflow-hidden, so an in-flow menu gets clipped at the
          pane edge (see AGENTS.md — this recurs). */}
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", ...pos }}
            className="menu-surface z-[100] overflow-hidden rounded-lg"
          >
            <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-[var(--muted-strong)]">
              {t("workspace.switch")}
            </div>
            {data.workspaces.map((workspace) => (
              <button
                key={workspace.orgId}
                role="menuitem"
                onClick={() => {
                  close();
                  if (workspace.orgId !== data.activeOrgId) {
                    void setActiveOrg({ orgId: workspace.orgId });
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
              >
                <span
                  className={`min-w-0 flex-1 truncate ${
                    workspace.name ? "" : "text-[var(--muted)]"
                  }`}
                >
                  {workspace.name || t("workspace.draft")}
                </span>
                {workspace.orgId === data.activeOrgId && (
                  <span className="text-[var(--brand)]">
                    <CheckIcon />
                  </span>
                )}
              </button>
            ))}
            {data.canFound && (
              <div className="border-t border-[var(--border)]">
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    // The mutation switches the active org server-side; the
                    // new org is unnamed, so the onboarding wizard takes over
                    // on the next render — no navigation needed here.
                    void foundWorkspace({});
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
                >
                  <span className="inline-flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
                    <PlusIcon />
                  </span>
                  {t("workspace.add")}
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

// One sidebar row, shared by the work group and the config group at the foot.
function SidebarButton({
  entry,
  active,
  collapsed,
  dot,
  onClick,
}: {
  entry: (typeof NAV_TABS)[number];
  active: boolean;
  collapsed: boolean;
  // Something in that tab still needs somebody: unanswered replies and failed
  // sends counted together. Rides the icon's corner when collapsed, the
  // trailing edge otherwise, and either way it never moves the label.
  dot?: boolean;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  const { Icon, color } = entry;
  const label = t(entry.key);
  return (
    // Folded, the label shows at once beside the icon (P20, Nudge 258c9316);
    // the native title waited a second and wore the operating system's look.
    <HoverTip text={label} side="right" disabled={!collapsed} className="flex w-full">
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      // Folded there is no label text inside, so the name is given; the
      // attention dot's own label joins it, as it does when the text shows.
      aria-label={
        collapsed ? (dot ? `${label}, ${t("inbox.needsAttention")}` : label) : undefined
      }
      // The tab's hue as a variable so the collapsed active pill can tint with
      // it. Harmless when inactive.
      style={{ "--tab-hue": color } as React.CSSProperties}
      // WEIGHT IS CONSTANT across states, so font-medium lives on the base
      // class (Nudge 451ab041). Stepping medium to semibold on select made the
      // row shout and re-flowed its own label under the cursor; the wash, the
      // darker tier and the hue say "selected" on their own. gap-2.5 with the
      // 16px glyph, where the 18px one took gap-3.
      className={`group relative flex h-9 items-center rounded-lg text-sm font-medium transition-colors ${
        collapsed
          ? // A centered rounded square around the symbol, not a full-width
            // squat oval hugging it.
            "mx-auto h-9 w-9 justify-center px-0"
          : "w-full gap-2.5 px-3"
      } ${
        active
          ? // Expanded keeps the neutral wash — hue lives on the symbol and the
            // label's darker tier finishes the job. Collapsed has no label, so
            // the pill earns a tint of the tab's own hue as the stronger
            // selected cue.
            `bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] text-[var(--foreground)] ${
              collapsed
                ? "bg-[color-mix(in_srgb,var(--tab-hue)_14%,transparent)]"
                : ""
            }`
          : "text-[var(--muted-strong)] hover:bg-black/[0.045] hover:text-[var(--foreground)] dark:hover:bg-white/[0.05]"
      }`}
    >
      {/* Symbol carries the hue. Muted when idle so it accents rather than
          shouts; full strength once active or hovered. */}
      <Icon
        className="shrink-0 opacity-80 transition-opacity group-hover:opacity-100"
        style={{ color, opacity: active ? 1 : undefined }}
      />
      {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
      {dot && (
        // role="img" so the label actually lands in the accessibility tree and
        // folds into the button's name: "Gelen Kutusu, İlgi bekliyor".
        //
        // This green means "something NEW is in there". It used to claim it
        // was the same green as the inbox row's dot "one hue, one meaning" —
        // it never was: that dot marked a PIN, which is a debt you created,
        // not news. The pin is violet now, on the row and on the record, and
        // --brand is left saying only this.
        <span
          role="img"
          aria-label={t("inbox.needsAttention")}
          className={`h-2 w-2 shrink-0 rounded-full bg-[var(--brand)] ${
            collapsed ? "absolute right-1.5 top-1.5" : "ml-auto"
          }`}
        />
      )}
    </button>
    </HoverTip>
  );
}

export function AppShell({
  tab,
  onTab,
  overrideTitle,
  onOverrideBack,
  overrideContactId,
  children,
}: {
  tab: TabId;
  onTab: (tab: TabId) => void;
  overrideTitle?: string;
  onOverrideBack?: () => void;
  overrideContactId?: Id<"customers">;
  children: React.ReactNode;
}) {
  const { t, language, setLanguage } = useLanguage();
  // The record open inside the current tab, reported by its view through
  // useHeaderTrail (src/lib/headerTrail.tsx) and drawn as the title bar's
  // breadcrumb. setViewTrail is a state setter, so the context value is
  // referentially stable and no consumer's effect re-runs on its account.
  const [viewTrail, setViewTrail] = useState<HeaderTrail | null>(null);
  const settings = useQuery(api.orgs.current, {});
  // Two tabs are conditional, so the nav is built from the org rather than
  // being a constant. Filtered rather than conditionally rendered so the
  // phone bar and the sidebar can never disagree about which tabs exist.
  //
  // Takings is opt-in.
  const navTabs = NAV_TABS.filter((entry) => {
    if (entry.id === "revenue") return Boolean(settings?.org.revenueEnabled);
    return true;
  });
  const footTabs = FOOT_TABS;
  // Billing is money, so only owners see the entry — both modes, because the
  // invoice meter is as much "what do I owe" as the prepaid wallet is.
  const showBilling = settings?.me.role === "owner";
  // ?tab=revenue on an org that has it switched off would render a tab with
  // no way back to it — the sidebar entry it came from does not exist. Waits
  // for settings to load so the redirect fires on a known answer, not on the
  // undefined one render earlier.
  useEffect(() => {
    if (!settings) return;
    if (tab === "revenue" && !settings.org.revenueEnabled)
      onTab("appointments");
    if (tab === "billing" && settings.me.role !== "owner")
      onTab("appointments");
  }, [tab, settings, onTab]);
  // Same green dot the inbox rows wear, counted. It used to be a red badge
  // fed by failed sends only, which meant two colours of dot for one idea:
  // somebody still has to look at this.
  const attentionCount = useQuery(api.messages.inboxUnseenCount, {});
  // False for every salon user, and false is what it returns rather than
  // throwing — one cheap query, reveals nothing (same read UserMenu makes).
  const isPlatformAdmin = useQuery(api.platform.amPlatformAdmin, {});

  // Read on mount, not during render: the server has no localStorage, so
  // seeding state from it directly would hydrate-mismatch. One frame expanded
  // is cheaper than a hydration error.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });

  // Phone drawer. Below md the sidebar is off-canvas, and it is now the only
  // way to reach Business and Settings: the avatar menu no longer shortcuts
  // there. The bottom bar carries the same navTabs the sidebar does.
  const [mobileOpen, setMobileOpen] = useState(false);
  // The drawer is a phone surface, so it always shows the full-width sidebar.
  // Folding the desktop collapse in here beats measuring the viewport: the
  // drawer can only be open below md, where `collapsed` has no meaning.
  const showCollapsed = collapsed && !mobileOpen;

  // Lock the page behind the drawer so a swipe scrolls the drawer, not the
  // appointments list underneath it. Escape closes it, same as every other
  // floating surface in the app.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  const goTo = (next: TabId) => {
    onTab(next);
    setMobileOpen(false);
  };

  // The interface language is the READER's, falling back to the business's.
  //
  // It used to be the org's, full stop, which quietly made one salon-wide
  // setting decide two unrelated things: what a stylist reads, and what
  // language customers are messaged in. The second is org.language's real job
  // — it selects the approved WhatsApp template, on exact match with no
  // fallback — and it has no business changing because somebody prefers to
  // work in German.
  // ...and it stands down while the org is still UNNAMED. A fresh org is
  // born language "tr" (auth.ts needs some value), so syncing during
  // onboarding flipped a German visitor's wizard to Turkish the moment
  // settings loaded — the first screen of the product in a language they
  // never chose (Serdar, 2026-08-21). During onboarding the UI keeps the
  // landing's language (localStorage → browser) and the wizard persists it
  // onto the org, so by the time the name lands and this sync wakes up, the
  // two already agree.
  const preferredLanguage = settings?.me.language ?? settings?.org.language;
  const onboarding = settings?.org.name === "";
  useEffect(() => {
    if (onboarding) return;
    if (isLanguage(preferredLanguage) && preferredLanguage !== language) {
      setLanguage(preferredLanguage);
    }
  }, [preferredLanguage, language, setLanguage, onboarding]);

  // The browser tab carries the workspace, not the product. A tab strip
  // truncates from the right, so whatever leads is the only part that survives
  // — and an operator with several salons open is telling businesses apart,
  // not apps. The favicon is left alone on purpose: the mark is how they find
  // Resepta among thirty tabs, so it has to stay the constant.
  //
  // Restored on unmount because signing out unmounts this shell without a
  // document load, and the sign-in page would otherwise keep wearing the name
  // of the salon somebody just left.
  //
  // A customer record open over a tab leads with the customer's name (P12,
  // Nudge's TenantTitle): with several records open, the tab is the only way
  // to tell them apart, and it truncates from the right.
  const workspaceName = settings?.org.name;
  const recordName = overrideTitle?.trim();
  useEffect(() => {
    if (!workspaceName) return;
    document.title = recordName
      ? `${recordName} · ${workspaceTitle(workspaceName)}`
      : workspaceTitle(workspaceName);
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [workspaceName, recordName]);

  // "account" has no sidebar entry to borrow a label from, so its title is
  // resolved directly; billing lives outside the tab arrays (pinned above the
  // profile) and borrows its own entry the same way.
  const titleKey: TranslationKey =
    tab === "account"
      ? "account.title"
      : ([...NAV_TABS, ...FOOT_TABS, BILLING_TAB].find(
          (entry) => entry.id === tab,
        )?.key ?? "app.name");

  // The title bar's breadcrumb (P25). A customer record open over the tab
  // reads "<tab> › <name>"; a record open inside the tab's own view reads
  // "<list> › <record>". The two never stack: the customer record replaces
  // the tab's view, which clears its trail. Undefined title falls back to the
  // tab's own.
  const tabLabel = t(titleKey);
  const recordOpen = overrideTitle !== undefined && onOverrideBack !== undefined;
  const headerTitle = recordOpen ? overrideTitle : viewTrail?.title;
  const crumbs: Crumb[] | undefined = recordOpen
    ? [{ label: tabLabel, onClick: onOverrideBack }]
    : viewTrail
      ? [{ label: viewTrail.backLabel ?? tabLabel, onClick: viewTrail.back }]
      : undefined;

  if (settings && settings.org.name === "") return <OnboardingWizard />;

  return (
    // Above both the header and the views: the box is rendered up here, the
    // filtering happens down there, so the query has to sit over the pair.
    <HeaderSearchProvider>
    <HeaderPanesProvider>
      {/* No padding and no gap: the frame meets the window edge (Nudge
          607c9708, 2026-10-12). The sidebar rail and the top bar are ONE
          frame in one fill (.app-pane, Nudge 5668cdfd; here 2026-10-21), and
          the workspace under the bar meets it with a 12px upper-left curve
          (.workspace-boundary on `main`). The workspace is not a sheet inset
          in a gutter: every view already puts its content in cards, and a
          sheet would be a card holding cards. data-app-shell gives the
          document's reserved scrollbar track back (globals.css): this root
          never scrolls the document, and the track was a 15px strip of page
          white between the content and the window's right edge. */}
      <div data-app-shell className="flex h-[100dvh] overflow-hidden bg-[var(--pane)]">
        {/* Fixed overlay, so it costs the layout nothing and renders on every
          screen rather than only the one the operator arrived on. The
          acting-as chip (OperatorBanner) used to float here too; it lives in
          the sidebar under Admin now. */}
        <WorkspaceInviteBanner />
        {/* Drawer backdrop. Stays mounted so it fades rather than snaps, and
          keeps pointer-events off while closed so it never eats a tap. */}
        <button
          type="button"
          tabIndex={mobileOpen ? 0 : -1}
          aria-hidden={!mobileOpen}
          aria-label={t("nav.closeMenu")}
          onClick={() => setMobileOpen(false)}
          className={`fixed inset-0 z-30 bg-black/40 transition-opacity duration-[120ms] motion-reduce:transition-none md:hidden ${
            mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />
        {/* Sidebar: a flush rail on desktop, an off-canvas drawer on phones.
          Same markup either way, so the phone gets the real navigation instead
          of a cut-down second copy of it. Below md the drawer is the ONLY way
          to reach Business and Settings, now that the avatar menu no longer
          shortcuts there.

          The rail draws no edge of its own: it and the top bar are one
          frame, and the line between the frame and the workspace is main's
          .workspace-boundary, which follows the corner rather than cutting
          through the shared top band. The drawer keeps its shadow: it slides
          over the page. */}
        {/* Off-canvas is not hidden: translated away, the drawer keeps its place
          in the accessibility tree and every destination inside it stays
          tabbable, so tabbing off the phone menu button walks into an
          invisible sidebar. `visibility: hidden` fixes that without a
          matchMedia guard or a hydration-risky client measurement, and it is
          transitionable: hidden → visible flips at the start, visible →
          hidden waits for the slide to finish, so the animation survives.
          `md:visible` puts the desktop pane back. */}
        <aside
          aria-label={t("nav.primary")}
          className={`app-pane fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col overflow-hidden shadow-xl transition-[transform,visibility] duration-[120ms] ease-out motion-reduce:transition-none md:visible md:static md:translate-x-0 md:shadow-none md:transition-[width] ${
            mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full"
          } ${showCollapsed ? "md:w-14" : "md:w-52"}`}
        >
          {/* The title's line holds the fold arrow alone, at the rail's
            right end as Nudge has it, and the business switcher sits on a
            row of its own under it (Serdar, 2026-10-21: beside the arrow the
            switcher "looks off"). No product mark: the top-left belongs to
            the business, and the Resepta brand stays on sign-in and on the
            pages customers see. Folded, the arrow is all there is, and
            switching business waits for the rail to open. */}
          <div
            className={`flex h-12 shrink-0 items-center ${
              showCollapsed ? "justify-center px-1" : "justify-end pl-2 pr-4"
            }`}
          >
            {/* One control: on desktop it folds the sidebar down to symbols,
              on the phone it slides the drawer away. Its label waits half a
              second: the toggle sits where the pointer crosses on the way
              into the rail, and an instant label flashed on every pass
              (Nudge fa6a0d95). */}
            <HoverTip
              text={showCollapsed ? t("nav.expand") : t("nav.collapse")}
              side="right"
              delay={500}
              className="inline-flex shrink-0"
            >
            <button
              type="button"
              onClick={() =>
                mobileOpen ? setMobileOpen(false) : toggleCollapsed()
              }
              aria-label={showCollapsed ? t("nav.expand") : t("nav.collapse")}
              className="shrink-0 rounded p-0.5 text-[var(--muted)] transition-colors hover:bg-black/[0.045] hover:text-[var(--foreground)] dark:hover:bg-white/[0.05]"
            >
              <SidebarArrowIcon open={!showCollapsed} />
            </button>
            </HoverTip>
          </div>
          {!showCollapsed && (
            <div className="px-2 pb-1">
              <WorkspaceSwitcher
                fallbackName={settings?.org.name}
                logoUrl={settings?.org.logoUrl}
              />
            </div>
          )}

          <nav
            className={`flex flex-1 flex-col pb-1 pt-4 ${showCollapsed ? "px-1" : "px-2"}`}
          >
            <div className="space-y-0.5">
              {navTabs.map((entry) => (
                <SidebarButton
                  key={entry.id}
                  entry={entry}
                  active={tab === entry.id}
                  collapsed={showCollapsed}
                  dot={entry.id === "inbox" && (attentionCount ?? 0) > 0}
                  onClick={() => goTo(entry.id)}
                />
              ))}
            </div>
            {/* Config sits with the work rather than pinned to the floor, under a
              short rule that separates the two groups without drawing a line
              across the whole pane. It moved up because the floor is spoken
              for: the signed-in person lives down there now, and two things
              anchored to the same edge compete instead of grouping.

              A partial rule, not a full-width border: it is dividing two
              stacks of left-aligned items, so it only has to be as wide as the
              items are — a full bleed reads as the end of the sidebar. */}
            <div
              aria-hidden
              className={`my-2 h-px w-1/2 bg-[var(--border)] ${showCollapsed ? "mx-auto" : "ml-2"}`}
            />
            <div className="space-y-0.5">
              {footTabs.map((entry) => (
                <SidebarButton
                  key={entry.id}
                  entry={entry}
                  active={tab === entry.id}
                  collapsed={showCollapsed}
                  onClick={() => goTo(entry.id)}
                />
              ))}
              {/* The operator's door, below Business — an anchor, not a tab: it
                opens the fleet console in its own browser tab so the workspace
                being looked at stays where it was. Hardcoded "Admin" like the
                console itself: the admin surface is deliberately English-only,
                and this row renders for platform admins alone, never for any
                salon user. */}
              {isPlatformAdmin && (
                <HoverTip text="Admin" side="right" disabled={!showCollapsed} className="flex w-full">
                <a
                  href="/admin"
                  target="_blank"
                  rel="noopener"
                  aria-label={showCollapsed ? "Admin" : undefined}
                  className={`group relative flex h-9 items-center rounded-lg text-sm font-medium text-[var(--muted-strong)] transition-colors hover:bg-black/[0.045] hover:text-[var(--foreground)] dark:hover:bg-white/[0.05] ${
                    showCollapsed
                      ? "mx-auto h-9 w-9 justify-center px-0"
                      : "w-full gap-2.5 px-3"
                  }`}
                >
                  <AdminShieldIcon
                    className="shrink-0 opacity-80 transition-opacity group-hover:opacity-100"
                    style={{ color: "var(--foreground)" }}
                  />
                  {!showCollapsed && (
                    <span className="flex-1 truncate text-left">Admin</span>
                  )}
                </a>
                </HoverTip>
              )}
              {/* The acting-as chip, right under the door it was entered
                through. Self-gating: renders nothing unless the operator is
                inside someone else's org. */}
              <OperatorBanner collapsed={showCollapsed} />
            </div>

            {/* Who is signed in, at the bottom corner — where a decade of
              dashboards has trained people to look for it, and where it stops
              competing with the workspace name at the top for "whose is this".
              pb-7 lifts it off the edge: flush against it the row reads as cut
              off, and on a Mac the dev-tools bubble lands on top of it. */}
            <div
              className={`mt-auto pb-7 pt-2 ${showCollapsed ? "flex flex-col items-center" : ""}`}
            >
              {/* Billing, glued above the profile rather than filed with the
                foot group: money questions and "who am I signed in as" share
                the account edge, and this is where every SaaS the owner
                already uses keeps its bill. */}
              {showBilling && (
                <div className="w-full pb-2">
                  <SidebarButton
                    entry={BILLING_TAB}
                    active={tab === "billing"}
                    collapsed={showCollapsed}
                    onClick={() => goTo("billing")}
                  />
                </div>
              )}
              <UserMenu
                variant="row"
                collapsed={showCollapsed}
                name={settings?.me.name}
                email={settings?.me.email}
                image={settings?.me.image}
                remoteTheme={settings?.me.themePreference}
                onOpenAccount={() => goTo("account")}
              />
            </div>
          </nav>
        </aside>

        {/* The right half of the frame: the top bar sits on its .app-pane
          fill, the same as the rail beside it, and `main` below is the
          workspace. It does not scroll; `main` does (min-h-0 is
          load-bearing). */}
        <div className="app-pane flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* No ✕ on any tab. Business traded its close button for the search box
            first, and Account followed (2026-08-12) once it had grown enough
            rows to be worth searching. The header holds ONE control on the
            right, search is the more useful one, and every sidebar row is
            already a way out, which is all the ✕ ever did. */}
          <ShellHeader
            titleKey={titleKey}
            overrideTitle={headerTitle}
            crumbs={crumbs}
            overrideContactId={overrideContactId}
            onOpenMenu={() => setMobileOpen(true)}
          />
          {/* Nudge's rule for the bottom edge, ported: a view whose cards scroll
            INSIDE themselves has no content end to breathe after, so padding
            under it is pure loss — it just shortens the scroll viewport. On a
            phone, where height is the scarce thing, those views run to the
            screen edge instead. Views that page-scroll keep the padding,
            because their content genuinely stops.

            The test is the view's own `data-fills-pane`, not a list of tab ids
            here: the customer drill-in fills the pane while the customers LIST
            does not, and both are the same tab. A view that declares itself is
            also one AppShell cannot forget to update.

            Padding stays on `main` rather than moving to a wrapper div — the
            filling views size against main's content box, and an auto-height
            wrapper between them would collapse that.

            Sideways it is 8px on a phone, measured off Nudge rather than
            picked: its views run px-2 there against our 16, which was handing
            back 16px of a 500px screen on every card. The card's own shadow
            and radius already separate it from the pane; a second inset out
            here was doing the same job twice. Unchanged from sm up.

            `relative` (Nudge cbbacbcc), so this pane is the containing block
            for every absolutely positioned box inside it. Without it the
            nearest one can be the BODY: an `sr-only` label (position:
            absolute) deep in a scrolled list then sits at its static place
            and stretches the DOCUMENT to reach it, scrolling the whole shell
            up over a blank page. Overflow here and on the shell cannot clip
            a box whose containing block is above them. Nothing in the views
            relied on the body (checked on every tab, 2026-10-13).

            The calendar declares `data-calendar-ground` (Nudge 5904ddbc,
            14e9ee88): under it this pane is the plain --pane without the
            content wash, so the toolbar and the side panel share one quiet
            ground and only the grid sits on paper, and from sm the frame is
            12px with 8px under a grid, so the calendar takes the pane. The
            list page-scrolls and keeps its bottom padding. The gutter stays:
            switching between the list and a grid must not move the toolbar.

            The workspace itself: the --content-bg wash (fixed, so it stays
            put while the cards scroll over it), a 12px upper-left curve from
            md where the rail sits beside it, and .workspace-boundary's quiet
            edge along the top and the left. The calendar ground drops the
            wash for plain --pane. */}
        <main className="thin-scroll page-scroll stable-gutter workspace-boundary relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[image:var(--content-bg)] bg-fixed p-4 md:rounded-tl-xl max-sm:px-2 max-sm:has-[[data-fills-pane]]:pb-0 has-[[data-calendar-ground]]:bg-none has-[[data-calendar-ground]]:bg-[var(--pane)] sm:has-[[data-calendar-ground]]:px-3 sm:has-[[data-calendar-ground]]:pt-3 sm:has-[[data-fills-pane]]:has-[[data-calendar-ground]]:pb-2">
            {/* Above the content rather than in a corner: someone clicking
              through a demo should never be a minute into it before working
              out that the salon isn't real. Inside the scrolling pane so it
              scrolls away once they've read it, rather than charging a strip
              of vertical rent on every screen. */}
            {settings?.org.demoMode && (
              <p className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-xs text-[var(--muted)]">
                {t("demo.banner")}
              </p>
            )}
            <HeaderTrailProvider value={setViewTrail}>{children}</HeaderTrailProvider>
          </main>
          {/* Phone nav. Not every sidebar row earns a slot here — see drawerOnly
            on NAV_TABS — and the ones that do may answer to a shorter name.
            The bar is the last row of a 100dvh column, so on a
            notched iPhone it lands under the home indicator — the labels are
            the part that goes. Padding it by the inset moves the row clear
            while the border and background still run to the bottom edge.
            Needs viewport-fit=cover, set in app/layout.tsx, or the env() is 0. */}
          <nav className="flex border-t border-[var(--border)] pb-[env(safe-area-inset-bottom)] md:hidden">
            {navTabs
              .filter((entry) => !entry.drawerOnly)
              .map(({ id, key, phoneKey, Icon, color }) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    onClick={() => onTab(id)}
                    aria-current={active ? "page" : undefined}
                    // One weight in both states, like the sidebar rows: a
                    // label that turns semibold under the thumb re-centres
                    // itself in its cell. Colour and the glyph at full
                    // strength carry "you are here".
                    className={`flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-medium ${
                      active
                        ? "text-[var(--foreground)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {/* The sidebar's glyph at 18px, the size this bar has
                        always drawn: a thumb's target, not a row's. */}
                    <Icon
                      width={18}
                      height={18}
                      className="shrink-0"
                      style={{ color, opacity: active ? 1 : 0.8 }}
                    />
                    {t(phoneKey ?? key)}
                  </button>
                );
              })}
          </nav>
        </div>
      </div>
    </HeaderPanesProvider>
    </HeaderSearchProvider>
  );
}
