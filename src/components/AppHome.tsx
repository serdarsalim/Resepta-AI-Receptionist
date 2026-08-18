"use client";

import { useEffect, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { AppShell, type TabId } from "@/components/AppShell";
import { AppointmentsView } from "@/components/AppointmentsView";
import { CustomersView } from "@/components/CustomersView";
import { RevenueView } from "@/components/RevenueView";
import { InboxView } from "@/components/InboxView";
import { RemindersView } from "@/components/RemindersView";
import { CampaignsView } from "@/components/CampaignsView";
import { VoiceView } from "@/components/VoiceView";
import { BusinessView } from "@/components/BusinessView";
import { ServicesView } from "@/components/ServicesView";
import { AccountView } from "@/components/AccountView";
import { BillingView } from "@/components/BillingView";
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
        <ContactView
          customerId={contactId}
          onClose={() => setContactId(null)}
          onOpenContact={setContactId}
        />
      ) : (
        <>
          {tab === "appointments" && <AppointmentsView onOpenContact={setContactId} />}
          {tab === "customers" && <CustomersView onOpenContact={setContactId} />}
          {tab === "inbox" && <InboxView onOpenContact={setContactId} />}
          {tab === "campaigns" && <CampaignsView />}
          {tab === "voice" && <VoiceView />}
          {/* Content the business maintains, not configuration: the voice agent
              and the booking page both read it. */}
          {tab === "services" && <ServicesView />}
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
  "campaigns",
  "voice",
  "messages",
  "revenue",
  "services",
  "billing",
  "business",
  "account",
];
