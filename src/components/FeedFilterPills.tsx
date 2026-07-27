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

// Channels first, then the two things that are not channels — a form arrival
// and a note. All is separated by a rule because it isn't one of them; it's
// the way back out.
const TABS: readonly FeedFilter[] = [...CHANNELS, "form", "note"];

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
          : tab === "form"
            ? t("forms.title")
            : t(CHANNEL_LABEL[tab]);
    return (
      <button
        key={tab}
        type="button"
        onClick={() => onChange(tab)}
        aria-label={label}
        aria-pressed={active}
        // Geometry and the three states are Nudge's, read off its live DOM
        // rather than eyeballed: no explicit height (the text sets it), no
        // background on the resting pill, and ink that carries the weight —
        // an empty tab drops to half-strength muted, one with rows in it sits
        // at 75% foreground, the open one goes accent and semibold.
        // text-sm and the glyph at 15: the pills sit beside the conversation's
        // name and were reading a size below everything around them. py-1 is
        // unchanged — the row lives in a fixed h-9 track that the empty track
        // over the list mirrors, and growing it breaks the two cards' shared
        // top edge.
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors ${
          active
            ? "border-[var(--accent)] bg-[var(--accent)]/10 font-semibold text-[var(--accent)]"
            : count > 0
              ? "border-[var(--border)] font-medium text-[var(--foreground)]/75 hover:text-[var(--foreground)]"
              : "border-[var(--border)] text-[var(--muted)]/50"
        }`}
      >
        {/* Channels are icon-only — the glyphs are the ones customers know.
            Notes has no such glyph, so it carries its word: a bare pencil in a
            row of channels reads as "edit this contact". */}
        {/* Tinted in every state, open one included: the glyph's colour is how
            you find the channel, and dropping it to accent on select means the
            pill you're looking at is the one that stopped being recognizable. */}
        {tab !== "all" && <FeedIcon type={tab} size={15} />}
        {(tab === "all" || tab === "note" || tab === "form") && (
          <span>{label}</span>
        )}
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
