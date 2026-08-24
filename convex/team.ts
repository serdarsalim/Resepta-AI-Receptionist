import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { isDemo } from "./demo";
import { requireUser } from "./lib/orgAuth";
import { recordActivity } from "./lib/activity";
import { discardDraftOrg, draftIsUntouched } from "./lib/discardOrg";

// inv_<48 hex>, 192 bits from the Web Crypto CSPRNG — same shape and same
// reasoning as mcpKeys.mintKey. This string is the ONLY thing that admits
// somebody to a workspace they were invited to, so it has to be unguessable:
// the address it is mailed to used to be sufficient on its own.
function mintInviteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `inv_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// An invite left open forever is a trap that ages into a breach: the row sits
// there until somebody with that address happens to sign up, which may be
// months and a job change later.
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

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
    // The demo workspace does not grow a team, and more to the point it does
    // not send mail to a real address (convex/demo.ts). Anyone can walk into
    // the demo, so an invite from it is a mail anybody can make the platform
    // send from its own verified domain — and sendInvite has no org in hand to
    // refuse it at the far end.
    const inviteOrg = await ctx.db.get(orgId);
    if (isDemo(inviteOrg)) throw new Error("demo-workspace");
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
    const notify = (token?: string) =>
      ctx.scheduler.runAfter(0, internal.email.sendInvite, {
        to: email,
        orgName: org?.name || "Resepta",
        invitedByName: user.name?.trim() || user.email || "Resepta",
        language: org?.language ?? "tr",
        // Only the no-account branch carries one. An account that already
        // exists was joined outright above, so there is nothing to accept and
        // the mail is a notification, not a key.
        ...(token !== undefined ? { token } : {}),
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
    ).find((row) => row.acceptedAt === undefined && row.orgId === orgId);
    if (open) throw new Error("already-invited");
    const token = mintInviteToken();
    await ctx.db.insert("invites", {
      orgId,
      email,
      role: args.role,
      invitedBy: user._id,
      staffId: args.staffId,
      token,
      expiresAt: Date.now() + INVITE_TTL_MS,
    });
    await recordActivity(ctx, { orgId, kind: "member_invited", detail: email });
    await notify(token);
    return null;
  },
});

// The accept step, and the whole point of the token.
//
// Membership used to be granted in auth.ts on an EMAIL match at first sign-in:
// no token, no expiry, nothing to accept. So anyone could sign up, invite an
// address they did not control, and wait — when that person first signed in
// with Google they landed inside the inviter's workspace, reading and writing a
// stranger's salon, and with no salon of their own, because the founding path
// only ran when no invite matched. Possession of an address now grants nothing;
// possession of the mailed secret grants exactly one membership.
//
// Requires no org of its own, so it works for the account that has just
// founded one and is joining a second workspace.
export const acceptInvite = mutation({
  args: { token: v.string() },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
    orgId: v.optional(v.id("orgs")),
    orgName: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const token = args.token.trim();
    if (!token) return { ok: false, reason: "not-found" };
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    // Rows predating the token are matched by nothing and are therefore inert
    // rather than dangerous — the by_token lookup simply cannot find them.
    if (!invite) return { ok: false, reason: "not-found" };
    if (invite.acceptedAt !== undefined) return { ok: false, reason: "already-accepted" };
    if (invite.expiresAt !== undefined && invite.expiresAt < Date.now()) {
      return { ok: false, reason: "expired" };
    }
    // The invite names an address, and admitting a different account than the
    // one named is the confusion the token exists to prevent — a forwarded link
    // must not hand the workspace to whoever opened the mail second.
    if (!user.email || user.email.toLowerCase() !== invite.email) {
      return { ok: false, reason: "wrong-account" };
    }
    const org = await ctx.db.get(invite.orgId);
    if (!org) return { ok: false, reason: "not-found" };

    // Idempotent: the link may be clicked twice, or the owner may have added
    // this person by hand in the meantime.
    const already = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", user._id).eq("orgId", invite.orgId),
      )
      .unique();
    if (!already) {
      // Stamped seenAt: they are standing in the door having just clicked
      // accept, so the "somebody added you" banner would be telling them
      // something they already know.
      await ctx.db.insert("memberships", {
        userId: user._id,
        orgId: invite.orgId,
        role: invite.role,
        seenAt: Date.now(),
      });
    }
    // Invited from an existing member's row: join the two halves now. Guarded
    // on the staff row still existing and still unclaimed, because an invite
    // can sit for two weeks and in that time the member may have been removed
    // or given a different login. Moved here from auth.ts with the rest.
    if (invite.staffId) {
      const staff = await ctx.db.get(invite.staffId);
      if (staff && staff.orgId === invite.orgId && !staff.userId) {
        await ctx.db.patch(invite.staffId, { userId: user._id });
      }
    }
    await ctx.db.patch(invite._id, {
      acceptedAt: Date.now(),
      acceptedUserId: user._id,
    });
    // Land them in the workspace they just accepted rather than whichever was
    // active, which for a first-time account is the empty org they founded on
    // the way in.
    await ctx.db.patch(user._id, { orgId: invite.orgId, role: invite.role });
    // A first-time account arriving through an invite came to JOIN a business,
    // not to found one — but the founding sign-in already minted them an empty
    // org (and its trial credit) on the way in, because auth.ts cannot know an
    // invite is about to be accepted. Erase that org now, so an invited person
    // ends up owning exactly what they came for and the credit dies with the
    // draft rather than waiting to be farmed.
    //
    // Three conditions, each load-bearing. Sole other membership: an
    // established user accepting an invite has real workspaces, and this
    // cleanup must not reason about them. Their own (owner): never someone
    // else's. Untouched draft: unnamed AND no wizard progress — a draft with
    // preset services or a knowledge block is something a person BUILT, and
    // silently deleting built things is worse than the wart this fixes; that
    // draft keeps the wizard's own Cancel as its exit.
    const remaining = (
      await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()
    ).filter((m) => m.orgId !== invite.orgId);
    if (remaining.length === 1 && remaining[0].role === "owner") {
      const draftId = remaining[0].orgId;
      const draft = await ctx.db.get(draftId);
      const soleMember =
        (
          await ctx.db
            .query("memberships")
            .withIndex("by_org", (q) => q.eq("orgId", draftId))
            .collect()
        ).length === 1;
      if (
        draft &&
        draft.name === "" &&
        soleMember &&
        (await draftIsUntouched(ctx, draftId))
      ) {
        await discardDraftOrg(ctx, draftId);
      }
    }
    await recordActivity(ctx, {
      orgId: invite.orgId,
      kind: "member_invited",
      detail: `${invite.email} accepted`,
    });
    return { ok: true, orgId: invite.orgId, orgName: org.name };
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

// ── One person, several businesses ───────────────────────────────────────────
//
// The workspace model has always let one login hold memberships in many orgs.
// What it had no door for was GRANTING one from outside: access was born at
// sign-in (you founded the place) or from an address typed into the Team card
// of the org you were standing in. An owner running four shops with the same
// two receptionists therefore typed the same two addresses four times, waited
// for four mails, and still could not answer "who else can get into my other
// businesses" without switching into each one.
//
// These three functions are the door, and they are CROSS-ORG — which AGENTS.md
// otherwise confines to convex/platform.ts behind the operator allowlist. The
// argument for widening it, in the terms that section asks for:
//
//   - The surface is named: this block, nothing else in this file.
//   - The gate is ownership of BOTH ENDS. The caller must be an owner of the
//     org they are standing in AND an owner of the org being written to, both
//     checked from memberships rows the caller cannot mint. It is not a role,
//     an env var or a column: it is the same authority the Team card already
//     hands them one workspace at a time.
//   - Only people the caller ALREADY manages can be moved. A grant needs the
//     target to be a member of an org the caller owns, so no user id from
//     anywhere else in the deployment can be attached to anything.
//   - The READS give up the least that answers the question. `sharedAccess`
//     returns ids and roles, never names or addresses, so the card can only
//     draw people whose names this org's own Team query already gave it.
//     `shareCandidates` does return names, and only for people who are in a
//     business this caller owns — a Team card they can open by switching
//     workspaces, one click away.
//
// Nothing here reads a customer, a message or an appointment across an org
// boundary, which is the confinement the rule exists to protect.

// Every OTHER business this owner owns, with who from the current team can get
// into it. Ids only — see above.
export const sharedAccess = query({
  args: {},
  returns: v.array(
    v.object({
      orgId: v.id("orgs"),
      name: v.string(),
      // Members of the CURRENT org who also hold a membership there. People
      // that business has who this one does not are deliberately absent: the
      // card answers "where else can my people go", not "who works there".
      shared: v.array(v.object({ userId: v.id("users"), role })),
    }),
  ),
  handler: async (ctx) => {
    const { user, orgId } = await requireOwner(ctx);
    const here = new Set(
      (
        await ctx.db
          .query("memberships")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((row) => row.userId as string),
    );
    const mine = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const out = [];
    for (const row of mine) {
      if (row.orgId === orgId || row.role !== "owner") continue;
      const org = await ctx.db.get(row.orgId);
      // An unnamed org is a draft somebody abandoned mid-wizard, and the demo
      // is not a business anybody staffs. Neither belongs in a list you hand
      // colleagues access from.
      if (!org?.name || isDemo(org)) continue;
      const there = await ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", row.orgId))
        .collect();
      out.push({
        orgId: row.orgId,
        name: org.name,
        shared: there
          .filter((m) => here.has(m.userId as string))
          .map((m) => ({ userId: m.userId, role: m.role })),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// The one write, shared by the card and by the wizard's team step. `role: null`
// revokes.
//
// Direction is not baked in: `orgId` is whichever end is being CHANGED, and the
// caller's own current workspace is only ever the source of authority. The card
// passes another business; the wizard passes the one it is founding.
async function writeAccess(
  ctx: MutationCtx,
  args: {
    actor: Id<"users">;
    actorName: string;
    orgId: Id<"orgs">;
    userId: Id<"users">;
    role: "owner" | "staff" | null;
  },
): Promise<void> {
  const target = await ctx.db.get(args.orgId);
  if (!target || isDemo(target)) throw new Error("not-found");
  // Owner THERE, read fresh rather than trusted from the client.
  const actorThere = await ctx.db
    .query("memberships")
    .withIndex("by_user_org", (q) =>
      q.eq("userId", args.actor).eq("orgId", args.orgId),
    )
    .unique();
  if (!actorThere || actorThere.role !== "owner") throw new Error("owner-only");
  const existing = await ctx.db
    .query("memberships")
    .withIndex("by_user_org", (q) =>
      q.eq("userId", args.userId).eq("orgId", args.orgId),
    )
    .unique();
  const person = await ctx.db.get(args.userId);

  if (args.role === null) {
    if (!existing) return;
    // The same guard the Team card runs, applied to the org being written to:
    // an org whose last admin is revoked from another screen is exactly as
    // stuck as one revoked from its own.
    if (await wouldOrphanOrg(ctx, args.orgId, args.userId)) {
      throw new Error("last-admin");
    }
    // Their bookable row over there keeps every appointment it holds; only the
    // login link is cut, same as removeMember.
    const staffRows = await ctx.db
      .query("staff")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    for (const staff of staffRows) {
      if (staff.userId === args.userId) {
        await ctx.db.patch(staff._id, { userId: undefined });
      }
    }
    await ctx.db.delete(existing._id);
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "member_removed",
      detail: person?.email ?? person?.name,
    });
    return;
  }

  if (existing) {
    if (args.role !== "owner" && (await wouldOrphanOrg(ctx, args.orgId, args.userId))) {
      throw new Error("last-admin");
    }
    if (existing.role !== args.role) {
      await ctx.db.patch(existing._id, { role: args.role });
    }
    return;
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
  await recordActivity(ctx, {
    orgId: args.orgId,
    kind: "member_invited",
    detail: person?.email ?? person?.name,
  });
  // The same mail team.invite sends an existing account — "you have been
  // added", no token, because there is nothing to accept. The banner alone
  // would only reach somebody who happens to sign in.
  if (person?.email) {
    await ctx.scheduler.runAfter(0, internal.email.sendInvite, {
      to: person.email,
      orgName: target.name || "Resepta",
      invitedByName: args.actorName,
      language: target.language ?? "tr",
    });
  }
}

// Only people the caller already manages may be granted anything — the second
// half of the gate. Cheap because it walks the CALLER's memberships (a handful)
// and asks one indexed question per org.
async function managesTogether(
  ctx: MutationCtx,
  actor: Id<"users">,
  userId: Id<"users">,
): Promise<boolean> {
  const mine = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", actor))
    .collect();
  for (const row of mine) {
    if (row.role !== "owner") continue;
    const shared = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", row.orgId))
      .unique();
    if (shared) return true;
  }
  return false;
}

// The card's control: one person, one other business, one role.
export const setAccessElsewhere = mutation({
  args: {
    orgId: v.id("orgs"),
    userId: v.id("users"),
    role: v.union(role, v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOwner(ctx);
    // The current org has its own screen for this, with its own guards and its
    // own activity lines. Two doors onto one row is how they drift apart.
    if (args.orgId === orgId) throw new Error("same-org");
    const here = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", args.userId).eq("orgId", orgId),
      )
      .unique();
    if (!here) throw new Error("not-a-member");
    await writeAccess(ctx, {
      actor: user._id,
      actorName: user.name?.trim() || user.email || "Resepta",
      orgId: args.orgId,
      userId: args.userId,
      role: args.role,
    });
    return null;
  },
});

// Everyone the founder of a NEW business could bring with them: the people in
// their other businesses, deduped to one row per human, minus themselves and
// minus anyone already here.
//
// The suggested role is the STRONGEST one they hold anywhere else — a manager
// who runs one shop and covers a second is a manager, and the wizard's step
// lets it be changed per person before anything is written.
export const shareCandidates = query({
  args: {},
  returns: v.array(
    v.object({
      userId: v.id("users"),
      name: v.string(),
      email: v.optional(v.string()),
      role,
      // The business they are being brought FROM, so a row that reads as an
      // unfamiliar name still says where the owner knows it from.
      from: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const { user, orgId } = await requireOwner(ctx);
    const here = new Set(
      (
        await ctx.db
          .query("memberships")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((row) => row.userId as string),
    );
    const mine = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const found = new Map<
      string,
      { userId: Id<"users">; name: string; email?: string; role: "owner" | "staff"; from: string }
    >();
    for (const row of mine) {
      if (row.orgId === orgId || row.role !== "owner") continue;
      const org = await ctx.db.get(row.orgId);
      if (!org?.name || isDemo(org)) continue;
      const members = await ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", row.orgId))
        .collect();
      for (const member of members) {
        const key = member.userId as string;
        if (here.has(key)) continue;
        const account = await ctx.db.get(member.userId);
        // An account with no address is an anonymous demo walk-in, never a
        // colleague — and there would be nothing to mail them anyway.
        if (!account?.email) continue;
        const already = found.get(key);
        if (already) {
          if (member.role === "owner") already.role = "owner";
          continue;
        }
        found.set(key, {
          userId: member.userId,
          name: account.name?.trim() || account.email,
          email: account.email,
          role: member.role,
          from: org.name,
        });
      }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  },
});

// The wizard's team step, committed in ONE transaction: a founder who picked
// three people gets three memberships or none, never a business half-staffed
// by a mid-flight failure.
export const shareIntoThisBusiness = mutation({
  args: {
    grants: v.array(v.object({ userId: v.id("users"), role })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOwner(ctx);
    for (const grant of args.grants) {
      if (grant.userId === user._id) continue;
      if (!(await managesTogether(ctx, user._id, grant.userId))) {
        throw new Error("not-yours-to-share");
      }
      await writeAccess(ctx, {
        actor: user._id,
        actorName: user.name?.trim() || user.email || "Resepta",
        orgId,
        userId: grant.userId,
        role: grant.role,
      });
    }
    return null;
  },
});
