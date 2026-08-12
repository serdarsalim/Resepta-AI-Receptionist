"use client";

// Inbox — every conversation with a customer, newest activity first.
// Master-detail: conversation list left, the shared ConversationPanel right.
// One row per CUSTOMER across all three channels; calls are a channel here,
// not a separate tab (ported from Nudge's InboxView).

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { useHeaderSearch } from "@/lib/HeaderSearch";
import { ConversationPanel, type FeedFilter } from "./ConversationPanel";
import { FeedFilterPills } from "./FeedFilterPills";

function formatAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function InboxView({
  onOpenContact,
}: {
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t } = useLanguage();
  const conversations = useQuery(api.messages.conversations, {});
  const setInboxPin = useMutation(api.messages.setInboxPin);
  const markInboxSeen = useMutation(api.messages.markInboxSeen);
  const markInboxLeft = useMutation(api.messages.markInboxLeft);
  const search = useHeaderSearch(t("common.search"));
  const [selected, setSelected] = useState<Id<"customers"> | null>(null);
  const didAutoSelect = useRef(false);
  // Re-snapped to the conversation's own channel on every select; "all" is
  // only the before-first-selection default.
  const [filter, setFilter] = useState<FeedFilter>("all");

  // Clear the SIDEBAR dot. This view only mounts while the Inbox tab is open,
  // so mounting IS "the user is looking at it". Re-runs when the newest inbound
  // moves, so mail arriving while they sit here counts as seen rather than
  // re-lighting the dot behind them.
  const newestInboundAt = Math.max(
    0,
    ...(conversations ?? []).map((c) => c.lastInboundAt),
  );
  useEffect(() => {
    void markInboxSeen({}).catch(() => {});
  }, [markInboxSeen, newestInboundAt]);
  // Grey's boundary, stamped on the way OUT — this is what makes a reply show
  // once and then go quiet. Separate clock from the sidebar's above: a boundary
  // that advanced on arrival would clear every grey marker before the reader
  // had a chance to read the row it was on. Empty deps: unmount only.
  useEffect(() => {
    return () => {
      void markInboxLeft({}).catch(() => {});
    };
  }, [markInboxLeft]);

  // Select once, when the list first arrives. Behind a ref so the mobile Back
  // action can return to the list without being immediately overridden.
  useEffect(() => {
    if (didAutoSelect.current || !conversations?.length) return;
    didAutoSelect.current = true;
    setSelected(conversations[0].customerId);
    setFilter(conversations[0].lastChannel);
  }, [conversations]);

  // Search reads the whole row, preview text included: a salon owner looks
  // for "the one who asked about balayage", not for a name they remember.
  const shown = (conversations ?? []).filter((c) =>
    search.matches(c.name, c.phone, c.email, c.lastBody),
  );

  const active = conversations?.find((c) => c.customerId === selected);

  return (
    // h-full, not flex-1: `main` in the shell is a block, so there's no flex
    // context to grow into — the height comes from the parent's resolved box.
    //
    // max-w-6xl is Nudge's page cap, and the reason the rows here were wider
    // than its rows despite an identical 2fr/3fr split: Nudge wraps every view
    // in `max-w-6xl w-full mx-auto`, Resepta's shell lets content run the full
    // width of `main`. Measured at a 1680px viewport, that was a 549px list
    // against Nudge's 462px. Kept local to the Inbox rather than moved into
    // AppShell because the calendar grid and the customers table are built to
    // spend whatever width they are given; a master-detail pane is not.
    // The lg:px-6 is part of the measurement, not decoration: Nudge's cap is
    // `max-w-6xl px-6`, so its content settles at 1224 - 51 = 1173 and its list
    // at 462. Capping without the padding left this 20px wide. Gated to lg
    // because the shell's own p-4 already pads the one-column phone layout, and
    // stacking both would eat the row.
    <div className="mx-auto flex h-full w-full min-h-0 min-w-0 max-w-6xl flex-col lg:px-6">
      <div
        className={`grid min-h-0 min-w-0 flex-1 gap-4 ${
          active
            ? "grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
            : "grid-cols-1"
        }`}
      >
        {/* Conversation list. On small screens it swaps with the open
            conversation instead of sharing the row. */}
        <section
          className={`${selected ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col`}
        >
          {/* This fixed-height track mirrors the right column's name +
              channel-pills row so both card borders start on the same
              horizontal line, which is the whole reason it exists. It held the
              search box for a while; search now lives in the header with every
              other tab's, so the track is back to spending its height on
              alignment alone. Load-bearing despite being empty — delete it and
              the two cards stop lining up. */}
          <div className="h-9 shrink-0 pb-1" aria-hidden />
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto card-raised">
            {conversations === undefined ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">
                {t("common.loading")}
              </p>
            ) : conversations.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">
                {t("inbox.empty")}
              </p>
            ) : shown.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">
                {t("table.noMatches")}
              </p>
            ) : (
              // The last row's divider would land on the card's own bottom
              // edge and read as a double rule.
              <ul className="[&>li:last-child>div]:after:hidden">
                {shown.map((c) => {
                  const isActive = c.customerId === selected;
                  const open = (next?: FeedFilter) => {
                    setSelected(c.customerId);
                    setFilter(next ?? c.lastChannel);
                  };
                  return (
                    <li key={c.customerId}>
                      {/* A div, not a button: it holds the pin toggle, and a
                          button can't nest inside a button. */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => open()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            open();
                          }
                        }}
                        // The LEFT BAR separates hover from selection, not the
                        // tint step: position survives fast scanning in a way
                        // a few percent of wash doesn't.
                        //
                        // The bar is NEUTRAL, not brand green, and that is a
                        // decision. Green in this product means exactly one
                        // thing, "I pinned this", and it is the marker on this
                        // row plus the dot on the sidebar's inbox tab. A green
                        // selection bar put that hue on a second job inside a
                        // single row, so the reader had to tell two greens
                        // apart at a glance. The bar only ever needed position and
                        // shape, and --foreground gives it both without
                        // borrowing the status hue. This is the only left-bar
                        // selection in the app, so nothing else drifts.
                        // The divider is INSET (after:inset-x-4) and starts
                        // where the text does. A full-bleed rule cuts the card
                        // into stacked boxes; an inset one reads as a list.
                        // It stays on the row rather than the li so the hover
                        // wash and the selection bar keep the full width.
                        className={`group relative flex min-h-[2.75rem] w-full cursor-pointer items-center gap-2.5 px-4 text-left transition-colors before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-[var(--border)] after:content-[''] ${
                          isActive
                            ? "bg-[var(--row-hover-bg)] before:bg-[var(--foreground)]"
                            : "hover:bg-[var(--row-hover-bg)]"
                        }`}
                      >
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            c.unseen || c.pinned ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {c.name || c.phone}
                        </span>

                        {/* THREE states, one hit area, ported from Nudge:
                            green (I pinned this) beats grey (they wrote since
                            my last visit) beats hollow (nothing). Rendered on
                            every row so the slot never changes width — the
                            hollow state simply fades in on row hover.

                            Only the PIN is a persistent act. Grey clears
                            itself when you leave the tab, so it is never a
                            backlog to work through by hand and never something
                            you have to dismiss. Clicking a grey row pins it;
                            clicking green unpins, and the row falls back to
                            grey if they wrote during this visit.

                            This replaced a channel strip of phone/mail/
                            WhatsApp glyphs. They were an action nobody took:
                            the row already opens on whichever channel the
                            newest message is on, so clicking a specific glyph
                            only mattered for STARTING a channel with no
                            history — rare enough to belong on the contact
                            page, not on every row of a triage list. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void setInboxPin({
                              customerId: c.customerId,
                              pinned: !c.pinned,
                            });
                          }}
                          title={
                            c.pinned
                              ? t("inbox.pinnedHint")
                              : c.unseen
                                ? t("inbox.unseenHint")
                                : t("inbox.pinHint")
                          }
                          aria-label={
                            c.pinned
                              ? t("inbox.pinned")
                              : c.unseen
                                ? t("inbox.unseen")
                                : t("inbox.notPinned")
                          }
                          aria-pressed={c.pinned}
                          className={
                            c.pinned
                              ? "h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full bg-[var(--brand)] transition-transform hover:scale-125"
                              : c.unseen
                                ? // --muted already flips per theme, so grey
                                  // needs no dark: variant. Smaller than the
                                  // pin inside the same slot, so the two
                                  // differ by size as well as hue.
                                  "h-2 w-2 shrink-0 cursor-pointer rounded-full bg-[var(--muted)] transition-transform hover:scale-125"
                                : "h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full border border-dashed border-[var(--muted)] opacity-0 transition-opacity hover:border-[var(--foreground)] group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                          }
                        />

                        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
                          {formatAgo(c.lastAt)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Open conversation — the same panel the contact page embeds, keyed by
            customer so composer drafts never leak across contacts. */}
        {active && (
          <section
            className={`${selected ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col`}
          >
            <div className="flex h-9 shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={t("common.back")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] lg:hidden"
              >
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
                  <path d="M19 12H5" />
                  <path d="m12 19-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onOpenContact(active.customerId)}
                // text-base, not text-sm: this is the heading for everything
                // in the right column, and at text-sm it weighed exactly the
                // same as a name in the list beside it.
                className="truncate text-base font-semibold hover:underline"
                title={t("inbox.openContact")}
              >
                {active.name || active.phone}
              </button>
              <FeedFilterPills
                customerId={active.customerId}
                value={filter}
                onChange={setFilter}
                className="ml-auto"
              />
            </div>
            <ConversationPanel
              key={active.customerId}
              customerId={active.customerId}
              contactName={active.name}
              lastInboundAt={active.awaitingReply ? active.lastAt : undefined}
              filter={filter}
              onFilterChange={setFilter}
              className="min-h-0 flex-1 overflow-hidden card-raised"
            />
          </section>
        )}
      </div>
    </div>
  );
}
