// Whether this transaction is close enough to one of Convex's limits that a
// long sweep should stop here and hand over to its next scheduled pass.
//
// Written for the customer deletion sweep (convex/customerDeletion.ts) and
// shared with the operator's business purge (platform.purgeOrgStep), because
// both walk tables whose rows range from a 200-byte read mark to a message
// carrying a megabyte of email HTML. A fixed row count alone cannot be sized
// for both ends of that range: small enough for the large rows is pointlessly
// slow for the small ones, and large enough for the small ones throws on the
// large ones, which stops a scheduled chain for good. So the caller checks
// after every row and stops while there is still room.
//
// Writes are judged only when the caller writes: a query has none to spend.

import type { QueryCtx } from "../_generated/server";

const MB = 1024 * 1024;

export async function nearTransactionLimit(
  ctx: QueryCtx,
  writes: boolean,
): Promise<boolean> {
  let metrics;
  try {
    metrics = await ctx.meta.getTransactionMetrics();
  } catch {
    // A backend without the metrics call. Stop early rather than gamble: the
    // caller's row cap alone then decides, at a size any limit allows.
    return true;
  }
  if (
    metrics.bytesRead.remaining < 6 * MB ||
    metrics.documentsRead.remaining < 500 ||
    metrics.databaseQueries.remaining < 100
  ) {
    return true;
  }
  return (
    writes &&
    (metrics.documentsWritten.remaining < 200 ||
      metrics.bytesWritten.remaining < 2 * MB ||
      metrics.functionsScheduled.remaining < 10)
  );
}
