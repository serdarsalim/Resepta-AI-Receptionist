"use client";

import { useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { AppShell, type TabId } from "@/components/AppShell";
import { AppointmentsView } from "@/components/AppointmentsView";
import { CustomersView } from "@/components/CustomersView";
import { MessagesView } from "@/components/MessagesView";
import { SettingsView } from "@/components/SettingsView";
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
          {tab === "messages" && <MessagesView />}
          {tab === "settings" && <SettingsView />}
        </>
      )}
    </AppShell>
  );
}
