import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOrg, assertE164 } from "./lib/orgAuth";
import { cancelBooking, createBooking, rescheduleBooking } from "./lib/calcomApi";
import { scheduleConfirmationIfConfigured } from "./appointments";
import { syncAppointmentSchedule } from "./lib/reminderSchedule";
import { recordActivity } from "./lib/activity";
import { queueOrgAlert } from "./lib/alerts";
import { recordCustomerCreated } from "./lib/newCustomer";

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
// A refusal that a human could legitimately overrule comes back with
// canForce: true, and the same call with force: true retries using cal.com's
// allowConflicts / allowBookingOutOfBounds. So cal.com is the source of truth
// right up to the point somebody deliberately overrules it, and overruling is a
// visible choice rather than a setting nobody remembers.

const writeResult = v.object({
  ok: v.boolean(),
  appointmentId: v.optional(v.id("appointments")),
  reason: v.optional(v.string()),
  // The UI offers "book anyway" only when cal.com refused for a reason a human
  // is entitled to overrule. A 401 is not that.
  canForce: v.optional(v.boolean()),
});

// cal.com's refusals that a salon owner may legitimately overrule: the slot is
// busy, or it is outside the hours cal.com knows about. Anything else (a bad
// key, a missing event type, a network failure) is ours to fix, and offering
// "book anyway" for those would just be a button that fails twice.
function overrulable(reason: string): boolean {
  return /http-(409|400)/.test(reason) && !/api.?key|unauthor/i.test(reason);
}

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

// Resolves the customer BEFORE cal.com is called, so the booking carries a real
// name. A cal.com failure therefore leaves a contact behind with no appointment,
// which is the right residue: you did meet this person, and the next attempt
// reuses the row rather than duplicating them.
export const prepareCreate = internalMutation({
  args: {
    customerId: v.optional(v.id("customers")),
    newCustomer: v.optional(
      v.object({
        firstName: v.string(),
        lastName: v.optional(v.string()),
        phone: v.string(),
        consent: v.boolean(),
      }),
    ),
    lines: v.optional(v.array(lineInput)),
    durationMinutes: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    let customerId = args.customerId;
    if (!customerId) {
      if (!args.newCustomer) throw new Error("customer-required");
      const phone = assertE164(args.newCustomer.phone);
      const existing = await ctx.db
        .query("customers")
        .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
        .unique();
      customerId = existing?._id;
      if (!customerId) {
        customerId = await ctx.db.insert("customers", {
          orgId,
          firstName: args.newCustomer.firstName.trim() || phone,
          lastName: args.newCustomer.lastName?.trim() || undefined,
          phone,
          consentAt: args.newCustomer.consent ? Date.now() : undefined,
        });
        // Typed into the booking sheet by somebody who is looking at it.
        await recordCustomerCreated(ctx, { orgId, customerId, source: "staff" });
      }
    } else {
      const customer = await ctx.db.get(customerId);
      if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    }
    const customer = await ctx.db.get(customerId);
    if (!customer) throw new Error("customer-failed");

    // Snapshotted here rather than at insert time so the cal.com round-trip
    // in between can't see a different price than the row ends up with.
    const items = await resolveLines(ctx, orgId, args.lines ?? []);

    // Duration precedence: an explicit drag beats what the services add up to.
    // Dragging a 30-minute cut out to 45 has to mean 45, or resize is a lie.
    let durationMinutes = args.durationMinutes;
    if (durationMinutes === undefined && items.length) {
      durationMinutes = items.reduce((sum, i) => sum + i.durationMinutes, 0);
    }
    return {
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
  },
  returns: v.id("appointments"),
  handler: async (ctx, args) => {
    if (args.staffId) {
      const staff = await ctx.db.get(args.staffId);
      if (!staff || staff.orgId !== args.orgId) throw new Error("not-found");
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
    await scheduleConfirmationIfConfigured(ctx, args.orgId, appointmentId);
    return appointmentId;
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
        consent: v.boolean(),
      }),
    ),
    lines: v.optional(v.array(lineInput)),
    staffId: v.optional(v.id("staff")),
    startAt: v.number(),
    // Set when the slot was drawn by dragging rather than picked from a service.
    durationMinutes: v.optional(v.number()),
    notes: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  returns: writeResult,
  handler: async (ctx, args): Promise<{
    ok: boolean;
    appointmentId?: Id<"appointments">;
    reason?: string;
    canForce?: boolean;
  }> => {
    const context = await ctx.runQuery(internal.schedule.loadWriteContext, {});
    if (!context) return { ok: false, reason: "no-org" };
    const { org } = context;

    const prepared = await ctx.runMutation(internal.schedule.prepareCreate, {
      customerId: args.customerId,
      newCustomer: args.newCustomer,
      lines: args.lines,
      durationMinutes: args.durationMinutes,
    });

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

    const appointmentId = await ctx.runMutation(internal.schedule.finishCreate, {
      orgId: prepared.orgId,
      customerId: prepared.customerId,
      items: prepared.items,
      staffId: args.staffId,
      startAt: args.startAt,
      durationMinutes: prepared.durationMinutes,
      notes: args.notes,
      externalUid,
    });
    return { ok: true, appointmentId };
  },
});

export const move = action({
  args: {
    appointmentId: v.id("appointments"),
    startAt: v.number(),
    // Dragging the bottom edge changes this; dragging the body does not.
    durationMinutes: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  returns: writeResult,
  handler: async (ctx, args): Promise<{
    ok: boolean;
    appointmentId?: Id<"appointments">;
    reason?: string;
    canForce?: boolean;
  }> => {
    const context = await ctx.runQuery(internal.schedule.loadWriteContext, {
      appointmentId: args.appointmentId,
    });
    if (!context?.appointment) return { ok: false, reason: "not-found" };
    const { org, appointment } = context;
    const durationChanged =
      args.durationMinutes !== undefined &&
      args.durationMinutes !== appointment.durationMinutes;

    let newUid: string | undefined;
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

    await ctx.runMutation(internal.appointments.markRescheduled, {
      appointmentId: args.appointmentId,
      startAt: args.startAt,
      durationMinutes: args.durationMinutes,
      externalUid: newUid,
    });
    return { ok: true, appointmentId: args.appointmentId };
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
