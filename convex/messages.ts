import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireOrg } from "./lib/orgAuth";

const messageStatus = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("received"),
);

const messageDoc = v.object({
  _id: v.id("messages"),
  _creationTime: v.number(),
  orgId: v.id("orgs"),
  customerId: v.optional(v.id("customers")),
  appointmentId: v.optional(v.id("appointments")),
  direction: v.union(v.literal("out"), v.literal("in")),
  kind: v.string(),
  body: v.optional(v.string()),
  templateName: v.optional(v.string()),
  status: messageStatus,
  wamid: v.optional(v.string()),
  error: v.optional(v.string()),
});

export const listRecent = query({
  args: {},
  returns: v.array(messageDoc),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    return await ctx.db
      .query("messages")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(100);
  },
});

export const listForCustomer = query({
  args: { customerId: v.id("customers") },
  returns: v.array(messageDoc),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(200);
    return rows;
  },
});

// ---- Internal plumbing (send action + webhook) ----

export const logOutQueued = internalMutation({
  args: {
    orgId: v.id("orgs"),
    customerId: v.id("customers"),
    appointmentId: v.optional(v.id("appointments")),
    kind: v.string(),
    templateName: v.optional(v.string()),
    body: v.optional(v.string()),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      orgId: args.orgId,
      customerId: args.customerId,
      appointmentId: args.appointmentId,
      direction: "out",
      kind: args.kind,
      templateName: args.templateName,
      body: args.body,
      status: "queued",
    });
  },
});

export const applySendResult = internalMutation({
  args: {
    messageId: v.id("messages"),
    ok: v.boolean(),
    wamid: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      status: args.ok ? "sent" : "failed",
      wamid: args.wamid,
      error: args.error,
    });
    return null;
  },
});

// Delivery receipts from the webhook, matched by Meta's message id. Unknown
// wamids are dropped silently (receipts for messages we didn't log).
export const applyStatusByWamid = internalMutation({
  args: {
    wamid: v.string(),
    status: v.string(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db
      .query("messages")
      .withIndex("by_wamid", (q) => q.eq("wamid", args.wamid))
      .unique();
    if (!message) return null;
    if (args.status === "delivered" || args.status === "read") {
      // Never regress read → delivered (Meta retries out of order).
      if (message.status === "read") return null;
      await ctx.db.patch(message._id, { status: args.status });
    } else if (args.status === "failed") {
      await ctx.db.patch(message._id, { status: "failed", error: args.error });
    }
    return null;
  },
});

export const logInbound = internalMutation({
  args: {
    orgId: v.id("orgs"),
    customerId: v.optional(v.id("customers")),
    body: v.optional(v.string()),
    wamid: v.optional(v.string()),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      orgId: args.orgId,
      customerId: args.customerId,
      direction: "in",
      kind: "reply",
      body: args.body,
      wamid: args.wamid,
      status: "received",
    });
  },
});
