import { v } from "convex/values";
import { syncCustomerSearch } from "./lib/customerSearch";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrg, assertE164 } from "./lib/orgAuth";
import {
  cancelBooking,
  createBooking,
  releaseHeldBooking,
  rescheduleBooking,
} from "./lib/calcomApi";
import { rescheduleAppointment, scheduleConfirmationIfConfigured } from "./appointments";
import { syncAppointmentSchedule } from "./lib/reminderSchedule";
import { recordActivity } from "./lib/activity";
import { queueOrgAlert } from "./lib/alerts";
import { recordCustomerCreated } from "./lib/newCustomer";
import { isDeleting } from "./lib/customerDeletion";
import { activeRowsAround, fitsOpenHours, orgCapacity, overlapCount } from "./booking";
import { durationOf } from "./agentAppointments";
import { closureBlocks, getLocalPartsSafe, hasBusinessHours } from "./lib/businessHours";
import { loadClosures } from "./lib/closureRows";
import { customerConflict, staffConflict } from "./lib/overlap";
import { slotVerdictValidator, type SlotVerdict } from "./lib/slotVerdict";

const lineInput = v.object({
  serviceId: v.id("services"),
  price: v.optional(v.number()),
  // Goods only ("3 chocolate cakes" is one line). Ignored on time-bound
  // services — two haircuts is two visits.
  quantity: v.optional(v.number()),
});

const storedItem = v.object({
  serviceId: v.optional(v.id("services")),
  name: v.string(),
  price: v.optional(v.number()),
  durationMinutes: v.number(),
  quantity: v.optional(v.number()),
});

// Same contract as appointments.resolveLines, and same reason: the client
// says WHICH service and optionally what it cost, the server fills in the
// name and the duration so neither can be invented.
async function resolveLines(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  lines: { serviceId: Id<"services">; price?: number; quantity?: number }[],
) {
  const items = [];
  for (const line of lines) {
    const service = await ctx.db.get(line.serviceId);
    if (!service || service.orgId !== orgId) throw new Error("not-found");
    const price = line.price ?? service.price;
    // A good's line stores duration 0 (it adds no time to the visit) and may
    // carry a quantity; a time-bound line never does.
    const isGood = service.durationMinutes === undefined;
    const quantity =
      isGood && line.quantity !== undefined
        ? Math.min(99, Math.max(1, Math.round(line.quantity)))
        : 1;
    items.push({
      serviceId: service._id,
      name: service.name,
      ...(price !== undefined ? { price: Math.max(0, Math.round(price)) } : {}),
      durationMinutes: service.durationMinutes ?? 0,
      ...(quantity > 1 ? { quantity } : {}),
    });
  }
  return items;
}


// The calendar's write path. Everything the grid does — create by clicking a
// slot, move by dragging, resize by dragging an edge — comes through here.
//
// THE RULE, and the reason this module exists as actions rather than mutations:
// cal.com owns the slot inventory, the salon's Google Calendar and the
// notification emails, so it is told FIRST and our row moves only once it
// agrees. A Convex mutation cannot reach the network, so no mutation can ever
// hold this contract — it would write locally and leave cal.com holding the
// old time. On a calendar that is worse than anywhere else, because the grid
// is the thing that looks authoritative. Booking and rescheduling therefore
// have exactly one entry point each, here; there is deliberately no
// mutation-shaped shortcut past them.
//
// Writes that CAN be refused on the merits (create, move, resize — the slot is
// genuinely taken) are synchronous: the caller finds out now, because retrying
// will never make a taken slot free. Writes that cannot be refused (cancel,
// status, notes) stay on the fire-and-forget path — retrying those is right,
// and Nudge's hubspotWrites queue is the model when they need it.
//
// THE VERDICT (2026-10-13, P6 of the Nudge port). Until then nothing checked
// this calendar at all for a business without cal.com, which is every
// business: a person could put a booking on a full hour, into a lunch closure
// or on top of the customer's own appointment, and only their eyes on the
// grid would catch it. Now every create and move is judged first, for every
// business (judgeSlot, below), with the booking page's and the assistants'
// own helpers. A refusal a person may overrule comes back with canForce, and
// the same call with force: true books it anyway: the sheet asks "Book it
// anyway?" first, so overruling is a visible choice. cal.com's own refusals
// (the parked lane) ride the same canForce and the same question, retried
// with its allowConflicts / allowBookingOutOfBounds. Only these actions take
// force, and only from a signed-in member (loadWriteContext's requireOrg):
// the booking page and the assistants never can.

const writeResult = v.object({
  ok: v.boolean(),
  appointmentId: v.optional(v.id("appointments")),
  reason: v.optional(v.string()),
  // The UI offers "book anyway" only for a refusal a person is entitled to
  // overrule: the calendar's own verdict, or cal.com saying the slot is busy
  // or out of its bounds. A 401 is not that.
  canForce: v.optional(v.boolean()),
  // The calendar's verdict, when that is what refused, so the sheet can say
  // why in words.
  verdict: v.optional(slotVerdictValidator),
});

type WriteResult = {
  ok: boolean;
  appointmentId?: Id<"appointments">;
  reason?: string;
  canForce?: boolean;
  verdict?: SlotVerdict;
};

// A refusal by the calendar's own verdict, as the actions answer it.
function refusedBy(verdict: SlotVerdict): WriteResult {
  return { ok: false, reason: verdict.conflict, canForce: true, verdict };
}

// cal.com's refusals that a salon owner may legitimately overrule: the slot is
// busy, or it is outside the hours cal.com knows about. Anything else (a bad
// key, a missing event type, a network failure) is ours to fix, and offering
// "book anyway" for those would just be a button that fails twice.
function overrulable(reason: string): boolean {
  return /http-(409|400)/.test(reason) && !/api.?key|unauthor/i.test(reason);
}

// ── The slot verdict ────────────────────────────────────────────────────────

type ReadCtx = { db: Pick<MutationCtx["db"], "query" | "get"> };

// What stands in the way of booking `startAt` for `durationMinutes`, most
// fundamental first (lib/slotVerdict): outside that day's opening hours,
// blocked time, the customer's own clash, the team member's own clash, every
// team member already busy. Judged with the same helpers the booking page
// (booking.ts) and the assistants' moves (agentAppointments.moveRefusal) use,
// so all three lanes agree about what is taken. Three deliberate differences:
//
// - A business that never set opening hours is bound only by its closures,
//   as the assistants' moves are: there is no window to fit, and the page's
//   answer (refuse everything) would put every booking behind a question.
// - The team member's clash, which only this calendar can have: nothing else
//   names a person on a booking.
// - The clock is not read. Past, and sooner than the minimum notice, are
//   facts the sheet works out itself (lib/minNotice), and neither needs a
//   person's confirmation; this also keeps the query below cacheable.
//
// `ignoreId` is the booking being moved, which must not block itself.
// `staffOnly` judges a change of person alone (appointments.updateDetails):
// the time is not moving, so the slot's other facts are not news.
async function judgeSlot(
  ctx: ReadCtx,
  org: Doc<"orgs">,
  a: {
    startAt: number;
    durationMinutes: number;
    customerId?: Id<"customers">;
    staffId?: Id<"staff">;
    ignoreId?: Id<"appointments">;
    staffOnly?: boolean;
  },
): Promise<SlotVerdict> {
  if (!Number.isFinite(a.startAt) || !Number.isFinite(a.durationMinutes)) return {};
  const duration = Math.max(0, Math.round(a.durationMinutes));
  if (!a.staffOnly) {
    const hours = org.businessHours;
    // Hours alone here, closures next: fitsOpenHours is the page's own test,
    // handed no closures so the two can be told apart.
    if (hours && hasBusinessHours(hours) && !fitsOpenHours(org, a.startAt, duration, [])) {
      return { conflict: "outside-hours" };
    }
    const at = getLocalPartsSafe(a.startAt, org.timezone);
    const shut = closureBlocks(
      await loadClosures(ctx, org._id),
      at,
      at.minutesOfDay,
      at.minutesOfDay + duration,
    );
    if (shut) {
      const reason = shut.reason?.trim();
      return { conflict: "closed", ...(reason ? { closedReason: reason } : {}) };
    }
  }
  // A good holds no chair and no person: every guard below is a no-op for it,
  // as it is on the booking page.
  if (duration === 0) return {};
  const rows = await activeRowsAround(
    ctx,
    org._id,
    a.startAt,
    a.startAt + duration * 60_000,
  );
  if (
    !a.staffOnly &&
    a.customerId &&
    customerConflict(rows, a.customerId, a.startAt, duration, a.ignoreId)
  ) {
    return { conflict: "customer-busy" };
  }
  if (a.staffId && staffConflict(rows, a.staffId, a.startAt, duration, a.ignoreId)) {
    return { conflict: "staff-busy" };
  }
  if (
    !a.staffOnly &&
    overlapCount(rows, a.startAt, duration, a.ignoreId) >= (await orgCapacity(ctx, org._id))
  ) {
    return { conflict: "full" };
  }
  return {};
}

const judgeArgs = {
  startAt: v.number(),
  durationMinutes: v.number(),
  customerId: v.optional(v.id("customers")),
  staffId: v.optional(v.id("staff")),
  staffOnly: v.optional(v.boolean()),
};

// The booking sheet's question as a time, a customer or a team member is
// picked: what the calendar would say about it now. Live, so a booking that
// lands on the hour while the sheet is open changes the answer. The ids are
// only ever filters over this business's own rows (judgeSlot reads by
// orgId), so one from elsewhere matches nothing and reveals nothing.
export const slotVerdict = query({
  args: {
    ...judgeArgs,
    // The booking being edited, whose own slot is not taken.
    appointmentId: v.optional(v.id("appointments")),
  },
  returns: slotVerdictValidator,
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) return {};
    return await judgeSlot(ctx, org, {
      startAt: args.startAt,
      durationMinutes: args.durationMinutes,
      customerId: args.customerId,
      staffId: args.staffId,
      staffOnly: args.staffOnly,
      ignoreId: args.appointmentId,
    });
  },
});

// The same judgement for the writes that cannot import it: the move's check
// before cal.com hears of anything, and appointments.updateDetails (which
// this module imports, so the call goes the other way through a query).
export const judge = internalQuery({
  args: {
    ...judgeArgs,
    orgId: v.id("orgs"),
    ignoreId: v.optional(v.id("appointments")),
  },
  returns: slotVerdictValidator,
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return {};
    return await judgeSlot(ctx, org, args);
  },
});

export const loadWriteContext = internalQuery({
  args: { appointmentId: v.optional(v.id("appointments")) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    let appointment = null;
    if (args.appointmentId) {
      const row = await ctx.db.get(args.appointmentId);
      if (!row || row.orgId !== orgId) return null;
      appointment = row;
    }
    return { org, appointment };
  },
});

type Prepared =
  | { ok: false; verdict: SlotVerdict }
  | {
      ok: true;
      orgId: Id<"orgs">;
      customerId: Id<"customers">;
      items: Awaited<ReturnType<typeof resolveLines>>;
      customerName: string;
      phone: string;
      email?: string;
      durationMinutes?: number;
    };

// Resolves the customer BEFORE cal.com is called, so the booking carries a real
// name. A cal.com failure therefore leaves a contact behind with no appointment,
// which is the right residue: you did meet this person, and the next attempt
// reuses the row rather than duplicating them.
//
// The calendar's verdict is judged here too, before a new customer is
// written: a booking the sheet then asks about must leave nothing behind
// until the person answers.
export const prepareCreate = internalMutation({
  args: {
    customerId: v.optional(v.id("customers")),
    newCustomer: v.optional(
      v.object({
        firstName: v.string(),
        lastName: v.optional(v.string()),
        phone: v.string(),
        // Passed through from create below, and ignored there too.
        consent: v.optional(v.boolean()),
      }),
    ),
    lines: v.optional(v.array(lineInput)),
    durationMinutes: v.optional(v.number()),
    startAt: v.number(),
    staffId: v.optional(v.id("staff")),
    force: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Prepared> => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");

    // Snapshotted here rather than at insert time so the cal.com round-trip
    // in between can't see a different price than the row ends up with.
    const items = await resolveLines(ctx, orgId, args.lines ?? []);

    // Duration precedence: an explicit drag beats what the services add up to.
    // Dragging a 30-minute cut out to 45 has to mean 45, or resize is a lie.
    let durationMinutes = args.durationMinutes;
    if (durationMinutes === undefined && items.length) {
      durationMinutes = items.reduce((sum, i) => sum + i.durationMinutes, 0);
    }

    let customerId = args.customerId;
    let newPhone: string | undefined;
    if (!customerId) {
      if (!args.newCustomer) throw new Error("customer-required");
      newPhone = assertE164(args.newCustomer.phone);
      const phone = newPhone;
      const existing = await ctx.db
        .query("customers")
        .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
        .unique();
      customerId = existing?._id;
    } else {
      const customer = await ctx.db.get(customerId);
      if (!customer || customer.orgId !== orgId || isDeleting(customer)) {
        throw new Error("not-found");
      }
    }

    // A customer not on file yet has nothing of theirs to clash with.
    if (!args.force) {
      const verdict = await judgeSlot(ctx, org, {
        startAt: args.startAt,
        durationMinutes: durationMinutes ?? 30,
        customerId,
        staffId: args.staffId,
      });
      if (verdict.conflict) return { ok: false, verdict };
    }

    if (!customerId) {
      const fresh = args.newCustomer!;
      const phone = newPhone!;
      customerId = await ctx.db.insert("customers", {
        orgId,
        firstName: fresh.firstName.trim() || phone,
        lastName: fresh.lastName?.trim() || undefined,
        phone,
      });
      await syncCustomerSearch(ctx, customerId);
      // Typed into the booking sheet by somebody who is looking at it.
      await recordCustomerCreated(ctx, { orgId, customerId, source: "staff" });
    }
    const customer = await ctx.db.get(customerId);
    if (!customer) throw new Error("customer-failed");

    return {
      ok: true,
      orgId,
      customerId,
      items,
      customerName: `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
      phone: customer.phone,
      email: customer.email,
      durationMinutes,
    };
  },
});

export const finishCreate = internalMutation({
  args: {
    orgId: v.id("orgs"),
    customerId: v.id("customers"),
    items: v.optional(v.array(storedItem)),
    staffId: v.optional(v.id("staff")),
    startAt: v.number(),
    durationMinutes: v.optional(v.number()),
    notes: v.optional(v.string()),
    externalUid: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), appointmentId: v.id("appointments") }),
    v.object({ ok: v.literal(false), verdict: slotVerdictValidator }),
  ),
  handler: async (ctx, args) => {
    if (args.staffId) {
      const staff = await ctx.db.get(args.staffId);
      if (!staff || staff.orgId !== args.orgId) throw new Error("not-found");
    }
    // Judged again in the transaction that writes, so nothing can take the
    // slot between prepareCreate's look and this insert. Not when cal.com
    // already holds the booking: it agreed a moment ago, after the same
    // verdict, and refusing here would leave the two calendars telling
    // different stories (agentAppointments' providerConfirmed rule).
    if (!args.force && !args.externalUid) {
      const org = await ctx.db.get(args.orgId);
      if (org) {
        const verdict = await judgeSlot(ctx, org, {
          startAt: args.startAt,
          durationMinutes: args.durationMinutes ?? 30,
          customerId: args.customerId,
          staffId: args.staffId,
        });
        if (verdict.conflict) return { ok: false as const, verdict };
      }
    }
    const appointmentId = await ctx.db.insert("appointments", {
      orgId: args.orgId,
      customerId: args.customerId,
      items: args.items ?? [],
      staffId: args.staffId,
      startAt: args.startAt,
      durationMinutes: args.durationMinutes,
      status: "scheduled",
      notes: args.notes?.trim() || undefined,
      // "manual" even when it went to cal.com: source records where the human
      // typed it, and externalUid records whether cal.com holds it.
      source: "manual",
      externalUid: args.externalUid,
    });
    // Arms the reminder cron for this booking (lib/reminderSchedule.ts). A row
    // inserted without this never reminds anybody.
    await syncAppointmentSchedule(ctx, appointmentId);
    await recordActivity(ctx, {
      orgId: args.orgId,
      kind: "appointment_created",
      customerId: args.customerId,
      appointmentId,
    });
    // Quiet when the start has already passed (scheduleLifecycleMessages).
    await scheduleConfirmationIfConfigured(ctx, args.orgId, appointmentId);
    return { ok: true as const, appointmentId };
  },
});

export const create = action({
  args: {
    customerId: v.optional(v.id("customers")),
    newCustomer: v.optional(
      v.object({
        firstName: v.string(),
        lastName: v.optional(v.string()),
        phone: v.string(),
        // Ignored since 2026-10-21, when consent stopped gating sends.
        // Accepted so a tab loaded before that deploy can still book a new
        // customer; drop it once no client sends it.
        consent: v.optional(v.boolean()),
      }),
    ),
    lines: v.optional(v.array(lineInput)),
    staffId: v.optional(v.id("staff")),
    startAt: v.number(),
    // Set when the slot was drawn by dragging rather than picked from a service.
    durationMinutes: v.optional(v.number()),
    notes: v.optional(v.string()),
    // The person confirmed "Book it anyway?" over the verdict (or cal.com).
    force: v.optional(v.boolean()),
  },
  returns: writeResult,
  handler: async (ctx, args): Promise<WriteResult> => {
    const context = await ctx.runQuery(internal.schedule.loadWriteContext, {});
    if (!context) return { ok: false, reason: "no-org" };
    const { org } = context;

    const prepared: Prepared = await ctx.runMutation(internal.schedule.prepareCreate, {
      customerId: args.customerId,
      newCustomer: args.newCustomer,
      lines: args.lines,
      durationMinutes: args.durationMinutes,
      startAt: args.startAt,
      staffId: args.staffId,
      force: args.force,
    });
    // The calendar said no, before anything was written or cal.com asked.
    if (!prepared.ok) return refusedBy(prepared.verdict);

    let externalUid: string | undefined;
    // A goods-only booking (duration 0) never goes to cal.com: there is no
    // zero-length representation there, and it consumes no inventory cal.com
    // could be the source of truth about. It stays Resepta's alone.
    if (org.calcomApiKey && org.calcomEventTypeId && prepared.durationMinutes !== 0) {
      const booking = await createBooking({
        apiKey: org.calcomApiKey,
        eventTypeId: org.calcomEventTypeId,
        startIso: new Date(args.startAt).toISOString(),
        name: prepared.customerName,
        phone: prepared.phone,
        email: prepared.email,
        timeZone: org.timezone,
        language: org.language,
        lengthInMinutes: prepared.durationMinutes,
        allowConflicts: args.force,
        allowBookingOutOfBounds: args.force,
      });
      if (!booking.ok) {
        return {
          ok: false,
          reason: booking.reason,
          canForce: !args.force && overrulable(booking.reason),
        };
      }
      externalUid = booking.uid;
    }
    // No cal.com key: the appointment is Resepta's alone. Legitimate for an org
    // that has not connected a calendar yet, and the only reason externalUid is
    // optional everywhere downstream.

    const finished = await ctx.runMutation(internal.schedule.finishCreate, {
      orgId: prepared.orgId,
      customerId: prepared.customerId,
      items: prepared.items,
      staffId: args.staffId,
      startAt: args.startAt,
      durationMinutes: prepared.durationMinutes,
      notes: args.notes,
      externalUid,
      force: args.force,
    });
    if (!finished.ok) {
      // Only reachable without cal.com (finishCreate does not re-judge a
      // booking cal.com holds), but a slot it holds is let go regardless.
      if (externalUid && org.calcomApiKey) {
        await releaseHeldBooking({ apiKey: org.calcomApiKey, uid: externalUid });
      }
      return refusedBy(finished.verdict);
    }
    return { ok: true, appointmentId: finished.appointmentId };
  },
});

export const move = action({
  args: {
    appointmentId: v.id("appointments"),
    startAt: v.number(),
    // Dragging the bottom edge changes this; dragging the body does not.
    durationMinutes: v.optional(v.number()),
    // A new team member in the same save (the booking sheet's Team member
    // select): judged at the new time and written with it. Absent keeps who
    // it was; null unassigns.
    staffId: v.optional(v.union(v.id("staff"), v.null())),
    // The person confirmed "Move it anyway?" over the verdict (or cal.com).
    force: v.optional(v.boolean()),
  },
  returns: writeResult,
  handler: async (ctx, args): Promise<WriteResult> => {
    const context = await ctx.runQuery(internal.schedule.loadWriteContext, {
      appointmentId: args.appointmentId,
    });
    if (!context?.appointment) return { ok: false, reason: "not-found" };
    const org: Doc<"orgs"> = context.org;
    const appointment: Doc<"appointments"> = context.appointment;
    const durationChanged =
      args.durationMinutes !== undefined &&
      args.durationMinutes !== appointment.durationMinutes;
    const staffAfter =
      args.staffId === undefined ? appointment.staffId : (args.staffId ?? undefined);

    // The calendar's own verdict, for every business, before cal.com hears
    // of anything: a refusal then has nothing to undo.
    if (!args.force) {
      const verdict = await ctx.runQuery(internal.schedule.judge, {
        orgId: org._id,
        startAt: args.startAt,
        durationMinutes: args.durationMinutes ?? durationOf(appointment),
        customerId: appointment.customerId,
        ...(staffAfter ? { staffId: staffAfter } : {}),
        ignoreId: appointment._id,
      });
      if (verdict.conflict) return refusedBy(verdict);
    }

    let newUid: string | undefined;
    const providerConfirmed = Boolean(appointment.externalUid && org.calcomApiKey);
    if (appointment.externalUid && org.calcomApiKey) {
      if (!durationChanged) {
        const result = await rescheduleBooking({
          apiKey: org.calcomApiKey,
          uid: appointment.externalUid,
          startIso: new Date(args.startAt).toISOString(),
          reason: "Moved on the Resepta calendar",
          allowConflicts: args.force,
          allowBookingOutOfBounds: args.force,
        });
        if (!result.ok) {
          return {
            ok: false,
            reason: result.reason,
            canForce: !args.force && overrulable(result.reason),
          };
        }
        newUid = result.uid;
      } else {
        // cal.com's reschedule endpoint takes `start` and nothing else — a
        // booking's length belongs to its event type, and there is no endpoint
        // that changes it. So a resize is cancel-then-rebook.
        //
        // Cancel first, because rebooking the same window while the old booking
        // still holds it would collide with itself. That opens a gap where the
        // slot is free, so if the rebook fails we immediately restore the
        // original: same start, original length. Our own row is never touched
        // until a rebook succeeds, so a total failure leaves Resepta showing
        // exactly what cal.com still holds.
        if (!org.calcomEventTypeId) {
          return { ok: false, reason: "no-calendar-connected" };
        }
        const cancelled = await cancelBooking({
          apiKey: org.calcomApiKey,
          uid: appointment.externalUid,
          reason: "Replaced by a resize on the Resepta calendar",
        });
        if (!cancelled.ok) {
          return { ok: false, reason: cancelled.reason };
        }
        const customer = await ctx.runQuery(internal.schedule.loadCustomer, {
          customerId: appointment.customerId,
        });
        if (!customer) return { ok: false, reason: "customer-missing" };
        const rebooked = await createBooking({
          apiKey: org.calcomApiKey,
          eventTypeId: org.calcomEventTypeId,
          startIso: new Date(args.startAt).toISOString(),
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          timeZone: org.timezone,
          language: org.language,
          lengthInMinutes: args.durationMinutes,
          allowConflicts: args.force,
          allowBookingOutOfBounds: args.force,
        });
        if (!rebooked.ok) {
          const restored = await createBooking({
            apiKey: org.calcomApiKey,
            eventTypeId: org.calcomEventTypeId,
            startIso: new Date(appointment.startAt).toISOString(),
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            timeZone: org.timezone,
            language: org.language,
            lengthInMinutes: appointment.durationMinutes,
            allowConflicts: true,
            allowBookingOutOfBounds: true,
          });
          if (restored.ok && restored.uid) {
            // The slot is back, but under a new uid — write it or the next
            // cancel addresses a booking cal.com has retired.
            await ctx.runMutation(internal.schedule.markUid, {
              appointmentId: args.appointmentId,
              externalUid: restored.uid,
            });
          } else {
            // Both the rebook and the restore failed. Resepta still shows the
            // original, cal.com holds nothing, and only a human can reconcile
            // that — so say so out loud rather than leaving it in a log.
            await queueOrgAlert(ctx, {
              orgId: appointment.orgId,
              template: "failedCalendarCancel",
              who: customer.name,
              detail: `resize could not be restored: ${rebooked.reason} / ${restored.ok ? "no uid" : restored.reason}`,
            });
          }
          return {
            ok: false,
            reason: rebooked.reason,
            canForce: !args.force && overrulable(rebooked.reason),
          };
        }
        newUid = rebooked.uid;
      }
    }

    const finished = await ctx.runMutation(internal.schedule.finishMove, {
      appointmentId: args.appointmentId,
      startAt: args.startAt,
      durationMinutes: args.durationMinutes,
      externalUid: newUid,
      staffId: args.staffId,
      providerConfirmed,
      force: args.force,
    });
    if (!finished.ok) {
      return finished.verdict
        ? refusedBy(finished.verdict)
        : { ok: false, reason: finished.reason };
    }
    return { ok: true, appointmentId: args.appointmentId };
  },
});

// The move's write: the verdict once more in the transaction that writes, so
// nothing can take the slot between the action's look and this patch, then
// the shared reschedule (appointments.rescheduleAppointment: reminders
// re-armed, the confirmation again, quiet when the new start has passed).
// Not re-judged once cal.com has moved its copy (`providerConfirmed`), for
// the reason finishCreate gives.
export const finishMove = internalMutation({
  args: {
    appointmentId: v.id("appointments"),
    startAt: v.number(),
    durationMinutes: v.optional(v.number()),
    // cal.com's new uid: its reschedule mints a fresh booking.
    externalUid: v.optional(v.string()),
    staffId: v.optional(v.union(v.id("staff"), v.null())),
    providerConfirmed: v.optional(v.boolean()),
    force: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({
      ok: v.literal(false),
      reason: v.string(),
      verdict: v.optional(slotVerdictValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) return { ok: false as const, reason: "not-found" };
    if (args.staffId) {
      const staff = await ctx.db.get(args.staffId);
      if (!staff || staff.orgId !== appointment.orgId) {
        return { ok: false as const, reason: "not-found" };
      }
    }
    const staffAfter =
      args.staffId === undefined ? appointment.staffId : (args.staffId ?? undefined);
    if (!args.force && !args.providerConfirmed) {
      const org = await ctx.db.get(appointment.orgId);
      if (org) {
        const verdict = await judgeSlot(ctx, org, {
          startAt: args.startAt,
          durationMinutes: args.durationMinutes ?? durationOf(appointment),
          customerId: appointment.customerId,
          staffId: staffAfter,
          ignoreId: appointment._id,
        });
        if (verdict.conflict) {
          return { ok: false as const, reason: verdict.conflict, verdict };
        }
      }
    }
    if (args.staffId !== undefined && staffAfter !== appointment.staffId) {
      await ctx.db.patch(appointment._id, { staffId: staffAfter });
    }
    await rescheduleAppointment(ctx, appointment, {
      startAt: args.startAt,
      durationMinutes: args.durationMinutes,
      externalUid: args.externalUid,
    });
    return { ok: true as const };
  },
});

export const loadCustomer = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    return {
      name: `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
      phone: customer.phone,
      email: customer.email,
    };
  },
});

export const markUid = internalMutation({
  args: { appointmentId: v.id("appointments"), externalUid: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.appointmentId, { externalUid: args.externalUid });
    return null;
  },
});
