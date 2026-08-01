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
  // Returns the new row's id so a caller wiring the field somewhere else
  // (e.g. a voice variable destination) doesn't have to re-derive the key
  // and search for it.
  returns: v.id("contactFields"),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const label = args.label.trim();
    if (!label) throw new Error("label-required");
    // Key derives from the label once and never changes after (values are
    // keyed by it); Turkish-folded, snake_case. Fold BEFORE lowercasing:
    // "İ".toLowerCase() is i + combining dot, which the classes can't match.
    const key = label
      .replace(/[çÇ]/g, "c").replace(/[ğĞ]/g, "g").replace(/[ıİ]/g, "i")
      .replace(/[öÖ]/g, "o").replace(/[şŞ]/g, "s").replace(/[üÜ]/g, "u")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!key) throw new Error("label-required");
    const existing = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (existing.some((field) => field.key === key)) throw new Error("field-exists");
    return await ctx.db.insert("contactFields", {
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
  },
});

// Rename is label-only, and that is the whole reason renaming is safe: the
// key stays the address that stored values and published agents were written
// against, so a new label ripples into every surface that renders the field
// without republishing anything.
export const update = mutation({
  args: {
    fieldId: v.id("contactFields"),
    label: v.optional(v.string()),
    options: v.optional(v.array(v.string())),
    source: v.optional(fieldSource),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const field = await ctx.db.get(args.fieldId);
    if (!field || field.orgId !== orgId) throw new Error("not-found");
    const patch: Record<string, unknown> = {};
    if (args.label !== undefined) {
      const label = args.label.trim();
      if (!label) throw new Error("label-required");
      patch.label = label;
    }
    if (args.options !== undefined) {
      if (field.type !== "select") throw new Error("not-a-select");
      patch.options = [...new Set(args.options.map((o) => o.trim()).filter(Boolean))];
    }
    if (args.source !== undefined && args.source !== (field.source ?? "manual")) {
      // Handing a field back to staff while an agent still writes it would
      // fail that agent's next publish; unlink it on the agent first.
      if (args.source === "manual") {
        const variables = await ctx.db
          .query("voiceAgentVariables")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect();
        const inUse = variables.some(
          (row) => row.contactFieldId === args.fieldId || row.beforeFieldId === args.fieldId,
        );
        if (inUse) throw new Error("field-in-use");
      }
      patch.source = args.source === "voice" ? "voice" : undefined;
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(args.fieldId, patch);
    return null;
  },
});

// Persists a drag-reorder: the client sends the full order, every row gets
// its index. Ported from Nudge's fields admin.
export const reorder = mutation({
  args: { orderedIds: v.array(v.id("contactFields")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    for (const [index, id] of args.orderedIds.entries()) {
      const field = await ctx.db.get(id);
      if (!field || field.orgId !== orgId) throw new Error("not-found");
      await ctx.db.patch(id, { order: index });
    }
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
    // A field an agent still references must not go: the variable registry
    // keeps the dangling id and that agent's next publish dies on
    // "needs a voice-filled customer field". Unlink it on the agent first.
    const variables = await ctx.db
      .query("voiceAgentVariables")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const inUse = variables.some(
      (row) => row.contactFieldId === args.fieldId || row.beforeFieldId === args.fieldId,
    );
    if (inUse) throw new Error("field-in-use");
    // Stored values keep their key harmlessly; re-adding the same label
    // resurfaces them.
    await ctx.db.delete(args.fieldId);
    return null;
  },
});
