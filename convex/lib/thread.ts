// The per-customer conversation summary, kept ON the customer row and
// maintained at write time.
//
// Why this exists: the inbox list, the sidebar's unread badge and the
// Contacts table all used to answer "what happened last in this
// conversation" by reading the org's 500 newest messages and 200 newest
// calls and grouping them by customer — on every execution, and the badge's
// subscription is open in the shell for as long as the app is. Every message
// write in the org (a send is three writes, a delivery receipt one or two
// more, a call another handful) re-ran that scan for every open client, and
// the rows it scanned carry email HTML and call transcripts. That one shape
// was 470 MB of the deployment's first 1.14 GB of database bandwidth, with a
// single tester. It is O(clients × writes × rows), which is quadratic in a
// busy day.
//
// Now the summary is a small object on customers.thread, written by whichever
// mutation adds or changes an entry, and the three readers use two indexes
// on it. A live query reads the customers it shows and nothing else.
//
// THE RULE: any mutation that inserts a messages or calls row, or changes a
// row's status to failed, its body, or its media, calls one of the three
// functions at the foot of this file. Inserts call noteMessage / noteCall
// (one read, one fold, one patch). Later changes call recomputeThread, which
// re-reads this customer's recent entries. `threads:backfill` rebuilds every
// row and is safe to run at any time; AGENTS.md carries the same rule under
// "The inbox reads a summary the write paths keep".
//
// This file is a LEAF: it imports only types and validators. messages.ts
// re-exports the channel helpers from here, so nothing changes for the
// modules that already import them from there.

import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isDeleting } from "./customerDeletion";

export const channel = v.union(
  v.literal("whatsapp"),
  v.literal("email"),
  v.literal("call"),
);

export type Channel = "whatsapp" | "email" | "call";

// The email lane logs under `email_<kind>` (see wa.ts) and the form lane under
// `form_<kind>` — the prefix IS the marker. Everything else rode WhatsApp.
export function channelOfMessage(kind: string): Channel | "form" {
  if (kind.startsWith("email_")) return "email";
  if (kind.startsWith("form_")) return "form";
  return "whatsapp";
}

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
export function neverLeftSilently(message: { status: string; error?: string }): boolean {
  // The marketing-email opt-out is the same kind of fact as consent and gets
  // the same treatment: the record shows it, the thread does not repeat it.
  return (
    message.status === "failed" &&
    (message.error === "no-consent" || message.error === "unsubscribed")
  );
}

// One thing that happened in a conversation, reduced to what the summary
// needs to know about it.
export type ThreadEntry = {
  // The messages or calls row, stringified — the same id feedForCustomer
  // hands the contact feed, which is what lets the inbox open the exact mail
  // or call a row is previewing instead of the channel's list.
  id: string;
  // A form intake counts as one more thing that happened, not as a way back
  // to the person, so it can be `last` but never "awaiting".
  channel: Channel | "form";
  at: number;
  direction: "in" | "out";
  body?: string;
  mediaContentType?: string;
  mediaFileName?: string;
  failed: boolean;
};

const latest = v.object({
  at: v.number(),
  direction: v.union(v.literal("in"), v.literal("out")),
});

export const threadValidator = v.object({
  // The newest entry, which is what the inbox row previews.
  lastId: v.string(),
  lastChannel: v.union(channel, v.literal("form")),
  lastAt: v.number(),
  lastDirection: v.union(v.literal("out"), v.literal("in")),
  // Truncated to a preview. The row draws one line and search matches on
  // it; the full body lives on the message.
  lastBody: v.optional(v.string()),
  lastMediaContentType: v.optional(v.string()),
  lastMediaFileName: v.optional(v.string()),
  lastFailed: v.boolean(),
  // Newest entry in each direction, 0 when there is none. An inbound newer
  // than my last visit is what "they wrote while I was away" means; a pin is
  // spent the moment an outbound lands after it.
  lastInboundAt: v.number(),
  lastOutboundAt: v.number(),
  // Newest failed send, 0 when none. Feeds the dot the same way an unanswered
  // inbound does — same clock, so a dismissal can be compared to both.
  lastFailureAt: v.number(),
  // Per channel, only the LATEST entry decides whether the business owes a
  // reply there — an old unanswered message that was since answered on that
  // channel is not still waiting.
  latest: v.object({
    whatsapp: v.optional(latest),
    email: v.optional(latest),
    call: v.optional(latest),
  }),
});

export type Thread = Infer<typeof threadValidator>;

const PREVIEW_CHARS = 240;

// Bounded so that a status change on a chatty customer costs a bounded read.
// The summary only needs the newest entry overall, per direction and per
// channel; a channel whose last activity is further back than this many
// entries is not one anyone is waiting on.
const RECOMPUTE_MESSAGES = 40;
const RECOMPUTE_CALLS = 20;

function preview(body: string | undefined): string | undefined {
  if (body === undefined) return undefined;
  return body.length > PREVIEW_CHARS ? body.slice(0, PREVIEW_CHARS) : body;
}

// `undefined` is not a Convex value. Everything optional is spread in only
// when present, so the stored object and the recomputed one compare equal.
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

export function entryOfMessage(m: Doc<"messages">): ThreadEntry | null {
  if (neverLeftSilently(m)) return null;
  return {
    id: m._id,
    channel: channelOfMessage(m.kind),
    at: m.occurredAt ?? m._creationTime,
    direction: m.direction,
    body: m.body,
    mediaContentType: m.mediaContentType,
    mediaFileName: m.mediaFileName,
    failed: m.status === "failed",
  };
}

export function entryOfCall(c: Doc<"calls">): ThreadEntry {
  return {
    id: c._id,
    channel: "call",
    at: c.startedAt,
    direction: c.direction === "inbound" ? "in" : "out",
    body: c.summary,
    failed: false,
  };
}

// Fold one entry into a summary. Every field is a max over `at`, so the
// result does not depend on the order entries arrive in — which is what lets
// the same function serve both a single new row (noteMessage) and a rebuild
// from the window (recomputeThread) without two definitions to keep aligned.
export function foldEntry(thread: Thread | undefined, e: ThreadEntry): Thread {
  const takesLead = thread === undefined || e.at > thread.lastAt;
  const lead = takesLead
    ? {
        lastId: e.id,
        lastChannel: e.channel,
        lastAt: e.at,
        lastDirection: e.direction,
        lastBody: preview(e.body),
        lastMediaContentType: e.mediaContentType,
        lastMediaFileName: e.mediaFileName,
        lastFailed: e.failed,
      }
    : {
        lastId: thread.lastId,
        lastChannel: thread.lastChannel,
        lastAt: thread.lastAt,
        lastDirection: thread.lastDirection,
        lastBody: thread.lastBody,
        lastMediaContentType: thread.lastMediaContentType,
        lastMediaFileName: thread.lastMediaFileName,
        lastFailed: thread.lastFailed,
      };
  const latestByChannel: Thread["latest"] = { ...(thread?.latest ?? {}) };
  if (e.channel !== "form") {
    const current = latestByChannel[e.channel];
    if (!current || e.at > current.at) {
      latestByChannel[e.channel] = { at: e.at, direction: e.direction };
    }
  }
  return compact({
    ...lead,
    lastInboundAt: Math.max(
      thread?.lastInboundAt ?? 0,
      e.direction === "in" ? e.at : 0,
    ),
    lastOutboundAt: Math.max(
      thread?.lastOutboundAt ?? 0,
      e.direction === "out" ? e.at : 0,
    ),
    lastFailureAt: Math.max(thread?.lastFailureAt ?? 0, e.failed ? e.at : 0),
    latest: compact(latestByChannel),
  });
}

// Everything the readers derive from a summary. Kept here so the inbox list
// and the Contacts dot cannot disagree about what "awaiting" means.
export function summariseThread(thread: Thread): {
  awaitingChannels: Channel[];
  hasFailed: boolean;
  // The newest moment that WANTS attention: an unanswered inbound, or a
  // failed send. Zero when nothing in this conversation asks for a look. A
  // dismissal is compared against this, not against the row's last activity
  // — comparing to activity is what made the dot un-clearable, since any
  // later message, even one the salon itself sent, dragged a months-old
  // failure back into view.
  attentionAt: number;
} {
  const awaitingChannels: Channel[] = [];
  let attentionAt = 0;
  for (const ch of ["whatsapp", "email", "call"] as const) {
    const current = thread.latest[ch];
    if (current?.direction === "in") {
      awaitingChannels.push(ch);
      attentionAt = Math.max(attentionAt, current.at);
    }
  }
  attentionAt = Math.max(attentionAt, thread.lastFailureAt);
  return { awaitingChannels, hasFailed: thread.lastFailureAt > 0, attentionAt };
}

function sameThread(a: Thread | undefined, b: Thread | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.lastId === b.lastId &&
    a.lastChannel === b.lastChannel &&
    a.lastAt === b.lastAt &&
    a.lastDirection === b.lastDirection &&
    a.lastBody === b.lastBody &&
    a.lastMediaContentType === b.lastMediaContentType &&
    a.lastMediaFileName === b.lastMediaFileName &&
    a.lastFailed === b.lastFailed &&
    a.lastInboundAt === b.lastInboundAt &&
    a.lastOutboundAt === b.lastOutboundAt &&
    a.lastFailureAt === b.lastFailureAt &&
    sameLatest(a.latest.whatsapp, b.latest.whatsapp) &&
    sameLatest(a.latest.email, b.latest.email) &&
    sameLatest(a.latest.call, b.latest.call)
  );
}

function sameLatest(
  a: { at: number; direction: string } | undefined,
  b: { at: number; direction: string } | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.at === b.at && a.direction === b.direction;
}

// Written only when something changed. A write that changes nothing would
// still invalidate every subscription holding this customer — the exact cost
// this file exists to remove.
async function writeThread(
  ctx: MutationCtx,
  customer: Doc<"customers">,
  next: Thread | undefined,
): Promise<void> {
  // A customer being deleted had its summary taken off in the same write that
  // marked it, which is what drops it from the inbox and the badge at once. A
  // late send result or call analysis must not put it back, or the inbox
  // lists a blank row until the sweep finishes (lib/customerDeletion).
  if (isDeleting(customer)) return;
  if (sameThread(customer.thread, next)) return;
  await ctx.db.patch(customer._id, { thread: next });
}

// A message row was just inserted. One customer read, one fold, one patch.
export async function noteMessage(ctx: MutationCtx, message: Doc<"messages">): Promise<void> {
  if (!message.customerId) return;
  const entry = entryOfMessage(message);
  if (!entry) return;
  const customer = await ctx.db.get(message.customerId);
  if (!customer) return;
  await writeThread(ctx, customer, foldEntry(customer.thread, entry));
}

export async function noteMessageById(ctx: MutationCtx, id: Id<"messages">): Promise<void> {
  const message = await ctx.db.get(id);
  if (message) await noteMessage(ctx, message);
}

// A calls row was just inserted.
export async function noteCall(ctx: MutationCtx, call: Doc<"calls">): Promise<void> {
  if (!call.customerId) return;
  const customer = await ctx.db.get(call.customerId);
  if (!customer) return;
  await writeThread(ctx, customer, foldEntry(customer.thread, entryOfCall(call)));
}

// An existing entry changed (a send failed, a call got its analysis, an
// attachment landed, a scheduled row was cancelled), or the summary is being
// rebuilt. Re-reads this customer's recent entries and folds them fresh.
export async function recomputeThread(
  ctx: MutationCtx,
  customerId: Id<"customers">,
): Promise<void> {
  const customer = await ctx.db.get(customerId);
  if (!customer) return;
  const [messages, calls] = await Promise.all([
    ctx.db
      .query("messages")
      .withIndex("by_customer", (q) => q.eq("customerId", customerId))
      .order("desc")
      .take(RECOMPUTE_MESSAGES),
    ctx.db
      .query("calls")
      .withIndex("by_customer", (q) => q.eq("customerId", customerId))
      .order("desc")
      .take(RECOMPUTE_CALLS),
  ]);
  let thread: Thread | undefined;
  for (const m of messages) {
    const entry = entryOfMessage(m);
    if (entry) thread = foldEntry(thread, entry);
  }
  for (const c of calls) thread = foldEntry(thread, entryOfCall(c));
  await writeThread(ctx, customer, thread);
}
