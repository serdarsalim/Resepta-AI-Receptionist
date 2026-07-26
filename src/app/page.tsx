"use client";

import { useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { AppShell, type TabId } from "@/components/AppShell";
import { AppointmentsView } from "@/components/AppointmentsView";
import { CustomersView } from "@/components/CustomersView";
import { RevenueView } from "@/components/RevenueView";
import { InboxView } from "@/components/InboxView";
import { SettingsView } from "@/components/SettingsView";
import { BusinessView } from "@/components/BusinessView";
import { AccountView } from "@/components/AccountView";
import { ContactView } from "@/components/ContactView";

export default function Home() {
  const [tab, setTabState] = useState<TabId>("appointments");
  const [contactId, setContactId] = useState<Id<"customers"> | null>(null);

  // Switching tabs always leaves the contact page — it belongs to Customers.
  const setTab = (next: TabId) => {
    setContactId(null);
    setTabState(next);
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
