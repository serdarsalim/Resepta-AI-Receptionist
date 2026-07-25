import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
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

// ---- The shared half of the inbox --------------------------------------------
//
// The inbox list and the sidebar's dot ask the same question of the same 500
// messages. They used to ask it twice: the badge ran the whole conversations
// query and threw away everything but a boolean. The scan and the per-row
// reasoning live here now, and each caller reads only what it needs from the
// customers table on top.

type ConversationEntry = {
  channel: Channel;
  at: number;
  direction: "in" | "out";
  body?: string;
  failed: boolean;
};

// The expensive half: one window over messages and calls, grouped by customer.
// Nothing from the customers table is touched here.
async function conversationEntries(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
): Promise<Map<string, ConversationEntry[]>> {
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

  const byCustomer = new Map<string, ConversationEntry[]>();
  const push = (customerId: string | undefined, entry: ConversationEntry) => {
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
  return byCustomer;
}

type ConversationSummary = {
  last: ConversationEntry;
  awaitingChannels: Channel[];
  hasFailed: boolean;
  // The newest moment that WANTS attention: an unanswered inbound, or a failed
  // send. Zero when nothing in this conversation ever asks for a look.
  //
  // This is what a dismissal gets compared against, and getting it wrong is
  // what made the dot un-clearable: comparing the dismissal to the row's last
  // ACTIVITY meant any later message, even one the salon itself sent, dragged
  // a months-old failure back into view. Failure included, same clock.
  attentionAt: number;
};

// Everything the entries alone decide. Sorts in place; the caller owns the
// array.
function summariseEntries(entries: ConversationEntry[]): ConversationSummary {
  entries.sort((a, b) => b.at - a.at);
  // Per channel, only the LATEST entry decides — an old unanswered reply that
  // was since answered on that channel is not still waiting.
  const awaitingChannels: Channel[] = [];
  let attentionAt = 0;
  for (const ch of ["whatsapp", "email", "call"] as const) {
    const latest = entries.find((e) => e.channel === ch);
    if (latest?.direction === "in") {
      awaitingChannels.push(ch);
      attentionAt = Math.max(attentionAt, latest.at);
    }
  }
  // Newest first, so the first failure found is the newest one.
  const newestFailure = entries.find((e) => e.failed);
  if (newestFailure) attentionAt = Math.max(attentionAt, newestFailure.at);
  return {
    last: entries[0],
    awaitingChannels,
    hasFailed: newestFailure !== undefined,
    attentionAt,
  };
}

// The sidebar's Inbox dot. Same meaning as a row's dot, counted: rows nobody
// has dealt with yet. It is deliberately the same green, because two colours
// of dot in one app is a legend the reader has to learn.
export const attentionCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const byCustomer = await conversationEntries(ctx, orgId);
    let count = 0;
    for (const [customerId, entries] of byCustomer) {
      const { attentionAt } = summariseEntries(entries);
      // A conversation with nothing waiting can never be lit, whatever the
      // customer row says, so it never earns a read of that row.
      if (attentionAt === 0) continue;
      const customer = await ctx.db.get(customerId as Id<"customers">);
      if (!customer) continue;
      if (attentionAt > (customer.attentionClearedAt ?? 0)) count += 1;
    }
    return count;
  },
});

// Clearing the dot by hand. Stamped on the customer, not per user: a salon
// shares one inbox, so once anyone has handled a row it should stop asking
// everyone else. Passing cleared: false unstamps it, which is how a row you
// dismissed too early comes back.
export const setAttention = mutation({
  args: { customerId: v.id("customers"), cleared: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    await ctx.db.patch(args.customerId, {
      attentionClearedAt: args.cleared ? Date.now() : undefined,
    });
    return null;
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
      // ONE dot, one meaning: somebody still has to look at this row. It
      // covers an unanswered inbound and a send that failed, because both are
      // "the salon has to act" and a second colour just made the reader learn
      // a legend. Which one it is lives in the dot's title.
      needsAttention: v.boolean(),
      // Channels whose most recent activity is an unanswered inbound. Drives
      // the pinned, tinted icons in the row's channel strip.
      awaitingChannels: v.array(channel),
    }),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const byCustomer = await conversationEntries(ctx, orgId);

    const out = [];
    for (const [customerId, entries] of byCustomer) {
      const customer = await ctx.db.get(customerId as Id<"customers">);
      if (!customer) continue;
      const summary = summariseEntries(entries);
      out.push({
        customerId: customer._id,
        name: `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
        phone: customer.phone,
        email: customer.email,
        lastAt: summary.last.at,
        lastBody: summary.last.body,
        lastDirection: summary.last.direction,
        lastChannel: summary.last.channel,
        hasFailed: summary.hasFailed,
        awaitingReply: summary.awaitingChannels.length > 0,
        // Dismissing stamps the moment; anything that WANTS attention after
        // that lights the dot again on its own, so clearing a row is never a
        // way to lose a customer who wrote back an hour later, and never a way
        // for an old failure to come back either.
        needsAttention: summary.attentionAt > (customer.attentionClearedAt ?? 0),
        awaitingChannels: summary.awaitingChannels,
      });
    }
    return out.sort((a, b) => b.lastAt - a.lastAt);
  },
});
