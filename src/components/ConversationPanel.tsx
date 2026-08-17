"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useConfirm } from "./ConfirmDialog";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import {
  formatDateTime,
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
import { EmailBodyEditor } from "./EmailBodyEditor";
import { FeedIcon, type Channel } from "./FeedIcon";
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
  "session-window-closed": "error.session-window-closed",
  "no-template": "error.no-template",
  "missing-phone": "error.missing-phone",
  "agent-not-configured": "error.agent-not-configured",
  "no-calendar-connected": "error.no-calendar-connected",
  // Email lane.
  "missing-email": "error.missing-email",
  "no-from-address": "error.no-from-address",
  "email-not-configured": "error.email-not-configured",
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
  onFilterChange,
  className,
}: {
  customerId: Id<"customers">;
  // Labels the customer's side of a call transcript. Optional: the panel works
  // without it, the bubbles just say "Caller".
  contactName?: string | null;
  lastInboundAt?: number;
  filter?: FeedFilter;
  // The index ROUTES: an email or call row moves the whole pane to that
  // channel's tab. The parent owns the filter (its header renders the pills),
  // so the panel asks rather than sets. Without this the index can only
  // expand things in place, which is exactly the flatness it exists to fix.
  onFilterChange?: (next: FeedFilter) => void;
  className?: string;
}) {
  const { t, language } = useLanguage();
  const feed = useQuery(api.messages.feedForCustomer, { customerId });
  // The takeover chip's two facts: whether this org runs a live agent at all
  // (operator-set), and whether THIS conversation is currently a human's.
  // orgs.current is already open app-wide, so this adds one cheap read.
  const settings = useQuery(api.orgs.current, {});
  const customerRecord = useQuery(api.customers.get, { customerId });
  const setAgentPaused = useMutation(api.chatAgent.setPaused);
  const agentChipState =
    settings?.org.chatAgentMode === "live" && customerRecord
      ? customerRecord.agentPausedAt !== undefined
        ? ("paused" as const)
        : ("answering" as const)
      : null;
  const sendSession = useAction(api.wa.sendSession);
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
  const [attached, setAttached] = useState<AttachedImage | null>(null);
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
  const threadRef = useRef<HTMLDivElement>(null);

  const visible = (feed ?? []).filter(
    (item) => filter === "all" || item.channel === filter,
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

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft, filter]);

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

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      {/* Email tab header. Compose sits top-right, Gmail's convention and
          Nudge's — the old full-width footer bar spent a whole row on one
          action. This is the slot the notes composer occupies below; each
          tab owns what goes here. */}
      {filter === "email" && (
        // The header wears whatever plane the thing below it wears. Over the
        // INDEX that is the card's white, because the index is flush rows on
        // white. Over an open thread it is the tinted plane — left white it cut
        // a bright band across the top of the card and the tint started
        // abruptly under it, which read as two panes stacked rather than one
        // conversation with a heading. Same rule the takeover chip and the
        // composer already follow.
        <div
          className={`shrink-0 px-3 pt-3 ${
            chatOrder ? "bg-[var(--thread-bg)] pb-2" : ""
          }`}
        >
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
              <button
                type="button"
                onClick={() => {
                  // Reply prefills the thread's subject so the customer's
                  // client keeps the exchange together; the server threads on
                  // the same normalized key, so "Re:" here is for THEIR inbox,
                  // not ours.
                  //
                  // Stripped before prepending, or replying to a reply gives
                  // "Re: Re: Saç boyası hakkında soru" — the thread's own title
                  // usually already carries one, because it is the subject of
                  // whichever mail opened it.
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
            </div>
          )}
        </div>
      )}
      {/* Call tab header, the email tab's shape: the list needs no chrome, an
          open call gets back-arrow + outcome + when. There is no compose here
          on purpose — placing a call is Retell's job, not a button in a
          conversation pane. */}
      {filter === "call" && openCall && (
        <div className="flex shrink-0 items-center gap-2 px-3 pt-3">
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
          {/* The outcome pill was here too, printing the same raw
              `call_successful` boolean as the index did. Gone for the same
              reason: the summary is directly below it and says more. */}
          <h3 className="min-w-0 truncate text-sm font-semibold">
            {formatDateTime(openCall.at, language)}
          </h3>
        </div>
      )}
      {filter === "note" && (
        <div className="shrink-0 px-4 pt-3">
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
        className={`thin-scroll stable-gutter min-h-0 flex-1 overflow-y-auto p-4 ${
          // Only the chat wears the tinted plane. The feed view renders calls
          // and email rows with their own edges, which want the card's white
          // under them.
          chatOrder
            ? "space-y-2 bg-[var(--thread-bg)]"
            : filter === "note"
              ? "space-y-3"
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
                <span className="rounded-md bg-[var(--muted-bg)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--muted)]">
                  {formatDayHeading(item.at, language)}
                </span>
              </li>
            ) : null;
          return (
            <Fragment key={item.id}>
            {daySeparator}
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
              className={`flex w-fit max-w-[78%] items-end gap-2 rounded-2xl px-2.5 py-2 text-sm shadow-[var(--bubble-shadow)] ${
                outbound
                  ? "ml-auto rounded-br-sm bg-emerald-100 dark:bg-emerald-900/30"
                  : "rounded-bl-sm bg-[var(--card)]"
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
              {/* The picture IS the message when a customer sends one — "this
                  is the colour I want" — so it leads, capped rather than
                  stretched: a portrait photo blown to bubble width pushes
                  everything else off the screen. */}
              {item.mediaUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.mediaUrl}
                  alt=""
                  className="mb-1 max-h-52 w-auto max-w-[15rem] rounded-lg object-contain"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              )}
              {item.mediaPending && (
                // The row exists before the bytes do. A placeholder says
                // "there is a picture coming"; nothing at all says the
                // customer sent an empty message.
                <span className="mb-1 flex h-24 w-40 animate-pulse items-center justify-center rounded-lg bg-[var(--muted-bg)] text-[11px] text-[var(--muted)]">
                  {t("message.imageLoading")}
                </span>
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
              ) : (
                // Template sends store no body (the text lives in Meta's
                // approved template), so the bubble would otherwise be blank.
                // Name what was sent instead of showing an empty box.
                <p className="text-[var(--muted)]">{t("message.template")}</p>
              )}
              </div>
              <p
                className={`flex shrink-0 items-center gap-1 whitespace-nowrap pb-0.5 text-[10.5px] ${
                  failed ? "text-red-600 dark:text-red-400" : "text-[var(--muted)]"
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
            </Fragment>
          );
        })}
      </div>

      {canCompose && agentChipState && (
        /* The takeover chip (docs/chat-agent.md §5). One line above the
           composer, two states: the agent has this chat, or a human does.
           Sending any manual message also takes over (stamped server-side in
           wa.sendSession); the chip is how the thread is handed BACK, which
           no message can express. */
        <div
          className={`flex items-center justify-between gap-2 px-4 pt-2 text-xs text-[var(--muted)] ${
            chatOrder ? "bg-[var(--thread-bg)]" : ""
          }`}
        >
          <span>
            {agentChipState === "paused" ? t("agent.paused") : t("agent.answering")}
          </span>
          <button
            type="button"
            onClick={() =>
              void setAgentPaused({
                customerId,
                paused: agentChipState !== "paused",
              })
            }
            className="shrink-0 rounded-lg px-2 py-1 font-medium text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          >
            {agentChipState === "paused" ? t("agent.handBack") : t("agent.takeOver")}
          </button>
        </div>
      )}
      {canCompose && (
        <>
          <form
            // Same tint as the thread above it, on the same condition. White
            // here put a hard seam across the panel exactly where the
            // conversation ended — the composer is part of the chat surface,
            // not a footer under it. The feed view keeps card-white, because
            // its thread does too.
            className={`p-3 ${chatOrder ? "bg-[var(--thread-bg)]" : ""}`}
            onSubmit={async (event) => {
              event.preventDefault();
              const body = draft.trim();
              // An image on its own is a message. Requiring text alongside it
              // would mean captioning a price list to send a price list.
              if (!body && !attached) return;
              setSending(true);
              setSendError(null);
              const when = scheduleAt ? fromDatetimeLocalValue(scheduleAt) : undefined;
              const result = await sendSession({
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
            {/* Why the pill below is dead, said above it where there is room to
                say it. It spent its life as the placeholder, which is the one
                place in a form that cannot hold a sentence: a placeholder gets
                one line and no way to reach the rest, so at phone width it cut
                off at "until the" and put a scrollbar on a disabled box — a
                scrollbar for text the reader is not allowed to scroll. Out
                here it just wraps. */}
            {!windowOpen && (
              <p className="px-3 pb-1.5 text-xs text-[var(--muted)]">
                {t("contact.sessionClosed")}
              </p>
            )}
            {/* One pill, WhatsApp's shape and Nudge's: the field, the clock and
                Send inside a single rounded surface rather than three controls
                sharing a row. A chat composer should read as somewhere you
                talk, not as a form with a submit button. */}
            <div
              className={`flex items-end gap-1 rounded-3xl p-1.5 ${
                chatOrder ? "bg-[var(--card)]" : "bg-[var(--muted-bg)]"
              } ${windowOpen ? "" : "opacity-60"}`}
            >
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
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
                windowOpen
                  ? t("contact.typeMessage")
                  : t("contact.sessionClosedShort")
              }
              disabled={!windowOpen || sending}
              className="max-h-32 min-h-[2.25rem] flex-1 resize-none self-center overflow-y-auto border-0 bg-transparent px-3 py-2 text-sm focus:outline-none disabled:opacity-100"
            />
            {/* Inside the same pill as the clock: both are secondary actions
                on the message you are writing, and giving either its own
                surface outside the pill turns a chat box back into a form. */}
            <button
              type="button"
              onClick={() => setAttaching((prev) => !prev)}
              aria-label={t("media.attach")}
              aria-pressed={attaching}
              disabled={!windowOpen || sending}
              className={`shrink-0 self-center rounded-full p-2 transition-colors disabled:opacity-50 ${
                attaching || attached
                  ? "text-[var(--accent)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setScheduling((prev) => !prev)}
              aria-label={t("message.scheduleAt")}
              aria-pressed={scheduling}
              disabled={!windowOpen || sending}
              className={`shrink-0 self-center rounded-full p-2 transition-colors disabled:opacity-50 ${
                scheduling || scheduleAt
                  ? "text-[var(--accent)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </button>
            <button
              type="submit"
              disabled={!windowOpen || sending || (!draft.trim() && !attached)}
              className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {t("contact.send")}
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
          {attached && (
            <div className="flex items-center gap-2 px-3 pb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attached.url}
                alt=""
                className="h-10 w-10 rounded object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">
                {attached.name}
              </span>
              <button
                type="button"
                onClick={() => setAttached(null)}
                className="rounded px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              >
                {t("media.remove")}
              </button>
            </div>
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
    </div>
  );
}

type AttachedImage = { storageId: Id<"_storage">; name: string; url: string };

// The org's image library, as a row of thumbnails plus an upload tile.
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
  onPick: (asset: AttachedImage) => void;
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
                  })
                }
                title={asset.name}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg transition-opacity hover:opacity-80 ${
                  selectedId === asset.storageId
                    ? "ring-2 ring-[var(--accent)]"
                    : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset.url}
                  alt={asset.name}
                  className="h-full w-full object-cover"
                />
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
            accept="image/jpeg,image/png,image/webp"
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
    <li className="group list-none">
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
            className="shrink-0 text-[var(--muted)] opacity-0 transition-opacity hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:text-red-400"
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
          <div className="w-full min-w-[16rem] rounded-2xl bg-[var(--muted-bg)] px-3 py-2">
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
            className="min-w-0 rounded-2xl bg-[var(--muted-bg)] px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
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
      <div className="rounded-xl border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2.5 text-sm">
        {duration && <p className="mb-1 text-xs text-[var(--muted)]">{duration}</p>}
        <CallDetail call={item} contactName={contactName} />
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
