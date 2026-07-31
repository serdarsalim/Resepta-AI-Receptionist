// The call history the voice tab reads. Everything here was already captured
// by the post-call webhook — recording, transcript, summary, outcome — and
// then sat invisible in the table while the owner walked to Retell to hear a
// call. This query is the walk removed.

import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrg } from "./lib/orgAuth";

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
    const names = new Map(
      (await Promise.all(customerIds.map((id) => ctx.db.get(id)))).flatMap((c) =>
        c ? [[c._id, `${c.firstName} ${c.lastName ?? ""}`.trim()] as const] : [],
      ),
    );

    return {
      ...result,
      page: result.page.map((c) => ({
        _id: c._id,
        startedAt: c.startedAt,
        direction: c.direction,
        fromNumber: c.fromNumber ?? null,
        durationSec: c.durationSec ?? null,
        outcome: c.outcome ?? null,
        summary: c.summary ?? null,
        transcript: c.transcript ?? null,
        recordingUrl: c.recordingUrl ?? null,
        customerName: (c.customerId && names.get(c.customerId)) || null,
      })),
    };
  },
});
