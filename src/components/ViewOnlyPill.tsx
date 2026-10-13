"use client";

import { useT } from "@/lib/LanguageProvider";

// The one quiet mark a read-only page wears. Roles gate writes, not reads: a
// member opens the same Business, Automations and Knowledge pages an owner
// does, with every control disabled, and this pill says why. The why itself
// rides in `title`, so the page names its own gate. Ported from Nudge's
// ViewOnlyPill (2026-10-13), where it replaced five spellings of the same
// pill.
//
// Here it replaced a bordered paragraph at the top of each of those three
// pages, "Only admins can change these settings.": explanatory prose sitting
// inline, which AGENTS.md sends behind a hover ("Explanations ride the (i)").
// A pill, because it is a state of the page and not a control: nothing about
// it can be pressed.
export function ViewOnlyPill({ title }: { title: string }) {
  const t = useT();
  return (
    <span
      title={title}
      className="inline-flex h-6 shrink-0 items-center rounded-full border border-[var(--border)] px-2.5 text-xs font-medium text-[var(--muted-strong)]"
    >
      {t("common.viewOnly")}
    </span>
  );
}
