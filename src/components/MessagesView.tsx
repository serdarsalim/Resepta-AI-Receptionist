"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatDateTime } from "@/lib/datetime";
import { MessageThread } from "./MessageThread";

// Inbox: people list left, conversation right (Nudge's InboxView shape).
export function MessagesView({
  onOpenContact,
}: {
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t, language } = useLanguage();
  const conversations = useQuery(api.messages.conversations, {});
  const [selected, setSelected] = useState<Id<"customers"> | null>(null);

  // Default to the newest conversation so the pane is never empty on arrival.
  useEffect(() => {
    if (!selected && conversations && conversations.length > 0) {
      setSelected(conversations[0].customerId);
    }
  }, [conversations, selected]);

  const active = conversations?.find((c) => c.customerId === selected);

  if (conversations === undefined) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }
  if (conversations.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{t("messages.none")}</p>;
  }

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[20rem_1fr]">
      {/* Left: people */}
      <ul className="thin-scroll stable-gutter min-h-0 divide-y divide-[var(--border)] overflow-y-auto overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
        {conversations.map((conversation) => {
          const isActive = conversation.customerId === selected;
          return (
            <li key={conversation.customerId}>
              <button
                onClick={() => setSelected(conversation.customerId)}
                className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? "bg-[var(--row-hover-bg)] border-l-2 border-l-[var(--brand)]"
                    : "hover:bg-[var(--row-hover-bg)] border-l-2 border-l-transparent"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {conversation.name}
                  </span>
                  {conversation.hasFailed && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  )}
                  {conversation.awaitingReply && !conversation.hasFailed && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  )}
                  <span className="shrink-0 text-[10px] text-[var(--muted)]">
                    {formatDateTime(conversation.lastAt, language)}
                  </span>
                </span>
                <span className="truncate text-xs text-[var(--muted)]">
                  {conversation.lastDirection === "out" ? "↗ " : "↙ "}
                  {conversation.lastBody ?? "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Right: conversation */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
        {active && (
          <>
            <div className="flex items-center gap-2 px-4 pt-3">
              <button
                onClick={() => onOpenContact(active.customerId)}
                className="text-sm font-medium hover:underline"
              >
                {active.name}
              </button>
              <span className="text-xs text-[var(--muted)]">{active.phone}</span>
            </div>
            <MessageThread
              customerId={active.customerId}
              lastInboundAt={active.awaitingReply ? active.lastAt : undefined}
              className="flex-1"
            />
          </>
        )}
      </div>
    </div>
  );
}
