"use client";

import { useAction, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatDateTime } from "@/lib/datetime";

const SESSION_WINDOW_MS = 24 * 3600_000;

// Conversation + composer. Shared by the Messages inbox (right pane) and the
// contact page — one implementation, never a per-page variant.
export function MessageThread({
  customerId,
  lastInboundAt,
  className,
}: {
  customerId: Id<"customers">;
  lastInboundAt?: number;
  className?: string;
}) {
  const { t, language } = useLanguage();
  const messages = useQuery(api.messages.listForCustomer, { customerId });
  const sendSession = useAction(api.wa.sendSession);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const thread = [...(messages ?? [])].reverse();
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [thread.length, customerId]);

  const windowOpen = !!lastInboundAt && Date.now() - lastInboundAt < SESSION_WINDOW_MS;

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <div
        ref={threadRef}
        className="thin-scroll stable-gutter min-h-0 flex-1 space-y-2 overflow-y-auto p-4"
      >
        {messages === undefined && (
          <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
        )}
        {messages?.length === 0 && (
          <p className="text-sm text-[var(--muted)]">{t("messages.none")}</p>
        )}
        {thread.map((message) => (
          <div
            key={message._id}
            className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
              message.direction === "out"
                ? "ml-auto bg-[var(--brand-soft)]"
                : "bg-[var(--muted-bg)]"
            }`}
          >
            {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
            <p className="mt-0.5 text-[10px] text-[var(--muted)]">
              {formatDateTime(message._creationTime, language)}
              {message.direction === "out" && ` · ${message.status}`}
              {message.error && ` · ${message.error}`}
            </p>
          </div>
        ))}
      </div>
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
          placeholder={windowOpen ? t("contact.typeMessage") : t("contact.sessionClosed")}
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
        <p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400">{sendError}</p>
      )}
    </div>
  );
}
