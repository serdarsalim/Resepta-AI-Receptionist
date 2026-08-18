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
  v.literal("out_of_hours"),
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
):
  | "confirmation"
  | "reminder"
  | "followup"
  | "cancellation"
  | "winback"
  | "out_of_hours" {
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
    case "out_of_hours":
      return "out_of_hours";
  }
}

// Offsets a rule may hold, per trigger. Event triggers are pinned to zero —
// they fire on the mutation, and a nonzero value would be a promise nothing
// keeps. before_start keeps the legacy 1..168h window; after_end allows up to
// 30 days (a review ask two hours later and a rebooking nudge three weeks
// later are both real); no_show keeps the winback's 1..90 days, in hours.
export function clampOffset(trigger: RuleTrigger, offsetHours: number): number {
  const h = Math.round(offsetHours);
  switch (trigger) {
    case "booking":
    case "cancellation":
    case "out_of_hours":
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
  // Last: it hangs off the clock, not the appointment journey the rest of the
  // list walks through.
  "out_of_hours",
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

// Stock wording per language, used twice: resetToDefaults writes it onto the
// kind-level fallback rows, and ensureTemplate reaches for it when an org has
// no fallback row in its language at all — which is every non-Turkish org,
// because the founding seeds only ever spoke Turkish. Tokens are written in
// English token names ([name], [business], [date], [service]) — the PROSE is
// per language, the vocabulary never is. See lib/renderTokens.
type TemplateKind =
  | "confirmation"
  | "reminder"
  | "winback"
  | "followup"
  | "cancellation"
  | "out_of_hours";
const TEMPLATE_KINDS: TemplateKind[] = [
  "confirmation",
  "reminder",
  "winback",
  "followup",
  "cancellation",
  "out_of_hours",
];

export const DEFAULT_TEMPLATE_TEXTS: Record<
  string,
  Record<TemplateKind, { body: string; subject: string }>
> = {
  tr: {
    // [manage_link] on its own line, like the out_of_hours tokens: an org
    // whose deployment mints no link sends a clean message without it.
    confirmation: {
      body: "Merhaba [name]! [business] randevunuz [date] için oluşturuldu.\n\n[service]\n\nDeğiştirmek veya iptal etmek için:\n[manage_link]\n\nSorunuz varsa bu mesajı yanıtlamanız yeterli.",
      subject: "Randevunuz oluşturuldu",
    },
    reminder: {
      body: "Merhaba [name]! [business] randevunuzu hatırlatırız: [date].\n\n[service]\n\nGelemeyecekseniz bu mesajı yanıtlamanız yeterli.",
      subject: "Randevu hatırlatması",
    },
    winback: {
      body: "Merhaba [name]! [business] olarak sizi özledik. Yeni bir randevu için bu mesajı yanıtlamanız yeterli.",
      subject: "Sizi özledik!",
    },
    followup: {
      body: "Merhaba [name]! [business] ziyaretiniz için teşekkürler. Memnun kaldıysanız bize birkaç kelime bırakır mısınız?",
      subject: "Ziyaretiniz için teşekkürler",
    },
    cancellation: {
      body: "Merhaba [name], [date] tarihli [business] randevunuz iptal edildi. Yeni bir randevu için bu mesajı yanıtlayabilirsiniz.",
      subject: "Randevunuz iptal edildi",
    },
    // The two tokens sit on their own lines on purpose: renderTokens drops a
    // line that resolves to nothing, so an org with only a phone (or only a
    // link) sends a clean message instead of a dangling label.
    out_of_hours: {
      body: "Merhaba [name]! [business] şu anda kapalı.\n\nDilerseniz online randevu alabilir veya bizi arayabilirsiniz:\n[booking_link]\n[phone]\n\nAçıldığımızda size döneceğiz.",
      subject: "Şu anda kapalıyız",
    },
  },
  en: {
    confirmation: {
      body: "Hello [name]! Your appointment at [business] is booked for [date].\n\n[service]\n\nNeed to change or cancel it?\n[manage_link]\n\nAny questions? Just reply to this message.",
      subject: "Your appointment is booked",
    },
    reminder: {
      body: "Hi [name]! A reminder from [business]: your appointment is on [date].\n\n[service]\n\nIf anything changes, just reply to this message.",
      subject: "Appointment reminder",
    },
    winback: {
      body: "Hi [name]! We've missed you at [business]. Just reply to this message to book your next visit.",
      subject: "We've missed you!",
    },
    followup: {
      body: "Hi [name]! Thanks for visiting [business]. If you have a minute, we'd love a few words about how it went.",
      subject: "Thanks for your visit",
    },
    cancellation: {
      body: "Hi [name], your [business] appointment on [date] has been cancelled. Reply to this message to book a new one.",
      subject: "Your appointment was cancelled",
    },
    out_of_hours: {
      body: "Hello [name]! [business] is closed right now.\n\nYou can book online or give us a call:\n[booking_link]\n[phone]\n\nWe'll get back to you as soon as we open.",
      subject: "We're currently closed",
    },
  },
  de: {
    confirmation: {
      body: "Hallo [name]! Ihr Termin bei [business] ist für [date] gebucht.\n\n[service]\n\nZum Verschieben oder Stornieren:\n[manage_link]\n\nBei Fragen antworten Sie einfach auf diese Nachricht.",
      subject: "Ihr Termin ist gebucht",
    },
    reminder: {
      body: "Hallo [name]! [business] erinnert Sie an Ihren Termin am [date].\n\n[service]\n\nWenn etwas dazwischenkommt, antworten Sie einfach auf diese Nachricht.",
      subject: "Terminerinnerung",
    },
    winback: {
      body: "Hallo [name]! Wir haben Sie bei [business] vermisst. Antworten Sie einfach auf diese Nachricht für einen neuen Termin.",
      subject: "Wir haben Sie vermisst!",
    },
    followup: {
      body: "Hallo [name]! Danke für Ihren Besuch bei [business]. Wenn Sie eine Minute haben, freuen wir uns über ein paar Worte.",
      subject: "Danke für Ihren Besuch",
    },
    cancellation: {
      body: "Hallo [name], Ihr Termin bei [business] am [date] wurde storniert. Antworten Sie auf diese Nachricht für einen neuen Termin.",
      subject: "Ihr Termin wurde storniert",
    },
    out_of_hours: {
      body: "Hallo [name]! [business] ist gerade geschlossen.\n\nSie können online buchen oder uns anrufen:\n[booking_link]\n[phone]\n\nWir melden uns, sobald wir geöffnet haben.",
      subject: "Wir sind derzeit geschlossen",
    },
  },
};

// What a new org starts with: the full lifecycle a well-run salon actually
// wants — confirmation at booking, a day-before and a two-hour reminder, a
// cancellation notice, and the win-back two weeks after a no-show. Only the
// follow-up stays behind a + chip, because "leave us a review" is a voice a
// business should choose, not inherit.
//
// Takes the writer rather than a ctx because the founding sign-in (auth.ts)
// holds a bare db, not a MutationCtx.
export async function seedDefaultRules(
  db: GenericDatabaseWriter<DataModel>,
  orgId: Id<"orgs">,
  channel: "whatsapp" | "email" | "both" = "both",
): Promise<void> {
  const defaults: {
    trigger: Doc<"messageRules">["trigger"];
    offsetHours: number;
    paused?: boolean;
  }[] = [
    { trigger: "booking", offsetHours: 0 },
    { trigger: "before_start", offsetHours: 24 },
    { trigger: "before_start", offsetHours: 2 },
    { trigger: "cancellation", offsetHours: 0 },
    { trigger: "no_show", offsetHours: 14 * 24 },
    // Present but off, like the legacy away-reply toggle defaulted off: an
    // automated "we're closed" is a voice a business switches on, and it only
    // says anything once hours and a link or phone exist anyway.
    { trigger: "out_of_hours", offsetHours: 0, paused: true },
  ];
  for (const rule of defaults) {
    await db.insert("messageRules", { orgId, channel, ...rule });
  }
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
    // No fallback row in this language — every non-Turkish org, since the
    // founding seeds only spoke Turkish. Stock text beats an empty editor.
    const stock = (DEFAULT_TEMPLATE_TEXTS[language] ?? DEFAULT_TEMPLATE_TEXTS.en)[kind];
    return await ctx.db.insert("waTemplates", {
      orgId,
      ruleId: args.ruleId,
      kind,
      language,
      status: "draft",
      body: fallback?.body ?? stock.body,
      bodyHtml: fallback?.bodyHtml,
      subject: fallback?.subject ?? stock.subject,
      bodyPreview: fallback?.bodyPreview,
    });
  },
});

// The bottom-right escape hatch: back to what a fresh org gets. Every rule
// row and every piece of per-rule wording goes; the stock rules (confirmation
// + 24h reminder) come back, and the kind-level fallback rows are rewritten
// with the stock text in the org's language. Meta registrations survive —
// metaName and approval status live on rows this only patches body/subject
// on, because a reset of WORDS must never cost an approval that took weeks.
export const resetToDefaults = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) return null;

    for (const rule of await rulesForOrg(ctx, orgId)) {
      await ctx.db.delete(rule._id);
    }
    const templates = await ctx.db
      .query("waTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const stock = DEFAULT_TEMPLATE_TEXTS[org.language] ?? DEFAULT_TEMPLATE_TEXTS.en;
    for (const template of templates) {
      if (template.ruleId !== undefined) {
        // Per-rule wording belonged to rules that no longer exist.
        await ctx.db.delete(template._id);
      } else if (template.kind !== "campaign" && template.language === org.language) {
        const text = stock[template.kind as TemplateKind];
        // bodyHtml cleared too: stock wording is plain text, and a reset that
        // left old HTML behind would email one thing and preview another.
        await ctx.db.patch(template._id, {
          body: text.body,
          subject: text.subject,
          bodyHtml: undefined,
        });
      }
    }
    // Kinds with no fallback row in the org's language yet get one, so every
    // rule the owner adds later starts with words instead of an empty box.
    for (const kind of TEMPLATE_KINDS) {
      const exists = templates.some(
        (t) =>
          t.ruleId === undefined && t.kind === kind && t.language === org.language,
      );
      if (exists) continue;
      await ctx.db.insert("waTemplates", {
        orgId,
        kind,
        language: org.language,
        status: "draft",
        body: stock[kind].body,
        subject: stock[kind].subject,
      });
    }
    await seedDefaultRules(ctx.db, orgId, org.messageChannel ?? "both");
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: "message rules reset to defaults",
    });
    await ctx.scheduler.runAfter(0, internal.reminders.backfillOrg, { orgId });
    return null;
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

// ── Migration off the legacy away-reply fields ──────────────────────────────
//
// One out_of_hours rule per org that doesn't have one. Faithful, like
// migrateOrg above: the toggle's state becomes the pause state, the channel is
// whatsapp because that is the only channel the legacy away-reply ever had
// (email out-of-hours is NEW behavior nobody gets switched into), and an org's
// own autoReplyText becomes the rule's wording so nobody's message changes
// mid-flight. Idempotent on the rule's existence.
//
// Run after deploying:
//   npx convex run messageRules:migrateOutOfHoursAll --prod
export const migrateOutOfHoursAll = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const org of await ctx.db.query("orgs").collect()) {
      await ctx.scheduler.runAfter(0, internal.messageRules.migrateOutOfHoursOrg, {
        orgId: org._id,
      });
    }
    return null;
  },
});

// ── Backfill [manage_link] into confirmation wording ────────────────────────
//
// The stock confirmation texts carry the self-serve link now, but stock text
// only reaches orgs created (or reset) from here on — every template an owner
// has already authored predates the token, so their customers would book on
// the new page and still be told to reply to a message to change anything.
//
// APPENDED, never inserted: the body is the owner's own prose and this cannot
// know where a sentence belongs inside it. Skips a row that already mentions
// the token (idempotent) and a row with no body at all — a Meta-registration
// shell with nothing but a metaName has no wording to add a line to, and
// giving it one would make a message that is only a link.
//
// Run after deploying:
//   npx convex run messageRules:addManageLinkToConfirmations --prod
const MANAGE_LINK_LINE: Record<string, string> = {
  tr: "Randevunuzu değiştirmek veya iptal etmek için:",
  en: "To change or cancel your appointment:",
  de: "Zum Verschieben oder Stornieren Ihres Termins:",
};

export const addManageLinkToConfirmations = internalMutation({
  args: {},
  returns: v.object({ patched: v.number(), skipped: v.number() }),
  handler: async (ctx) => {
    let patched = 0;
    let skipped = 0;
    for (const template of await ctx.db.query("waTemplates").collect()) {
      if (template.kind !== "confirmation") continue;
      const body = template.body?.trim();
      if (!body || body.includes("[manage_link]")) {
        skipped += 1;
        continue;
      }
      const line = MANAGE_LINK_LINE[template.language] ?? MANAGE_LINK_LINE.en;
      const patch: { body: string; bodyHtml?: string } = {
        body: `${body}\n\n${line}\n[manage_link]`,
      };
      // The email lane prefers bodyHtml wherever one exists, so a patch that
      // touched only the plain text would put the link on WhatsApp and leave
      // it off the very channel most of these orgs actually send on.
      if (template.bodyHtml?.trim()) {
        patch.bodyHtml = `${template.bodyHtml.trim()}<p>${line}<br/>[manage_link]</p>`;
      }
      await ctx.db.patch(template._id, patch);
      patched += 1;
    }
    return { patched, skipped };
  },
});

export const migrateOutOfHoursOrg = internalMutation({
  args: { orgId: v.id("orgs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;
    const existing = await rulesForOrg(ctx, args.orgId);
    if (existing.some((rule) => rule.trigger === "out_of_hours")) return null;
    const ruleId = await ctx.db.insert("messageRules", {
      orgId: args.orgId,
      trigger: "out_of_hours",
      offsetHours: 0,
      channel: "whatsapp",
      paused: (org.autoReplyEnabled ?? false) ? undefined : true,
    });
    // The org's own wording travels with it. Filed under the org's language
    // because the legacy field was single-language by nature — that limitation
    // is exactly what it said on the tin.
    const override = org.autoReplyText?.trim();
    if (override) {
      await ctx.db.insert("waTemplates", {
        orgId: args.orgId,
        ruleId,
        kind: "out_of_hours",
        language: org.language,
        status: "draft",
        body: override,
      });
    }
    return null;
  },
});
