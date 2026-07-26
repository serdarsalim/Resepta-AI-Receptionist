import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrg } from "./lib/orgAuth";

// Notes on a customer. There is no `list` here on purpose: a note is a row in
// the conversation feed, not a separate list living beside it, so reading them
// is messages.feedForCustomer's job. This file only writes.
//
// Every member of the org can edit and delete any note, author or not. A salon
// is three people sharing one record; locking a typo to whoever made it just
// means the wrong name stays on the wrong customer.

export const add = mutation({
  args: {
    customerId: v.id("customers"),
    body: v.string(),
  },
  returns: v.id("notes"),
  handler: async (ctx, args) => {
    const { orgId, user } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    const body = args.body.trim();
    if (!body) throw new Error("body-required");
    return await ctx.db.insert("notes", {
      orgId,
      customerId: args.customerId,
      body,
      authorId: user._id,
    });
  },
});

export const update = mutation({
  args: {
    noteId: v.id("notes"),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const note = await ctx.db.get(args.noteId);
    if (!note || note.orgId !== orgId) throw new Error("not-found");
    const body = args.body.trim();
    // An empty edit is a delete the user didn't mean to ask for. Reject it and
    // let them use the delete button, which says what it does.
    if (!body) throw new Error("body-required");
    if (body === note.body) return null;
    await ctx.db.patch(args.noteId, { body, editedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { noteId: v.id("notes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const note = await ctx.db.get(args.noteId);
    if (!note || note.orgId !== orgId) throw new Error("not-found");
    await ctx.db.delete(args.noteId);
    return null;
  },
});
