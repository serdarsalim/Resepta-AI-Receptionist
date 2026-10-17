// One-shot meter backfill for calls that predate the meter (or landed while
// an org had no Retell key). CLI-run per org during onboarding:
//
//   npx convex run voiceBackfill:run '{"orgId": "..."}'
//
// Pages the org's whole Retell workspace through list-calls and stamps every
// call row this org owns that the meter missed. Stamps follow meterCall's
// exact idempotency (each side keys on its own field being unset), so running
// this twice — or running it after the webhook already metered a call — does
// nothing the second time.
//
// Billed defaults to ZERO, not to the org's current rate: a call made before
// a price existed was made at no price, and pretending otherwise invoices
// history at today's rate. Pass rateMicroUsdPerMinute only when the org
// agreed a price that predates the meter. Run this BEFORE setting the org's
// rate in /admin, the same onboarding order the nudge meter settled on.
//
// The workspace may be shared across orgs (orgs.voiceAgentSource "randevu",
// or the de_autotakt test account): listed calls that belong to no row of
// THIS org are skipped, so a shared workspace only ever backfills its own.

import { syncCustomerSearch } from "./lib/customerSearch";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { connectionField } from "./lib/connections";
import { monthKey } from "./lib/usage";
import { dialCodeForTimezone, normalisePhone } from "./lib/phone";
import { coerceVoiceValues } from "./lib/voicePayload";
import { recordCustomerCreated } from "./lib/newCustomer";
import { beginCustomerDeletion } from "./customerDeletion";
import { orgOwnNumbers } from "./retell";

const PAGE = 1000;
const MAX_PAGES = 50;
// Mutations get the page in slices: a thousand row lookups plus patches in
// one transaction flirts with the read limit for nothing.
const BATCH = 200;

export const backfillContext = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.object({ apiKey: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    return { apiKey: await connectionField(ctx, args.orgId, "retell", "apiKey") };
  },
});

export const applyBatch = internalMutation({
  args: {
    orgId: v.id("orgs"),
    rateMicroUsdPerMinute: v.number(),
    calls: v.array(
      v.object({
        callId: v.string(),
        durationMs: v.optional(v.number()),
        costMicroUsd: v.optional(v.number()),
      }),
    ),
  },
  returns: v.object({ matched: v.number(), stamped: v.number() }),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return { matched: 0, stamped: 0 };
    let matched = 0;
    let stamped = 0;
    // Month bumps collect here and land once per month at the end, so a
    // 200-call batch touches each usageMonthly row once, not 200 times.
    const bumps = new Map<
      string,
      { calls: number; seconds: number; billed: number; cost: number }
    >();
    for (const call of args.calls) {
      const row = await ctx.db
        .query("calls")
        .withIndex("by_retell_call", (q) => q.eq("retellCallId", call.callId))
        .unique();
      if (!row || row.orgId !== args.orgId) continue;
      matched += 1;
      const durationSec =
        row.durationSec ??
        (call.durationMs !== undefined ? Math.round(call.durationMs / 1000) : undefined);
      const stampBilled =
        durationSec !== undefined && row.billedMicroUsd === undefined;
      const stampCost =
        call.costMicroUsd !== undefined && row.retellCostMicroUsd === undefined;
      if (!stampBilled && !stampCost) continue;
      stamped += 1;
      const billedMicroUsd = stampBilled
        ? Math.round(((durationSec ?? 0) * args.rateMicroUsdPerMinute) / 60)
        : undefined;
      await ctx.db.patch(row._id, {
        // The webhook path never saw these calls, so the duration may be
        // missing from the row too — fill it from Retell while we are here.
        ...(row.durationSec === undefined && durationSec !== undefined
          ? { durationSec }
          : {}),
        ...(billedMicroUsd !== undefined ? { billedMicroUsd } : {}),
        ...(stampCost ? { retellCostMicroUsd: call.costMicroUsd } : {}),
      });
      const month = monthKey(row.startedAt, org.timezone);
      const bump = bumps.get(month) ?? { calls: 0, seconds: 0, billed: 0, cost: 0 };
      if (stampBilled) {
        bump.calls += 1;
        bump.seconds += durationSec ?? 0;
        bump.billed += billedMicroUsd ?? 0;
      }
      if (stampCost) bump.cost += call.costMicroUsd ?? 0;
      bumps.set(month, bump);
    }
    for (const [month, bump] of bumps) {
      const usage = await ctx.db
        .query("usageMonthly")
        .withIndex("by_org_month", (q) =>
          q.eq("orgId", args.orgId).eq("month", month),
        )
        .unique();
      if (usage) {
        await ctx.db.patch(usage._id, {
          voiceCalls: (usage.voiceCalls ?? 0) + bump.calls,
          voiceSeconds: (usage.voiceSeconds ?? 0) + bump.seconds,
          voiceBilledMicroUsd: (usage.voiceBilledMicroUsd ?? 0) + bump.billed,
          voiceCostMicroUsd: (usage.voiceCostMicroUsd ?? 0) + bump.cost,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("usageMonthly", {
          orgId: args.orgId,
          month,
          llmTurns: 0,
          llmInputTokens: 0,
          llmOutputTokens: 0,
          llmCostMicroUsd: 0,
          voiceCalls: bump.calls,
          voiceSeconds: bump.seconds,
          voiceBilledMicroUsd: bump.billed,
          voiceCostMicroUsd: bump.cost,
          updatedAt: Date.now(),
        });
      }
    }
    return { matched, stamped };
  },
});

export const run = internalAction({
  args: {
    orgId: v.id("orgs"),
    rateMicroUsdPerMinute: v.optional(v.number()),
  },
  returns: v.object({
    listed: v.number(),
    matched: v.number(),
    stamped: v.number(),
  }),
  handler: async (ctx, args) => {
    const { apiKey } = await ctx.runQuery(internal.voiceBackfill.backfillContext, {
      orgId: args.orgId,
    });
    if (!apiKey) throw new Error("no-retell-key-for-org");
    const rate = Math.max(0, Math.round(args.rateMicroUsdPerMinute ?? 0));
    let listed = 0;
    let matched = 0;
    let stamped = 0;
    let paginationKey: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch("https://api.retellai.com/v3/list-calls", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          limit: PAGE,
          sort_order: "descending",
          ...(paginationKey ? { pagination_key: paginationKey } : {}),
        }),
      });
      if (!res.ok) throw new Error(`list-calls-http-${res.status}`);
      const body = (await res.json()) as {
        has_more?: boolean;
        items?: Array<Record<string, unknown>>;
        pagination_key?: string;
      };
      const items = body.items ?? [];
      listed += items.length;
      const slim = items
        .filter((c) => typeof c.call_id === "string")
        .map((c) => {
          const cost = (c.call_cost ?? {}) as Record<string, unknown>;
          const combinedCents = Number(cost.combined_cost);
          return {
            callId: String(c.call_id),
            durationMs:
              typeof c.duration_ms === "number" ? c.duration_ms : undefined,
            costMicroUsd: Number.isFinite(combinedCents)
              ? Math.round(combinedCents * 10_000)
              : undefined,
          };
        });
      for (let i = 0; i < slim.length; i += BATCH) {
        const result = await ctx.runMutation(internal.voiceBackfill.applyBatch, {
          orgId: args.orgId,
          rateMicroUsdPerMinute: rate,
          calls: slim.slice(i, i + BATCH),
        });
        matched += result.matched;
        stamped += result.stamped;
      }
      if (!body.has_more || !body.pagination_key) break;
      paginationKey = body.pagination_key;
    }
    return { listed, matched, stamped };
  },
});

// ── Identity repair (the 18 Aug 2026 caller-identity bugs) ───────────────────
//
// Two defects put wrong identities on call rows: outbound legs were read as
// inbound (so the agent's own line became "the caller", and a contact), and
// national-format caller IDs (05386906897) were stored unnormalized, matching
// nothing — so those calls linked no contact and their collected values were
// dropped. Both are fixed at the webhook; this repairs the rows already
// written, from the raw payloads the voiceEvents inbox still holds.
//
//   npx convex run voiceBackfill:repairIdentities '{"orgId": "..."}'
//
// Idempotent: re-derived values are compared before patching, contact creation
// goes through the same match-first path as the webhook, and re-applied
// collected values fill only fields still empty. Rows whose events have no
// direction (web calls, pre-inbox rows) keep what they have.

export const repairIdentityBatch = internalMutation({
  args: { orgId: v.id("orgs"), cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    continueCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
    repaired: v.number(),
    relinked: v.number(),
    // Newly linked rows with stored collected values: the action re-applies
    // these through updateContactFromVoice, which a mutation cannot call.
    collectRedo: v.array(
      v.object({
        retellAgentId: v.string(),
        phone: v.string(),
        collected: v.record(v.string(), v.any()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("org-not-found");
    const dialCode = dialCodeForTimezone(org.timezone);
    const own = await orgOwnNumbers(ctx, args.orgId);
    const page = await ctx.db
      .query("calls")
      .withIndex("by_org_started", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .paginate({ cursor: args.cursor, numItems: 50 });

    let repaired = 0;
    let relinked = 0;
    const collectRedo: Array<{
      retellAgentId: string;
      phone: string;
      collected: Record<string, unknown>;
    }> = [];

    for (const call of page.page) {
      // What the provider actually said, recovered from the stored payloads.
      let direction = call.direction;
      let from: string | undefined;
      let to: string | undefined;
      if (call.retellCallId) {
        const events = await ctx.db
          .query("voiceEvents")
          .withIndex("by_org_call", (q) =>
            q.eq("orgId", args.orgId).eq("retellCallId", call.retellCallId!),
          )
          .collect();
        for (const event of events) {
          const payload = (event.payload ?? {}) as Record<string, unknown>;
          const c = ((payload.call ?? payload) || {}) as Record<string, unknown>;
          if (!from && c.from_number) from = String(c.from_number);
          if (!to && c.to_number) to = String(c.to_number);
          const said = String(c.direction ?? "");
          if (said === "outbound" || said === "inbound") direction = said;
        }
      }

      const rawCounterparty =
        (direction === "outbound" ? to : from) ?? call.fromNumber;
      const counterparty = rawCounterparty
        ? normalisePhone(rawCounterparty, dialCode)
        : null;

      // Detach a row pointing at a contact that IS the org's own line — the
      // contact the bug created. Cleanup below removes the contact itself.
      let customerId: Id<"customers"> | undefined = call.customerId;
      if (customerId) {
        const linked = await ctx.db.get(customerId);
        const linkedPhone = linked?.phone ? normalisePhone(linked.phone) : null;
        if (!linked || (linkedPhone && own.has(linkedPhone))) customerId = undefined;
      }
      if (counterparty && !own.has(counterparty)) {
        const existing = await ctx.db
          .query("customers")
          .withIndex("by_org_phone", (q) =>
            q.eq("orgId", args.orgId).eq("phone", counterparty),
          )
          .unique();
        customerId = existing?._id;
        if (!customerId) {
          customerId = await ctx.db.insert("customers", {
            orgId: args.orgId,
            firstName: "",
            phone: counterparty,
          });
          await syncCustomerSearch(ctx, customerId);
          await recordCustomerCreated(ctx, {
            orgId: args.orgId,
            customerId,
            source: "voice",
          });
        }
      }

      const fromNumber = counterparty ?? rawCounterparty;
      const patch: Record<string, unknown> = {};
      if (direction !== call.direction) patch.direction = direction;
      if (fromNumber !== call.fromNumber) patch.fromNumber = fromNumber;
      if (customerId !== call.customerId) {
        patch.customerId = customerId;
        relinked += 1;
        // The webhook dropped these on the floor when the number didn't
        // match; now that the row has a contact, land them there too.
        if (customerId && call.retellAgentId && counterparty && call.collected) {
          collectRedo.push({
            retellAgentId: call.retellAgentId,
            phone: counterparty,
            collected: call.collected,
          });
        }
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(call._id, patch);
        repaired += 1;
      }
    }

    return {
      continueCursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
      repaired,
      relinked,
      collectRedo,
    };
  },
});

// Deletes the contacts the bug minted for the org's own lines. Only a contact
// nothing else references — after repairIdentityBatch has repointed the call
// rows, a bug-made contact references nothing. One with appointments, calls,
// messages or notes is reported instead of deleted; something real happened
// under that number and a human should look.
export const removeOwnNumberContacts = internalMutation({
  args: { orgId: v.id("orgs") },
  returns: v.object({ removed: v.array(v.string()), kept: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const own = await orgOwnNumbers(ctx, args.orgId);
    const removed: string[] = [];
    const kept: string[] = [];
    for (const number of own) {
      const customer = await ctx.db
        .query("customers")
        .withIndex("by_org_phone", (q) =>
          q.eq("orgId", args.orgId).eq("phone", number),
        )
        .unique();
      if (!customer) continue;
      const references = await Promise.all(
        (["appointments", "calls", "messages", "notes"] as const).map((table) =>
          ctx.db
            .query(table)
            .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
            .first(),
        ),
      );
      if (references.some((row) => row !== null)) {
        kept.push(number);
        continue;
      }
      // Through the one deletion path, which also clears the activity rows
      // and read marks a bare row delete left pointing at nobody. The number
      // is the business's own line, not a customer's, so naming it is fine.
      await beginCustomerDeletion(ctx, customer, { system: true, detail: number });
      removed.push(number);
    }
    return { removed, kept };
  },
});

// Annotated result types, not inference: the action calls into its own module
// through internal.*, and letting TypeScript infer the handler's type from
// that reference is circular — the same reason voiceEvents.process casts.
type RepairBatchResult = {
  continueCursor: string | null;
  isDone: boolean;
  repaired: number;
  relinked: number;
  collectRedo: Array<{
    retellAgentId: string;
    phone: string;
    collected: Record<string, unknown>;
  }>;
};

export const repairIdentities = internalAction({
  args: { orgId: v.id("orgs") },
  returns: v.object({
    repaired: v.number(),
    relinked: v.number(),
    collectedReapplied: v.number(),
    removedContacts: v.array(v.string()),
    keptContacts: v.array(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    repaired: number;
    relinked: number;
    collectedReapplied: number;
    removedContacts: string[];
    keptContacts: string[];
  }> => {
    let repaired = 0;
    let relinked = 0;
    let collectedReapplied = 0;
    let cursor: string | null = null;
    for (;;) {
      const batch = (await ctx.runMutation(
        internal.voiceBackfill.repairIdentityBatch,
        { orgId: args.orgId, cursor },
      )) as RepairBatchResult;
      repaired += batch.repaired;
      relinked += batch.relinked;
      for (const redo of batch.collectRedo) {
        const values = coerceVoiceValues(redo.collected);
        if (Object.keys(values).length === 0) continue;
        // fillOnlyMissing: this is recovery, not replay — a value someone has
        // typed in since the broken call outranks what the call collected.
        const result = await ctx.runMutation(internal.retell.updateContactFromVoice, {
          retellAgentId: redo.retellAgentId,
          phone: redo.phone,
          values,
          fillOnlyMissing: true,
        });
        if (result.ok && result.updated.length > 0) collectedReapplied += 1;
      }
      if (batch.isDone || !batch.continueCursor) break;
      cursor = batch.continueCursor;
    }
    const cleanup = (await ctx.runMutation(
      internal.voiceBackfill.removeOwnNumberContacts,
      { orgId: args.orgId },
    )) as { removed: string[]; kept: string[] };
    return {
      repaired,
      relinked,
      collectedReapplied,
      removedContacts: cleanup.removed,
      keptContacts: cleanup.kept,
    };
  },
});
