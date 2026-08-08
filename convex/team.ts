import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { recordActivity } from "./lib/activity";

const role = v.union(v.literal("owner"), v.literal("staff"));

// Members + pending invites in one read — the Team card renders both lists.
export const overview = query({
  args: {},
  returns: v.object({
    members: v.array(
      v.object({
        _id: v.id("users"),
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        role: v.optional(role),
        isMe: v.boolean(),
      }),
    ),
    pending: v.array(
      v.object({
        _id: v.id("invites"),
        email: v.string(),
        role,
        _creationTime: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const { user, orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const members = [];
    for (const row of rows) {
      const member = await ctx.db.get(row.userId);
      if (member) members.push({ ...member, role: row.role });
    }
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return {
      members: members.map((member) => ({
        _id: member._id,
        name: member.name,
        email: member.email,
        role: member.role,
        isMe: member._id === user._id,
      })),
      pending: invites
        .filter((invite) => invite.acceptedAt === undefined)
        .map((invite) => ({
          _id: invite._id,
          email: invite.email,
          role: invite.role,
          _creationTime: invite._creationTime,
        })),
    };
  },
});

// The whole roster as ONE list, which is how every product in this category
// shows it (Fresha, Booksy, Square all have a single Team). A person is a row;
// "can be booked" and "can log in" are two facts about that row, not two
// different lists on two different cards.
//
// Rows come from both tables and are joined on staff.userId: bookable people
// first in their calendar order, then anyone with a login who is not bookable.
export const roster = query({
  args: {},
  returns: v.array(
    v.object({
      key: v.string(),
      name: v.string(),
      staffId: v.optional(v.id("staff")),
      active: v.optional(v.boolean()),
      // Whether removing this person would leave appointments with no name on
      // them. Reported rather than enforced, so the confirmation can say what
      // it costs instead of the mutation refusing after the fact.
      hasAppointments: v.optional(v.boolean()),
      userId: v.optional(v.id("users")),
      email: v.optional(v.string()),
      role: v.optional(role),
      isMe: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const { user, orgId } = await requireOrg(ctx);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const byUser = new Map(memberships.map((row) => [row.userId, row]));

    const staffRows = (
      await ctx.db
        .query("staff")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

    const rows = [];
    const linked = new Set<string>();
    for (const staff of staffRows) {
      const membership = staff.userId ? byUser.get(staff.userId) : undefined;
      // A stale link — the login was removed from the org but the staff row
      // still points at it — reads as "bookable, no access" rather than
      // showing a tier this person no longer holds.
      const account = membership ? await ctx.db.get(membership.userId) : null;
      if (membership) linked.add(membership.userId);
      // first(), not collect(): the question is whether removing this person
      // would strand any appointment, and one is as true as a thousand.
      const booked = await ctx.db
        .query("appointments")
        .withIndex("by_org_staff", (q) =>
          q.eq("orgId", orgId).eq("staffId", staff._id),
        )
        .first();
      rows.push({
        key: staff._id as string,
        name: staff.name,
        staffId: staff._id,
        active: staff.active,
        hasAppointments: booked !== null,
        userId: membership ? membership.userId : undefined,
        email: account?.email,
        role: membership?.role,
        isMe: membership?.userId === user._id,
      });
    }

    for (const membership of memberships) {
      if (linked.has(membership.userId)) continue;
      const account = await ctx.db.get(membership.userId);
      if (!account) continue;
      rows.push({
        key: membership._id as string,
        name: account.name ?? account.email ?? "",
        staffId: undefined,
        active: undefined,
        hasAppointments: undefined,
        userId: membership.userId,
        email: account.email,
        role: membership.role,
        isMe: membership.userId === user._id,
      });
    }
    // Anyone who can sign in floats to the top, keeping their order otherwise.
    // They are the people you look for first — the ones you grant access to,
    // change roles for and hand the business to — while the rest of the list
    // is a rota you scroll. A stable sort, so the manual order below them
    // survives; nothing else here reorders.
    return rows.sort((a, b) => (b.userId ? 1 : 0) - (a.userId ? 1 : 0));
  },
});

// Guard shared by both mutations that can strip the top tier. An org with no
// admin left cannot change its own settings, invite anybody, or undo the
// mistake — there is no support desk behind this to fix it.
async function wouldOrphanOrg(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  userId: Id<"users">,
): Promise<boolean> {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const admins = memberships.filter((row) => row.role === "owner");
  return admins.length <= 1 && admins.some((row) => row.userId === userId);
}

export const setRole = mutation({
  args: { userId: v.id("users"), role },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) => q.eq("userId", args.userId).eq("orgId", orgId))
      .unique();
    if (!membership) throw new Error("not-found");
    if (args.role !== "owner" && (await wouldOrphanOrg(ctx, orgId, args.userId))) {
      throw new Error("last-admin");
    }
    await ctx.db.patch(membership._id, { role: args.role });
    return null;
  },
});

// Rename somebody who has a LOGIN but no staff row.
//
// Everyone with a staff row is already renameable inline — staff.rename, one
// write, and the name is the org's own. A member who only has an account had
// no editable name at all: the roster falls back to users.name, which an OAuth
// provider filled in from whatever the person called their Google account, and
// the Team card showed it as plain text you could read and not fix.
//
// This writes the USER row, which is shared across every org that person
// belongs to — so it is a rename of the human, not an org-local alias. That is
// the right reading for the case it exists for (an owner fixing their own
// mangled sign-in name), and the reason it is gated: an owner may rename
// people in their own org, and anybody may rename themselves. An org-local
// alias would need a field to live in, and the field it would live in is the
// staff row this person does not have.
export const renameMember = mutation({
  args: { userId: v.id("users"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOrg(ctx);
    const isSelf = user._id === args.userId;
    if (!isSelf) await requireOwner(ctx);
    // Membership in THIS org is what makes them yours to rename. Without it an
    // owner could patch any user row on the deployment by id.
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) => q.eq("userId", args.userId).eq("orgId", orgId))
      .unique();
    if (!membership) throw new Error("not-found");
    const name = args.name.trim();
    if (name) await ctx.db.patch(args.userId, { name });
    return null;
  },
});

// Revokes ACCESS, not existence. Any staff row stays exactly where it is and
// keeps its appointments — the person simply stops being able to sign in.
export const removeMember = mutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) => q.eq("userId", args.userId).eq("orgId", orgId))
      .unique();
    if (!membership) throw new Error("not-found");
    if (await wouldOrphanOrg(ctx, orgId, args.userId)) throw new Error("last-admin");
    const staffRows = await ctx.db
      .query("staff")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    for (const staff of staffRows) {
      if (staff.userId === args.userId) {
        await ctx.db.patch(staff._id, { userId: undefined });
      }
    }
    await ctx.db.delete(membership._id);
    const removed = await ctx.db.get(args.userId);
    await recordActivity(ctx, {
      orgId,
      kind: "member_removed",
      detail: removed?.email ?? removed?.name,
    });
    return null;
  },
});

// Ties a bookable person to a login, or cuts the tie. One login can only be
// one person, so claiming it takes it off whoever held it.
export const linkStaff = mutation({
  args: { staffId: v.id("staff"), userId: v.union(v.id("users"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const staff = await ctx.db.get(args.staffId);
    if (!staff || staff.orgId !== orgId) throw new Error("not-found");
    if (args.userId === null) {
      await ctx.db.patch(args.staffId, { userId: undefined });
      return null;
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) => q.eq("userId", args.userId!).eq("orgId", orgId))
      .unique();
    if (!membership) throw new Error("not-a-member");
    const staffRows = await ctx.db
      .query("staff")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    for (const row of staffRows) {
      if (row._id !== args.staffId && row.userId === args.userId) {
        await ctx.db.patch(row._id, { userId: undefined });
      }
    }
    await ctx.db.patch(args.staffId, { userId: args.userId });
    return null;
  },
});

export const invite = mutation({
  args: {
    email: v.string(),
    role,
    // Sent from an existing member's row: the login being granted belongs to
    // somebody already on the list, so it must arrive attached to them rather
    // than as a second row for one human.
    staffId: v.optional(v.id("staff")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOwner(ctx);
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("bad-email");
    // Checked before either branch writes anything: an id from another org, or
    // one already claimed, must not quietly become an unlinked invite.
    if (args.staffId) {
      const staff = await ctx.db.get(args.staffId);
      if (!staff || staff.orgId !== orgId) throw new Error("not-found");
      if (staff.userId) throw new Error("already-linked");
    }
    const org = await ctx.db.get(orgId);
    // Scheduled at the end of whichever branch takes, never before: the mail
    // says "you have been added", and an invite that then failed validation
    // would make that a lie. Fire and forget by design, see email.sendInvite.
    const notify = () =>
      ctx.scheduler.runAfter(0, internal.email.sendInvite, {
        to: email,
        orgName: org?.name || "Resepta",
        invitedByName: user.name?.trim() || user.email || "Resepta",
        language: org?.language ?? "tr",
      });
    // Workspace model: an EXISTING account joins immediately as a membership
    // (Retell/Slack behavior) — invite rows are only for addresses with no
    // account yet.
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (existingUser) {
      const already = await ctx.db
        .query("memberships")
        .withIndex("by_user_org", (q) =>
          q.eq("userId", existingUser._id).eq("orgId", orgId),
        )
        .unique();
      if (already) throw new Error("already-member");
      await ctx.db.insert("memberships", {
        userId: existingUser._id,
        orgId,
        role: args.role,
      });
      // This account already exists, so there is no acceptance to wait for and
      // the link happens here instead of in auth.ts.
      if (args.staffId) await ctx.db.patch(args.staffId, { userId: existingUser._id });
      await recordActivity(ctx, { orgId, kind: "member_invited", detail: email });
      await notify();
      return null;
    }
    const open = (
      await ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect()
    ).find((row) => row.acceptedAt === undefined);
    if (open) throw new Error("already-invited");
    await ctx.db.insert("invites", {
      orgId,
      email,
      role: args.role,
      invitedBy: user._id,
      staffId: args.staffId,
    });
    await recordActivity(ctx, { orgId, kind: "member_invited", detail: email });
    await notify();
    return null;
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("invites") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.orgId !== orgId) throw new Error("not-found");
    if (invite.acceptedAt !== undefined) throw new Error("already-accepted");
    await ctx.db.delete(args.inviteId);
    return null;
  },
});
