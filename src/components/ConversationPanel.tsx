"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Picker, { Theme, EmojiStyle, type EmojiClickData } from "emoji-picker-react";
import { api } from "../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import { SegmentedControl } from "./SegmentedControl";
import { useConfirm } from "./ConfirmDialog";
import { useToast } from "@/lib/ToastProvider";
import { useLanguage } from "@/lib/LanguageProvider";
import { useWindowPresence } from "@/lib/useWindowPresence";
import type { TranslationKey } from "@/lib/i18n";
import {
  formatDateTime,
  formatDateTimeWithWeekday,
  formatDayHeading,
  formatTime,
  fromDatetimeLocalValue,
  localeFor,
} from "@/lib/datetime";
import {
  CallDetail,
  CallOutcomePill,
  CallTranscript,
  humanizeCallEnd,
} from "./CallDetail";
import { MessageMedia } from "./MessageMedia";
import { mediaTypeLabel } from "../../convex/lib/mediaKind";
import { EmojiPicker } from "./EmojiPicker";

// The header row above the feed has to sit in the same column as the feed, or
// the primary button (Place call, Compose) hangs past the right edge of the
// card below it and the back arrow starts left of it. Two things have to be
// matched, not one: the scroller's own p-4, AND the 9px that `stable-gutter`
// reserves for .thin-scroll's track — that gutter is OUTSIDE the padding, so a
// plain px-4 here still lands 9px short. Kept as rem + 9px rather than a
// resolved pixel value: nothing sets a root font-size, and Serdar's Chrome
// runs 17px, where a hardcoded 25px would be out. Keep in step with the
// threadRef div's padding; they are one column.
const FEED_COL_PAD = "pl-4 pr-[calc(1rem+9px)]";
import { EmailBodyEditor } from "./EmailBodyEditor";
import { FeedIcon, type Channel } from "./FeedIcon";
import type { Search } from "@/lib/useTableState";
import { normalizeSubject, stripReplyPrefixes } from "../../convex/lib/emailInbound";
import { hardenEmailLinks, sanitizeEmailHtml } from "@/lib/sanitizeHtml";
import {
  bodyIsHtml,
  hasNoteText,
  noteText,
  plainToHtml,
} from "../../convex/lib/noteBody";
import {
  quoteFreeSnippet,
  splitQuotedHtml,
  splitQuotedText,
} from "../../convex/lib/emailQuote";

const SESSION_WINDOW_MS = 24 * 3600_000;

// 95 seconds reads as 1:35, not "95s". Shared by the call list and the call
// detail so the same call never wears two different lengths.
function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Delivery state is a storage word ("failed"), not a UI word. Same for the
// reason slug the send action hands back. Both get translated here; an
// inbound's "received" has no entry because we never label incoming messages.
const STATUS_KEY: Record<string, TranslationKey> = {
  queued: "message.queued",
  sent: "message.sent",
  delivered: "message.delivered",
  read: "message.read",
  failed: "message.failed",
};

// A slug we don't have copy for prints nothing at all. A salon owner reading
// "wa-not-configured" is worse off than one who reads only "not sent".
const ERROR_KEY: Record<string, TranslationKey> = {
  "wa-not-configured": "error.wa-not-configured",
  "no-consent": "error.no-consent",
  // The pending draft was sent or retired by someone (or something) else
  // between reading it and pressing Send.
  "already-decided": "agent.draftGone",
  "session-window-closed": "error.session-window-closed",
  "no-template": "error.no-template",
  "missing-phone": "error.missing-phone",
  "agent-not-configured": "error.agent-not-configured",
  "no-calendar-connected": "error.no-calendar-connected",
  // Email lane.
  "missing-email": "error.missing-email",
  "no-from-address": "error.no-from-address",
  "email-not-configured": "error.email-not-configured",
  // Reactions.
  "evolution-no-reaction": "error.evolution-no-reaction",
  "no-wamid": "error.no-wamid",
  "reaction-failed": "message.reactionFailed",
};

// WhatsApp's own delivery language, because it is the one the salon already
// reads on their phone: one tick left us, two ticks reached the handset, two
// blue ticks were opened. The words stay in the title for a hover and for
// screen readers — a tick is faster to scan but it is not self-explanatory.
function DeliveryTicks({ status, label }: { status: string; label: string }) {
  if (status === "queued") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label={label}>
        <title>{label}</title>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  if (status !== "sent" && status !== "delivered" && status !== "read") return null;
  const read = status === "read";
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={label}
      // Blue only once it has been READ. Delivered stays the muted colour it
      // inherits, so "they have seen it" is the one state that changes hue —
      // which is the only one the salon actually acts on.
      className={read ? "text-sky-500" : ""}
    >
      <title>{label}</title>
      <path d="M2 12.5 7 17.5 12 11.5" />
      {status !== "sent" && <path d="M11 15.5 12.5 17 18 10.5" />}
    </svg>
  );
}

export type FeedFilter = Channel | "form" | "note" | "all";

// One customer's whole history — WhatsApp, email, calls, and the salon's own
// notes in a single interleaved feed — plus the composer. Shared by the inbox
// right pane and the contact page; one implementation, never a per-page
// variant (Nudge's rule).
export function ConversationPanel({
  customerId,
  contactName,
  lastInboundAt,
  filter = "all",
  initialItemId,
  onFilterChange,
  search,
  header,
  className,
}: {
  // The pane's identity row — who this conversation is with, and the channel
  // pills. Supplied by the parent because only the parent knows whether the
  // name is a link somewhere (the Inbox opens the contact record; the contact
  // page is already there).
  //
  // When given, the panel puts it on ONE line with whichever action the open
  // tab offers, and the tab stops drawing that action itself. The Inbox had
  // the identity row above the card and the action in a band inside it, so a
  // conversation opened under two stacked headers, the lower one holding a
  // single button with the width of the card empty beside it.
  //
  // Omitted (the contact page) nothing moves: the pills live in that page's
  // own header and the card deliberately leads its column, so the tab keeps
  // drawing its action exactly where it did.
  header?: React.ReactNode;
  customerId: Id<"customers">;
  // Labels the customer's side of a call transcript. Optional: the panel works
  // without it, the bubbles just say "Caller".
  contactName?: string | null;
  lastInboundAt?: number;
  filter?: FeedFilter;
  // "Open ON this one." The inbox knows which mail or call its row was
  // previewing, and email and calls are the two tabs that show a LIST before
  // they show anything — so without this, clicking a row quoting one line of a
  // six-mail history lands on the six subjects and asks the reader to spot it
  // again. Applied ONCE, when the feed first arrives; see the effect below.
  initialItemId?: string;
  // The index ROUTES: an email or call row moves the whole pane to that
  // channel's tab. The parent owns the filter (its header renders the pills),
  // so the panel asks rather than sets. Without this the index can only
  // expand things in place, which is exactly the flatness it exists to fix.
  onFilterChange?: (next: FeedFilter) => void;
  // The contact page's header search, filtering this feed by text — what was
  // said, wherever it was said (body, subject, call summary or transcript).
  // Optional: the inbox pane has its own search over conversations instead.
  search?: Search;
  className?: string;
}) {
  const { t, language } = useLanguage();
  const feed = useQuery(api.messages.feedForCustomer, { customerId });
  // The takeover chip's two facts: whether this org runs a live agent at all
  // (operator-set), and whether THIS conversation is currently a human's.
  // orgs.current is already open app-wide, so this adds one cheap read.
  const settings = useQuery(api.orgs.current, {});
  const customerRecord = useQuery(api.customers.get, { customerId });
  // The thread's mode and its pending draft in ONE read, so the pills and the
  // draft under them can never come from two different moments. Null when the
  // org has no agent — the strip renders nothing at all then, rather than a
  // disabled control for a feature they do not have.
  const agentState = useQuery(api.chatAgent.stateForCustomer, { customerId });
  const setConversationMode = useMutation(api.chatAgent.setConversationMode);
  const cancelAutoSend = useMutation(api.chatAgent.cancelAutoSend);
  const sendSuggestion = useAction(api.chatAgent.sendSuggestion);
  const sendSession = useAction(api.wa.sendSession);
  const react = useAction(api.wa.reactToMessage);
  const markThreadRead = useMutation(api.wa.markThreadRead);
  const markConversationRead = useMutation(api.messages.markConversationRead);
  // Placing a call is owner-only server-side (requireOwner inside testCall), so
  // the agent list is too — for staff this resolves to undefined and the button
  // never appears rather than appearing and failing.
  const voiceAgents = useQuery(api.retell.list, {});
  const placeCall = useAction(api.retellAgent.testCall);
  const sendEmail = useAction(api.email.sendToCustomer);
  const addNote = useMutation(api.notes.add);
  const cancelScheduled = useMutation(api.wa.cancelScheduled);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Empty = send now. A disclosure rather than a permanent field: almost every
  // message goes immediately, and a datetime box sitting under the composer
  // asks a question nobody usually has an answer to.
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [draft, setDraft] = useState("");
  // An image from the library, chosen for THIS message. Same disclosure shape
  // as the schedule row: closed by default, because most messages are words.
  const [attaching, setAttaching] = useState(false);
  const [attached, setAttached] = useState<AttachedFile | null>(null);
  // Grows with the message, capped, bottom-anchored — the extra lines push the
  // field upward the way WhatsApp Web does rather than pushing the thread down.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  // Collapsed at rest — see the composer itself.
  const [noteOpen, setNoteOpen] = useState(false);
  // The email composer is a disclosure, not a permanent bar: unlike WhatsApp,
  // where you reply constantly, most visits to the email tab are to READ. It
  // opens on Compose and closes on send.
  const [composing, setComposing] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  // Which thread the email tab has open (null = the list). Owned HERE rather
  // than inside the list so the header can carry back-arrow + subject on the
  // same line as Reply, which is also what prefills the composer.
  const [openThread, setOpenThread] = useState<{
    key: string;
    subject: string;
  } | null>(null);
  // The call tab mirrors the email tab: a list you scan, then one call you
  // read. Same navigation, so learning one teaches the other.
  const [openCallId, setOpenCallId] = useState<string | null>(null);
  // Where the All index was standing when a row jumped to its channel. The
  // back arrow returns HERE, not to the top of a list the reader never chose.
  const [returnScrollTop, setReturnScrollTop] = useState<number | null>(null);
  // Rows expanded in place. All is a scan by default — one line each — and a
  // WhatsApp message or a note opens where it sits rather than navigating.
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [calling, setCalling] = useState(false);
  const [confirmCall, confirmCallDialog] = useConfirm();
  const toast = useToast();
  const threadRef = useRef<HTMLDivElement>(null);

  const visible = (feed ?? []).filter(
    (item) =>
      (filter === "all" || item.channel === filter) &&
      // Text search spans every place words live in a feed item. A call
      // matches on what was SAID (summary/transcript), not just its label.
      (!search?.active ||
        search.matches(
          "body" in item ? item.body : undefined,
          "emailSubject" in item ? item.emailSubject : undefined,
          "summary" in item ? item.summary : undefined,
          "transcript" in item ? item.transcript : undefined,
        )),
  );
  // Messages read as a chat — oldest at the top, newest by the composer at the
  // bottom. Notes don't: nobody is having a conversation with themselves, so
  // that tab stays newest-first with its composer at the top, next to where
  // the note it writes will land.
  // Chat order is for a conversation you are HAVING: WhatsApp, and an email
  // thread you have opened. The indexes — All, the call list, notes — read
  // newest-first, because you are scanning them rather than talking.
  // Chat order is for a conversation you are HAVING: WhatsApp, and an email
  // thread you have opened.
  //
  // The thread spent one afternoon as Gmail's flush rows (Nudge's shape) and
  // came back (Serdar, 2026-08-17). Every other thing you can open in this pane
  // is a bubble — WhatsApp, and now notes — so mail arriving as a table made
  // the email tab the one place the app changed grammar on you. The known cost
  // is that the newest message sits at the BOTTOM: in a long exchange the mail
  // that decides what you do next is the one you have to scroll to. The pane
  // opens pinned there, which is what makes that survivable.
  const chatOrder = filter === "whatsapp" || (filter === "email" && !!openThread);

  // Email groups into conversations by normalized subject — "Re: Randevunuz"
  // and "Randevunuz" are one exchange however many clients prefixed it. The
  // same helper the server uses, so both agree on what a thread is.
  // Typed loosely on purpose: the feed is a union and only the message variant
  // carries a subject, but this only ever runs over the email filter, where
  // every row is one.
  const threadKeyOf = (item: (typeof visible)[number]) =>
    normalizeSubject(
      ("emailSubject" in item ? item.emailSubject : undefined) ?? "",
    );
  const emailThreads =
    filter === "email"
      ? Array.from(
          visible.reduce((acc, item) => {
            const key = threadKeyOf(item);
            const found = acc.get(key);
            // `visible` is newest-first, so the FIRST row of a key is the
            // latest — that is the one whose subject and date the list shows.
            if (found) found.count += 1;
            else
              acc.set(key, {
                key,
                subject:
                  ("emailSubject" in item ? item.emailSubject : undefined)?.trim() ||
                  t("email.noSubject"),
                at: item.at,
                // The new content only. A row reading "On Mon 17 Aug, Barber
                // wrote:" is describing the mail BEFORE this one.
                snippet: quoteFreeSnippet(
                  ("body" in item ? item.body : undefined) ?? "",
                ),
                inbound:
                  ("direction" in item ? item.direction : undefined) === "in",
                count: 1,
              });
            return acc;
          }, new Map<string, {
            key: string;
            subject: string;
            at: number;
            snippet: string;
            inbound: boolean;
            count: number;
          }>()).values(),
        )
      : [];

  const openCall =
    filter === "call" && openCallId
      ? visible.find((item) => item.id === openCallId)
      : undefined;

  const inScope = openThread
    ? visible.filter((item) => threadKeyOf(item) === openThread.key)
    : openCall
      ? [openCall]
      : visible;
  const thread = chatOrder ? [...inScope].reverse() : inScope;

  // ---- Reading a thread you are already in --------------------------------
  //
  // Both of these used to happen once, when a contact page mounted, and that
  // covered every case except the commonest one: the customer answers WHILE
  // you are sitting in their thread typing back. The inbox dot then re-lit
  // behind the reader for a message on the screen in front of them, and the
  // customer's phone kept showing two grey ticks while a human read the words.
  //
  // So both are keyed on the newest inbound instead of on mount, and both are
  // gated on the window actually being in front of somebody — a thread parked
  // on a second monitor must not answer for a person who is not there.
  //
  // Scanned by timestamp rather than taken off an end, because `thread` flips
  // direction with chatOrder and an index would silently pick the oldest.
  const newestInboundId = inScope.reduce<{ id: string; at: number } | null>(
    (newest, item) =>
      "direction" in item && item.direction === "in" && (!newest || item.at > newest.at)
        ? { id: item.id, at: item.at }
        : newest,
    null,
  )?.id;
  // WhatsApp only, and it is a SEPARATE key: an inbound call arriving must
  // clear the dot, but there is nothing on WhatsApp to tick for it.
  const newestWaInboundId = inScope.reduce<{ id: string; at: number } | null>(
    (newest, item) =>
      item.channel === "whatsapp" &&
      "direction" in item &&
      item.direction === "in" &&
      (!newest || item.at > newest.at)
        ? { id: item.id, at: item.at }
        : newest,
    null,
  )?.id;
  const present = useWindowPresence();

  useEffect(() => {
    if (!newestInboundId || !present) return;
    // The inbox dot. Every channel, because a call lights it too.
    void markConversationRead({ customerId }).catch(() => {});
  }, [newestInboundId, present, customerId, markConversationRead]);

  useEffect(() => {
    if (!newestWaInboundId || !present) return;
    // Swallowed: a receipt that fails is two grey ticks for another minute,
    // and there is nothing the person reading the thread could do about it.
    void markThreadRead({ customerId }).catch(() => {});
  }, [newestWaInboundId, present, customerId, markThreadRead]);

  useEffect(() => {
    // Skipped while a return position is pending, or the restore below would
    // be immediately overwritten by a jump to the top.
    if (returnScrollTop !== null) return;
    threadRef.current?.scrollTo({
      top: chatOrder ? threadRef.current.scrollHeight : 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.length, customerId, filter, chatOrder]);

  // Leaving the tab closes the thread. Coming back to a stale detail view of a
  // conversation you navigated away from reads as the app losing its place.
  useEffect(() => {
    if (filter !== "email") setOpenThread(null);
    if (filter !== "call") setOpenCallId(null);
    setOpenRows(new Set());
  }, [filter]);

  // The deep link, applied once and never again: the reader's back arrow sets
  // openCallId to null, and an effect that kept re-deriving from the prop
  // would shove them straight back into the call they just left. Declared
  // AFTER the tab-change reset above so a mount carrying both runs in the
  // order that ends with the item open.
  //
  // WhatsApp and notes are deliberately absent. Those tabs are a thread with
  // the newest message already at the bottom, so there is nothing to open —
  // arriving IS arriving at the message.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !initialItemId || !feed) return;
    const item = feed.find((row) => row.id === initialItemId);
    if (!item) return;
    deepLinked.current = true;
    if (item.channel === "call") {
      setOpenCallId(item.id);
      return;
    }
    if (item.channel === "email") {
      setOpenThread({
        key: normalizeSubject(item.emailSubject ?? ""),
        subject: item.emailSubject?.trim() || t("email.noSubject"),
      });
    }
  }, [initialItemId, feed, t]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft, filter]);

  // The assistant's draft lands IN the composer — there is no second box
  // (Serdar, 2026-08-31). Seeded on the draft's identity, never its text,
  // and only into space the reader has not claimed: an empty box, or the
  // previous draft left untouched. Whatever they typed themselves outranks
  // whatever the model produced.
  //
  // The reverse edge matters as much: when the pending draft goes away and
  // the composer still holds its unedited text, the text goes with it — it
  // was auto-sent, superseded or discarded elsewhere, and a box still
  // offering it would invite sending it twice.
  const pendingDraft = agentState?.pending ?? null;
  const seededTurn = useRef<string | null>(null);
  const seededText = useRef<string>("");
  const defusedTurn = useRef<string | null>(null);
  useEffect(() => {
    if (pendingDraft) {
      if (seededTurn.current === pendingDraft.turnId) return;
      seededTurn.current = pendingDraft.turnId;
      setDraft((current) => {
        const untouched = !current.trim() || current === seededText.current;
        seededText.current = pendingDraft.reply;
        return untouched ? pendingDraft.reply : current;
      });
    } else {
      seededTurn.current = null;
      if (seededText.current) {
        const wasSeeded = seededText.current;
        seededText.current = "";
        setDraft((current) => (current === wasSeeded ? "" : current));
      }
    }
  }, [pendingDraft]);

  // Restore the index's position once a routed detail has navigated back.
  // rAF because the rows have to be laid out before a scrollTop means anything.
  useEffect(() => {
    if (filter !== "all" || returnScrollTop === null) return;
    const el = threadRef.current;
    requestAnimationFrame(() => {
      if (el) el.scrollTop = returnScrollTop;
    });
    setReturnScrollTop(null);
  }, [filter, returnScrollTop]);

  const windowOpen =
    !!lastInboundAt && Date.now() - lastInboundAt < SESSION_WINDOW_MS;
  // A number to send FROM. The WhatsApp tab shows for every org now
  // (FeedFilterPills), so this pane has to answer for an org that has not
  // connected one — it used to be unreachable except through All, where it
  // quietly offered a Send that came back "wa-not-configured".
  //
  // Optimistic while the query is in flight. The alternative is claiming the
  // number is missing before we know, and a false sentence that corrects itself
  // is worse than a control that is briefly live.
  const waReady =
    settings === undefined ||
    settings.whatsapp.connected ||
    settings.evolutionEnabled;
  // Two different reasons the composer can be dead, and the line above it says
  // which. Not connected outranks the window: there is no point telling
  // somebody to wait for a reply on a channel they cannot send on at all.
  const composerLive = waReady && windowOpen;
  // This composer is WhatsApp's, and only WhatsApp's: it sends into Meta's
  // 24h session window, which no other channel has. Email receives now but
  // still has no composer of its own (next), and a call isn't something you
  // type back into. The notes tab has its own, at the top.
  const canCompose = filter === "all" || filter === "whatsapp";

  const saveNote = async () => {
    const body = noteDraft.trim();
    if (!hasNoteText(body) || noteSaving) return;
    setNoteSaving(true);
    try {
      await addNote({ customerId, body });
      setNoteDraft("");
      // Back to the button. The note you just wrote is the row directly below
      // it, and leaving the box open puts a toolbar over the thing you were
      // trying to see.
      setNoteOpen(false);
    } finally {
      setNoteSaving(false);
    }
  };

  // An "empty" rich editor is not an empty string — tiptap serialises a blank
  // document as <p></p>, and a paragraph of non-breaking spaces is emptier
  // still. Send asks whether anything was WRITTEN, not whether markup exists.
  const emailHasText =
    emailBody.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() !== "";

  const submitEmail = async () => {
    if (!emailHasText || emailSending) return;
    setEmailSending(true);
    setEmailError(null);
    const result = await sendEmail({
      customerId,
      subject: emailSubject,
      // The action flattens the markup itself and stores both, so the feed
      // index reads words and the thread renders what was actually sent.
      body: "",
      html: emailBody,
    });
    setEmailSending(false);
    if (!result.ok) {
      setEmailError(result.reason ?? "error");
      return;
    }
    setEmailSubject("");
    setEmailBody("");
    setComposing(false);
  };

  // The plane the whole pane stands on, painted ONCE here rather than by the
  // header, the scroller and the composer separately. A repeating background
  // origins at its own element, so three elements each tiling the doodles put
  // three different phases of the pattern next to each other and seamed at
  // every boundary. One parent, one continuous sheet.
  //
  // The rule is per SURFACE, not per tab (Nudge's wording): a transcript is a
  // conversation and gets the paper, but the calls LIST is rows and does not —
  // rows on a patterned ground read as a table somebody spilled something on,
  // which is the same reason the email index and notes stay on the card. So
  // the call tab paints paper only once a call is open.
  // Exactly one agent that can DIAL, or no button (Serdar's call, 2026-08-17,
  // amended 2026-08-27). An org can hold several voice agents — VoiceView is a
  // list you drill into — so there is no "the org's agent" to default to, and a
  // button that guesses rings a real phone from the wrong line. Where the
  // answer is unambiguous the button appears; where it is not, the call is
  // placed from the Voice agent page, which already made you choose.
  //
  // The amendment: "enabled" was the wrong test for candidacy. A second agent
  // with no line attached cannot place a call at all — testCall would throw
  // "no phone number to call from" — so it was never a second answer, only a
  // second row. Counting it suppressed the button on the one org that had
  // exactly one working line. Candidacy now matches what testCall can actually
  // do: its own outbound line, or its inbound number as the fallback.
  const dialAgents = (voiceAgents ?? []).filter(
    (a) => a.enabled && (a.outboundNumber || a.inboundNumber),
  );
  const dialAgent = dialAgents.length === 1 ? dialAgents[0].retellAgentId : null;
  const dialTo = customerRecord?.phone?.trim() || "";
  const canPlaceCall = !!dialAgent && !!dialTo;

  const startCall = () => {
    void (async () => {
      // testCall's own comment: the phone genuinely rings and the minutes are
      // genuinely billed, and the UI must ask first. The dialog names the
      // number, because "call this customer" and "call +90 533…" are different
      // amounts of certainty.
      const ok = await confirmCall({
        title: t("calls.placeConfirm").replace("{number}", dialTo),
        body: t("calls.placeConfirmBody"),
        confirmLabel: t("calls.place"),
        destructive: false,
      });
      if (!ok) return;
      setCalling(true);
      try {
        await placeCall({ agentId: dialAgent!, toNumber: dialTo });
        toast(t("calls.placing"));
      } catch (error) {
        // The action throws English strings for a bad number or a workspace
        // with no key. Shown as-is rather than swallowed: a call that never
        // dialled must not look like one that did.
        toast(error instanceof Error ? error.message : t("message.failed"));
      } finally {
        setCalling(false);
      }
    })();
  };

  const surface =
    filter === "whatsapp" || (filter === "call" && !!openCall)
      ? "chat-wallpaper"
      : chatOrder
        ? "bg-[var(--thread-bg)]"
        : "";

  // The action the open tab offers while nothing is expanded. Every tab's
  // resting state is a single right-aligned button, which is what makes one
  // shared row possible; the EXPANDED states (a composer, an open thread's
  // back-and-subject) still get the band below, where they earn the height.
  const tabAction = !header ? null : filter === "email" && !composing ? (
    <button
      type="button"
      onClick={() => {
        setEmailSubject(
          openThread ? `Re: ${stripReplyPrefixes(openThread.subject)}` : "",
        );
        setComposing(true);
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
    >
      <FeedIcon type="email" size={14} tinted={false} />
      {openThread ? t("email.reply") : t("email.compose")}
    </button>
  ) : filter === "call" && canPlaceCall ? (
    <button
      type="button"
      onClick={startCall}
      disabled={calling}
      className="flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      <FeedIcon type="call" size={14} tinted={false} />
      {calling ? t("calls.placing") : t("calls.place")}
    </button>
  ) : filter === "note" && !noteOpen ? (
    <button
      type="button"
      onClick={() => setNoteOpen(true)}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
    >
      <span aria-hidden className="text-base leading-none">
        +
      </span>
      {t("notes.add")}
    </button>
  ) : null;

  return (
    <div className={`flex min-h-0 flex-col ${surface} ${className ?? ""}`}>
      {header && (
        // h-11 px-3 matches the list card's header across the gap. It sits on
        // the card's white rather than the thread's tinted plane: this row is
        // about the CONTACT, not about the tab under it, and it stays put while
        // the tab below it changes.
        <div className="flex h-11 shrink-0 items-center gap-2 px-3">
          {header}
          {tabAction && <div className="ml-auto flex shrink-0">{tabAction}</div>}
        </div>
      )}
      {/* Email tab header. Compose sits top-right, Gmail's convention and
          Nudge's — the old full-width footer bar spent a whole row on one
          action. This is the slot the notes composer occupies below; each
          tab owns what goes here. */}
      {filter === "email" && (composing || openThread || !header) && (
        // The header wears whatever plane the thing below it wears. Over the
        // INDEX that is the card's white, because the index is flush rows on
        // white. Over an open thread it is the tinted plane — left white it cut
        // a bright band across the top of the card and the tint started
        // abruptly under it, which read as two panes stacked rather than one
        // conversation with a heading. Same rule the takeover chip and the
        // composer already follow.
        <div className={`shrink-0 pt-3 ${FEED_COL_PAD} ${chatOrder ? "pb-2" : ""}`}>
          {composing ? (
            // Explicitly white, not transparent. The header around it takes the
            // thread's tinted plane, and a composer that inherits it reads as a
            // hole in the conversation rather than a sheet of paper laid on top
            // — which is what a message you are writing is.
            <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2">
              <input
                value={emailSubject}
                onChange={(event) => setEmailSubject(event.target.value)}
                placeholder={t("email.subject")}
                disabled={emailSending}
              />
              {/* The real editor, not a textarea. This is EMAIL: the thing a
                  salon wants to send is a price list with the services in bold
                  and a link to the booking page, and typing that as plain text
                  meant the one channel that supports formatting was the one
                  place they could not use it.

                  onLiveChange as well as onSave, because the editor only
                  reports on BLUR — Send would otherwise sit disabled the whole
                  time you were typing and only wake up when you clicked away.
                  Every keystroke updates the draft; the blur is just the last
                  one. */}
              <EmailBodyEditor
                compact
                showVariables={false}
                value={emailBody}
                onSave={setEmailBody}
                onLiveChange={setEmailBody}
                disabled={emailSending}
                placeholder={t("email.bodyPlaceholder")}
              />
              {emailError && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {t(ERROR_KEY[emailError] ?? "message.failed")}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setComposing(false);
                    setEmailError(null);
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void submitEmail()}
                  disabled={emailSending || !emailHasText}
                  className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
                >
                  {emailSending ? t("common.saving") : t("contact.send")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {openThread && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenThread(null);
                      // Back means "where I came FROM". Arriving here from the
                      // All index and being dropped into the email list is the
                      // app deciding you meant something you didn't.
                      if (returnScrollTop !== null) onFilterChange?.("all");
                    }}
                    aria-label={t("common.back")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M19 12H5" />
                      <path d="m12 19-7-7 7-7" />
                    </svg>
                  </button>
                  <h3 className="min-w-0 truncate text-sm font-semibold">
                    {openThread.subject}
                  </h3>
                </>
              )}
              {/* Only when the pane has no header row to carry it. Reply
                  prefills the thread's subject so the customer's client keeps
                  the exchange together; the server threads on the same
                  normalized key, so "Re:" here is for THEIR inbox, not ours.
                  Stripped before prepending, or replying to a reply gives
                  "Re: Re: Saç boyası hakkında soru". Kept in step with the
                  copy in `tabAction` above. */}
              {!header && (
                <button
                  type="button"
                  onClick={() => {
                    setEmailSubject(
                      openThread ? `Re: ${stripReplyPrefixes(openThread.subject)}` : "",
                    );
                    setComposing(true);
                  }}
                  className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
                >
                  <FeedIcon type="email" size={14} tinted={false} />
                  {openThread ? t("email.reply") : t("email.compose")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {/* Call tab header, the email tab's shape: the list needs no chrome, an
          open call gets back-arrow + outcome + when. There is no compose here
          on purpose — placing a call is Retell's job, not a button in a
          conversation pane. */}
      {/* The call tab's header, the email tab's shape: the LIST gets only Place
          call, an open call adds back-arrow + when. It used to render only for
          an open call, which put the one control you reach for after reading
          "customer did not answer" one navigation away from the row that said
          so. */}
      {filter === "call" && (openCall || (canPlaceCall && !header)) && (
        <div className={`flex shrink-0 items-center gap-2 pt-3 ${FEED_COL_PAD}`}>
          {openCall && (
          <button
            type="button"
            onClick={() => {
              setOpenCallId(null);
              if (returnScrollTop !== null) onFilterChange?.("all");
            }}
            aria-label={t("common.back")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </button>
          )}
          {/* The outcome pill was here too, printing the same raw
              `call_successful` boolean as the index did. Gone for the same
              reason: the summary is directly below it and says more. */}
          {/* With the weekday: this heading names one moment and nothing else
              on the screen says which day of the week it was, so a bare date
              made the reader count back to find out. */}
          {openCall && (
            <h3 className="min-w-0 truncate text-sm font-semibold">
              {formatDateTimeWithWeekday(openCall.at, language)}
            </h3>
          )}
          {canPlaceCall && !header && (
            <button
              type="button"
              onClick={startCall}
              disabled={calling}
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <FeedIcon type="call" size={14} tinted={false} />
              {calling ? t("calls.placing") : t("calls.place")}
            </button>
          )}
        </div>
      )}
      {filter === "note" && (noteOpen || !header) && (
        <div className={`shrink-0 pt-3 ${FEED_COL_PAD}`}>
          {/* Collapsed until you mean it. Pinned at the top is right — the list
              runs newest-first, so the input sits next to where a fresh note
              lands — but a composer standing permanently open is a band of
              chrome between you and the notes you came to read, and it is only
              useful while you are actually writing.

              A real button, not a full-width box pretending to be a field. The
              one-line pseudo-input was tried and rejected: it reads as "type
              here" while doing nothing of the kind, and it still spends the
              whole row to say it. Nudge's shape. */}
          {!noteOpen ? (
            // Unreachable when a header row is carrying this; the tab is gated
            // on `noteOpen || !header` above.
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
              >
                <span aria-hidden className="text-base leading-none">
                  +
                </span>
                {t("notes.add")}
              </button>
            </div>
          ) : (
            /* The BOX is the composer, not the field. One border around the
               typing area and the buttons, so the two read as one control
               rather than an input with something parked beside it. */
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2">
              {/* The same editor the email composer uses. A note is where the
                  salon writes down what matters about a person — an allergy, a
                  price agreed, three things to check next time — and a list is
                  the natural shape for that. Plain text could not make one.

                  onLiveChange as well as onSave: the editor reports on BLUR, so
                  Add note would otherwise sit disabled while you typed and only
                  wake when you clicked away. */}
              <EmailBodyEditor
                compact
                showVariables={false}
                value={noteDraft}
                onSave={setNoteDraft}
                onLiveChange={setNoteDraft}
                disabled={noteSaving}
                placeholder={t("notes.placeholder")}
              />
              <div className="mt-1 flex justify-end gap-2">
                {/* Cancel left of the confirm, the order this app already uses
                    (the note editor's own footer, the booking sheet's). */}
                <button
                  type="button"
                  onClick={() => {
                    setNoteOpen(false);
                    setNoteDraft("");
                  }}
                  disabled={noteSaving}
                  className="rounded-full px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void saveNote()}
                  disabled={noteSaving || !hasNoteText(noteDraft)}
                  className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {noteSaving ? t("common.saving") : t("notes.add")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <div
        ref={threadRef}
        // Bubbles need breathing room between them; a LIST does not — its rows
        // are separated by hairlines, and 8px of margin on top of a border is
        // what made the note cards read as a stack of boxes. Notes are bubbles
        // now, so they take a gap of their own — a wider one than the chat's,
        // because each carries a byline above it and the two would otherwise
        // sit closer to the note above than to their own.
        // This scrolls in EVERY state, including an open call. It used to
        // stand down to overflow-hidden for a call, on the reasoning that the
        // detail owned the pane and its transcript scrolled on its own — which
        // was right about two scrollbars being a trap and wrong about which one
        // to remove. The summary card above the transcript is shrink-0, so a
        // call carrying eight collected values pinned most of the pane, left
        // the transcript on its 128px floor, and CLIPPED anything the card
        // itself could not fit with no way to reach it. The card is read once
        // and the transcript is read through, so the card is what scrolls away.
        className={`thin-scroll stable-gutter min-h-0 flex-1 overflow-y-auto p-4 ${attached ? "hidden" : ""} ${
          // Only the chat wears a plane of its own. The feed view renders calls
          // and email rows with their own edges, which want the card's white
          // under them.
          //
          // WhatsApp gets the WALLPAPER and an open email thread gets the flat
          // tint. Mail is not a chat: no client wallpapers it, and giving it
          // one would say the two channels are the same thing.
          chatOrder ? "space-y-2" : filter === "note" ? "space-y-3" : ""
        }`}
      >
        {feed === undefined && (
          <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
        )}
        {feed !== undefined && thread.length === 0 && (
          <p className="text-sm text-[var(--muted)]">
            {filter === "note"
              ? t("notes.none")
              : filter === "call"
                ? t("calls.none")
                : t("messages.none")}
          </p>
        )}
        {/* Email index: one row per conversation, flush like a mail client
            rather than a stack of bubbles. Bubbles are for a chat you are
            having; a mailbox is something you scan. */}
        {filter === "email" && !openThread &&
          emailThreads.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setOpenThread({ key: entry.key, subject: entry.subject })}
              className="-mx-4 flex w-[calc(100%+2rem)] items-start gap-2 border-b border-[var(--border)] px-4 py-2.5 text-left transition-colors hover:bg-[var(--row-hover-bg)]"
            >
              <FeedIcon type="email" size={13} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  {/* Unanswered inbound reads heavier, the same weight rule the
                      inbox list uses for a conversation awaiting a reply. */}
                  <span className={`min-w-0 truncate text-sm ${entry.inbound ? "font-semibold" : ""}`}>
                    {entry.subject}
                  </span>
                  {entry.count > 1 && (
                    <span className="shrink-0 rounded-full bg-[var(--muted-bg)] px-1.5 text-[11px] text-[var(--muted)]">
                      {entry.count}
                    </span>
                  )}
                </span>
                {entry.snippet && (
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {entry.snippet}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-[var(--muted)]">
                {formatDateTime(entry.at, language)}
              </span>
            </button>
          ))}
        {/* Call index: flush rows like the email tab. A call is not a chat
            bubble — it is a record with a summary, a transcript and a
            recording, and scanning "what happened" beats reading four cards. */}
        {filter === "call" && !openCall &&
          thread.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setOpenCallId(item.id)}
              className="-mx-4 flex w-[calc(100%+2rem)] items-start gap-2 border-b border-[var(--border)] px-4 py-2.5 text-left transition-colors hover:bg-[var(--row-hover-bg)]"
            >
              <FeedIcon type="call" size={13} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm">
                    {("direction" in item ? item.direction : undefined) === "in"
                      ? t("calls.inbound")
                      : t("calls.outbound")}
                  </span>
                  {/* No outcome pill here. It rendered Retell's raw
                      `call_successful` boolean, so every row read "true" or
                      "false" — and even spelled out it is the provider's guess
                      about a call the owner can read the summary of on the
                      same line. The summary is the outcome. */}
                  {"durationSec" in item && item.durationSec !== undefined && (
                    <span className="text-xs text-[var(--muted)]">
                      {formatDuration(item.durationSec)}
                    </span>
                  )}
                </span>
                {"summary" in item && item.summary && (
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {item.summary}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-[var(--muted)]">
                {formatDateTime(item.at, language)}
              </span>
            </button>
          ))}
        {/* THE ACTIVITY INDEX. All is not a merged chat — it is the record of
            everything that happened, one line each, oldest concern first:
            "what has gone on with this customer". Bubbles are for a single
            conversation; four channels stacked as bubbles read as noise.

            Email and call rows ROUTE to their own tab, because both have a
            detail worth a whole pane. WhatsApp and notes open in place. */}
        {filter === "all" &&
          thread.map((item, index) => {
            const monthOf = (ms: number) =>
              new Date(ms).toLocaleDateString(localeFor(language), {
                month: "long",
                year: "numeric",
              });
            const monthBand =
              index === 0 || monthOf(thread[index - 1].at) !== monthOf(item.at) ? (
                <li key={`month-${item.id}`} className="list-none pt-2 text-xs font-medium text-[var(--muted)]">
                  {monthOf(item.at)}
                </li>
              ) : null;
            const routes = item.channel === "email" || item.channel === "call";
            const open = openRows.has(item.id);
            const snippet =
              item.channel === "call"
                ? ("summary" in item ? item.summary : undefined) ?? ""
                : item.channel === "email"
                  ? ("emailSubject" in item ? item.emailSubject : undefined) ?? ""
                  : item.channel === "note"
                    // A note can be markup now. The index is one line of TEXT —
                    // a row reading "<p>Amonyağa" is worse than useless.
                    ? noteText(("body" in item ? item.body : undefined) ?? "")
                    : ("body" in item ? item.body : undefined) ?? "";
            return (
              <Fragment key={item.id}>
                {monthBand}
                <div className="-mx-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (item.channel === "email") {
                        setReturnScrollTop(threadRef.current?.scrollTop ?? 0);
                        setOpenThread({
                          key: threadKeyOf(item),
                          subject:
                            ("emailSubject" in item ? item.emailSubject : undefined)?.trim() ||
                            t("email.noSubject"),
                        });
                        onFilterChange?.("email");
                        return;
                      }
                      if (item.channel === "call") {
                        setReturnScrollTop(threadRef.current?.scrollTop ?? 0);
                        setOpenCallId(item.id);
                        onFilterChange?.("call");
                        return;
                      }
                      setOpenRows((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                    }}
                    className="flex w-full items-center gap-2 border-b border-[var(--border)] px-4 py-2 text-left transition-colors hover:bg-[var(--row-hover-bg)]"
                  >
                    <FeedIcon type={item.channel} size={13} />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {snippet || t("message.template")}
                    </span>
                    {/* Which way it went, in one character. A row that says
                        nothing about direction makes "did we answer?" —
                        the question you open this for — unanswerable. */}
                    {"direction" in item && item.direction && (
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {item.direction === "in" ? "←" : "→"}
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {formatDateTime(item.at, language)}
                    </span>
                    {routes && (
                      <span aria-hidden className="shrink-0 text-xs text-[var(--muted)]">
                        ›
                      </span>
                    )}
                  </button>
                  {open && "body" in item && item.body && (
                    <div className="border-b border-[var(--border)] px-4 py-2 text-sm">
                      {/* A note opened here is the same markup the notes tab
                          renders — without this it printed its own tags. Only
                          notes can be markup; a WhatsApp message is always the
                          text somebody sent. */}
                      {item.channel === "note" && bodyIsHtml(item.body) ? (
                        <div
                          className="break-words [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4"
                          dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(item.body) }}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{item.body}</p>
                      )}
                    </div>
                  )}
                </div>
              </Fragment>
            );
          })}
        {filter === "all" ||
        (filter === "email" && !openThread) ||
        (filter === "call" && !openCall)
          ? null
          : thread.map((item, index) => {
          if (item.channel === "call")
            return (
              <CallEntry
                key={item.id}
                item={item}
                detail={filter === "call"}
                contactName={contactName}
              />
            );
          if (item.channel === "note") return <NoteEntry key={item.id} item={item} />;
          const outbound = item.direction === "out";
          const failed = outbound && item.status === "failed";
          const statusKey = outbound && item.status ? STATUS_KEY[item.status] : undefined;
          const errorKey = item.error ? ERROR_KEY[item.error] : undefined;
          // A date band whenever the day changes. The bubbles then carry only
          // a time, which is what makes a long history scannable: the date is
          // said once per day instead of once per message.
          const daySeparator =
            chatOrder &&
            (index === 0 ||
              formatDayHeading(thread[index - 1].at, language) !==
                formatDayHeading(item.at, language)) ? (
              <li key={`day-${item.id}`} className="flex list-none justify-center py-1.5">
                {/* WhatsApp's date pill: a lifted chip with the bubble's own
                    shadow, not a grey wash — the wash disappeared into the
                    wallpaper. */}
                <span className="rounded-lg bg-[var(--chat-field)] px-3 py-1 text-xs font-medium text-[var(--chat-stamp)] shadow-[var(--bubble-shadow)]">
                  {formatDayHeading(item.at, language)}
                </span>
              </li>
            ) : null;
          return (
            <Fragment key={item.id}>
            {daySeparator}
            {/* The row, not the bubble: a bubble that has to carry a
                reaction pill under it and a react button beside it is two
                more things than a bubble can be, and stacking them inside
                would push the emoji over the timestamp. `group` is what lets
                the button appear on hover of the whole row, which is where a
                pointer actually is when someone decides to react. */}
            <div
              className={`group flex items-end gap-1 ${
                outbound ? "flex-row-reverse" : ""
              }`}
            >
            <div className="flex max-w-[78%] flex-col">
            <div
              // Ours right and green, theirs left and white — the arrangement
              // every WhatsApp user already reads without being taught. The
              // squared-off corner is the tail: it points at whoever spoke.
              //
              // w-fit is what stops a two-word reply from becoming a slab: as
              // a plain block the bubble filled its 78% whatever it held, so
              // "Ok" and a paragraph were the same width and the column read
              // as a wall rather than a conversation. max-w still caps it.
              //
              // flex + items-end puts the stamp BESIDE the last line instead
              // of on a line of its own underneath, which is what every
              // messenger does and what stopped these bubbles from being
              // twice as tall as they needed to be.
              //
              // The cap moved to the column above (a reaction pill has to be
              // able to sit under the bubble and be measured against the same
              // 78%), and ml-auto went with it — the row is reversed for our
              // own messages, which right-aligns the whole group.
              // WhatsApp's bubble, in its own numbers (2026-08-31): ~8px
              // radius, not the app's soft 16 — the big radius plus pastel
              // green is what read as weak — tight padding, near-black ink
              // on the WhatsApp greens and whites the tokens now carry.
              className={`flex w-fit max-w-full items-end gap-2 rounded-lg px-2.5 py-1.5 text-sm leading-[19px] text-[var(--chat-ink)] shadow-[var(--bubble-shadow)] ${
                outbound
                  ? "self-end rounded-br-sm bg-[var(--chat-out)]"
                  : "rounded-bl-sm bg-[var(--chat-in)]"
              } ${
                // A send that never left keeps its side and its colour and
                // wears a red ring instead. Recolouring the whole bubble made
                // a failure look like a different KIND of message.
                failed ? "opacity-70 ring-1 ring-red-400/50" : ""
              }`}
            >
              {/* min-w-0 so a long unbroken word wraps instead of shoving the
                  stamp out of the bubble. */}
              <div className="min-w-0">
              {/* Email carries a subject and WhatsApp doesn't, so it leads the
                  bubble when there is one (Serdar, 2026-08-17 — asked for after
                  a version without it).

                  It is not redundant with the card header above, which names
                  the THREAD: threads group on a normalized subject, so "Saç
                  boyası hakkında soru" and three "Re:" replies sit under one
                  heading, and the bubble is the only place you can see which of
                  those a given message actually was. It also rescues the case
                  where the body never arrived — the provider hands us the
                  metadata first and the body on a second call, and a fetch that
                  fails must still leave a readable bubble. */}
              {/* Semibold, which is this app's heading weight (h2 and h3 both
                  take it) — and the subject IS the bubble's heading. Medium was
                  a step too light to do that job here: the body can carry its
                  own <strong> at 600, so the line naming the mail was reading
                  lighter than a bold word inside it. */}
              {item.emailSubject && (
                <p className="mb-1 font-semibold">{item.emailSubject}</p>
              )}
              {item.mediaPending ? (
                // The row exists before the bytes do. A placeholder says
                // "there is a file coming"; nothing at all says the customer
                // sent an empty message.
                <span className="mb-1 flex h-24 w-40 animate-pulse items-center justify-center rounded-lg bg-[var(--muted-bg)] text-[11px] text-[var(--muted)]">
                  {t("message.mediaLoading")}
                </span>
              ) : item.mediaUrl || item.mediaContentType ? (
                // A photo IS the message when a customer sends one — "this is
                // the colour I want" — so it leads, capped rather than
                // stretched: a portrait blown to bubble width pushes
                // everything else off the screen. A voice note and a document
                // lead for the same reason, in the shapes they need.
                //
                // Reached with no mediaUrl when the download failed or the
                // file was over the ceiling; MessageMedia then names what was
                // sent instead of rendering an empty bubble.
                <MessageMedia
                  url={item.mediaUrl}
                  contentType={item.mediaContentType}
                  fileName={item.mediaFileName}
                  imgClassName="mb-1 max-h-52 w-auto max-w-[15rem] rounded-lg object-contain"
                />
              ) : null}
              {/* The quote, when this was a WhatsApp swipe-reply: what the
                  sender was answering, above their answer, exactly where
                  WhatsApp itself draws it. The left bar is WhatsApp's own
                  grammar for "this names another message" and is ported as-is
                  (reuse-the-real-pattern beats the no-left-borders habit rule
                  here; this is the one context where the bar MEANS something).
                  Snapshot text from the row, no lookup (schema note). */}
              {item.replyToDirection && (
                <div
                  className={`mb-1 rounded-md border-l-2 px-2 py-1 text-xs ${
                    outbound
                      ? "border-[var(--accent)] bg-black/5 dark:bg-white/10"
                      : "border-[var(--accent)] bg-[var(--muted-bg)]"
                  }`}
                >
                  {(item.replyToDirection === "out" || contactName) && (
                    <p className="font-medium text-[var(--accent)]">
                      {item.replyToDirection === "out"
                        ? t("message.quoteYou")
                        : contactName}
                    </p>
                  )}
                  <p className="line-clamp-2 whitespace-pre-wrap text-[var(--muted)]">
                    {item.replyToBody || t("message.quoteMedia")}
                  </p>
                </div>
              )}
              {/* The sender's own markup, sanitised, but ONLY inside an open
                  thread. In a list a formatted email is a wall; the flattened
                  text below is what belongs there. */}
              {item.emailHtml && openThread ? (
                <QuotedEmailBody html={item.emailHtml} />
              ) : item.body ? (
                // Only mail gets split. Quoting is an email convention, and a
                // WhatsApp message that happens to start a line with ">" is
                // somebody typing an arrow.
                item.channel === "email" ? (
                  <QuotedPlainBody text={item.body} />
                ) : (
                  <p className="whitespace-pre-wrap">{item.body}</p>
                )
              ) : item.mediaUrl || item.mediaPending || item.mediaContentType ? null : (
                // Template sends store no body (the text lives in Meta's
                // approved template), so the bubble would otherwise be blank.
                // Name what was sent instead of showing an empty box. Media
                // rows are NOT that case: an image sent without a caption
                // already shows the image, and printing "Şablon mesajı"
                // under it called a photo a template in the customer's own
                // thread.
                <p className="text-[var(--chat-stamp)]">{t("message.template")}</p>
              )}
              </div>
              <p
                className={`flex shrink-0 items-center gap-1 whitespace-nowrap pb-0.5 text-[11px] ${
                  failed ? "text-red-600 dark:text-red-400" : "text-[var(--chat-stamp)]"
                }`}
              >
                {/* Time only — the day band above already said the date. Full
                    stamp on hover for anyone who needs to be sure. */}
                <span title={formatDateTime(item.at, language)}>
                  {chatOrder ? formatTime(item.at, language) : formatDateTime(item.at, language)}
                </span>
                {/* Ticks replace the status word on our own messages; a
                    reply has no delivery state of ours to report. */}
                {outbound && item.status && !failed && statusKey && (
                  <DeliveryTicks status={item.status} label={t(statusKey)} />
                )}
                {failed && statusKey && <span>· {t(statusKey)}</span>}
                {errorKey && <span>· {t(errorKey)}</span>}
                {/* A parked send says WHEN, and offers the only action that
                    still matters. Once it has gone the row loses both. */}
                {item.scheduledFor !== undefined && (
                  <>
                    <span>· {formatDateTime(item.scheduledFor, language)}</span>
                    <button
                      type="button"
                      onClick={() =>
                        void cancelScheduled({ messageId: item.id as Id<"messages"> })
                      }
                      className="hover:text-red-600 dark:hover:text-red-400"
                    >
                      {t("common.cancel")}
                    </button>
                  </>
                )}
              </p>
            </div>
            {/* The reaction, hung off the bubble's bottom corner the way
                WhatsApp hangs it. Pulled up into the bubble's edge rather than
                sitting on its own line: a full line per emoji would double the
                height of a thread where people mostly answer with one. */}
            {item.reactionEmoji && (
              <span
                className={`z-10 -mt-2 w-fit rounded-full border border-[var(--border)] bg-[var(--card)] px-1.5 py-0.5 text-[13px] leading-none shadow-sm ${
                  outbound ? "mr-2 self-end" : "ml-2"
                }`}
                // Whose emoji it is follows from the side it hangs on, but a
                // screen reader has no sides.
                title={(outbound && contactName) || undefined}
              >
                {item.reactionEmoji}
              </span>
            )}
            </div>
            {/* Reacting is the cheapest honest answer a busy salon has, and it
                is only offered on the customer's own lines: one emoji field per
                message, and reacting to ourselves would overwrite theirs.
                Quiet-but-present on a phone, hover-revealed on a pointer — the
                staff reading this are on their phones half the time, and a
                control that only exists on hover does not exist there. */}
            {canCompose &&
              item.channel === "whatsapp" &&
              item.direction === "in" && (
                <EmojiPicker
                  title={t("message.react")}
                  className="mb-1 shrink-0 rounded-full p-1 text-[var(--muted)] opacity-60 transition hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] sm:opacity-0 sm:group-hover:opacity-100"
                  onPick={async (emoji) => {
                    setSendError(null);
                    const result = await react({
                      messageId: item.id as Id<"messages">,
                      // Clicking the emoji already on the message takes it
                      // back, which is the same gesture WhatsApp uses and the
                      // only way to remove one without a second control.
                      emoji: item.reactionEmoji === emoji ? "" : emoji,
                    });
                    if (!result.ok) setSendError(result.reason ?? "reaction-failed");
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
                    <path d="M9 9.5h.01M15 9.5h.01" />
                  </svg>
                </EmojiPicker>
              )}
            </div>
            </Fragment>
          );
        })}
      </div>

      {/* The staged file, where the thread was (Serdar, 2026-08-27: a
          proper surface for sending files, WhatsApp Web's own pattern
          rather than a global modal). The feed above is display:none, not
          unmounted, so closing this returns the scroll where it was. The
          composer below stays live as the caption field: body already
          rides the send as the media caption. */}
      {attached && (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="flex shrink-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {attached.name}
            </span>
            <button
              type="button"
              onClick={() => setAttached(null)}
              aria-label={t("media.remove")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center py-4">
            {attached.fileName ? (
              // A document has no pixels to preview; the card names what it
              // is at a size that reads as "this is the thing being sent".
              <div className="flex flex-col items-center gap-2 rounded-xl bg-[var(--card)] px-10 py-8 shadow-sm">
                <span className="text-lg font-semibold">
                  {mediaTypeLabel(attached.contentType, attached.fileName)}
                </span>
                <span className="max-w-56 truncate text-sm text-[var(--muted)]">
                  {attached.name}
                </span>
              </div>
            ) : attached.contentType?.startsWith("video/") ? (
              <video
                src={attached.url}
                controls
                className="max-h-full max-w-full rounded-xl"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={attached.url}
                alt={attached.name}
                className="max-h-full max-w-full rounded-xl object-contain shadow-sm"
              />
            )}
          </div>
        </div>
      )}

      {canCompose && agentState && (
        <AgentThreadStrip
          state={agentState}
          onMode={(mode) => void setConversationMode({ customerId, mode })}
          // Re-reads the draft at CLICK time rather than closing over the
          // one that was there at render: a newer customer message can retire
          // it between the two, and acting on the stale id would act on a
          // draft that has been overtaken.
          onStopAutoSend={() => {
            const p = agentState.pending;
            if (p?.autoSendAt) void cancelAutoSend({ customerId, turnId: p.turnId });
          }}
        />
      )}
      {canCompose && (
        <>
          <form
            // Same tint as the thread above it, on the same condition. White
            // here put a hard seam across the panel exactly where the
            // conversation ended — the composer is part of the chat surface,
            // not a footer under it. The feed view keeps card-white, because
            // its thread does too.
            className="p-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const body = draft.trim();
              // A file on its own is a message. Requiring text alongside it
              // would mean captioning a price list to send a price list.
              if (!body && !attached) return;
              setSending(true);
              setSendError(null);
              const when = scheduleAt ? fromDatetimeLocalValue(scheduleAt) : undefined;
              // While a draft is pending, Send IS the accept: the text goes
              // through the suggestion path, which claims the draft so two
              // people cannot send it twice and the acceptance rate stays
              // honest about edits. A scheduled or media send is not the
              // draft — it takes the ordinary path, and landing there
              // retires the pending draft anyway (applySendResult).
              const pendingNow = agentState?.pending;
              const viaDraft =
                pendingNow &&
                !attached &&
                !(when !== undefined && when > Date.now());
              const result = viaDraft
                ? await sendSuggestion({
                    customerId,
                    turnId: pendingNow.turnId,
                    body,
                  })
                : await sendSession({
                    customerId,
                    body,
                    // A moment already past is someone finishing a thought late,
                    // not a request to time-travel — send it now.
                    ...(when !== undefined && when > Date.now()
                      ? { scheduledFor: when }
                      : {}),
                    ...(attached ? { mediaStorageId: attached.storageId } : {}),
                  });
              setSending(false);
              if (result.ok) {
                setDraft("");
                setScheduleAt("");
                setScheduling(false);
                setAttached(null);
                setAttaching(false);
              } else setSendError(result.reason ?? "error");
            }}
          >
            {/* No prose above the pill. Whatever disables the composer says
                itself in the placeholder — a dead box explaining itself twice
                is chrome, and Serdar cut both sentences (2026-08-31). */}
            {/* One pill, WhatsApp's shape and Nudge's: the field, the clock and
                Send inside a single rounded surface rather than three controls
                sharing a row. A chat composer should read as somewhere you
                talk, not as a form with a submit button. */}
            <div
              className={`flex items-end gap-1 rounded-3xl p-1.5 ${
                // On the wallpaper the field is --chat-field, which is white on
                // light paper and a LIFTED grey on dark. --card would be the
                // dark paper itself, and the pill would vanish into it.
                filter === "whatsapp"
                  ? "bg-[var(--chat-field)]"
                  : chatOrder
                    ? "bg-[var(--card)]"
                    : "bg-[var(--muted-bg)]"
              } ${composerLive ? "" : "opacity-60"}`}
            >
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                // The first keystroke defuses a counting-down reply: an
                // edited reply must never fire in its unedited form. The ref
                // keeps it to one call per draft; Stop stays available for
                // defusing without touching the text.
                const p = agentState?.pending;
                if (p?.autoSendAt && defusedTurn.current !== p.turnId) {
                  defusedTurn.current = p.turnId;
                  void cancelAutoSend({ customerId, turnId: p.turnId });
                }
              }}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter breaks the line — what every chat
                // app trains people to expect. Without it a two-line message
                // means finding the mouse.
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              rows={1}
              placeholder={
                composerLive
                  ? t("contact.typeMessage")
                  : waReady
                    ? t("contact.sessionClosedShort")
                    : t("contact.waNotConnectedShort")
              }
              disabled={!composerLive || sending}
              className="max-h-32 min-h-[2.25rem] flex-1 resize-none self-center overflow-y-auto border-0 bg-transparent px-3 py-2 text-sm focus:outline-none disabled:opacity-100"
            />
            {/* One + instead of three icons (Serdar, 2026-08-31): a row of
                emoji, photo and clock ate the field's width, and every one
                of them is the same kind of thing — something added to the
                message that is not typing. WhatsApp's own grammar: + opens
                a drop-up, the field keeps the room. It rides the row's
                items-end with Send, same as the icons it replaced. */}
            <ComposerPlusMenu
              disabled={!composerLive || sending}
              active={attaching || Boolean(attached) || scheduling || Boolean(scheduleAt)}
              onPickEmoji={(emoji) => {
                // At the cursor, not appended: someone who went back to fix a
                // word and then reached for an emoji means it to land there.
                const field = composerRef.current;
                if (!field) {
                  setDraft((prev) => prev + emoji);
                  return;
                }
                const at = field.selectionStart ?? field.value.length;
                const end = field.selectionEnd ?? at;
                setDraft(field.value.slice(0, at) + emoji + field.value.slice(end));
                // Restored after React has painted the new value, or the
                // caret snaps to the end of the box and the next emoji lands
                // somewhere the writer did not ask for.
                requestAnimationFrame(() => {
                  field.focus();
                  field.setSelectionRange(at + emoji.length, at + emoji.length);
                });
              }}
              onAttach={() => setAttaching((prev) => !prev)}
              onSchedule={() => setScheduling((prev) => !prev)}
            />
            {/* A circle with a plane, not the word: WhatsApp's grammar again —
                in a pill that already reads as chat, a labeled button is the
                one piece still speaking form. The word survives as the
                aria-label. */}
            <button
              type="submit"
              aria-label={t("contact.send")}
              disabled={!composerLive || sending || (!draft.trim() && !attached)}
              className="shrink-0 rounded-full bg-[var(--accent)] p-2 text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
              </svg>
            </button>
            </div>
          </form>
          {scheduling && (
            <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(event) => setScheduleAt(event.target.value)}
                className="w-auto"
              />
              <span className="text-xs text-[var(--muted)]">
                {t("message.scheduleHint")}
              </span>
            </div>
          )}
          {/* An in-flow strip, not a popover: the schedule row above already
              set that precedent here, and a disclosure the composer pushes
              down needs none of the portal machinery a floating panel would
              (see AGENTS.md on clipped popovers). */}
          {attaching && (
            <MediaStrip
              selectedId={attached?.storageId}
              onPick={(asset) => {
                setAttached(asset);
                setAttaching(false);
              }}
            />
          )}
          {sendError && (
            // Same rule as the bubbles: a known reason gets its sentence, an
            // unknown one falls back to plain "not sent" rather than the slug.
            <p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400">
              {t(ERROR_KEY[sendError] ?? "message.failed")}
            </p>
          )}
        </>
      )}
      {confirmCallDialog}
    </div>
  );
}

type AttachedFile = {
  storageId: Id<"_storage">;
  name: string;
  url: string;
  contentType: string;
  // Set for a document, null for an image — the same distinction the send
  // path makes, carried so the composer's preview strip does not have to
  // guess at a picture that isn't one.
  fileName: string | null;
};

// The org's attachment library, as a row of tiles plus an upload tile.
//
// A library rather than a file input per message: the same price list goes out
// forty times, and re-picking it off a phone every time is the difference
// between a feature someone uses and one they try once. Uploading is the LAST
// tile rather than the first control, because after the first week the common
// case is picking something that is already there.
function MediaStrip({
  selectedId,
  onPick,
}: {
  selectedId?: Id<"_storage">;
  onPick: (asset: AttachedFile) => void;
}) {
  const { t } = useLanguage();
  const assets = useQuery(api.media.list, {});
  const generateUploadUrl = useMutation(api.media.generateUploadUrl);
  const register = useMutation(api.media.register);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      // The backend re-checks type and size against what actually landed —
      // the upload URL accepts anything, so this is where the limits are real.
      // Its error slug is what the reader sees, translated.
      await register({ storageId, name: file.name });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      setError(
        reason.includes("too-large")
          ? t("media.tooLarge")
          : reason.includes("unsupported-type")
            ? t("media.unsupported")
            : t("message.failed"),
      );
    }
    setUploading(false);
  };

  return (
    <div className="px-3 pb-2">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {assets?.map(
          (asset) =>
            asset.url && (
              <button
                key={asset._id}
                type="button"
                onClick={() =>
                  onPick({
                    storageId: asset.storageId,
                    name: asset.name,
                    url: asset.url!,
                    contentType: asset.contentType,
                    fileName: asset.fileName,
                  })
                }
                title={asset.name}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg transition-opacity hover:opacity-80 ${
                  selectedId === asset.storageId
                    ? "ring-2 ring-[var(--accent)]"
                    : ""
                }`}
              >
                {asset.fileName || asset.contentType.startsWith("video/") ? (
                  // A document has no thumbnail to show, so the tile says what
                  // it IS — "PDF" over a truncated name. A generic file glyph
                  // on every one of them turns a library of six price lists
                  // into six identical squares.
                  <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-1">
                    <span className="text-[10px] font-semibold text-[var(--muted-strong,var(--foreground))]">
                      {mediaTypeLabel(asset.contentType, asset.fileName ?? undefined)}
                    </span>
                    <span className="w-full truncate text-center text-[9px] leading-tight text-[var(--muted)]">
                      {asset.name}
                    </span>
                  </span>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={asset.url}
                    alt={asset.name}
                    className="h-full w-full object-cover"
                  />
                )}
              </button>
            ),
        )}
        <label
          className={`flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] ${
            uploading ? "opacity-50" : ""
          }`}
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,application/pdf,.xlsx,.xls,.docx,.doc"
            className="hidden"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so picking the SAME file again after a failed upload
              // still fires a change event.
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          {uploading ? "…" : "+"}
        </label>
      </div>
      {assets?.length === 0 && !uploading && (
        <p className="pt-1 text-xs text-[var(--muted)]">{t("media.empty")}</p>
      )}
      {error && (
        <p className="pt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

// Sanitised email markup, rendered on white paper.
//
// dangerouslySetInnerHTML is the only way to render HTML, and the safety is
// the sanitiser above it — never the absence of this call. Links are hardened
// after mount rather than in the string, because rewriting attributes with a
// regex is the same mistake as sanitising with one.
// The "···" every mail client has. A reply carries the whole thread quoted
// under it, and a bubble shows its whole body, so without this the third
// message in a thread contains the first two inside it.
//
// The quote is HIDDEN, never dropped: what somebody sent is on the record, and
// the split is a heuristic (lib/emailQuote) against a format no two clients
// agree on. When it guesses wrong the history is one click away rather than
// gone, which is the difference between a display bug and a data loss bug.
function QuotedToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={t("email.showQuoted")}
      title={t("email.showQuoted")}
      // Small, grey, and it does not say a word. Every mail client draws this
      // control as three dots for the same reason: the thing it reveals is
      // text the reader has already seen, so a labelled button would give it
      // more of the bubble than it is worth.
      className={`my-1 flex h-4 items-center rounded px-1.5 text-[10px] leading-none tracking-widest transition-colors ${
        open
          ? "bg-[var(--muted-strong)]/20 text-[var(--muted-strong)]"
          : "bg-[var(--muted-bg)] text-[var(--muted)] hover:bg-[var(--row-hover-bg)] hover:text-[var(--foreground)]"
      }`}
    >
      •••
    </button>
  );
}

function QuotedEmailBody({ html }: { html: string }) {
  const [open, setOpen] = useState(false);
  const { visible, quoted } = splitQuotedHtml(html);
  if (!quoted) return <EmailBody html={html} />;
  return (
    <>
      <EmailBody html={visible} />
      <QuotedToggle open={open} onToggle={() => setOpen((prev) => !prev)} />
      {/* Rendered only when opened rather than hidden with CSS: a long thread
          quotes every mail before it, so this is most of the bytes in the
          bubble and none of what anyone came to read. */}
      {open && <EmailBody html={quoted} />}
    </>
  );
}

function QuotedPlainBody({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const { visible, quoted } = splitQuotedText(text);
  if (!quoted) return <p className="whitespace-pre-wrap">{text}</p>;
  return (
    <>
      <p className="whitespace-pre-wrap">{visible.replace(/\s+$/, "")}</p>
      <QuotedToggle open={open} onToggle={() => setOpen((prev) => !prev)} />
      {open && (
        <p className="whitespace-pre-wrap text-[var(--muted-strong)]">
          {quoted}
        </p>
      )}
    </>
  );
}

function EmailBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const clean = sanitizeEmailHtml(html);
  useEffect(() => {
    hardenEmailLinks(ref.current);
  }, [clean]);
  return (
    <div
      ref={ref}
      className="email-paper -mx-1 rounded-md px-3 py-2 text-sm [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-4"
      // Sanitised immediately above; see src/lib/sanitizeHtml.ts.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

// A note is a bubble in a log — Nudge's shape, ported 2026-08-17.
//
// It was a flush row with a truncated snippet and a chevron, and the chevron
// was MEASURED: a ResizeObserver watched the snippet and reported its own
// overflow, re-attaching on webfont load because swapping the face changes the
// text's width without changing its box. All of that machinery existed to
// answer one question — is this note too long for one line — and the question
// stopped mattering once the note simply shows itself. A bubble shows the whole
// note, so there is nothing to expand and nothing to measure.
//
// One column, one bubble style, and every note names its author. A
// mine-right/theirs-left split reads as a conversation between two people, and
// a note log is not one: everybody here is writing ON the customer, not to each
// other.
function NoteEntry({
  item,
}: {
  item: {
    id: string;
    at: number;
    body?: string;
    authorName?: string;
    editedAt?: number;
  };
}) {
  const { t, language } = useLanguage();
  const updateNote = useMutation(api.notes.update);
  const removeNote = useMutation(api.notes.remove);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.body ?? "");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const body = item.body ?? "";

  const askRemove = () => {
    void (async () => {
      const ok = await confirm({ title: t("notes.deleteConfirm") });
      if (ok) await removeNote({ noteId: item.id as Id<"notes"> });
    })();
  };

  const save = async () => {
    const next = draft.trim();
    if (!hasNoteText(next) || busy) return;
    setBusy(true);
    try {
      await updateNote({ noteId: item.id as Id<"notes">, body: next });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    // Named, for the same reason the toolbar's tooltip group is: this row wraps
    // a rich editor while editing, and a bare `group` here reaches into it.
    <li className="group/note list-none">
      {confirmDialog}
      <div className="flex min-w-0 max-w-[85%] flex-col items-start gap-1">
        {/* Who put it there and when, above the bubble rather than inside it:
            the bubble IS the note, and a byline crammed in beside the first
            line of text competes with the thing you are reading. Where no
            person is recorded we say so rather than leaving it blank — an
            unattributed note on a shared record is a fact about the record. */}
        <div className="flex items-center gap-2 px-1 text-[11px] text-[var(--muted)]">
          <span className="font-medium text-[var(--muted-strong)]">
            {item.authorName ?? t("notes.systemAuthor")}
          </span>
          <span>{formatDateTime(item.at, language)}</span>
          {item.editedAt !== undefined && <span>{t("notes.edited")}</span>}
          {/* Hover-revealed, opacity rather than hidden, so the row never
              shifts when it appears. There is no edit button beside it: the
              bubble itself is the edit affordance. */}
          <button
            type="button"
            onClick={askRemove}
            aria-label={t("common.delete")}
            className="shrink-0 text-[var(--muted)] opacity-0 transition-opacity hover:text-red-600 focus-visible:opacity-100 group-hover/note:opacity-100 dark:hover:text-red-400"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </div>
        {editing ? (
          // The editor wears the bubble, so a note reads and edits in the same
          // box instead of jumping into a form somewhere else on the pane — and
          // in the same FORMAT, rather than becoming plain text the moment you
          // touch it.
          <div className="w-full min-w-[16rem] rounded-2xl bg-[var(--note-bubble-bg)] px-3 py-2">
            <EmailBodyEditor
              compact
              showVariables={false}
              value={draft}
              onSave={setDraft}
              onLiveChange={setDraft}
              disabled={busy}
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                className="rounded-md px-2.5 py-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || !hasNoteText(draft)}
                className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        ) : (
          // Click to edit — the whole bubble, not a pencil that only appears
          // once you have already found the note by hovering it.
          <button
            type="button"
            onClick={() => {
              // Plain notes predate the editor. Converted on the way IN rather
              // than migrated in storage: the paragraph breaks somebody typed
              // survive, and a note nobody ever edits is never rewritten.
              setDraft(bodyIsHtml(body) ? body : plainToHtml(body));
              setEditing(true);
            }}
            title={t("notes.edit")}
            className="min-w-0 rounded-2xl bg-[var(--note-bubble-bg)] px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--note-bubble-hover-bg)]"
          >
            {/* Judged on the BODY, never on a stored flag — see lib/noteBody.
                Sanitised even though this markup is ours: a note can be edited
                by anyone in the org, and "we wrote it" is not a security
                boundary. */}
            {bodyIsHtml(body) ? (
              <div
                className="break-words [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4"
                dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(body) }}
              />
            ) : (
              // whitespace-pre-wrap, not <br> injection: a legacy plain note
              // keeps its line breaks without being rewritten into markup it
              // was never stored as.
              <span className="block whitespace-pre-wrap break-words">{body}</span>
            )}
          </button>
        )}
      </div>
    </li>
  );
}

// A call is a full-width card, not a chat bubble — it carries a summary, a
// transcript, and a recording, none of which fit the bubble rhythm.
//
// `detail` is the same card opened deliberately from the call tab rather than
// scrolled past in the mixed feed: transcript open, recording playable in
// place, and no repeat of what the pane header already says.
function CallEntry({
  item,
  detail = false,
  contactName,
}: {
  detail?: boolean;
  // Labels the human side of the transcript when the card is opened.
  contactName?: string | null;
  item: {
    at: number;
    direction?: "in" | "out";
    durationSec?: number;
    outcome?: string;
    summary?: string;
    transcript?: string;
    recordingUrl?: string;
    collected?: Record<string, unknown>;
    disconnectionReason?: string;
  };
}) {
  const { t, language } = useLanguage();
  const duration =
    item.durationSec !== undefined ? formatDuration(item.durationSec) : null;
  const ended = humanizeCallEnd(item.disconnectionReason, t);

  // Opened deliberately: the full record, identical to what Voice → Calls
  // shows. In the mixed feed it stays a summary card — a chat transcript
  // inline would bury every message after it.
  if (detail) {
    return (
      // No card of its own (Serdar, 2026-08-17). It wore a rounded, bordered,
      // tinted box INSIDE the conversation panel's card — a frame drawn around
      // the only thing the frame already contained. Borders belong to
      // containers, and the pane is the container; the two blocks that are
      // really containers (the collected values and the transcript, which
      // scrolls) keep their own edges and now read as the only boxes here.
      //
      // Natural height, scrolled by the pane — see the threadRef div above.
      <div className="text-sm">
        {/* No duration line here at all (Serdar, 2026-08-17). The player reads
            "0:00 / 1:34" and the list row you arrived from carries the length
            too, so on the opened card it was a third copy of the same number
            sitting above everything else. */}
        <CallDetail flow call={item} contactName={contactName} />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-sm">
      {/* The mixed feed's card says direction and time itself; the call tab's
          pane header already says both, which is why the opened form above
          doesn't repeat them. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
        <FeedIcon type="call" size={13} />
        <span>{item.direction === "in" ? t("calls.inbound") : t("calls.outbound")}</span>
        <span>{formatDateTime(item.at, language)}</span>
        {duration && <span>· {duration}</span>}
        <CallOutcomePill outcome={item.outcome} />
      </div>
      {/* Summary, or the reason it ended when there was no conversation to
          summarize. A missed call used to render as an empty card. */}
      {item.summary ? (
        <p className="mt-1">{item.summary}</p>
      ) : (
        ended && <p className="mt-1 text-xs text-[var(--muted)]">{ended}</p>
      )}
      {item.recordingUrl && (
        <a
          href={item.recordingUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs text-[var(--accent)] hover:underline"
        >
          {t("calls.recording")}
        </a>
      )}
      {item.transcript && (
        // Collapsed here, where an open transcript would bury everything after
        // it. Opening the Calls filter is the way to read one properly.
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-[var(--muted)]">
            {t("calls.transcript")}
          </summary>
          <div className="mt-1.5">
            <CallTranscript transcript={item.transcript} contactName={contactName} />
          </div>
        </details>
      )}
    </div>
  );
}

// Who owns this chat right now, and the one control that changes it.
//
// The takeover chip (docs/chat-agent.md §5). It was a line of grey text with
// a text button floated opposite, which is what a status line looks like when
// nobody has decided whether it is a status or a control. It is both: the
// answer to "is a robot talking to my customer" and the switch that stops it,
// which is the single most consequential toggle on this screen.
//
// So it is a BAR, and the two states are told apart by colour and icon before
// a word is read — the whole point being that a salon owner glancing at a
// thread should know who is holding it without parsing a sentence.
//
// Sending any manual message also takes over (stamped server-side in
// wa.sendSession); this is how a thread is handed BACK, which no message can
// express.
// The thread's agent strip: what the assistant is doing HERE, and the draft it
// is holding, if any.
//
// It is ONE control. The first version of this bar was a status sentence plus
// a Take over button, both changing the same state from opposite directions,
// and reading it meant working out which of the two you were being told. Three
// pills say the whole thing: where this conversation is, and what the other
// two options would do.
//
// Docked above the composer rather than at the end of the message list,
// because a draft is a proposal about the NEXT message — one you have to
// scroll to find is one you miss on a busy morning.
function AgentThreadStrip({
  state,
  onMode,
  onStopAutoSend,
}: {
  state: NonNullable<FunctionReturnType<typeof api.chatAgent.stateForCustomer>>;
  onMode: (mode: "off" | "suggest" | "live") => void;
  onStopAutoSend: () => void;
}) {
  const { t } = useLanguage();
  const pending = state.pending;
  const live = state.effective === "live";
  return (
    <div className="space-y-2 px-3 pt-3">
      <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--muted-bg)] px-2.5 py-2">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            live
              ? "bg-[var(--accent)]/15 text-[var(--accent)]"
              : "bg-[var(--card)] text-[var(--muted)]"
          }`}
        >
          {/* The same four-point spark the app already uses for automation
              (FeedIcon, the rules header), so the agent looks like itself
              everywhere rather than picking a new symbol per screen. */}
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
            <path d="M12 2l1.9 5.6L19.5 9.5 13.9 11.4 12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2z" />
          </svg>
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-xs font-medium text-[var(--foreground)]">
              {t("agent.inThisChat")}
            </span>
            {/* Worth a pulse only while it is actually answering: "answering"
                is a claim about right now, and a static label makes it read
                like a setting somebody switched on once. */}
            {live && (
              <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              </span>
            )}
          </span>
          {/* No "This chat only" subtitle. "In this chat" is already in the
              title, so the line restated the header one row down and cost
              the strip a second line of height (Serdar, 2026-08-31). */}
        </span>
        <SegmentedControl
          size="sm"
          value={state.effective}
          onChange={onMode}
          segments={[
            { id: "off", label: t("agent.mode.off"), hint: t("agent.mode.offHint") },
            { id: "suggest", label: t("agent.mode.suggest"), hint: t("agent.mode.suggestHint") },
            { id: "live", label: t("agent.mode.live"), hint: t("agent.mode.liveHint") },
          ]}
        />
      </div>

      {/* Flagged, not stopped: the assistant said this one needs a person and
          carried on helping. Amber and quiet — nobody was paged, because reps
          read their own chats and this is a state on a surface already open. */}
      {state.flaggedAt !== undefined && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-2.5 py-1.5 text-xs text-[var(--foreground)]">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
          <span className="min-w-0 truncate">{t("agent.needsPerson")}</span>
        </div>
      )}

      {/* The draft itself lives in the COMPOSER now, not in a card of its
          own (Serdar, 2026-08-31: "i want the suggestion directly in the
          chat editor") — and an ordinary draft gets NO line at all: the text
          sitting in the box already says everything a banner would, and the
          "Assistant's draft / Discard" strip above it was the same fact
          twice (Serdar, 2026-08-31). Clearing or rewriting the box is the
          discard. Only a live reply counting down to its own send still
          earns a line, in amber — "about to happen" — because that state is
          invisible from the text alone and Stop has to live somewhere. */}
      {pending?.autoSendAt && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-2.5 py-1.5 text-xs">
          <AutoSendCountdown deadline={pending.autoSendAt} />
          <button
            type="button"
            onClick={onStopAutoSend}
            className="shrink-0 rounded-lg px-2 py-0.5 font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted-bg)]"
          >
            {t("agent.autoSendStop")}
          </button>
        </div>
      )}
    </div>
  );
}

// The seconds until a live reply fires, ticking in place. Separate component
// so the half-second interval re-renders this one line, not the whole strip.
function AutoSendCountdown({ deadline }: { deadline: number }) {
  const { t } = useLanguage();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span className="min-w-0 flex-1 truncate font-medium tabular-nums text-[var(--foreground)]">
      {s > 0
        ? t("agent.autoSendIn").replace("{s}", String(s))
        : t("agent.autoSendNow")}
    </span>
  );
}

// The composer's +: one trigger for everything that is not typing — emoji, a
// photo, a scheduled send — in a drop-up, WhatsApp's own attach grammar.
// Choosing Emoji swaps the panel's CONTENT to the emoji grid rather than
// opening a second popover: two floating panels racing each other's
// outside-click handlers is how the pick landed after the panel had already
// unmounted. Same portal contract as EmojiPicker: fixed, body-portaled,
// closed on outside mousedown, Escape and any scroll outside the panel.
const PLUS_MENU_W = 208;
const PLUS_MENU_H = 128;
const PLUS_EMOJI_W = 320;
const PLUS_EMOJI_H = 400;

function ComposerPlusMenu({
  disabled,
  active,
  onPickEmoji,
  onAttach,
  onSchedule,
}: {
  disabled?: boolean;
  // A chosen attachment or a set schedule keeps the + accent-coloured while
  // the menu is shut — the state its rows opened is still in force.
  active: boolean;
  onPickEmoji: (emoji: string) => void;
  onAttach: () => void;
  onSchedule: () => void;
}) {
  const { t } = useLanguage();
  const [panel, setPanel] = useState<{
    view: "menu" | "emoji";
    top: number;
    left: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Drop-UP: bottom edge pinned above the button, flipping below only when
  // the viewport leaves no room, clamped on the right so the emoji grid
  // never runs off screen next to Send.
  const placed = (view: "menu" | "emoji") => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return null;
    const w = view === "menu" ? PLUS_MENU_W : PLUS_EMOJI_W;
    const h = view === "menu" ? PLUS_MENU_H : PLUS_EMOJI_H;
    const up = r.top - h - 6 >= 8;
    return {
      view,
      top: up ? r.top - h - 6 : Math.min(r.bottom + 6, window.innerHeight - h - 8),
      left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)),
    };
  };

  useEffect(() => {
    if (!panel) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !btnRef.current?.contains(target)) {
        setPanel(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setPanel(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [panel]);

  const dark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");

  const row =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted-bg)]";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={t("contact.composerMore")}
        aria-expanded={panel !== null}
        disabled={disabled}
        onClick={() => setPanel(panel ? null : placed("menu"))}
        className={`shrink-0 rounded-full p-2 transition-colors disabled:opacity-50 ${
          active || panel
            ? "text-[var(--accent)]"
            : "text-[var(--muted)] hover:text-[var(--foreground)]"
        }`}
      >
        {/* Rotates to a ✕ while open — the one motion WhatsApp's + makes,
            a state change rather than a hover, so it stays inside the
            nothing-shifts rule. */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`transition-transform duration-150 ${panel ? "rotate-45" : ""}`}
          aria-hidden
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {panel &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: panel.top, left: panel.left, zIndex: 60 }}
            className={
              panel.view === "menu"
                ? "w-[208px] rounded-xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-lg"
                : undefined
            }
          >
            {panel.view === "menu" ? (
              <>
                <button
                  type="button"
                  className={row}
                  onClick={() => setPanel(placed("emoji"))}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--muted)]" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
                    <path d="M9 9.5h.01M15 9.5h.01" />
                  </svg>
                  {t("editor.insertEmoji")}
                </button>
                <button
                  type="button"
                  className={row}
                  onClick={() => {
                    setPanel(null);
                    onAttach();
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--muted)]" aria-hidden>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                  {t("media.attach")}
                </button>
                <button
                  type="button"
                  className={row}
                  onClick={() => {
                    setPanel(null);
                    onSchedule();
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--muted)]" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  {t("message.scheduleAt")}
                </button>
              </>
            ) : (
              <Picker
                onEmojiClick={(d: EmojiClickData) => {
                  onPickEmoji(d.emoji);
                  setPanel(null);
                }}
                theme={dark ? Theme.DARK : Theme.LIGHT}
                emojiStyle={EmojiStyle.NATIVE}
                lazyLoadEmojis
                width={PLUS_EMOJI_W}
                height={PLUS_EMOJI_H}
                previewConfig={{ showPreview: false }}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
