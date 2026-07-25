import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrg, requireOwner } from "./lib/orgAuth";

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
    const members = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
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

export const invite = mutation({
  args: { email: v.string(), role },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOwner(ctx);
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("bad-email");
    // Already a member anywhere? A Google account belongs to one org in this
    // model — surface it instead of minting an invite that can never fire.
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (existingUser) throw new Error("already-registered");
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
    });
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
