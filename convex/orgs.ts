import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { DEFAULT_CURRENCY, isCurrency } from "./lib/money";
import { recordActivity } from "./lib/activity";
import { loadEvolutionCreds } from "./lib/waLane";
import { customerSender, emailLaneConfigured } from "./lib/email";
import { emailConfig } from "./lib/platformConfig";
import { assignInboundAddress, resolveInboundAddress } from "./lib/inboundAddress";

export const DEFAULT_REMINDER_OFFSETS = [24, 2];
// Reminder send window in the org's local hours (Türkiye default 09–21).
export const DEFAULT_QUIET_HOURS = [9, 21] as const;
// Days after a no_show before the winback goes out. Two weeks: long enough
// that it doesn't read as nagging someone who just missed an appointment,
// short enough that the salon is still the one they think of.
export const DEFAULT_WINBACK_DAYS = 14;

// Asked of the runtime rather than checked against a list we would have to
// keep: IANA adds and renames zones, and the only opinion that matters is
// whether the formatter the app actually uses accepts it.
function isValidTimezone(tz: string): boolean {
  if (!tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const templateStatus = v.union(
  v.literal("draft"),
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

// Everything Settings renders in one read. The WhatsApp access token never
// leaves the backend — the client sees presence + a tail, nothing more.
export const current = query({
  args: {},
  returns: v.object({
    org: v.object({
      _id: v.id("orgs"),
      name: v.string(),
      timezone: v.string(),
      language: v.string(),
      currency: v.string(),
      inboundAddress: v.optional(v.string()),
      publicSlug: v.optional(v.string()),
      formEnabled: v.optional(v.boolean()),
      revenueEnabled: v.optional(v.boolean()),
      // Drives the banner that tells a visitor this salon is not real.
      demoMode: v.optional(v.boolean()),
      // The domain half, from deployment env — the client needs it to show the
      // org a full address it can hand to a customer.
      inboundDomain: v.optional(v.string()),
      reminderOffsetsHours: v.array(v.number()),
      pausedReminderHours: v.array(v.number()),
      removedRules: v.array(v.string()),
      sendBookingConfirmation: v.boolean(),
      quietHoursStart: v.number(),
      quietHoursEnd: v.number(),
      winbackEnabled: v.boolean(),
      winbackDaysAfter: v.number(),
      emailFrom: v.optional(v.string()),
      messageChannel: v.union(
        v.literal("whatsapp"),
        v.literal("email"),
        v.literal("both"),
      ),
      calcomEventTypeId: v.optional(v.string()),
      calcomApiKeyTail: v.optional(v.string()),
      // Left optional rather than defaulted: "no hours set" is a real state the
      // away-reply depends on telling apart from "open all day".
      businessHours: v.optional(
        v.object({
          activeDays: v.optional(v.array(v.number())),
          startMinute: v.optional(v.number()),
          endMinute: v.optional(v.number()),
        }),
      ),
      autoReplyEnabled: v.boolean(),
      autoReplyText: v.optional(v.string()),
      bookingUrl: v.optional(v.string()),
      publicPhone: v.optional(v.string()),
    }),
    me: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      role: v.optional(v.union(v.literal("owner"), v.literal("staff"))),
      themePreference: v.optional(
        v.union(v.literal("light"), v.literal("dark"), v.literal("auto")),
      ),
      // Read here as well as in users.myProfile so the shell can pick the
      // interface language on its existing query instead of opening a second
      // one just to know what to render itself in.
      language: v.optional(v.string()),
    }),
    whatsapp: v.union(
      v.object({
        connected: v.literal(true),
        phoneNumberId: v.string(),
        wabaId: v.optional(v.string()),
        displayNumber: v.optional(v.string()),
        tokenTail: v.string(),
      }),
      v.object({ connected: v.literal(false) }),
    ),
    templates: v.array(
      v.object({
        _id: v.id("waTemplates"),
        kind: v.union(
          v.literal("confirmation"),
          v.literal("reminder"),
          v.literal("winback"),
          v.literal("followup"),
          v.literal("cancellation"),
          v.literal("campaign"),
        ),
        ruleId: v.optional(v.id("messageRules")),
        body: v.optional(v.string()),
        subject: v.optional(v.string()),
        metaName: v.optional(v.string()),
        language: v.string(),
        status: templateStatus,
        bodyPreview: v.optional(v.string()),
        // Winback open rate (the only kind that tracks — see schema).
        emailSentCount: v.optional(v.number()),
        emailOpenCount: v.optional(v.number()),
      }),
    ),
    // Whether the shop-phone lane is provisioned for this org (instance name
    // plus operator-installed credentials). Presence only, never the
    // credentials — the templates card uses it to say which number a message
    // will actually leave from.
    evolutionEnabled: v.boolean(),
    // Whether this org can send email AT ALL — the deployment has a provider
    // key and we can resolve a From. Deliberately not "has the owner set
    // emailFrom": that field is an upgrade to their own domain, not the
    // switch, and gating the UI on it hid a working lane behind a DNS task no
    // salon was going to do.
    emailEnabled: v.boolean(),
  }),
  handler: async (ctx) => {
    const { user, orgId, role } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");
    const waAccount = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    const mailConfig = await emailConfig(ctx);
    const templates = await ctx.db
      .query("waTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return {
      org: {
        _id: org._id,
        name: org.name,
        timezone: org.timezone,
        language: org.language,
        currency: org.currency ?? DEFAULT_CURRENCY,
        inboundAddress: org.inboundAddress,
        publicSlug: org.publicSlug,
        formEnabled: org.formEnabled,
        revenueEnabled: org.revenueEnabled,
        demoMode: org.demoMode,
        inboundDomain: mailConfig.domain ?? undefined,
        reminderOffsetsHours: org.reminderOffsetsHours ?? DEFAULT_REMINDER_OFFSETS,
        pausedReminderHours: org.pausedReminderHours ?? [],
        removedRules: org.removedRules ?? [],
        sendBookingConfirmation: org.sendBookingConfirmation ?? true,
        quietHoursStart: org.quietHoursStart ?? DEFAULT_QUIET_HOURS[0],
        quietHoursEnd: org.quietHoursEnd ?? DEFAULT_QUIET_HOURS[1],
        winbackEnabled: org.winbackEnabled ?? false,
        winbackDaysAfter: org.winbackDaysAfter ?? 14,
        emailFrom: org.emailFrom,
        messageChannel: org.messageChannel ?? "both",
        calcomEventTypeId: org.calcomEventTypeId,
        calcomApiKeyTail: org.calcomApiKey ? org.calcomApiKey.slice(-4) : undefined,
        businessHours: org.businessHours,
        autoReplyEnabled: org.autoReplyEnabled ?? false,
        autoReplyText: org.autoReplyText,
        bookingUrl: org.bookingUrl,
        publicPhone: org.publicPhone,
      },
      me: {
        name: user.name,
        email: user.email,
        role,
        themePreference: user.themePreference,
        language: user.language,
      },
      whatsapp: waAccount
        ? {
            connected: true as const,
            phoneNumberId: waAccount.phoneNumberId,
            wabaId: waAccount.wabaId,
            displayNumber: waAccount.displayNumber,
            tokenTail: waAccount.accessToken.slice(-4),
          }
        : { connected: false as const },
      templates: templates.map((t) => ({
        _id: t._id,
        kind: t.kind,
        ruleId: t.ruleId,
        body: t.body,
        subject: t.subject,
        metaName: t.metaName,
        language: t.language,
        status: t.status,
        bodyPreview: t.bodyPreview,
        emailSentCount: t.emailSentCount,
        emailOpenCount: t.emailOpenCount,
      })),
      evolutionEnabled: Boolean(
        await loadEvolutionCreds(ctx, orgId, org.evolutionInstance),
      ),
      emailEnabled: emailLaneConfigured(mailConfig) && Boolean(customerSender(org, mailConfig)),
    };
  },
});

export const update = mutation({
  args: {
    name: v.optional(v.string()),
    timezone: v.optional(v.string()),
    language: v.optional(v.string()),
    currency: v.optional(v.string()),
    inboundAddress: v.optional(v.string()),
    revenueEnabled: v.optional(v.boolean()),
    reminderOffsetsHours: v.optional(v.array(v.number())),
    pausedReminderHours: v.optional(v.array(v.number())),
    removedRules: v.optional(v.array(v.string())),
    sendBookingConfirmation: v.optional(v.boolean()),
    quietHoursStart: v.optional(v.number()),
    quietHoursEnd: v.optional(v.number()),
    winbackEnabled: v.optional(v.boolean()),
    winbackDaysAfter: v.optional(v.number()),
    emailFrom: v.optional(v.string()),
    messageChannel: v.optional(
      v.union(v.literal("whatsapp"), v.literal("email"), v.literal("both")),
    ),
    businessHours: v.optional(
      v.object({
        activeDays: v.optional(v.array(v.number())),
        startMinute: v.optional(v.number()),
        endMinute: v.optional(v.number()),
      }),
    ),
    autoReplyEnabled: v.optional(v.boolean()),
    autoReplyText: v.optional(v.string()),
    bookingUrl: v.optional(v.string()),
    publicPhone: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const org0 = await ctx.db.get(orgId);
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined && args.name.trim()) patch.name = args.name.trim();
    if (args.timezone !== undefined) {
      // Rejected loudly rather than stored and shrugged at. Every dated thing
      // in the product reads through this zone, and getLocalPartsSafe falls
      // back to UTC on a value it cannot parse — so a typo here does not throw
      // anywhere, it just makes every reminder for a Turkish salon three hours
      // wrong with nothing on screen admitting it.
      if (!isValidTimezone(args.timezone)) throw new Error("bad-timezone");
      patch.timezone = args.timezone;
    }
    if (args.language !== undefined) patch.language = args.language;
    // Allowlisted, not free text: an unknown code reaches Intl.NumberFormat at
    // render time and throws there, which turns a bad Settings save into a
    // blank page on every screen that shows a price.
    if (args.currency !== undefined && isCurrency(args.currency)) {
      patch.currency = args.currency;
    }
    if (args.revenueEnabled !== undefined) patch.revenueEnabled = args.revenueEnabled;
    if (args.inboundAddress !== undefined) {
      // Slugging and uniqueness both live in lib/inboundAddress, because the
      // admin console writes this field too and used to do neither.
      patch.inboundAddress = await resolveInboundAddress(ctx, orgId, args.inboundAddress);
    }
    if (args.pausedReminderHours !== undefined) {
      patch.pausedReminderHours = [...new Set(args.pausedReminderHours)].sort(
        (a, b) => b - a,
      );
    }
    if (args.removedRules !== undefined) {
      // Only the two singleton rules can be removed this way. A reminder
      // leaves by dropping its offset, and letting "reminder:2" in here would
      // create a second, disagreeing way to hide the same row.
      patch.removedRules = [...new Set(args.removedRules)].filter(
        (key) => key === "confirmation" || key === "winback",
      );
    }
    if (args.reminderOffsetsHours !== undefined) {
      const next = args.reminderOffsetsHours
        .filter((h) => h > 0 && h <= 168)
        .sort((a, b) => b - a);
      patch.reminderOffsetsHours = next;
      // A paused entry for an offset that no longer exists would come back
      // switched off if the salon re-added that timing later, which is not
      // something they asked for and not something they could see coming.
      const paused = (patch.pausedReminderHours as number[] | undefined) ??
        org0?.pausedReminderHours ??
        [];
      patch.pausedReminderHours = paused.filter((h) => next.includes(h));
    }
    if (args.sendBookingConfirmation !== undefined) {
      patch.sendBookingConfirmation = args.sendBookingConfirmation;
    }
    if (args.quietHoursStart !== undefined) {
      patch.quietHoursStart = Math.min(23, Math.max(0, Math.round(args.quietHoursStart)));
    }
    if (args.quietHoursEnd !== undefined) {
      patch.quietHoursEnd = Math.min(24, Math.max(1, Math.round(args.quietHoursEnd)));
    }
    if (args.winbackEnabled !== undefined) patch.winbackEnabled = args.winbackEnabled;
    if (args.winbackDaysAfter !== undefined) {
      patch.winbackDaysAfter = Math.min(90, Math.max(1, Math.round(args.winbackDaysAfter)));
    }
    if (args.emailFrom !== undefined) patch.emailFrom = args.emailFrom.trim() || undefined;
    if (args.messageChannel !== undefined) patch.messageChannel = args.messageChannel;
    if (args.businessHours !== undefined) {
      const { activeDays, startMinute, endMinute } = args.businessHours;
      const clampMinute = (m: number) =>
        Math.min(24 * 60, Math.max(0, Math.round(m)));
      const start = startMinute === undefined ? undefined : clampMinute(startMinute);
      const end = endMinute === undefined ? undefined : clampMinute(endMinute);
      patch.businessHours = {
        // Dedupe and keep 0–6 only; an out-of-range weekday would silently mean
        // "closed forever" through isWithinActiveWindow.
        activeDays:
          activeDays === undefined
            ? undefined
            : [...new Set(activeDays.map((d) => Math.round(d)))]
                .filter((d) => d >= 0 && d <= 6)
                .sort((a, b) => a - b),
        // A start at or after the end is not a window a salon meant to type.
        // Dropping both is better than a config that reads "closed always".
        startMinute: start !== undefined && end !== undefined && start >= end ? undefined : start,
        endMinute: start !== undefined && end !== undefined && start >= end ? undefined : end,
      };
    }
    if (args.autoReplyEnabled !== undefined) {
      patch.autoReplyEnabled = args.autoReplyEnabled;
    }
    if (args.autoReplyText !== undefined) {
      patch.autoReplyText = args.autoReplyText.trim() || undefined;
    }
    if (args.bookingUrl !== undefined) {
      const url = args.bookingUrl.trim();
      // Stored only if it is a URL a customer could actually tap. A malformed
      // link in an away-reply is worse than no link.
      patch.bookingUrl = /^https?:\/\/\S+$/.test(url) ? url : undefined;
    }
    if (args.publicPhone !== undefined) {
      patch.publicPhone = args.publicPhone.trim() || undefined;
    }

    // An org with no incoming address is quietly broken: it sends from the
    // shared noreply@ and every customer reply is dropped, because no org
    // answers to "noreply". So the first save that gives the business a name
    // also gives it an address, derived from that name and deduped.
    //
    // Self-healing rather than a migration: any save on an org missing one
    // fills it, which covers the orgs that predate this. It never overwrites —
    // once a customer has replied to an address, changing it costs mail.
    const org = await ctx.db.get(orgId);
    if (org && !org.inboundAddress && patch.inboundAddress === undefined) {
      const name = (patch.name as string | undefined) ?? org.name;
      const assigned = await assignInboundAddress(ctx, orgId, name);
      if (assigned) patch.inboundAddress = assigned;
    }

    await ctx.db.patch(orgId, patch);

    // One row per save, naming the fields rather than their values: a settings
    // history that records what a token was set to is a settings history that
    // leaks credentials to everyone who can read it.
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: Object.keys(patch).sort().join(", ") || undefined,
    });

    // Reminder timing and the winback are baked into each appointment's
    // nextMessageAt (lib/reminderSchedule.ts), so changing them here leaves
    // every existing booking holding a due time derived from the OLD setting.
    // Re-derive this org's future calendar in the background — bounded to one
    // org, and the only write path that needs a sweep rather than a recompute.
    if (
      patch.reminderOffsetsHours !== undefined ||
      patch.winbackEnabled !== undefined ||
      patch.winbackDaysAfter !== undefined
    ) {
      await ctx.scheduler.runAfter(0, internal.reminders.backfillOrg, { orgId });
    }
    return null;
  },
});

export const connectWhatsapp = mutation({
  args: {
    phoneNumberId: v.string(),
    accessToken: v.string(),
    wabaId: v.optional(v.string()),
    displayNumber: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const phoneNumberId = args.phoneNumberId.trim();
    const accessToken = args.accessToken.trim();
    if (!phoneNumberId || !accessToken) throw new Error("missing-credentials");
    // phone_number_id is globally unique at Meta; refuse a value another org
    // already claimed rather than silently splitting its webhook traffic.
    const claimed = await ctx.db
      .query("waAccounts")
      .withIndex("by_phone_number_id", (q) => q.eq("phoneNumberId", phoneNumberId))
      .unique();
    if (claimed && claimed.orgId !== orgId) throw new Error("number-already-connected");
    const existing = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        phoneNumberId,
        accessToken,
        wabaId: args.wabaId?.trim() || undefined,
        displayNumber: args.displayNumber?.trim() || undefined,
      });
    } else {
      await ctx.db.insert("waAccounts", {
        orgId,
        phoneNumberId,
        accessToken,
        wabaId: args.wabaId?.trim() || undefined,
        displayNumber: args.displayNumber?.trim() || undefined,
      });
    }
    // The displayed number, never the token. Reconnecting is also the usual
    // fix for an expired token, so knowing when it last happened is the first
    // question when sends start failing.
    await recordActivity(ctx, {
      orgId,
      kind: "whatsapp_connected",
      detail: args.displayNumber?.trim() || undefined,
    });
    return null;
  },
});

export const disconnectWhatsapp = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { orgId } = await requireOwner(ctx);
    const existing = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

// Creates the draft row for a template kind this org has none of, so the owner
// has something to put their Meta-approved name onto.
//
// Only campaigns need this. The other three are seeded at signup because every
// org wants them; a campaign template is worth a separate Meta approval only
// once the salon decides to run campaigns at all, and asking every new signup
// to get one approved on day one is how a setup checklist stops being finished.
//
// The suggested body is not decoration. Meta approves an exact string, and
// {{3}} being a FREE line rather than an appointment time is the whole reason
// one approval covers every campaign the salon will ever run — an owner who
// registers a fixed offer instead has to go back to Meta for the next one.
export const ensureCampaignTemplate = mutation({
  args: {},
  returns: v.id("waTemplates"),
  handler: async (ctx) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    const language = org?.language ?? "tr";
    const existing = (
      await ctx.db
        .query("waTemplates")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).find((t) => t.kind === "campaign" && t.language === language);
    if (existing) return existing._id;

    const preview: Record<string, string> = {
      tr: "Merhaba {{1}}! {{2}} olarak {{3}}",
      en: "Hello {{1}}! {{2}} here — {{3}}",
      de: "Hallo {{1}}! {{2}} — {{3}}",
    };
    return await ctx.db.insert("waTemplates", {
      orgId,
      kind: "campaign",
      metaName: "randevu_kampanya",
      language,
      status: "draft",
      bodyPreview: preview[language] ?? preview.en,
    });
  },
});

// One-off repair for orgs that predate the auto-assignment above. The rule in
// `update` is self-healing, but only on the next save, and an org nobody opens
// stays unable to receive mail in the meantime.
//
//   npx convex run orgs:backfillInboundAddresses --prod
//
// Idempotent: an org that already has an address is skipped, so running it
// twice changes nothing.
export const backfillInboundAddresses = internalMutation({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const filled: string[] = [];
    for (const org of await ctx.db.query("orgs").collect()) {
      if (org.inboundAddress || !org.name.trim()) continue;
      const assigned = await assignInboundAddress(ctx, org._id, org.name);
      if (!assigned) continue;
      await ctx.db.patch(org._id, { inboundAddress: assigned });
      filled.push(`${org.name} -> ${assigned}`);
    }
    return filled;
  },
});

export const updateTemplate = mutation({
  args: {
    templateId: v.id("waTemplates"),
    // The authored message text and the email subject. An empty string CLEARS
    // the field — deleting everything in the editor is how an owner says
    // "back to nothing", and keeping stale text instead would send words they
    // watched themselves remove.
    body: v.optional(v.string()),
    subject: v.optional(v.string()),
    metaName: v.optional(v.string()),
    language: v.optional(v.string()),
    status: v.optional(templateStatus),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const template = await ctx.db.get(args.templateId);
    if (!template || template.orgId !== orgId) throw new Error("not-found");
    const patch: Record<string, unknown> = {};
    if (args.body !== undefined) patch.body = args.body.trim() || undefined;
    if (args.subject !== undefined) patch.subject = args.subject.trim() || undefined;
    if (args.metaName !== undefined && args.metaName.trim()) {
      patch.metaName = args.metaName.trim();
    }
    if (args.language !== undefined && args.language.trim()) {
      patch.language = args.language.trim();
    }
    if (args.status !== undefined) patch.status = args.status;
    await ctx.db.patch(args.templateId, patch);
    return null;
  },
});
