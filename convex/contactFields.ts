import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrg, requireOwner } from "./lib/orgAuth";

const fieldType = v.union(
  v.literal("text"),
  v.literal("select"),
  v.literal("number"),
  v.literal("date"),
);

// Where a field's value comes from. Unset reads as "manual" everywhere, so
// every row written before this existed keeps behaving the way it did.
const fieldSource = v.union(v.literal("manual"), v.literal("voice"));

const fieldDoc = v.object({
  _id: v.id("contactFields"),
  _creationTime: v.number(),
  orgId: v.id("orgs"),
  // `key` is the write address: it is what the voice agent sends to
  // update_contact and what customers.custom is keyed by. The UI shows the
  // label, never this.
  key: v.string(),
  label: v.string(),
  type: fieldType,
  options: v.optional(v.array(v.string())),
  order: v.number(),
  source: v.optional(fieldSource),
});

export const list = query({
  args: {},
  returns: v.array(fieldDoc),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const fields = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return fields.sort((a, b) => a.order - b.order);
  },
});

export const create = mutation({
  args: {
    label: v.string(),
    type: fieldType,
    options: v.optional(v.array(v.string())),
    source: v.optional(fieldSource),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const label = args.label.trim();
    if (!label) throw new Error("label-required");
    // Key derives from the label once and never changes after (values are
    // keyed by it); Turkish-folded, snake_case.
    const key = label
      .toLowerCase()
      .replace(/[çÇ]/g, "c").replace(/[ğĞ]/g, "g").replace(/[ıİ]/g, "i")
      .replace(/[öÖ]/g, "o").replace(/[şŞ]/g, "s").replace(/[üÜ]/g, "u")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!key) throw new Error("label-required");
    const existing = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (existing.some((field) => field.key === key)) throw new Error("field-exists");
    await ctx.db.insert("contactFields", {
      orgId,
      key,
      label,
      type: args.type,
      options:
        args.type === "select"
          ? (args.options ?? []).map((o) => o.trim()).filter(Boolean)
          : undefined,
      order: existing.length,
      // Left unset for the default so the stored row stays as small as the
      // meaning: a field nobody marked is a field staff fill in.
      source: args.source === "voice" ? "voice" : undefined,
    });
    return null;
  },
});

export const remove = mutation({
  args: { fieldId: v.id("contactFields") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const field = await ctx.db.get(args.fieldId);
    if (!field || field.orgId !== orgId) throw new Error("not-found");
    // Stored values keep their key harmlessly; re-adding the same label
    // resurfaces them.
    await ctx.db.delete(args.fieldId);
    return null;
  },
});
