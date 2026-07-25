"use client";

import { useAction, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatDateTime } from "@/lib/datetime";
import { FeedIcon, type Channel } from "./FeedIcon";

const SESSION_WINDOW_MS = 24 * 3600_000;

export type FeedFilter = Channel | "all";

// One customer's whole history — WhatsApp, email, and calls in a single
// interleaved feed — plus the composer. Shared by the inbox right pane and the
// contact page; one implementation, never a per-page variant (Nudge's rule).
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
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const visible = (feed ?? []).filter(
    (item) => filter === "all" || item.channel === filter,
  );
  // Oldest at the top, newest at the bottom — chat order, not list order.
  const thread = [...visible].reverse();

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [thread.length, customerId, filter]);

  const windowOpen =
    !!lastInboundAt && Date.now() - lastInboundAt < SESSION_WINDOW_MS;
  // Replies only exist on WhatsApp: email here is one-way (template text via
  // n8n) and a call isn't something you type back into.
  const canCompose = filter === "all" || filter === "whatsapp";

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <div
        ref={threadRef}
        className="thin-scroll stable-gutter min-h-0 flex-1 space-y-2 overflow-y-auto p-4"
      >
        {feed === undefined && (
          <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
        )}
        {feed !== undefined && thread.length === 0 && (
          <p className="text-sm text-[var(--muted)]">{t("messages.none")}</p>
        )}
        {thread.map((item) =>
          item.channel === "call" ? (
            <CallEntry key={item.id} item={item} />
          ) : (
            <div
              key={item.id}
              className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                item.direction === "out"
                  ? "ml-auto bg-[var(--brand-soft)]"
                  : "bg-[var(--muted-bg)]"
              }`}
            >
              {item.body && <p className="whitespace-pre-wrap">{item.body}</p>}
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--muted)]">
                <FeedIcon type={item.channel} size={11} />
                {formatDateTime(item.at, language)}
                {item.direction === "out" && item.status ? ` · ${item.status}` : ""}
                {item.error ? ` · ${item.error}` : ""}
              </p>
            </div>
          ),
        )}
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
            <p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400">
              {sendError}
            </p>
          )}
        </>
      )}
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
    direction: "in" | "out";
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
