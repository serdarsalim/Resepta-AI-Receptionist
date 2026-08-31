// Closures: the time a business is shut INSIDE its own opening hours. The
// lunch break (recurring weekly) and the holiday (one dated day) are one row
// shape, because they are one question — can somebody be booked then — asked
// at two cadences. See the schema comment on the table for why this is not a
// second window on businessHours.days.
//
// Validation lives here rather than in the client because more than one
// surface writes closures — the calendar's block sheet today, the agents
// eventually — and a rule enforced in one of them is a rule the others break.

import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { loadClosures } from "./lib/closureRows";
import { closureBlocks, getLocalPartsSafe } from "./lib/businessHours";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// How far ahead appointmentsInside looks. A recurring closure matches forever;
// past three months the count stops being a number anybody acts on.
const COUNT_HORIZON_DAYS = 90;

const closureShape = v.object({
  _id: v.id("closures"),
  weekdays: v.optional(v.array(v.number())),
  date: v.optional(v.string()),
  endDate: v.optional(v.string()),
  startMinute: v.optional(v.number()),
  endMinute: v.optional(v.number()),
  reason: v.optional(v.string()),
});

// Everything the org owns, recurring first and then dated by date ascending —
// a stable reading order (standing rules, then the diary of one-offs) for any
// surface that prints them, rather than whatever creation time interleaves.
export const list = query({
  args: {},
  returns: v.array(closureShape),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await loadClosures(ctx, orgId);
    return rows
      .map((row) => ({
        _id: row._id,
        weekdays: row.weekdays,
        date: row.date,
        endDate: row.endDate,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        reason: row.reason,
      }))
      .sort((a, b) => {
        const aDated = a.date ? 1 : 0;
        const bDated = b.date ? 1 : 0;
        if (aDated !== bDated) return aDated - bDated;
        if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
        return (a.startMinute ?? 0) - (b.startMinute ?? 0);
      });
  },
});

// The agents' door. They run as httpActions and internalActions with an org
// already resolved from the provider's agent id, so they cannot go through
// `list` (which resolves the org from the caller's session, and there is no
// session on an inbound call).
//
// Returns the pure shape rather than documents: everything downstream of here
// wants Closure, and handing back `_id` invites somebody to route an agent
// through a mutation keyed on it.
export const forOrg = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.array(
    v.object({
      weekdays: v.optional(v.array(v.number())),
      date: v.optional(v.string()),
      endDate: v.optional(v.string()),
      startMinute: v.optional(v.number()),
      endMinute: v.optional(v.number()),
      reason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await loadClosures(ctx, args.orgId);
    return rows.map((row) => ({
      weekdays: row.weekdays,
      date: row.date,
      endDate: row.endDate,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
      reason: row.reason,
    }));
  },
});

// The one place a closure's fields are made safe. Returns the storable row, or
// a reason string naming what was wrong — the caller turns that into an error,
// so add and update cannot drift apart on what they accept.
function normalise(input: {
  weekdays?: number[];
  date?: string;
  endDate?: string;
  startMinute?: number;
  endMinute?: number;
  reason?: string;
}): { ok: true; row: Omit<typeof input, "reason"> & { reason?: string } } | { ok: false; reason: string } {
  const dated = typeof input.date === "string" && input.date.trim().length > 0;
  const recurring = Array.isArray(input.weekdays) && input.weekdays.length > 0;
  // Exactly one kind. A row carrying both applies to no day at all
  // (closureAppliesToDay) and would sit in the list looking like it worked.
  if (dated === recurring) {
    return { ok: false, reason: "closure-kind-required" };
  }

  const clamp = (m: number) => Math.min(24 * 60, Math.max(0, Math.round(m)));
  const hasStart = input.startMinute !== undefined;
  const hasEnd = input.endMinute !== undefined;
  // All-day is BOTH unset, never 0 and 1440. Stored that way so "all day"
  // survives an opening-hours change instead of freezing today's clock into
  // the row — and so the list can say "all day" rather than "00:00-24:00".
  if (hasStart !== hasEnd) return { ok: false, reason: "closure-partial-window" };
  let start: number | undefined;
  let end: number | undefined;
  if (hasStart && hasEnd) {
    start = clamp(input.startMinute!);
    end = clamp(input.endMinute!);
    // Not a window anybody meant to type, and storing it would be a closure
    // that blocks nothing while reading as though it blocks something.
    if (start >= end) return { ok: false, reason: "closure-empty-window" };
  }

  if (dated && !DATE_RE.test(input.date!.trim())) {
    return { ok: false, reason: "closure-bad-date" };
  }

  // The range's last day, inclusive. Only a dated row can carry one — on a
  // recurring row it is dropped rather than refused, because it means
  // nothing there and an agent sending both should not lose the whole write.
  // Equal to `date` it is dropped too: that range is the single day the row
  // already names, and storing it would make one fact wear two shapes.
  let endDate = dated ? input.endDate?.trim() || undefined : undefined;
  if (endDate !== undefined) {
    if (!DATE_RE.test(endDate)) return { ok: false, reason: "closure-bad-date" };
    if (endDate < input.date!.trim()) {
      return { ok: false, reason: "closure-bad-range" };
    }
    if (endDate === input.date!.trim()) endDate = undefined;
  }

  const reason = input.reason?.trim();
  return {
    ok: true,
    row: {
      // Dedupe and keep 0–6 only, the same guard orgs.update applies to
      // activeDays: an out-of-range weekday is a rule that never fires.
      weekdays: recurring
        ? [...new Set(input.weekdays!.map((d) => Math.round(d)))]
            .filter((d) => d >= 0 && d <= 6)
            .sort((a, b) => a - b)
        : undefined,
      date: dated ? input.date!.trim() : undefined,
      endDate,
      startMinute: start,
      endMinute: end,
      reason: reason || undefined,
    },
  };
}

// Whether `existing` already blocks every minute `next` would block — i.e.
// the new row is pure duplication. Saving it anyway is how the calendar ended
// up with identical blocks stacked on one lunch hour, each hiding the chip of
// the one under it. Partial overlaps stay legal: extending a break by drawing
// a wider block over it is a thing an owner means to do.
type ClosureShape = {
  weekdays?: number[];
  date?: string;
  endDate?: string;
  startMinute?: number;
  endMinute?: number;
};

function coveredBy(next: ClosureShape, existing: ClosureShape): boolean {
  const winCovered =
    (existing.startMinute ?? 0) <= (next.startMinute ?? 0) &&
    (next.endMinute ?? 24 * 60) <= (existing.endMinute ?? 24 * 60);
  if (!winCovered) return false;
  const nextDated = typeof next.date === "string" && next.date.length > 0;
  const existingDated =
    typeof existing.date === "string" && existing.date.length > 0;
  if (nextDated && existingDated) {
    // String comparison IS date comparison for YYYY-MM-DD; endDate inclusive.
    return (
      existing.date! <= next.date! &&
      (next.endDate ?? next.date!) <= (existing.endDate ?? existing.date!)
    );
  }
  if (nextDated && !existingDated) {
    // A dated row hides inside a recurring one only if every civil day of its
    // range falls on a recurring weekday. Seven days visit every weekday, so
    // the walk never needs to go further than that.
    const start = new Date(`${next.date!}T00:00:00Z`).getTime();
    const lastIso = next.endDate ?? next.date!;
    for (let i = 0; i < 7; i++) {
      const day = new Date(start + i * 24 * 60 * 60_000);
      if (day.toISOString().slice(0, 10) > lastIso) break;
      if (!existing.weekdays!.includes(day.getUTCDay())) return false;
    }
    return true;
  }
  if (!nextDated && !existingDated) {
    return next.weekdays!.every((d) => existing.weekdays!.includes(d));
  }
  // A recurring row repeats forever; no dated row can cover it.
  return false;
}

const writeArgs = {
  weekdays: v.optional(v.array(v.number())),
  date: v.optional(v.string()),
  endDate: v.optional(v.string()),
  startMinute: v.optional(v.number()),
  endMinute: v.optional(v.number()),
  reason: v.optional(v.string()),
};

// How many appointments a closure would sit on top of, so the sheet can say
// "there are 3 appointments that day" BEFORE it is saved.
//
// It counts; it never moves or cancels anything. A closure is a statement
// about what may be BOOKED from now on, and rewriting a diary the customers
// have already been confirmed against is a different, much louder action than
// ticking a holiday. The owner is told and left to decide.
//
// Bounded to a horizon because a recurring closure otherwise matches forever.
// Ninety days is well past the point the answer stops being actionable.
export const appointmentsInside = query({
  args: writeArgs,
  returns: v.number(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) return 0;
    const result = normalise(args);
    if (!result.ok) return 0;
    const closure = result.row;

    const now = Date.now();
    const horizon = now + COUNT_HORIZON_DAYS * 24 * 60 * 60_000;
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startAt", now).lte("startAt", horizon),
      )
      .collect();

    let count = 0;
    for (const row of rows) {
      // A cancelled appointment is not something the owner needs warning about.
      if (row.status === "cancelled") continue;
      const p = getLocalPartsSafe(row.startAt, org.timezone);
      // Goods (duration 0) are COUNTED, unlike under the capacity guards. This
      // number has to describe what the closure will actually stop, and
      // fitsOpenHours refuses a good inside a closure — so skipping them here
      // reported "0 appointments" for precisely the orders about to be
      // blocked. closureBlocks reads a zero-length span as the start instant.
      const duration = row.durationMinutes ?? 30;
      if (
        closureBlocks(
          [closure],
          p,
          p.minutesOfDay,
          p.minutesOfDay + duration,
        )
      ) {
        count += 1;
      }
    }
    return count;
  },
});

export const add = mutation({
  args: writeArgs,
  returns: v.id("closures"),
  handler: async (ctx, args) => {
    // Owner-only, like the hours it modifies: closing the shop is not a thing
    // the person on the desk does between customers.
    const { orgId } = await requireOwner(ctx);
    const result = normalise(args);
    if (!result.ok) throw new Error(result.reason);
    // A weekdays list that survived normalisation empty (every entry out of
    // range) would be a row applying to no day, so it is refused here rather
    // than stored — normalise cannot see it, since it validates the input.
    if (result.row.weekdays && result.row.weekdays.length === 0) {
      throw new Error("closure-kind-required");
    }
    // Blocking time that is already blocked stores a row that changes nothing
    // and clutters the calendar with stacked chips — refused, so the sheet can
    // say so instead of silently succeeding.
    const rows = await loadClosures(ctx, orgId);
    if (rows.some((row) => coveredBy(result.row, row))) {
      throw new Error("closure-covered");
    }
    return await ctx.db.insert("closures", { orgId, ...result.row });
  },
});

export const update = mutation({
  args: { closureId: v.id("closures"), ...writeArgs },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const row = await ctx.db.get(args.closureId);
    if (!row || row.orgId !== orgId) throw new Error("not-found");
    const result = normalise(args);
    if (!result.ok) throw new Error(result.reason);
    if (result.row.weekdays && result.row.weekdays.length === 0) {
      throw new Error("closure-kind-required");
    }
    // Same rule as `add`, minus the row being edited: shrinking a block into
    // the shadow of another one leaves a no-op row behind.
    const rows = await loadClosures(ctx, orgId);
    if (
      rows.some(
        (other) => other._id !== args.closureId && coveredBy(result.row, other),
      )
    ) {
      throw new Error("closure-covered");
    }
    // Replaced whole rather than merged: a row that switches from recurring to
    // dated must LOSE its weekdays, and a patch of only the fields that
    // changed would leave both set — the one shape closureAppliesToDay ignores.
    await ctx.db.patch(args.closureId, {
      weekdays: result.row.weekdays,
      date: result.row.date,
      endDate: result.row.endDate,
      startMinute: result.row.startMinute,
      endMinute: result.row.endMinute,
      reason: result.row.reason,
    });
    return null;
  },
});

export const remove = mutation({
  args: { closureId: v.id("closures") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const row = await ctx.db.get(args.closureId);
    if (!row || row.orgId !== orgId) throw new Error("not-found");
    await ctx.db.delete(args.closureId);
    return null;
  },
});
