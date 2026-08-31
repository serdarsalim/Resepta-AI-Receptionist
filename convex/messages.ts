import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrg } from "./lib/orgAuth";
import { alertFailedSend } from "./lib/alerts";
import { classifyFailure, nextAttemptDelay } from "./lib/sendFailure";
import { recordSendUsage } from "./lib/usage";
import { supersedePendingSuggestions } from "./lib/agentDrafts";
import { noteBulkItemResult } from "./bulkRuns";

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
    // The markup we actually put in the customer's inbox, when the sender
    // composed in the rich editor. Stored so OUR half of a thread renders the
    // way it was written — before this, a formatted reply came back as its own
    // flattened text and the salon's bold headings vanished from their own
    // record. `body` keeps that flattening beside it: an index and a search
    // want words, not markup.
    emailHtml: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
    // An outbound attachment from the library. Same fields the inbound path
    // uses, so the thread renders both directions without knowing which is
    // which — and the type travels with the row rather than being re-guessed
    // from an extensionless storage URL every time a bubble paints.
    mediaStorageId: v.optional(v.id("_storage")),
    mediaContentType: v.optional(v.string()),
    // Documents only. It is the name the CUSTOMER sees on their phone, so it
    // carries its extension; an image needs none.
    mediaFileName: v.optional(v.string()),
    // Which number this goes out on. Unset = cloud.
    lane: v.optional(v.union(v.literal("cloud"), v.literal("evolution"))),
    // Email open tracking (winback + campaign mail only): the pixel token and
    // the template row whose counters this send feeds.
    trackingToken: v.optional(v.string()),
    templateId: v.optional(v.id("waTemplates")),
    // Quote-reply (2026-08-31): the same snapshot shape the inbound path
    // stores when a CUSTOMER swipe-replies, so the thread renders both
    // directions with one block. The caller (wa.sendSession) resolved the
    // quoted row and only passes these when the provider send will actually
    // carry the context — a quote the customer never sees must not render.
    replyToWamid: v.optional(v.string()),
    replyToBody: v.optional(v.string()),
    replyToDirection: v.optional(v.union(v.literal("in"), v.literal("out"))),
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
      emailHtml: args.emailHtml,
      scheduledFor: args.scheduledFor,
      mediaStorageId: args.mediaStorageId,
      mediaContentType: args.mediaContentType,
      mediaFileName: args.mediaFileName,
      lane: args.lane,
      trackingToken: args.trackingToken,
      templateId: args.templateId,
      ...(args.replyToWamid ? { replyToWamid: args.replyToWamid } : {}),
      ...(args.replyToBody !== undefined ? { replyToBody: args.replyToBody } : {}),
      ...(args.replyToDirection ? { replyToDirection: args.replyToDirection } : {}),
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
        sentAt: Date.now(),
      });
      // The fleet table's channel counters, on the same ledger row the voice
      // and LLM meters use. Here for exactly the reason the open-rate counter
      // below is here: one feeding site, and a row reaches this branch at most
      // once, so retries cannot inflate it.
      await recordSendUsage(ctx, message);
      // A human answered this thread by hand, and it landed — so the
      // assistant's pending draft for it is a proposal about a message that
      // has been dealt with. Retiring it here rather than at the start of the
      // send is the whole point: this branch means the customer actually
      // received something, so a refused or failed send leaves the draft
      // where it is. "session" is the composer's own kind; the assistant's
      // live replies are "chat_agent" and must not retire themselves.
      if (message.kind === "session" && message.customerId) {
        await supersedePendingSuggestions(ctx, message.customerId);
      }
      // The denominator of the template's open rate. Bumped HERE because this
      // is the one place every send path already reports, so the counter has a
      // single feeding site and cannot drift between the send path and the
      // retry queue. A row reaches this branch at most once — on the attempt
      // that landed — so one message is one count regardless of retries.
      if (message.kind.startsWith("email_") && message.templateId) {
        const template = await ctx.db.get(message.templateId);
        if (template) {
          await ctx.db.patch(template._id, {
            emailSentCount: (template.emailSentCount ?? 0) + 1,
            // "Sent 3× · last Aug 2" in the editor, answered without a scan.
            emailLastSentAt: Date.now(),
          });
        }
      }
      // A bulk run's item is resolved HERE rather than when its row was
      // enqueued, because a queued row is not a sent one and a run whose
      // progress bar filled at fan-out would be lying for the next four
      // hours. Same transaction as the patch above, the applyWalletDebit
      // rule: a crash between the two would leave the run's counters
      // describing a world that never existed. No-ops for every row that
      // carries no bulkRunId, which is nearly all of them.
      await noteBulkItemResult(ctx, message, true);
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
    // Terminal, so the run may count it. Deliberately NOT in the retry branch
    // above: a row still owed an attempt has not failed yet, and telling the
    // run otherwise would finish it while messages were still going out.
    await noteBulkItemResult(ctx, { ...message, error: args.error }, false);
    return null;
  },
});

// Resolve an open-pixel hit (GET /e/o/<token>, convex/http.ts) to its message
// row. Every hit bumps openCount; openedAt is first-open-wins, and the first
// open feeds the template's denormalised open counter. Hits inside the first
// 15s after dispatch are dropped — that is a relay prefetching the image
// (Apple MPP, corporate scanners), not a human reading the mail. Ported from
// Nudge's recordEmailOpen.
export const recordEmailOpen = internalMutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db
      .query("messages")
      .withIndex("by_tracking_token", (q) => q.eq("trackingToken", args.token))
      .first();
    if (!message || message.direction !== "out" || !message.kind.startsWith("email_")) {
      return null;
    }
    const now = Date.now();
    const sentAt = message.sentAt ?? message.sendingAt ?? message._creationTime;
    if (now - sentAt < 15_000) return null;
    const firstOpen = message.openedAt === undefined;
    await ctx.db.patch(message._id, {
      openedAt: message.openedAt ?? now,
      openCount: (message.openCount ?? 0) + 1,
    });
    if (firstOpen && message.templateId) {
      const template = await ctx.db.get(message.templateId);
      if (template) {
        await ctx.db.patch(template._id, {
          emailOpenCount: (template.emailOpenCount ?? 0) + 1,
        });
      }
    }
    return null;
  },
});

// Plain helpers for webhook.ts — it's already a mutation, so these run inside
// its transaction rather than as separate internal mutations.

// Delivery receipts matched by Meta's message id. Unknown wamids drop
// silently (receipts for messages we didn't log).
export async function applyWamidStatus(
  ctx: MutationCtx,
  // The tenant the webhook resolved. Taken because the caller had it and dropped
  // it: this looked the message up by wamid ALONE and patched whatever it found,
  // so a statuses[] entry routed to org A carrying a wamid stored on org B's
  // message rewrote org B's delivery record — and a "failed" one fed org B's
  // send-failure alerting. Its sibling four lines away in the same handler does
  // check (`appointment.orgId !== orgId`); this one had the value in scope and
  // never compared it.
  orgId: Id<"orgs">,
  wamid: string,
  status: string,
  error?: string,
) {
  const message = await ctx.db
    .query("messages")
    .withIndex("by_wamid", (q) => q.eq("wamid", wamid))
    .unique();
  if (!message || message.orgId !== orgId) return;
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
    // Set when the message carried an attachment. The row lands immediately
    // with the caption and a pending flag; the bytes follow from an action,
    // because a mutation cannot reach Meta.
    mediaPending?: boolean;
    // What Meta said the attachment IS, recorded at arrival rather than at
    // download. A download that fails then still leaves a row that knows a
    // voice note was sent, instead of a blank one.
    mediaContentType?: string;
    mediaFileName?: string;
    // Which lane carried it. Unset = cloud.
    lane?: "cloud" | "evolution";
    // The quoted message, when this reply was a WhatsApp swipe-reply. The
    // caller resolved the snapshot (webhook.ts); this just records it.
    replyToWamid?: string;
    replyToBody?: string;
    replyToDirection?: "in" | "out";
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
    ...(args.mediaContentType ? { mediaContentType: args.mediaContentType } : {}),
    ...(args.mediaFileName ? { mediaFileName: args.mediaFileName } : {}),
    ...(args.replyToWamid ? { replyToWamid: args.replyToWamid } : {}),
    ...(args.replyToBody !== undefined ? { replyToBody: args.replyToBody } : {}),
    ...(args.replyToDirection ? { replyToDirection: args.replyToDirection } : {}),
  });
}

// The file, once the action has it. Clears the pending flag in the same write,
// so a row is never both pending and complete.
export const attachMedia = internalMutation({
  args: {
    messageId: v.id("messages"),
    storageId: v.optional(v.id("_storage")),
    // Meta's media LOOKUP is more authoritative than the webhook's summary,
    // so a type that arrives here wins over the one recorded at arrival.
    // Optional because a failed download has nothing better to offer and must
    // not erase what the webhook already told us.
    contentType: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      mediaStorageId: args.storageId,
      mediaPending: undefined,
      ...(args.contentType ? { mediaContentType: args.contentType } : {}),
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
  // What the agent collected on the call, and why the call ended. The contact
  // feed's expanded call column shows exactly what Voice → Calls shows; a
  // person who opened a call to find out what was said should not have to
  // learn which of two screens carries the answer.
  collected: v.optional(v.record(v.string(), v.any())),
  disconnectionReason: v.optional(v.string()),
  // Email-only. A subject is the one thing an email has that a WhatsApp
  // message doesn't, and it is what the reader scans first.
  emailSubject: v.optional(v.string()),
  emailHtml: v.optional(v.string()),
  // A signed URL for the stored file, minted per read. The storage id itself
  // never reaches the client — it is a handle to a file, and a URL is what a
  // browser can actually render.
  mediaUrl: v.optional(v.string()),
  mediaPending: v.optional(v.boolean()),
  // What the file IS, which decides whether the bubble paints a picture,
  // draws a player, or offers a chip to open. Carried even when mediaUrl is
  // absent: a download that failed still knows a voice note was sent, and
  // saying so beats an empty bubble.
  mediaContentType: v.optional(v.string()),
  mediaFileName: v.optional(v.string()),
  // The emoji reacted to this message. Whose it is follows from direction —
  // on our outbound row it is the customer's, on their inbound row it is ours.
  reactionEmoji: v.optional(v.string()),
  // The quoted message, when this was a WhatsApp swipe-reply. Snapshot
  // fields (schema note) so the bubble can draw the quote without a lookup.
  replyToBody: v.optional(v.string()),
  replyToDirection: v.optional(v.union(v.literal("in"), v.literal("out"))),
  // Whether the row can BE quoted (it has a provider wamid to hand back).
  // A boolean, not the wamid itself: the id is a provider handle the client
  // has no business holding.
  canQuote: v.optional(v.boolean()),
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
    // Empty, not a throw. customers.get and inboxPin already answer an id
    // from another org this way, and this query used to be the outlier: a
    // customerId can go stale WHILE a subscription is open, because the
    // workspace switcher changes the org under a contact page that is holding
    // one in React state. The next consistent snapshot then asks this org
    // about the previous org's customer, and a throw from a live query with
    // no error boundary above it takes down the whole app rather than the one
    // pane that asked. Nothing crosses the boundary either way.
    if (!customer || customer.orgId !== orgId) return [];

    const messages = (
      await ctx.db
        .query("messages")
        .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
        .order("desc")
        .take(200)
    ).filter((m) => !neverLeftSilently(m));
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
      // Skipped, not looked up: an author-less note is one the CUSTOMER left
      // through the booking page, and there is no user row to read.
      if (!authorId) continue;
      const author = await ctx.db.get(authorId);
      authors.set(authorId, author?.name ?? author?.email ?? undefined);
    }
    // Their own name, not "System". The note is in this customer's feed and
    // came out of this customer's booking, so naming them is both the honest
    // attribution and the one that tells a reader why the wording is theirs.
    const customerName =
      `${customer.firstName} ${customer.lastName ?? ""}`.trim() || undefined;

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
        at: m.occurredAt ?? m._creationTime,
        direction: m.direction,
        kind: m.kind,
        body: m.body,
        status: m.status,
        error: m.error,
        emailSubject: m.emailSubject,
        emailHtml: m.emailHtml,
        mediaUrl: mediaUrls.get(m._id as string),
        mediaPending: m.mediaPending,
        mediaContentType: m.mediaContentType,
        mediaFileName: m.mediaFileName,
        reactionEmoji: m.reactionEmoji,
        replyToBody: m.replyToBody,
        replyToDirection: m.replyToDirection,
        canQuote: m.wamid !== undefined ? true : undefined,
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
        collected: c.collected,
        disconnectionReason: c.disconnectionReason,
      })),
      ...notes.map((n) => ({
        id: n._id as string,
        channel: "note" as const,
        at: n._creationTime,
        kind: "note",
        body: n.body,
        authorName: n.authorId ? authors.get(n.authorId) : customerName,
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
  // The messages or calls row this entry came from, stringified — the same id
  // feedForCustomer hands the contact feed, which is what lets the inbox open
  // the exact mail or call a row is previewing instead of the channel's list.
  id: string;
  // The inbox list's own strip, which answers "how can I reach this person" —
  // so a form intake counts as one more thing that happened, not as a way
  // back to them. Narrowed at the push below.
  channel: Channel | "form";
  at: number;
  direction: "in" | "out";
  body?: string;
  // What the attachment IS, when the entry has one. Carried so a preview can
  // say "Voice message" for a row whose whole content is a recording — with
  // no body at all such a row previewed as "template message", which named
  // the one thing it definitely was not.
  mediaContentType?: string;
  mediaFileName?: string;
  failed: boolean;
};

// The expensive half: one window over messages and calls, grouped by customer.
// Nothing from the customers table is touched here.
// A row that never left the building because this customer has no consent.
//
// The failed row used to be written and shown on the reasoning that a
// per-customer refusal belongs in that customer's thread rather than in the
// owner's inbox at 06:00. Half of that still holds — it must not alert — but
// the thread was the wrong home for it. Consent is one fact, and it is already
// on the card as a toggle you can see and flip; the thread turned it into a
// red row per reminder per customer, forever, in a surface whose job is to
// show what a customer was actually told. Nothing was told. Nothing shows.
//
// Sibling case, deliberately left alone for now: `no-email-address`, which is
// the same kind of fact and gets the same treatment the day it is as visible
// on the card as consent is.
function neverLeftSilently(message: { status: string; error?: string }): boolean {
  return message.status === "failed" && message.error === "no-consent";
}

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
    if (neverLeftSilently(m)) continue;
    push(m.customerId, {
      id: m._id,
      channel: channelOfMessage(m.kind),
      at: m.occurredAt ?? m._creationTime,
      direction: m.direction,
      body: m.body,
      mediaContentType: m.mediaContentType,
      mediaFileName: m.mediaFileName,
      failed: m.status === "failed",
    });
  }
  for (const c of calls) {
    push(c.customerId, {
      id: c._id,
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
  // Newest entry in each direction, 0 when there is none. The inbox row's
  // marker is decided entirely by these two: an inbound newer than my last
  // visit is what "they wrote while I was away" means, and a pin is spent the
  // moment an outbound lands after it. Derived here rather than stored on the
  // customer, because the entries are already loaded and already sorted.
  lastInboundAt: number;
  lastOutboundAt: number;
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
    // Already sorted newest-first, so the first match in each direction is the
    // newest one.
    lastInboundAt: entries.find((e) => e.direction === "in")?.at ?? 0,
    lastOutboundAt: entries.find((e) => e.direction === "out")?.at ?? 0,
  };
}

// The sidebar's Inbox dot: mail that arrived since I last had the tab OPEN.
//
// It reads inboxSeenAt, while the grey row markers read inboxLeftAt, and the
// two are deliberately different clocks. The sidebar dot means "there is
// something new in there" and must go out the moment you look; the row markers
// mean "this arrived while you were away" and must survive the visit that
// shows them. One stamp for both jobs makes opening the Inbox erase the very
// thing it was opened to show.
// ONE RULE, TWO READERS: this counts exactly what `conversations` marks
// unseen, over the same set of rows, so the sidebar can never dot something
// the tab cannot show.
export const inboxUnseenCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const { user, orgId } = await requireOrg(ctx);
    const visit = await inboxVisit(ctx, orgId, user._id);
    const floor = inboxReadFloor(visit, user);
    const byCustomer = await conversationEntries(ctx, orgId);
    let count = 0;
    for (const [customerId, entries] of byCustomer) {
      const { lastInboundAt } = summariseEntries(entries);
      // The floor settles most rows for free; only the ones that clear it are
      // worth a point lookup. Nothing inbound can ever be new.
      if (lastInboundAt <= floor) continue;
      const customer = await ctx.db.get(customerId as Id<"customers">);
      if (!customer) continue;
      // A muted customer is not in the inbox at all, so counting them here
      // would leave a badge pointing at rows that aren't there.
      if (customer.mutedAt) continue;
      const readAt = await inboxReadAt(
        ctx,
        orgId,
        user._id,
        customerId as Id<"customers">,
      );
      if (lastInboundAt > readAt) count += 1;
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

// ---- Inbox row markers: grey is objective, green is mine ----
//
// Ported from Nudge, whose shared dot failed the same way this one did. The
// model is two independent marks sharing one hit area:
//
//   GREY  they wrote while I was away. Objective, automatic, and it clears
//         itself when I leave the tab — so it is never a backlog to work
//         through by hand, and it never asks a colleague to care.
//   GREEN I pinned this. Manual, sticky, mine alone, and spent the moment
//         somebody replies, so answering a thread clears its pin without any
//         send path knowing pins exist.
//
// The old shared dot (attentionClearedAt, still on the customer and still read
// by the Customers table) put both jobs on one stamp and made dismissing a row
// an edit to everyone else's screen.

// This person's visit boundaries for THIS workspace, or null before their
// first visit. Keyed by org + user rather than hung off `memberships`, because
// a platform operator has no membership row — see the inboxVisits comment in
// schema.ts. Read-only now: the stamps are the frozen floor described there.
async function inboxVisit(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("inboxVisits")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .unique();
}

// ---- Unread: ONE definition, read by the rows and the sidebar dot alike ----
//
// A conversation is NEW when its latest inbound is newer than the moment I
// last OPENED it. Per (org, user, conversation): visiting the tab, leaving the
// tab, and a colleague's reading all leave it alone.
//
// The floor is what keeps the day-one backlog dark. Whatever the retired
// visit boundary last reached, or the user's own creation time for anyone who
// never had one — an inbound older than that counts as read, so nobody was
// handed their whole history in green the day this shipped.
function inboxReadFloor(
  visit: { seenAt?: number; leftAt?: number } | null,
  user: Doc<"users">,
): number {
  return Math.max(visit?.leftAt ?? 0, visit?.seenAt ?? 0, user._creationTime);
}

// Point lookup, deliberately, rather than reading this user's read-set whole:
// the cost is then bounded by the conversation window forever, instead of
// growing with every conversation they have ever opened.
async function inboxReadAt(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">,
  userId: Id<"users">,
  customerId: Id<"customers">,
): Promise<number> {
  const row = await ctx.db
    .query("inboxReads")
    .withIndex("by_org_user_customer", (q) =>
      q.eq("orgId", orgId).eq("userId", userId).eq("customerId", customerId),
    )
    .unique();
  return row?.readAt ?? 0;
}

// Stamp "I opened this conversation". Called when the user CLICKS a row, and
// again if a reply lands while they are sitting in that conversation — a
// message read in front of somebody must not re-light behind their back.
// Monotonic, so a re-render storm costs no writes.
//
// Deliberately NOT called when the Inbox restores a selection on arrival:
// that is the view filling its right-hand pane, not a person choosing to read
// something, and letting it stamp would put back "opening the tab clears it"
// in a smaller disguise.
export const markConversationRead = mutation({
  args: { customerId: v.id("customers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) return null;
    const now = Date.now();
    const existing = await ctx.db
      .query("inboxReads")
      .withIndex("by_org_user_customer", (q) =>
        q
          .eq("orgId", orgId)
          .eq("userId", user._id)
          .eq("customerId", args.customerId),
      )
      .unique();
    if (existing) {
      if (existing.readAt >= now) return null;
      await ctx.db.patch(existing._id, { readAt: now });
    } else {
      await ctx.db.insert("inboxReads", {
        orgId,
        userId: user._id,
        customerId: args.customerId,
        readAt: now,
      });
    }
    return null;
  },
});

// The inbox menu's "mark all as read": every conversation MY list currently
// shows as unseen gets its read stamp, in one stroke. It recomputes unseen the
// way `conversations` does — same floor, same point lookup, muted rows skipped
// — because stamping rows the list never showed would spend writes on nothing
// and, worse, quietly pre-read a conversation that gets unmuted later. Writes
// stay bounded by what was actually unread, not by the size of the inbox.
export const markAllConversationsRead = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { user, orgId } = await requireOrg(ctx);
    const byCustomer = await conversationEntries(ctx, orgId);
    const visit = await inboxVisit(ctx, orgId, user._id);
    const readFloor = inboxReadFloor(visit, user);
    const now = Date.now();
    for (const [customerId, entries] of byCustomer) {
      const customer = await ctx.db.get(customerId as Id<"customers">);
      if (!customer || customer.mutedAt) continue;
      const summary = summariseEntries(entries);
      if (summary.lastInboundAt <= readFloor) continue;
      const existing = await ctx.db
        .query("inboxReads")
        .withIndex("by_org_user_customer", (q) =>
          q
            .eq("orgId", orgId)
            .eq("userId", user._id)
            .eq("customerId", customer._id),
        )
        .unique();
      if (existing) {
        // Already read (and so not in the unseen set): leave the stamp alone.
        if (existing.readAt >= summary.lastInboundAt) continue;
        await ctx.db.patch(existing._id, { readAt: now });
      } else {
        await ctx.db.insert("inboxReads", {
          orgId,
          userId: user._id,
          customerId: customer._id,
          readAt: now,
        });
      }
    }
    return null;
  },
});

// Is this one conversation pinned for me? The inbox list gets this for free
// inside `conversations`; the contact record needs it for a single customer,
// because the pin toggle now sits beside that person's name.
//
// It pays for the whole org's entries to answer about one row, and that is
// deliberate: the SPENT rule (a pin older than the newest outbound has been
// paid) lives in summariseEntries, and a cheaper read that skipped it would
// let the record page show a pin the inbox had already retired. Two surfaces
// disagreeing about one pin is worse than a read the record page makes once.
export const inboxPin = query({
  args: { customerId: v.id("customers") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) return false;
    const pin = await ctx.db
      .query("inboxPins")
      .withIndex("by_org_user_customer", (q) =>
        q
          .eq("orgId", orgId)
          .eq("userId", user._id)
          .eq("customerId", args.customerId),
      )
      .unique();
    // No row is the common case and it settles without touching the feed.
    if (!pin) return false;
    const byCustomer = await conversationEntries(ctx, orgId);
    const entries = byCustomer.get(args.customerId);
    return pin.pinnedAt > (entries ? summariseEntries(entries).lastOutboundAt : 0);
  },
});

// Pin or unpin, for me. Unpinning deletes; re-pinning an existing pin refreshes
// the stamp, which is what un-spends a pin that an outbound message has since
// overtaken.
export const setInboxPin = mutation({
  args: { customerId: v.id("customers"), pinned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    const existing = await ctx.db
      .query("inboxPins")
      .withIndex("by_org_user_customer", (q) =>
        q
          .eq("orgId", orgId)
          .eq("userId", user._id)
          .eq("customerId", args.customerId),
      )
      .unique();
    if (args.pinned) {
      if (existing) await ctx.db.patch(existing._id, { pinnedAt: Date.now() });
      else
        await ctx.db.insert("inboxPins", {
          orgId,
          userId: user._id,
          customerId: args.customerId,
          pinnedAt: Date.now(),
        });
    } else if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

// markInboxSeen / markInboxLeft used to live here and are deliberately gone:
// they wrote the visit boundary, and that boundary is a frozen floor now (see
// schema.ts inboxVisits). Reading a conversation is markConversationRead, and
// nothing else marks anything read.

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
      // Set when the previewed row's content is an attachment. The LABEL is
      // the client's to write — it is one of three words and they have to be
      // in the reader's language, which the dictionary in src/lib/i18n.ts owns.
      lastMediaContentType: v.optional(v.string()),
      lastMediaFileName: v.optional(v.string()),
      lastDirection: v.union(v.literal("out"), v.literal("in")),
      // The last thing that HAPPENED, which can be a form arrival. Distinct
      // from awaitingChannels below, which is only ever real channels because
      // it answers "where do I reply".
      lastChannel: feedChannel,
      // Which mail or call the preview above is quoting. The row opens the
      // contact ON it — see InboxView — so that clicking a line of an email
      // lands in that email rather than in a list of six the reader now has to
      // recognise it in.
      lastId: v.string(),
      // Did the message the preview is QUOTING fail. Not "did anything in this
      // conversation ever fail", which is what the row used to draw and which
      // put a red "not sent" next to inbound lines the customer had written —
      // the failure it described was some older send, invisible on the row.
      // The conversation-wide answer still exists as summary.hasFailed and
      // still feeds attentionAt; it is just not a thing to label one line with.
      lastFailed: v.boolean(),
      awaitingReply: v.boolean(),
      // Newest inbound, 0 when they have never written. The row does not draw
      // it; the view watches it so that mail landing while the Inbox is open
      // re-stamps inboxSeenAt instead of re-lighting the sidebar dot behind
      // the reader's back.
      lastInboundAt: v.number(),
      // They wrote since I last OPENED this conversation. It makes no claim
      // about whether anyone answered, only that I have not looked.
      unseen: v.boolean(),
      // I pinned this conversation. Manual, sticky, and mine alone.
      pinned: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const { user, orgId } = await requireOrg(ctx);
    const byCustomer = await conversationEntries(ctx, orgId);
    const visit = await inboxVisit(ctx, orgId, user._id);
    const readFloor = inboxReadFloor(visit, user);
    // Read whole: unpinning deletes, so this holds only live pins.
    const pins = await ctx.db
      .query("inboxPins")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", orgId).eq("userId", user._id),
      )
      .collect();
    const pinnedAtByCustomer = new Map(
      pins.map((p) => [p.customerId as string, p.pinnedAt]),
    );

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
      // NEW = they wrote since I last opened THIS conversation. Floored, so a
      // conversation nobody ever opened is only new if it moved after the
      // baseline. The floor test is free and short-circuits the point lookup,
      // so only rows that clear it cost a read.
      const unseen =
        summary.lastInboundAt > readFloor &&
        summary.lastInboundAt >
          (await inboxReadAt(ctx, orgId, user._id, customer._id));
      out.push({
        customerId: customer._id,
        name: `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
        phone: customer.phone,
        email: customer.email,
        lastAt: summary.last.at,
        lastBody: summary.last.body,
        lastMediaContentType: summary.last.mediaContentType,
        lastMediaFileName: summary.last.mediaFileName,
        lastDirection: summary.last.direction,
        lastChannel: summary.last.channel,
        lastId: summary.last.id,
        lastFailed: summary.last.failed,
        awaitingReply: summary.awaitingChannels.length > 0,
        lastInboundAt: summary.lastInboundAt,
        unseen,
        // A pin older than the newest outbound is SPENT: you pinned the debt
        // and then paid it. That is how replying clears a pin without the send
        // path ever hearing about pins.
        pinned: (pinnedAtByCustomer.get(customer._id) ?? 0) > summary.lastOutboundAt,
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
