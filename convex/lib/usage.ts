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

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type SendChannel = "email" | "wa";

// `email_` is the channel marker the whole codebase already reads (convex/wa.ts
// writes `email_${kind}`, the feed and the agent tools both split on it), so
// this is the same question those ask, not a second definition of it.
export function channelForKind(kind: string): SendChannel {
  return kind.startsWith("email_") ? "email" : "wa";
}

export async function recordSendUsage(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  channel: SendChannel,
): Promise<void> {
  const org = await ctx.db.get(orgId);
  if (!org) return;
  const month = monthKey(Date.now(), org.timezone);
  const usage = await ctx.db
    .query("usageMonthly")
    .withIndex("by_org_month", (q) => q.eq("orgId", orgId).eq("month", month))
    .unique();
  const field = channel === "email" ? "emailSent" : "waSent";
  if (usage) {
    await ctx.db.patch(usage._id, {
      [field]: (usage[field] ?? 0) + 1,
      updatedAt: Date.now(),
    });
    return;
  }
  await ctx.db.insert("usageMonthly", {
    orgId,
    month,
    llmTurns: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    llmCostMicroUsd: 0,
    [field]: 1,
    updatedAt: Date.now(),
  });
}
