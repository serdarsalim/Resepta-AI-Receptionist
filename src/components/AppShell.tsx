"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { OnboardingWizard } from "./OnboardingWizard";
import { useLanguage, useT } from "@/lib/LanguageProvider";
import { isLanguage, type TranslationKey } from "@/lib/i18n";
import { useTheme, type Theme } from "@/lib/theme";
import { DEFAULT_TITLE, workspaceTitle } from "@/lib/brand";
import { signOutDestination } from "@/lib/hosts";
import { OperatorBanner } from "./OperatorBanner";
import { WorkspaceInviteBanner } from "./WorkspaceInviteBanner";
import { HeaderSearchProvider, useHeaderSearchSlot } from "@/lib/HeaderSearch";
import { SearchInput } from "./DataTable";
import { CustomerJump } from "./CustomerJump";

// Shell composition ported from Nudge (src/app/page.tsx + AppHeader there):
// fixed-height pane, recessed sidebar, floating main card that scrolls
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
  | "campaigns"
  | "voice"
  | "messages"
  | "revenue"
  | "knowledge"
  | "billing"
  | "business"
  | "account";

const SIDEBAR_COLLAPSED_KEY = "randevu.sidebar-collapsed";

type IconProps = React.SVGProps<SVGSVGElement>;

function makeIcon(paths: React.ReactNode) {
  function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
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
// neutral — hue on the symbol plus a bold label is the selected cue, so the
// sidebar never turns into a stack of coloured blocks.
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
const CampaignsIcon = makeIcon(
  <>
    <path d="M3 11v2a1 1 0 0 0 1 1h2l4 3V7L6 10H4a1 1 0 0 0-1 1z" />
    <path d="M14 8a4 4 0 0 1 0 8" />
    <path d="M17 5a8 8 0 0 1 0 14" />
  </>,
);

// The handset without a person: the agent answers, nobody is held to the desk.
const VoicePhoneIcon = makeIcon(
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />,
);

// A receipt, not a bank card (Serdar, 2026-08-25). The card said "a payment
// method is stored"; this tab is about what was CHARGED and what is left, and
// a torn-off receipt is the object people already associate with that answer.
// Prepaid orgs only, so it is a receipt for money already spent rather than a
// bill arriving.
//
// It carries the same $ strokes as RevenueIcon above, deliberately: money is
// one idea in this sidebar and it should be drawn one way. The frame is what
// separates them — Revenue is the money coming IN, bare; Billing is money on
// a slip, which is the one that has a piece of paper behind it.
const BillingReceiptIcon = makeIcon(
  <>
    <path d="M4 2.5v19l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1v-19l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z" />
    <path d="M14.5 9.5H11a1.75 1.75 0 0 0 0 3.5h2a1.75 1.75 0 0 1 0 3.5H9.5" />
    <path d="M12 7.5v11" />
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
  // Beside Inbox, not under Business: both are places you send messages from,
  // and a campaign is work rather than configuration.
  {
    id: "campaigns",
    key: "campaign.title",
    Icon: CampaignsIcon,
    color: "#ec4899",
  },
  // Below the two messaging tabs, not above them. Customers is the record you
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
  {
    id: "voice",
    key: "nav.voice",
    phoneKey: "nav.voiceShort",
    Icon: VoicePhoneIcon,
    color: "#10b981",
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
  Icon: BillingReceiptIcon,
  color: "var(--foreground)",
};

// Nudge's mark, drawn inline rather than shipped as a file. The square takes
// --logo, which is red: same glyph as the sibling product, different colour, so
// the two are told apart at a glance in a tab strip. Deliberately NOT --brand,
// which stays green because it also paints row hover and selection, and red
// there would read as danger on every hover.
// The mark the sidebar wears: the SALON'S logo once they upload one, ours
// until then (2026-08-20). An owner who has put their own logo into Settings
// has said what this workspace is called and what it looks like; showing them
// our chevron in their own product answers a question they already answered.
//
// The FAVICON stays ours here, and that is not an oversight — lib/brand.ts
// makes the same split for the title. The owner's problem is finding Resepta
// among thirty tabs, so the tab strip keeps the constant; the sidebar is
// already inside the app, where the only useful thing a mark can say is which
// business you are looking at. The customer-facing pages invert both, since
// there the salon is what the reader came for (their generateMetadata).
function OrgMark({ logoUrl, size = 26 }: { logoUrl?: string | null; size?: number }) {
  if (!logoUrl) return <BrandMark size={size} />;
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- a Convex storage
       URL, not an asset next/image can optimize */
    <img
      src={logoUrl}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-[0.22em] object-cover"
    />
  );
}

function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="shrink-0"
      aria-hidden
    >
      <rect width="64" height="64" rx="14" fill="var(--logo)" />
      <path
        d="M18 20 L32 32 L18 44"
        stroke="#ffffff"
        strokeWidth="6.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M33 20 L47 32 L33 44"
        stroke="#ffffff"
        strokeWidth="6.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </svg>
  );
}

// lucide panel-left. One definition, used by the desktop collapse toggle and
// by the phone menu button, and it is the SAME glyph in both states: the icon
// names the sidebar, it does not point anywhere. Chevrons and hamburgers are
// both out of the design language here.
function PanelLeftIcon({ size = 16 }: { size?: number }) {
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
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

// The phone drawer's glyph. Not PanelLeftIcon: the panel-left mark describes a
// sidebar that stays put and gets narrower, which is what the desktop toggle
// does. On a phone the same tap opens a drawer over the page, and a hamburger
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
    <button
      type="button"
      onClick={() => void setInboxPin({ customerId, pinned: !pinned })}
      title={t(pinned ? "inbox.pinnedHint" : "inbox.pinHint")}
      aria-label={t(pinned ? "inbox.pinned" : "inbox.notPinned")}
      aria-pressed={pinned}
      className={
        pinned
          ? "h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full bg-violet-500 transition-transform hover:scale-125"
          : "h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full border border-dashed border-[var(--muted)] opacity-0 transition-opacity hover:border-[var(--foreground)] group-hover/title:opacity-100 [@media(hover:none)]:opacity-100"
      }
    />
  );
}

function ShellHeader({
  titleKey,
  overrideTitle,
  onOverrideBack,
  overrideContactId,
  onOpenMenu,
  name,
  email,
  remoteTheme,
  onOpenAccount,
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
  onOverrideBack?: () => void;
  // The record the override title names, so the pin beside it can read and
  // write its own state. An ID, not a rendered control or a pair of callbacks
  // — same reason overrideTitle is a string: nothing about this header should
  // depend on a child under it handing elements or closures back up.
  overrideContactId?: Id<"customers">;
  onOpenMenu: () => void;
  name?: string;
  email?: string;
  remoteTheme?: Theme;
  onOpenAccount: () => void;
}) {
  const { t } = useLanguage();
  const { query, setQuery, placeholder, jumpToCustomer } = useHeaderSearchSlot();
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
    // min-h-13 is the whole reason every tab's first row lands in the same
    // place. Without it the header is as tall as whatever it happens to hold:
    // ~55px on a tab with a search box, ~42px on one without — so switching
    // from Customers to Reminders jumped the card and its Add button 13px up
    // the screen. The floor is the search box's own height plus this padding,
    // so tabs that have one are unchanged and the rest stop shifting.
    <header className="gutter-align flex min-h-13 items-center justify-between gap-3 px-4 pb-1 pt-3">
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
        {overrideTitle !== undefined && onOverrideBack && (
          // Same drawn arrow the contact page used to carry. A "←" glyph is
          // whatever the reader's font decides it is.
          <button
            type="button"
            onClick={onOverrideBack}
            aria-label={t("common.back")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </button>
        )}
        <h1 className="page-title truncate text-sm font-semibold md:text-base">
          {overrideTitle ?? t(titleKey)}
        </h1>
        {overrideContactId && <PinDot customerId={overrideContactId} />}
      </div>
      <div
        className={`flex items-center gap-2 ${expanded ? "min-w-0 flex-1 sm:flex-none" : ""}`}
      >
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
        {/* Phones only. On desktop this lives in the sidebar footer, and two
            avatars on one screen would be two answers to "where is my
            account". The phone has no sidebar showing, so it keeps one. */}
        <span className="md:hidden">
          <UserMenu
            name={name}
            email={email}
            remoteTheme={remoteTheme}
            onOpenAccount={onOpenAccount}
          />
        </span>
      </div>
    </header>
  );
}

function initialsFrom(name?: string | null, email?: string | null): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
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
  remoteTheme?: Theme;
  variant?: "avatar" | "row";
  collapsed?: boolean;
  onOpenAccount: () => void;
}) {
  const { t } = useLanguage();
  const { signOut } = useAuthActions();
  const { theme, setTheme, mounted } = useTheme();
  const saveTheme = useMutation(api.users.setMyTheme);
  // Menu position, measured from the trigger at open time. Null = closed.
  // Same mechanism as WorkspaceSwitcher below, deliberately: the header sits
  // inside `flex min-h-0 flex-1 flex-col overflow-hidden`, so an absolute
  // child gets clipped at the card edge and no z-index rescues it.
  // Anchored by `top` OR by `bottom`, never both. Pinning the far edge is what
  // lets the menu open upward from a sidebar footer without anybody having to
  // guess its height first — a guessed height is a menu that drifts the moment
  // somebody adds a row to it.
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        btnRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    // Capture, so a scroll inside any pane closes it rather than leaving the
    // menu floating away from its trigger. The menu's OWN scrollbar is the
    // exception: scrolling the list is using it, not leaving it.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setPos(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Right-aligned on the trigger, then clamped so it can never hang off a
  // 390px screen. Opens downward from the phone header and upward from the
  // sidebar footer — decided by which side has the room, not by which caller
  // it is, so neither placement has to know about the other.
  const toggle = () => {
    if (open) return setPos(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const roomBelow = window.innerHeight - r.bottom;
    setPos({
      ...(roomBelow < USER_MENU_MIN_ROOM && r.top > roomBelow
        ? { bottom: window.innerHeight - r.top + 8 }
        : { top: r.bottom + 8 }),
      left: Math.max(
        8,
        Math.min(
          r.right - USER_MENU_WIDTH,
          window.innerWidth - USER_MENU_WIDTH - 8,
        ),
      ),
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
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("menu.account")}
        className={
          variant === "row" && !collapsed
            ? "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-black/[0.045] dark:hover:bg-white/[0.05]"
            : "flex h-8 w-8 items-center justify-center rounded-full bg-[var(--muted-bg)] text-xs font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)] transition-shadow hover:ring-[var(--muted)]"
        }
      >
        {variant === "row" && !collapsed ? (
          <>
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--muted-bg)] text-xs font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)]"
            >
              {initialsFrom(name, email)}
            </span>
            {/* Name over address, both truncating: a sidebar is 15rem wide and
                an email is however long somebody's employer made it. */}
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
          </>
        ) : (
          initialsFrom(name, email)
        )}
      </button>
      {/* Through a portal with fixed positioning, never an absolute child: the
          content card is overflow-hidden, so an in-flow menu gets clipped at
          the card edge (see AGENTS.md — this recurs). */}
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", width: USER_MENU_WIDTH, ...pos }}
            className="z-[100] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
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
                setPos(null);
                onOpenAccount();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-[var(--muted-bg)]"
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
                which German ("Automatisch") will not share with a glyph. */}
            <div className="border-t border-[var(--border)] px-3 pb-2 pt-1.5">
              <div className="pb-1.5 text-[11px] font-medium text-[var(--muted-strong)]">
                {t("menu.appearance")}
              </div>
              {/* Ring on the track because in dark --muted-bg IS --card, so an
                  unringed track is invisible on this surface. Same reason the
                  selected segment is --background and not the --card the app's
                  other segmented controls use: --card would vanish into the
                  track, on the one control whose job is switching dark mode. */}
              <div
                role="group"
                aria-label={t("menu.appearance")}
                className="grid grid-cols-3 gap-0.5 rounded-lg bg-[var(--muted-bg)] p-0.5 ring-1 ring-inset ring-[var(--border)]"
              >
                {THEME_OPTIONS.map(({ value, key, Icon }) => {
                  const active = mounted && theme === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => chooseTheme(value)}
                      className={`flex flex-col items-center gap-1 rounded-md px-0.5 py-1.5 transition-colors ${
                        active
                          ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                          : "text-[var(--muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      <span className="inline-flex h-[18px] w-[18px] items-center justify-center">
                        <Icon />
                      </span>
                      {/* Measured, not guessed: German "Automatisch" wants
                          57px of the 55px a px-1 column gives it. px-0.5 and
                          tracking-tight buy it back with ~4px to spare, which
                          is the margin a font fallback needs. truncate is the
                          backstop if a future language beats German. */}
                      <span className="w-full truncate text-center text-[10px] leading-none tracking-tight">
                        {t(key)}
                      </span>
                    </button>
                  );
                })}
              </div>
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
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-[var(--muted-bg)]"
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
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-[var(--muted-bg)]"
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

function WorkspaceSwitcher({
  fallbackName,
  logoUrl,
  collapsed = false,
}: {
  fallbackName?: string;
  logoUrl?: string | null;
  // Collapsed, the brand mark IS the trigger — otherwise switching org would
  // mean expanding the sidebar first, which for an operator running several
  // client workspaces is the one thing they do most.
  collapsed?: boolean;
}) {
  const { t } = useLanguage();
  const data = useQuery(api.users.myWorkspaces, {});
  const setActiveOrg = useMutation(api.users.setActiveOrg);
  const foundWorkspace = useMutation(api.users.foundWorkspace);
  // Menu position, measured from the trigger at open time. Null = closed.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        btnRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    // Capture, so a scroll inside any pane closes it rather than leaving the
    // menu floating away from its trigger. The menu's OWN scrollbar is the
    // exception: scrolling the list is using it, not leaving it.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setPos(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const active = data?.workspaces.find((w) => w.orgId === data.activeOrgId);
  const label = active?.name || fallbackName || t("app.name");

  // Plain label only while loading and for the anonymous demo walk-in. A
  // real login always gets the menu, even with a single business: the "Add
  // business" row at its foot is the only door to founding a second one, and
  // a door only multi-business operators can see is a door nobody finds.
  if (!data || (data.workspaces.length < 2 && !data.canFound)) {
    return collapsed ? (
      <OrgMark logoUrl={logoUrl} size={24} />
    ) : (
      // Two lines before the ellipsis, not one: "Bella Güzellik Salo…" is the
      // owner's own name cut off in their own product. The title carries the
      // full name for the (rare) name that overflows even two lines.
      <span
        title={label}
        className="line-clamp-2 break-words text-sm font-semibold leading-snug tracking-tight"
      >
        {label}
      </span>
    );
  }

  const toggle = () => {
    if (open) return setPos(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      top: r.bottom + 4,
      left: Math.max(
        8,
        Math.min(r.left, window.innerWidth - WORKSPACE_MENU_WIDTH - 8),
      ),
    });
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? label : undefined}
        className={
          collapsed
            ? "rounded-md transition-opacity hover:opacity-80"
            : "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm font-semibold tracking-tight transition-colors hover:bg-[var(--row-hover-bg)]"
        }
      >
        {collapsed ? (
          <OrgMark logoUrl={logoUrl} size={24} />
        ) : (
          <>
            {/* Same two-line grace as the single-workspace name above. */}
            <span
              title={label}
              className="line-clamp-2 min-w-0 flex-1 break-words leading-snug"
            >
              {label}
            </span>
            <span className="text-[10px] text-[var(--muted)]">▾</span>
          </>
        )}
      </button>
      {/* Through a portal with fixed positioning, never an absolute child: the
          sidebar is overflow-hidden, so an in-flow menu gets clipped at the
          pane edge (see AGENTS.md — this recurs). */}
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", width: WORKSPACE_MENU_WIDTH, ...pos }}
            className="z-[100] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
          >
            <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-[var(--muted-strong)]">
              {t("workspace.switch")}
            </div>
            {data.workspaces.map((workspace) => (
              <button
                key={workspace.orgId}
                role="menuitem"
                onClick={() => {
                  setPos(null);
                  if (workspace.orgId !== data.activeOrgId) {
                    void setActiveOrg({ orgId: workspace.orgId });
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted-bg)]"
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
                    setPos(null);
                    // The mutation switches the active org server-side; the
                    // new org is unnamed, so the onboarding wizard takes over
                    // on the next render — no navigation needed here.
                    void foundWorkspace({});
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted-bg)]"
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
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      // The tab's hue as a variable so the collapsed active pill can tint with
      // it. Harmless when inactive.
      style={{ "--tab-hue": color } as React.CSSProperties}
      className={`group relative flex h-9 items-center rounded-lg text-sm transition-colors ${
        collapsed
          ? // A centered rounded square around the symbol, not a full-width
            // squat oval hugging it.
            "mx-auto h-9 w-9 justify-center px-0"
          : "w-full gap-3 px-3"
      } ${
        active
          ? // Expanded keeps the neutral wash — hue lives on the symbol and the
            // bold label finishes the job. Collapsed has no label, so the pill
            // earns a tint of the tab's own hue as the stronger selected cue.
            `bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] font-semibold text-[var(--foreground)] ${
              collapsed
                ? "bg-[color-mix(in_srgb,var(--tab-hue)_14%,transparent)]"
                : ""
            }`
          : "font-medium text-[var(--muted-strong)] hover:bg-black/[0.045] hover:text-[var(--foreground)] dark:hover:bg-white/[0.05]"
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
  const settings = useQuery(api.orgs.current, {});
  // Two tabs are conditional, so the nav is built from the org rather than
  // being a constant. Filtered rather than conditionally rendered so the
  // phone bar and the sidebar can never disagree about which tabs exist.
  //
  // Takings is opt-in. Campaigns is not a preference — it is earned by
  // connecting a number, because until one is connected the tab is a heading
  // over a disabled button, which reads as the product being broken rather
  // than unconfigured. Settings is where the number gets connected, and the
  // tab appearing afterwards is the reward for having done it.
  const navTabs = NAV_TABS.filter((entry) => {
    if (entry.id === "revenue") return Boolean(settings?.org.revenueEnabled);
    if (entry.id === "campaigns") return Boolean(settings?.whatsapp.connected);
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
    if (tab === "campaigns" && !settings.whatsapp.connected)
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
  const workspaceName = settings?.org.name;
  useEffect(() => {
    if (!workspaceName) return;
    document.title = workspaceTitle(workspaceName);
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [workspaceName]);

  // "account" has no sidebar entry to borrow a label from, so its title is
  // resolved directly; billing lives outside the tab arrays (pinned above the
  // profile) and borrows its own entry the same way.
  const titleKey: TranslationKey =
    tab === "account"
      ? "account.title"
      : ([...NAV_TABS, ...FOOT_TABS, BILLING_TAB].find(
          (entry) => entry.id === tab,
        )?.key ?? "app.name");

  if (settings && settings.org.name === "") return <OnboardingWizard />;

  return (
    // Above both the header and the views: the box is rendered up here, the
    // filtering happens down there, so the query has to sit over the pair.
    <HeaderSearchProvider>
      <div className="flex h-[100dvh] overflow-hidden bg-[var(--pane)] md:p-2 md:gap-2">
        {/* Fixed overlay, so it costs the layout nothing and renders on every
          screen rather than only the one the operator arrived on. */}
        <OperatorBanner />
        {/* Same treatment, same reason. Only one of the two can be showing at
          once in practice: an operator impersonating an org is not someone who
          was just invited to it. */}
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
        {/* Sidebar: a recessed pane on desktop, an off-canvas drawer on phones.
          Same markup either way, so the phone gets the real navigation instead
          of a cut-down second copy of it. Below md the drawer is the ONLY way
          to reach Business and Settings, now that the avatar menu no longer
          shortcuts there. */}
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
          {/* Brand row. The mark stays put across the collapse so the eye has a
            fixed anchor; the name and the switcher are what fold away. */}
          <div
            className={`flex items-center gap-2 pt-3 ${
              showCollapsed ? "flex-col gap-1 px-1 pb-1" : "px-2 pb-2"
            }`}
          >
            {showCollapsed ? (
              <WorkspaceSwitcher
                fallbackName={settings?.org.name}
                logoUrl={settings?.org.logoUrl}
                collapsed
              />
            ) : (
              <>
                <OrgMark logoUrl={settings?.org.logoUrl} size={26} />
                <div className="min-w-0 flex-1">
                  <WorkspaceSwitcher
                    fallbackName={settings?.org.name}
                    logoUrl={settings?.org.logoUrl}
                  />
                </div>
              </>
            )}
            {/* One control, one glyph: on desktop it folds the sidebar down to
              symbols, on the phone it slides the drawer away. Both mean "put
              the sidebar back", which is why the icon does not change. */}
            <button
              type="button"
              onClick={() =>
                mobileOpen ? setMobileOpen(false) : toggleCollapsed()
              }
              aria-label={showCollapsed ? t("nav.expand") : t("nav.collapse")}
              className="rounded p-0.5 text-[var(--muted)] transition-colors hover:bg-black/[0.045] hover:text-[var(--foreground)] dark:hover:bg-white/[0.05]"
            >
              <PanelLeftIcon />
            </button>
          </div>

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
                <a
                  href="/admin"
                  target="_blank"
                  rel="noopener"
                  title={showCollapsed ? "Admin" : undefined}
                  className={`group relative flex h-9 items-center rounded-lg text-sm font-medium text-[var(--muted-strong)] transition-colors hover:bg-black/[0.045] hover:text-[var(--foreground)] dark:hover:bg-white/[0.05] ${
                    showCollapsed
                      ? "mx-auto h-9 w-9 justify-center px-0"
                      : "w-full gap-3 px-3"
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
              )}
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
                remoteTheme={settings?.me.themePreference}
                onOpenAccount={() => goTo("account")}
              />
            </div>
          </nav>
        </aside>

        {/* Floating content card; scrolls internally (min-h-0 is load-bearing).
          --pane, not --background: this is the plane the view's own cards sit
          on, not a sheet of its own. White here meant card-raised was white on
          white and had to buy its separation entirely with shadow.

          The calendar is the exception, and it earns it: it draws a full-bleed
          grid of hairlines rather than floating cards, so there is nothing for
          the plane to separate — grey just tints the whole grid and the day
          columns stop reading as paper. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[image:var(--content-bg)] md:rounded-xl md:shadow-[var(--card-shadow)]">
          {/* No ✕ on any tab. Business traded its close button for the search box
            first, and Account followed (2026-08-12) once it had grown enough
            rows to be worth searching. The header holds ONE control on the
            right, search is the more useful one, and every sidebar row is
            already a way out, which is all the ✕ ever did. */}
          <ShellHeader
            titleKey={titleKey}
            overrideTitle={overrideTitle}
            onOverrideBack={onOverrideBack}
            overrideContactId={overrideContactId}
            onOpenMenu={() => setMobileOpen(true)}
            name={settings?.me.name}
            email={settings?.me.email}
            remoteTheme={settings?.me.themePreference}
            onOpenAccount={() => onTab("account")}
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
            here was doing the same job twice. Unchanged from sm up. */}
        <main className="thin-scroll page-scroll stable-gutter min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 max-sm:px-2 max-sm:has-[[data-fills-pane]]:pb-0">
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
            {children}
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
                    className={`flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[11px] ${
                      active
                        ? "font-semibold text-[var(--foreground)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    <Icon
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
    </HeaderSearchProvider>
  );
}
