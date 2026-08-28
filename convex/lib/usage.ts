// The ledger's clock. Every counter on usageMonthly — LLM turns and voice
// calls alike — buckets by this key, so the two lanes always reconcile on the
// same month boundary.

// "2026-08" in the org's zone. UTC when the zone is broken — a wrong bucket
// at a month boundary beats a thrown turn.
export function monthKey(at: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
    }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 7);
  }
}

// ── The send meter ───────────────────────────────────────────────────────────
//
// One counter per channel per month, bumped where a send is confirmed. The
// fleet table reads these instead of counting rows in `messages`, which is the
// difference between a page whose cost is the number of BUSINESSES and one
// whose cost is the number of messages they have ever sent — and that page
// already learned the second lesson the hard way.
//
// Since the price book (lib/waPricing.ts) this is also where a WhatsApp send
// gets PRICED. Meta bills exactly one kind of message — a Cloud-lane template
// send — so the test is the row itself: WhatsApp kind, a templateName, not the
// Evolution lane. Free-form session replies and Evolution sends count but cost
// nothing. Cost (Meta's per-country rate for the template's landed category)
// and billed (cost plus markup) are stamped onto the message row and the month
// ledger in this same mutation, and a prepaid org's wallet draws down with
// them — the meterCall shape, applied to messaging.

import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { platformValue } from "./platformConfig";
import {
  countryForPhone,
  normalizeWaCategory,
  resolveWaRateTable,
  waRateFor,
  withMarkup,
} from "./waPricing";
import { applyWalletDebit } from "../wallet";

export type SendChannel = "email" | "wa";

// `email_` is the channel marker the whole codebase already reads (convex/wa.ts
// writes `email_${kind}`, the feed and the agent tools both split on it), so
// this is the same question those ask, not a second definition of it.
export function channelForKind(kind: string): SendChannel {
  return kind.startsWith("email_") ? "email" : "wa";
}

export async function recordSendUsage(
  ctx: MutationCtx,
  message: Doc<"messages">,
): Promise<void> {
  const org = await ctx.db.get(message.orgId);
  if (!org) return;
  const channel = channelForKind(message.kind);

  // ---- Price the send, when it is the kind Meta charges for.
  let waCostMicroUsd = 0;
  let waBilledMicroUsd = 0;
  const billable =
    channel === "wa" &&
    Boolean(message.templateName) &&
    message.lane !== "evolution";
  if (billable) {
    // Meta prices by the RECIPIENT's country and the category the template
    // LANDED as (waTemplates.metaCategory — review recategorises what it
    // disagrees with, so the landed word is what the charge follows).
    const customer = message.customerId
      ? await ctx.db.get(message.customerId)
      : null;
    const templates = await ctx.db
      .query("waTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", message.orgId))
      .collect();
    const template = templates.find((t) => t.metaName === message.templateName);
    const table = resolveWaRateTable(await platformValue(ctx, "waRateTable"));
    waCostMicroUsd = waRateFor(
      table,
      countryForPhone(customer?.phone),
      normalizeWaCategory(template?.metaCategory),
    );
    const markup =
      org.waMarkupPercent ??
      (Number(await platformValue(ctx, "waMarkupPercent")) || 0);
    waBilledMicroUsd = withMarkup(waCostMicroUsd, markup);
    // Frozen onto the row like calls.billedMicroUsd: a rate-card edit never
    // rewrites a sent message.
    await ctx.db.patch(message._id, { waCostMicroUsd, billedMicroUsd: waBilledMicroUsd });
  }

  const month = monthKey(Date.now(), org.timezone);
  const usage = await ctx.db
    .query("usageMonthly")
    .withIndex("by_org_month", (q) =>
      q.eq("orgId", message.orgId).eq("month", month),
    )
    .unique();
  const field = channel === "email" ? "emailSent" : "waSent";
  if (usage) {
    await ctx.db.patch(usage._id, {
      [field]: (usage[field] ?? 0) + 1,
      ...(billable
        ? {
            waBilledMicroUsd: (usage.waBilledMicroUsd ?? 0) + waBilledMicroUsd,
            waCostMicroUsd: (usage.waCostMicroUsd ?? 0) + waCostMicroUsd,
            waBilledCount: (usage.waBilledCount ?? 0) + 1,
          }
        : {}),
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("usageMonthly", {
      orgId: message.orgId,
      month,
      llmTurns: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      llmCostMicroUsd: 0,
      [field]: 1,
      ...(billable ? { waBilledMicroUsd, waCostMicroUsd, waBilledCount: 1 } : {}),
      updatedAt: Date.now(),
    });
  }

  // The prepaid drawdown, same mutation as the stamp (the meterCall rule). A
  // zero-billed send — pass-through rate 0, or a market priced at nothing —
  // skips the wallet rather than writing a no-op debit.
  if (billable && waBilledMicroUsd > 0 && org.billingMode === "prepaid") {
    await applyWalletDebit(ctx, org, waBilledMicroUsd);
  }
}
