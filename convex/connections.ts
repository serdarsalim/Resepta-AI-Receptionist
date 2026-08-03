// Operator surface for per-org integration credentials.
//
// Who may touch these: the platform operator, never the salon. Each client gets
// their own Retell account, provisioned by hand during setup, so the key is
// something the operator installs once — not a field a salon owner should ever
// see, paste into, or be able to break. Hence requirePlatformAdmin rather than
// requireOwner. The salon's side of this lane is api.retell.listAgents, which
// reads the key server-side and returns only agent names.
//
// The resolver and the no-env-fallback rule live in lib/connections.ts.

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requirePlatformAdmin } from "./lib/platformAuth";
import { CONNECTION_SPECS, connectionField, connectionSpec, maskSecret } from "./lib/connections";

// Actions have no ctx.db, so every action-side credential read lands here.
// Internal: an action is trusted to have resolved its own org first.
export const getFieldInternal = internalQuery({
  args: { orgId: v.id("orgs"), provider: v.string(), field: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) =>
    await connectionField(ctx, args.orgId, args.provider, args.field),
});

// Runnable from the Convex dashboard, which is how the first key gets installed
// before the fleet console exists — a dashboard call runs as no user, so the
// public wrapper's auth check would reject it. Keep it internal for that reason
// and route the UI through `setField`.
export const setFieldInternal = internalMutation({
  args: {
    orgId: v.id("orgs"),
    provider: v.string(),
    field: v.string(),
    value: v.string(),
    label: v.optional(v.string()),
    updatedBy: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const spec = connectionSpec(args.provider);
    if (!spec) throw new Error("unknown-provider");
    if (!spec.fields.some((f) => f.field === args.field)) throw new Error("unknown-field");
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("no-such-org");
    const value = args.value.trim();
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_org_provider_field", (q) =>
        q.eq("orgId", args.orgId).eq("provider", args.provider).eq("field", args.field),
      )
      .unique();
    // Empty value clears the row rather than storing "", so `connectionField`
    // has one not-configured state instead of two.
    if (!value) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    const patch = {
      value,
      label: args.label?.trim() || existing?.label,
      updatedAt: Date.now(),
      updatedBy: args.updatedBy,
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else
      await ctx.db.insert("connections", {
        orgId: args.orgId,
        provider: args.provider,
        field: args.field,
        ...patch,
      });
    return null;
  },
});

export const setField = mutation({
  args: {
    orgId: v.id("orgs"),
    provider: v.string(),
    field: v.string(),
    value: v.string(),
    label: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requirePlatformAdmin(ctx);
    await ctx.runMutation(internal.connections.setFieldInternal, {
      ...args,
      updatedBy: admin._id,
    });
    return null;
  },
});

// What the operator console shows for one org. Deliberately NOT the value:
// a masked tail plus "when" plus the operator's own label is enough to tell
// set from unset and to recognise which account is installed, and reading a
// key back to a browser would make one compromised operator session worth
// every client's provider account. The useful question ("does this key still
// work") is answered by api.retell.listAgents, not by looking at the string.
export const orgStatus = query({
  args: { orgId: v.id("orgs") },
  returns: v.array(
    v.object({
      provider: v.string(),
      providerLabel: v.string(),
      field: v.string(),
      fieldLabel: v.string(),
      fieldHint: v.union(v.string(), v.null()),
      set: v.boolean(),
      masked: v.union(v.string(), v.null()),
      label: v.union(v.string(), v.null()),
      updatedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return CONNECTION_SPECS.flatMap((spec) =>
      spec.fields.map((f) => {
        const row = rows.find((r) => r.provider === spec.provider && r.field === f.field);
        return {
          provider: spec.provider,
          providerLabel: spec.label,
          field: f.field,
          fieldLabel: f.label,
          fieldHint: f.hint ?? null,
          set: Boolean(row),
          masked: row ? (f.secret ? maskSecret(row.value) : row.value) : null,
          label: row?.label ?? null,
          updatedAt: row?.updatedAt ?? null,
        };
      }),
    );
  },
});
