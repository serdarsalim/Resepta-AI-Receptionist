import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// The number a message tells a customer to call — the [phone] token.
//
// Not a setting any more. It was a field on the Business page ("Number for
// customers to call") with the agents' lines offered as chips, which made the
// owner re-answer a question the voice agent table had already asked: the
// agent's inbound number IS the line customers ring, and it is picked when
// the agent is wired up. So the token resolves here, at send time, from the
// first enabled agent that has an inbound line — and tracks it when the
// number changes, instead of going stale in a second copy.
//
// orgs.publicPhone survives only as the legacy fallback: an org that typed a
// front-desk number back when the field existed keeps it until an agent takes
// over. Nothing writes the field any more.
export async function resolvePublicPhone(
  ctx: QueryCtx,
  org: Doc<"orgs">,
): Promise<string | undefined> {
  const agents = await ctx.db
    .query("retellAgents")
    .withIndex("by_org", (q) => q.eq("orgId", org._id))
    .collect();
  for (const agent of agents) {
    const number = agent.inboundNumber?.trim();
    if (number && agent.enabled) return number;
  }
  return org.publicPhone?.trim() || undefined;
}
