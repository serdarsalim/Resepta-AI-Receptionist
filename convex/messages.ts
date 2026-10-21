import { v, type Infer } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { foldSearch } from "./lib/customerSearch";
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
import { isDeleting } from "./lib/customerDeletion";
import { isMarketingEmailKind } from "./lib/email";
import { recordActivity } from "./lib/activity";
import { buttonsFor, buttonLabelsFor } from "./lib/metaTemplate";
import { alertFailedSend } from "./lib/alerts";
import { classifyFailure, nextAttemptDelay } from "./lib/sendFailure";
import { recordSendUsage } from "./lib/usage";
import { supersedePendingSuggestions } from "./lib/agentDrafts";
import { noteBulkItemResult } from "./bulkRuns";
import { memberPhoto } from "./lib/memberPhoto";
import { callVerdict } from "./schema";
import {
  channel,
  channelOfMessage,
  neverLeftSilently,
  noteMessageById,
  recomputeThread,
  summariseThread,
  type Channel,
} from "./lib/thread";

// The channel helpers moved to lib/thread.ts (a leaf the summary writers can
// import). Re-exported so agentReports and friends keep importing from here.
export { channel, channelOfMessage, type Channel } from "./lib/thread";

const messageStatus = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("received"),
);

// The Inbox list has no cap of its own since P13: it reads pages of 50
// (inboxPage). It used to stop at the 200 newest conversations.
// How many candidate conversations the unread badge (and mark-all-read) will
// consider. Only customers whose newest inbound clears the read floor are in
// the range at all, so on any normal day this is a handful of rows.
const UNSEEN_CAP = 500;


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
    // The quick-reply labels as the customer will see them (schema note).
    buttonLabels: v.optional(v.array(v.string())),
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
    // Every send path logs its row HERE before it reaches a provider, so this
    // is the one place a send to a customer who is being deleted (or is gone)
    // can be stopped whatever loaded it. Each path's own context query
    // already returns nothing for such a customer; this catches the race
    // where it loaded first. Throwing stops the action before the POST, and a
    // row inserted now would outlive the sweep that is removing theirs.
    const customer = await ctx.db.get(args.customerId);
    if (!customer || isDeleting(customer)) throw new Error("customer-deleted");
    const id = await ctx.db.insert("messages", {
      orgId: args.orgId,
      customerId: args.customerId,
      appointmentId: args.appointmentId,
      direction: "out",
      kind: args.kind,
      templateName: args.templateName,
      templateParams: args.templateParams,
      buttonLabels: args.buttonLabels,
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
    await noteMessageById(ctx, id);
    return id;
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
    // The failure changes what the inbox row says (and a no-consent refusal
    // removes the entry from the thread altogether), so the summary is
    // rebuilt. The sent branch above does not need this: a queued row is
    // already counted as an outbound entry the moment it is inserted.
    if (message.customerId) await recomputeThread(ctx, message.customerId);

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

// ── Marketing-mail unsubscribe (GET and POST /e/u/<token>, convex/http.ts) ──
//
// The token is the message row's trackingToken, the same opaque per-message
// token the open pixel uses (Nudge's design). It resolves to exactly one
// business and one customer: the row's org, and the row's customer, checked to
// belong to that same org before anything is read off it or written to it.
// Every business sends from one shared domain, so this check, not the URL, is
// what keeps one business's link from touching another's customer.
//
// Only a MARKETING mail's token works (lib/email isMarketingEmailKind): those
// are the only mails that carry the link. A confirmation's token sits in plain
// sight in its open-pixel URL, and must not be a way to unsubscribe anybody.
async function unsubscribeTarget(
  ctx: QueryCtx,
  token: string,
): Promise<{ customer: Doc<"customers">; org: Doc<"orgs"> } | null> {
  const message = await ctx.db
    .query("messages")
    .withIndex("by_tracking_token", (q) => q.eq("trackingToken", token))
    .first();
  if (
    !message ||
    message.direction !== "out" ||
    !isMarketingEmailKind(message.kind) ||
    !message.customerId
  ) {
    return null;
  }
  const [customer, org] = await Promise.all([
    ctx.db.get(message.customerId),
    ctx.db.get(message.orgId),
  ]);
  if (!customer || !org || customer.orgId !== message.orgId || isDeleting(customer)) {
    return null;
  }
  return { customer, org };
}

const unsubscribeAnswer = v.union(
  v.object({
    business: v.string(),
    language: v.string(),
    unsubscribed: v.boolean(),
  }),
  v.null(),
);

// The GET: what the page should say, changing nothing. Link scanners and mail
// previews follow GETs, and none of them is the customer deciding.
export const unsubscribeContext = internalQuery({
  args: { token: v.string() },
  returns: unsubscribeAnswer,
  handler: async (ctx, { token }) => {
    const target = await unsubscribeTarget(ctx, token);
    if (!target) return null;
    return {
      business: target.org.name,
      language: target.customer.language ?? target.org.language,
      unsubscribed: target.customer.marketingEmailOptOutAt !== undefined,
    };
  },
});

// The POST: the page's button, or the mail client's one-click (RFC 8058).
// Idempotent; the first moment is kept. Unknown tokens answer null and the
// page says the link no longer works. One activity row, by the system, so the
// business can see when it happened and that nobody on the team did it.
export const unsubscribeByToken = internalMutation({
  args: { token: v.string() },
  returns: unsubscribeAnswer,
  handler: async (ctx, { token }) => {
    const target = await unsubscribeTarget(ctx, token);
    if (!target) return null;
    const { customer, org } = target;
    if (customer.marketingEmailOptOutAt === undefined) {
      await ctx.db.patch(customer._id, { marketingEmailOptOutAt: Date.now() });
      await recordActivity(ctx, {
        orgId: org._id,
        kind: "customer_updated",
        customerId: customer._id,
        detail: "marketingEmailOptOut",
        system: true,
      });
    }
    return {
      business: org.name,
      language: customer.language ?? org.language,
      unsubscribed: true,
    };
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
    // delivered/read change nothing the summary shows; a failure does.
    if (message.customerId) await recomputeThread(ctx, message.customerId);
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
  const id = await ctx.db.insert("messages", {
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
  await noteMessageById(ctx, id);
  return id;
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
    const message = await ctx.db.get(args.messageId);
    const customer = message?.customerId ? await ctx.db.get(message.customerId) : null;
    if (!message || (customer !== null && isDeleting(customer))) {
      // The download outlived the row it was for: the customer was deleted
      // while the file was on its way. Stored now, it would be a blob nothing
      // points at, holding their photo or voice note after their record went.
      if (args.storageId) await ctx.storage.delete(args.storageId);
      return null;
    }
    await ctx.db.patch(args.messageId, {
      mediaStorageId: args.storageId,
      mediaPending: undefined,
      ...(args.contentType ? { mediaContentType: args.contentType } : {}),
    });
    // The row may be the one the inbox previews, and the type decides whether
    // that preview says "Photo" or "Voice message".
    if (message.customerId) await recomputeThread(ctx, message.customerId);
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

// `channel`, `Channel` and channelOfMessage are defined in lib/thread.ts and
// re-exported at the top of this file.

// Where a row came from. `form` is an INTAKE, not a channel: somebody filled
// in a page, which is not something the salon can reach them back on. It
// therefore lives here and in feedChannel, never in the `channel` union that
// the inbox's "reachable on" strip reads — same rule as notes.
export type FeedSource = Channel | "form" | "note";

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
  // Call-only (P11): who placed it (a team member's name), the bulk run it
  // came from, and the appointment it booked, so the card says what the call
  // set in motion without a second screen.
  placedBy: v.optional(v.string()),
  bulkRun: v.optional(v.string()),
  booked: v.optional(
    v.object({ at: v.number(), services: v.array(v.string()), cancelled: v.boolean() }),
  ),
  // Call-only (P36): on the call where they asked to be rung back, when that
  // callback rings; on the call that kept the promise, true.
  callbackRequestedFor: v.optional(v.number()),
  requestedCallback: v.optional(v.boolean()),
  // Call-only: who was on the line, for the card's "Ayşe → Bella". The agent
  // by the name the business knows it by (this org's retellAgents row only),
  // and the customer's number as the call carried it, which names a caller
  // nobody has typed a name for yet.
  agentName: v.optional(v.string()),
  customerNumber: v.optional(v.string()),
  // Call-only (2026-10-21): the team's review of the call (calls.setReview),
  // signed by who wrote it first and, when someone else changed it since, by
  // who did.
  note: v.optional(v.string()),
  verdict: v.optional(callVerdict),
  noteBy: v.optional(v.string()),
  noteEditedBy: v.optional(v.string()),
  noteAt: v.optional(v.number()),
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
  // Whether a reaction to this row can reach the customer: their own message,
  // with a provider id, on the Cloud lane (the shop phone keeps no message key
  // to react with, wa.reactToMessage). The bubble's React and its menu offer
  // it only then, rather than offering it and answering with a refusal.
  canReact: v.optional(v.boolean()),
  // Set while a send is waiting for its moment. The bubble counts down to it
  // and can be cancelled until the cron picks it up.
  scheduledFor: v.optional(v.number()),
  // The quick-reply labels this send put under the customer's copy of the
  // message (confirm first, cancel second — the payload order wa.ts sends and
  // webhook.ts parses back). In the CUSTOMER's language, not the panel's:
  // these are the words that were actually on their screen, and translating
  // them for the salon would show buttons the customer never saw. Present
  // only on cloud template rows whose kind attaches buttons; the panel draws
  // them under the bubble the way WhatsApp itself does.
  buttons: v.optional(v.array(v.string())),
  // Note-only.
  authorName: v.optional(v.string()),
  // The writer's face (lib/memberPhoto: their upload in this business, else
  // Google's picture). Absent for the customer's own booking-page note and a
  // member with no picture, which draw initials.
  authorPhoto: v.optional(v.string()),
  editedAt: v.optional(v.number()),
});

// A call's review as its card shows it (calls.setReview): the words, the
// verdict and the signature. "Edited by" only when the last writer is not the
// first, and nothing at all for a review holding neither words nor verdict.
function reviewOfCall(
  c: Doc<"calls">,
  names: Map<string, string | undefined>,
): {
  note?: string;
  verdict?: Doc<"calls">["verdict"];
  noteBy?: string;
  noteEditedBy?: string;
  noteAt?: number;
} {
  if (!c.note && !c.verdict) return {};
  const by = c.noteCreatedBy ? names.get(c.noteCreatedBy) : undefined;
  const editedBy =
    c.noteUpdatedBy && c.noteUpdatedBy !== c.noteCreatedBy
      ? names.get(c.noteUpdatedBy)
      : undefined;
  return {
    ...(c.note ? { note: c.note } : {}),
    ...(c.verdict ? { verdict: c.verdict } : {}),
    ...(by ? { noteBy: by } : {}),
    ...(editedBy ? { noteEditedBy: editedBy } : {}),
    ...(c.noteUpdatedAt !== undefined ? { noteAt: c.noteUpdatedAt } : {}),
  };
}

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
    // pane that asked. Nothing crosses the boundary either way. A customer
    // being deleted reads the same way: their thread is being emptied.
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return [];

    // Fallback labels for rows that predate buttonLabels (stamped at send
    // since 2026-09-01), resolved the way those sends resolved their language
    // (wa.ts: customer.language ?? org.language). Only history reads this —
    // every new send stores the words it actually put on the customer's
    // screen.
    const org = await ctx.db.get(orgId);
    const legacyQuickReplyLabels = buttonLabelsFor(
      customer.language ?? org?.language ?? "en",
    );

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
    // Who signs each call's review, and the agent each call spoke to, read
    // once per distinct person and agent before the per-call reads below.
    const reviewerNames = new Map<string, string | undefined>();
    for (const userId of new Set(
      calls.flatMap((c) =>
        [c.noteCreatedBy, c.noteUpdatedBy].filter((id): id is Id<"users"> => !!id),
      ),
    )) {
      const user = await ctx.db.get(userId);
      reviewerNames.set(userId, user?.name ?? user?.email ?? undefined);
    }
    const agentNames = new Map<string, string | undefined>();
    for (const retellAgentId of new Set(
      calls.flatMap((c) => (c.retellAgentId ? [c.retellAgentId] : [])),
    )) {
      const agent = await ctx.db
        .query("retellAgents")
        .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
        .first();
      // This org's agent only. The provider account is shared, so a name is
      // read only off a row that proves the agent is this business's.
      agentNames.set(
        retellAgentId,
        agent && agent.orgId === orgId
          ? agent.name?.trim() || agent.personaName?.trim() || undefined
          : undefined,
      );
    }
    // What each call set in motion, read per call and only where the row
    // points somewhere: the placer (a member's name, once per person), the
    // bulk run that dialled it (bulkRunItems by call id, this org's only),
    // the appointment it booked (this org's, with its services).
    const placerNames = new Map<string, string | undefined>();
    const callExtras = await Promise.all(
      calls.map(async (c) => {
        let placedBy: string | undefined;
        if (c.placedByUserId) {
          const key = c.placedByUserId as string;
          if (!placerNames.has(key)) {
            const user = await ctx.db.get(c.placedByUserId);
            placerNames.set(key, user?.name ?? user?.email ?? undefined);
          }
          placedBy = placerNames.get(key);
        }
        let bulkRun: string | undefined;
        if (c.direction === "outbound" && c.retellCallId) {
          const item = await ctx.db
            .query("bulkRunItems")
            .withIndex("by_retell_call", (q) => q.eq("retellCallId", c.retellCallId))
            .first();
          if (item && item.orgId === c.orgId) {
            const run = await ctx.db.get(item.runId);
            if (run && run.orgId === c.orgId) bulkRun = run.label;
          }
        }
        let booked: { at: number; services: string[]; cancelled: boolean } | undefined;
        if (c.appointmentId) {
          const appointment = await ctx.db.get(c.appointmentId);
          if (appointment && appointment.orgId === c.orgId) {
            booked = {
              at: appointment.startAt,
              services: (appointment.items ?? []).map((line) => line.name),
              cancelled: appointment.status === "cancelled",
            };
          }
        }
        return { call: c, placedBy, bulkRun, booked };
      }),
    );
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(200);

    // Authors resolved once per distinct writer, not once per note: a salon
    // owner who left forty notes on a regular is one read, not forty.
    const authors = new Map<string, string | undefined>();
    const authorPhotos = new Map<string, string>();
    for (const authorId of new Set(notes.map((n) => n.authorId))) {
      // Skipped, not looked up: an author-less note is one the CUSTOMER left
      // through the booking page, and there is no user row to read.
      if (!authorId) continue;
      const author = await ctx.db.get(authorId);
      authors.set(authorId, author?.name ?? author?.email ?? undefined);
      const photo = await memberPhoto(ctx, orgId, author);
      if (photo) authorPhotos.set(authorId, photo);
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
        canReact:
          m.direction === "in" && m.wamid !== undefined && m.lane !== "evolution"
            ? true
            : undefined,
        scheduledFor: m.scheduledFor,
        // The stamp when the row carries one; the derivation only for rows
        // that predate it. templateName is the proof a Cloud template
        // actually went out — Evolution and freeform session sends never set
        // it (Evolution gets the typed reply hint appended to its body
        // instead of buttons). The stored kind can carry an offset suffix
        // ("reminder_24h"); buttonsFor speaks base kinds.
        buttons:
          m.buttonLabels ??
          (m.direction === "out" &&
          m.templateName !== undefined &&
          m.lane !== "evolution" &&
          buttonsFor(m.kind.replace(/_\d+h$/, ""))
            ? legacyQuickReplyLabels
            : undefined),
      })),
      ...callExtras.map(({ call: c, placedBy, bulkRun, booked }) => ({
        id: c._id as string,
        ...(placedBy ? { placedBy } : {}),
        ...(bulkRun ? { bulkRun } : {}),
        ...(booked ? { booked } : {}),
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
        ...(c.callbackRequestedFor !== undefined
          ? { callbackRequestedFor: c.callbackRequestedFor }
          : {}),
        ...(c.requestedCallback ? { requestedCallback: true } : {}),
        ...reviewOfCall(c, reviewerNames),
        ...(c.retellAgentId && agentNames.get(c.retellAgentId)
          ? { agentName: agentNames.get(c.retellAgentId) }
          : {}),
        ...(c.fromNumber ? { customerNumber: c.fromNumber } : {}),
      })),
      ...notes.map((n) => ({
        id: n._id as string,
        channel: "note" as const,
        at: n._creationTime,
        kind: "note",
        body: n.body,
        authorName: n.authorId ? authors.get(n.authorId) : customerName,
        ...(n.authorId && authorPhotos.has(n.authorId)
          ? { authorPhoto: authorPhotos.get(n.authorId) }
          : {}),
        editedAt: n.editedAt,
      })),
    ];
    return items.sort((a, b) => b.at - a.at);
  },
});

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
    // Only customers whose newest inbound clears the floor — an index range
    // over the summary, not a scan of the org's messages. This subscription
    // is open in the shell for as long as the app is, so what it reads is what
    // every message write in the org costs every open client. It used to be
    // 700 rows, with email bodies and call transcripts on them.
    const candidates = await ctx.db
      .query("customers")
      .withIndex("by_org_thread_inbound", (q) =>
        q.eq("orgId", orgId).gt("thread.lastInboundAt", floor),
      )
      .take(UNSEEN_CAP);
    const forced = await forcedUnreadCustomers(ctx, orgId, user._id);
    let count = 0;
    for (const customer of candidates) {
      const lastInboundAt = customer.thread?.lastInboundAt ?? 0;
      // A muted customer is not in the inbox at all, so counting them here
      // would leave a badge pointing at rows that aren't there.
      if (customer.mutedAt) continue;
      if (forced.has(customer._id)) {
        count += 1;
        continue;
      }
      const readAt = await inboxReadAt(ctx, orgId, user._id, customer._id);
      if (lastInboundAt > readAt) count += 1;
    }
    // Marked unread by hand below the floor: the Unread view lists them, so
    // the dot counts them too.
    for (const customerId of forced) {
      const customer = await ctx.db.get(customerId);
      if (listable(customer, orgId) && belowFloor(customer, floor)) count += 1;
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
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      throw new Error("not-found");
    }
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
//   GREEN I pinned this. Manual, sticky, mine alone, and it LASTS until I
//         unpin it (P13, Nudge 0e23423f). It used to be spent by the next
//         outbound, and every outbound counts: a reminder or an away-reply
//         going out unpinned a conversation nobody had answered.
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

// The conversations this person marked unread by hand (markConversationUnread).
// A handful of rows on their own index, read whole: every unread reader unions
// them in, because they read as unread even below the read floor, where the
// range scans never look (P21, Nudge 2a94bb92).
async function forcedUnreadCustomers(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">,
  userId: Id<"users">,
): Promise<Set<Id<"customers">>> {
  const rows = await ctx.db
    .query("inboxReads")
    .withIndex("by_org_user_unread", (q) =>
      q.eq("orgId", orgId).eq("userId", userId).gt("unreadAt", 0),
    )
    .collect();
  return new Set(rows.map((r) => r.customerId));
}

// A marked-unread customer the range scans cannot reach: their newest inbound
// sits at or below the floor (or they never wrote). Still in the Inbox, so
// still unread, and every count has to add them by hand.
function belowFloor(customer: Doc<"customers">, readFloor: number): boolean {
  return (customer.thread?.lastInboundAt ?? 0) <= readFloor;
}

// Is this customer a row the Inbox can show at all, for this org?
function listable(customer: Doc<"customers"> | null, orgId: Id<"orgs">): customer is Doc<"customers"> {
  return (
    !!customer &&
    customer.orgId === orgId &&
    !!customer.thread &&
    !customer.mutedAt &&
    !isDeleting(customer)
  );
}

// "I read this conversation": readAt moves to now and any "marked unread"
// goes. The ONE writer every read path goes through, so none of them can
// leave the mark lit. Monotonic, so a re-render storm costs no writes.
async function stampConversationRead(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  userId: Id<"users">,
  customerId: Id<"customers">,
  now: number,
) {
  const existing = await ctx.db
    .query("inboxReads")
    .withIndex("by_org_user_customer", (q) =>
      q.eq("orgId", orgId).eq("userId", userId).eq("customerId", customerId),
    )
    .unique();
  if (existing) {
    if (existing.readAt >= now && existing.unreadAt === undefined) return;
    await ctx.db.patch(existing._id, {
      readAt: Math.max(existing.readAt, now),
      unreadAt: undefined,
    });
  } else {
    await ctx.db.insert("inboxReads", { orgId, userId, customerId, readAt: now });
  }
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
    // No read mark for a customer being deleted: the sweep removes theirs,
    // and one written after it passed would outlive the customer.
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
    await stampConversationRead(ctx, orgId, user._id, args.customerId, Date.now());
    return null;
  },
});

// "Mark as unread" on ONE conversation, the Inbox row menu (P21, Nudge
// 2a94bb92). Sets inboxReads.unreadAt, which every unread reader checks AHEAD
// of the read floor; readAt is left alone, and any read path clears the mark.
// Per person, like the read stamp: marking a conversation unread for myself
// changes nobody else's Inbox.
export const markConversationUnread = mutation({
  args: { customerId: v.id("customers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    // The markConversationRead reason: nothing written for a customer being
    // deleted would outlive the sweep.
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
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
      if (existing.unreadAt === undefined) {
        await ctx.db.patch(existing._id, { unreadAt: Date.now() });
      }
    } else {
      await ctx.db.insert("inboxReads", {
        orgId,
        userId: user._id,
        customerId: args.customerId,
        readAt: 0,
        unreadAt: Date.now(),
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
    const visit = await inboxVisit(ctx, orgId, user._id);
    const readFloor = inboxReadFloor(visit, user);
    const now = Date.now();
    // The same range the badge counts, so this clears exactly what it shows.
    const candidates = await ctx.db
      .query("customers")
      .withIndex("by_org_thread_inbound", (q) =>
        q.eq("orgId", orgId).gt("thread.lastInboundAt", readFloor),
      )
      .take(UNSEEN_CAP);
    const forced = await forcedUnreadCustomers(ctx, orgId, user._id);
    for (const customer of candidates) {
      if (customer.mutedAt) continue;
      const lastInboundAt = customer.thread?.lastInboundAt ?? 0;
      // Already read (and so not in the unseen set) and not marked unread:
      // leave the stamp alone.
      if (
        !forced.has(customer._id) &&
        (await inboxReadAt(ctx, orgId, user._id, customer._id)) >= lastInboundAt
      ) {
        continue;
      }
      forced.delete(customer._id);
      await stampConversationRead(ctx, orgId, user._id, customer._id, now);
    }
    // Marked-unread conversations the range above never reaches (below the
    // floor): cleared too, or "all" would leave them lit.
    for (const customerId of forced) {
      await stampConversationRead(ctx, orgId, user._id, customerId, now);
    }
    return null;
  },
});

// Is this one conversation pinned for me? The inbox list gets this for free
// inside `conversations`; the contact record needs it for a single customer,
// because the pin toggle now sits beside that person's name.
//
// One rule for both surfaces since P13: a pin row is a pin, until unpinned.
export const inboxPin = query({
  args: { customerId: v.id("customers") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return false;
    const pin = await ctx.db
      .query("inboxPins")
      .withIndex("by_org_user_customer", (q) =>
        q
          .eq("orgId", orgId)
          .eq("userId", user._id)
          .eq("customerId", args.customerId),
      )
      .unique();
    // A pin lasts until it is unpinned (P13): no comparison with what was
    // sent since, which is the inbox list's rule too.
    return pin !== null;
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
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      throw new Error("not-found");
    }
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
// One Inbox row, shared by every way the Inbox reads (P13).
const conversationRow = v.object({
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
    });
type ConversationRow = Infer<typeof conversationRow>;

// Who is reading, and what decides their row marks: the read floor and their
// pins. Pins are read whole: unpinning deletes, so this holds only live pins.
async function inboxReader(ctx: QueryCtx) {
  const { user, orgId } = await requireOrg(ctx);
  const visit = await inboxVisit(ctx, orgId, user._id);
  const readFloor = inboxReadFloor(visit, user);
  const pins = await ctx.db
    .query("inboxPins")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", user._id))
    .collect();
  const pinned = new Set(pins.map((p) => p.customerId as string));
  const forcedUnread = await forcedUnreadCustomers(ctx, orgId, user._id);
  return { user, orgId, readFloor, pinned, pins, forcedUnread };
}

// A customer's Inbox row, or null when they have no conversation, are muted
// (muted contacts leave the inbox entirely; the conversation stays whole on
// the record) or are being deleted.
async function conversationRowOf(
  ctx: QueryCtx,
  reader: Awaited<ReturnType<typeof inboxReader>>,
  customer: Doc<"customers">,
): Promise<ConversationRow | null> {
  const thread = customer.thread;
  if (!thread || customer.mutedAt || isDeleting(customer)) return null;
  if (customer.orgId !== reader.orgId) return null;
  const { awaitingChannels } = summariseThread(thread);
  // NEW = they wrote since I last opened THIS conversation. Floored, so a
  // conversation nobody ever opened is only new if it moved after the
  // baseline. The floor test is free and short-circuits the point lookup,
  // so only rows that clear it cost a read.
  // Marked unread by hand wins over the floor and the stamp alike.
  const unseen =
    reader.forcedUnread.has(customer._id) ||
    (thread.lastInboundAt > reader.readFloor &&
      thread.lastInboundAt >
        (await inboxReadAt(ctx, reader.orgId, reader.user._id, customer._id)));
  return {
    customerId: customer._id,
    name: `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
    phone: customer.phone,
    email: customer.email,
    lastAt: thread.lastAt,
    lastBody: thread.lastBody,
    lastMediaContentType: thread.lastMediaContentType,
    lastMediaFileName: thread.lastMediaFileName,
    lastDirection: thread.lastDirection,
    lastChannel: thread.lastChannel,
    lastId: thread.lastId,
    lastFailed: thread.lastFailed,
    awaitingReply: awaitingChannels.length > 0,
    lastInboundAt: thread.lastInboundAt,
    unseen,
    // A pin lasts until it is unpinned (P13, Nudge 0e23423f).
    pinned: reader.pinned.has(customer._id),
  };
}

// The Inbox, a page at a time (P13, Nudge's listInboxPage). It used to read
// the 200 newest conversations and filter, count and search them in the
// browser, so the 201st was unreachable and every chip counted only the
// first 200. Each view now reads its own index range off the customer rows'
// summaries (customers.thread, lib/thread):
//   all    — by_org_thread_last, newest activity first;
//   unread — by_org_thread_inbound above my read floor, newest inbound first
//            (only rows past the floor can be new, so the range ends there);
//   pinned — my pin rows, newest activity first, in one page.
// A page can come back shorter than asked (a muted or opened row is dropped
// after the read); the cursor still moves on, and the list asks again.
export const inboxPage = query({
  args: {
    view: v.union(v.literal("all"), v.literal("unread"), v.literal("pinned")),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(conversationRow),
  handler: async (ctx, { view, paginationOpts }) => {
    const reader = await inboxReader(ctx);
    if (view === "pinned") {
      const rows: ConversationRow[] = [];
      for (const pin of reader.pins) {
        const customer = await ctx.db.get(pin.customerId);
        const row = customer ? await conversationRowOf(ctx, reader, customer) : null;
        if (row) rows.push(row);
      }
      rows.sort((x, y) => y.lastAt - x.lastAt);
      return { page: rows, isDone: true, continueCursor: "" };
    }
    const result =
      view === "unread"
        ? await ctx.db
            .query("customers")
            .withIndex("by_org_thread_inbound", (q) =>
              q.eq("orgId", reader.orgId).gt("thread.lastInboundAt", reader.readFloor),
            )
            .order("desc")
            .paginate(paginationOpts)
        : await ctx.db
            .query("customers")
            .withIndex("by_org_thread_last", (q) =>
              q.eq("orgId", reader.orgId).gt("thread.lastAt", 0),
            )
            .order("desc")
            .paginate(paginationOpts);
    const page: ConversationRow[] = [];
    for (const customer of result.page) {
      const row = await conversationRowOf(ctx, reader, customer);
      if (!row) continue;
      if (view === "unread" && !row.unseen) continue;
      page.push(row);
    }
    // Conversations marked unread by hand whose newest inbound sits at or
    // below the floor: the range above ends at the floor and never reaches
    // them. Below the floor is below every row the range returns, so they
    // join the LAST page and the order holds.
    if (view === "unread" && result.isDone) {
      const below: ConversationRow[] = [];
      for (const customerId of reader.forcedUnread) {
        const customer = await ctx.db.get(customerId);
        if (!customer || !belowFloor(customer, reader.readFloor)) continue;
        const row = await conversationRowOf(ctx, reader, customer);
        if (row) below.push(row);
      }
      below.sort((x, y) => y.lastInboundAt - x.lastInboundAt || y.lastAt - x.lastAt);
      page.push(...below);
    }
    return { ...result, page };
  },
});

// The chips' numbers, counted on the server so they count everything and not
// only what has loaded. Unread is capped (the badge's own UNSEEN_CAP walk),
// and `unreadCapped` says the number is a floor.
export const inboxCounts = query({
  args: {},
  returns: v.object({ unread: v.number(), unreadCapped: v.boolean(), pinned: v.number() }),
  handler: async (ctx) => {
    const reader = await inboxReader(ctx);
    const candidates = await ctx.db
      .query("customers")
      .withIndex("by_org_thread_inbound", (q) =>
        q.eq("orgId", reader.orgId).gt("thread.lastInboundAt", reader.readFloor),
      )
      .take(UNSEEN_CAP + 1);
    let unread = 0;
    for (const customer of candidates.slice(0, UNSEEN_CAP)) {
      if (customer.mutedAt || isDeleting(customer)) continue;
      if (reader.forcedUnread.has(customer._id)) {
        unread += 1;
        continue;
      }
      const lastInboundAt = customer.thread?.lastInboundAt ?? 0;
      if (lastInboundAt > (await inboxReadAt(ctx, reader.orgId, reader.user._id, customer._id))) {
        unread += 1;
      }
    }
    // Marked unread below the floor: in the Unread view, so in its count.
    for (const customerId of reader.forcedUnread) {
      const customer = await ctx.db.get(customerId);
      if (listable(customer, reader.orgId) && belowFloor(customer, reader.readFloor)) {
        unread += 1;
      }
    }
    let pinned = 0;
    for (const pin of reader.pins) {
      const customer = await ctx.db.get(pin.customerId);
      if (customer?.thread && !customer.mutedAt && !isDeleting(customer)) pinned += 1;
    }
    return { unread, unreadCapped: candidates.length > UNSEEN_CAP, pinned };
  },
});

// The Inbox's search, over every conversation and not only the loaded pages:
// the customers search index (lib/customerSearch), whose text carries the
// name, the address, the phone forms and the latest preview. Relevance
// order; only customers with a conversation.
export const inboxSearch = query({
  args: { q: v.string() },
  returns: v.array(conversationRow),
  handler: async (ctx, { q }) => {
    const reader = await inboxReader(ctx);
    const needle = foldSearch(q.trim());
    if (needle.length < 2) return [];
    const hits = await ctx.db
      .query("customers")
      .withSearchIndex("search_text", (index) =>
        index.search("searchText", needle).eq("orgId", reader.orgId),
      )
      .take(40);
    const out: ConversationRow[] = [];
    for (const customer of hits) {
      const row = await conversationRowOf(ctx, reader, customer);
      if (row) out.push(row);
    }
    return out;
  },
});

// One conversation's row, for the one that is open when it is not on a loaded
// page (a deep scroll, a search since cleared): the right pane must not blank
// because the list moved.
export const inboxConversation = query({
  args: { customerId: v.id("customers") },
  returns: v.union(conversationRow, v.null()),
  handler: async (ctx, { customerId }) => {
    const reader = await inboxReader(ctx);
    const customer = await ctx.db.get(customerId);
    return customer ? await conversationRowOf(ctx, reader, customer) : null;
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
