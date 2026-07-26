import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrg } from "./lib/orgAuth";
import { localDayRangeUtc, todayInZone } from "./lib/businessHours";

// The takings. One question — "what did we make" — answered for three windows
// and nothing else.
//
// COMPLETED appointments only. A booking that was cancelled or no-showed
// earned nothing, and one still in the future has not earned anything YET;
// counting either would make the number a forecast wearing the clothes of a
// receipt. Money that hasn't been collected is the fastest way to make a
// report nobody trusts.
//
// Day boundaries come from the ORG's timezone, not the server's or the
// reader's. "Today" for a salon in Istanbul ends at midnight in Istanbul.

function dayStartMs(dayIso: string, tz: string): number {
  return Date.parse(localDayRangeUtc(dayIso, tz).startIso);
}

// N days back from an ISO day, still in ISO. Done on a UTC clone because we
// only need the CALENDAR arithmetic; the timezone is applied afterwards when
// the day is turned into an instant.
function shiftDays(dayIso: string, delta: number): string {
  const [y, m, d] = dayIso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

export const revenue = query({
  args: {},
  returns: v.object({
    currency: v.string(),
    today: v.number(),
    week: v.number(),
    month: v.number(),
    // The week's completed visits, newest first — the working shown under the
    // total. A number you cannot check is a number you end up arguing with.
    recent: v.array(
      v.object({
        _id: v.id("appointments"),
        startAt: v.number(),
        customerName: v.string(),
        services: v.string(),
        total: v.number(),
      }),
    ),
    // Completed but never priced. Not folded into the totals and not hidden:
    // this is exactly how a takings figure quietly goes wrong, so the report
    // says how many visits it could not count.
    unpriced: v.number(),
  }),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");
    const tz = org.timezone;
    const today = todayInZone(tz);

    const todayStart = dayStartMs(today, tz);
    // Rolling seven and thirty days rather than "since Monday" / "since the
    // 1st": a salon owner checking on a Thursday wants the last week of
    // trading, not four days of it.
    const weekStart = dayStartMs(shiftDays(today, -6), tz);
    const monthStart = dayStartMs(shiftDays(today, -29), tz);

    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startAt", monthStart),
      )
      .collect();

    let todayTotal = 0;
    let weekTotal = 0;
    let monthTotal = 0;
    let unpriced = 0;
    const recent: {
      _id: typeof rows[number]["_id"];
      startAt: number;
      customerName: string;
      services: string;
      total: number;
    }[] = [];

    for (const row of rows) {
      if (row.status !== "completed") continue;
      const items = row.items ?? [];
      const priced = items.filter((item) => item.price !== undefined);
      if (priced.length === 0) {
        unpriced++;
        continue;
      }
      const total = priced.reduce((sum, item) => sum + (item.price ?? 0), 0);
      monthTotal += total;
      if (row.startAt >= weekStart) {
        weekTotal += total;
        const customer = await ctx.db.get(row.customerId);
        recent.push({
          _id: row._id,
          startAt: row.startAt,
          customerName: customer
            ? `${customer.firstName} ${customer.lastName ?? ""}`.trim() ||
              customer.phone
            : "",
          services: items.map((item) => item.name).join(", "),
          total,
        });
      }
      if (row.startAt >= todayStart) todayTotal += total;
    }

    recent.sort((a, b) => b.startAt - a.startAt);
    return {
      currency: org.currency ?? "TRY",
      today: todayTotal,
      week: weekTotal,
      month: monthTotal,
      recent,
      unpriced,
    };
  },
});
