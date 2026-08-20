import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import { requireOrg } from "./lib/orgAuth";
import { localDayRangeUtc, todayInZone } from "./lib/businessHours";

// The takings. One question — "what did we make" — answered for three windows,
// with the pageable ledger of visits behind the figures and nothing else.
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
    // orgs.priceDecimals — the takings tab has to write money the way every
    // other surface in the app writes it.
    priceDecimals: v.optional(v.boolean()),
    today: v.number(),
    week: v.number(),
    month: v.number(),
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

    // Bounded at the END of today, not left open. Without the upper bound the
    // range collected the org's entire forward book, and a future appointment
    // marked "completed" — a mis-tap in the row menu, or an owner pre-settling
    // a prepaid visit — was counted into today's, this week's AND this month's
    // takings at once. This file's own header says why that is wrong: one still
    // in the future "has not earned anything YET; counting either would make
    // the number a forecast wearing the clothes of a receipt."
    //
    // It also stops the .collect() growing without limit. A salon with a year
    // of forward bookings was reading all of them to total the last thirty days.
    const horizon = dayStartMs(shiftDays(today, 1), tz);
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startAt", monthStart).lt("startAt", horizon),
      )
      .collect();

    let todayTotal = 0;
    let weekTotal = 0;
    let monthTotal = 0;

    for (const row of rows) {
      if (row.status !== "completed") continue;
      const total = lineTotal(row.items ?? []);
      if (total === undefined) continue;
      monthTotal += total;
      if (row.startAt >= weekStart) weekTotal += total;
      if (row.startAt >= todayStart) todayTotal += total;
    }

    return {
      currency: org.currency ?? "TRY",
      priceDecimals: org.priceDecimals,
      today: todayTotal,
      week: weekTotal,
      month: monthTotal,
    };
  },
});

// A visit's worth, or undefined when nobody priced it — the caller decides
// whether an unpriced visit is skipped or shown, but never sums it as zero
// into a figure that then looks authoritative.
// price is PER UNIT on a goods line; the line is worth price × quantity.
function lineTotal(
  items: { price?: number; quantity?: number }[],
): number | undefined {
  const priced = items.filter((item) => item.price !== undefined);
  if (priced.length === 0) return undefined;
  return priced.reduce(
    (sum, item) => sum + (item.price ?? 0) * (item.quantity ?? 1),
    0,
  );
}

// The ledger under the three figures: every priced visit that reached its
// day — completed AND no_show, newest first, pageable back to the org's first
// day. No-shows ride along deliberately: flagging one from this list must not
// make the row vanish beyond correcting, so the list keeps showing it with
// its status and the client offers the flip back. Search matches the
// customer's name or the services line, and is applied AFTER the page is
// read — a page can come back short or empty while the cursor still advances,
// which the paginated hook on the client absorbs. A salon's history is
// thousands of rows at most; a search index over a denormalized name column
// is machinery this screen does not need yet.
export const revenueList = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
  },
  // Paginated: the page shape is convex's, the items are ours.
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");
    // Same upper bound as the totals: a future visit mis-tapped to
    // "completed" is not takings yet and must not lead the list either.
    const horizon = dayStartMs(shiftDays(todayInZone(org.timezone), 1), org.timezone);

    const result = await ctx.db
      .query("appointments")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).lt("startAt", horizon),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    // Names in one pass; a page of visits from one regular is one read.
    const customerIds = [...new Set(result.page.map((row) => row.customerId))];
    const customers = new Map(
      (await Promise.all(customerIds.map((id) => ctx.db.get(id)))).flatMap(
        (customer) => (customer ? [[customer._id, customer] as const] : []),
      ),
    );

    const needle = args.search?.trim().toLocaleLowerCase();
    const page = [];
    for (const row of result.page) {
      if (row.status !== "completed" && row.status !== "no_show") continue;
      const items = row.items ?? [];
      const total = lineTotal(items);
      if (total === undefined) continue;
      const customer = customers.get(row.customerId);
      const customerName = customer
        ? `${customer.firstName} ${customer.lastName ?? ""}`.trim() ||
          customer.phone
        : "";
      const services = items
        .map((item) =>
          (item.quantity ?? 1) > 1 ? `${item.quantity}× ${item.name}` : item.name,
        )
        .join(", ");
      if (
        needle &&
        !`${customerName} ${services}`.toLocaleLowerCase().includes(needle)
      ) {
        continue;
      }
      page.push({
        _id: row._id,
        startAt: row.startAt,
        customerName,
        services,
        total,
        status: row.status,
      });
    }

    return { ...result, page };
  },
});
