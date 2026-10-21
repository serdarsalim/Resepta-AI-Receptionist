import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { DEFAULT_CURRENCY, isCurrency } from "./lib/money";
import { recordActivity } from "./lib/activity";
import { loadEvolutionCreds } from "./lib/waLane";
import { customerSender, emailLaneConfigured } from "./lib/email";
import { emailConfig } from "./lib/platformConfig";
import { assignInboundAddress, resolveInboundAddress } from "./lib/inboundAddress";
import { normaliseAddress } from "./lib/businessAddress";
import {
  assignPublicSlug,
  resolvePublicSlug,
  slugify,
  slugMatchesName,
} from "./lib/publicSlug";
import { resolvePublicPhone } from "./lib/publicPhone";
import { clampNoticeHours, minNoticeHoursOf, noticeUnitOf } from "./lib/minNotice";
import { isWordingLocked } from "./lib/templateTexts";
import { memberPhoto } from "./lib/memberPhoto";

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
      // The onboarding wizard's industry answer (lib/industryPresets) — what
      // Business settings' reset-to-defaults re-seeds from.
      industry: v.optional(v.string()),
      currency: v.string(),
      inboundAddress: v.optional(v.string()),
      publicSlug: v.optional(v.string()),
      bookingEnabled: v.optional(v.boolean()),
      revenueEnabled: v.optional(v.boolean()),
      priceDecimals: v.optional(v.boolean()),
      // Unset means on for both — see the schema. The settings screen reads
      // them through `?? true` so an unanswered org shows two live switches.
      pickupEnabled: v.optional(v.boolean()),
      deliveryEnabled: v.optional(v.boolean()),
      // The minimum notice IN FORCE (lib/minNotice), so the Business card
      // shows the one hour an unset org runs on rather than an empty box, and
      // the unit it is shown in.
      minNoticeHours: v.number(),
      minNoticeUnit: v.union(v.literal("hours"), v.literal("days")),
      // Shows the Balance tab (prepaid only) — the wallet itself is
      // wallet.overview's answer, this is just "does the destination exist".
      billingMode: v.optional(
        v.union(v.literal("invoice"), v.literal("prepaid")),
      ),
      // Drives the banner that tells a visitor this salon is not real.
      demoMode: v.optional(v.boolean()),
      // Resolved URL for the uploaded logo (schema: orgs.logoStorageId).
      logoUrl: v.optional(v.string()),
      // The chat agent's lifecycle state (docs/chat-agent.md §5). WRITTEN
      // only from platform admin — this is the entitlement gate, so the owner
      // sees the agent and the operator owns whether they have one.
      chatAgentMode: v.optional(
        v.union(v.literal("off"), v.literal("shadow"), v.literal("live")),
      ),
      // How it behaves once they have one — the owner's half, settable from
      // Settings → Messages (orgs.update). Unset reads as "live"; see the
      // schema comment for why that and not "suggest".
      chatAgentBehavior: v.optional(
        v.union(v.literal("off"), v.literal("suggest"), v.literal("live")),
      ),
      chatAgentStopOnHandover: v.optional(v.boolean()),
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
          days: v.optional(
            v.array(
              v.union(
                v.null(),
                v.object({ startMinute: v.number(), endMinute: v.number() }),
              ),
            ),
          ),
        }),
      ),
      autoReplyEnabled: v.boolean(),
      autoReplyText: v.optional(v.string()),
      bookingUrl: v.optional(v.string()),
      publicPhone: v.optional(v.string()),
      address: v.optional(v.string()),
      termsUrl: v.optional(v.string()),
      privacyUrl: v.optional(v.string()),
    }),
    me: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      // The reader's face for the sidebar's account row, resolved through
      // lib/memberPhoto (P33): the photo they uploaded in this business, else
      // the Google picture stored at sign-in (auth.ts).
      image: v.optional(v.string()),
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
        // Absent when the row rides the platform token (schema: waAccounts).
        tokenTail: v.optional(v.string()),
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
          v.literal("out_of_hours"),
          v.literal("campaign"),
        ),
        ruleId: v.optional(v.id("messageRules")),
        body: v.optional(v.string()),
        bodyHtml: v.optional(v.string()),
        subject: v.optional(v.string()),
        variableDefaults: v.optional(
          v.array(v.object({ key: v.string(), value: v.string() })),
        ),
        metaName: v.optional(v.string()),
        language: v.string(),
        status: templateStatus,
        // Meta's own word behind the normalised status, why review said no,
        // and when it last went. Together they are the difference between a
        // red pill and a red pill the owner can act on.
        metaStatusDetail: v.optional(v.string()),
        metaRejectionReason: v.optional(v.string()),
        submittedAt: v.optional(v.number()),
        // Set once the app has registered this row with Meta. Its presence is
        // what tells the card whether the button says "submit" or "resubmit",
        // and a resubmission is an EDIT that sends an approved template back
        // into review — worth saying out loud before it is clicked.
        metaTemplateId: v.optional(v.string()),
        bodyPreview: v.optional(v.string()),
        // The editor's unsaved buffer, and the flag the pill keys on. The
        // blob rides along so the editor can seed draft-first and resume a
        // half-written message where it was left.
        draft: v.optional(v.any()),
        hasUnsavedChanges: v.boolean(),
        // Per-template email engagement: sent/opens/replies and the last
        // send, rendered as the stats footer in each rule's editor.
        emailSentCount: v.optional(v.number()),
        emailOpenCount: v.optional(v.number()),
        emailReplyCount: v.optional(v.number()),
        emailLastSentAt: v.optional(v.number()),
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
        industry: org.industry,
        currency: org.currency ?? DEFAULT_CURRENCY,
        inboundAddress: org.inboundAddress,
        publicSlug: org.publicSlug,
        bookingEnabled: org.bookingEnabled,
        revenueEnabled: org.revenueEnabled,
        priceDecimals: org.priceDecimals,
        pickupEnabled: org.pickupEnabled,
        deliveryEnabled: org.deliveryEnabled,
        minNoticeHours: minNoticeHoursOf(org),
        minNoticeUnit: noticeUnitOf(org),
        billingMode: org.billingMode,
        demoMode: org.demoMode,
        logoUrl: org.logoStorageId
          ? ((await ctx.storage.getUrl(org.logoStorageId)) ?? undefined)
          : undefined,
        chatAgentMode: org.chatAgentMode,
        chatAgentBehavior: org.chatAgentBehavior,
        chatAgentStopOnHandover: org.chatAgentStopOnHandover,
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
        address: org.address,
        termsUrl: org.termsUrl,
        privacyUrl: org.privacyUrl,
        // Resolved, not stored: the enabled voice agent's inbound line, so the
        // reminder preview shows the same [phone] the send paths print.
        publicPhone: await resolvePublicPhone(ctx, org),
      },
      me: {
        name: user.name,
        email: user.email,
        image: (await memberPhoto(ctx, orgId, user)) ?? undefined,
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
            tokenTail: waAccount.accessToken?.slice(-4),
          }
        : { connected: false as const },
      templates: templates.map((t) => ({
        _id: t._id,
        kind: t.kind,
        ruleId: t.ruleId,
        body: t.body,
        bodyHtml: t.bodyHtml,
        subject: t.subject,
        variableDefaults: t.variableDefaults,
        metaName: t.metaName,
        metaStatusDetail: t.metaStatusDetail,
        metaRejectionReason: t.metaRejectionReason,
        submittedAt: t.submittedAt,
        metaTemplateId: t.metaTemplateId,
        language: t.language,
        status: t.status,
        bodyPreview: t.bodyPreview,
        draft: t.draft,
        hasUnsavedChanges: t.draft !== undefined && t.draft !== null,
        emailSentCount: t.emailSentCount,
        emailOpenCount: t.emailOpenCount,
        emailReplyCount: t.emailReplyCount,
        emailLastSentAt: t.emailLastSentAt,
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
        days: v.optional(
          v.array(
            v.union(
              v.null(),
              v.object({ startMinute: v.number(), endMinute: v.number() }),
            ),
          ),
        ),
      }),
    ),
    autoReplyEnabled: v.optional(v.boolean()),
    autoReplyText: v.optional(v.string()),
    bookingUrl: v.optional(v.string()),
    address: v.optional(v.string()),
    // The business's own terms / privacy pages for the booking page's line
    // above Book (P29). "" clears; anything else must be an http(s) address,
    // refused as `invalid-url` so the field can say so.
    termsUrl: v.optional(v.string()),
    privacyUrl: v.optional(v.string()),
    priceDecimals: v.optional(v.boolean()),
    pickupEnabled: v.optional(v.boolean()),
    deliveryEnabled: v.optional(v.boolean()),
    // Whole hours, clamped to 0..MAX_MIN_NOTICE_HOURS (lib/minNotice). The
    // unit is how the Business card shows it; a client switching units sends
    // both, already converted.
    minNoticeHours: v.optional(v.number()),
    minNoticeUnit: v.optional(v.union(v.literal("hours"), v.literal("days"))),
    // The owner's half of the chat agent. chatAgentMode is deliberately NOT
    // here: that one is the entitlement gate and stays operator-only, so a
    // business can decide how its agent behaves but not whether it has one.
    chatAgentBehavior: v.optional(
      v.union(v.literal("off"), v.literal("suggest"), v.literal("live")),
    ),
    chatAgentStopOnHandover: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const org0 = await ctx.db.get(orgId);
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined && args.name.trim()) {
      const name = args.name.trim();
      patch.name = name;
      // The booking page FOLLOWS the name (lib/publicSlug): rename the
      // business and /book/<slug> renames with it, which is the whole reason
      // the name has to be unique — resolvePublicSlug throws `name-taken`
      // rather than let two salons own one page. Both client callers (the
      // Business name field, the onboarding gate) show that refusal; an
      // unhandled one is a save that silently did not happen.
      if (org0 && name !== org0.name) {
        const slug = await resolvePublicSlug(ctx, orgId, name);
        if (slug && slug !== org0.publicSlug) {
          patch.publicSlug = slug;
          // [booking_link] resolves through orgs.bookingUrl, a whole URL
          // stored when the switch went on. Moved in the SAME patch: a rename
          // that left it behind would point every reminder, away-reply and
          // campaign at a page that no longer answers — the same failure the
          // rename exists to fix, one layer down. Only our own page shape is
          // rewritten; anything else is left alone.
          const url = org0.bookingUrl?.trim();
          if (url) {
            const moved = url.replace(/\/book\/[^/?#]*$/, `/book/${slug}`);
            if (moved !== url) patch.bookingUrl = moved;
          }
        }
      }
    }
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
    if (args.priceDecimals !== undefined) patch.priceDecimals = args.priceDecimals;
    // Refused rather than shrugged at: a business offering neither pickup nor
    // delivery cannot hand a good over at all, and the booking page would
    // answer a product order with a step holding no options. Unset means on,
    // so the check reads the INTENDED state, not just what this call carries.
    if (args.pickupEnabled !== undefined || args.deliveryEnabled !== undefined) {
      const pickup = args.pickupEnabled ?? org0?.pickupEnabled ?? true;
      const delivery = args.deliveryEnabled ?? org0?.deliveryEnabled ?? true;
      if (!pickup && !delivery) throw new Error("fulfillment-required");
      if (args.pickupEnabled !== undefined) patch.pickupEnabled = args.pickupEnabled;
      if (args.deliveryEnabled !== undefined) patch.deliveryEnabled = args.deliveryEnabled;
    }
    if (args.minNoticeHours !== undefined) {
      patch.minNoticeHours = clampNoticeHours(args.minNoticeHours);
    }
    if (args.minNoticeUnit !== undefined) patch.minNoticeUnit = args.minNoticeUnit;
    // Refused rather than silently stored when the operator has not brought
    // this org's agent live: the control is not on screen in that state, so a
    // call carrying it is a stale client, and a stored preference for a
    // feature the org does not have would take effect the moment it did — a
    // setting nobody remembers making.
    if (args.chatAgentBehavior !== undefined) {
      if ((org0?.chatAgentMode ?? "off") !== "live") {
        throw new Error("agent-not-enabled");
      }
      patch.chatAgentBehavior = args.chatAgentBehavior;
    }
    if (args.chatAgentStopOnHandover !== undefined) {
      if ((org0?.chatAgentMode ?? "off") !== "live") {
        throw new Error("agent-not-enabled");
      }
      patch.chatAgentStopOnHandover = args.chatAgentStopOnHandover;
    }
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
    // Resolved as a PAIR, because the two are only meaningful together and
    // these were clamped independently with no relationship checked. A start
    // after the end is fine — insideSendWindow wraps, so 21→9 is an overnight
    // send window — but start === end is the empty set, and storing it stops
    // every reminder, winback and follow-up this org owes with nothing on
    // screen admitting it. Falling back to the default beats keeping a config
    // that reads "never", which is the same call the businessHours block below
    // makes for the same reason.
    if (args.quietHoursStart !== undefined || args.quietHoursEnd !== undefined) {
      const start =
        args.quietHoursStart === undefined
          ? org0?.quietHoursStart ?? DEFAULT_QUIET_HOURS[0]
          : Math.min(23, Math.max(0, Math.round(args.quietHoursStart)));
      const end =
        args.quietHoursEnd === undefined
          ? org0?.quietHoursEnd ?? DEFAULT_QUIET_HOURS[1]
          : Math.min(24, Math.max(1, Math.round(args.quietHoursEnd)));
      patch.quietHoursStart = start === end ? DEFAULT_QUIET_HOURS[0] : start;
      patch.quietHoursEnd = start === end ? DEFAULT_QUIET_HOURS[1] : end;
    }
    if (args.winbackEnabled !== undefined) patch.winbackEnabled = args.winbackEnabled;
    if (args.winbackDaysAfter !== undefined) {
      patch.winbackDaysAfter = Math.min(90, Math.max(1, Math.round(args.winbackDaysAfter)));
    }
    if (args.emailFrom !== undefined) patch.emailFrom = args.emailFrom.trim() || undefined;
    if (args.messageChannel !== undefined) patch.messageChannel = args.messageChannel;
    if (args.businessHours !== undefined) {
      const { activeDays, startMinute, endMinute, days } = args.businessHours;
      const clampMinute = (m: number) =>
        Math.min(24 * 60, Math.max(0, Math.round(m)));
      const start = startMinute === undefined ? undefined : clampMinute(startMinute);
      const end = endMinute === undefined ? undefined : clampMinute(endMinute);
      // Seven entries, always, whatever arrived. The array position IS the
      // weekday downstream (windowForWeekday), so a short array would silently
      // close the days it failed to reach — and a client that sends six is a
      // bug, not a business that shut Saturday.
      //
      // A day whose start is at or after its end is stored CLOSED rather than
      // dropped. That differs from the legacy pair above, which drops both
      // bounds and falls back to open-all-day, and the difference is right:
      // there, one bad pair would have closed the whole week; here it closes
      // exactly the day somebody mistyped, which is visible in the row they
      // just edited.
      const normalisedDays =
        days === undefined
          ? undefined
          : Array.from({ length: 7 }, (_, day) => {
              const win = days[day];
              if (!win) return null;
              const s = clampMinute(win.startMinute);
              const e = clampMinute(win.endMinute);
              return s >= e ? null : { startMinute: s, endMinute: e };
            });
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
        // Carried forward when this save did not touch it, so editing the
        // timezone does not silently wipe the week. The whole object is
        // replaced on every save (patch.businessHours = {...}), which is why
        // an unmentioned field has to be re-read rather than left out.
        days: normalisedDays ?? org0?.businessHours?.days,
      };
    }
    if (args.autoReplyEnabled !== undefined) {
      patch.autoReplyEnabled = args.autoReplyEnabled;
    }
    if (args.autoReplyText !== undefined) {
      patch.autoReplyText = args.autoReplyText.trim() || undefined;
    }
    if (args.address !== undefined) {
      // Up to three lines, kept: every reader that shows it on one line joins
      // them itself (lib/businessAddress).
      patch.address = normaliseAddress(args.address);
    }
    if (args.termsUrl !== undefined) patch.termsUrl = cleanLegalUrl(args.termsUrl);
    if (args.privacyUrl !== undefined) patch.privacyUrl = cleanLegalUrl(args.privacyUrl);
    if (args.bookingUrl !== undefined) {
      const url = args.bookingUrl.trim();
      // Stored only if it is a URL a customer could actually tap. A malformed
      // link in an away-reply is worse than no link.
      patch.bookingUrl = /^https?:\/\/\S+$/.test(url) ? url : undefined;
    }

    // An org with no incoming address is quietly broken: it sends from the
    // shared noreply@ and every customer reply is dropped, because no org
    // answers to "noreply". So the first save that gives the business a name
    // also gives it an address, derived from that name and deduped.
    //
    // Self-healing rather than a migration: any save on an org missing one
    // fills it, which covers the orgs that predate this. It never overwrites —
    // once a customer has replied to an address, changing it costs mail.
    // Onboarding completion — the first save that names an unnamed org — is
    // the auto-provisioning trigger (docs/chat-agent.md §7): the org wakes up
    // with a phone agent built from the versioned template, on its own key or
    // the stamped platform default. Fire-and-forget; the precheck refuses
    // every case that is not a blank slate.
    if (org0 && !org0.name && typeof patch.name === "string" && patch.name) {
      await ctx.scheduler.runAfter(0, internal.retellAgent.autoProvision, {
        orgId,
      });
    }

    const org = await ctx.db.get(orgId);
    if (org && !org.inboundAddress && patch.inboundAddress === undefined) {
      const name = (patch.name as string | undefined) ?? org.name;
      const assigned = await assignInboundAddress(ctx, orgId, name);
      if (assigned) patch.inboundAddress = assigned;
    }

    // The same self-healing shape for the public slug, but a SYNC rather than
    // a backfill: it fixes a slug that disagrees with the name, not only a
    // missing one. Both cases are the same legacy — every org named before the
    // link followed the name is carrying whatever its name was the day the
    // booking switch went on, which for a business that has since renamed
    // itself is the stale address this whole change exists to retire. Waiting
    // for a rename would never reach them; their name is already right.
    //
    // It also closes a hole in the uniqueness check above: an org holding no
    // slug reserves no name.
    //
    // Suffixed rather than refused (assignPublicSlug, not resolvePublicSlug) —
    // this org did not choose this moment and cannot be asked to pick another
    // name, and slugMatchesName keeps an already-suffixed legacy slug stable
    // instead of fighting the org that holds the unsuffixed one.
    if (org && org.name && patch.publicSlug === undefined) {
      const named = (patch.name as string | undefined) ?? org.name;
      // A name that slugs to nothing — one written entirely in a script this
      // slugger folds away — has nothing to sync TO. Such an org gets the
      // "resepta-N" fallback ONCE, when it has no slug at all; without this
      // guard slugMatchesName would answer false forever and buy a
      // whole-table scan on every settings save to arrive at the same string.
      const drifted =
        slugify(named) !== "" && !slugMatchesName(org.publicSlug, named);
      if (!org.publicSlug || drifted) {
        const slug = await assignPublicSlug(ctx, orgId, named);
        patch.publicSlug = slug;
        // Same reason the rename branch moves it: [booking_link] reads this.
        const url = org.bookingUrl?.trim();
        if (url && patch.bookingUrl === undefined) {
          const moved = url.replace(/\/book\/[^/?#]*$/, `/book/${slug}`);
          if (moved !== url) patch.bookingUrl = moved;
        }
      }
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

// The logo the booking page's header wears. The file arrives through
// media.generateUploadUrl like every other upload; null clears. The replaced
// file is deleted rather than orphaned — logos get re-uploaded until the crop
// looks right, and each abandoned attempt would otherwise sit in storage
// forever with nothing pointing at it.
export const setLogo = mutation({
  args: { storageId: v.union(v.id("_storage"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    if (org?.logoStorageId && org.logoStorageId !== args.storageId) {
      await ctx.storage.delete(org.logoStorageId);
    }
    await ctx.db.patch(orgId, { logoStorageId: args.storageId ?? undefined });
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
    const wabaId = args.wabaId?.trim() || undefined;
    if (existing) {
      await ctx.db.patch(existing._id, {
        phoneNumberId,
        accessToken,
        wabaId,
        displayNumber: args.displayNumber?.trim() || undefined,
      });
    } else {
      await ctx.db.insert("waAccounts", {
        orgId,
        phoneNumberId,
        accessToken,
        wabaId,
        displayNumber: args.displayNumber?.trim() || undefined,
      });
    }
    // A WABA that just arrived or changed gets the standard template set
    // registered automatically — same trigger as the /admin path
    // (platform.setWaAccount), so a business bringing its own Meta app is
    // sendable without anyone touching a templates screen.
    if (wabaId && wabaId !== existing?.wabaId) {
      await ctx.scheduler.runAfter(0, internal.waTemplates.registerStandardSetForOrg, {
        orgId,
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

// ── The unsaved-changes buffer ──────────────────────────────────────────────
//
// Ported from Nudge (convex/templates.ts saveDraft/commitDraft/discardDraft),
// including the bugs it learned about the hard way — see the equal-to-live
// clear below.
//
// The editor writes HERE on every blur. The live fields, which are the ones
// lib/reminderSchedule and wa.sendAppointmentMessage read at send time, do not
// move until an owner presses Save. That is the whole point: a reminder body
// caught mid-sentence must not be a body a customer receives.

// The slice of updateTemplate's args an editor can buffer. Kept as one shape
// so the draft blob and the committed patch cannot drift apart.
const templateDraftFields = {
  body: v.optional(v.string()),
  bodyHtml: v.optional(v.string()),
  subject: v.optional(v.string()),
  variableDefaults: v.optional(
    v.array(v.object({ key: v.string(), value: v.string() })),
  ),
};

type TemplateDraft = {
  body?: string;
  bodyHtml?: string;
  subject?: string;
  variableDefaults?: { key: string; value: string }[];
};

// Normalised the same way on both sides, so a draft built by the editor can be
// compared against fields written by any other path. Trims to match what
// updateTemplate stores, and treats "" and absent as the same thing — because
// updateTemplate stores an empty string as undefined.
function templateComparable(values: TemplateDraft) {
  return JSON.stringify({
    body: values.body?.trim() || null,
    bodyHtml: values.bodyHtml?.trim() || null,
    subject: values.subject?.trim() || null,
    variableDefaults: (values.variableDefaults ?? [])
      .map((pair) => ({
        key: pair.key.trim().toLowerCase(),
        value: pair.value.trim(),
      }))
      .filter((pair) => pair.key && pair.value),
  });
}

export const saveTemplateDraft = mutation({
  args: { templateId: v.id("waTemplates"), ...templateDraftFields },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const template = await ctx.db.get(args.templateId);
    if (!template || template.orgId !== orgId) throw new Error("not-found");
    // Same lock as updateTemplate: a draft of wording that can never commit
    // is a Save button that only ever errors.
    if (
      (args.body !== undefined || args.bodyHtml !== undefined) &&
      isWordingLocked(template.kind)
    ) {
      throw new Error("wording-locked");
    }
    const { templateId, ...draft } = args;
    // A draft that would change NOTHING is cleared rather than stored. Type a
    // letter, delete it again, and the draft now matches the live row —
    // keeping it would pin the Unsaved pill forever on an edit that no longer
    // exists. (Nudge shipped exactly this bug first.)
    const merged: TemplateDraft = {
      ...(template.draft as TemplateDraft | undefined),
      ...draft,
    };
    const live: TemplateDraft = {
      body: template.body,
      bodyHtml: template.bodyHtml,
      subject: template.subject,
      variableDefaults: template.variableDefaults,
    };
    // Compared as the row WOULD LOOK after commit, not as the blob looks on
    // its own. A draft is partial — editing the body buffers body and bodyHtml
    // and nothing else — so comparing the bare blob reads every untouched
    // field as cleared, and the pill would stick forever on an edit that was
    // typed and deleted again. `??` and not a spread, so an emptied box (the
    // owner's "back to nothing") still counts as a real change.
    const effective: TemplateDraft = {
      body: merged.body ?? live.body,
      bodyHtml: merged.bodyHtml ?? live.bodyHtml,
      subject: merged.subject ?? live.subject,
      variableDefaults: merged.variableDefaults ?? live.variableDefaults,
    };
    if (templateComparable(effective) === templateComparable(live)) {
      await ctx.db.patch(templateId, {
        draft: undefined,
        draftUpdatedAt: undefined,
      });
      return null;
    }
    await ctx.db.patch(templateId, {
      draft: merged,
      draftUpdatedAt: Date.now(),
    });
    return null;
  },
});

// Save: copy the buffer onto the live fields, then clear it. Returns false
// when there was nothing buffered, so the caller can tell a no-op from a
// publish. Meta registration survives untouched — metaName and approval status
// live on this row too, and publishing WORDS must never cost an approval that
// took weeks.
export const commitTemplateDraft = mutation({
  args: { templateId: v.id("waTemplates") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const template = await ctx.db.get(args.templateId);
    if (!template || template.orgId !== orgId) throw new Error("not-found");
    const draft = template.draft as TemplateDraft | undefined | null;
    if (draft === undefined || draft === null) return false;
    const patch: Record<string, unknown> = {
      draft: undefined,
      draftUpdatedAt: undefined,
    };
    // Same normalisation updateTemplate applies, because this IS that write —
    // an empty box means "back to nothing", not "leave the old words".
    if (draft.body !== undefined) patch.body = draft.body.trim() || undefined;
    if (draft.bodyHtml !== undefined) {
      patch.bodyHtml = draft.bodyHtml.trim() || undefined;
    }
    if (draft.subject !== undefined) {
      patch.subject = draft.subject.trim() || undefined;
    }
    if (draft.variableDefaults !== undefined) {
      const rows = draft.variableDefaults
        .map((pair) => ({
          key: pair.key.trim().toLowerCase(),
          value: pair.value.trim(),
        }))
        .filter((pair) => pair.key && pair.value);
      patch.variableDefaults = rows.length ? rows : undefined;
    }
    await ctx.db.patch(args.templateId, patch);
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `message wording saved: ${template.kind}`,
    });
    return true;
  },
});

export const discardTemplateDraft = mutation({
  args: { templateId: v.id("waTemplates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const template = await ctx.db.get(args.templateId);
    if (!template || template.orgId !== orgId) throw new Error("not-found");
    await ctx.db.patch(args.templateId, {
      draft: undefined,
      draftUpdatedAt: undefined,
    });
    return null;
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
    // The WYSIWYG editor saves both halves together: the HTML it authored and
    // the plain text it derived for the WhatsApp lane.
    bodyHtml: v.optional(v.string()),
    subject: v.optional(v.string()),
    metaName: v.optional(v.string()),
    language: v.optional(v.string()),
    status: v.optional(templateStatus),
    // "When empty, print…" — one row per token the body actually uses.
    variableDefaults: v.optional(
      v.array(v.object({ key: v.string(), value: v.string() })),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const template = await ctx.db.get(args.templateId);
    if (!template || template.orgId !== orgId) throw new Error("not-found");
    // The wording of the lifecycle kinds is platform-owned (Serdar,
    // 2026-08-26, lib/templateTexts LOCKED_TEMPLATE_KINDS): each has a
    // Meta-approved Cloud template behind it, and a salon edit would desync
    // what the editor shows from what Meta sends. Subject and variable
    // defaults stay writable — neither touches the approved text.
    if (
      (args.body !== undefined || args.bodyHtml !== undefined) &&
      isWordingLocked(template.kind)
    ) {
      throw new Error("wording-locked");
    }
    const patch: Record<string, unknown> = {};
    if (args.variableDefaults !== undefined) {
      // Blanks are dropped rather than stored: an empty box means "no
      // fallback", and a row of empties would leave the field looking set.
      const rows = args.variableDefaults
        .map((pair) => ({
          key: pair.key.trim().toLowerCase(),
          value: pair.value.trim(),
        }))
        .filter((pair) => pair.key && pair.value);
      patch.variableDefaults = rows.length ? rows : undefined;
    }
    if (args.body !== undefined) patch.body = args.body.trim() || undefined;
    if (args.bodyHtml !== undefined) patch.bodyHtml = args.bodyHtml.trim() || undefined;
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

// A terms or privacy page address as the booking page will link it: empty
// clears, an http(s) URL is kept as the URL parser writes it, anything else
// is refused rather than stored as a link a customer taps into nothing.
function cleanLegalUrl(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConvexError("invalid-url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConvexError("invalid-url");
  }
  return url.toString().slice(0, 500);
}
