"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatDateTime } from "@/lib/datetime";

export function MessagesView() {
  const { t, language } = useLanguage();
  const messages = useQuery(api.messages.listRecent, {});

  return (
    <div className="space-y-4">
      {messages === undefined && (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      )}
      {messages?.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{t("messages.none")}</p>
      )}
      {messages && messages.length > 0 && (
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
          {messages.map((message) => (
            <li key={message._id} className="px-4 py-3 text-sm">
              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <span>
                  {message.direction === "out" ? t("messages.out") : t("messages.in")}
                </span>
                <span>·</span>
                <span>{message.kind}</span>
                <span>·</span>
                <span>{formatDateTime(message._creationTime, language)}</span>
                <span
                  className={
                    message.status === "failed"
                      ? "ml-auto text-red-600 dark:text-red-400"
                      : "ml-auto text-[var(--muted)]"
                  }
                >
                  {message.status}
                </span>
              </div>
              {message.body && <p className="mt-1">{message.body}</p>}
              {message.error && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{message.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
