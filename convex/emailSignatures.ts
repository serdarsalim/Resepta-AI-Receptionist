import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrg } from "./lib/orgAuth";
import { clearSignatureDefaults } from "./lib/emailSignatures";

// A team member's named email signatures (P28, Nudge cc709ea8 and 366e1013),
// each private or shared with everyone in the business, and the one their
// compose window opens with. Scoped to the caller's business on every read
// and write; a signature never crosses into another business, and only the
// person who wrote one changes it.

const NAME_MAX = 80;
// Generous for a sign-off with a logo and a table of contacts, small enough
// that a paste of a whole newsletter is refused rather than stored per send.
const HTML_MAX = 20_000;
// Per person per business. More than this is a template library, which the
// message templates already are.
const PER_PERSON_MAX = 20;

const signatureView = v.object({
  _id: v.id("emailSignatures"),
  name: v.string(),
  html: v.string(),
  shared: v.boolean(),
});

const view = (row: Doc<"emailSignatures">) => ({
  _id: row._id,
  name: row.name,
  html: row.html,
  shared: row.shared,
});

async function membershipOf(
  ctx: { db: QueryCtx["db"] },
  orgId: Id<"orgs">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("memberships")
    .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", orgId))
    .unique();
}

// What the signature menu and the compose window need: mine, my colleagues'
// shared ones (with who wrote them), and which one I open with. A shared
// signature whose writer has left the business is not offered: leaving takes
// them (lib/emailSignatures), and this is the read that would otherwise show
// one left behind by a path that skipped it.
export const available = query({
  args: {},
  returns: v.object({
    mine: v.array(signatureView),
    shared: v.array(v.object({ signature: signatureView, ownerName: v.string() })),
    defaultId: v.union(v.id("emailSignatures"), v.null()),
  }),
  handler: async (ctx) => {
    const { user, orgId } = await requireOrg(ctx);
    const mine = await ctx.db
      .query("emailSignatures")
      .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", user._id))
      .take(PER_PERSON_MAX * 2);
    const sharedRows = await ctx.db
      .query("emailSignatures")
      .withIndex("by_org_shared", (q) => q.eq("orgId", orgId).eq("shared", true))
      .take(200);
    const shared: { signature: ReturnType<typeof view>; ownerName: string }[] = [];
    for (const row of sharedRows) {
      if (row.userId === user._id) continue;
      if (!(await membershipOf(ctx, orgId, row.userId))) continue;
      const owner = await ctx.db.get(row.userId);
      shared.push({ signature: view(row), ownerName: owner?.name?.trim() || owner?.email || "" });
    }
    const membership = await membershipOf(ctx, orgId, user._id);
    const defaultId = membership?.emailSignatureId ?? null;
    const offered =
      defaultId &&
      (mine.some((row) => row._id === defaultId) ||
        shared.some((row) => row.signature._id === defaultId));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return {
      mine: mine.map(view).sort(byName),
      shared: shared.sort((a, b) => byName(a.signature, b.signature)),
      defaultId: offered ? defaultId : null,
    };
  },
});

function cleanName(name: string, fallback: string): string {
  return name.trim().slice(0, NAME_MAX) || fallback;
}

function checkHtml(html: string): string {
  if (html.length > HTML_MAX) throw new Error("signature-too-long");
  return html;
}

export const create = mutation({
  args: { name: v.string(), html: v.string(), shared: v.boolean() },
  returns: v.id("emailSignatures"),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOrg(ctx);
    const existing = await ctx.db
      .query("emailSignatures")
      .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", user._id))
      .take(PER_PERSON_MAX);
    if (existing.length >= PER_PERSON_MAX) throw new Error("too-many-signatures");
    const id = await ctx.db.insert("emailSignatures", {
      orgId,
      userId: user._id,
      name: cleanName(args.name, "Signature"),
      html: checkHtml(args.html),
      shared: args.shared,
    });
    // A first signature is the one you meant to use: it becomes the default
    // when you have none, so writing it is enough to see it in the next mail.
    const membership = await membershipOf(ctx, orgId, user._id);
    if (membership && !membership.emailSignatureId) {
      await ctx.db.patch(membership._id, { emailSignatureId: id });
    }
    return id;
  },
});

async function ownRow(
  ctx: Parameters<typeof requireOrg>[0],
  id: Id<"emailSignatures">,
) {
  const { user, orgId } = await requireOrg(ctx);
  const row = await ctx.db.get(id);
  if (!row || row.orgId !== orgId || row.userId !== user._id) {
    throw new Error("not-your-signature");
  }
  return { row, orgId, userId: user._id };
}

// Only the person who wrote a signature changes it, shared or not.
export const update = mutation({
  args: {
    id: v.id("emailSignatures"),
    name: v.optional(v.string()),
    html: v.optional(v.string()),
    shared: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { row, orgId, userId } = await ownRow(ctx, args.id);
    await ctx.db.patch(row._id, {
      ...(args.name !== undefined ? { name: cleanName(args.name, row.name) } : {}),
      ...(args.html !== undefined ? { html: checkHtml(args.html) } : {}),
      ...(args.shared !== undefined ? { shared: args.shared } : {}),
    });
    // Made private again: colleagues who chose it lose it and open with none.
    if (args.shared === false && row.shared) {
      await clearSignatureDefaults(ctx, orgId, row._id, userId);
    }
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("emailSignatures") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { row, orgId } = await ownRow(ctx, args.id);
    await clearSignatureDefaults(ctx, orgId, row._id);
    await ctx.db.delete(row._id);
    return null;
  },
});

// The signature my compose window opens with; null opens with none.
export const setDefault = mutation({
  args: { signatureId: v.union(v.id("emailSignatures"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOrg(ctx);
    if (args.signatureId) {
      const row = await ctx.db.get(args.signatureId);
      if (!row || row.orgId !== orgId || (row.userId !== user._id && !row.shared)) {
        throw new Error("signature-not-available");
      }
    }
    const membership = await membershipOf(ctx, orgId, user._id);
    if (!membership) throw new Error("not-a-member");
    await ctx.db.patch(membership._id, { emailSignatureId: args.signatureId ?? undefined });
    return null;
  },
});
