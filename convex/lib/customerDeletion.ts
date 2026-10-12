// What every other file needs to know about a customer being deleted. The work
// itself lives in convex/customerDeletion.ts; this leaf holds only the
// vocabulary, so a send path, a webhook or a list can ask "is this person on
// their way out" without importing the sweep (and its scheduler references).
//
// A deleted customer goes in two steps (customerDeletion.beginCustomerDeletion):
// one transaction marks the row and blanks it, then a scheduled sweep empties
// every table that holds them and deletes the row last. Between the two the
// row still exists, and every reader that could show it, message it or attach
// something new to it has to treat it as already gone. That reader asks here.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// True once deletion has begun. The row is blank by then (no name, no
// consent, a tombstone for a phone), so the honest answer to any question
// about it is "no such customer".
export function isDeleting(customer: Pick<Doc<"customers">, "deletingAt">): boolean {
  return customer.deletingAt !== undefined;
}

// A customer row a reader may use: it exists and is not being deleted. The
// common shape at every door that took a customer id from outside.
export function liveCustomer(
  customer: Doc<"customers"> | null,
): customer is Doc<"customers"> {
  return customer !== null && !isDeleting(customer);
}

// What `phone` becomes the moment deletion begins. Not a number, so it can
// never be dialled or messaged, and unique per row, so the `.unique()` reads
// on by_org_phone never meet two tombstones. Taking the real number off the
// index is what stops an inbound message or call from that number landing on
// the half-deleted row: it finds nobody and starts a new customer.
export function erasedPhone(customerId: Id<"customers">): string {
  return `deleted:${customerId}`;
}

// ── Calls that belonged to a deleted customer ────────────────────────────────
//
// The provider keeps talking about a call after it ends: the analysis arrives
// on a second webhook minutes later, a webhook retry can repeat the first,
// and voiceEvents.recoverAnalysis fetches a late analysis itself. Each of those
// would reach retell.recordCall, find no calls row (the sweep deleted it), and
// write the call back with a brand-new customer built from its transcript. So
// the sweep leaves one marker per erased call in voiceEvents, ids only, and
// every door that turns a provider event into a row checks it first.
export const ERASED_CALL_EVENT = "customer_deleted" as const;

export function erasedCallKey(retellCallId: string): string {
  return `${retellCallId}:${ERASED_CALL_EVENT}`;
}

export async function callErased(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">,
  retellCallId: string,
): Promise<boolean> {
  const marker = await ctx.db
    .query("voiceEvents")
    .withIndex("by_org_event_key", (q) =>
      q.eq("orgId", orgId).eq("eventKey", erasedCallKey(retellCallId)),
    )
    .first();
  return marker !== null;
}
