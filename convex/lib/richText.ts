// The one answer to "what email/session text does this kind send right now":
// the operator's platformRichTexts override when one exists, the stock text
// otherwise. Every place that seeds an org's template rows reads THIS, not
// DEFAULT_TEMPLATE_TEXTS directly — a new org born after the operator reworded
// the reminder must be born with the reworded reminder, or the fleet forks the
// day it grows.
//
// Send paths do NOT read this: they read the org's own waTemplates row, which
// setPlatformRichText patches fleet-wide on save. Resolution stays a seed-time
// and edit-time concern; the send path keeps its single source.

import type { GenericDatabaseReader } from "convex/server";
import type { DataModel } from "../_generated/dataModel";
import { DEFAULT_TEMPLATE_TEXTS, type TemplateKind } from "./templateTexts";

export async function resolveRichText(
  db: GenericDatabaseReader<DataModel>,
  kind: TemplateKind,
  language: string,
): Promise<{ subject: string; body: string; overridden: boolean }> {
  const stock = (DEFAULT_TEMPLATE_TEXTS[language] ?? DEFAULT_TEMPLATE_TEXTS.en)[
    kind
  ];
  const row = await db
    .query("platformRichTexts")
    .withIndex("by_kind_language", (q) =>
      q.eq("kind", kind).eq("language", language),
    )
    .unique();
  if (!row) return { subject: stock.subject, body: stock.body, overridden: false };
  return { subject: row.subject, body: row.body, overridden: true };
}
