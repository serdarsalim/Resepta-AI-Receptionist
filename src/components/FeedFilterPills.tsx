"use client";

// The feed's filter row, shared by the inbox and the contact page. One
// implementation on purpose: these pills decide what a row in the feed even is,
// and two copies drifting apart is how a channel ends up filterable in one
// place and invisible in the other.

import { FeedIcon, CHANNELS, type Channel } from "./FeedIcon";
import type { FeedFilter } from "./ConversationPanel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";

export const CHANNEL_LABEL: Record<Channel, TranslationKey> = {
  whatsapp: "channel.whatsapp",
  email: "channel.email",
  call: "channel.call",
};

// Notes sit between the channels and All: last of the things you can narrow
// to, first one that isn't a channel.
const TABS: readonly FeedFilter[] = [...CHANNELS, "note", "all"];

export function FeedFilterPills({
  value,
  onChange,
  className,
}: {
  value: FeedFilter;
  onChange: (next: FeedFilter) => void;
  className?: string;
}) {
  const { t } = useLanguage();

  return (
    <div className={`flex shrink-0 flex-wrap gap-1.5 ${className ?? ""}`}>
      {TABS.map((tab) => {
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
            aria-pressed={value === tab}
            className={`flex items-center justify-center rounded-full border px-2.5 py-1 text-xs transition-colors ${
              value === tab
                ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
                : // Explicit card bg — the pane behind is tinted, so an unset
                  // background reads as a grey chip.
                  "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {tab === "all" ? label : <FeedIcon type={tab} size={14} />}
          </button>
        );
      })}
    </div>
  );
}
