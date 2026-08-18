"use client";

// The last few customers actually OPENED, for the header's jump list.
//
// Ported from Nudge's recentContacts, reasoning included: deliberately not
// "recent searches". Replaying the string you typed makes you pick the person
// out of a result list a second time; the thing you wanted was never the
// query, it was Ayşe. Storing the person also can't go stale into a term that
// no longer matches anything.
//
// localStorage rather than module scope — this SHOULD survive a reload. Per
// browser, never synced: where you have been is not something a colleague
// should inherit.
const KEY = "randevu.recentCustomers.v1";
const EVENT = "randevu:recent-customers";

// Five — the Slack/Linear/Notion quick-switcher band, and it fits under the
// eight search results the panel shows without the list needing to scroll.
export const RECENT_LIMIT = 5;

export type RecentCustomer = {
  id: string;
  name: string;
  phone: string;
};

function isRecent(value: unknown): value is RecentCustomer {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id !== "" &&
    typeof r.name === "string" &&
    typeof r.phone === "string"
  );
}

export function readRecentCustomers(): RecentCustomer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validate every row rather than trusting the blob: the key outlives any
    // future change to its shape, and one bad entry must not take the whole
    // list (or the header) down.
    return parsed.filter(isRecent).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

// Called when a contact page opens, whatever route opened it — the jump list,
// the Customers table, the Inbox, the calendar. Recording at the point of
// OPENING makes the list useful on the very first use, instead of only after
// the jump has been used a few times.
export function rememberCustomer(customer: RecentCustomer): void {
  if (typeof window === "undefined" || !customer.id) return;
  try {
    const next = [
      customer,
      ...readRecentCustomers().filter((r) => r.id !== customer.id),
    ].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    // The header's list lives in a different component tree, and a
    // localStorage write fires no storage event in the tab that made it.
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // A full or disabled localStorage must not break navigation.
  }
}

export function onRecentCustomersChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
