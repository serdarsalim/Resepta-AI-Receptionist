import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { customerSearchText, foldSearch, syncCustomerSearch } from "./lib/customerSearch";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { assertE164, requireOrg, requireOwner } from "./lib/orgAuth";
import { normalisePhone } from "./lib/phone";
import { recordActivity } from "./lib/activity";
import { recordCustomerCreated } from "./lib/newCustomer";
import { summariseThread, threadValidator } from "./lib/thread";
import { retryConfirmationsAwaitingEmail } from "./appointments";
import { isDeleting } from "./lib/customerDeletion";
import {
  beginCustomerDeletion,
  customerFootprint,
  footprintValidator,
} from "./customerDeletion";

// The languages a person may set on a customer: the ones Resepta writes
// customer messages in (lib/textLanguage learns only these too).
const CUSTOMER_LANGUAGES = new Set(["tr", "en", "de"]);

// The row as stored. Built from a plain field map so the list validator can
// extend it by one key without a second copy of nineteen columns drifting from
// this one.
const customerFields = {
  _id: v.id("customers"),
  _creationTime: v.number(),
  orgId: v.id("orgs"),
  firstName: v.string(),
  lastName: v.optional(v.string()),
  phone: v.string(),
  email: v.optional(v.string()),
  language: v.optional(v.string()),
  // Learned from the customer's own reply or call (schema customers.languageLearnedAt).
  languageLearnedAt: v.optional(v.number()),
  notes: v.optional(v.string()),
  // Dead since 2026-10-21 (schema customers.consentAt), still on older rows.
  consentAt: v.optional(v.number()),
  lastInboundAt: v.optional(v.number()),
  custom: v.optional(v.record(v.string(), v.string())),
  // The "For next time" note (schema customers.nextTimeNote, nextTimeNotes.ts).
  nextTimeNote: v.optional(v.string()),
  // When someone last cleared this customer's dot in the inbox. Convex
  // validates RETURNS as strictly as arguments, so a column added to the
  // schema and not added here makes every read of the table throw.
  attentionClearedAt: v.optional(v.number()),
  arrivedAt: v.optional(v.number()),
  mutedAt: v.optional(v.number()),
  // Asked not to be called by the AI (schema customers.noAiCallsAt).
  noAiCallsAt: v.optional(v.number()),
  // Unsubscribed from marketing, every channel (schema customers.marketingEmailOptOutAt).
  marketingEmailOptOutAt: v.optional(v.number()),
  // Chat-agent takeover stamp (docs/chat-agent.md §5) — when a human took
  // this conversation over. Display only now; agentModeOverride decides.
  agentPausedAt: v.optional(v.number()),
  // This conversation's own answer to off/suggest/live, when it disagrees
  // with the business default, and the agent's "needs a person" flag.
  agentModeOverride: v.optional(
    v.union(v.literal("off"), v.literal("suggest"), v.literal("live")),
  ),
  agentFlaggedAt: v.optional(v.number()),
  // The assistants' daily change cap counter (schema customers.agentChangesAt).
  agentChangesAt: v.optional(v.array(v.number())),
  agentTurnScheduledFor: v.optional(v.id("messages")),
  // The three columns the warning above is about, found MISSING while adding
  // agentPausedAt: each is stamped by the message lanes (webhook.ts, wa.ts),
  // so a customer who wrote in or got an away-reply made every raw-doc read
  // here fail validation.
  lastInboundLane: v.optional(v.union(v.literal("cloud"), v.literal("evolution"))),
  lastAutoReplyAt: v.optional(v.number()),
  lastEmailAutoReplyAt: v.optional(v.number()),
  // And it HAPPENED AGAIN with read receipts (2026-08-26): the blue-tick
  // high-water mark reached the schema without reaching this mirror, so the
  // first customer whose thread was read with receipts live — one row in
  // prod — crashed `get` and `list` for everyone who opened him. The
  // validator throw took the whole tab down, which is how a one-field drift
  // presented as "the app crashes on this person's profile".
  lastReadReceiptWamid: v.optional(v.string()),
  // The conversation summary the write paths keep (lib/thread.ts). Read here
  // for the dot; the inbox reads it through its own indexes.
  thread: v.optional(threadValidator),
  // The deletion mark (schema customers.deletingAt). Every read here drops a
  // row that carries it, so these never reach a client; declared anyway,
  // because a column the schema has and this mirror lacks is the read that
  // throws (see above).
  deletingAt: v.optional(v.number()),
  deletingPhone: v.optional(v.string()),
  // The opener's two clocks (P34, schema customers.lastConversationAt), found
  // missing by the guard below on the day it was added: the first answered
  // call after the deploy would have taken this customer's reads down.
  lastConversationAt: v.optional(v.number()),
  lastCallAttemptAt: v.optional(v.number()),
};

// Columns a row deliberately never carries to a client. `searchText` is the
// search index's folded copy of name, address, phone and email (P13): the
// server reads it, the screen never needs it, and it is long.
type OmittedFromRow = "searchText";

// The drift guard. Every column the schema gives a customer is mirrored in
// customerFields or named in OmittedFromRow, or this line fails the typecheck
// and names the column. Without it the miss surfaced in production as
// "Value does not match validator" on every read of the table: four times,
// the last on 2026-10-21, when the searchText backfill filled the column on
// prod and both the Customers list and the record page went down.
type UnmirroredCustomerColumn = Exclude<
  keyof Doc<"customers">,
  keyof typeof customerFields | OmittedFromRow
>;
const _everyCustomerColumnMirrored: [UnmirroredCustomerColumn] extends [never]
  ? true
  : UnmirroredCustomerColumn = true;
void _everyCustomerColumnMirrored;

// The row the list and the record page return: the document minus what a
// client never gets, plus the dot.
function toCustomerRow(customer: Doc<"customers">) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { searchText, ...row } = customer;
  return { ...row, needsAttention: resolveAttention(customer) };
}

// The row plus the dot, which both the list and the record page carry.
const customerRow = v.object({
  ...customerFields,
  // Resolved server-side rather than shipped as three raw timestamps for the
  // table to compare: the inbox already decides this exact question, and two
  // places deciding it independently is how one dot becomes two answers.
  needsAttention: v.boolean(),
});

// ONE dot, one meaning: nobody has looked at this person yet. It lights for an
// unread message — the same arithmetic the inbox runs, imported rather than
// reimplemented — and for somebody who arrived through the door on their own.
// The second half is not redundant: a voice booking creates a customer and no
// message at all, so an inbox-only dot leaves the arrivals most worth noticing
// invisible everywhere.
function resolveAttention(customer: Doc<"customers">): boolean {
  // Mute answers first, and answers for every caller: the table, the record
  // page, and anything else that ever asks. A muted customer cannot light the
  // dot, which is the whole of what mute means.
  if (customer.mutedAt) return false;
  // From the row's own summary, so the Contacts table costs the customers it
  // shows and nothing more. It used to scan the org's 700 newest messages
  // and calls per execution to answer this for each row.
  const messageAttentionAt = customer.thread
    ? summariseThread(customer.thread).attentionAt
    : 0;
  const wants = Math.max(messageAttentionAt, customer.arrivedAt ?? 0);
  return wants > 0 && wants > (customer.attentionClearedAt ?? 0);
}

export const get = query({
  args: { customerId: v.id("customers") },
  returns: v.union(customerRow, v.null()),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    // A customer being deleted is already gone as far as any screen is
    // concerned: the row is blank and a sweep is emptying it out.
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
    // The record page carries the dot too, so it has to answer the same
    // question the table does — and answer it the same way, through
    // resolveAttention, rather than by looking at two of the three timestamps
    // and guessing at the third.
    return toCustomerRow(customer);
  },
});

// Contact data is daily staff work — org-scoped, not owner-gated.
export const setCustomValue = mutation({
  args: { customerId: v.id("customers"), key: v.string(), value: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      throw new Error("not-found");
    }
    const custom = { ...(customer.custom ?? {}) };
    if (args.value.trim()) custom[args.key] = args.value.trim();
    else delete custom[args.key];
    await ctx.db.patch(args.customerId, { custom });
    return null;
  },
});

// The header's jump list (CustomerJump): enough of a match to pick a person,
// nothing more. Same fold as the table's own search (useTableState.foldSearch
// — İ/ı and ß included, "gul" finds "Gül"), so the box and the jump list
// never disagree about who matches. Collect-and-filter like everything else
// at salon scale; take 8 keeps it a picker rather than a result page.
export const quickSearch = query({
  args: { q: v.string() },
  returns: v.array(
    v.object({
      id: v.id("customers"),
      name: v.string(),
      phone: v.string(),
    }),
  ),
  // Off the search index since P13 (lib/customerSearch): it used to read the
  // whole book and filter in JavaScript on every keystroke. A search reads
  // only matches now, in relevance order, matching words by their start (the
  // last word as you type it), so "ayse yil" finds Ayşe Yılmaz and "0532"
  // finds her number.
  handler: async (ctx, { q }) => {
    const { orgId } = await requireOrg(ctx);
    const needle = foldSearch(q.trim());
    // Below two characters most of the book matches and the list is noise.
    // The component applies the same floor; this one holds if it ever slips.
    if (needle.length < 2) return [];
    const rows = await ctx.db
      .query("customers")
      .withSearchIndex("search_text", (index) =>
        index.search("searchText", needle).eq("orgId", orgId),
      )
      .take(16);
    const out: Array<{ id: Doc<"customers">["_id"]; name: string; phone: string }> = [];
    for (const c of rows) {
      if (isDeleting(c)) continue;
      out.push({
        id: c._id,
        name: `${c.firstName} ${c.lastName ?? ""}`.trim(),
        phone: c.phone,
      });
      if (out.length >= 8) break;
    }
    return out;
  },
});

// The repair for the search text (lib/customerSearch): every customer's
// recomputed, a page at a time, rescheduling itself until done. Idempotent,
// so run it after a deploy that adds the field, or whenever a write path is
// found to have skipped syncCustomerSearch:
//   npx convex run customers:backfillSearch '{}'
export const backfillSearch = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ patched: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("customers")
      .paginate({ cursor: cursor ?? null, numItems: 200 });
    let patched = 0;
    for (const customer of page.page) {
      const next =
        customer.deletingAt !== undefined ? undefined : customerSearchText(customer);
      if (customer.searchText !== next) {
        await ctx.db.patch(customer._id, { searchText: next });
        patched += 1;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.customers.backfillSearch, {
        cursor: page.continueCursor,
      });
    }
    return { patched, isDone: page.isDone };
  },
});

// The Customers table, a page at a time (P13 of the Nudge port). It used to
// be one take of the newest 1,000, so the 1,001st customer was not in the
// table, its counts, its select-all or its export, and one subscription
// re-read the whole thousand on every write to any of them. The table now
// loads pages of 500 in the background up to a soft cap (CustomersView), and
// each page re-runs alone when one of its own customers changes.
//
// mutedAt ships raw and the table decides where muted rows land: the table
// re-sorts what it has loaded by whichever column is active, so a server-side
// order would be thrown away on arrival. One place decides, and it is the
// sort. A customer being deleted is dropped from its page, which may then
// come back short; a page's length is not a promise.
export const listPage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(customerRow),
  handler: async (ctx, { paginationOpts }) => {
    const { orgId } = await requireOrg(ctx);
    const result = await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page
        .filter((row) => !isDeleting(row))
        .map(toCustomerRow),
    };
  },
});

// Name and number, nothing else, for the booking sheet's customer picker:
// it answers "who is this" and no more. A search since P13, over the
// customers search index (lib/customerSearch), so it reaches every customer
// and not only the newest 1,000 the old roster read whole and filtered in the
// browser. Relevance order, eight at most: past that the answer is to type
// another letter.
export const pickerSearch = query({
  args: { q: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("customers"),
      firstName: v.string(),
      lastName: v.optional(v.string()),
      phone: v.string(),
    }),
  ),
  handler: async (ctx, { q }) => {
    const { orgId } = await requireOrg(ctx);
    const needle = foldSearch(q.trim());
    if (!needle) return [];
    const rows = await ctx.db
      .query("customers")
      .withSearchIndex("search_text", (index) =>
        index.search("searchText", needle).eq("orgId", orgId),
      )
      .take(12);
    return rows
      .filter((row) => !isDeleting(row))
      .slice(0, 8)
      .map((row) => ({
        _id: row._id,
        firstName: row.firstName,
        lastName: row.lastName,
        phone: row.phone,
      }));
  },
});

export const create = mutation({
  args: {
    firstName: v.string(),
    lastName: v.optional(v.string()),
    phone: v.string(),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Ignored since 2026-10-21, when consent stopped gating sends. Accepted
    // so a tab loaded before that deploy can still add a customer; drop it
    // once no client sends it.
    consent: v.optional(v.boolean()),
  },
  returns: v.id("customers"),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const firstName = args.firstName.trim();
    if (!firstName) throw new Error("first-name-required");
    const phone = assertE164(args.phone);
    const dupe = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
      .unique();
    if (dupe) throw new Error("phone-exists");
    const customerId = await ctx.db.insert("customers", {
      orgId,
      firstName,
      lastName: args.lastName?.trim() || undefined,
      phone,
      email: args.email?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
    });
    await syncCustomerSearch(ctx, customerId);
    await recordCustomerCreated(ctx, { orgId, customerId, source: "staff" });
    return customerId;
  },
});

export const update = mutation({
  args: {
    customerId: v.id("customers"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Ignored since 2026-10-21, like create's: the record's Consent switch
    // that sent it is gone, and a tab loaded before then must not fail.
    consent: v.optional(v.boolean()),
    // "" goes back to the business's language; otherwise one of the three
    // languages Resepta writes to customers in.
    language: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      throw new Error("not-found");
    }
    const patch: Record<string, unknown> = {};
    if (args.firstName !== undefined && args.firstName.trim()) {
      patch.firstName = args.firstName.trim();
    }
    if (args.lastName !== undefined) patch.lastName = args.lastName.trim() || undefined;
    if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined;
    if (args.email !== undefined) patch.email = args.email.trim() || undefined;
    if (args.phone !== undefined) {
      const phone = assertE164(args.phone);
      if (phone !== customer.phone) {
        const dupe = await ctx.db
          .query("customers")
          .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
          .unique();
        if (dupe) throw new Error("phone-exists");
        patch.phone = phone;
      }
    }
    if (args.language !== undefined) {
      const language = args.language.trim();
      if (language && !CUSTOMER_LANGUAGES.has(language)) throw new Error("invalid-language");
      // A person's choice, so no longer learned (lib/customerLanguage): a
      // later reply never replaces it. Back to "" makes it a guess again.
      patch.language = language || undefined;
      patch.languageLearnedAt = undefined;
    }
    await ctx.db.patch(args.customerId, patch);
    await syncCustomerSearch(ctx, args.customerId);
    // Staff typing in a missing email repays the same debt the voice path
    // does: a confirmation that failed no-email-address is re-fired for
    // future bookings the moment the address exists.
    if (typeof patch.email === "string" && !customer.email) {
      await retryConfirmationsAwaitingEmail(ctx, args.customerId);
    }
    return null;
  },
});

// Mute / unmute. Deliberately its own mutation rather than a flag on update():
// update() is the identity form saving a batch of edited fields, and mute is a
// switch somebody flips on its own and expects to take effect immediately.
// Folding it in would also mean every save of a phone number had to have an
// opinion about mute.
export const setMuted = mutation({
  args: { customerId: v.id("customers"), muted: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      throw new Error("not-found");
    }
    await ctx.db.patch(args.customerId, {
      mutedAt: args.muted ? Date.now() : undefined,
    });
    return null;
  },
});

// "No AI calls" (schema customers.noAiCallsAt), the record's switch. Any member,
// like mute: whoever heard the customer say it on the phone or on WhatsApp is
// the one who records it, and it is still the customer's own request. Both
// directions are a person's; the phone agent can only ever set it
// (retell.markNoAiCallsFromCall). Its own mutation for setMuted's reason.
export const setNoAiCalls = mutation({
  args: { customerId: v.id("customers"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      throw new Error("not-found");
    }
    // Turning it on keeps the first moment it was asked.
    await ctx.db.patch(args.customerId, {
      noAiCallsAt: args.on ? (customer.noAiCallsAt ?? Date.now()) : undefined,
    });
    return null;
  },
});

// The marketing opt-out (schema customers.marketingEmailOptOutAt, every
// channel since 2026-10-21: lib/marketing), the record's Unsubscribe switch.
// The customer's own unsubscribe link sets it too
// (messages.unsubscribeByToken). Any member: whoever hears "stop
// sending me offers" at the counter records it, and the same person can put
// back what a customer asks to have back. The record's switch asks before
// turning it off; this records who did either, because "who put this person
// back on the marketing list?" is exactly the question the feed is for.
export const setMarketingEmailOptOut = mutation({
  args: { customerId: v.id("customers"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
      throw new Error("not-found");
    }
    const was = customer.marketingEmailOptOutAt !== undefined;
    if (was === args.on) return null;
    await ctx.db.patch(args.customerId, {
      marketingEmailOptOutAt: args.on ? Date.now() : undefined,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "customer_updated",
      customerId: args.customerId,
      // Field names only, so the line survives a later deletion of the
      // customer (customerDeletion's STRUCTURAL_DETAIL).
      detail: args.on ? "marketingEmailOptOut" : "marketingEmailOptOut cleared",
    });
    return null;
  },
});

// Whether a number about to be dialled by the AI belongs to a customer of this
// business who asked not to be (customers.noAiCallsAt). Read by
// retellAgent.testCall, the one door where a person places an AI call by hand,
// before anything reaches the provider; that door then needs the person to say
// "call anyway". The org comes from the agent the action already resolved,
// never from the caller.
export const noAiCallsForNumber = internalQuery({
  args: { orgId: v.id("orgs"), phone: v.string() },
  returns: v.union(v.object({ name: v.string() }), v.null()),
  handler: async (ctx, { orgId, phone }) => {
    const e164 = normalisePhone(phone);
    if (!e164) return null;
    // take, not unique: a number filed twice by some old path must not turn
    // this check into an error at the moment somebody presses Call.
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", e164))
      .take(5);
    const asked = rows.find(
      (row) => row.orgId === orgId && !isDeleting(row) && row.noAiCallsAt !== undefined,
    );
    return asked ? { name: `${asked.firstName} ${asked.lastName ?? ""}`.trim() } : null;
  },
});

// What deleting this customer would remove, per kind: the counts the customer
// page's delete sheet shows before anything goes, from the same FOOTPRINT list
// the sweep empties (customerDeletion.ts), so what the owner is shown is what
// goes. Owner-only like the delete itself; anyone else gets null, which the
// sheet never asks for because the menu that opens it is not drawn for them.
//
// Subscribed only while the sheet is open. Its read set is the customer's
// whole history (capped per kind), so a live subscription re-runs on every
// message they send, which is the point while the owner is deciding and a
// waste the rest of the time.
export const deletionPreview = query({
  args: { customerId: v.id("customers") },
  returns: v.union(
    v.object({ name: v.string(), footprint: footprintValidator }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const { orgId, role } = await requireOrg(ctx);
    if (role !== "owner") return null;
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
    return {
      name: `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
      footprint: await customerFootprint(ctx, customer),
    };
  },
});

// Deletes the customer and everything held on them (customerDeletion.ts):
// gone from every screen in this commit, every queued send cancelled, the
// rest swept in the background. Nothing is sent to them about it.
//
// Owners only, since 2026-10-13 (it was any member). Staff edit customers all
// day, but erasing one is a KVKK decision that takes the business's own
// history with it and cannot be undone, so it belongs to whoever answers for
// the business. Every other deletion door checks the same (AGENTS.md,
// "Deleting a customer deletes them"). The activity feed records who did it,
// and never whom.
export const remove = mutation({
  args: { customerId: v.id("customers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    // A second press while the first is being swept changes nothing.
    if (isDeleting(customer)) return null;
    await beginCustomerDeletion(ctx, customer);
    return null;
  },
});
