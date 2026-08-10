"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
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
import { FeedIcon, type Channel } from "./FeedIcon";
import { normalizeSubject } from "../../convex/lib/emailInbound";
import { hardenEmailLinks, sanitizeEmailHtml } from "@/lib/sanitizeHtml";

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
  // Grows with what is typed, bottom-anchored and capped, so a three-line note
  // is visible while writing without the field owning half the pane.
  const noteDraftRef = useRef<HTMLTextAreaElement>(null);
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
                snippet: ("body" in item ? item.body : undefined) ?? "",
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

  useEffect(() => {
    const el = noteDraftRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [noteDraft, filter]);

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
    if (!body || noteSaving) return;
    setNoteSaving(true);
    try {
      await addNote({ customerId, body });
      setNoteDraft("");
    } finally {
      setNoteSaving(false);
    }
  };

  const submitEmail = async () => {
    if (!emailBody.trim() || emailSending) return;
    setEmailSending(true);
    setEmailError(null);
    const result = await sendEmail({
      customerId,
      subject: emailSubject,
      body: emailBody,
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
        <div className="shrink-0 px-3 pt-3">
          {composing ? (
            <div className="space-y-2 rounded-xl border border-[var(--border)] p-2">
              <input
                value={emailSubject}
                onChange={(event) => setEmailSubject(event.target.value)}
                placeholder={t("email.subject")}
                disabled={emailSending}
              />
              <textarea
                value={emailBody}
                onChange={(event) => setEmailBody(event.target.value)}
                placeholder={t("email.bodyPlaceholder")}
                rows={4}
                disabled={emailSending}
                className="resize-none"
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
                  disabled={emailSending || !emailBody.trim()}
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
                  setEmailSubject(
                    openThread ? `Re: ${openThread.subject}` : "",
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
          {"outcome" in openCall && openCall.outcome && (
            <span className="shrink-0 rounded-full bg-[var(--muted-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
              {openCall.outcome}
            </span>
          )}
          <h3 className="min-w-0 truncate text-sm font-semibold">
            {formatDateTime(openCall.at, language)}
          </h3>
        </div>
      )}
      {filter === "note" && (
        <div className="shrink-0 px-4 pt-3">
          {/* One pill, not a box with a button beside it: a note is a single
              short thought, and the composer should look like somewhere you
              type one rather than a form you fill in. Nudge's shape. */}
          <div className="flex items-end gap-1 rounded-3xl bg-[var(--muted-bg)] py-1.5 pl-1.5 pr-1.5">
            <textarea
              ref={noteDraftRef}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              disabled={noteSaving}
              rows={1}
              placeholder={t("notes.placeholder")}
              className="max-h-32 min-h-[2.25rem] flex-1 resize-none self-center overflow-y-auto border-0 bg-transparent px-3 py-2 text-sm focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void saveNote()}
              disabled={noteSaving || !noteDraft.trim()}
              className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {noteSaving ? t("common.saving") : t("notes.add")}
            </button>
          </div>
        </div>
      )}
      <div
        ref={threadRef}
        // Bubbles need breathing room between them; a LIST does not — its rows
        // are separated by hairlines, and 8px of margin on top of a border is
        // what made the note cards read as a stack of boxes.
        className={`thin-scroll stable-gutter min-h-0 flex-1 overflow-y-auto p-4 ${
          chatOrder ? "space-y-2" : ""
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
                  {"outcome" in item && item.outcome && (
                    <span className="rounded-full bg-[var(--muted-bg)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                      {item.outcome}
                    </span>
                  )}
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
                      <p className="whitespace-pre-wrap break-words">{item.body}</p>
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
              className={`max-w-[78%] rounded-2xl px-2.5 py-2 text-sm shadow-sm ${
                outbound
                  ? "ml-auto rounded-br-sm bg-emerald-100 dark:bg-emerald-900/30"
                  : "rounded-bl-sm border border-[var(--border)] bg-[var(--card)]"
              } ${
                // A send that never left keeps its side and its colour and
                // wears a red ring instead. Recolouring the whole bubble made
                // a failure look like a different KIND of message.
                failed ? "opacity-70 ring-1 ring-red-400/50" : ""
              }`}
            >
              {/* Email carries a subject and WhatsApp doesn't, so it leads
                  the bubble when there is one. It also rescues the case where
                  the body never arrived: the provider hands us the metadata
                  first and the body on a second call, and a fetch that fails
                  must still leave a readable row. */}
              {item.emailSubject && (
                <p className="font-medium">{item.emailSubject}</p>
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
                <EmailBody html={item.emailHtml} />
              ) : item.body ? (
                <p className="whitespace-pre-wrap">{item.body}</p>
              ) : (
                !item.emailSubject && (
                  // Template sends store no body (the text lives in Meta's
                  // approved template), so the bubble would otherwise be blank.
                  // Name what was sent instead of showing an empty box.
                  <p className="text-[var(--muted)]">{t("message.template")}</p>
                )
              )}
              <p
                className={`mt-0.5 flex flex-wrap items-center gap-1 text-[10.5px] ${
                  outbound ? "justify-end" : ""
                } ${failed ? "text-red-600 dark:text-red-400" : "text-[var(--muted)]"}`}
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
        <div className="flex items-center justify-between gap-2 px-4 pt-2 text-xs text-[var(--muted)]">
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
            className="p-3"
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
            {/* One pill, WhatsApp's shape and Nudge's: the field, the clock and
                Send inside a single rounded surface rather than three controls
                sharing a row. A chat composer should read as somewhere you
                talk, not as a form with a submit button. */}
            <div
              className={`flex items-end gap-1 rounded-3xl bg-[var(--muted-bg)] p-1.5 ${
                windowOpen ? "" : "opacity-60"
              }`}
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
                windowOpen ? t("contact.typeMessage") : t("contact.sessionClosed")
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

// A note is a full-width card too, and deliberately not a bubble: a bubble
// means somebody said this to somebody. Nobody sent this anywhere — it's the
// salon writing on its own record, so it reads as a card with an author.
// One note, as a flush row in a list rather than a card in a stream.
//
// Cards were the prototype: five amber boxes stacked down a pane, every one
// fully expanded, so finding the note about the ammonia allergy meant reading
// all of them. A list is scannable, and reading is what you came to do.
//
// Expandability is MEASURED, not guessed. A note with no line breaks can still
// be too long for the row, and no character count knows the rendered width of
// a pane the user can resize — so the snippet reports its own overflow. A note
// that fits shows all of it and gets no chevron: expand theatre on a six-word
// note is a click that changes nothing.
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
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.body ?? "");
  const [busy, setBusy] = useState(false);

  const body = item.body ?? "";
  // The measured node is STATE, not a ref, so the effect re-runs whenever the
  // span is replaced. It gets replaced constantly: flipping `overflowing`
  // swaps this row between a plain div and a button, and opening it swaps the
  // snippet for a spacer — each one unmounts the old span and mounts a new one.
  //
  // This is what the bug was. `measure` closed over the span captured when the
  // effect last ran, so the moment overflow was detected and the row re-rendered
  // as a button, the ResizeObserver was left watching a DETACHED node. Detached
  // elements report zero, the observer fired, the stale closure computed
  // `0 > clientWidth + 1` as false, and the row went straight back to
  // "not expandable" — permanently, because the effect's deps never changed so
  // it never re-attached. A long note ellipsised with no chevron to open it.
  const [snippet, setSnippet] = useState<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    // Open or editing: keep the last measurement rather than resetting it, or
    // collapsing would decide the row is short and drop its own chevron.
    if (!snippet) return;
    const measure = () => {
      // A zero-width box is a node that is detached, or in a pane that has not
      // been laid out yet. Neither is evidence that the text FITS, so record
      // nothing — the old answer is better than a wrong new one, and the
      // observer will call again once there is something real to measure.
      if (snippet.clientWidth === 0) return;
      setOverflowing(snippet.scrollWidth > snippet.clientWidth + 1);
    };
    measure();
    // Again after paint, for the case where the pane was hidden a moment ago.
    const raf = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(snippet);
    // And once more when webfonts land. Swapping from the fallback face changes
    // the text's width WITHOUT changing this element's box — it is flex-sized
    // by the row — so the observer never fires for it and a note that only
    // overflows in the real font would keep the fallback's answer forever.
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [snippet, body, open, editing]);
  const expandable = /\n/.test(body.trim()) || overflowing;

  const save = async () => {
    const next = draft.trim();
    if (!next || busy) return;
    setBusy(true);
    try {
      await updateNote({ noteId: item.id as Id<"notes">, body: next });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <li className="-mx-4 list-none border-b border-[var(--border)] px-4 py-3 first:border-t">
        <textarea
          autoFocus
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-[4rem] w-full resize-y text-sm"
        />
        <div className="mt-1.5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(body);
              setEditing(false);
            }}
            disabled={busy}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--muted-bg)] disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !draft.trim()}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </li>
    );
  }

  const meta = (
    <>
      {item.editedAt !== undefined && (
        <span className="shrink-0 text-[11px] text-[var(--muted)]">
          {t("notes.edited")}
        </span>
      )}
      {item.authorName && (
        <span className="hidden shrink-0 text-xs text-[var(--muted)] sm:inline">
          {item.authorName}
        </span>
      )}
      {/* Hover-revealed, and a span rather than a button because this sits
          inside the row's own button when the note is expandable. */}
      <span
        role="button"
        tabIndex={0}
        aria-label={t("notes.edit")}
        onClick={(event) => {
          event.stopPropagation();
          setDraft(body);
          setEditing(true);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.stopPropagation();
          setDraft(body);
          setEditing(true);
        }}
        className="shrink-0 cursor-pointer text-[var(--muted)] opacity-0 transition-opacity hover:text-[var(--foreground)] focus:opacity-100 group-hover:opacity-100"
      >
        <FeedIcon type="note" size={13} tinted={false} />
      </span>
      <span
        role="button"
        tabIndex={0}
        aria-label={t("common.delete")}
        onClick={(event) => {
          event.stopPropagation();
          if (!confirm(t("notes.deleteConfirm"))) return;
          void removeNote({ noteId: item.id as Id<"notes"> });
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.stopPropagation();
          if (!confirm(t("notes.deleteConfirm"))) return;
          void removeNote({ noteId: item.id as Id<"notes"> });
        }}
        className="shrink-0 cursor-pointer text-[var(--muted)] opacity-0 transition-opacity hover:text-red-600 focus:opacity-100 group-hover:opacity-100 dark:hover:text-red-400"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      </span>
      <span
        className="ml-3 min-w-[4.5rem] shrink-0 text-right text-xs text-[var(--muted)]"
        title={formatDateTime(item.at, language)}
      >
        {formatDateTime(item.at, language)}
      </span>
    </>
  );

  return (
    <li className="-mx-4 list-none border-b border-[var(--border)] first:border-t">
      {expandable ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="group flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-[var(--row-hover-bg)]"
          >
            <span
              aria-hidden
              className={`w-3 shrink-0 text-xs text-[var(--muted)] transition-transform ${open ? "rotate-90" : ""}`}
            >
              ▸
            </span>
            {open ? (
              // The body below already shows the first line; repeating it here
              // reads as the note having been written twice. Spacer keeps the
              // meta column where it was.
              <span className="min-w-0 flex-1" />
            ) : (
              <span ref={setSnippet} className="min-w-0 flex-1 truncate text-sm">
                {body}
              </span>
            )}
            {meta}
          </button>
          {open && (
            <div className="px-4 pb-3.5 pl-11 pt-1">
              <p className="whitespace-pre-wrap break-words text-sm">{body}</p>
            </div>
          )}
        </>
      ) : (
        <div className="group flex w-full items-center gap-2 px-4 py-2.5">
          <span aria-hidden className="w-3 shrink-0" />
          <span ref={setSnippet} className="min-w-0 flex-1 truncate text-sm">
            {body}
          </span>
          {meta}
        </div>
      )}
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
