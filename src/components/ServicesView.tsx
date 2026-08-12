"use client";

// Services — what this business sells.
//
// Its own sidebar destination since 2026-08-12, out of Business's chip strip.
// The distinction that moved it: a price list is a body of CONTENT you
// maintain, the way Customers is, not a setting you configure once. The voice
// agent reads it at call time and the public booking page builds its slots
// from it, so it decides what the product can actually sell.
//
// CONTACT FIELDS USED TO BE HERE and moved to the Voice agent's chip strip the
// same day. The tab was called "Services & fields", which Serdar called stupid
// and was right about: the ampersand was papering over two unrelated nouns.
// Services are what you sell; fields are what you know about a customer. The
// name stopped being a problem the moment they stopped being one tab.
//
// Placed directly under Voice agent in the sidebar rather than in the foot
// group beside Business. The foot group means "about this business", which is
// the category it already occupied as a chip — moving it there would have
// bought one click and said nothing.
//
// The two cards themselves still live in BusinessView, which owns their
// helpers and their row grammar. Same arrangement as BusinessHoursCard living
// in RemindersView: composed here, defined where its neighbours are.

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { ServicesCard } from "./BusinessView";

export function ServicesView() {
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
    </div>
  );
}
