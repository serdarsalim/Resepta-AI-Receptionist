// Membership writes, in one place.
//
// Two doors grant access to a workspace and they have to behave identically:
// the salon's own Team card (convex/team.ts), where an owner adds a colleague,
// and the operator's admin panel (convex/platform.ts), where we add somebody
// for a client who asked over WhatsApp. What differs between them is the
// AUTHORITY — owner of this org, versus the platform allowlist — and nothing
// else. Everything after the gate is the same four operations, and they carry
// rules that are quiet, load-bearing, and easy to leave out of a second copy:
//
//   - an org must never lose its last owner (there is no support desk behind
//     this to undo it),
//   - a staff row keeps its appointments when the login behind it is revoked,
//   - a new membership's seenAt stays UNSET so the person is told rather than
//     handed a workspace silently,
//   - an address with no account gets a TOKEN, never a membership, because
//     possession of an address grants nothing.
//
// So the gate lives at the call site and the write lives here. Callers MUST
// establish authority before calling anything in this file — none of these
// functions check who is asking, by design, because "owner here" and "platform
// admin" are not the same question and neither one belongs in the write.

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { recordActivity } from "./activity";

export type MemberRole = "owner" | "staff";

// inv_<48 hex>, 192 bits from the Web Crypto CSPRNG — same shape and same
// reasoning as mcpKeys.mintKey. This string is the ONLY thing that admits
// somebody to a workspace they were invited to, so it has to be unguessable:
// the address it is mailed to used to be sufficient on its own.
export function mintInviteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `inv_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// An invite left open forever is a trap that ages into a breach: the row sits
// there until somebody with that address happens to sign up, which may be
// months and a job change later.
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// The demo workspace does not grow a team, and more to the point it does not
// send mail to a real address (convex/demo.ts). Anyone can walk into the demo,
// so an invite from it is a mail anybody can make the platform send from its
// own verified domain. Read off the doc rather than importing demo.isDemo:
// that module pulls in messageRules, and a lib importing a top-level function
// module inverts the layering every other file in convex/lib respects.
function orgIsDemo(org: { demoMode?: boolean } | null | undefined): boolean {
  return org?.demoMode === true;
}

// Guard shared by everything that can strip the top tier. An org with no owner
// left cannot change its own settings, invite anybody, or undo the mistake.
export async function wouldOrphanOrg(
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

export async function membershipFor(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("memberships")
    .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", orgId))
    .unique();
}

// Cuts the login link on any bookable row that claimed this person. The staff
// row itself and every appointment on it stay exactly where they are: this
// revokes ACCESS, not existence.
async function unlinkStaff(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  userId: Id<"users">,
): Promise<void> {
  const staffRows = await ctx.db
    .query("staff")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  for (const staff of staffRows) {
    if (staff.userId === userId) await ctx.db.patch(staff._id, { userId: undefined });
  }
}

// "Be a member of this org at this tier", whether or not they already are.
// Returns what actually happened so a caller can report it.
export async function upsertMembership(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    userId: Id<"users">;
    role: MemberRole;
    // Whose name the "you have been added" mail carries. The operator passes a
    // BRAND here (lib/activity.OPERATOR_ACTOR_NAME), never their own name — a
    // client bought a service and did not ask who was at the keyboard.
    invitedByName: string;
    // A bookable row to hand this login to, checked by the caller.
    staffId?: Id<"staff">;
  },
): Promise<"added" | "role-changed" | "unchanged"> {
  const org = await ctx.db.get(args.orgId);
  if (!org) throw new Error("not-found");
  if (orgIsDemo(org)) throw new Error("demo-workspace");

  const existing = await membershipFor(ctx, args.orgId, args.userId);
  if (existing) {
    if (existing.role === args.role) return "unchanged";
    if (args.role !== "owner" && (await wouldOrphanOrg(ctx, args.orgId, args.userId))) {
      throw new Error("last-admin");
    }
    await ctx.db.patch(existing._id, { role: args.role });
    return "role-changed";
  }

  // seenAt deliberately UNSET: somebody else put them here and they have not
  // been told, which is exactly what users.unseenWorkspaces surfaces as the
  // banner on their next visit. A stamp here would hand people a workspace
  // silently.
  await ctx.db.insert("memberships", {
    userId: args.userId,
    orgId: args.orgId,
    role: args.role,
  });
  if (args.staffId) await ctx.db.patch(args.staffId, { userId: args.userId });

  const person = await ctx.db.get(args.userId);
  await recordActivity(ctx, {
    orgId: args.orgId,
    kind: "member_invited",
    detail: person?.email ?? person?.name,
  });
  // No token: this account already exists, so it was joined outright and there
  // is nothing to accept. The banner alone would only reach somebody who
  // happens to sign in.
  if (person?.email) {
    await ctx.scheduler.runAfter(0, internal.email.sendInvite, {
      to: person.email,
      orgName: org.name || "Resepta",
      invitedByName: args.invitedByName,
      language: org.language ?? "tr",
    });
  }
  return "added";
}

export async function setMemberRole(
  ctx: MutationCtx,
  args: { orgId: Id<"orgs">; userId: Id<"users">; role: MemberRole },
): Promise<void> {
  const membership = await membershipFor(ctx, args.orgId, args.userId);
  if (!membership) throw new Error("not-found");
  if (args.role !== "owner" && (await wouldOrphanOrg(ctx, args.orgId, args.userId))) {
    throw new Error("last-admin");
  }
  await ctx.db.patch(membership._id, { role: args.role });
}

export async function revokeMembership(
  ctx: MutationCtx,
  args: { orgId: Id<"orgs">; userId: Id<"users"> },
): Promise<void> {
  const membership = await membershipFor(ctx, args.orgId, args.userId);
  if (!membership) throw new Error("not-found");
  if (await wouldOrphanOrg(ctx, args.orgId, args.userId)) throw new Error("last-admin");
  await unlinkStaff(ctx, args.orgId, args.userId);
  await ctx.db.delete(membership._id);
  const removed = await ctx.db.get(args.userId);
  await recordActivity(ctx, {
    orgId: args.orgId,
    kind: "member_removed",
    detail: removed?.email ?? removed?.name,
  });
}

// The whole "add this address" decision, which is TWO outcomes wearing one
// control: an account that already exists joins immediately (Retell/Slack
// behaviour), an address with no account behind it gets an invite row and a
// mailed token. Invite rows exist only for the second case.
export async function addMemberByEmail(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    email: string;
    role: MemberRole;
    invitedBy: Id<"users">;
    invitedByName: string;
    staffId?: Id<"staff">;
  },
): Promise<"joined" | "invited"> {
  const email = normalizeEmail(args.email);
  if (!isEmail(email)) throw new Error("bad-email");
  const org = await ctx.db.get(args.orgId);
  if (!org) throw new Error("not-found");
  if (orgIsDemo(org)) throw new Error("demo-workspace");

  // Checked before either branch writes anything: an id from another org, or
  // one already claimed, must not quietly become an unlinked invite.
  if (args.staffId) {
    const staff = await ctx.db.get(args.staffId);
    if (!staff || staff.orgId !== args.orgId) throw new Error("not-found");
    if (staff.userId) throw new Error("already-linked");
  }

  const existingUser = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .first();
  if (existingUser) {
    if (await membershipFor(ctx, args.orgId, existingUser._id)) {
      throw new Error("already-member");
    }
    await upsertMembership(ctx, {
      orgId: args.orgId,
      userId: existingUser._id,
      role: args.role,
      invitedByName: args.invitedByName,
      staffId: args.staffId,
    });
    return "joined";
  }

  // Scoped to THIS org. It used to look across the whole table, so one salon
  // inviting an address blocked every other salon from inviting the same
  // person and told them "already-invited" about a workspace they cannot see.
  // Coherent now that acceptance is by token: two orgs may each have an open
  // invite for one address, and the token decides which one is being accepted.
  const open = (
    await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect()
  ).find((row) => row.acceptedAt === undefined && row.orgId === args.orgId);
  if (open) throw new Error("already-invited");

  const token = mintInviteToken();
  await ctx.db.insert("invites", {
    orgId: args.orgId,
    email,
    role: args.role,
    invitedBy: args.invitedBy,
    staffId: args.staffId,
    token,
    expiresAt: Date.now() + INVITE_TTL_MS,
  });
  await recordActivity(ctx, { orgId: args.orgId, kind: "member_invited", detail: email });
  // Scheduled only once the row is written: the mail says "you have been
  // added", and an invite that then failed validation would make that a lie.
  // Fire and forget by design, see email.sendInvite.
  await ctx.scheduler.runAfter(0, internal.email.sendInvite, {
    to: email,
    orgName: org.name || "Resepta",
    invitedByName: args.invitedByName,
    language: org.language ?? "tr",
    token,
  });
  return "invited";
}

export async function revokeInviteRow(
  ctx: MutationCtx,
  args: { orgId: Id<"orgs">; inviteId: Id<"invites"> },
): Promise<void> {
  const invite = await ctx.db.get(args.inviteId);
  if (!invite || invite.orgId !== args.orgId) throw new Error("not-found");
  if (invite.acceptedAt !== undefined) throw new Error("already-accepted");
  await ctx.db.delete(args.inviteId);
}
