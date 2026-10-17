"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AppShell, type TabId } from "@/components/AppShell";
import { AppointmentsView } from "@/components/AppointmentsView";
import { CustomersView } from "@/components/CustomersView";
import { RevenueView } from "@/components/RevenueView";
import { InboxView } from "@/components/InboxView";
import { RemindersView } from "@/components/RemindersView";
import { VoiceView } from "@/components/VoiceView";
import { BusinessView } from "@/components/BusinessView";
import { KnowledgeView } from "@/components/KnowledgeView";
import { AccountView } from "@/components/AccountView";
import { BillingView } from "@/components/BillingView";
import { ContactView } from "@/components/ContactView";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { FeedFilter } from "@/components/ConversationPanel";

// The signed-in application, lifted out of app/page.tsx so it can be pulled in
// with next/dynamic({ ssr: false }).
//
// That indirection is load-bearing, not tidiness. Importing this file directly
// from the page put every view into the SERVER bundle for `/`, and one of them
// reaches isomorphic-dompurify, which reaches jsdom. On Vercel that lambda
// crashed with ERR_REQUIRE_ESM the moment `/` was rendered for a signed-out
// visitor, because jsdom's html-encoding-sniffer require()s an ESM-only
// package. The route's file trace was 1316 files against /signin's 135.
//
// Nothing here needs server rendering: it is a dashboard behind auth, entirely
// client components, and it renders after an auth round trip anyway. Keeping it
// out of the server graph costs nothing and keeps `/` cheap enough to serve a
// stranger. Check the trace before adding a static import back:
//   grep -c jsdom .next/server/app/page.js.nft.json   # must be 0
export function AppHome() {
  const [tab, setTabState] = useState<TabId>("appointments");
  const [contactId, setContactId] = useState<Id<"customers"> | null>(null);
  // Which tab the open contact belongs to — the one that was active when it
  // opened (Serdar, 2026-08-31). A record no longer closes on every tab
  // switch: glancing at the calendar mid-conversation used to cost the whole
  // drill-in, and coming back to the Inbox landed on the list instead of the
  // person you were talking to. The record now hides while another tab is
  // showing and comes back with its tab.
  const [contactTab, setContactTab] = useState<TabId | null>(null);
  // The open contact's name, so the SHELL header can carry it instead of the
  // tab underneath. Reported up by ContactView, which is the only thing that
  // queries the customer — duplicating that query here to fill in a heading
  // would be a second read of the same row on every contact opened.
  //
  // Held as a string: handing React elements up through state is how a render
  // loop starts.
  const [contactName, setContactName] = useState("");
  // Which channel the record should OPEN on, when whoever sent us here knows.
  // The inbox does: its row already knows the newest message was a WhatsApp,
  // and landing on the mixed feed makes the reader find that thread again by
  // hand after clicking the row that was showing it to them.
  //
  // Undefined from the customers table and the calendar, which have no such
  // context — those keep the mixed feed.
  const [contactFilter, setContactFilter] = useState<FeedFilter | undefined>(
    undefined,
  );
  // WHICH mail or call the sender was looking at, when it knows. Email and
  // calls are the two channels the record shows as a LIST first — six subjects
  // or twenty-five calls — so a row that previews one of them and then lands
  // on the index has handed the reader back the recognition problem their
  // click was meant to solve. WhatsApp and notes need nothing: those channels
  // open as a thread with the newest message already at the bottom.
  const [contactItem, setContactItem] = useState<string | undefined>(undefined);
  // Which business the ids above belong to. AppShell subscribes to this same
  // query, so reading it here opens no second subscription.
  //
  // contactId is the only org-scoped id in the app that is not derived from a
  // list. The inbox's open conversation heals itself — it comes off the
  // conversations list, which empties of the previous org the moment the
  // switch lands — but a contact opened in one workspace keeps asking the
  // NEXT one about a customer it has never heard of. Cleared during render
  // rather than from an effect on purpose: the org change and the contact
  // queries arrive in one consistent snapshot, so an effect fires a beat too
  // late and ContactView renders once against the wrong business first.
  const activeOrgId = useQuery(api.orgs.current, {})?.org._id;
  const setActiveOrg = useMutation(api.users.setActiveOrg);
  // A customer link opened in a fresh tab (P12; customerHref below): the
  // customer to open once the right business is active. The link carries the
  // business, because one person can work for several and a bare customer id
  // asks whichever business is active about somebody it has never heard of.
  const [pendingLink, setPendingLink] = useState<{
    customerId: Id<"customers">;
    orgId: string | null;
  } | null>(null);
  const [selectionOrgId, setSelectionOrgId] = useState<Id<"orgs"> | null>(null);
  if (activeOrgId && activeOrgId !== selectionOrgId) {
    setSelectionOrgId(activeOrgId);
    // Not on the first resolve: there is nothing open yet, and clearing then
    // would fight a contact deep-linked into a fresh load.
    if (selectionOrgId !== null) {
      setContactId(null);
      setContactTab(null);
      setContactName("");
      setContactFilter(undefined);
      setContactItem(undefined);
    }
  }

  // One door, so nothing can set an id without settling the channel with it.
  const openContact = (
    id: Id<"customers">,
    channel?: FeedFilter,
    itemId?: string,
  ) => {
    setContactFilter(channel);
    setContactItem(itemId);
    setContactId(id);
    setContactTab(tab);
  };

  // The tab lives in the URL, so a refresh comes back where you were and a
  // link to Settings opens Settings. A bare URL falls back to the last tab
  // this browser was on: a new session resumes where the person left off
  // rather than resetting to the calendar. Read after mount rather than
  // during the first render: initialising state from window during render is
  // a hydration mismatch.
  // The customer half of a link, read once after mount like the tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const customer = params.get("customer");
    if (customer) {
      setPendingLink({ customerId: customer as Id<"customers">, orgId: params.get("org") });
    }
  }, []);
  // Opened once its business is the active one; switched to first when the
  // link names another business this person belongs to (setActiveOrg refuses
  // one they do not, and the link then simply does not open).
  useEffect(() => {
    if (!pendingLink || !activeOrgId) return;
    if (pendingLink.orgId && pendingLink.orgId !== activeOrgId) {
      void setActiveOrg({ orgId: pendingLink.orgId as Id<"orgs"> }).catch(() =>
        setPendingLink(null),
      );
      return;
    }
    setContactId(pendingLink.customerId);
    setContactTab(tab);
    setPendingLink(null);
  }, [pendingLink, activeOrgId, setActiveOrg, tab]);
  // The open record in the URL, so a refresh keeps it and the address bar is
  // a link to it. replaceState, like the tab: opening a record is not history.
  useEffect(() => {
    if (pendingLink) return;
    const url = new URL(window.location.href);
    const open = contactId && tab === contactTab;
    if (open && activeOrgId) {
      url.searchParams.set("customer", contactId);
      url.searchParams.set("org", activeOrgId);
    } else {
      url.searchParams.delete("customer");
      url.searchParams.delete("org");
    }
    window.history.replaceState(null, "", url);
  }, [contactId, contactTab, tab, activeOrgId, pendingLink]);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    const next = [wanted, stored]
      .map((id) => (id !== null && id in TAB_ALIASES ? TAB_ALIASES[id] : id))
      .find((id): id is TabId => id !== null && TAB_IDS.includes(id as TabId));
    if (next) setTabState(next);
  }, []);

  // Switching AWAY keeps the record parked under its tab (see contactTab).
  // Re-clicking the tab you are already on is still the way back to its
  // list: that click has no other meaning, and it preserves the old escape
  // hatch for anyone trained on it.
  const setTab = (next: TabId) => {
    if (next === tab) setContactId(null);
    setTabState(next);
    window.localStorage.setItem(TAB_STORAGE_KEY, next);
    // replaceState, not push: the tab strip is not history. Filling the back
    // stack with every tab a person glanced at means Back stops meaning
    // "the page before this one".
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };

  return (
    <AppShell
      tab={tab}
      onTab={setTab}
      // Undefined, not "", while nothing is open — the shell falls back to the
      // tab's own title. An empty string is a title that says nothing. A
      // record parked under ANOTHER tab counts as not open: the header must
      // name the tab being looked at, not the contact waiting behind it.
      overrideTitle={contactId && tab === contactTab ? contactName : undefined}
      onOverrideBack={() => setContactId(null)}
      overrideContactId={
        contactId && tab === contactTab ? contactId : undefined
      }
    >
      {/* Around the views only, never around the shell. A view that throws
          leaves the sidebar, the tab strip and the workspace switcher
          standing, which matters most in the case that put this here: when
          the data behind a broken pane belongs to the workspace you are in,
          the switcher is the way out of it. The shell's own queries fall
          through to app/error.tsx. */}
      <ErrorBoundary resetKeys={[activeOrgId, tab, contactId]}>
        {contactId && tab === contactTab ? (
          <ContactView
            // Keyed, so opening a second contact from the first one's feed
            // remounts and re-reports rather than showing the previous name
            // until the new query lands.
            key={contactId}
            customerId={contactId}
            initialFilter={contactFilter}
            initialItemId={contactItem}
            onTitle={setContactName}
            onOpenContact={openContact}
            // A deleted customer's page has nothing left on it, so it lands
            // on the customer list, whichever tab it was opened from: that is
            // where the owner sees the person is gone.
            onDeleted={() => {
              setContactId(null);
              setTab("customers");
            }}
          />
        ) : (
          <>
            {tab === "appointments" && (
              <AppointmentsView onOpenContact={openContact} />
            )}
            {tab === "customers" && <CustomersView onOpenContact={openContact} />}
            {tab === "inbox" && <InboxView onOpenContact={openContact} />}
            {tab === "voice" && <VoiceView />}
            {/* Content the business maintains, not configuration: every agent
                reads it and the booking page builds its slots from the service
                half. Was the "services" tab until 2026-08-22. */}
            {tab === "knowledge" && <KnowledgeView />}
            {tab === "revenue" && <RevenueView />}
            {tab === "messages" && <RemindersView />}
            {/* "business", not "workspace": Fresha, Booksy, Square and Treatwell
                all call this Business, and a salon owner does not think of the
                salon as a workspace. */}
            {/* The prepaid wallet — Stripe's success_url points here, so this
                tab id is part of the checkout round trip (wallet.ts). */}
            {tab === "billing" && <BillingView />}
            {tab === "business" && <BusinessView />}
            {/* Personal, not org config. Only the avatar menu routes here. */}
            {tab === "account" && <AccountView />}
          </>
        )}
      </ErrorBoundary>
    </AppShell>
  );
}

const TAB_STORAGE_KEY = "randevu.tab";

// Tab ids that have been renamed, kept pointing at their replacement. Both
// sources this reads outlive a release — localStorage holds whatever tab the
// browser was last on, and ?tab= links get pasted into WhatsApp — so a rename
// with no alias silently drops returning owners onto the calendar. One line
// per rename is cheaper than that, and cheaper than never renaming a tab.
const TAB_ALIASES: Record<string, TabId> = {
  services: "knowledge",
  // Campaigns folded into Automations (2026-08-26); its cards sit at the foot
  // of that page.
  campaigns: "messages",
};

// Every tab that may appear in the URL. Validated rather than cast: ?tab= is
// user-editable (and localStorage survives releases that rename tabs), and a
// stale value should land on the calendar rather than render nothing at all.
const TAB_IDS: TabId[] = [
  "appointments",
  "customers",
  "inbox",
  "voice",
  "messages",
  "revenue",
  "knowledge",
  "billing",
  "business",
  "account",
];
