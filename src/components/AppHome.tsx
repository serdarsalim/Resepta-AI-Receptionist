"use client";

import { useEffect, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { AppShell, LEGACY_TABS, type TabId } from "@/components/AppShell";
import { AppointmentsView } from "@/components/AppointmentsView";
import { CustomersView } from "@/components/CustomersView";
import { RevenueView } from "@/components/RevenueView";
import { InboxView } from "@/components/InboxView";
import { BusinessView } from "@/components/BusinessView";
import { FrontDeskView } from "@/components/FrontDeskView";
import { AccountView } from "@/components/AccountView";
import { ContactView } from "@/components/ContactView";

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

  // The tab lives in the URL, so a refresh comes back where you were and a
  // link to Settings opens Settings. A bare URL falls back to the last tab
  // this browser was on: a new session resumes where the person left off
  // rather than resetting to the calendar. Read after mount rather than
  // during the first render: initialising state from window during render is
  // a hydration mismatch.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    // Retired ids first, from BOTH sources: a bookmark carries ?tab=voice, and
    // localStorage carries whichever tab this browser was last on before the
    // release that folded three entries into Front desk. Translating rather
    // than dropping them is the difference between landing where you meant to
    // and landing on the calendar wondering where Reminders went. The section
    // goes in before the tab, matching the order AppointmentsView uses when it
    // deep-links into Business, because the destination reads ?section on mount.
    const legacy = [wanted, stored].find((id): id is string => id !== null && id in LEGACY_TABS);
    if (legacy) {
      const { tab: to, section } = LEGACY_TABS[legacy];
      const url = new URL(window.location.href);
      url.searchParams.set("section", section);
      url.searchParams.set("tab", to);
      window.history.replaceState(null, "", url);
      window.localStorage.setItem(TAB_STORAGE_KEY, to);
      setTabState(to);
      return;
    }
    const next = [wanted, stored].find(
      (id): id is TabId => id !== null && TAB_IDS.includes(id as TabId),
    );
    if (next) setTabState(next);
  }, []);

  // Switching tabs always leaves the contact page, it belongs to Customers.
  const setTab = (next: TabId) => {
    setContactId(null);
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
    <AppShell tab={tab} onTab={setTab}>
      {contactId ? (
        <ContactView customerId={contactId} onClose={() => setContactId(null)} />
      ) : (
        <>
          {tab === "appointments" && (
            <AppointmentsView
              onOpenContact={setContactId}
              onEditHours={() => {
                // The section param goes in FIRST — BusinessView reads it on
                // mount, and the tab switch below is what mounts it.
                const url = new URL(window.location.href);
                url.searchParams.set("section", "hours");
                window.history.replaceState(null, "", url);
                setTab("business");
              }}
            />
          )}
          {tab === "customers" && <CustomersView onOpenContact={setContactId} />}
          {tab === "inbox" && <InboxView onOpenContact={setContactId} />}
          {tab === "revenue" && <RevenueView />}
          {tab === "frontdesk" && <FrontDeskView />}
          {/* "business", not "workspace": Fresha, Booksy, Square and Treatwell
              all call this Business, and a salon owner does not think of the
              salon as a workspace. */}
          {tab === "business" && <BusinessView />}
          {/* Personal, not org config. Only the avatar menu routes here. */}
          {tab === "account" && <AccountView />}
        </>
      )}
    </AppShell>
  );
}

const TAB_STORAGE_KEY = "randevu.tab";

// Every tab that may appear in the URL. Validated rather than cast: ?tab= is
// user-editable (and localStorage survives releases that rename tabs), and a
// stale value should land on the calendar rather than render nothing at all.
const TAB_IDS: TabId[] = [
  "appointments",
  "customers",
  "inbox",
  "frontdesk",
  "revenue",
  "business",
  "account",
];
