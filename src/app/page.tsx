"use client";

import { useState } from "react";
import { AppShell, type TabId } from "@/components/AppShell";
import { AppointmentsView } from "@/components/AppointmentsView";
import { CustomersView } from "@/components/CustomersView";
import { MessagesView } from "@/components/MessagesView";
import { SettingsView } from "@/components/SettingsView";

export default function Home() {
  const [tab, setTab] = useState<TabId>("appointments");
  return (
    <AppShell tab={tab} onTab={setTab}>
      {tab === "appointments" && <AppointmentsView />}
      {tab === "customers" && <CustomersView />}
      {tab === "messages" && <MessagesView />}
      {tab === "settings" && <SettingsView />}
    </AppShell>
  );
}
