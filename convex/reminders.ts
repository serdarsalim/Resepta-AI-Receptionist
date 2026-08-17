import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { DEFAULT_QUIET_HOURS } from "./orgs";
import { getLocalPartsSafe, localWallTimeToUtcMs } from "./lib/businessHours";
import {
  computeNextMessage,
  loadOrgRules,
  syncAppointmentSchedule,
} from "./lib/reminderSchedule";
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
//
// Wraps, and has to. These fields are named for the quiet part but read as the
// SEND window, so "quiet from 21:00 to 09:00" is the natural thing to type and
// it lands as start=21, end=9. A straight `hour >= start && hour < end` is then
// false for all twenty-four hours: every reminder, winback and follow-up stops
// forever, and nothing on screen admits it.
function insideSendWindow(org: Doc<"orgs">, now: number): boolean {
  const start = org.quietHoursStart ?? DEFAULT_QUIET_HOURS[0];
  const end = org.quietHoursEnd ?? DEFAULT_QUIET_HOURS[1];
  const hour = getLocalPartsSafe(now, org.timezone).hour;
  return start <= end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

// When this org's send window next opens, as a UTC instant.
//
// A held row is parked here rather than left holding a due time that has
// already passed. by_next_message is a single ascending index shared by every
// org, so a row stuck in the past sits at the FRONT of it for the whole quiet
// period: re-read by every tick, and — the part that actually hurts —
// occupying one of the BATCH slots that an org currently inside its own window
// needs. Parking keeps the index honest about when a row wants attention.
// Nothing is lost, because computeNextMessage re-derives what is owed when the
// row comes due again.
function nextSendWindowOpen(org: Doc<"orgs">, now: number): number {
  const start = org.quietHoursStart ?? DEFAULT_QUIET_HOURS[0];
  const tz = org.timezone || "UTC";
  const p = getLocalPartsSafe(now, tz);
  const todayOpen = localWallTimeToUtcMs(p.y, p.m0, p.d, start, 0, tz);
  // Date.UTC normalises a day past the end of the month, so d + 1 is safe.
  return todayOpen > now
    ? todayOpen
    : localWallTimeToUtcMs(p.y, p.m0, p.d + 1, start, 0, tz);
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
    // Org and its rules cached together: the tick may drain hundreds of rows
    // for one busy org, and the rules read costs the same every time.
    const orgCache = new Map<
      Id<"orgs">,
      { org: Doc<"orgs"> | null; rules: Doc<"messageRules">[] }
    >();
    const orgOf = async (orgId: Id<"orgs">) => {
      let entry = orgCache.get(orgId);
      if (entry === undefined) {
        const org = await ctx.db.get(orgId);
        const rules = org ? await loadOrgRules(ctx, orgId) : [];
        entry = { org, rules };
        orgCache.set(orgId, entry);
      }
      return entry;
    };

    const due = await ctx.db
      .query("appointments")
      .withIndex("by_next_message", (q) =>
        q.gt("nextMessageAt", 0).lte("nextMessageAt", now),
      )
      .take(BATCH);

    // Rows this invocation actually moved out of the due range. Not the same as
    // due.length — see the hand-off at the bottom.
    let handled = 0;

    for (const appointment of due) {
      const { org, rules } = await orgOf(appointment.orgId);
      if (!org) {
        // Orphaned row: clear the marker so it stops being read every tick.
        await ctx.db.patch(appointment._id, { nextMessageAt: undefined });
        handled += 1;
        continue;
      }
      // Held, not dropped — but parked at the window opening rather than left
      // sitting in the past, so it stops crowding the front of the index and
      // stops being re-read by every tick until morning.
      if (!insideSendWindow(org, now)) {
        await ctx.db.patch(appointment._id, {
          nextMessageAt: nextSendWindowOpen(org, now),
        });
        continue;
      }
      // Past the hold, every path below writes, so the row leaves the range.
      handled += 1;

      // Re-derived from the row rather than trusted from the index: the org
      // may have changed its rules since the field was written, and what is
      // owed NOW is the only correct answer. A stored time that no longer
      // matches means the field is stale — repair it and move on, which is the
      // self-healing path that makes a missed syncAppointmentSchedule call
      // recoverable instead of permanent.
      const next = computeNextMessage(appointment, org, rules);
      if (!next || next.at > now) {
        await syncAppointmentSchedule(ctx, appointment._id);
        continue;
      }

      // Stamp BEFORE scheduling the send — the double-send guard across
      // overlapping ticks. Rules stamp by rule id; the legacy path keeps its
      // hour and one-shot markers. winbackSentAt is stamped on both paths
      // because it doubles as the "already won back" fact other reads rely on.
      if (next.ruleId !== undefined) {
        await ctx.db.patch(appointment._id, {
          sentRuleIds: [...(appointment.sentRuleIds ?? []), next.ruleId],
          ...(next.kind === "winback" ? { winbackSentAt: now } : {}),
        });
      } else if (next.kind === "winback") {
        await ctx.db.patch(appointment._id, { winbackSentAt: now });
      } else {
        await ctx.db.patch(appointment._id, {
          reminderSentOffsets: [
            ...(appointment.reminderSentOffsets ?? []),
            next.offsetHours!,
          ],
        });
      }
      await syncAppointmentSchedule(ctx, appointment._id);
      await ctx.scheduler.runAfter(0, internal.wa.sendAppointmentMessage, {
        appointmentId: appointment._id,
        kind: next.kind,
        offsetHours: next.offsetHours,
        ruleId: next.ruleId,
      });
    }

    // A full batch means there is probably more behind it. Hand off to a fresh
    // invocation rather than reading further in this one — the next tick is
    // five minutes away and a backlog should not wait for it.
    //
    // Guarded on PROGRESS, not volume. This used to test due.length alone, and
    // a batch entirely held by quiet hours wrote nothing: the same 200 rows
    // came back, were skipped again, and re-enqueued again, spinning the
    // scheduler continuously until the window opened. Parking held rows above
    // already breaks that loop; `handled > 0` is the second belt, so a future
    // no-op branch cannot re-open it.
    if (due.length === BATCH && handled > 0) {
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
  args: { fromMs: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    // Continuation cursor. Without one, a deployment with more than 500 live
    // bookings in the next 48 hours silently reconciled only the earliest 500
    // and returned — so the later part of the window was reached only once it
    // drifted inside the prefix, which for a busy deployment is after the
    // 24-hour reminder was already due. The window does slide as `now` moves,
    // so this was never permanent; it was a hole sitting exactly where the
    // product's default offset lives.
    const from = Math.max(args.fromMs ?? now, now);
    const horizon = now + 48 * 3600_000;
    let resumeAt: number | undefined;
    const orgCache = new Map<
      Id<"orgs">,
      { org: Doc<"orgs"> | null; rules: Doc<"messageRules">[] }
    >();

    for (const status of ["scheduled", "confirmed"] as const) {
      const rows = await ctx.db
        .query("appointments")
        .withIndex("by_status_start", (q) =>
          q.eq("status", status).gt("startAt", from).lte("startAt", horizon),
        )
        .take(500);
      if (rows.length === 500) {
        // The smaller of the two statuses' cursors, so neither is skipped.
        const last = rows[rows.length - 1].startAt;
        resumeAt = resumeAt === undefined ? last : Math.min(resumeAt, last);
      }
      for (const appointment of rows) {
        let entry = orgCache.get(appointment.orgId);
        if (entry === undefined) {
          const org = await ctx.db.get(appointment.orgId);
          const rules = org ? await loadOrgRules(ctx, appointment.orgId) : [];
          entry = { org, rules };
          orgCache.set(appointment.orgId, entry);
        }
        const expected = computeNextMessage(appointment, entry.org, entry.rules)?.at;
        if (appointment.nextMessageAt !== expected) {
          await ctx.db.patch(appointment._id, { nextMessageAt: expected });
        }
      }
    }
    // `resumeAt > from` is the stall guard: this sweep mostly writes nothing,
    // so unlike tick it cannot rely on its own writes to make the next read
    // different, and a cursor that failed to advance would loop forever.
    if (resumeAt !== undefined && resumeAt > from) {
      await ctx.scheduler.runAfter(0, internal.reminders.reconcile, {
        fromMs: resumeAt,
      });
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
    const rules = await loadOrgRules(ctx, args.orgId);
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_org_start", (q) => q.eq("orgId", args.orgId).gte("startAt", from))
      .take(500);
    for (const appointment of rows) {
      const expected = computeNextMessage(appointment, org, rules)?.at;
      if (appointment.nextMessageAt !== expected) {
        await ctx.db.patch(appointment._id, { nextMessageAt: expected });
      }
    }
    // More to do: continue from the last row's own startAt, NOT past it.
    //
    // This used to advance by +1ms, which silently skipped every appointment
    // sharing the 500th row's start time — and ties on the minute are routine,
    // because capacity is a count, not exclusivity: a three-chair salon books
    // three at 10:00, and localWallTimeToUtcMs writes them at zero seconds and
    // zero millis, so the collision is guaranteed rather than unlikely. A
    // skipped row keeps a stale nextMessageAt, so the rule the owner just
    // saved never fires for that customer and nothing looks broken. This is
    // not only the migration: every messageRules add/update/remove and
    // orgs.update schedules it.
    //
    // gte() then re-reads the tied rows, which costs a page and loses nothing
    // — recomputing nextMessageAt is idempotent. The one case that must still
    // advance is a whole page at a single timestamp, which would never
    // terminate otherwise.
    if (rows.length === 500) {
      const last = rows[rows.length - 1].startAt;
      await ctx.scheduler.runAfter(0, internal.reminders.backfillOrg, {
        orgId: args.orgId,
        fromMs: last === rows[0].startAt ? last + 1 : last,
      });
    }
    return null;
  },
});
