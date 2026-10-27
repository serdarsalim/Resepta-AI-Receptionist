"use client";

// Inbox — every conversation with a customer, newest activity first.
// Master-detail: conversation list left, the shared ConversationPanel right.
// One row per CUSTOMER across all three channels; calls are a channel here,
// not a separate tab (ported from Nudge's InboxView).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  optimisticallyUpdateValueInPaginatedQuery,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { mediaKindKey } from "@/lib/mediaLabel";
import { useHeaderSearch } from "@/lib/HeaderSearch";
import { resetUnreadVisit, useUnreadVisit } from "@/lib/useUnreadVisit";
import { ConversationPanel, type FeedFilter } from "./ConversationPanel";
import { ContactRecord, JOINED_PANES, PANE_DIVIDER, TWO_PANE_COLUMNS } from "./ContactView";
import { FeedFilterPills } from "./FeedFilterPills";
import { FeedIcon, type FeedIconType } from "./FeedIcon";
import { RowMenu } from "./RowMenu";
import { HoverTip } from "./HoverTip";
import { filterPillClass } from "./filterPill";
import { ContextMenu, MenuIcon, useContextMenu, type ContextMenuItem } from "./ContextMenu";

// Which slice of the list the chips are showing. Persisted per browser under
// this key; the .v1 suffix is the escape hatch if the shape ever changes.
type InboxFilter = "all" | "unread" | "pinned";
const VIEW_STORAGE_KEY = "randevu.inbox.view.v1";
// How many conversations a page of the Inbox asks for (P13, Nudge's 50).
const INBOX_PAGE = 50;
// One Inbox row as the server sends it (messages.conversationRow).
type ConversationRow = FunctionReturnType<typeof api.messages.inboxSearch>[number];

// A line at the foot of the list that asks for the next page when it scrolls
// into view (300px early, so the next rows are there before the reader is).
function LoadMoreSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const callback = useRef(onVisible);
  useEffect(() => {
    callback.current = onVisible;
  });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callback.current();
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} aria-hidden className="h-px" />;
}

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
  c: {
    lastBody?: string;
    lastChannel: FeedIconType;
    lastMediaContentType?: string;
    lastMediaFileName?: string;
  },
  t: (k: TranslationKey) => string,
): string {
  const body = (c.lastBody ?? "").replace(/\s+/g, " ").trim();
  if (body) return body;
  // An uncaptioned attachment has no words to preview, but it is emphatically
  // not the queued template the fallback below describes. Naming the kind is
  // what the salon needs off a list: "Sesli mesaj" is a thing to go and
  // listen to, "Şablon mesajı" was a lie about what had arrived.
  if (c.lastMediaContentType) {
    return t(mediaKindKey(c.lastMediaContentType, c.lastMediaFileName));
  }
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

// The filter row's ⋯ menu (Nudge convention): bulk verbs live behind it so the
// row stays one line. One item today — mark all as read, carrying the same
// count the Unread chip advertises. The shared RowMenu since 2026-10-13; this
// copy positioned itself and closed whenever anything scrolled.
function InboxMenu({
  unseenCount,
  onMarkAllRead,
}: {
  unseenCount: number;
  onMarkAllRead: () => void;
}) {
  const { t } = useLanguage();
  return (
    <span className="ml-auto shrink-0">
      <RowMenu
        trigger="pill"
        label={t("inbox.menu")}
        items={[
          {
            key: "read",
            label: t("inbox.markAllRead"),
            // The chip's rule again: zero renders nothing.
            hint: unseenCount > 0 ? String(unseenCount) : undefined,
            disabled: unseenCount === 0,
            onSelect: onMarkAllRead,
          },
        ]}
      />
    </span>
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
  const markConversationRead = useMutation(api.messages.markConversationRead);
  const markAllRead = useMutation(api.messages.markAllConversationsRead);
  const setMuted = useMutation(api.customers.setMuted);
  // The header box also finds any customer (P13): the Inbox lists only
  // people with a conversation, and the one you want may have none.
  const jumpToCustomer = useCallback(
    (customerId: string) => onOpenContact(customerId as Id<"customers">),
    [onOpenContact],
  );
  const search = useHeaderSearch(t("common.search"), jumpToCustomer);
  const [selected, setSelected] = useState<Id<"customers"> | null>(null);
  // Re-snapped to the conversation's own channel on every select; "all" is
  // only the before-first-selection default.
  const [filter, setFilter] = useState<FeedFilter>("all");
  // The Details tab: the customer's record in place of the feed (Nudge's,
  // 2026-10-26). A tab, not a third column, so the chat keeps its width.
  // Every open snaps back to the conversation, as it snaps the channel.
  const [details, setDetails] = useState(false);
  // WHICH mail or call the row was quoting, so the email and call tabs open
  // on it instead of on their list. Applied once per conversation (the panel
  // is keyed on the customer).
  const [openedItemId, setOpenedItemId] = useState<string | undefined>(undefined);
  const pickFilter = (next: FeedFilter) => {
    setDetails(false);
    setFilter(next);
  };
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
  // The list, a page at a time, filtered by the chip on the server (P13,
  // messages.inboxPage); a search goes to the server too, over every
  // conversation (messages.inboxSearch), and overrides the chip, per this
  // app's search rule: a query must never fail to find a match that exists.
  const paged = usePaginatedQuery(
    api.messages.inboxPage,
    search.active ? "skip" : { view },
    { initialNumItems: INBOX_PAGE },
  );
  // Optimistic, the pin and the unread mark both: the dot should change on
  // the click, not a round trip later. Only the list as it is showing now is
  // patched; the server's answer replaces it a moment after.
  const patchRow = (
    localStore: Parameters<typeof optimisticallyUpdateValueInPaginatedQuery>[0],
    customerId: Id<"customers">,
    change: { pinned?: boolean; unseen?: boolean },
  ) =>
    optimisticallyUpdateValueInPaginatedQuery(
      localStore,
      api.messages.inboxPage,
      { view },
      (row) => (row.customerId === customerId ? { ...row, ...change } : row),
    );
  const setInboxPinMutation = useMutation(api.messages.setInboxPin).withOptimisticUpdate(
    (localStore, args) => patchRow(localStore, args.customerId, { pinned: args.pinned }),
  );
  const markConversationUnread = useMutation(
    api.messages.markConversationUnread,
  ).withOptimisticUpdate((localStore, args) =>
    patchRow(localStore, args.customerId, { unseen: true }),
  );
  const searched = useQuery(
    api.messages.inboxSearch,
    search.active ? { q: search.query } : "skip",
  );
  const counts = useQuery(api.messages.inboxCounts, {});
  const conversations = search.active
    ? searched
    : paged.status === "LoadingFirstPage"
      ? undefined
      : paged.results;
  const chooseView = (next: InboxFilter) => {
    // Picking a chip, the lit one included, starts a fresh visit: the rows
    // kept read in Unread go.
    resetUnreadVisit();
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // A browser with storage disabled or full still gets the filter, it just
      // does not get to keep it.
    }
  };


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

  // Counts for the chip labels, from the server over every conversation (not
  // only the loaded pages): a chip advertises what switching to it would show.
  const unseenCount = counts?.unread ?? 0;
  const pinnedCount = counts?.pinned ?? 0;

  // Search reads the whole row, preview text included: a salon owner looks
  // for "the one who asked about balayage", not for a name they remember.
  //
  // A live query OVERRIDES the chip, per this app's search rule: a query must
  // never fail to find a match that exists in the data. Searching from the
  // Pinned chip and getting nothing, because the person you looked for was
  // simply not pinned, is the failure that rule exists to prevent.
  // Rows opened during this visit to Unread stay listed, without their dot
  // (lib/useUnreadVisit). Per business: kept rows never cross a switch.
  const orgId = useQuery(api.orgs.current, {})?.org._id;
  const unreadVisit = useUnreadVisit(
    conversations ?? [],
    view === "unread" && !search.active && orgId ? orgId : null,
  );
  const shown = conversations === undefined ? [] : unreadVisit.rows;
  const setInboxPin = async (args: { customerId: Id<"customers">; pinned: boolean }) => {
    await setInboxPinMutation(args);
    unreadVisit.patch(args.customerId, { pinned: args.pinned });
  };

  // Falls back outside the loaded list on purpose: opening an unread
  // conversation while the Unread chip is active would otherwise blank the
  // right pane the instant its read stamp landed and the row dropped out, and
  // a conversation past the loaded pages must still fill it.
  const inList = shown.find((c) => c.customerId === selected);
  const openedRow = useQuery(
    api.messages.inboxConversation,
    selected && !inList ? { customerId: selected } : "skip",
  );
  const active = inList ?? openedRow ?? undefined;

  // A reply that lands while its conversation is open beside the list is
  // read: the person is looking at it. The click stamps the open itself; this
  // covers what arrives after.
  const activeUnseen = active?.unseen === true;
  useEffect(() => {
    if (!selected || !activeUnseen) return;
    void markConversationRead({ customerId: selected }).catch(() => {});
  }, [selected, activeUnseen, markConversationRead]);

  // A row opens its conversation BESIDE the list, Nudge's Inbox (Serdar,
  // 2026-10-27, ending the 2026-08-22 trial that left the Inbox for the full
  // record on every click and reloaded the list on the way back). It opens on
  // the channel the row was showing, and ON the mail or call it was quoting,
  // so a click lands where the preview pointed. The record is the Details
  // tab; the whole page is the name in the header and the row menu.
  const openRow = (c: ConversationRow) => {
    unreadVisit.keep(c);
    // A read that failed releases the kept row, or it would show read
    // over a conversation the server still calls unread.
    void markConversationRead({ customerId: c.customerId }).catch(() =>
      unreadVisit.remove([c.customerId]),
    );
    setSelected(c.customerId);
    setFilter(c.lastChannel ?? "all");
    setOpenedItemId(c.lastId);
    setDetails(false);
  };

  // The row menu, WhatsApp Web's chat-row menu cut to what a salon needs
  // (P21, Nudge 2a94bb92): right-click a row (opens at the cursor) or its
  // chevron on touch (opens under it). ONE menu for the list, aimed at whichever row
  // asked. Left out with Nudge's reasons: archive, block, clear and delete
  // (destructive or meaningless here), favourites (the pin is that),
  // add to contacts (everyone here is one).
  const rowMenu = useContextMenu<Id<"customers">>(4);
  // The menu acts on the row as it is NOW (a reply may have landed, or the
  // pin flipped, since it opened).
  const menuRow = rowMenu.target
    ? (shown.find((c) => c.customerId === rowMenu.target) ?? null)
    : null;
  const markRowUnread = (c: ConversationRow) => {
    // WhatsApp closes the chat you mark unread, and an open pane re-stamps
    // what it shows, which would undo this a moment later.
    if (selected === c.customerId) setSelected(null);
    // Out of this visit's kept rows too, or the visit would keep painting
    // the row read over the server's unread.
    unreadVisit.remove([c.customerId]);
    void markConversationUnread({ customerId: c.customerId }).catch(() => {});
  };
  const menuItems: ContextMenuItem[] = menuRow
    ? [
        {
          key: "open",
          icon: <MenuIcon name="contact" />,
          label: t("inbox.openContact"),
          onSelect: () => onOpenContact(menuRow.customerId),
        },
        {
          key: "pin",
          icon: <MenuIcon name={menuRow.pinned ? "unpin" : "pin"} />,
          label: menuRow.pinned ? t("inbox.menuUnpin") : t("inbox.menuPin"),
          onSelect: () =>
            void setInboxPin({
              customerId: menuRow.customerId,
              pinned: !menuRow.pinned,
            }).catch(() => {}),
        },
        menuRow.unseen
          ? {
              key: "read",
              icon: <MenuIcon name="read" />,
              label: t("inbox.markRead"),
              onSelect: () =>
                void markConversationRead({ customerId: menuRow.customerId }).catch(
                  () => {},
                ),
            }
          : {
              key: "unread",
              icon: <MenuIcon name="unread" />,
              label: t("inbox.markUnread"),
              onSelect: () => markRowUnread(menuRow),
            },
        // Mute only, never Unmute: a muted customer leaves the Inbox, so no
        // row here can be muted already. The record's switch brings them back.
        {
          key: "mute",
          icon: <MenuIcon name="mute" />,
          label: t("inbox.menuMute"),
          onSelect: () => {
            // A muted customer leaves the Inbox, kept or not.
            unreadVisit.remove([menuRow.customerId]);
            void setMuted({ customerId: menuRow.customerId, muted: true }).catch(
              () => {},
            );
          },
        },
      ]
    : [];
  // The row that wears the lit fill: the one open beside the list, else the
  // one whose menu is open, so the reader can see what the menu is about.
  const litId = selected ?? rowMenu.target;

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
    // container AND the split, and ContactView is the one to match: it is
    // where the reading happens. The split is one constant now,
    // TWO_PANE_COLUMNS, exported from there, so the two cannot drift. The
    // cap that matters lives in it: the LEFT column stops at 32rem.
    <div
      data-fills-pane
      data-bleeds-right
      className="flex h-full w-full min-h-0 min-w-0 flex-col"
    >
      {/* Always two columns from lg, whether or not anything is open. It used
          to collapse to one when nothing was selected, which was invisible back
          when the only way to have nothing selected was to back out on a phone
          — where the layout is one column anyway. Now that the inbox ARRIVES
          with nothing selected, that rule put the empty state underneath the
          list instead of beside it. Below lg it is still one column and the two
          panes swap. */}
      {/* One card around list and thread, a divider between them
          (JOINED_PANES, P22): they are one working surface. The gutter went
          from gap-4 to gap-2 on 2026-08-28 for that reason and is gone now. */}
      <div className={`grid min-h-0 min-w-0 flex-1 grid-cols-1 ${JOINED_PANES} ${TWO_PANE_COLUMNS}`}>
        {/* Conversation list. On small screens it swaps with the open
            conversation instead of sharing the row. It reads in the comms
            face (.chat-font, P31), like the conversation beside it. */}
        <section
          className={`${selected ? "hidden lg:flex" : "flex"} chat-font min-h-0 min-w-0 flex-col`}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* The list's header, inside the card it filters.

              It used to be a bare track ABOVE the card, and its stated job was
              to mirror the right column's name row so both card tops landed on
              the same line. Both header rows moved inside their own panes, and
              since P22 both panes are one card, so they start at the same y
              with nothing scaffolding them.

              ONE LINE ONLY — a second row of chips spills rather than pushing
              the list down. */}
          {/* All / Unread / Pinned, always all three, exactly one lit, and a
              lit chip never toggles off (P21, Nudge fe3baf2d, reversing the
              2026-08-25 "no All chip"). They are a radio, and a radio needs a
              visible off: "show me everything again" had become clicking the
              lit chip a second time, a gesture you had to already know about.
              Bulk verbs live behind the menu on the right instead of widening
              this row. Nudge also filters by owner here; a Resepta
              conversation has no owner, so there is no fourth pill. The row
              scrolls sideways in a narrow pane rather than growing a second
              line. */}
          <div className="flex h-11 shrink-0 items-center gap-1.5 px-3">
            <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {(
              [
                ["all", t("inbox.filterAll"), 0],
                ["unread", t("inbox.filterUnread"), unseenCount],
                ["pinned", t("inbox.filterPinned"), pinnedCount],
              ] as const
            ).map(([key, label, count]) => {
              // The unread count stops at the scan's cap. The chip shows the
              // bare number (Nudge bff29139 dropped the "+"), and the hover
              // and the accessible name say it is a floor.
              const atLeast =
                key === "unread" && counts?.unreadCapped && count > 0
                  ? t("inbox.unreadAtLeast", { n: count })
                  : undefined;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  aria-label={atLeast}
                  title={atLeast}
                  onClick={() => chooseView(key)}
                  className={filterPillClass(view === key)}
                >
                  {/* gap-1, tighter than the pill's own: the number belongs
                      to its word (Nudge ea44f67c). */}
                  <span className="inline-flex items-center gap-1">
                    {label}
                    {/* Zero renders nothing: a row of noughts is noise. A
                        size smaller than the word, so the count reads as a
                        fact about the chip, not a second label. */}
                    {count > 0 && (
                      <span className="text-xs font-medium tabular-nums opacity-75">
                        {count}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            </div>
            <InboxMenu
              unseenCount={unseenCount}
              onMarkAllRead={() => void markAllRead({})}
            />
          </div>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            {conversations === undefined ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">
                {t("common.loading")}
              </p>
            ) : shown.length === 0 && !search.active && view === "all" ? (
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
                {shown.map((c, i) => {
                  const isActive = c.customerId === litId;
                  const menuOpenHere = rowMenu.target === c.customerId;
                  // The row ABOVE the lit one drops its divider too, so the
                  // fill has no rule on either side (Nudge efc036f1).
                  const beforeActive = !!litId && shown[i + 1]?.customerId === litId;
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
                  const open = () => openRow(c);
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
                        // Right-click: the row menu at the cursor instead of
                        // the browser's. It never opens the conversation.
                        onContextMenu={(e) => {
                          e.preventDefault();
                          rowMenu.openAt(c.customerId, e.clientX, e.clientY);
                        }}
                        // The lit row is a NEUTRAL inset, rounded fill, not
                        // a left bar (P21, Nudge b6fcaa09): WhatsApp Web's
                        // shape, and the bar read heavier than a state needs.
                        // Hover is the same shape one step lighter, on its
                        // own --inbox-row-hover (Nudge 0e6126a8): the shared
                        // --row-hover-bg is one step off a dark card and read
                        // as no hover at all. The fill is the `before` layer
                        // under the content (`isolate` + `-z-10`), so it can
                        // be inset without moving anything.
                        //
                        // The divider is INSET, starts where the NAME does
                        // (past the dot column, WhatsApp's way, Nudge
                        // 91735572) and ends with the age, at black 6% /
                        // white 7%: a full-bleed or full-strength rule cuts
                        // the card into stacked boxes; a faint inset one
                        // reads as a list. The lit row drops its own.
                        //
                        // TWO LINES, iMessage's shape: who, then what they
                        // said. The row carried only a name and an age, which
                        // made the list a directory rather than a triage
                        // queue: every question you came here with ("who
                        // still needs an answer", "did that confirmation go
                        // out") cost a click each.
                        //
                        // Each class string stands whole in quotes: Tailwind
                        // does not read a candidate glued to `${` (Nudge
                        // d4365e9a, where the hover never existed).
                        className={`group relative isolate flex min-h-[3.5rem] w-full cursor-pointer items-start gap-2 px-3 py-2 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)] before:absolute before:inset-x-1 before:inset-y-[3px] before:-z-10 before:rounded-lg before:transition-colors before:content-[''] after:absolute after:bottom-0 after:left-[2.125rem] after:right-3 after:h-px after:bg-black/[0.06] after:content-[''] dark:after:bg-white/[0.07] ${
                          isActive
                            ? "before:bg-[var(--row-active-bg)] after:hidden"
                            : beforeActive
                              ? "hover:before:bg-[var(--inbox-row-hover)] after:hidden"
                              : "hover:before:bg-[var(--inbox-row-hover)]"
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
                            in on hover.

                            It sits on the NAME line, not the row's middle
                            (Nudge c47c694c): dot and name are one fact, and
                            centred on two lines it floated in the gap between
                            name and preview. A 14px target (Nudge 2ef5a0b4),
                            3px down to centre on the name's 20px line, with
                            an 8px dot inside (Nudge 4b2c868c): a solid colour
                            needs less area than the hollow ring to weigh the
                            same, and the hit area stays whole. The green is
                            softened to 75% so a list where most rows are new
                            is not a bright column down the edge; the bold
                            name already says "new".

                            This merges what were two markers — an unread dot
                            here and a pin dot after the name. Splitting them
                            put the row's status on the left and its one action
                            on the right, so the eye crossed the name twice to
                            read one conversation, and the pin sat in the
                            column where the age lives. Nudge's inbox has run
                            the merged control long enough to trust it. */}
                        <HoverTip text={
                            c.pinned
                              ? t("inbox.pinnedHint")
                              : c.unseen
                                ? t("inbox.unseenPinHint")
                                : t("inbox.pinHint")
                          }>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void setInboxPin({
                              customerId: c.customerId,
                              pinned: !c.pinned,
                            });
                          }}
                          aria-label={
                            c.pinned
                              ? t("inbox.pinned")
                              : c.unseen
                                ? t("inbox.unseen")
                                : t("inbox.notPinned")
                          }
                          aria-pressed={c.pinned}
                          className="mt-[3px] flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full"
                        >
                          <span
                            aria-hidden
                            className={
                              c.pinned
                                ? "h-2 w-2 rounded-full bg-violet-500"
                                : c.unseen
                                  ? "h-2 w-2 rounded-full bg-[var(--brand)]/75"
                                  : "h-3.5 w-3.5 rounded-full border border-dashed border-[var(--muted)] opacity-0 transition-opacity hover:border-[var(--foreground)] group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                            }
                          />
                        </button>
                        </HoverTip>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
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

                            A failed send is a ✕ on the channel mark, not
                            the words "not sent" in front of the preview. Two
                            reasons, and the second is the real one. It was
                            SPELLED OUT, so four failures in eleven rows read
                            as a column of red prose with the actual messages
                            behind it. And it was attributed to the
                            conversation rather than to the line being quoted,
                            so it sat in front of inbound text the customer
                            had written — "not sent: I decided not to come" —
                            describing some older send that is nowhere on the
                            row. A reminder that silently failed is still the
                            worst thing this product can do quietly; a mark
                            next to the message that failed says it without
                            claiming it about the one that did not. */}
                        <div className="flex w-full items-center gap-1.5 text-xs">
                          {/* 12, not 13. The glyph answers WHERE a message happened, which is
                              the smallest question on a row that also carries a
                              name, an age and a line of the message itself —
                              and at 13 it was reading as loud as the text it
                              sits in front of (Serdar: "they look too big in
                              inbox").

                              MONOCHROME here, alone of all the feed surfaces
                              (Serdar, 2026-08-25): brand green, mail blue and
                              call cyan down a whole column drowned the one
                              colour this list actually trades on, the unseen
                              dot. The glyphs keep their hues in the contact
                              feed and the filter pills, where no dot competes;
                              here every mark is slate and green means new. */}
                          <span className="flex text-[var(--muted)]">
                            <FeedIcon type={c.lastChannel} size={12} tinted={false} />
                          </span>
                          {/* Direction, on the one row that cannot imply it.
                              A message preview is words somebody wrote, so a
                              salon's reminder reads nothing like a customer's
                              reply; "Arama" is the same four letters whoever
                              dialled. This started as the words "Aradınız" /
                              "Aradı" and Serdar's read was that it was a lot
                              of wording for very little, which is right — a
                              phone's own call log has never needed more than
                              an arrow.

                              Shape, NOT colour, and that is a refusal of the
                              green-out / red-in he suggested: both colours are
                              already spoken for within a few pixels of here.
                              Red on this line is the failed-send ✕, and green
                              two columns left is the unseen dot, so coloured
                              arrows would be read as states before they were
                              read as directions. The words survive as the
                              hover label and the aria-label, so nothing is
                              lost to a screen reader. */}
                          {c.lastChannel === "call" && (
                            <HoverTip text={t(
                                c.lastDirection === "out"
                                  ? "inbox.calledOut"
                                  : "inbox.calledIn",
                              )} className="inline-flex shrink-0">
                            <span
                              className="shrink-0 leading-none text-[var(--muted)]"
                              aria-label={t(
                                c.lastDirection === "out"
                                  ? "inbox.calledOut"
                                  : "inbox.calledIn",
                              )}
                            >
                              {c.lastDirection === "out" ? "↗" : "↙"}
                            </span>
                            </HoverTip>
                          )}
                          {c.lastFailed && (
                            <HoverTip text={t("message.failed")} className="inline-flex shrink-0">
                            <span
                              className="shrink-0 font-semibold leading-none text-[var(--muted)]"
                              aria-label={t("message.failed")}
                            >
                              ✕
                            </span>
                            </HoverTip>
                          )}
                          <span
                            className={`min-w-0 flex-1 truncate ${
                              c.unseen
                                ? "text-[var(--muted-strong)]"
                                : "text-[var(--muted)]"
                            }`}
                          >
                            {previewOf(c, t)}
                          </span>
                          {/* The row menu's chevron, on TOUCH only (no
                              right-click there), at the end of the preview
                              line. With a mouse the menu is right-click only
                              (Serdar, 2026-10-27; Nudge 4c2ae48e): the hover
                              arrow cluttered every row it crossed. */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (menuOpenHere) rowMenu.close();
                              else rowMenu.openUnder(c.customerId, e.currentTarget);
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                            aria-haspopup="menu"
                            aria-expanded={menuOpenHere}
                            aria-label={t("inbox.rowMenu", { name: c.name || c.phone })}
                            className="-my-0.5 hidden h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--muted-strong)] outline-none hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] [@media(hover:none)]:flex"
                          >
                            <MenuIcon name="chevron" />
                          </button>
                        </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {menuRow && (
              <ContextMenu
                panelRef={rowMenu.panelRef}
                pos={rowMenu.pos}
                open={rowMenu.target !== null}
                onClose={rowMenu.close}
                label={t("inbox.rowMenu", { name: menuRow.name || menuRow.phone })}
                items={menuItems}
              />
            )}
            {/* The next page, asked for as the end of the list comes into
                view. A search returns its matches whole and has no pages. */}
            {!search.active && paged.status === "CanLoadMore" && (
              <LoadMoreSentinel onVisible={() => paged.loadMore(INBOX_PAGE)} />
            )}
            {!search.active && paged.status === "LoadingMore" && (
              <p className="px-4 py-3 text-xs text-[var(--muted)]">{t("common.loading")}</p>
            )}
          </div>
          </div>
        </section>

        {/* Nothing chosen yet. Below lg the list owns the screen and this never
            shows — there is no second column there to be empty. */}
        {!active && (
          <section className={`hidden min-h-0 min-w-0 flex-col lg:flex ${PANE_DIVIDER}`}>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-[var(--muted)]">
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
            className={`${selected ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col ${PANE_DIVIDER}`}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ConversationPanel
              key={active.customerId}
              customerId={active.customerId}
              contactName={active.name}
              lastInboundAt={active.awaitingReply ? active.lastAt : undefined}
              filter={filter}
              initialItemId={openedItemId}
              onFilterChange={pickFilter}
              actionsBelow
              details={
                details ? (
                  <ContactRecord
                    customerId={active.customerId}
                    onDeleted={() => setSelected(null)}
                  />
                ) : undefined
              }
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
                // same as a name in the list beside it. Kept as the pane's
                // heading because the list's lit row scrolls away and a phone
                // hides the list. No › any more (Serdar, 2026-10-27): the
                // record is the Details pill; the name still opens the full
                // page on click, underlined on hover, as Nudge's does.
                className="min-w-0 shrink truncate text-base font-semibold hover:underline"
                title={t("inbox.openContact")}
              >
                {active.name || active.phone}
              </button>
              <FeedFilterPills
                customerId={active.customerId}
                value={filter}
                onChange={pickFilter}
                details={details}
                onDetails={() => setDetails(true)}
                className="ml-auto"
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
