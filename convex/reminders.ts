import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { DEFAULT_QUIET_HOURS } from "./orgs";
import { getLocalPartsSafe } from "./lib/businessHours";
import { computeNextMessage, syncAppointmentSchedule } from "./lib/reminderSchedule";
import type { Doc, Id } from "./_generated/dataModel";

// How many due appointments one tick handles before handing off to a fresh
// invocation. Convex caps the reads a single mutation may perform, and each
// appointment here costs a read plus (cached) its org — 200 keeps the tick far
// inside that ceiling while still draining a large backlog in a few hops.
const BATCH = 200;

// Quiet hours are about the CUSTOMER's evening, not the salon's opening times:
// a barber closed on Monday still wants Monday's reminders going out for
// Tuesday's appointments. Business hours (orgs.businessHours) are a separate
// window and drive the WhatsApp away-reply instead.
function insideSendWindow(org: Doc<"orgs">, now: number): boolean {
  const start = org.quietHoursStart ?? DEFAULT_QUIET_HOURS[0];
  const end = org.quietHoursEnd ?? DEFAULT_QUIET_HOURS[1];
  const hour = getLocalPartsSafe(now, org.timezone).hour;
  return hour >= start && hour < end;
}

// ── The due sweep ───────────────────────────────────────────────────────────
//
// Reads appointments whose nextMessageAt has come due — reminders for live
// bookings, winbacks for no_shows — and dispatches them. The index range
// starts ABOVE zero deliberately: an unset nextMessageAt sorts before every
// number, so `gt(0)` is what excludes the appointments that owe nothing, which
// is nearly the whole table.
//
// Cost is proportional to what is DUE, not to how many orgs exist. That is the
// whole point of the denormalised field — see lib/reminderSchedule.ts for the
// scan this replaced and why it silently broke past ~15 orgs.
//
// Both branches stamp the sent marker BEFORE scheduling the send. That
// ordering is the double-send guard across overlapping ticks: a second tick
// arriving mid-flight reads a row that already looks handled. Keep it.
export const tick = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const orgCache = new Map<Id<"orgs">, Doc<"orgs"> | null>();
    const orgOf = async (orgId: Id<"orgs">) => {
      let org = orgCache.get(orgId);
      if (org === undefined) {
        org = await ctx.db.get(orgId);
        orgCache.set(orgId, org);
      }
      return org;
    };

    const due = await ctx.db
      .query("appointments")
      .withIndex("by_next_message", (q) =>
        q.gt("nextMessageAt", 0).lte("nextMessageAt", now),
      )
      .take(BATCH);

    for (const appointment of due) {
      const org = await orgOf(appointment.orgId);
      if (!org) {
        // Orphaned row: clear the marker so it stops being read every tick.
        await ctx.db.patch(appointment._id, { nextMessageAt: undefined });
        continue;
      }
      // Held, not dropped. The row keeps its due time and the first tick
      // inside the window sends it.
      if (!insideSendWindow(org, now)) continue;

      // Re-derived from the row rather than trusted from the index: the org
      // may have changed its offsets since the field was written, and what is
      // owed NOW is the only correct answer. A stored time that no longer
      // matches means the field is stale — repair it and move on, which is the
      // self-healing path that makes a missed syncAppointmentSchedule call
      // recoverable instead of permanent.
      const next = computeNextMessage(appointment, org);
      if (!next || next.at > now) {
        await syncAppointmentSchedule(ctx, appointment._id);
        continue;
      }

      if (next.kind === "winback") {
        await ctx.db.patch(appointment._id, { winbackSentAt: now });
        await syncAppointmentSchedule(ctx, appointment._id);
        await ctx.scheduler.runAfter(0, internal.wa.sendAppointmentMessage, {
          appointmentId: appointment._id,
          kind: "winback",
        });
        continue;
      }

      await ctx.db.patch(appointment._id, {
        reminderSentOffsets: [
          ...(appointment.reminderSentOffsets ?? []),
          next.offsetHours!,
        ],
      });
      await syncAppointmentSchedule(ctx, appointment._id);
      await ctx.scheduler.runAfter(0, internal.wa.sendAppointmentMessage, {
        appointmentId: appointment._id,
        kind: "reminder",
        offsetHours: next.offsetHours,
      });
    }

    // A full batch means there is probably more behind it. Hand off to a fresh
    // invocation rather than reading further in this one — the next tick is
    // five minutes away and a backlog should not wait for it.
    if (due.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.reminders.tick, {});
    }
    return null;
  },
});

// ── Reconciliation ──────────────────────────────────────────────────────────
//
// The due sweep is only as good as the write paths that maintain
// nextMessageAt. A future mutation that patches status or startAt and forgets
// to call syncAppointmentSchedule would leave an appointment that never
// reminds anybody, and nothing about it would look broken.
//
// So once an hour, walk the near-term calendar and recompute. Bounded by the
// index on (status, startAt) — only live bookings, only the next 48 hours,
// which is where every reminder offset the product allows will already have
// come due or be about to. Anything it repairs is a bug in a write path; the
// point is that the customer still gets their reminder while we find it.
export const reconcile = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const horizon = now + 48 * 3600_000;
    const orgCache = new Map<Id<"orgs">, Doc<"orgs"> | null>();

    for (const status of ["scheduled", "confirmed"] as const) {
      const rows = await ctx.db
        .query("appointments")
        .withIndex("by_status_start", (q) =>
          q.eq("status", status).gt("startAt", now).lte("startAt", horizon),
        )
        .take(500);
      for (const appointment of rows) {
        let org = orgCache.get(appointment.orgId);
        if (org === undefined) {
          org = await ctx.db.get(appointment.orgId);
          orgCache.set(appointment.orgId, org);
        }
        const expected = computeNextMessage(appointment, org)?.at;
        if (appointment.nextMessageAt !== expected) {
          await ctx.db.patch(appointment._id, { nextMessageAt: expected });
        }
      }
    }
    return null;
  },
});

// One-shot migration for the deployment as it stood before nextMessageAt
// existed. Every appointment already on disk has the field unset, which reads
// as "owes nothing" — so without this, existing bookings silently stop
// reminding. reconcile would rescue anything starting within 48 hours, but an
// org reminding a week ahead would lose that send, so do the whole calendar
// once and be done.
//
// Run after deploying:
//   npx convex run reminders:backfillAll
export const backfillAll = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    for (const org of orgs) {
      await ctx.scheduler.runAfter(0, internal.reminders.backfillOrg, {
        orgId: org._id,
        // From the epoch, not from now: a no_show in the recent past may still
        // owe a winback, and that is exactly the row a "future only" sweep
        // would skip.
        fromMs: 0,
      });
    }
    return null;
  },
});

// The per-org worker. Also the repair path for an org that changes its
// reminder offsets — same job, so same function. Paginates so a large calendar
// can't blow the read limit.
export const backfillOrg = internalMutation({
  args: { orgId: v.id("orgs"), fromMs: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Reaches back 90 days by default, not to "now": winbackDaysAfter caps at
    // 90, so a no_show that far back can still owe a winback, and starting at
    // now would skip exactly those rows.
    const from = args.fromMs ?? Date.now() - 90 * 24 * 3600_000;
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_org_start", (q) => q.eq("orgId", args.orgId).gte("startAt", from))
      .take(500);
    for (const appointment of rows) {
      const expected = computeNextMessage(appointment, org)?.at;
      if (appointment.nextMessageAt !== expected) {
        await ctx.db.patch(appointment._id, { nextMessageAt: expected });
      }
    }
    // More to do: continue from just past the last row we handled.
    if (rows.length === 500) {
      await ctx.scheduler.runAfter(0, internal.reminders.backfillOrg, {
        orgId: args.orgId,
        fromMs: rows[rows.length - 1].startAt + 1,
      });
    }
    return null;
  },
});
