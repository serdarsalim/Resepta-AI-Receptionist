"use client";

// Knowledge — what this business sells and what it can tell you.
//
// Was "Services" until 2026-08-22, holding only the price list. The rename is
// not cosmetic: the tab now carries the whole body of truth the agents read,
// and "Services" is a noun that cannot hold a paragraph about parking.
//
// The knowledge card's own hint is what argued for the merge. It reads "don't
// repeat services, prices or opening hours — the assistant already reads those
// from the app", which was the product admitting the owner's mental model is
// "things the assistant knows" while the UI scattered them across three tabs.
// That sentence now points at the card directly above it.
//
// SERVICES STAYS FIRST and keeps its own heading. Prices are the high-traffic
// thing here — an owner opens this tab to change what they charge far more
// often than to correct the address — so the word "Services" is still the
// biggest thing on screen when you land, whatever the sidebar calls the door.
//
// CONTACT FIELDS ARE DELIBERATELY NOT HERE. Knowledge is what you TELL a
// customer; fields are what you ASK one. Opposite directions, and fields are
// the Customers table's columns besides — their sibling is the customer
// record, not the price list. They stay on the Voice agent's strip beside
// service keys, which is the agent's vocabulary. A Knowledge tab that absorbs
// everything AI-adjacent is the Settings tab this codebase dissolved on
// purpose.
//
// Hours stayed in Business for the same kind of reason: getAvailableSlots
// reads them alongside staff capacity, so they are an input to a calculation,
// not a fact you recite.
//
// The cards themselves live in BusinessView and KnowledgeCard, which own their
// helpers and their row grammar. Same arrangement as BusinessHoursCard living
// in RemindersView: composed here, defined where its neighbours are.

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { ServicesCard } from "./BusinessView";
import { KnowledgeCard } from "./KnowledgeCard";

export function KnowledgeView() {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  if (!settings) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }
  // The backend enforces this too (requireOwner); the fieldset is honest UI.
  const isOwner = settings.me.role !== "staff";

  return (
    <div className="mx-auto max-w-3xl space-y-4 page-stack">
      {!isOwner && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-xs text-[var(--muted)]">
          {t("settings.ownerOnly")}
        </p>
      )}
      <ServicesCard isOwner={isOwner} />
      <KnowledgeCard isOwner={isOwner} />
    </div>
  );
}
