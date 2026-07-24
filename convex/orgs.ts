import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrg } from "./lib/orgAuth";

export const DEFAULT_REMINDER_OFFSETS = [24, 2];

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
      reminderOffsetsHours: v.array(v.number()),
      sendBookingConfirmation: v.boolean(),
    }),
    me: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      role: v.optional(v.union(v.literal("owner"), v.literal("staff"))),
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
        kind: v.union(v.literal("confirmation"), v.literal("reminder")),
        metaName: v.string(),
        language: v.string(),
        status: templateStatus,
        bodyPreview: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx) => {
    const { user, orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");
    const waAccount = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
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
        reminderOffsetsHours: org.reminderOffsetsHours ?? DEFAULT_REMINDER_OFFSETS,
        sendBookingConfirmation: org.sendBookingConfirmation ?? true,
      },
      me: { name: user.name, email: user.email, role: user.role },
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
        metaName: t.metaName,
        language: t.language,
        status: t.status,
        bodyPreview: t.bodyPreview,
      })),
    };
  },
});

export const update = mutation({
  args: {
    name: v.optional(v.string()),
    timezone: v.optional(v.string()),
    language: v.optional(v.string()),
    reminderOffsetsHours: v.optional(v.array(v.number())),
    sendBookingConfirmation: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined && args.name.trim()) patch.name = args.name.trim();
    if (args.timezone !== undefined) patch.timezone = args.timezone;
    if (args.language !== undefined) patch.language = args.language;
    if (args.reminderOffsetsHours !== undefined) {
      patch.reminderOffsetsHours = args.reminderOffsetsHours
        .filter((h) => h > 0 && h <= 168)
        .sort((a, b) => b - a);
    }
    if (args.sendBookingConfirmation !== undefined) {
      patch.sendBookingConfirmation = args.sendBookingConfirmation;
    }
    await ctx.db.patch(orgId, patch);
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
    const { orgId } = await requireOrg(ctx);
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
    return null;
  },
});

export const disconnectWhatsapp = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const existing = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

export const updateTemplate = mutation({
  args: {
    templateId: v.id("waTemplates"),
    metaName: v.optional(v.string()),
    language: v.optional(v.string()),
    status: v.optional(templateStatus),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const template = await ctx.db.get(args.templateId);
    if (!template || template.orgId !== orgId) throw new Error("not-found");
    const patch: Record<string, unknown> = {};
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
