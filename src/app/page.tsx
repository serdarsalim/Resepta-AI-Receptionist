"use client";

import { useEffect, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { AppShell, type TabId } from "@/components/AppShell";
import { AppointmentsView } from "@/components/AppointmentsView";
import { CustomersView } from "@/components/CustomersView";
import { RevenueView } from "@/components/RevenueView";
import { InboxView } from "@/components/InboxView";
import { CampaignsView } from "@/components/CampaignsView";
import { SettingsView } from "@/components/SettingsView";
import { BusinessView } from "@/components/BusinessView";
import { AccountView } from "@/components/AccountView";
import { ContactView } from "@/components/ContactView";

// Every tab that may appear in the URL. Validated rather than cast: ?tab= is
// user-editable, and a typo should land on the calendar rather than render
// nothing at all.
const TAB_IDS: TabId[] = [
  "appointments",
  "customers",
  "inbox",
  "campaigns",
  "revenue",
  "business",
  "settings",
  "account",
];

export default function Home() {
  const [tab, setTabState] = useState<TabId>("appointments");
  const [contactId, setContactId] = useState<Id<"customers"> | null>(null);

  // The tab lives in the URL, so a refresh comes back where you were and a
  // link to Settings opens Settings. Read after mount rather than during the
  // first render: this page is server-rendered, and initialising state from
  // window there is a hydration mismatch.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted && TAB_IDS.includes(wanted as TabId)) setTabState(wanted as TabId);
  }, []);

  // Switching tabs always leaves the contact page — it belongs to Customers.
  const setTab = (next: TabId) => {
    setContactId(null);
    setTabState(next);
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
          {tab === "appointments" && <AppointmentsView onOpenContact={setContactId} />}
          {tab === "customers" && <CustomersView onOpenContact={setContactId} />}
          {tab === "inbox" && <InboxView onOpenContact={setContactId} />}
          {tab === "campaigns" && <CampaignsView />}
          {tab === "revenue" && <RevenueView />}
          {/* "business", not "workspace": Fresha, Booksy, Square and Treatwell
              all call this Business, and a salon owner does not think of the
              salon as a workspace. */}
          {tab === "business" && <BusinessView />}
          {tab === "settings" && <SettingsView />}
          {/* Personal, not org config. Only the avatar menu routes here. */}
          {tab === "account" && <AccountView />}
        </>
      )}
    </AppShell>
  );
}
