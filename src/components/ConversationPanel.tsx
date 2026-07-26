"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/datetime";
import { FeedIcon, type Channel } from "./FeedIcon";

const SESSION_WINDOW_MS = 24 * 3600_000;

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
};

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
  const addNote = useMutation(api.notes.add);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const visible = (feed ?? []).filter(
    (item) => filter === "all" || item.channel === filter,
  );
  // Messages read as a chat — oldest at the top, newest by the composer at the
  // bottom. Notes don't: nobody is having a conversation with themselves, so
  // that tab stays newest-first with its composer at the top, next to where
  // the note it writes will land.
  const chatOrder = filter !== "note";
  const thread = chatOrder ? [...visible].reverse() : visible;

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: chatOrder ? threadRef.current.scrollHeight : 0,
    });
  }, [thread.length, customerId, filter, chatOrder]);

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

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
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
            {filter === "note" ? t("notes.none") : t("messages.none")}
          </p>
        )}
        {thread.map((item) => {
          if (item.channel === "call") return <CallEntry key={item.id} item={item} />;
          if (item.channel === "note") return <NoteEntry key={item.id} item={item} />;
          const outbound = item.direction === "out";
          const failed = outbound && item.status === "failed";
          const statusKey = outbound && item.status ? STATUS_KEY[item.status] : undefined;
          const errorKey = item.error ? ERROR_KEY[item.error] : undefined;
          return (
            <div
              key={item.id}
              // A send that never left reads as a failure at a glance: red fill,
              // not the same green as a delivered reply. Fill only, no border.
              className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                failed
                  ? "ml-auto bg-red-500/10 dark:bg-red-500/15"
                  : outbound
                    ? "ml-auto bg-[var(--brand-soft)]"
                    : "bg-[var(--muted-bg)]"
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
                className={`mt-0.5 flex flex-wrap items-center gap-1 text-[10px] ${
                  failed ? "text-red-600 dark:text-red-400" : "text-[var(--muted)]"
                }`}
              >
                <FeedIcon type={item.channel} size={11} />
                <span>{formatDateTime(item.at, language)}</span>
                {statusKey && <span>· {t(statusKey)}</span>}
                {errorKey && <span>· {t(errorKey)}</span>}
              </p>
            </div>
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
function CallEntry({
  item,
}: {
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
  const duration = item.durationSec
    ? `${Math.floor(item.durationSec / 60)}:${String(item.durationSec % 60).padStart(2, "0")}`
    : null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-sm">
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
        {item.recordingUrl && (
          <a
            href={item.recordingUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-[var(--accent)] hover:underline"
          >
            {t("calls.recording")}
          </a>
        )}
      </div>
      {item.summary && <p className="mt-1">{item.summary}</p>}
      {item.transcript && (
        <details className="mt-1">
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
