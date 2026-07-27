// Reading the activity log. Writing goes through lib/activity.ts.

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrg } from "./lib/orgAuth";
import { OPERATOR_ACTOR_NAME } from "./lib/activity";

const entry = v.object({
  _id: v.id("activityLog"),
  at: v.number(),
  kind: v.string(),
  detail: v.optional(v.string()),
  // Resolved at read time rather than stored, so renaming yourself does not
  // leave stale attribution frozen into every row you ever wrote. Unset means
  // the system did it — a cron, a webhook, the voice agent — and the UI says
  // so rather than inventing a name.
  actor: v.optional(v.string()),
  customerId: v.optional(v.id("customers")),
  customerName: v.optional(v.string()),
  appointmentId: v.optional(v.id("appointments")),
});

// Newest first, capped. This is a "what just happened" feed, not an archive:
// somebody scanning for who cancelled a booking is looking at today, and a
// page of fifty is more than that question ever needs.
export const recent = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(entry),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("activityLog")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(Math.min(args.limit ?? 50, 200));

    // Names are looked up once per distinct id rather than per row: a busy
    // morning is thirty rows naming the same two people.
    const actorNames = new Map<string, string | undefined>();
    const customerNames = new Map<string, string | undefined>();
    const out = [];
    for (const row of rows) {
      let actor: string | undefined;
      // The operator's brand wins over the person, and the lookup is SKIPPED
      // rather than overwritten: the salon's browser never receives the
      // operator's name or user id, only the fact that Autotakt did it.
      if (row.viaOperator) {
        actor = OPERATOR_ACTOR_NAME;
      } else if (row.actorId) {
        if (!actorNames.has(row.actorId)) {
          const user = await ctx.db.get(row.actorId);
          actorNames.set(row.actorId, user?.name || user?.email || undefined);
        }
        actor = actorNames.get(row.actorId);
      }
      let customerName: string | undefined;
      if (row.customerId) {
        if (!customerNames.has(row.customerId)) {
          const customer = await ctx.db.get(row.customerId);
          customerNames.set(
            row.customerId,
            customer
              ? `${customer.firstName} ${customer.lastName ?? ""}`.trim()
              : undefined,
          );
        }
        customerName = customerNames.get(row.customerId);
      }
      out.push({
        _id: row._id,
        at: row._creationTime,
        kind: row.kind,
        detail: row.detail,
        actor,
        customerId: row.customerId,
        customerName,
        appointmentId: row.appointmentId,
      });
    }
    return out;
  },
});
