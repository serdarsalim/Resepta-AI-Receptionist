"use client";

// The feed's filter row, shared by the inbox and the contact page. One
// implementation on purpose: these pills decide what a row in the feed even is,
// and two copies drifting apart is how a channel ends up filterable in one
// place and invisible in the other.
//
// These belong in the PAGE HEADER, on the same line as the contact's name —
// never in a band above the conversation card. A band pushes the right card
// down and the two panes stop starting on the same line (Nudge's rule).

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { FeedIcon, CHANNELS, type Channel } from "./FeedIcon";
import type { FeedFilter } from "./ConversationPanel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";

export const CHANNEL_LABEL: Record<Channel, TranslationKey> = {
  whatsapp: "channel.whatsapp",
  email: "channel.email",
  call: "channel.call",
};

// Notes sit last of the things you can narrow to, and All is separated by a
// rule because it isn't one of them — it's the way back out.
const TABS: readonly FeedFilter[] = [...CHANNELS, "note"];

export function FeedFilterPills({
  customerId,
  value,
  onChange,
  className,
}: {
  customerId: Id<"customers">;
  value: FeedFilter;
  onChange: (next: FeedFilter) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  // The same query the panel runs, so Convex serves both from one subscription
  // rather than a counts callback threaded back up through the parent.
  const feed = useQuery(api.messages.feedForCustomer, { customerId });
  const countOf = (tab: FeedFilter) =>
    tab === "all"
      ? (feed?.length ?? 0)
      : (feed ?? []).filter((item) => item.channel === tab).length;

  const pill = (tab: FeedFilter) => {
    const count = countOf(tab);
    const active = value === tab;
    const label =
      tab === "all"
        ? t("inbox.all")
        : tab === "note"
          ? t("notes.title")
          : t(CHANNEL_LABEL[tab]);
    return (
      <button
        key={tab}
        type="button"
        onClick={() => onChange(tab)}
        aria-label={label}
        aria-pressed={active}
        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
          active
            ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
            : // Explicit card bg — the pane behind is tinted, so an unset
              // background reads as a grey chip. An empty tab dims further:
              // "nothing in here" should be legible before you click it.
              `border-[var(--border)] bg-[var(--card)] hover:text-[var(--foreground)] ${
                count === 0 ? "text-[var(--muted)]/60" : "text-[var(--muted)]"
              }`
        }`}
      >
        {/* Channels are icon-only — the glyphs are the ones customers know.
            Notes has no such glyph, so it carries its word: a bare pencil in a
            row of channels reads as "edit this contact". */}
        {tab !== "all" && <FeedIcon type={tab} size={14} tinted={!active} />}
        {(tab === "all" || tab === "note") && <span>{label}</span>}
        {/* Zero renders nothing. A row of noughts is noise, and the dimmed
            pill already says the tab is empty. */}
        {count > 0 && <span className="tabular-nums">{count}</span>}
      </button>
    );
  };

  return (
    // No wrap: the inbox header is a fixed h-9 track (it exists to line the two
    // cards up), so a second row of pills would spill out of it rather than
    // push the card down. The pills are small enough to hold one line.
    <div className={`flex shrink-0 flex-nowrap items-center gap-1.5 ${className ?? ""}`}>
      {TABS.map(pill)}
      <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--border)]" />
      {pill("all")}
    </div>
  );
}
