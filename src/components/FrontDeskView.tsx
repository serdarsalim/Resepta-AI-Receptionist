"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { CampaignsView } from "./CampaignsView";
import { KnowledgeCard } from "./KnowledgeCard";
import { RemindersView } from "./RemindersView";
import { VoiceView } from "./VoiceView";

// The agent's one home.
//
// Its behaviour used to live in four places two nav levels apart: Voice and
// Reminders and Campaigns in the sidebar, Knowledge inside Business. Nothing
// told you which of the two containers to look in, because the containers were
// not sorted by any single rule — the sidebar held pure config (Reminders,
// whose own comment called itself "the last of Settings") and Business held a
// pure log (Recent activity). For a product that IS an AI front desk, "where
// do I change what the agent does" should have one answer.
//
// The rule now: a sidebar entry accumulates records that arrive on their own.
// Everything the agent DOES on your behalf is a section in here. Everything the
// business IS stays in Business.
type Section = "voice" | "knowledge" | "reminders" | "campaigns";

// Deliberately NOT overlapping Business's section ids — both views read the
// same ?section param, and BusinessView's own comment relies on that. Moving
// Knowledge out of Business is what keeps it true.
const SECTIONS: { id: Section; key: TranslationKey }[] = [
  // Voice leads because calls arrive daily, and it is the one section here with
  // work in it rather than only setup. If the extra click ever bites, the fix
  // is that this view opens on Voice, not promoting it back to the sidebar.
  { id: "voice", key: "nav.voice" },
  // The agent's brain, not a fact about the salon. It sat under Business, which
  // is the same scavenger hunt the Hours comment in BusinessView describes.
  { id: "knowledge", key: "knowledge.section" },
  { id: "reminders", key: "nav.reminders" },
  { id: "campaigns", key: "campaign.title" },
];

const SECTION_STORAGE_KEY = "randevu.frontdesk.section";

function SectionChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--accent)] text-[var(--accent-fg)]"
          : "text-[var(--muted-strong)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
      }`}
    >
      {label}
    </button>
  );
}

export function FrontDeskView() {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const [section, setSectionState] = useState<Section>("voice");

  // Campaigns is earned by connecting a number, same rule it had as a sidebar
  // entry: until one is connected the section is a heading over a disabled
  // button, which reads as broken rather than unconfigured.
  const sections = SECTIONS.filter((entry) =>
    entry.id === "campaigns" ? Boolean(settings?.whatsapp.connected) : true,
  );

  // Section in the URL so a refresh stays put, last-used as the fallback for a
  // bare URL. Same shape as BusinessView.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("section");
    const stored = window.localStorage.getItem(SECTION_STORAGE_KEY);
    const next = [wanted, stored].find(
      (id): id is Section => id !== null && SECTIONS.some((s) => s.id === id),
    );
    if (next) setSectionState(next);
  }, []);

  // A section that has since been gated off would otherwise render with no chip
  // to get back to it. Waits for settings so it fires on a known answer.
  useEffect(() => {
    if (!settings) return;
    if (section === "campaigns" && !settings.whatsapp.connected) setSectionState("voice");
  }, [section, settings]);

  const setSection = (next: Section) => {
    setSectionState(next);
    window.localStorage.setItem(SECTION_STORAGE_KEY, next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.replaceState(null, "", url);
  };

  if (!settings) return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  const isOwner = settings.me.role !== "staff";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1">
        {sections.map((entry) => (
          <SectionChip
            key={entry.id}
            active={section === entry.id}
            label={t(entry.key)}
            onClick={() => setSection(entry.id)}
          />
        ))}
      </div>

      {section === "voice" && <VoiceView />}
      {/* max-w-3xl on the two card-shaped sections only. Voice and Campaigns
          own their own width because both hold tables. */}
      {section === "knowledge" && (
        <div className="mx-auto max-w-3xl">
          <KnowledgeCard isOwner={isOwner} />
        </div>
      )}
      {section === "reminders" && <RemindersView />}
      {section === "campaigns" && <CampaignsView />}
    </div>
  );
}
