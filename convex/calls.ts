// The call history the voice tab reads. Everything here was already captured
// by the post-call webhook — recording, transcript, summary, outcome — and
// then sat invisible in the table while the owner walked to Retell to hear a
// call. This query is the walk removed.
//
// And the team's review of one call (setReview, below).

import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrg } from "./lib/orgAuth";
import { isDeleting } from "./lib/customerDeletion";
import { callVerdict } from "./schema";

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  // Paginated: the page shape is convex's, the items are ours.
  returns: v.any(),
  handler: async (ctx, { paginationOpts }) => {
    const { orgId } = await requireOrg(ctx);
    const result = await ctx.db
      .query("calls")
      .withIndex("by_org_started", (q) => q.eq("orgId", orgId))
      .order("desc")
      .paginate(paginationOpts);

    // Names in one pass; a page of calls from one regular is one read, not 25.
    const customerIds = [
      ...new Set(result.page.flatMap((c) => (c.customerId ? [c.customerId] : []))),
    ];
    const customers = await Promise.all(customerIds.map((id) => ctx.db.get(id)));
    const names = new Map(
      customers.flatMap((c) =>
        c ? [[c._id, `${c.firstName} ${c.lastName ?? ""}`.trim()] as const] : [],
      ),
    );
    // A customer being deleted takes their calls with them; until the sweep
    // reaches these rows they are already off the list.
    const gone = new Set(customers.flatMap((c) => (c && isDeleting(c) ? [c._id] : [])));

    return {
      ...result,
      page: result.page
        .filter((c) => !(c.customerId && gone.has(c.customerId)))
        .map((c) => ({
        _id: c._id,
        startedAt: c.startedAt,
        direction: c.direction,
        fromNumber: c.fromNumber ?? null,
        durationSec: c.durationSec ?? null,
        outcome: c.outcome ?? null,
        summary: c.summary ?? null,
        transcript: c.transcript ?? null,
        recordingUrl: c.recordingUrl ?? null,
        collected: c.collected ?? null,
        disconnectionReason: c.disconnectionReason ?? null,
        // The meter's frozen price only — retellCostMicroUsd stays out of
        // every org-facing read (schema.ts: operator margin data).
        billedMicroUsd: c.billedMicroUsd ?? null,
        customerName: (c.customerId && names.get(c.customerId)) || null,
      })),
    };
  },
});

// The team's review of one call, from the Notes on its card (2026-10-21,
// Nudge's callReviews.setMine): a note, a verdict, or both. Any member of the
// business, as with notes on a customer (notes.ts): reviewing a call is
// reading it carefully, not configuring anything. Autosaved by the card, so
// this takes whichever half changed and leaves the other alone; a verdict of
// null takes the verdict back.
//
// The note* stamps sign the review as a whole: who first wrote anything on
// it, and who changed it last. A review left holding nothing (no words, no
// verdict) drops them too, so an emptied box carries no name.
export const setReview = mutation({
  args: {
    callId: v.id("calls"),
    note: v.optional(v.string()),
    verdict: v.optional(v.union(callVerdict, v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId, user } = await requireOrg(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.orgId !== orgId) throw new Error("not-found");
    // A customer being deleted takes no note: they are gone to every reader
    // from the first transaction, and the sweep is about to delete this row.
    if (call.customerId) {
      const customer = await ctx.db.get(call.customerId);
      if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
        throw new Error("not-found");
      }
    }

    // Whitespace is not a note. Trimmed for the same reason notes.add trims:
    // the card shows what was stored, and a stray newline is not a word.
    const note =
      args.note === undefined ? call.note : args.note.trim() || undefined;
    const verdict =
      args.verdict === undefined ? call.verdict : (args.verdict ?? undefined);
    if (note === call.note && verdict === call.verdict) return null;

    // Every field named, the absent ones as an explicit undefined: in a patch
    // that DELETES the field, which is what an emptied note or a verdict taken
    // back means.
    const patch: Partial<Doc<"calls">> = { note, verdict };
    if (note === undefined && verdict === undefined) {
      patch.noteCreatedBy = undefined;
      patch.noteUpdatedBy = undefined;
      patch.noteUpdatedAt = undefined;
    } else {
      patch.noteUpdatedBy = user._id;
      patch.noteUpdatedAt = Date.now();
      if (!call.noteCreatedBy) patch.noteCreatedBy = user._id;
    }
    await ctx.db.patch(call._id, patch);
    return null;
  },
});
