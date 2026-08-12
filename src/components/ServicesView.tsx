"use client";

// Services & fields — what this business sells, and what it collects about the
// people who buy it.
//
// Its own sidebar destination since 2026-08-12, out of Business's chip strip.
// The distinction that moved it: a price list is a body of CONTENT you
// maintain, the way Customers is, not a setting you configure once. It also
// earns the click. The voice agent reads both at call time and the public
// booking page reads services to build its slots, so between them they decide
// what the product can actually say and sell.
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
import { FieldsCard, ServicesCard } from "./BusinessView";

export function ServicesView() {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  if (!settings) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }
  // The backend enforces this too (requireOwner); the fieldset is honest UI.
  const isOwner = settings.me.role !== "staff";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {!isOwner && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-xs text-[var(--muted)]">
          {t("settings.ownerOnly")}
        </p>
      )}
      <ServicesCard isOwner={isOwner} />
      <FieldsCard isOwner={isOwner} />
    </div>
  );
}
