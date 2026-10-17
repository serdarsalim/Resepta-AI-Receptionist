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
import { CallOutcomePill, CallTranscript, CollectedList, humanizeCallEnd } from "./CallDetail";
import { CallRecording } from "./CallRecording";
import { Avatar } from "./Avatar";
import { MessageMedia } from "./MessageMedia";
import { mediaTypeLabel } from "../../convex/lib/mediaKind";
import { waFailureKind, type WaFailureKind } from "../../convex/lib/waFailure";
import { waFormat } from "@/lib/waFormat";
import { isFileDrag, MEDIA_ACCEPT, pastedFiles } from "@/lib/mediaFiles";
import { useLibraryUpload, type LibraryAsset } from "@/lib/useLibraryUpload";
import { EMOJI_PANEL_H, EMOJI_PANEL_W, EmojiPanel, EmojiPicker } from "./EmojiPicker";
import {
  ContextMenu,
  MenuIcon,
  QuickReactions,
  useContextMenu,
  type ContextMenuItem,
  type MenuEdge,
} from "./ContextMenu";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";

// The header row above the feed has to sit in the same column as the feed, or
// the primary button (Place call, Compose) hangs past the right edge of the
// card below it and the back arrow starts left of it. Two things have to be
// matched, not one: the scroller's own p-4, AND the 9px that `stable-gutter`
// reserves for .thin-scroll's track — that gutter is OUTSIDE the padding, so a
// plain px-4 here still lands 9px short. Kept as rem + 9px rather than a
// resolved pixel value: nothing sets a root font-size, and Serdar's Chrome
// runs 17px, where a hardcoded 25px would be out. Keep in step with the
// threadRef div's padding; they are one column.
//
// --pane-inline (globals' .pane-measure, on the panel root) IS that column's
// padding now: 1rem on a normal pane, wider on a big monitor so content
// keeps a reading measure instead of stretching wall to wall.
const FEED_COL_PAD =
  "pl-[var(--pane-inline)] pr-[calc(var(--pane-inline)+9px)]";
import { EmailBodyEditor } from "./EmailBodyEditor";
import { FeedIcon, type Channel } from "./FeedIcon";
import type { Search } from "@/lib/useTableState";
import { stripReplyPrefixes } from "../../convex/lib/emailInbound";
import { hardenEmailLinks, sanitizeEmailHtml } from "@/lib/sanitizeHtml";
import {
  bodyIsHtml,
  hasNoteText,
  noteText,
  plainToHtml,
} from "../../convex/lib/noteBody";
import { splitQuotedHtml, splitQuotedText } from "../../convex/lib/emailQuote";
import { HoverTip } from "./HoverTip";

const SESSION_WINDOW_MS = 24 * 3600_000;

// One row of a customer's feed, as the panel receives it.
type FeedRow = FunctionReturnType<typeof api.messages.feedForCustomer>[number];

// The bubble menu's footprint while it carries the quick-reaction row (five
// 36px glyphs and a "+", P23) above its four items.
const BUBBLE_MENU_REACT_W = 240;
const BUBBLE_MENU_REACT_H = 4 * 36 + 8 + 8 + 44;

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
  // Sending a draft that also changes an appointment: the change goes first
  // and the reply only if it took (chatAgent.sendSuggestion).
  "change-slot-taken": "error.change-slot-taken",
  "change-customer-busy": "error.change-customer-busy",
  "change-time-not-allowed": "error.change-time-not-allowed",
  "change-appointment-changed": "error.change-appointment-changed",
  "change-too-many": "error.change-too-many",
  "change-too-many-upcoming": "error.change-too-many-upcoming",
  "change-failed": "error.change-failed",
  "changed-not-sent": "error.changed-not-sent",
  "change-needs-plain-send": "error.change-needs-plain-send",
  // Email lane.
  "missing-email": "error.missing-email",
  "no-from-address": "error.no-from-address",
  "email-not-configured": "error.email-not-configured",
  // Reactions.
  "evolution-no-reaction": "error.evolution-no-reaction",
  "no-wamid": "error.no-wamid",
  "reaction-failed": "message.reactionFailed",
};

// A Meta refusal or a failed delivery names its cause through its code
// (lib/waFailure), so "not on WhatsApp" reads as that rather than as a bare
// "not sent". Unknown codes still fall back to "not sent".
const WA_FAIL_KEY: Record<WaFailureKind, TranslationKey> = {
  "not-on-whatsapp": "waFail.not-on-whatsapp",
  "window-closed": "waFail.window-closed",
  "spam-rate-limit": "waFail.spam-rate-limit",
  "rate-limit": "waFail.rate-limit",
  "service-down": "waFail.service-down",
  "missing-parameter": "waFail.missing-parameter",
  "bad-value": "waFail.bad-value",
  "template-params": "waFail.template-params",
  "template-missing": "waFail.template-missing",
  "template-too-long": "waFail.template-too-long",
  "template-rejected": "waFail.template-rejected",
  "marketing-cap": "waFail.marketing-cap",
  "marketing-stopped": "waFail.marketing-stopped",
};

function errorKeyFor(error: string | undefined): TranslationKey | undefined {
  if (!error) return undefined;
  const kind = waFailureKind(error);
  return ERROR_KEY[error] ?? (kind ? WA_FAIL_KEY[kind] : undefined);
}

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
  const double = status !== "sent";
  // WhatsApp's own tick geometry (Serdar, 2026-08-31: ours read flat next to
  // it): the long arm runs nearly the glyph's whole height, the short arm is
  // a stub, and the second tick is the SAME check shifted right so its stub
  // crosses the first one's arm — the interlock is what makes it read as
  // WhatsApp rather than as two checkmarks. The box grows from 12 to 16 when
  // the second tick lands, nudging the stamp left exactly as WhatsApp does.
  // Endpoints keep a stroke-cap's margin inside the box — the first cut of
  // this glyph put the right tip at the viewBox edge and its round cap was
  // clipped flat.
  return (
    <svg
      width={double ? 14.5 : 10.9}
      height="10"
      viewBox={double ? "0 0 16 11" : "0 0 12 11"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={label}
      // Blue only once it has been READ. Delivered stays the muted colour it
      // inherits, so "they have seen it" is the one state that changes hue —
      // which is the only one the salon actually acts on. WhatsApp's exact
      // blue, both themes — the bubble is already quoting their palette.
      className={read ? "text-[#53bdeb]" : ""}
    >
      <title>{label}</title>
      <path d="M1 6.4 3.8 9.2 10.6 1.2" />
      {double && <path d="M5.4 6.4 8.2 9.2 15 1.2" />}
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
  const discardSuggestion = useMutation(api.chatAgent.discardSuggestion);
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
  // Quote-reply (Serdar, 2026-08-31): the thread message the next send
  // answers. A snapshot for the preview strip; the SEND carries only the id
  // and the backend re-resolves, so an edit between pick and send can't make
  // the strip and the customer's quote disagree. Text sends only — picking
  // an attachment clears it, because the media lanes don't carry context.
  // Which message's react/reply controls are showing on a TOUCH screen —
  // tap the bubble to summon them, tap again (or tap another bubble) to put
  // them away. Phones have no hover, and the always-on fallback meant every
  // single line in a thread wore two grey icons (Serdar, 2026-09-01: the
  // permanent icons were the noise). Desktop never reads this state: at sm+
  // the same controls stay hover-revealed.
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{
    id: string;
    body: string;
    direction: "in" | "out";
  } | null>(null);
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
  // Email card the deep link scrolls to (routed from the All index). One-shot.
  // There is no open-thread state any more: since 2026-09-01 the email tab is
  // a flat card timeline with nothing to navigate into (see the card list
  // below for the why).
  const [focusEmailId, setFocusEmailId] = useState<string | null>(null);
  // Call card the routed navigation scrolls to — the calls twin of
  // focusEmailId, and it also pre-expands that card (the person deep-linked
  // here for THAT call's transcript). There is no open-call detail any more:
  // calls became a flat card timeline the same day email did.
  const [focusCallId, setFocusCallId] = useState<string | null>(null);
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
  // The WhatsApp bubble's menu (P23, Nudge daddc71e): right-click a message
  // (opens at the cursor) or its corner chevron (opens under it). ONE menu
  // for the thread, aimed at whichever bubble asked, on the Inbox row menu's
  // primitive. With reactions it carries the quick-reaction row above its
  // items, and React (or that row's "+") swaps the full emoji panel in.
  const [bubblePicker, setBubblePicker] = useState(false);
  const [bubbleReacts, setBubbleReacts] = useState(false);
  const bubbleMenu = useContextMenu<string>(4, {
    width: bubblePicker ? EMOJI_PANEL_W : bubbleReacts ? BUBBLE_MENU_REACT_W : undefined,
    height: bubblePicker
      ? EMOJI_PANEL_H
      : bubbleReacts
        ? BUBBLE_MENU_REACT_H
        : undefined,
  });

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
  // Chat order is for a conversation you are HAVING: WhatsApp. The indexes —
  // All, the call list, notes — read newest-first, because you are scanning
  // them rather than talking. Email is newest-first too, as CARDS: this tab
  // has been three things now — Gmail's flush rows, then bubbles in chat
  // order (2026-08-17: "everything you can open in this pane is a bubble"),
  // and since 2026-09-01 a flat card timeline, ported from Nudge the day it
  // shipped there (Serdar: "apply the same to randevu"). What the card model
  // fixes over both: the newest mail is at the TOP with its body already
  // showing (the bubbles' known cost was scrolling to it), and there is no
  // thread to navigate into at all. The subject-grouped thread UI went with
  // it — grouping was a display guess; the server's normalizeSubject keeps
  // its real job (binding inbound mail to a customer) untouched.
  const chatOrder = filter === "whatsapp";

  const inScope = visible;
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

  // Leaving the tab closes the detail. Coming back to a stale detail view of a
  // conversation you navigated away from reads as the app losing its place.
  useEffect(() => {
    setOpenRows(new Set());
  }, [filter]);
  // The routed email card scrolls into view once the tab has rendered it.
  // rAF, not a plain call: the filter switch and this state land in the same
  // render, so the card isn't in the DOM until the frame after. One-shot —
  // cleared immediately so a later manual scroll isn't yanked back.
  useEffect(() => {
    if (filter !== "email" || focusEmailId === null) return;
    const container = threadRef.current;
    requestAnimationFrame(() => {
      container
        ?.querySelector(`[data-email-id="${focusEmailId}"]`)
        ?.scrollIntoView({ block: "start" });
    });
    setFocusEmailId(null);
  }, [filter, focusEmailId]);
  useEffect(() => {
    if (filter !== "call" || focusCallId === null) return;
    const container = threadRef.current;
    requestAnimationFrame(() => {
      container
        ?.querySelector(`[data-call-id="${focusCallId}"]`)
        ?.scrollIntoView({ block: "start" });
    });
    setFocusCallId(null);
  }, [filter, focusCallId]);

  // The deep link, applied once and never again. Declared AFTER the
  // tab-change reset above so a mount carrying both runs in the order that
  // ends with the item in view.
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
      // A scroll target that also pre-expands the card — see CallCards.
      setFocusCallId(item.id);
      return;
    }
    if (item.channel === "email") {
      // No thread to open — the flat timeline scrolls to the card instead.
      setFocusEmailId(item.id);
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

  // What a bubble's menu may offer, on the same gates as the bubble's own
  // actions: Reply where the row can be quoted, React where a reaction can
  // reach the customer (the server's canReact: their message, on the Cloud
  // lane), Copy and Add to note where there are words. Both sending actions
  // need this pane's composer.
  const bubbleGates = (item: FeedRow) => {
    const whatsapp = item.channel === "whatsapp";
    const text = whatsapp && "body" in item && item.body?.trim() ? item.body : "";
    const canReply = canCompose && whatsapp && "canQuote" in item && !!item.canQuote;
    const canReact = canCompose && whatsapp && "canReact" in item && !!item.canReact;
    return { text, canReply, canReact, any: canReply || canReact || text !== "" };
  };
  const openBubbleMenuAt = (item: FeedRow, x: number, y: number) => {
    setBubblePicker(false);
    setBubbleReacts(bubbleGates(item).canReact);
    bubbleMenu.openAt(item.id, x, y);
  };
  const openBubbleMenuUnder = (item: FeedRow, el: HTMLElement, edge: MenuEdge) => {
    setBubblePicker(false);
    setBubbleReacts(bubbleGates(item).canReact);
    bubbleMenu.openUnder(item.id, el, edge);
  };
  // The menu acts on the row as it is NOW: a reaction may have landed since
  // it opened.
  const menuRow = bubbleMenu.target
    ? (thread.find((row) => row.id === bubbleMenu.target) ?? null)
    : null;

  // Paste or drop a file and it is uploaded into the library and attached to
  // this message, without opening the library first (P14, Nudge's composers).
  // The + tile in the library takes the same path.
  const library = useLibraryUpload();
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  const acceptsFiles = canCompose && composerLive && !sending;
  const pickAsset = (asset: LibraryAsset) => {
    if (!asset.url) return;
    setAttached({
      storageId: asset.storageId,
      name: asset.name,
      url: asset.url,
      contentType: asset.contentType,
      fileName: asset.fileName,
    });
    setAttaching(false);
    // The media lanes carry no quote context: dropping the chip keeps the
    // composer honest about what will actually send.
    setReplyTo(null);
  };
  const attachFile = async (file: File) => {
    const asset = await library.upload(file);
    if (asset) pickAsset(asset);
  };

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

  // Reacting, shared by the bubble's own React button and its menu. Picking
  // the emoji already on the message takes it back, the same gesture
  // WhatsApp uses and the same request (an empty emoji IS the unreact).
  const reactTo = async (messageId: string, current: string | undefined, emoji: string) => {
    // The job is done; the summoned icons leave with it.
    setActionsFor(null);
    setSendError(null);
    try {
      const result = await react({
        messageId: messageId as Id<"messages">,
        emoji: current === emoji ? "" : emoji,
      });
      if (!result.ok) setSendError(result.reason ?? "reaction-failed");
    } catch {
      setSendError("reaction-failed");
    }
  };

  // The bubble menu's "Add to note": the Notes tab's own write, with the
  // message's words as the body. Said in a toast, since the notes tab is not
  // on screen while you are in the thread.
  const addMessageToNote = async (text: string) => {
    try {
      await addNote({ customerId, body: plainToHtml(text.trim()) });
      toast(t("message.addedToNote"));
    } catch {
      toast(t("message.addToNoteFailed"));
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
      //
      // A customer who asked not to be called by the AI (noAiCallsAt) gets
      // the question asked differently: the request first, "Call anyway" as
      // the verb, Cancel holding focus. Nudge's rule: an automated run never
      // rings them, and a person may, knowing it. The server refuses the call
      // unless this acknowledgement comes with it.
      const askedNoAiCalls = customerRecord?.noAiCallsAt !== undefined;
      const ok = await confirmCall({
        title: t("calls.placeConfirm", { number: dialTo }),
        body: askedNoAiCalls ? t("calls.noAiCallsWarning") : t("calls.placeConfirmBody"),
        confirmLabel: askedNoAiCalls ? t("calls.callAnyway") : t("calls.place"),
        destructive: askedNoAiCalls,
        focusCancel: askedNoAiCalls,
      });
      if (!ok) return;
      setCalling(true);
      try {
        await placeCall({
          agentId: dialAgent!,
          toNumber: dialTo,
          ...(askedNoAiCalls ? { callAnyway: true } : {}),
        });
        toast(t("calls.placing"));
      } catch (error) {
        // The action throws English strings for a bad number or a workspace
        // with no key. Shown as-is rather than swallowed: a call that never
        // dialled must not look like one that did. The one coded refusal is
        // a request not to be called that landed after this page loaded.
        toast(
          error instanceof Error && error.message.includes("no-ai-calls")
            ? t("calls.noAiCallsRefused")
            : error instanceof Error
              ? error.message
              : t("message.failed"),
        );
      } finally {
        setCalling(false);
      }
    })();
  };

  // Email takes the chat PAPER without the doodles (chat-plain): its timeline
  // is cards, and a card separates from the paper by fill exactly the way a
  // bubble does — the ground is what makes the cards read as cards. The
  // doodles stay chat-only; they are set dressing for a conversation, and
  // mail is not one. The other tabs take --conversation-paper: the card's
  // white in light, the chat's near-black in dark, so in dark every tab of the
  // conversation is one ground set into the joined card (P22).
  const surface =
    filter === "whatsapp"
      ? "chat-wallpaper"
      : filter === "email" || filter === "call"
        ? "chat-wallpaper chat-plain"
        : "bg-[var(--conversation-paper)]";

  // The action the open tab offers while nothing is expanded. Every tab's
  // resting state is a single right-aligned button, which is what makes one
  // shared row possible; the EXPANDED states (a composer, an open thread's
  // back-and-subject) still get the band below, where they earn the height.
  const tabAction = !header ? null : filter === "email" && !composing ? (
    <button
      type="button"
      onClick={() => {
        setEmailSubject("");
        setComposing(true);
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
    >
      <FeedIcon type="email" size={14} tinted={false} />
      {t("email.compose")}
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
    <div
      className={`pane-measure relative flex min-h-0 flex-col ${surface} ${className ?? ""}`}
      // A file dragged from the desktop onto the conversation attaches to the
      // next message. The depth counter is because dragenter and dragleave
      // fire for every child the pointer crosses.
      onDragEnter={(event) => {
        if (!acceptsFiles || !isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDropping(true);
      }}
      onDragOver={(event) => {
        if (!acceptsFiles || !isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        if (!dropping) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDropping(false);
      }}
      onDrop={(event) => {
        if (!acceptsFiles || !isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDropping(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void attachFile(file);
      }}
    >
      {dropping && (
        // Covers its own panel, not a popover: nothing here floats over
        // anything outside the card, so the portal rule has nothing to do.
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--accent)] bg-[var(--card)]/85">
          <span className="text-sm font-medium text-[var(--accent)]">
            {t("media.dropToAttach")}
          </span>
        </div>
      )}
      {header && (
        // h-11 px-3 matches the list's header across the divider of the
        // joined card. This row is about the CONTACT, not about the tab under
        // it, and it stays put while the tab below it changes. The open tab's
        // action rides its right end, so Compose, Place call and Add note end
        // where the channel pills' row ends (px-3), never at the feed
        // column's wider inset (Nudge 18dfc375 made the same move).
        <div className="flex h-11 shrink-0 items-center gap-2 px-3">
          {header}
          {tabAction && <div className="ml-auto flex shrink-0">{tabAction}</div>}
        </div>
      )}
      {/* Email tab header. Compose sits top-right, Gmail's convention and
          Nudge's — the old full-width footer bar spent a whole row on one
          action. This is the slot the notes composer occupies below; each
          tab owns what goes here. */}
      {filter === "email" && (composing || !header) && (
        <div className={`shrink-0 pt-3 ${FEED_COL_PAD}`}>
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
                insertPhoto
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
            // Only when the pane has no header row to carry it. Compose only:
            // Reply lives on each card now, where it prefills that email's
            // own subject.
            !header && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEmailSubject("");
                    setComposing(true);
                  }}
                  className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
                >
                  <FeedIcon type="email" size={14} tinted={false} />
                  {t("email.compose")}
                </button>
              </div>
            )
          )}
        </div>
      )}
      {/* Call tab header: Place call and nothing else — the cards below
          carry everything a call produced. */}
      {filter === "call" && canPlaceCall && !header && (
        <div className={`flex shrink-0 items-center gap-2 pt-3 ${FEED_COL_PAD}`}>
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
        className={`thin-scroll stable-gutter min-h-0 flex-1 overflow-y-auto px-[var(--pane-inline)] py-4 ${attached ? "hidden" : ""} ${
          // Only the chat wears a plane of its own. The feed view renders calls
          // and email rows with their own edges, which want the card's white
          // under them.
          //
          // WhatsApp gets the WALLPAPER and an open email thread gets the flat
          // tint. Mail is not a chat: no client wallpapers it, and giving it
          // one would say the two channels are the same thing.
          // The WhatsApp thread also takes WhatsApp Web's own face
          // (.chat-font, P10); nothing else in the app does.
          // Notes are signed rows with a hairline between them (P12).
          chatOrder
            ? "chat-font space-y-2"
            : filter === "note"
              ? "divide-y divide-[var(--border)]"
              : ""
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
        {/* Email timeline: one CARD per email, newest first, on the plain
            chat paper — the HubSpot model, ported from Nudge (2026-09-01,
            Serdar: "apply the same to randevu"). This tab has now been three
            things: flush thread rows, bubbles in chat order, and this. The
            card model beats both at the same job — the newest mail is at the
            top with its body already showing, nothing to navigate into, and
            no subject-grouping guess deciding what "one conversation" is.
            The server's normalizeSubject keeps its real job (binding inbound
            mail to a customer); the UI just stopped borrowing it. */}
        {filter === "email" && (
          <EmailCards
            items={visible
              .filter((item) => item.channel === "email")
              .map((item) => ({
                id: item.id,
                at: item.at,
                subject:
                  ("emailSubject" in item ? item.emailSubject : undefined)?.trim() ||
                  t("email.noSubject"),
                html: "emailHtml" in item ? item.emailHtml : undefined,
                body: "body" in item ? item.body : undefined,
                inbound:
                  ("direction" in item ? item.direction : undefined) === "in",
                status: "status" in item ? item.status : undefined,
                error: "error" in item ? item.error : undefined,
                scheduledFor:
                  "scheduledFor" in item ? item.scheduledFor : undefined,
              }))}
            contactName={contactName}
            focusId={focusEmailId}
            onReply={(subject) => {
              setEmailSubject(`Re: ${stripReplyPrefixes(subject)}`);
              setComposing(true);
            }}
            onCancel={(id) =>
              void cancelScheduled({ messageId: id as Id<"messages"> })
            }
          />
        )}
        {/* Call timeline: one CARD per call, newest first, on the plain
            paper — the same exercise the email tab went through, ported from
            Nudge the same day (2026-09-01, Serdar: "apply the call cards to
            randevu too"). The flush rows and the open-call detail are both
            gone: a card carries the direction, the player and the summary at
            rest, and Details unfolds the collected values + transcript IN the
            card. The "no outcome pill" decision (2026-08-25) stands — the
            summary is the outcome. */}
        {filter === "call" && (
          <CallCards
            items={visible
              .filter((item) => item.channel === "call")
              .map((item) => ({
                id: item.id,
                at: item.at,
                inbound:
                  ("direction" in item ? item.direction : undefined) === "in",
                durationSec:
                  "durationSec" in item ? item.durationSec : undefined,
                summary: "summary" in item ? item.summary : undefined,
                transcript: "transcript" in item ? item.transcript : undefined,
                recordingUrl:
                  "recordingUrl" in item ? item.recordingUrl : undefined,
                collected: "collected" in item ? item.collected : undefined,
                disconnectionReason:
                  "disconnectionReason" in item
                    ? item.disconnectionReason
                    : undefined,
                outcome: "outcome" in item ? item.outcome : undefined,
                placedBy: "placedBy" in item ? item.placedBy : undefined,
                bulkRun: "bulkRun" in item ? item.bulkRun : undefined,
                booked: "booked" in item ? item.booked : undefined,
              }))}
            contactName={contactName}
            focusId={focusCallId}
          />
        )}
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
                        // A scroll target, not a navigation: the email tab is
                        // a flat card timeline now.
                        setFocusEmailId(item.id);
                        onFilterChange?.("email");
                        return;
                      }
                      if (item.channel === "call") {
                        setReturnScrollTop(threadRef.current?.scrollTop ?? 0);
                        // A scroll target that pre-expands the card.
                        setFocusCallId(item.id);
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
        {filter === "all" || filter === "email" || filter === "call"
          ? null
          : thread.map((item, index) => {
          // Calls never reach this loop (their tab renders CallCards above);
          // the branch survives to NARROW the union for the bubble code below.
          if (item.channel === "call") return null;
          if (item.channel === "note") return <NoteEntry key={item.id} item={item} />;
          const outbound = item.direction === "out";
          const failed = outbound && item.status === "failed";
          const statusKey = outbound && item.status ? STATUS_KEY[item.status] : undefined;
          const errorKey = errorKeyFor(item.error);
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
          // WhatsApp's RUN (P10, Nudge's measured thread): a bubble under one
          // from the same side on the same day sits 2px below it with no tail;
          // the first of a run carries the tail and a 12px gap above. The
          // margins collapse with the list's space-y-2 (8px): mt-3 makes 12,
          // -mt-1.5 makes 2.
          const previous = index > 0 ? thread[index - 1] : undefined;
          const runStart =
            daySeparator !== null ||
            !previous ||
            previous.channel === "note" ||
            previous.direction !== item.direction;
          const gates = bubbleGates(item);
          const menuOpenHere = bubbleMenu.target === item.id;
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
              } ${chatOrder ? (runStart ? "mt-3" : "-mt-1.5") : ""}`}
            >
            {/* 65%, WhatsApp Web's own cap (P10; it was 78%). */}
            <div className="flex max-w-[65%] flex-col">
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
              // No leading override: text-sm's own line-height IS WhatsApp's
              // — measured 21.25px on both, live (2026-08-31). The 19px this
              // carried was ~2px tighter than the real thing.
              // The tap that summons the touch controls beside this bubble.
              // On the bubble, not the row: the row spans the pane, and a tap
              // on empty wallpaper should not sprout icons. Desktop clicks
              // land here too and toggle the same state, which is invisible
              // there — the sm+ rules below keep the controls hover-only.
              onClick={() =>
                setActionsFor((current) => (current === item.id ? null : item.id))
              }
              // WhatsApp Web's right-click: the message menu at the cursor.
              onContextMenu={
                gates.any
                  ? (e) => {
                      e.preventDefault();
                      openBubbleMenuAt(item, e.clientX, e.clientY);
                    }
                  : undefined
              }
              // The tail is WhatsApp's: on the first bubble of a run, at its TOP
              // corner, with that corner squared off (P10; the squared bottom
              // corner it replaced was this app's own paraphrase).
              className={`group/bubble relative w-fit max-w-full rounded-lg text-sm text-[var(--chat-ink)] shadow-[var(--bubble-shadow)] ${
                outbound
                  ? `self-end ${runStart ? "rounded-tr-none " : ""}bg-[var(--chat-out)]`
                  : `${runStart ? "rounded-tl-none " : ""}bg-[var(--chat-in)]`
              } ${
                // A send that never left keeps its side and its colour and
                // wears a red ring instead. Recolouring the whole bubble made
                // a failure look like a different KIND of message.
                failed ? "opacity-70 ring-1 ring-red-400/50" : ""
              }`}
            >
              {/* WhatsApp's own tail, its paths and size (Nudge took them from
                  WhatsApp Web), overlapping the body by 1px so its edge
                  shadow leaves no seam. The tail's shadow is the same shape
                  1px lower, under it. Decorative, inside the bubble: not a
                  floating panel, so the portal rule does not apply. */}
              {runStart && (
                <svg
                  aria-hidden
                  viewBox="0 0 8 13"
                  width="8"
                  height="13"
                  className={`pointer-events-none absolute top-0 ${
                    outbound
                      ? "-right-[7px] text-[var(--chat-out)]"
                      : "-left-[7px] text-[var(--chat-in)]"
                  }`}
                >
                  <path
                    fill="var(--bubble-tail-shadow)"
                    d={
                      outbound
                        ? "M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z"
                        : "M1.533 3.568 8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z"
                    }
                  />
                  <path
                    fill="currentColor"
                    d={
                      outbound
                        ? "M5.188 0H0v11.193l6.467-8.625C7.526 1.156 6.958 0 5.188 0z"
                        : "M1.533 2.568 8 11.193V0H2.812C1.042 0 .474 1.156 1.533 2.568z"
                    }
                  />
                </svg>
              )}
              {/* WhatsApp Web's chevron, in the bubble's top-right corner on
                  hover (on a phone, with the tapped bubble's other controls).
                  Over the content rather than beside it, so the bubble never
                  changes size. */}
              {gates.any && (
                <HoverTip text={t("message.menu")} className="contents" disabled={menuOpenHere}>
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menuOpenHere}
                    aria-label={t("message.menu")}
                    onClick={(e) => {
                      // Not the bubble's tap, which toggles the phone controls.
                      e.stopPropagation();
                      if (menuOpenHere) {
                        bubbleMenu.close();
                        return;
                      }
                      openBubbleMenuUnder(item, e.currentTarget, outbound ? "end" : "start");
                    }}
                    className={`absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full text-[var(--chat-stamp)] shadow-[var(--bubble-shadow)] transition-opacity hover:text-[var(--chat-ink)] focus-visible:opacity-100 ${
                      outbound ? "bg-[var(--chat-out)]" : "bg-[var(--chat-in)]"
                    } ${
                      menuOpenHere || actionsFor === item.id
                        ? "opacity-100"
                        : "pointer-events-none opacity-0 sm:pointer-events-auto sm:group-hover/bubble:opacity-100"
                    }`}
                  >
                    <MenuIcon name="chevron" />
                  </button>
                </HoverTip>
              )}
              {/* The text row is its own flex box rather than the bubble
                  itself being one, because a template send's quick-reply rows
                  (below) have to span the bubble edge to edge, under the
                  padding, the way WhatsApp draws them. */}
              <div className="flex items-end gap-2 px-2.5 py-1.5">
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
                    {item.replyToBody ? waFormat(item.replyToBody) : t("message.quoteMedia")}
                  </p>
                </div>
              )}
              {/* Email never reaches this loop any more (its tab renders
                  EmailCards), so a bubble body is always WhatsApp text. */}
              {item.body ? (
                // WhatsApp's own *bold*, _italic_, ~strike~ and ```mono```,
                // as the customer's phone draws them (lib/waFormat).
                <p className="whitespace-pre-wrap">{waFormat(item.body)}</p>
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
                // 11px, deliberately SMALLER than WhatsApp's 12.75px stamp:
                // tried at their size (2026-08-31) and reverted the same day
                // — Serdar kept the quieter stamp.
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
              {/* The quick replies a template send carried, drawn the way the
                  customer's own WhatsApp draws them: full-width rows inside
                  the same bubble, a hairline between each, the reply arrow
                  and WhatsApp's green. NOT buttons here — they were buttons
                  on the customer's phone, and this is the record of what they
                  were offered, so the salon can read a bare "Onaylıyorum"
                  reply as a tap and not a non sequitur. */}
              {item.buttons?.map((label) => (
                <div
                  key={label}
                  className="flex items-center justify-center gap-1.5 border-t border-black/10 px-4 py-1.5 font-medium text-[#008069] dark:border-white/10 dark:text-[#00a884]"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h10a6 6 0 0 1 6 6v1" />
                  </svg>
                  {label}
                </div>
              ))}
            </div>
            {/* The reaction, hung off the bubble's bottom corner the way
                WhatsApp hangs it. Pulled up into the bubble's edge rather than
                sitting on its own line: a full line per emoji would double the
                height of a thread where people mostly answer with one. */}
            {item.reactionEmoji && (
              <span
                // On a phone the pill joins the tap-summoned controls
                // (actionsFor, Serdar 2026-09-01): a thread where half the
                // lines wear a pill was the same visual noise as the
                // permanent icons. Desktop keeps it always on — there it is
                // one pill on a wide pane, and hiding a reaction the
                // customer actually sent behind a hover would be hiding
                // content, not chrome.
                className={`z-10 -mt-2 w-fit rounded-full border border-[var(--border)] bg-[var(--card)] px-1.5 py-0.5 text-[13px] leading-none shadow-sm ${
                  outbound ? "mr-2 self-end" : "ml-2"
                } ${actionsFor === item.id ? "" : "hidden sm:block"}`}
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
                message, and reacting to ourselves would overwrite theirs. And
                only where it can reach them (canReact): the shop phone keeps
                no message key to react with.
                Hover-revealed on a pointer; on a phone, revealed by tapping
                the bubble (actionsFor) — the always-visible fallback put two
                grey icons on every line of the thread, which read as noise,
                not as controls. pointer-events dies with the opacity so an
                invisible button can't eat the tap meant for the bubble. */}
            {canCompose &&
              item.channel === "whatsapp" &&
              item.canReact && (
                <EmojiPicker
                  title={t("message.react")}
                  className={`mb-1 shrink-0 rounded-full p-1 text-[var(--muted)] transition hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] ${
                    actionsFor === item.id
                      ? "opacity-60"
                      : "pointer-events-none opacity-0"
                  } sm:pointer-events-auto sm:opacity-0 sm:group-hover:opacity-100`}
                  onPick={(emoji) => void reactTo(item.id, item.reactionEmoji, emoji)}
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
            {/* Quote-reply (Serdar, 2026-08-31), both directions — replying
                to your own earlier message is how a thread points at "that
                offer from Tuesday". Only rows holding a provider id can be
                quoted (canQuote): a quote the customer's phone can't render
                is a quote we must not offer. Same hover treatment as react. */}
            {canCompose && item.channel === "whatsapp" && item.canQuote && (
              <HoverTip text={t("message.reply")}>
              <button
                type="button"
                aria-label={t("message.reply")}
                onClick={() => {
                  setActionsFor(null);
                  setReplyTo({
                    id: item.id,
                    body: item.body ?? "",
                    direction: item.direction === "out" ? "out" : "in",
                  });
                  composerRef.current?.focus();
                }}
                className={`mb-1 shrink-0 rounded-full p-1 text-[var(--muted)] transition hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] ${
                  actionsFor === item.id
                    ? "opacity-60"
                    : "pointer-events-none opacity-0"
                } sm:pointer-events-auto sm:opacity-0 sm:group-hover:opacity-100`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <polyline points="9 17 4 12 9 7" />
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                </svg>
              </button>
              </HoverTip>
            )}
            </div>
            </Fragment>
          );
        })}
      </div>

      {menuRow && menuRow.channel === "whatsapp" && (
        <BubbleMenu
          row={menuRow}
          menu={bubbleMenu}
          gates={bubbleGates(menuRow)}
          picker={bubblePicker}
          onPicker={() => setBubblePicker(true)}
          onReply={() => {
            setReplyTo({
              id: menuRow.id,
              body: ("body" in menuRow && menuRow.body) || "",
              direction: menuRow.direction === "out" ? "out" : "in",
            });
            composerRef.current?.focus();
          }}
          onReact={(emoji) =>
            void reactTo(
              menuRow.id,
              "reactionEmoji" in menuRow ? menuRow.reactionEmoji : undefined,
              emoji,
            )
          }
          onCopy={(text) =>
            void navigator.clipboard
              .writeText(text)
              .then(() => toast(t("common.copied")))
              .catch(() => {})
          }
          onAddToNote={(text) => void addMessageToNote(text)}
        />
      )}

      {/* The staged file, where the thread was (Serdar, 2026-08-27: a
          proper surface for sending files, WhatsApp Web's own pattern
          rather than a global modal). The feed above is display:none, not
          unmounted, so closing this returns the scroll where it was. The
          composer below stays live as the caption field: body already
          rides the send as the media caption. */}
      {attached && (
        <div className="flex min-h-0 flex-1 flex-col px-[var(--pane-inline)] py-4">
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
          // Same click-time read: drops the drafted change by retiring the
          // draft. Words the reader edited stay in the box and go out as an
          // ordinary message; untouched draft text leaves with the draft.
          onDropChanges={() => {
            const p = agentState.pending;
            if (p) void discardSuggestion({ customerId, turnId: p.turnId });
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
            // pt-1 under the agent strip (Serdar, 2026-08-31): strip and
            // composer are one control cluster, and the resting pt-3 read
            // as a gap between two unrelated cards.
            className={`px-[var(--pane-inline)] pb-3 ${agentState ? "pt-1" : "pt-3"}`}
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
              // A quote-reply never rides the suggestion path: the draft was
              // written to the thread, not to one message, and the quote is
              // the sender's own explicit framing.
              const viaDraft =
                pendingNow &&
                !attached &&
                !replyTo &&
                !(when !== undefined && when > Date.now());
              // A draft that also changes an appointment only makes the
              // change on the draft path (sendSuggestion). Sent any other way
              // its words would promise a change nobody made, so that is
              // refused here; the × on the change line drops the change and
              // lets the words go as an ordinary message.
              if (pendingNow?.changes?.length && !viaDraft) {
                setSending(false);
                setSendError("change-needs-plain-send");
                return;
              }
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
                    ...(replyTo && !attached
                      ? { replyToId: replyTo.id as Id<"messages"> }
                      : {}),
                  });
              setSending(false);
              if (result.ok) {
                setDraft("");
                setScheduleAt("");
                setScheduling(false);
                setAttached(null);
                setAttaching(false);
                setReplyTo(null);
              } else setSendError(result.reason ?? "error");
            }}
          >
            {/* No prose above the pill. Whatever disables the composer says
                itself in the placeholder — a dead box explaining itself twice
                is chrome, and Serdar cut both sentences (2026-08-31). */}
            {/* The reply being quoted — WhatsApp's own composer strip: the
                left accent bar naming the quoted message, ✕ to drop it. The
                same grammar the bubble's quote block uses, so picking a
                message and seeing it sent read as one thing. */}
            {replyTo && (
              <div className="mb-1 flex items-start gap-2 rounded-xl bg-[var(--chat-field)] px-3 py-2">
                <div className="min-w-0 flex-1 rounded-md border-l-2 border-[var(--accent)] pl-2 text-xs">
                  {(replyTo.direction === "out" || contactName) && (
                    <p className="font-medium text-[var(--accent)]">
                      {replyTo.direction === "out"
                        ? t("message.quoteYou")
                        : contactName}
                    </p>
                  )}
                  <p className="line-clamp-2 whitespace-pre-wrap text-[var(--muted)]">
                    {replyTo.body ? waFormat(replyTo.body) : t("message.quoteMedia")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  aria-label={t("common.cancel")}
                  className="shrink-0 rounded-full p-1 text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            )}
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
            {/* One + instead of three icons (Serdar, 2026-08-31): a row of
                emoji, photo and clock ate the field's width, and every one
                of them is the same kind of thing — something added to the
                message that is not typing. WhatsApp's own grammar, position
                included: + on the pill's left edge, the field in the middle,
                the plane on the right. */}
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
              onPaste={(event) => {
                // A screenshot or a copied file attaches; copied text (even
                // text that carries a picture of itself, as spreadsheet cells
                // do) stays text.
                const files = pastedFiles(event.clipboardData);
                if (files.length === 0) return;
                event.preventDefault();
                void attachFile(files[0]);
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
            <div className="flex flex-wrap items-center gap-2 px-[var(--pane-inline)] pb-2">
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
              onPick={pickAsset}
              onUpload={(file) => void attachFile(file)}
              uploading={library.progress !== null}
            />
          )}
          {/* One line for every way a file arrives (tile, paste, drop), so a
              paste with the library shut still says how it went. */}
          {(library.progress !== null || library.error || library.deduped) && (
            <p
              className={`px-[var(--pane-inline)] pb-2 text-xs ${
                library.error ? "text-red-600 dark:text-red-400" : "text-[var(--muted)]"
              }`}
            >
              {library.progress !== null
                ? t("media.uploading", { percent: Math.round(library.progress * 100) })
                : (library.error ?? t("media.deduped"))}
            </p>
          )}
          {sendError && (
            // Same rule as the bubbles: a known reason gets its sentence, an
            // unknown one falls back to plain "not sent" rather than the slug.
            <p className="px-[var(--pane-inline)] pb-2 text-xs text-red-600 dark:text-red-400">
              {t(ERROR_KEY[sendError] ?? "message.failed")}
            </p>
          )}
        </>
      )}
      {confirmCallDialog}
    </div>
  );
}

// The WhatsApp bubble's menu (P23, Nudge daddc71e, e02706eb): Reply, Copy,
// React, Add to note, with the quick reactions above them where a reaction
// can reach the customer. Serdar's four in Nudge: Forward belongs to bulk
// sends, Pin and Star add nothing, and Delete would make the history lie,
// since unsending is not reliable.
function BubbleMenu({
  row,
  menu,
  gates,
  picker,
  onPicker,
  onReply,
  onReact,
  onCopy,
  onAddToNote,
}: {
  row: FeedRow;
  menu: ReturnType<typeof useContextMenu<string>>;
  gates: { text: string; canReply: boolean; canReact: boolean };
  picker: boolean;
  onPicker: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onCopy: (text: string) => void;
  onAddToNote: (text: string) => void;
}) {
  const { t } = useLanguage();
  const { panelRef, pos, close, edge } = menu;
  const current = "reactionEmoji" in row ? row.reactionEmoji : undefined;
  const items: ContextMenuItem[] = [];
  if (gates.canReply) {
    items.push({ key: "reply", icon: <MenuIcon name="reply" />, label: t("message.reply"), onSelect: onReply });
  }
  if (gates.text) {
    items.push({ key: "copy", icon: <MenuIcon name="copy" />, label: t("message.copy"), onSelect: () => onCopy(gates.text) });
  }
  if (gates.canReact) {
    items.push({ key: "react", icon: <MenuIcon name="react" />, label: t("message.react"), keepOpen: true, onSelect: onPicker });
  }
  if (gates.text) {
    items.push({ key: "note", icon: <MenuIcon name="note" />, label: t("message.addToNote"), onSelect: () => onAddToNote(gates.text) });
  }
  const pick = (emoji: string) => {
    close();
    onReact(emoji);
  };
  return (
    <ContextMenu
      panelRef={panelRef}
      pos={pos}
      open
      onClose={close}
      label={t("message.menu")}
      items={items}
      edge={edge}
      header={
        gates.canReact ? (
          <QuickReactions
            current={current}
            onPick={pick}
            onMore={onPicker}
            moreLabel={t("message.moreReactions")}
          />
        ) : undefined
      }
      replacement={picker ? <EmojiPanel onPick={pick} /> : undefined}
    />
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
// case is picking something that is already there. Most recently used first
// (media.list), and picking one moves it to the front (media.touch).
function MediaStrip({
  selectedId,
  onPick,
  onUpload,
  uploading,
}: {
  selectedId?: Id<"_storage">;
  onPick: (asset: LibraryAsset) => void;
  onUpload: (file: File) => void;
  uploading: boolean;
}) {
  const { t } = useLanguage();
  const assets = useQuery(api.media.list, {});
  const touch = useMutation(api.media.touch);
  const remove = useMutation(api.media.remove);
  const [confirm, confirmDialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const deleteAsset = async (asset: LibraryAsset) => {
    setError(null);
    const ok = await confirm({
      title: t("media.deleteConfirm", { name: asset.name }),
      confirmLabel: t("media.delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove({ assetId: asset._id });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      setError(reason.includes("in-use") ? t("media.inUse") : t("message.failed"));
    }
  };

  return (
    <div className="px-[var(--pane-inline)] pb-2">
      {confirmDialog}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {assets?.map(
          (asset) =>
            asset.url && (
              <div key={asset._id} className="group relative h-14 w-14 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    void touch({ assetId: asset._id });
                    onPick(asset);
                  }}
                  title={asset.name}
                  className={`h-14 w-14 overflow-hidden rounded-lg transition-opacity hover:opacity-80 ${
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
                {/* Delete off the library, hover-revealed so the strip stays
                    a row of files. Refused while a sent message shows it. */}
                <HoverTip text={t("media.delete")} className="contents">
                <button
                  type="button"
                  onClick={() => void deleteAsset(asset)}
                  aria-label={t("media.delete")}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--card)] text-[var(--muted)] opacity-0 shadow-sm transition-opacity hover:text-red-600 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
                </HoverTip>
              </div>
            ),
        )}
        <label
          title={t("media.uploadHint")}
          className={`flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] ${
            uploading ? "opacity-50" : ""
          }`}
        >
          <input
            type="file"
            accept={MEDIA_ACCEPT}
            className="hidden"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so picking the SAME file again after a failed upload
              // still fires a change event.
              event.target.value = "";
              if (file) onUpload(file);
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

// ── Call cards ───────────────────────────────────────────────────────────────
// One card per call on the plain chat paper, ported from Nudge 2026-09-01 —
// the same exercise the email tab went through. A card carries the direction,
// the player and the summary at rest; Details unfolds the collected values +
// the transcript IN the card. No outcome pill, per the 2026-08-25 decision:
// the summary is the outcome.

type CallCardItem = {
  id: string;
  at: number;
  inbound: boolean;
  durationSec?: number;
  summary?: string;
  transcript?: string;
  recordingUrl?: string;
  collected?: Record<string, unknown>;
  disconnectionReason?: string;
  outcome?: string;
  placedBy?: string;
  bulkRun?: string;
  booked?: { at: number; services: string[]; cancelled: boolean };
};

function CallCards({
  items,
  contactName,
  focusId,
}: {
  // Newest-first (feed order), call rows only.
  items: CallCardItem[];
  contactName?: string | null;
  // Card the parent is about to scroll to (deep link / All-index routing).
  // Read once at mount: a routed card starts EXPANDED — the person came for
  // that call's transcript, not for its existence.
  focusId?: string | null;
}) {
  const { t, language } = useLanguage();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(focusId ? [focusId] : []),
  );
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      {items.map((c, idx) => {
        // Day separators as the chat's own date pill (same as the email
        // cards); cards then carry only a time.
        const sep =
          idx === 0 ||
          formatDayHeading(items[idx - 1].at, language) !==
            formatDayHeading(c.at, language) ? (
            <div className="flex justify-center py-1.5">
              <span className="rounded-lg bg-[var(--chat-field)] px-3 py-1 text-xs font-medium text-[var(--chat-stamp)] shadow-[var(--bubble-shadow)]">
                {formatDayHeading(c.at, language)}
              </span>
            </div>
          ) : null;
        const ended = humanizeCallEnd(c.disconnectionReason, t);
        const hasCollected =
          !!c.collected && Object.keys(c.collected).length > 0;
        const expanded = expandedIds.has(c.id);
        // A missed call with nothing collected and no transcript gets no dead
        // button — blank over zero.
        const hasDetails = !!c.transcript || hasCollected;
        return (
          <Fragment key={c.id}>
            {sep}
            <div
              data-call-id={c.id}
              className="scroll-mt-2 rounded-lg bg-[var(--chat-field)] px-3.5 py-3 text-sm shadow-[var(--bubble-shadow)]"
            >
              {/* Nudge's call card (P11): the top row says what happened and
                  when; under it the facts sit left and the summary right, so
                  "who placed it, what it booked" and "what was said" read
                  side by side instead of stacked. */}
              <div className="flex items-center gap-2 text-xs">
                <FeedIcon type="call" size={13} />
                <span className="font-medium">
                  {c.inbound ? t("calls.inbound") : t("calls.outbound")}
                </span>
                {c.outcome && <CallOutcomePill outcome={c.outcome} />}
                {c.durationSec !== undefined && (
                  <span className="text-[var(--muted)]">
                    {formatDuration(c.durationSec)}
                  </span>
                )}
                <span
                  className="ml-auto shrink-0 text-[var(--muted)]"
                  title={formatDateTime(c.at, language)}
                >
                  {formatTime(c.at, language)}
                </span>
              </div>
              {(() => {
                const facts = [
                  c.placedBy ? t("calls.placedBy", { name: c.placedBy }) : null,
                  c.bulkRun ? t("calls.bulkRun", { name: c.bulkRun }) : null,
                  c.booked
                    ? `${t("calls.booked", { when: formatDateTime(c.booked.at, language) })}${
                        c.booked.services.length > 0 ? ` · ${c.booked.services.join(", ")}` : ""
                      }${c.booked.cancelled ? ` (${t("calls.bookedCancelled")})` : ""}`
                    : null,
                  // On an answered call a footnote; on a missed one the only
                  // line there is.
                  ended,
                ].filter((fact): fact is string => !!fact);
                if (facts.length === 0 && !c.summary) return null;
                return (
                  <div
                    className={`mt-2 grid gap-x-4 gap-y-2 text-xs ${
                      facts.length > 0 && c.summary
                        ? "sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]"
                        : ""
                    }`}
                  >
                    {facts.length > 0 && (
                      <ul className="space-y-1 text-[var(--muted-strong)]">
                        {facts.map((fact) => (
                          <li key={fact}>{fact}</li>
                        ))}
                      </ul>
                    )}
                    {c.summary && <p className="whitespace-pre-wrap">{c.summary}</p>}
                  </div>
                );
              })()}
              {/* The player at rest, ours rather than the browser's: it knows
                  the length before a byte is fetched (CallRecording). */}
              {c.recordingUrl && (
                <CallRecording
                  url={c.recordingUrl}
                  durationMs={c.durationSec !== undefined ? c.durationSec * 1000 : undefined}
                  className="mt-2"
                />
              )}
              {expanded && (
                <>
                  {hasCollected && (
                    <div className="mt-2">
                      <CollectedList values={c.collected!} />
                    </div>
                  )}
                  {/* The transcript straight on the card, with the CALLER
                      bubble retinted grey: it is --chat-field, invisible on
                      this --chat-field card. A paper inset was tried first in
                      Nudge and rejected — it matched the page ground exactly
                      and read as a hole punched through the card. Grey-other-
                      party-on-white is what every messenger does outside its
                      own wallpaper; the var override keeps CallTranscript
                      untouched for Voice → Calls. */}
                  {c.transcript && (
                    <div className="mt-3 [--chat-field:#f0f0f0] dark:[--chat-field:#3a3a3a]">
                      <CallTranscript
                        flow
                        transcript={c.transcript}
                        contactName={contactName}
                      />
                    </div>
                  )}
                </>
              )}
              {hasDetails && (
                <div className="mt-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                    className="font-medium text-[var(--accent)] hover:underline"
                  >
                    {expanded ? t("calls.hideDetails") : t("calls.details")}
                  </button>
                </div>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// ── Email cards ──────────────────────────────────────────────────────────────
// One card per email on the plain chat paper, ported from Nudge 2026-09-01.
// A card separates from the paper by FILL, the way a bubble does; the full
// subject is the headline and WRAPS (truncating it is the HubSpot defect the
// design exists to fix); the body shows up to a clamp with the quote-collapse
// the bubbles already had; Reply prefills the composer with THIS email's
// subject. No threading: grouping by subject was a display guess, and the
// server's normalizeSubject keeps its real job (inbound binding) untouched.

type EmailCardItem = {
  id: string;
  at: number;
  subject: string;
  html?: string;
  body?: string;
  inbound: boolean;
  status?: string;
  error?: string;
  scheduledFor?: number;
};

// How many cards mount per slab. The data is already whole (one feed query);
// the slab is about not mounting dozens of HTML bodies in one commit.
const EMAIL_PAGE = 20;
// ~11 lines of text-sm prose plus the paper's padding. Pixels, not a line
// clamp: email bodies are arbitrary HTML, which -webkit-line-clamp can't cut.
const EMAIL_CLAMP_PX = 240;

function EmailCards({
  items,
  contactName,
  focusId,
  onReply,
  onCancel,
}: {
  // Newest-first (feed order), email rows only.
  items: EmailCardItem[];
  contactName?: string | null;
  // Card the parent is about to scroll to (deep link / All-index routing).
  // Read once at mount so the first slab reaches it — scrollIntoView on a
  // card outside the slab is a silent no-op.
  focusId?: string | null;
  onReply: (subject: string) => void;
  onCancel: (id: string) => void;
}) {
  const { t, language } = useLanguage();
  const [shown, setShown] = useState(() => {
    const focusIdx = focusId ? items.findIndex((x) => x.id === focusId) : -1;
    return Math.max(EMAIL_PAGE, focusIdx + EMAIL_PAGE);
  });
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasMore = shown < items.length;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting))
          setShown((n) => n + EMAIL_PAGE);
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, shown]);
  if (items.length === 0) return null;
  const slab = items.slice(0, shown);
  return (
    <div className="space-y-2">
      {slab.map((m, idx) => {
        // Day separators as WhatsApp's own date pill — a flat text label
        // disappeared into the paper. Cards then carry only a time.
        const sep =
          idx === 0 ||
          formatDayHeading(slab[idx - 1].at, language) !==
            formatDayHeading(m.at, language) ? (
            <div className="flex justify-center py-1.5">
              <span className="rounded-lg bg-[var(--chat-field)] px-3 py-1 text-xs font-medium text-[var(--chat-stamp)] shadow-[var(--bubble-shadow)]">
                {formatDayHeading(m.at, language)}
              </span>
            </div>
          ) : null;
        const failed = m.status === "failed";
        const errorKey = errorKeyFor(m.error);
        // Reply only on mail that actually moved — answering a queued,
        // parked or failed send of your own is not a thing.
        const canReply =
          m.inbound ||
          (m.scheduledFor === undefined && !failed && m.status !== "queued");
        return (
          <Fragment key={m.id}>
            {sep}
            <div
              data-email-id={m.id}
              className="scroll-mt-2 rounded-lg bg-[var(--chat-field)] px-3.5 py-3 shadow-[var(--bubble-shadow)]"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold leading-snug">
                    {m.subject}
                  </p>
                  <p className="mt-0.5 text-xs">
                    {/* People, not directions: the customer's name emerald on
                        their mail, "You" plain on ours. */}
                    <span
                      className={
                        m.inbound
                          ? "font-medium text-emerald-700 dark:text-emerald-400"
                          : "text-[var(--muted)]"
                      }
                    >
                      {m.inbound
                        ? contactName || t("appointments.customer")
                        : t("message.quoteYou")}
                    </span>
                    {failed && (
                      <span className="text-[var(--muted)]">
                        {" · "}
                        <span className="font-medium text-red-600 dark:text-red-400">
                          {t("message.failed")}
                        </span>
                        {errorKey && <> · {t(errorKey)}</>}
                      </span>
                    )}
                    {!failed && m.status === "queued" && (
                      <span className="text-[var(--muted)]"> · {t("message.queued")}</span>
                    )}
                  </p>
                </div>
                <span
                  className="shrink-0 text-xs text-[var(--muted)]"
                  title={formatDateTime(m.at, language)}
                >
                  {formatTime(m.at, language)}
                </span>
              </div>
              <div className="pt-2">
                <ClampedEmailContent
                  html={m.html}
                  body={m.body}
                  fallback={t("message.template")}
                />
                {(m.scheduledFor !== undefined || canReply) && (
                  <div className="mt-2 flex items-center justify-end gap-3 text-xs">
                    {/* A parked send says WHEN, and offers the only action
                        that still matters. */}
                    {m.scheduledFor !== undefined && (
                      <>
                        <span className="text-[var(--muted)]">
                          {formatDateTime(m.scheduledFor, language)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onCancel(m.id)}
                          className="text-[var(--muted)] transition-colors hover:text-red-600 dark:hover:text-red-400"
                        >
                          {t("common.cancel")}
                        </button>
                      </>
                    )}
                    {canReply && (
                      <button
                        type="button"
                        onClick={() => onReply(m.subject)}
                        className="flex items-center gap-1 font-medium text-[var(--accent)] hover:underline"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <polyline points="9 17 4 12 9 7" />
                          <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                        </svg>
                        {t("email.reply")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
      {hasMore && (
        // Invisible-ish tail sentinel — crossing it (600px early) mounts the
        // next slab, so the seam is never seen.
        <div ref={sentinelRef} aria-hidden className="h-px" />
      )}
    </div>
  );
}

// The card's body: clamped with a fade until expanded. Overflow is MEASURED
// (scrollHeight against the clamp, re-checked by a ResizeObserver as images
// decode and as the quote-collapse opens), never guessed from length — an
// unconditional "Show more" under an email that fits whole is a dead button
// on most cards. The clamp applies from the first paint so a long email
// never flashes full-height; on a short one it simply never binds.
function ClampedEmailContent({
  html,
  body,
  fallback,
}: {
  html?: string;
  body?: string;
  fallback: string;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const innerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > EMAIL_CLAMP_PX + 8);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [html, body]);
  const clamped = !expanded;
  return (
    <div>
      <div
        className="relative overflow-hidden"
        style={clamped ? { maxHeight: EMAIL_CLAMP_PX } : undefined}
      >
        <div ref={innerRef}>
          {html ? (
            <QuotedEmailBody html={html} />
          ) : body ? (
            <div className="text-sm">
              <QuotedPlainBody text={body} />
            </div>
          ) : (
            <p className="text-sm text-[var(--chat-stamp)]">{fallback}</p>
          )}
        </div>
        {clamped && overflows && (
          // The fade matches what it covers: EmailBody paints white paper in
          // both themes, plain text sits straight on the card's chat-field.
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-16 rounded-b-md bg-gradient-to-t to-transparent ${
              html ? "from-white" : "from-[var(--chat-field)]"
            }`}
          />
        )}
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-[var(--accent)] hover:underline"
        >
          {expanded ? t("email.showLess") : t("email.showMore")}
        </button>
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
    <HoverTip text={t("email.showQuoted")} className="flex w-fit">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={t("email.showQuoted")}
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
    </HoverTip>
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
    // A SIGNED ROW, not a bubble (P12, Nudge 2026-09-21 session 7). A bubble
    // means a conversation, and nobody here is writing TO anybody: notes are
    // written ON the customer. So the shape the Activity index and the email
    // list already use: a hairline between rows (the list draws it), the
    // author's mark, their name at full strength, the time at the right, and
    // the body flush and full width. Named group, for the same reason the
    // toolbar's tooltip group is: this row wraps a rich editor while editing.
    <li className="group/note flex list-none gap-2.5 py-3 first:pt-0">
      {confirmDialog}
      <Avatar name={item.authorName ?? t("notes.systemAuthor")} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="min-w-0 truncate font-medium text-[var(--foreground)]">
            {item.authorName ?? t("notes.systemAuthor")}
          </span>
          {item.editedAt !== undefined && (
            <span className="shrink-0 text-[var(--muted)]">{t("notes.edited")}</span>
          )}
          {/* Hover-revealed, opacity rather than hidden, so the row never
              shifts when it appears. There is no edit button: the body itself
              is the edit affordance. */}
          <button
            type="button"
            onClick={askRemove}
            aria-label={t("common.delete")}
            className="ml-auto shrink-0 self-center text-[var(--muted)] opacity-0 transition-opacity hover:text-red-600 focus-visible:opacity-100 group-hover/note:opacity-100 dark:hover:text-red-400"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
          <span
            className="shrink-0 tabular-nums text-[var(--muted)]"
            title={formatDateTime(item.at, language)}
          >
            {formatDateTime(item.at, language)}
          </span>
        </div>
        {editing ? (
          // The editor takes the body's place, in the same format, rather
          // than jumping into a form somewhere else on the pane.
          <div className="mt-1 w-full rounded-lg bg-[var(--note-bubble-bg)] px-3 py-2">
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
          // Click to edit: the whole body, with a wash on hover so it reads as
          // something you can click, not a pencil found only by hovering.
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
            className="-mx-1.5 mt-0.5 block w-[calc(100%+0.75rem)] rounded-md px-1.5 py-0.5 text-left text-sm transition-colors hover:bg-[var(--control-hover)]"
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
function AgentThreadStrip({
  state,
  onMode,
  onStopAutoSend,
  onDropChanges,
}: {
  state: NonNullable<FunctionReturnType<typeof api.chatAgent.stateForCustomer>>;
  onMode: (mode: "off" | "suggest" | "live") => void;
  onStopAutoSend: () => void;
  onDropChanges: () => void;
}) {
  const { t, language } = useLanguage();
  const pending = state.pending;
  const live = state.effective === "live";
  // In the BUSINESS's zone, the one the calendar runs on: a draft that moves
  // an appointment to 14:00 means the salon's 14:00.
  const when = (ms: number) => formatDateTimeWithWeekday(ms, language, state.timezone);
  const changeText = (change: NonNullable<NonNullable<typeof pending>["changes"]>[number]) => {
    switch (change.kind) {
      case "book": {
        const head = change.asap
          ? t("agent.change.bookAsap")
          : t("agent.change.book", { when: when(change.at) });
        return change.services.length > 0 ? `${head} · ${change.services.join(", ")}` : head;
      }
      // Which appointment, when the assistant named it by its services too:
      // two orders can share a minute, and the line has to say which goes.
      case "move": {
        const head = t("agent.change.move", { from: when(change.from), to: when(change.to) });
        return change.services?.length ? `${head} · ${change.services.join(", ")}` : head;
      }
      case "cancel": {
        const head = t("agent.change.cancel", { when: when(change.at) });
        return change.services?.length ? `${head} · ${change.services.join(", ")}` : head;
      }
      case "save":
        return t("agent.change.save", { fields: change.labels.join(", ") });
    }
  };
  return (
    <div className="space-y-2 px-[var(--pane-inline)] pt-2">
      {/* A caption line, not a card (Serdar, 2026-08-31: "more out of the
          way but still easily seeable"). At rest this row is a SETTING, and
          a bordered, filled box with a badged icon gave a setting the same
          visual rank as the composer under it. The bare spark plus a small
          label keeps it findable — the accent spark and the pulse still say
          "answering right now" at a glance — while the two amber strips
          below keep their boxes, because a flag and a countdown are events,
          and events are what deserve the weight. */}
      <div className="flex items-center gap-2 px-1.5">
        {/* The same four-point spark the app already uses for automation
            (FeedIcon, the rules header), so the agent looks like itself
            everywhere rather than picking a new symbol per screen. */}
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className={`h-3.5 w-3.5 shrink-0 ${
            live ? "text-[var(--accent)]" : "text-[var(--muted)]"
          }`}
          aria-hidden
        >
          <path d="M12 2l1.9 5.6L19.5 9.5 13.9 11.4 12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2z" />
        </svg>
        <span className="min-w-0 truncate text-[11px] font-medium text-[var(--muted-strong)]">
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
        <span className="min-w-0 flex-1" />
        <SegmentedControl
          size="xs"
          ariaLabel={t("agent.inThisChat")}
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
      {/* What sending this draft will ALSO do. A suggested reply that books,
          moves, cancels or saves changes nothing until it is sent (2026-10-13),
          so the change sits right above the box it goes out from, where the
          person pressing Send reads it. Neutral, not amber: amber means
          unsaved, and nothing here is unsaved. */}
      {pending?.changes && pending.changes.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted-bg)] py-1 pl-2.5 pr-1 text-xs text-[var(--foreground)]">
          <ul className="min-w-0 flex-1 space-y-0.5 py-0.5">
            {pending.changes.map((change, i) => {
              const text = changeText(change);
              return (
                <li key={i} className="flex items-center gap-2" title={text}>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted-strong)]" aria-hidden />
                  <span className="min-w-0 truncate">{text}</span>
                </li>
              );
            })}
          </ul>
          {/* The way to keep the words and not the change: retires the
              draft, so whatever the reader typed goes out as an ordinary
              message. An × in a quiet square, the word on its label. */}
          <HoverTip text={t("agent.change.drop")} className="inline-flex shrink-0">
          <button
            type="button"
            onClick={onDropChanges}
            aria-label={t("agent.change.drop")}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
          </HoverTip>
        </div>
      )}

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
        ? t("agent.autoSendIn", { s })
        : t("agent.autoSendNow")}
    </span>
  );
}

// The composer's +: one trigger for everything that is not typing — emoji, a
// photo, a scheduled send — in a drop-up, WhatsApp's own attach grammar.
// Choosing Emoji swaps the panel's CONTENT to the emoji grid rather than
// opening a second popover: two floating panels racing each other's
// outside-click handlers is how the pick landed after the panel had already
// unmounted. Same portal contract as EmojiPicker, through useAnchoredPanel:
// fixed, body-portaled, closed on outside mousedown and Escape, and it
// FOLLOWS the + when the pane scrolls (it closed until 2026-10-13). It prefers
// to open upward, since the + sits at the foot of the conversation, and the
// hook re-places it when Emoji swaps the menu for the taller grid.
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
  // Which face the open panel shows. Back to the menu whenever it shuts
  // (below), so every open starts there.
  const [view, setView] = useState<"menu" | "emoji">("menu");
  // Drop-UP, right-aligned on the +, clamped so the emoji grid never runs off
  // screen next to Send; below only when the viewport leaves no room above.
  const {
    triggerRef: btnRef,
    panelRef,
    pos,
    open: panelOpen,
    toggle,
    close,
  } = useAnchoredPanel(
    view === "menu" ? PLUS_MENU_W : PLUS_EMOJI_W,
    view === "menu" ? PLUS_MENU_H : PLUS_EMOJI_H,
    "right",
    { prefer: "above", gap: 6 },
  );
  const panel = pos ? { view, ...pos } : null;
  // Back to the menu once it shuts, so the next open measures for the menu
  // and never paints a frame placed for the grid.
  useEffect(() => {
    if (!panelOpen) setView("menu");
  }, [panelOpen]);

  const dark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");

  // --row-hover-bg: on the --card panel in dark, --muted-bg is the panel
  // itself and the hover showed nothing.
  const row =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--row-hover-bg)]";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={t("contact.composerMore")}
        aria-expanded={panelOpen}
        disabled={disabled}
        onClick={toggle}
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
            style={{
              position: "fixed",
              top: panel.top,
              bottom: panel.bottom,
              left: panel.left,
              zIndex: 60,
            }}
            className={
              panel.view === "menu"
                ? "menu-surface w-[208px] rounded-xl p-1.5"
                : undefined
            }
          >
            {panel.view === "menu" ? (
              <>
                <button
                  type="button"
                  className={row}
                  onClick={() => setView("emoji")}
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
                    close();
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
                    close();
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
                  close();
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
