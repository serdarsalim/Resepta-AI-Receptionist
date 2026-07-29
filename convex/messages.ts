import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrg } from "./lib/orgAuth";
import { alertFailedSend } from "./lib/alerts";
import { classifyFailure, nextAttemptDelay } from "./lib/sendFailure";

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
    // The {{1}}..{{n}} values, in order. Stored so a retry replays the same
    // words rather than rebuilding them from data that may have moved.
    templateParams: v.optional(v.array(v.string())),
    body: v.optional(v.string()),
    // Email lane only. Carried here rather than patched afterwards so the row
    // is complete the moment it appears in the feed — a bubble that renders
    // subject-less for a second and then pops one is worse than either.
    emailSubject: v.optional(v.string()),
    emailFrom: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
    // An outbound image from the library. Same field the inbound path uses, so
    // the thread renders both directions without knowing which is which.
    mediaStorageId: v.optional(v.id("_storage")),
    // Which number this goes out on. Unset = cloud.
    lane: v.optional(v.union(v.literal("cloud"), v.literal("evolution"))),
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
      templateParams: args.templateParams,
      body: args.body,
      emailSubject: args.emailSubject,
      emailFrom: args.emailFrom,
      scheduledFor: args.scheduledFor,
      mediaStorageId: args.mediaStorageId,
      lane: args.lane,
      status: "queued",
      // A row with no scheduledFor is being sent RIGHT NOW by the action that
      // just created it, so it is in flight from this moment. Stamping it here
      // is what lets delivery.reapStuck find it if that action dies between
      // this insert and applySendResult — otherwise the row sits queued
      // forever with nothing owed and nothing watching it.
      ...(args.scheduledFor === undefined ? { sendingAt: Date.now() } : {}),
    });
  },
});

// ── The one place a send outcome is decided ─────────────────────────────────
//
// Every send path in the app lands here, which is deliberate: retry policy,
// dead-lettering and the failure alert all have to agree, and the only way to
// guarantee that is to have one function own all three.
//
// A failure is classified (lib/sendFailure.ts) before anything is written:
//
//   permanent   -> status "failed" now, alert now. Nothing about waiting would
//                  help — no consent, no approved template, a shut window.
//   transient   -> status stays "queued" with nextAttemptAt set, and NO alert.
//                  The salon should never hear about a 500 that the backoff
//                  quietly recovered from thirty seconds later.
//   out of budget -> "failed" plus deadLetteredAt, and the alert says we tried.
//
// Keeping a retrying row as "queued" rather than "failed" matters: the Messages
// tab and the health counts both read status, and a message still in flight is
// not a message that failed. Telling the owner otherwise makes them chase
// something that is about to deliver itself.
export const applySendResult = internalMutation({
  args: {
    messageId: v.id("messages"),
    ok: v.boolean(),
    wamid: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) return null;
    const attempts = (message.attempts ?? 0) + 1;

    if (args.ok) {
      await ctx.db.patch(args.messageId, {
        status: "sent",
        wamid: args.wamid,
        error: undefined,
        attempts,
        nextAttemptAt: undefined,
        sendingAt: undefined,
      });
      return null;
    }

    const permanent = classifyFailure(args.error) === "permanent";
    const delay = permanent ? undefined : nextAttemptDelay(attempts);

    if (delay !== undefined) {
      await ctx.db.patch(args.messageId, {
        status: "queued",
        error: args.error,
        attempts,
        nextAttemptAt: Date.now() + delay,
        sendingAt: undefined,
      });
      return null;
    }

    // Terminal. A permanent refusal was never retried, so it is not a dead
    // letter — that word is reserved for "we tried properly and the provider
    // never took it", which is the one worth waking somebody for.
    const deadLettered = !permanent;
    await ctx.db.patch(args.messageId, {
      status: "failed",
      error: args.error,
      attempts,
      nextAttemptAt: undefined,
      sendingAt: undefined,
      ...(deadLettered ? { deadLetteredAt: Date.now() } : {}),
    });

    const customer = message.customerId ? await ctx.db.get(message.customerId) : null;
    await alertFailedSend(ctx, {
      orgId: message.orgId,
      name: customer
        ? `${customer.firstName} ${customer.lastName ?? ""}`.trim()
        : "—",
      reason: args.error ?? "unknown",
      deadLettered,
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
    // Set when the message carried an image. The row lands immediately with
    // the caption and a pending flag; the bytes follow from an action,
    // because a mutation cannot reach Meta.
    mediaPending?: boolean;
    // Which lane carried it. Unset = cloud.
    lane?: "cloud" | "evolution";
  },
): Promise<Id<"messages">> {
  return await ctx.db.insert("messages", {
    orgId: args.orgId,
    customerId: args.customerId,
    direction: "in",
    kind: "reply",
    body: args.body,
    wamid: args.wamid,
    status: "received",
    ...(args.lane ? { lane: args.lane } : {}),
    ...(args.mediaPending ? { mediaPending: true } : {}),
  });
}

// The image, once the action has it. Clears the pending flag in the same
// write, so a row is never both pending and complete.
export const attachMedia = internalMutation({
  args: {
    messageId: v.id("messages"),
    storageId: v.optional(v.id("_storage")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      mediaStorageId: args.storageId,
      mediaPending: undefined,
    });
    return null;
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

// Where a row came from. `form` is an INTAKE, not a channel: somebody filled
// in a page, which is not something the salon can reach them back on. It
// therefore lives here and in feedChannel, never in the `channel` union that
// the inbox's "reachable on" strip reads — same rule as notes.
export type FeedSource = Channel | "form" | "note";

// The email lane logs under `email_<kind>` (see wa.ts) and the form lane under
// `form_<kind>` — the prefix IS the marker. Everything else rode WhatsApp.
export function channelOfMessage(kind: string): Channel | "form" {
  if (kind.startsWith("email_")) return "email";
  if (kind.startsWith("form_")) return "form";
  return "whatsapp";
}

// What a feed row can be, which is wider than what a channel can be: a note is
// a row here but it is not something a customer can be reached on. The narrow
// `channel` union above stays narrow so the inbox list's channel strip can't
// start claiming a customer was contacted by note.
export const feedChannel = v.union(
  channel,
  v.literal("form"),
  v.literal("note"),
);

const feedItem = v.object({
  id: v.string(),
  channel: feedChannel,
  at: v.number(),
  // Normalized across tables: a call's "inbound" is a message's "in".
  // Optional because a note has no direction — nobody sent it anywhere.
  direction: v.optional(v.union(v.literal("out"), v.literal("in"))),
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
  // Email-only. A subject is the one thing an email has that a WhatsApp
  // message doesn't, and it is what the reader scans first.
  emailSubject: v.optional(v.string()),
  emailHtml: v.optional(v.string()),
  // A signed URL for the stored image, minted per read. The storage id itself
  // never reaches the client — it is a handle to a file, and a URL is what a
  // browser can actually render.
  mediaUrl: v.optional(v.string()),
  mediaPending: v.optional(v.boolean()),
  // Set while a send is waiting for its moment. The bubble counts down to it
  // and can be cancelled until the cron picks it up.
  scheduledFor: v.optional(v.number()),
  // Note-only.
  authorName: v.optional(v.string()),
  editedAt: v.optional(v.number()),
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
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(200);

    // Authors resolved once per distinct writer, not once per note: a salon
    // owner who left forty notes on a regular is one read, not forty.
    const authors = new Map<string, string | undefined>();
    for (const authorId of new Set(notes.map((n) => n.authorId))) {
      const author = await ctx.db.get(authorId);
      authors.set(authorId, author?.name ?? author?.email ?? undefined);
    }

    // Signed URLs resolved before the map so the loop stays synchronous.
    const mediaUrls = new Map<string, string>();
    for (const m of messages) {
      if (!m.mediaStorageId) continue;
      const url = await ctx.storage.getUrl(m.mediaStorageId);
      if (url) mediaUrls.set(m._id as string, url);
    }

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
        emailSubject: m.emailSubject,
        emailHtml: m.emailHtml,
        mediaUrl: mediaUrls.get(m._id as string),
        mediaPending: m.mediaPending,
        scheduledFor: m.scheduledFor,
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
      ...notes.map((n) => ({
        id: n._id as string,
        channel: "note" as const,
        at: n._creationTime,
        kind: "note",
        body: n.body,
        authorName: authors.get(n.authorId),
        editedAt: n.editedAt,
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

export type ConversationEntry = {
  // The inbox list's own strip, which answers "how can I reach this person" —
  // so a form intake counts as one more thing that happened, not as a way
  // back to them. Narrowed at the push below.
  channel: Channel | "form";
  at: number;
  direction: "in" | "out";
  body?: string;
  failed: boolean;
};

// The expensive half: one window over messages and calls, grouped by customer.
// Nothing from the customers table is touched here.
export async function conversationEntries(
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
export function summariseEntries(entries: ConversationEntry[]): ConversationSummary {
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
      // A muted customer is not in the inbox at all, so counting them here
      // would leave a badge pointing at rows that aren't there.
      if (customer.mutedAt) continue;
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
      // The last thing that HAPPENED, which can be a form arrival. Distinct
      // from awaitingChannels below, which is only ever real channels because
      // it answers "where do I reply".
      lastChannel: feedChannel,
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
      // Muted contacts leave the inbox entirely. The conversation stays whole
      // and readable from the contact record, which is where you go when you
      // actually want to look; what mute buys is that it stops arriving here
      // unasked. Dropping the row rather than only dimming its dot is the
      // point: a quiet row in a list of forty is still forty rows to read.
      if (customer.mutedAt) continue;
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

// Has this org already recorded this exact failure recently?
//
// Some failures are facts about the ORG, not about the customer or the
// message: no WhatsApp number connected, no approved template. They are true
// for every send until somebody opens Settings, so left alone they write a red
// row into every customer's conversation, one per reminder, forever — and the
// thread that should show what a customer was told becomes a log of what the
// org has not configured yet. Settings already says it, loudly and once.
//
// Bounded to the recent window rather than "ever": if the org fixes WhatsApp
// and it breaks again months later, that deserves a fresh row. So this is a
// rate limit, not a one-time flag.
export const hasRecentFailure = internalQuery({
  args: { orgId: v.id("orgs"), error: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(40);
    return recent.some((m) => m.status === "failed" && m.error === args.error);
  },
});
