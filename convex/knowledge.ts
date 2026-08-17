import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireOrg, requireOwner } from "./lib/orgAuth";

// The business's own prose — what the chat agent knows beyond the structured
// tables (docs/chat-agent.md §1). Deliberately BLOCKS with titles rather than
// one big textarea: the editor stays scannable, the agent's context can name
// its sections, and deleting one topic does not mean re-reading a wall of
// text to find its edges.

const knowledgeDoc = v.object({
  _id: v.id("knowledge"),
  _creationTime: v.number(),
  orgId: v.id("orgs"),
  title: v.string(),
  body: v.string(),
  order: v.number(),
  updatedAt: v.number(),
  updatedBy: v.optional(v.id("users")),
});

// A salon's whole knowledge is a few thousand tokens by nature, but nothing
// enforces nature. The caps keep one org's paste-happy afternoon from
// swallowing the agent's context window: ~30 blocks of ~4k chars is far more
// than any real business needs and still comfortably inside the prompt.
const MAX_BLOCKS = 30;
const MAX_BODY_CHARS = 4000;
const MAX_TITLE_CHARS = 80;

export const list = query({
  args: {},
  returns: v.array(knowledgeDoc),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("knowledge")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.sort((a, b) => a.order - b.order);
  },
});

export const create = mutation({
  args: { title: v.string(), body: v.string() },
  returns: v.id("knowledge"),
  handler: async (ctx, args) => {
    const { orgId, user } = await requireOwner(ctx);
    const title = args.title.trim().slice(0, MAX_TITLE_CHARS);
    const body = args.body.trim().slice(0, MAX_BODY_CHARS);
    if (!title) throw new Error("empty-title");
    const rows = await ctx.db
      .query("knowledge")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (rows.length >= MAX_BLOCKS) throw new Error("too-many-blocks");
    return await ctx.db.insert("knowledge", {
      orgId,
      title,
      body,
      order: rows.length ? Math.max(...rows.map((r) => r.order)) + 1 : 0,
      updatedAt: Date.now(),
      updatedBy: user._id,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("knowledge"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId, user } = await requireOwner(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== orgId) throw new Error("not-found");
    const patch: Record<string, unknown> = {
      updatedAt: Date.now(),
      updatedBy: user._id,
    };
    if (args.title !== undefined) {
      const title = args.title.trim().slice(0, MAX_TITLE_CHARS);
      if (!title) throw new Error("empty-title");
      patch.title = title;
    }
    if (args.body !== undefined) {
      patch.body = args.body.trim().slice(0, MAX_BODY_CHARS);
    }
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("knowledge") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== orgId) throw new Error("not-found");
    await ctx.db.delete(args.id);
    return null;
  },
});

// The agent's read (convex/chatAgent.ts). Internal and org-passed rather than
// session-scoped: the caller is a webhook-triggered action, not a signed-in
// user, and the org was resolved from the channel exactly like every other
// sessionless path.
export const forAgent = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.array(v.object({ title: v.string(), body: v.string() })),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("knowledge")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return rows
      .sort((a, b) => a.order - b.order)
      .filter((r) => r.body.trim())
      .map((r) => ({ title: r.title, body: r.body }));
  },
});
