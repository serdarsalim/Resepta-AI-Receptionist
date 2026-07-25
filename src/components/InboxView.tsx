"use client";

// Inbox — every conversation with a customer, newest activity first.
// Master-detail: conversation list left, the shared ConversationPanel right.
// One row per CUSTOMER across all three channels; calls are a channel here,
// not a separate tab (ported from Nudge's InboxView).

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { FeedIcon, CHANNELS, type Channel } from "./FeedIcon";
import { ConversationPanel, type FeedFilter } from "./ConversationPanel";
import type { TranslationKey } from "@/lib/i18n";

function formatAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const CHANNEL_LABEL: Record<Channel, TranslationKey> = {
  whatsapp: "channel.whatsapp",
  email: "channel.email",
  call: "channel.call",
};

export function InboxView({
  onOpenContact,
}: {
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t } = useLanguage();
  const conversations = useQuery(api.messages.conversations, {});
  const setAttention = useMutation(api.messages.setAttention);
  const [selected, setSelected] = useState<Id<"customers"> | null>(null);
  const didAutoSelect = useRef(false);
  // Re-snapped to the conversation's own channel on every select; "all" is
  // only the before-first-selection default.
  const [filter, setFilter] = useState<FeedFilter>("all");

  // Select once, when the list first arrives. Behind a ref so the mobile Back
  // action can return to the list without being immediately overridden.
  useEffect(() => {
    if (didAutoSelect.current || !conversations?.length) return;
    didAutoSelect.current = true;
    setSelected(conversations[0].customerId);
    setFilter(conversations[0].lastChannel);
  }, [conversations]);

  const active = conversations?.find((c) => c.customerId === selected);

  return (
    // h-full, not flex-1: `main` in the shell is a block, so there's no flex
    // context to grow into — the height comes from the parent's resolved box.
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div
        className={`grid min-h-0 min-w-0 flex-1 gap-4 ${
          active
            ? "grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
            : "grid-cols-1"
        }`}
      >
        {/* Conversation list. On small screens it swaps with the open
            conversation instead of sharing the row. */}
        <section
          className={`${selected ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col`}
        >
          {/* Deliberately EMPTY. This fixed-height track mirrors the right
              column's name + channel-pills row so both card borders start on
              the same horizontal line — delete it and the columns misalign. */}
          <div className="h-9 shrink-0" />
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
            {conversations === undefined ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">
                {t("common.loading")}
              </p>
            ) : conversations.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">
                {t("inbox.empty")}
              </p>
            ) : (
              <ul>
                {conversations.map((c) => {
                  const isActive = c.customerId === selected;
                  const open = (next?: FeedFilter) => {
                    setSelected(c.customerId);
                    setFilter(next ?? c.lastChannel);
                  };
                  return (
                    <li key={c.customerId}>
                      {/* A div, not a button: it holds the channel buttons, and
                          a button can't nest inside a button. */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => open()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            open();
                          }
                        }}
                        // The LEFT BAR separates hover from selection, not the
                        // tint step — position survives fast scanning in a way
                        // a few percent of wash doesn't.
                        className={`group relative flex min-h-[3.875rem] w-full cursor-pointer items-center gap-3 border-b border-[var(--border)] px-4 py-2 text-left transition-colors before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] ${
                          isActive
                            ? "bg-[var(--row-hover-bg)] before:bg-[var(--brand)]"
                            : "hover:bg-[var(--row-hover-bg)]"
                        }`}
                      >
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            c.awaitingReply ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {c.name || c.phone}
                        </span>

                        <span className="flex shrink-0 items-center gap-2">
                          {/* Channel strip. A channel with an unanswered
                              inbound is PINNED open and tinted so the list
                              stays scannable; the rest fade in on row hover.
                              All three always render — clicking one is how you
                              START there. */}
                          <span className="flex items-center gap-0.5">
                            {CHANNELS.map((ch) => {
                              const needsReply = c.awaitingChannels.includes(ch);
                              const label = t(CHANNEL_LABEL[ch]);
                              return (
                                <button
                                  key={ch}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    open(ch);
                                  }}
                                  title={label}
                                  aria-label={label}
                                  // Hover bg is an ALPHA, not a solid: this
                                  // button sits on three different row
                                  // backgrounds and any solid would be wrong on
                                  // at least two of them.
                                  className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-[opacity,background-color] hover:bg-black/[0.07] dark:hover:bg-white/[0.12] ${
                                    needsReply
                                      ? "bg-[var(--brand)]/15 opacity-100"
                                      : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                                  }`}
                                >
                                  <FeedIcon type={ch} size={17} />
                                </button>
                              );
                            })}
                          </span>
                          {/* ONE dot, one colour, one meaning: this row still
                              needs somebody. A second hue only made the reader
                              learn a legend, so whether it is an unanswered
                              reply or a failed send lives in the title.

                              Tapping it clears the row, and tapping again
                              brings it back: a dismissed row keeps a hollow
                              ring that appears on hover, so nothing is ever
                              cleared beyond recall. Anything that arrives
                              after the dismissal lights it again on its own. */}
                          {c.needsAttention ? (
                            <button
                              type="button"
                              title={
                                c.hasFailed
                                  ? t("inbox.failedSend")
                                  : t("inbox.needsReply")
                              }
                              aria-label={t("inbox.dismiss")}
                              onClick={(e) => {
                                e.stopPropagation();
                                void setAttention({
                                  customerId: c.customerId,
                                  cleared: true,
                                });
                              }}
                              className="h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full bg-[var(--brand)]"
                            />
                          ) : c.awaitingReply || c.hasFailed ? (
                            <button
                              type="button"
                              title={t("inbox.restore")}
                              aria-label={t("inbox.restore")}
                              onClick={(e) => {
                                e.stopPropagation();
                                void setAttention({
                                  customerId: c.customerId,
                                  cleared: false,
                                });
                              }}
                              className="h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full border-2 border-[var(--brand)] opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                            />
                          ) : (
                            <span className="h-2.5 w-2.5 shrink-0" />
                          )}
                        </span>

                        {/* Last, so it pins to the row's right edge. The fixed
                            width keeps the icon cluster from shuffling between
                            a "5d" row and a "13d" one. */}
                        <span className="w-8 shrink-0 text-right text-xs text-[var(--muted)]">
                          {formatAgo(c.lastAt)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Open conversation — the same panel the contact page embeds, keyed by
            customer so composer drafts never leak across contacts. */}
        {active && (
          <section
            className={`${selected ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col`}
          >
            <div className="flex h-9 shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={t("common.back")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] lg:hidden"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M19 12H5" />
                  <path d="m12 19-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onOpenContact(active.customerId)}
                className="truncate text-sm font-semibold hover:underline"
                title={t("inbox.openContact")}
              >
                {active.name || active.phone}
              </button>
              <span className="hidden truncate text-xs text-[var(--muted)] sm:inline">
                {filter === "email" ? active.email : active.phone}
              </span>
              <div className="ml-auto flex shrink-0 flex-wrap gap-1.5">
                {[...CHANNELS, "all" as const].map((k) => {
                  const label = k === "all" ? t("inbox.all") : t(CHANNEL_LABEL[k]);
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setFilter(k)}
                      aria-label={label}
                      title={label}
                      className={`flex items-center justify-center rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        filter === k
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
                          : // Explicit card bg — the pane behind is tinted, so
                            // an unset background reads as a grey chip.
                            "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {k === "all" ? label : <FeedIcon type={k} size={14} />}
                    </button>
                  );
                })}
              </div>
            </div>
            <ConversationPanel
              key={active.customerId}
              customerId={active.customerId}
              lastInboundAt={active.awaitingReply ? active.lastAt : undefined}
              filter={filter}
              className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]"
            />
          </section>
        )}
      </div>
    </div>
  );
}
