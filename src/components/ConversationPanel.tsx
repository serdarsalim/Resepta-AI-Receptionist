"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { formatDateTime, formatDayHeading, formatTime } from "@/lib/datetime";
import { FeedIcon, type Channel } from "./FeedIcon";
import { normalizeSubject } from "../../convex/lib/emailInbound";

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

export type FeedFilter = Channel | "note" | "all";

// One customer's whole history — WhatsApp, email, calls, and the salon's own
// notes in a single interleaved feed — plus the composer. Shared by the inbox
// right pane and the contact page; one implementation, never a per-page
// variant (Nudge's rule).
export function ConversationPanel({
  customerId,
  lastInboundAt,
  filter = "all",
  className,
}: {
  customerId: Id<"customers">;
  lastInboundAt?: number;
  filter?: FeedFilter;
  className?: string;
}) {
  const { t, language } = useLanguage();
  const feed = useQuery(api.messages.feedForCustomer, { customerId });
  const sendSession = useAction(api.wa.sendSession);
  const sendEmail = useAction(api.email.sendToCustomer);
  const addNote = useMutation(api.notes.add);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
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
  const threadRef = useRef<HTMLDivElement>(null);

  const visible = (feed ?? []).filter(
    (item) => filter === "all" || item.channel === filter,
  );
  // Messages read as a chat — oldest at the top, newest by the composer at the
  // bottom. Notes don't: nobody is having a conversation with themselves, so
  // that tab stays newest-first with its composer at the top, next to where
  // the note it writes will land.
  const chatOrder = filter !== "note";

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
    threadRef.current?.scrollTo({
      top: chatOrder ? threadRef.current.scrollHeight : 0,
    });
  }, [thread.length, customerId, filter, chatOrder]);

  // Leaving the tab closes the thread. Coming back to a stale detail view of a
  // conversation you navigated away from reads as the app losing its place.
  useEffect(() => {
    if (filter !== "email") setOpenThread(null);
    if (filter !== "call") setOpenCallId(null);
  }, [filter]);

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
                    onClick={() => setOpenThread(null)}
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
            onClick={() => setOpenCallId(null)}
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
        <div className="shrink-0 p-3 pb-0">
          <div className="flex items-end gap-2 rounded-xl bg-[var(--muted-bg)] p-1.5">
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              disabled={noteSaving}
              rows={2}
              placeholder={t("notes.placeholder")}
              className="flex-1 resize-none bg-transparent px-2 py-1 text-sm focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void saveNote()}
              disabled={noteSaving || !noteDraft.trim()}
              className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {noteSaving ? t("common.saving") : t("notes.add")}
            </button>
          </div>
        </div>
      )}
      <div
        ref={threadRef}
        className="thin-scroll stable-gutter min-h-0 flex-1 space-y-2 overflow-y-auto p-4"
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
        {(filter === "email" && !openThread) || (filter === "call" && !openCall)
          ? null
          : thread.map((item, index) => {
          if (item.channel === "call")
            return <CallEntry key={item.id} item={item} detail={filter === "call"} />;
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
              {item.body ? (
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
                {/* The channel glyph earns its place only in a mixed feed. On
                    a single-channel tab every bubble would wear the same one,
                    which is decoration rather than information. */}
                {filter === "all" && <FeedIcon type={item.channel} size={11} />}
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
              </p>
            </div>
            </Fragment>
          );
        })}
      </div>

      {canCompose && (
        <>
          <form
            className="flex items-end gap-2 p-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const formEl = event.currentTarget;
              const body = String(new FormData(formEl).get("body") ?? "");
              if (!body.trim()) return;
              setSending(true);
              setSendError(null);
              const result = await sendSession({ customerId, body });
              setSending(false);
              if (result.ok) formEl.reset();
              else setSendError(result.reason ?? "error");
            }}
          >
            <textarea
              name="body"
              rows={2}
              placeholder={
                windowOpen ? t("contact.typeMessage") : t("contact.sessionClosed")
              }
              disabled={!windowOpen || sending}
              className="flex-1 resize-none"
            />
            <button
              type="submit"
              disabled={!windowOpen || sending}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {t("contact.send")}
            </button>
          </form>
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

// A note is a full-width card too, and deliberately not a bubble: a bubble
// means somebody said this to somebody. Nobody sent this anywhere — it's the
// salon writing on its own record, so it reads as a card with an author.
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

  const save = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await updateNote({ noteId: item.id as Id<"notes">, body });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="group rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-sm dark:bg-amber-500/[0.08]">
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy}
            rows={3}
            className="w-full resize-none rounded-lg bg-[var(--card)] px-2 py-1.5 text-sm"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(item.body ?? "");
                setEditing(false);
              }}
              className="rounded-lg px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !draft.trim()}
              className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-wrap break-words">{item.body}</p>
      )}
      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-[var(--muted)]">
        <FeedIcon type="note" size={11} />
        {item.authorName && <span>{item.authorName} ·</span>}
        <span>{formatDateTime(item.at, language)}</span>
        {item.editedAt !== undefined && <span>· {t("notes.edited")}</span>}
        {!editing && (
          // Edit and delete stay out of the way until the row is hovered — a
          // note is read far more often than it is corrected. Focus reveals
          // them too, so they're reachable by keyboard.
          <span className="ml-auto flex gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="hover:text-[var(--foreground)]"
            >
              {t("notes.edit")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!confirm(t("notes.deleteConfirm"))) return;
                void removeNote({ noteId: item.id as Id<"notes"> });
              }}
              className="hover:text-red-600 dark:hover:text-red-400"
            >
              {t("common.delete")}
            </button>
          </span>
        )}
      </p>
    </div>
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
}: {
  detail?: boolean;
  item: {
    at: number;
    direction?: "in" | "out";
    durationSec?: number;
    outcome?: string;
    summary?: string;
    transcript?: string;
    recordingUrl?: string;
  };
}) {
  const { t, language } = useLanguage();
  const duration =
    item.durationSec !== undefined ? formatDuration(item.durationSec) : null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-sm">
      {/* Header line repeats direction and time only when this card is riding
          in the mixed feed. Inside the call tab the pane's own header already
          said both, and saying them twice made the card look like a second
          call. */}
      {!detail && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <FeedIcon type="call" size={13} />
          <span>{item.direction === "in" ? t("calls.inbound") : t("calls.outbound")}</span>
          <span>{formatDateTime(item.at, language)}</span>
          {duration && <span>· {duration}</span>}
          {item.outcome && (
            <span className="rounded-full bg-[var(--card)] px-2 py-0.5">
              {item.outcome}
            </span>
          )}
        </div>
      )}
      {detail && duration && (
        <p className="text-xs text-[var(--muted)]">{duration}</p>
      )}
      {item.summary && <p className="mt-1">{item.summary}</p>}
      {item.recordingUrl && (
        <>
          {/* In the detail view the recording PLAYS here rather than opening a
              tab: the transcript is right underneath, and listening while
              reading is the whole reason anyone opens a call. */}
          {detail ? (
            <audio controls src={item.recordingUrl} className="mt-2 h-9 w-full" />
          ) : (
            <a
              href={item.recordingUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs text-[var(--accent)] hover:underline"
            >
              {t("calls.recording")}
            </a>
          )}
        </>
      )}
      {item.transcript && (
        // Open by default in the detail view — you navigated here to read it.
        // Collapsed in the mixed feed, where it would bury everything after.
        <details className="mt-1" open={detail}>
          <summary className="cursor-pointer text-xs text-[var(--muted)]">
            {t("calls.transcript")}
          </summary>
          <pre className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted)]">
            {item.transcript}
          </pre>
        </details>
      )}
    </div>
  );
}
