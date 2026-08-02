// The message rules table's front door: what the Reminders tab reads and
// writes, the defaults a new org starts with, and the one-shot migration that
// lifts existing orgs off the legacy org fields.
//
// A rule is a row — anchor, offset, channel, paused — and its wording lives in
// waTemplates via ruleId (schema.ts explains the resolution order). This file
// deliberately owns no send logic: lib/reminderSchedule decides when a rule is
// due and wa.sendAppointmentMessage decides what actually goes out.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { GenericDatabaseWriter } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { recordActivity } from "./lib/activity";
import {
  DEFAULT_REMINDER_OFFSETS,
  DEFAULT_WINBACK_DAYS,
} from "./orgs";

export type RuleTrigger = Doc<"messageRules">["trigger"];

const triggerValidator = v.union(
  v.literal("booking"),
  v.literal("before_start"),
  v.literal("after_end"),
  v.literal("cancellation"),
  v.literal("no_show"),
);

const channelValidator = v.union(
  v.literal("whatsapp"),
  v.literal("email"),
  v.literal("both"),
);

// Which template kind words a rule of this trigger — the fallback half of the
// content resolution in the sender. One map, exported, so the send path and
// the editor cannot drift on what "the follow-up's template" means.
export function kindForTrigger(
  trigger: RuleTrigger,
): "confirmation" | "reminder" | "followup" | "cancellation" | "winback" {
  switch (trigger) {
    case "booking":
      return "confirmation";
    case "before_start":
      return "reminder";
    case "after_end":
      return "followup";
    case "cancellation":
      return "cancellation";
    case "no_show":
      return "winback";
  }
}

// Offsets a rule may hold, per trigger. Event triggers are pinned to zero —
// they fire on the mutation, and a nonzero value would be a promise nothing
// keeps. before_start keeps the legacy 1..168h window; after_end allows up to
// 30 days (a review ask two hours later and a rebooking nudge three weeks
// later are both real); no_show keeps the winback's 1..90 days, in hours.
function clampOffset(trigger: RuleTrigger, offsetHours: number): number {
  const h = Math.round(offsetHours);
  switch (trigger) {
    case "booking":
    case "cancellation":
      return 0;
    case "before_start":
      return Math.min(168, Math.max(1, h));
    case "after_end":
      return Math.min(720, Math.max(1, h));
    case "no_show":
      return Math.min(90 * 24, Math.max(24, h));
  }
}

// Display order: the customer's journey, not insertion order. Within
// before_start, furthest-out first (24h above 2h) — the order they will fire.
const TRIGGER_ORDER: RuleTrigger[] = [
  "booking",
  "before_start",
  "after_end",
  "cancellation",
  "no_show",
];

export function sortRules(rules: Doc<"messageRules">[]): Doc<"messageRules">[] {
  return [...rules].sort((a, b) => {
    const t = TRIGGER_ORDER.indexOf(a.trigger) - TRIGGER_ORDER.indexOf(b.trigger);
    if (t !== 0) return t;
    return a.trigger === "before_start"
      ? b.offsetHours - a.offsetHours
      : a.offsetHours - b.offsetHours;
  });
}

export async function rulesForOrg(
  ctx: { db: { query: MutationCtx["db"]["query"] } },
  orgId: Id<"orgs">,
): Promise<Doc<"messageRules">[]> {
  return await ctx.db
    .query("messageRules")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
}

// The two rules every new org starts with: a confirmation and one reminder a
// day ahead. Deliberately trimmed from the legacy three — the second reminder
// and the winback are one + chip away, and a default an owner never chose is
// a message their customers never chose either.
//
// Takes the writer rather than a ctx because the founding sign-in (auth.ts)
// holds a bare db, not a MutationCtx.
export async function seedDefaultRules(
  db: GenericDatabaseWriter<DataModel>,
  orgId: Id<"orgs">,
  channel: "whatsapp" | "email" | "both" = "both",
): Promise<void> {
  await db.insert("messageRules", {
    orgId,
    trigger: "booking",
    offsetHours: 0,
    channel,
  });
  await db.insert("messageRules", {
    orgId,
    trigger: "before_start",
    offsetHours: 24,
    channel,
  });
  await db.patch(orgId, { rulesMigratedAt: Date.now() });
}

export const list = query({
  args: {},
  returns: v.object({
    // Unmigrated orgs exist between the deploy and the migration run. The tab
    // needs to say "still on the old model" rather than render an empty list
    // that reads as "you send nothing".
    migrated: v.boolean(),
    rules: v.array(
      v.object({
        _id: v.id("messageRules"),
        trigger: triggerValidator,
        offsetHours: v.number(),
        channel: channelValidator,
        paused: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    const rules = await rulesForOrg(ctx, orgId);
    return {
      migrated: org?.rulesMigratedAt !== undefined,
      rules: sortRules(rules).map((rule) => ({
        _id: rule._id,
        trigger: rule.trigger,
        offsetHours: rule.offsetHours,
        channel: rule.channel,
        paused: rule.paused ?? false,
      })),
    };
  },
});

export const add = mutation({
  args: {
    trigger: triggerValidator,
    offsetHours: v.optional(v.number()),
    channel: v.optional(channelValidator),
  },
  returns: v.id("messageRules"),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    const ruleId = await ctx.db.insert("messageRules", {
      orgId,
      trigger: args.trigger,
      offsetHours: clampOffset(args.trigger, args.offsetHours ?? 0),
      channel: args.channel ?? org?.messageChannel ?? "both",
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `message rule added: ${args.trigger}`,
    });
    await ctx.scheduler.runAfter(0, internal.reminders.backfillOrg, { orgId });
    return ruleId;
  },
});

export const update = mutation({
  args: {
    ruleId: v.id("messageRules"),
    offsetHours: v.optional(v.number()),
    channel: v.optional(channelValidator),
    paused: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const rule = await ctx.db.get(args.ruleId);
    if (!rule || rule.orgId !== orgId) throw new Error("not-found");
    const patch: Partial<Doc<"messageRules">> = {};
    if (args.offsetHours !== undefined) {
      patch.offsetHours = clampOffset(rule.trigger, args.offsetHours);
    }
    if (args.channel !== undefined) patch.channel = args.channel;
    if (args.paused !== undefined) patch.paused = args.paused;
    await ctx.db.patch(args.ruleId, patch);
    // Timing and pause state are baked into each appointment's nextMessageAt;
    // a channel change is not, but the sweep is bounded to one org and being
    // selective here is how a future field gets forgotten.
    await ctx.scheduler.runAfter(0, internal.reminders.backfillOrg, { orgId });
    return null;
  },
});

export const remove = mutation({
  args: { ruleId: v.id("messageRules") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const rule = await ctx.db.get(args.ruleId);
    if (!rule || rule.orgId !== orgId) throw new Error("not-found");
    // The rule's own wording goes with it. The kind-level fallback rows have
    // no ruleId and survive, so re-adding a reminder later still has words.
    const templates = await ctx.db
      .query("waTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    for (const template of templates) {
      if (template.ruleId === args.ruleId) await ctx.db.delete(template._id);
    }
    await ctx.db.delete(args.ruleId);
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `message rule removed: ${rule.trigger}`,
    });
    await ctx.scheduler.runAfter(0, internal.reminders.backfillOrg, { orgId });
    return null;
  },
});

// The editor's entry point for giving a rule its own wording: find or create
// the (ruleId, language) template row, seeded from the kind-level fallback so
// the owner starts from what currently sends instead of an empty box. Writes
// after that go through orgs.updateTemplate like any other template.
export const ensureTemplate = mutation({
  args: { ruleId: v.id("messageRules"), language: v.string() },
  returns: v.id("waTemplates"),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const rule = await ctx.db.get(args.ruleId);
    if (!rule || rule.orgId !== orgId) throw new Error("not-found");
    const language = args.language.trim();
    if (!language) throw new Error("bad-language");
    const kind = kindForTrigger(rule.trigger);
    const templates = await ctx.db
      .query("waTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const existing = templates.find(
      (t) => t.ruleId === args.ruleId && t.language === language,
    );
    if (existing) return existing._id;
    const fallback = templates.find(
      (t) => t.ruleId === undefined && t.kind === kind && t.language === language,
    );
    return await ctx.db.insert("waTemplates", {
      orgId,
      ruleId: args.ruleId,
      kind,
      language,
      status: "draft",
      body: fallback?.body,
      subject: fallback?.subject,
      bodyPreview: fallback?.bodyPreview,
    });
  },
});

// ── Migration off the legacy org fields ─────────────────────────────────────
//
// One rule row per thing the legacy fields said, per org, then the marker.
// Faithful, not aspirational: a paused reminder stays paused, a removed
// singleton stays absent, and the org's channel preference lands on every row
// because that is what every row effectively had. Idempotent via the marker.
//
// Run after deploying:
//   npx convex run messageRules:migrateAll --prod
export const migrateAll = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const org of await ctx.db.query("orgs").collect()) {
      await ctx.scheduler.runAfter(0, internal.messageRules.migrateOrg, {
        orgId: org._id,
      });
    }
    return null;
  },
});

export const migrateOrg = internalMutation({
  args: { orgId: v.id("orgs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org || org.rulesMigratedAt !== undefined) return null;
    const channel = org.messageChannel ?? "both";
    const removed = org.removedRules ?? [];

    if (!removed.includes("confirmation")) {
      await ctx.db.insert("messageRules", {
        orgId: args.orgId,
        trigger: "booking",
        offsetHours: 0,
        channel,
        paused: org.sendBookingConfirmation === false ? true : undefined,
      });
    }
    const offsets = org.reminderOffsetsHours ?? DEFAULT_REMINDER_OFFSETS;
    const pausedHours = org.pausedReminderHours ?? [];
    for (const offsetHours of offsets) {
      await ctx.db.insert("messageRules", {
        orgId: args.orgId,
        trigger: "before_start",
        offsetHours,
        channel,
        paused: pausedHours.includes(offsetHours) ? true : undefined,
      });
    }
    if (!removed.includes("winback")) {
      await ctx.db.insert("messageRules", {
        orgId: args.orgId,
        trigger: "no_show",
        offsetHours: (org.winbackDaysAfter ?? DEFAULT_WINBACK_DAYS) * 24,
        channel,
        paused: (org.winbackEnabled ?? false) ? undefined : true,
      });
    }
    await ctx.db.patch(args.orgId, { rulesMigratedAt: Date.now() });
    // Due times were derived from the legacy fields; re-derive from the rows
    // that now own them. A faithful migration makes this a no-op, which is
    // exactly why it is safe to run unconditionally.
    await ctx.scheduler.runAfter(0, internal.reminders.backfillOrg, {
      orgId: args.orgId,
    });
    return null;
  },
});
