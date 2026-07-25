import { v } from "convex/values";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrg } from "./lib/orgAuth";

const messageStatus = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("received"),
);


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

// Plain helpers for webhook.ts — it's already a mutation, so these run inside
// its transaction rather than as separate internal mutations.

// Delivery receipts matched by Meta's message id. Unknown wamids drop
// silently (receipts for messages we didn't log).
export async function applyWamidStatus(
  ctx: MutationCtx,
  wamid: string,
  status: string,
  error?: string,
) {
  const message = await ctx.db
    .query("messages")
    .withIndex("by_wamid", (q) => q.eq("wamid", wamid))
    .unique();
  if (!message) return;
  if (status === "delivered" || status === "read") {
    // Never regress read → delivered (Meta retries out of order).
    if (message.status === "read") return;
    await ctx.db.patch(message._id, { status });
  } else if (status === "failed") {
    await ctx.db.patch(message._id, { status: "failed", error });
  }
}

export async function logInboundRow(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    customerId?: Id<"customers">;
    body?: string;
    wamid?: string;
  },
) {
  await ctx.db.insert("messages", {
    orgId: args.orgId,
    customerId: args.customerId,
    direction: "in",
    kind: "reply",
    body: args.body,
    wamid: args.wamid,
    status: "received",
  });
}

// Red-dot badge on the Inbox tab: failed sends in the last 48h.
export const failedCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(200);
    const cutoff = Date.now() - 48 * 3600_000;
    return recent.filter(
      (m) => m.status === "failed" && m._creationTime > cutoff,
    ).length;
  },
});

// ---- Unified conversation feed (WhatsApp + email + calls) ----
//
// The inbox is per CUSTOMER, not per channel (Nudge's InboxView model). A
// customer who called and then wrote on WhatsApp is ONE conversation with two
// channels, never two rows. Calls live in their own table because they carry
// transcripts and recordings, so the merge happens here on read rather than by
// forcing calls into `messages`.

export const channel = v.union(
  v.literal("whatsapp"),
  v.literal("email"),
  v.literal("call"),
);

export type Channel = "whatsapp" | "email" | "call";

// The email lane logs under `email_<kind>` (see wa.ts) — the prefix IS the
// channel marker. Everything else in `messages` rode WhatsApp.
export function channelOfMessage(kind: string): Channel {
  return kind.startsWith("email_") ? "email" : "whatsapp";
}

const feedItem = v.object({
  id: v.string(),
  channel,
  at: v.number(),
  // Normalized across tables: a call's "inbound" is a message's "in".
  direction: v.union(v.literal("out"), v.literal("in")),
  kind: v.string(),
  body: v.optional(v.string()),
  status: v.optional(messageStatus),
  error: v.optional(v.string()),
  // Call-only.
  durationSec: v.optional(v.number()),
  outcome: v.optional(v.string()),
  summary: v.optional(v.string()),
  transcript: v.optional(v.string()),
  recordingUrl: v.optional(v.string()),
});

// One customer's whole history, newest first, every channel interleaved.
// Shared by the inbox right pane and the contact page — one implementation.
export const feedForCustomer = query({
  args: { customerId: v.id("customers") },
  returns: v.array(feedItem),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(200);
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(200);

    const items = [
      ...messages.map((m) => ({
        id: m._id as string,
        channel: channelOfMessage(m.kind),
        at: m._creationTime,
        direction: m.direction,
        kind: m.kind,
        body: m.body,
        status: m.status,
        error: m.error,
      })),
      ...calls.map((c) => ({
        id: c._id as string,
        channel: "call" as const,
        at: c.startedAt,
        direction: (c.direction === "inbound" ? "in" : "out") as "in" | "out",
        kind: "call",
        durationSec: c.durationSec,
        outcome: c.outcome,
        summary: c.summary,
        transcript: c.transcript,
        recordingUrl: c.recordingUrl,
      })),
    ];
    return items.sort((a, b) => b.at - a.at);
  },
});

// Inbox left pane: one row per customer, newest activity first, carrying the
// last preview plus which channels are waiting on a reply from the business.
export const conversations = query({
  args: {},
  returns: v.array(
    v.object({
      customerId: v.id("customers"),
      name: v.string(),
      phone: v.string(),
      email: v.optional(v.string()),
      lastAt: v.number(),
      lastBody: v.optional(v.string()),
      lastDirection: v.union(v.literal("out"), v.literal("in")),
      lastChannel: channel,
      hasFailed: v.boolean(),
      awaitingReply: v.boolean(),
      // Channels whose most recent activity is an unanswered inbound. Drives
      // the pinned, tinted icons in the row's channel strip.
      awaitingChannels: v.array(channel),
    }),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(500);
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(200);

    type Entry = {
      channel: Channel;
      at: number;
      direction: "in" | "out";
      body?: string;
      failed: boolean;
    };
    const byCustomer = new Map<string, Entry[]>();
    const push = (customerId: string | undefined, entry: Entry) => {
      if (!customerId) return;
      const bucket = byCustomer.get(customerId) ?? [];
      bucket.push(entry);
      byCustomer.set(customerId, bucket);
    };
    for (const m of messages) {
      push(m.customerId, {
        channel: channelOfMessage(m.kind),
        at: m._creationTime,
        direction: m.direction,
        body: m.body,
        failed: m.status === "failed",
      });
    }
    for (const c of calls) {
      push(c.customerId, {
        channel: "call",
        at: c.startedAt,
        direction: c.direction === "inbound" ? "in" : "out",
        body: c.summary,
        failed: false,
      });
    }

    const out = [];
    for (const [customerId, entries] of byCustomer) {
      const customer = await ctx.db.get(customerId as Id<"customers">);
      if (!customer) continue;
      entries.sort((a, b) => b.at - a.at);
      const last = entries[0];
      // Per channel, only the LATEST entry decides — an old unanswered reply
      // that was since answered on that channel is not still waiting.
      const awaitingChannels: Channel[] = [];
      for (const ch of ["whatsapp", "email", "call"] as const) {
        const latest = entries.find((e) => e.channel === ch);
        if (latest?.direction === "in") awaitingChannels.push(ch);
      }
      out.push({
        customerId: customer._id,
        name: `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
        phone: customer.phone,
        email: customer.email,
        lastAt: last.at,
        lastBody: last.body,
        lastDirection: last.direction,
        lastChannel: last.channel,
        hasFailed: entries.some((e) => e.failed),
        awaitingReply: awaitingChannels.length > 0,
        awaitingChannels,
      });
    }
    return out.sort((a, b) => b.lastAt - a.lastAt);
  },
});
