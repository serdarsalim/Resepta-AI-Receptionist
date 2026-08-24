import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireOrg, requireUser } from "./lib/orgAuth";
import { foundOrg } from "./lib/foundOrg";
import { discardDraftOrg, draftIsUntouched } from "./lib/discardOrg";
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
    notifyNewBooking: v.boolean(),
    notifyCancelledBooking: v.boolean(),
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
      notifyNewBooking: alertEnabled(user, "new-booking"),
      notifyCancelledBooking: alertEnabled(user, "booking-cancelled"),
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
    notifyNewBooking: v.optional(v.boolean()),
    notifyCancelledBooking: v.optional(v.boolean()),
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
    if (args.notifyNewBooking !== undefined) {
      patch.notifyNewBooking = args.notifyNewBooking;
    }
    if (args.notifyCancelledBooking !== undefined) {
      patch.notifyCancelledBooking = args.notifyCancelledBooking;
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
    // Whether this login may found another business (foundWorkspace below).
    // False only for the anonymous demo walk-in — the switcher uses it to
    // decide whether to render the "Add business" row at all.
    canFound: v.boolean(),
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
    return { activeOrgId: orgId, canFound: !user.isAnonymous, workspaces };
  },
});

// Workspaces somebody else put this login into and never told them about.
//
// Uses requireUser rather than requireOrg on purpose: a person whose ONLY
// membership is one they were just given has no settled active workspace yet,
// and requireOrg's fallback would quietly make the surprise workspace the
// active one before they had been told it existed.
export const unseenWorkspaces = query({
  args: {},
  returns: v.array(
    v.object({
      orgId: v.id("orgs"),
      name: v.string(),
      role: v.union(v.literal("owner"), v.literal("staff")),
    }),
  ),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const out = [];
    for (const row of rows) {
      if (row.seenAt !== undefined) continue;
      const org = await ctx.db.get(row.orgId);
      // An unnamed org is one whose owner has not finished onboarding. Naming
      // it "" in a notice reads as a bug, so skip it until it has a name.
      if (org?.name) out.push({ orgId: row.orgId, name: org.name, role: row.role });
    }
    return out;
  },
});

// Acknowledge one. Called both when they switch to it and when they dismiss:
// either way they now know it exists, which is all the flag records.
export const markWorkspaceSeen = mutation({
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
    if (membership.seenAt === undefined) {
      await ctx.db.patch(membership._id, { seenAt: Date.now() });
    }
    return null;
  },
});

// "Add business" — an existing login founding another workspace, Retell
// style. Births an org identical to the founding sign-in's EXCEPT the trial
// credit, which only a login's first org carries (see lib/foundOrg). The
// caller becomes its owner and is switched into it; the org is unnamed, so
// the onboarding wizard opens on the very next render.
export const foundWorkspace = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    // The demo walk-in browses one salon; it does not get to mint real orgs
    // on the deployment. Real logins all may — a staff-only login founding
    // their own business is exactly the invited-hairdresser-goes-solo story.
    if (user.isAnonymous) throw new Error("anonymous-cannot-found");

    // Drafts this login already owns and nobody else is in. An unnamed org is
    // a business somebody started and did not finish (see lib/discardOrg), and
    // there is never a reason to hold two: the wizard restores no state from
    // the row, so a second draft is a second empty shell wearing the same
    // fallback name in the switcher.
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const drafts: { orgId: Id<"orgs">; at: number; untouched: boolean }[] = [];
    for (const row of memberships) {
      if (row.role !== "owner") continue;
      const org = await ctx.db.get(row.orgId);
      if (!org || org.name !== "" || org.demoMode) continue;
      // Solo only. A draft cannot normally gain teammates, and deleting a
      // workspace out from under somebody is the one mistake this must be
      // structurally unable to make — the same rule discardWorkspace holds.
      const members = await ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", row.orgId))
        .collect();
      if (members.length !== 1) continue;
      drafts.push({
        orgId: row.orgId,
        at: org._creationTime,
        untouched: await draftIsUntouched(ctx, row.orgId),
      });
    }
    drafts.sort((a, b) => b.at - a.at);
    // Newest with WORK in it first, else the newest empty one: a person who
    // got three steps in and closed the tab comes back to those three steps.
    const keep = drafts.find((d) => !d.untouched) ?? drafts[0];
    for (const draft of drafts) {
      if (draft.orgId === keep?.orgId || !draft.untouched) continue;
      await discardDraftOrg(ctx, draft.orgId);
    }

    const orgId = keep?.orgId ?? (await foundOrg(ctx, { grantTrialCredit: false }));
    if (!keep) {
      // Stamped, because nobody needs telling about the business they just
      // founded (same reasoning as the founding sign-in's membership).
      await ctx.db.insert("memberships", {
        userId: user._id,
        orgId,
        role: "owner",
        seenAt: Date.now(),
      });
    }
    // actingAsOrgId cleared, and this is the whole bug this mutation had.
    // requireOrg resolves the ACTING org first and deliberately ignores
    // users.orgId while it is set (lib/orgAuth), so an operator who clicked
    // "Add business" from inside a client got a real draft org, a real
    // membership, a patched users.orgId — and a screen that carried on
    // showing the client. The wizard never opened, because orgs.current still
    // resolved a NAMED org, so the click read as doing nothing and the next
    // one minted another draft. Seven of them, in Serdar's account.
    //
    // Founding is an act of the PERSON, not of the business they are standing
    // in, so it ends the impersonation rather than refusing while it is on.
    await ctx.db.patch(user._id, { orgId, actingAsOrgId: undefined });
    return null;
  },
});

// The wizard's Cancel: erase the active workspace as if "Add business" was
// never clicked, and land back in another one. Only drafts (unnamed orgs) can
// die this way — see lib/discardOrg — and only when there IS somewhere to
// land: a person whose only workspace is the draft must finish onboarding or
// sign out, because an account with no org cannot render the app.
export const discardWorkspace = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { user, orgId, role } = await requireOrg(ctx);
    if (role !== "owner") throw new Error("owner-only");
    // Sole member, checked against the org rather than assumed: a draft
    // cannot normally gain teammates (invites live behind onboarding), but
    // deleting a workspace out from under a colleague is the one mistake
    // this mutation must be structurally unable to make.
    const members = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (members.some((m) => m.userId !== user._id)) {
      throw new Error("not-sole-member");
    }
    const mine = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const fallback = mine.find((m) => m.orgId !== orgId);
    if (!fallback) throw new Error("only-workspace");
    await discardDraftOrg(ctx, orgId);
    await ctx.db.patch(user._id, { orgId: fallback.orgId });
    return null;
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
    // Leaves any impersonation for the same reason foundWorkspace does: the
    // acting org beats users.orgId in requireOrg, so an operator picking a
    // workspace from their own switcher used to write the choice and keep
    // rendering the client. A picker that silently does nothing is worse than
    // one that refuses.
    await ctx.db.patch(user._id, { orgId: args.orgId, actingAsOrgId: undefined });
    return null;
  },
});
