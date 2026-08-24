"use client";

// Inbox — every conversation with a customer, newest activity first.
// Master-detail: conversation list left, the shared ConversationPanel right.
// One row per CUSTOMER across all three channels; calls are a channel here,
// not a separate tab (ported from Nudge's InboxView).

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { useHeaderSearch } from "@/lib/HeaderSearch";
import { ConversationPanel, type FeedFilter } from "./ConversationPanel";
import { FeedFilterPills } from "./FeedFilterPills";
import { FeedIcon, type FeedIconType } from "./FeedIcon";

// Which slice of the list the chips are showing. Persisted per browser under
// this key; the .v1 suffix is the escape hatch if the shape ever changes.
type InboxFilter = "all" | "unread" | "pinned";
const VIEW_STORAGE_KEY = "randevu.inbox.view.v1";

function formatAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// What the second line of a row says. Bodies arrive with the sender's own line
// breaks — a WhatsApp confirmation is three short lines — and a preview is one
// line by definition, so whitespace collapses before it is ever measured.
// Email bodies are already plain text by the time they reach here
// (`email.sendToCustomer` derives `body` from its html with htmlToText for
// exactly this reason), so nothing has to strip markup.
function previewOf(
  c: { lastBody?: string; lastChannel: FeedIconType },
  t: (k: TranslationKey) => string,
): string {
  const body = (c.lastBody ?? "").replace(/\s+/g, " ").trim();
  if (body) return body;
  // A call, a form arrival and a bare note can all land with no body. Naming
  // the KIND beats an empty line: "Arama" tells you what to expect on open,
  // blank tells you the row is broken.
  //
  // A WhatsApp or email row with no body is a different thing — it is a queued
  // TEMPLATE whose text has not been rendered yet. The thread already says so
  // (`snippet || t("message.template")` in ConversationPanel), and the row has
  // to agree with the thread it opens: naming the channel there produced
  // "Siz: WhatsApp", which reads as a bug rather than a message.
  return t(
    c.lastChannel === "form"
      ? "forms.title"
      : c.lastChannel === "note"
        ? "notes.title"
        : c.lastChannel === "call"
          ? "channel.call"
          : "message.template",
  );
}

export function InboxView({
  onOpenContact,
}: {
  onOpenContact: (
    id: Id<"customers">,
    channel?: FeedFilter,
    itemId?: string,
  ) => void;
}) {
  const { t } = useLanguage();
  const conversations = useQuery(api.messages.conversations, {});
  const setInboxPin = useMutation(api.messages.setInboxPin);
  const markConversationRead = useMutation(api.messages.markConversationRead);
  const search = useHeaderSearch(t("common.search"));
  const [selected, setSelected] = useState<Id<"customers"> | null>(null);
  // Re-snapped to the conversation's own channel on every select; "all" is
  // only the before-first-selection default.
  const [filter, setFilter] = useState<FeedFilter>("all");
  // Which slice of the list. Persisted per browser: a filter is a working
  // context ("I'm on my unread"), and re-picking it on every visit is the same
  // friction the filter exists to remove. Safe to persist only because the
  // active chip is always visible — a hidden sticky filter is the version of
  // this that traps people. Read in an effect, never during render: the server
  // has no localStorage and a render-time read is a hydration mismatch.
  const [view, setView] = useState<InboxFilter>("all");
  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "unread" || stored === "pinned") setView(stored);
  }, []);
  const chooseView = (next: InboxFilter) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // A browser with storage disabled or full still gets the filter, it just
      // does not get to keep it.
    }
  };

  // The "a reply landed while you were sitting in this thread" re-stamp lived
  // here. It cannot happen any more: opening a row LEAVES this view, so no
  // conversation is ever being watched from the inbox. The row stamps on its
  // way out and that is the whole of it.

  // NOTHING is selected on arrival (Serdar, 2026-08-17, matching Nudge). The
  // inbox used to open the newest conversation for you, which is the app
  // deciding what you came here to read — and on a list where the top row moves
  // whenever anyone writes, the thing it opens is different every visit. An
  // inbox is a list you choose from.
  //
  // This also retires the `opened` / `selected` split. That existed because
  // auto-select had to be distinguishable from a real open: the auto-selected
  // conversation must not get a read stamp, or landing on the Inbox would
  // silently mark the newest thread read. With no auto-select there is only one
  // kind of selection left, and `opened` is now simply "the one you clicked".

  // Counts for the chip labels, over the UNFILTERED list: a chip advertises
  // what switching to it would show, so it cannot count through itself.
  const unseenCount = (conversations ?? []).filter((c) => c.unseen).length;
  const pinnedCount = (conversations ?? []).filter((c) => c.pinned).length;

  // Search reads the whole row, preview text included: a salon owner looks
  // for "the one who asked about balayage", not for a name they remember.
  //
  // A live query OVERRIDES the chip, per this app's search rule: a query must
  // never fail to find a match that exists in the data. Searching from the
  // Pinned chip and getting nothing, because the person you looked for was
  // simply not pinned, is the failure that rule exists to prevent.
  const shown = (conversations ?? []).filter(
    (c) =>
      (search.active ||
        view === "all" ||
        (view === "unread" ? c.unseen : c.pinned)) &&
      search.matches(c.name, c.phone, c.email, c.lastBody),
  );

  // Falls back outside the filtered list on purpose: opening an unread
  // conversation while the Unread chip is active would otherwise blank the
  // right pane the instant its read stamp landed and the row dropped out.
  const active =
    shown.find((c) => c.customerId === selected) ??
    conversations?.find((c) => c.customerId === selected);

  return (
    // h-full, not flex-1: `main` in the shell is a block, so there's no flex
    // context to grow into — the height comes from the parent's resolved box.
    //
    // NO WIDTH CAP, and that is the whole point of this line. It carried
    // `max-w-6xl lg:px-6` — Nudge's page cap, ported so these rows would
    // measure the same as Nudge's rather than spending the full width of
    // `main`. ContactView has never had it, so the two screens ran the same
    // 2fr/3fr split inside containers of different widths, and their panes
    // could not line up however the ratio was tuned.
    //
    // Now that a row opens the contact record, those two right-hand panes are
    // the same pane one click apart. Matching them means matching the
    // container, not the ratio, and ContactView is the one to match: it is
    // where the reading happens. Keep this in step with ContactView's grid if
    // either moves.
    <div
      data-fills-pane
      className="flex h-full w-full min-h-0 min-w-0 flex-col"
    >
      {/* Always two columns from lg, whether or not anything is open. It used
          to collapse to one when nothing was selected, which was invisible back
          when the only way to have nothing selected was to back out on a phone
          — where the layout is one column anyway. Now that the inbox ARRIVES
          with nothing selected, that rule put the empty state underneath the
          list instead of beside it. Below lg it is still one column and the two
          panes swap. */}
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Conversation list. On small screens it swaps with the open
            conversation instead of sharing the row. */}
        <section
          className={`${selected ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col`}
        >
          <div className="card-raised flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* The list's header, inside the card it filters.

              It used to be a bare track ABOVE the card, and its stated job was
              to mirror the right column's name row so both card tops landed on
              the same line. Both header rows moved inside their own cards, so
              the two cards now start at the same y with nothing scaffolding
              them, and the alignment that track existed to buy is free.

              ONE LINE ONLY — a second row of chips spills rather than pushing
              the list down. */}
          <div className="flex h-11 shrink-0 items-center gap-1.5 px-3">
            {(
              [
                ["all", t("inbox.filterAll"), 0],
                ["unread", t("inbox.filterUnread"), unseenCount],
                ["pinned", t("inbox.filterPinned"), pinnedCount],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => chooseView(key)}
                className={`inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-sm transition-colors ${
                  view === key
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 font-semibold text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--card)] font-medium text-[var(--foreground)]/75 hover:text-[var(--foreground)]"
                }`}
              >
                {label}
                {/* Zero renders nothing: a row of noughts is noise. */}
                {count > 0 && <span className="tabular-nums">{count}</span>}
              </button>
            ))}
          </div>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            {conversations === undefined ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">
                {t("common.loading")}
              </p>
            ) : conversations.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">
                {t("inbox.empty")}
              </p>
            ) : shown.length === 0 ? (
              // Per-filter, not one generic line: an empty Pinned list is the
              // best place to say what a pin even is, and "no matches" under an
              // active chip reads as a broken search.
              <p className="px-4 py-3 text-sm text-[var(--muted)]">
                {search.active
                  ? t("table.noMatches")
                  : view === "unread"
                    ? t("inbox.noUnread")
                    : view === "pinned"
                      ? t("inbox.noPinned")
                      : t("table.noMatches")}
              </p>
            ) : (
              // The last row's divider would land on the card's own bottom
              // edge and read as a double rule.
              <ul className="[&>li:last-child>div]:after:hidden">
                {shown.map((c) => {
                  const isActive = c.customerId === selected;
                  // TRIAL (2026-08-22): a row opens the CONTACT PAGE instead
                  // of filling the pane beside it. The inbox and the contact
                  // page were two master-detail screens sharing a right half,
                  // and going "deeper" from a conversation showed you that
                  // same conversation again with a record added, so arriving
                  // somewhere felt like staying put.
                  //
                  // The right pane is left standing on purpose. If this reads
                  // worse than it sounds, putting the split back is restoring
                  // three lines, not rebuilding a screen.
                  const open = () => {
                    // Read before we leave: nothing is left mounted here to
                    // stamp it afterwards.
                    void markConversationRead({ customerId: c.customerId }).catch(
                      () => {},
                    );
                    // The record opens on the channel this row was showing.
                    // The old split pane did the same thing to its own filter
                    // (`setFilter(next ?? c.lastChannel)`); losing it when the
                    // row started navigating meant clicking a WhatsApp row
                    // landed on the mixed feed, where you had to find that
                    // same thread again by hand.
                    // ...and ON the mail or call the row was previewing. The
                    // channel alone lands on an index for email and calls, so
                    // a row quoting one line of six put the reader back in
                    // front of the recognition problem their click was meant
                    // to solve.
                    onOpenContact(c.customerId, c.lastChannel, c.lastId);
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
                        // TWO LINES, iMessage's shape: who, then what they
                        // said. The row carried only a name and an age, which
                        // made the list a directory rather than a triage
                        // queue — every question you came here with ("who
                        // still needs an answer", "did that confirmation go
                        // out") cost a click each. The backend was already
                        // handing over lastBody, lastChannel, lastDirection
                        // and hasFailed; search had been reading lastBody the
                        // whole time, so the row was the only thing on this
                        // screen that could not see it.
                        className={`group relative flex min-h-[3.5rem] w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left transition-colors before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-[var(--border)] after:content-[''] ${
                          isActive
                            ? "bg-[var(--row-hover-bg)] before:bg-[var(--foreground)]"
                            : "hover:bg-[var(--row-hover-bg)]"
                        }`}
                      >
                        {/* THE ROW'S ONE DOT, in a gutter down the left edge —
                            WhatsApp's placement, and the reason for it is
                            scanning: one vertical sweep answers "what needs
                            me", where a marker parked after each name has to
                            be hunted for at a different x on every row.

                            THREE states, one hit area: violet (I pinned this)
                            beats brand green (they wrote and I haven't opened
                            it) beats hollow (I could pin this). The pin wins
                            because it is a decision and green is a fact that
                            clears itself the moment you open the row — if
                            green won, pinning a new conversation would look
                            like it did nothing. Clicking a green row pins it;
                            unpinning falls back to green while the thread is
                            still unopened.

                            The two lit states differ by HUE at one size:
                            violet has no other job in this app, and green is
                            the same unread fact the sidebar's dot reports off
                            the same rule (messages.ts inboxUnseenCount: "ONE
                            RULE, TWO READERS").

                            The slot is always rendered and only sometimes lit,
                            so names sit on one left edge whatever their state
                            and the row never re-indents; the hollow ring fades
                            in on hover. It spans BOTH lines rather than
                            sitting on line one, so the dot marks the
                            conversation, not the name.

                            This merges what were two markers — an unread dot
                            here and a pin dot after the name. Splitting them
                            put the row's status on the left and its one action
                            on the right, so the eye crossed the name twice to
                            read one conversation, and the pin sat in the
                            column where the age lives. Nudge's inbox has run
                            the merged control long enough to trust it. */}
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
                                ? t("inbox.unseenPinHint")
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
                              ? "h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full bg-violet-500 transition-transform hover:scale-125"
                              : c.unseen
                                ? "h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full bg-[var(--brand)] transition-transform hover:scale-125"
                                : "h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full border border-dashed border-[var(--muted)] opacity-0 transition-opacity hover:border-[var(--foreground)] group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                          }
                        />
                        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                        {/* Line one — name and age. The pin used to sit
                            between them; it is the gutter dot now. */}
                        <div className="flex w-full items-center gap-2.5">
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            c.unseen || c.pinned ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {c.name || c.phone}
                        </span>

                        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
                          {formatAgo(c.lastAt)}
                        </span>
                        </div>

                        {/* Line two: which channel, whose turn, what was
                            said. The glyph is NOT the channel strip that was
                            deleted in 49ed336 — that was a row of buttons
                            offering to start a channel, an action nobody
                            took. This one is a single un-clickable mark
                            answering "where did this happen", which is the
                            question you have when the same person reaches you
                            on WhatsApp and by mail.

                            "not sent" outranks the preview and wears
                            --now-line, the one red in this app that already
                            means a moment rather than a danger state. A
                            reminder that silently failed is the worst thing
                            this product can do quietly, and it was visible
                            only by opening the thread. */}
                        <div className="flex w-full items-center gap-1.5 text-xs">
                          <FeedIcon type={c.lastChannel} size={13} />
                          {c.hasFailed && (
                            <span className="shrink-0 font-medium text-[var(--now-line)]">
                              {t("message.failed")}
                            </span>
                          )}
                          <span
                            className={`min-w-0 flex-1 truncate ${
                              c.unseen
                                ? "text-[var(--muted-strong)]"
                                : "text-[var(--muted)]"
                            }`}
                          >
                            {c.lastDirection === "out" && (
                              <span className="text-[var(--muted)]">
                                {t("inbox.youPrefix")}{" "}
                              </span>
                            )}
                            {previewOf(c, t)}
                          </span>
                        </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          </div>
        </section>

        {/* Nothing chosen yet. Below lg the list owns the screen and this never
            shows — there is no second column there to be empty. */}
        {!active && (
          <section className="hidden min-h-0 min-w-0 flex-col lg:flex">
            <div className="card-raised flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-[var(--muted)]">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p className="text-sm">{t("inbox.selectConversation")}</p>
            </div>
          </section>
        )}

        {/* Open conversation — the same panel the contact page embeds, keyed by
            customer so composer drafts never leak across contacts. */}
        {active && (
          <section
            className={`${selected ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col`}
          >
            <div className="card-raised flex min-h-0 flex-1 flex-col overflow-hidden">
            <ConversationPanel
              key={active.customerId}
              customerId={active.customerId}
              contactName={active.name}
              lastInboundAt={active.awaitingReply ? active.lastAt : undefined}
              filter={filter}
              onFilterChange={setFilter}
              className="min-h-0 flex-1 overflow-hidden"
              // Handed to the panel rather than drawn above it, so the pane's
              // identity and whatever the open tab offers share ONE line. Drawn
              // here it sat over a second band holding a single button with the
              // card's whole width empty beside it. The panel keeps owning the
              // action because it owns the state behind it (composing, noteOpen,
              // canPlaceCall); this side only supplies who the conversation is
              // with and where the name goes when clicked.
              header={
                <>
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
                //
                // The chevron is what says the name goes somewhere. A
                // hover-underline is only found by people who already
                // suspected, and this is the only route from a conversation to
                // the record behind it. It is the same mark the feed rows use
                // for "open this", at rest in --muted so a heading does not
                // arrive wearing a control, and it lifts with the name.
                className="group/name flex min-w-0 shrink items-center gap-1 text-base font-semibold"
                title={t("inbox.openContact")}
              >
                <span className="truncate group-hover/name:underline">
                  {active.name || active.phone}
                </span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="shrink-0 text-[var(--muted)] transition-colors group-hover/name:text-[var(--foreground)]"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
              <FeedFilterPills
                customerId={active.customerId}
                value={filter}
                onChange={setFilter}
              />
                </>
              }
            />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
