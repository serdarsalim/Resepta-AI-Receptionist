"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import {
  onRecentCustomersChange,
  readRecentCustomers,
  type RecentCustomer,
} from "@/lib/recentCustomers";

// "Jump to another customer", offered under the header search while that box
// keeps filtering whatever the page is showing. Ported from Nudge's
// ContactJump, reasoning intact:
//
// The header search is contextual by design — on the contact page it filters
// that person's feed, and that stays. What it could not do is the thing you
// need several times an hour: look somebody else up without going back to
// Customers first. So the box does both, kept apart visually: the feed
// filters live, and matching CUSTOMERS appear in a list you have to click.
//
// Nothing opens on its own. Matches appear only once the query is long enough
// to be a real search; the recently-opened customers appear on focus with an
// empty box; picking a row is the only thing that navigates.
export function CustomerJump({
  query,
  anchor,
  focused,
  onPick,
}: {
  query: string;
  // The header's search wrapper. The list is measured off this so it lines up
  // with the input rather than the whole right-hand cluster.
  anchor: HTMLElement | null;
  // Whether the search input currently holds focus — the gate for recents,
  // which are the one thing shown with an empty box.
  focused: boolean;
  onPick: (customerId: string) => void;
}) {
  const { t } = useLanguage();
  const term = query.trim();
  // Below two characters the match set is most of the book; the backend
  // applies the same floor.
  const active = term.length >= 2;
  const results = useQuery(api.customers.quickSearch, active ? { q: term } : "skip");

  const [recents, setRecents] = useState<RecentCustomer[]>([]);
  // Read on mount and whenever a contact page records one — localStorage
  // fires no storage event in the tab that wrote it, hence the custom event.
  useEffect(() => {
    const sync = () => setRecents(readRecentCustomers());
    sync();
    return onRecentCustomersChange(sync);
  }, []);

  const showingRecents = focused && !active && recents.length > 0;
  const show = Boolean(anchor) && (active || showingRecents);

  // Positioned off the anchor per the house rule (useAnchoredPanel's comment):
  // portal + fixed, measured at show time — an absolute panel clips on the
  // header's overflow. That hook is trigger-click shaped, and this list is
  // driven by typing, so it measures the same way rather than through it.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!show || !anchor) {
      setPos(null);
      return;
    }
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.max(rect.width, 260);
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      setPos({ top: rect.bottom + 4, left, width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [show, anchor, term]);

  if (!show || !pos) return null;

  const rows: RecentCustomer[] = showingRecents
    ? recents
    : (results ?? []).map((r) => ({ id: r.id, name: r.name, phone: r.phone }));

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
      className="z-50 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
    >
      {/* The heading names which list this is. Without it, five names under
          an empty box read as search results for nothing typed. */}
      <div className="border-b border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted-strong)]">
        {showingRecents ? t("search.recent") : t("search.goToCustomer")}
      </div>
      {!showingRecents && results === undefined ? (
        <div className="px-3 py-2.5 text-xs text-[var(--muted)]">{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        // Says which search came up empty — the same box is also filtering
        // the page, so a bare "no results" would be ambiguous about which of
        // the two found nothing.
        <div className="px-3 py-2.5 text-xs text-[var(--muted)]">
          {t("search.noCustomers")}
        </div>
      ) : (
        <ul className="max-h-72 overflow-y-auto py-1">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                // A pair, each fixing a different way the row can vanish
                // before its click is honoured (Nudge's ContactJump, verbatim
                // reasoning): preventDefault on mousedown stops focus leaving
                // the input — blur would unmount the recents list under the
                // pointer. The pick itself is on CLICK, never mousedown —
                // navigating mid-press lets the click fall through to
                // whatever the new page renders under the cursor.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(r.id)}
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-[var(--muted-bg)]"
              >
                <span className="truncate text-xs text-[var(--foreground)]">
                  {r.name || r.phone}
                </span>
                {/* Phone disambiguates two people with one name; hidden when
                    it is already standing in for a blank name. */}
                {r.name && r.phone && (
                  <span className="ml-auto shrink-0 text-[11px] text-[var(--muted)]">
                    {r.phone}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}
