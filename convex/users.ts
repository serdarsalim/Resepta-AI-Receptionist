import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrg, requireUser } from "./lib/orgAuth";
import { alertEnabled } from "./lib/alerts";

// The account panel's own data. Role comes from the caller's membership in the
// ACTIVE workspace, never from the user row: the same login can own one salon
// and cut hair at another.
export const myProfile = query({
  args: {},
  returns: v.object({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.union(v.literal("owner"), v.literal("staff")),
    themePreference: v.optional(
      v.union(v.literal("light"), v.literal("dark"), v.literal("auto")),
    ),
    // Already resolved. A user who has never chosen is reading the app in the
    // business's language, so that is the honest answer to "what language am I
    // in" — the picker should not have to render the difference between
    // choosing tr and inheriting tr, because there isn't one.
    language: v.string(),
    notifyInbound: v.boolean(),
    notifyFailedSend: v.boolean(),
    notifyNewContact: v.boolean(),
  }),
  handler: async (ctx) => {
    const { user, role, orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    return {
      name: user.name,
      email: user.email,
      role,
      themePreference: user.themePreference,
      language: user.language ?? org?.language ?? "tr",
      // Both default to TRUE when unset. A customer reply nobody sees is the
      // exact failure this product exists to prevent, so silence must be opted
      // into, never defaulted into. lib/alerts.ts reads the stored value the
      // same way when it decides who to email.
      notifyInbound: alertEnabled(user, "inbound"),
      notifyFailedSend: alertEnabled(user, "failed-send"),
      notifyNewContact: alertEnabled(user, "new-contact"),
    };
  },
});

// Autosave target for the account panel: name commits on blur, the switches on
// change. Patches only what was supplied, so a toggle never overwrites a name
// the user is still typing.
export const setMyProfile = mutation({
  args: {
    name: v.optional(v.string()),
    language: v.optional(v.string()),
    notifyInbound: v.optional(v.boolean()),
    notifyFailedSend: v.optional(v.boolean()),
    notifyNewContact: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const patch: Record<string, unknown> = {};
    // An emptied name field is a slip, not an instruction to go nameless.
    if (args.name !== undefined && args.name.trim()) patch.name = args.name.trim();
    // Blank means "follow the business", which is a real choice and the
    // default — so unlike name, an empty string clears rather than being
    // ignored.
    if (args.language !== undefined) {
      patch.language = args.language.trim() || undefined;
    }
    if (args.notifyInbound !== undefined) patch.notifyInbound = args.notifyInbound;
    if (args.notifyFailedSend !== undefined) {
      patch.notifyFailedSend = args.notifyFailedSend;
    }
    if (args.notifyNewContact !== undefined) {
      patch.notifyNewContact = args.notifyNewContact;
    }
    if (Object.keys(patch).length === 0) return null;
    await ctx.db.patch(user._id, patch);
    return null;
  },
});

// Cross-device theme preference (Nudge convention): Convex is the source of
// truth, localStorage (src/lib/theme.ts) is the instant no-FOUC cache.
export const setMyTheme = mutation({
  args: {
    theme: v.union(v.literal("light"), v.literal("dark"), v.literal("auto")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { themePreference: args.theme });
    return null;
  },
});

// Workspace switcher data: every org this login belongs to + the active one.
export const myWorkspaces = query({
  args: {},
  returns: v.object({
    activeOrgId: v.id("orgs"),
    workspaces: v.array(
      v.object({
        orgId: v.id("orgs"),
        name: v.string(),
        role: v.union(v.literal("owner"), v.literal("staff")),
      }),
    ),
  }),
  handler: async (ctx) => {
    const { user, orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const workspaces = [];
    for (const row of rows) {
      const org = await ctx.db.get(row.orgId);
      if (org) workspaces.push({ orgId: row.orgId, name: org.name, role: row.role });
    }
    return { activeOrgId: orgId, workspaces };
  },
});

export const setActiveOrg = mutation({
  args: { orgId: v.id("orgs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", user._id).eq("orgId", args.orgId),
      )
      .unique();
    if (!membership) throw new Error("not-a-member");
    await ctx.db.patch(user._id, { orgId: args.orgId });
    return null;
  },
});
