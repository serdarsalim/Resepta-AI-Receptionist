// Loading closures for an org, in one place, so the eight call sites that ask
// "is the shop shut then" all ask the same question.
//
// Separate from convex/closures.ts (the owner-facing API) so a backend reader
// pulling rows does not drag the mutation surface into its import graph, and
// separate from convex/lib/businessHours.ts because THAT module must stay free
// of Convex imports — src/ imports it directly for the calendar's shading, and
// a Convex import there puts the server graph in the browser bundle
// (AGENTS.md: "Never import a value from convex/<name>.ts in src/").
//
// So the split is: this file fetches, businessHours.ts decides. The decision
// half is pure and testable and shared with the client; this half touches the
// database and never leaves the server.

import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type ReadCtx = { db: Pick<MutationCtx["db"], "query" | "get"> };

// Every closure the org owns. Deliberately NOT filtered by date here: the
// recurring rows apply to every week, and the dated ones are cheap enough that
// paying for a range index would buy nothing — a business with a hundred
// holidays typed in has bigger problems than this read.
//
// Returns the raw documents; they satisfy the pure `Closure` shape structurally,
// so callers can hand the array straight to closureBlocks / suggestFreeSlots /
// openHoursForAgent without mapping.
export async function loadClosures(
  ctx: ReadCtx,
  orgId: Id<"orgs">,
): Promise<Doc<"closures">[]> {
  return await ctx.db
    .query("closures")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
}
