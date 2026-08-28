// The chat agent's draft queue, such as it is.
//
// There is no drafts table. A pending draft is a `chatAgentTurns` row with
// status "suggested" and no `suggestionOutcome` — that absence is the whole
// queue, and it means a draft cannot exist without the tokens, tool calls and
// prompt version that produced it sitting on the same row.
//
// This lives in lib/ rather than in chatAgent.ts because messages.ts retires
// drafts too (a human's own reply landing is the end of the proposal it was
// answering), and messages.ts ↔ chatAgent.ts would be an import cycle — where
// a function read across the cycle is `undefined` while the importing module's
// top level runs. A leaf module cannot do that.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Every still-pending draft on this conversation, NEWEST FIRST. Order matters:
// the thread renders [0], and if two ever coexist the one worth showing is the
// one answering the most recent message.
//
// Scoped by the customer index and filtered in memory rather than indexed:
// a conversation's turns are bounded by the per-hour rate limit, and the list
// this returns is almost always empty or one long.
export async function pendingSuggestionsFor(
  ctx: QueryCtx | MutationCtx,
  customerId: Id<"customers">,
): Promise<Doc<"chatAgentTurns">[]> {
  const turns = await ctx.db
    .query("chatAgentTurns")
    .withIndex("by_customer_at", (q) => q.eq("customerId", customerId))
    .order("desc")
    .take(20);
  return turns.filter(
    (t) => t.status === "suggested" && t.suggestionOutcome === undefined,
  );
}

export async function supersedePendingSuggestions(
  ctx: MutationCtx,
  customerId: Id<"customers">,
): Promise<void> {
  for (const turn of await pendingSuggestionsFor(ctx, customerId)) {
    await ctx.db.patch(turn._id, { suggestionOutcome: "superseded" });
  }
}
