import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { appointmentStatus } from "./schema";
import { requireOrg } from "./lib/orgAuth";
import { isDeleting } from "./lib/customerDeletion";
import { getLocalPartsSafe } from "./lib/businessHours";
import { loadOrgRules, syncAppointmentSchedule } from "./lib/reminderSchedule";
import { recordActivity, statusChange } from "./lib/activity";
import { formatAppointmentTime } from "./lib/format";
import { queueOrgAlert } from "./lib/alerts";
import { slotVerdictValidator, type SlotVerdict } from "./lib/slotVerdict";

// A line as the client asks for it: which service, and optionally what it
// actually cost this time. Everything else on the stored line — the name, the
// duration — is resolved SERVER-side from the service, so a client can't
// invent a service called "Free" or a zero-minute haircut.
const lineInput = v.object({
  serviceId: v.id("services"),
  price: v.optional(v.number()),
  // Goods only ("3 chocolate cakes" is one line, quantity 3). Ignored on
  // time-bound services — two haircuts is two visits.
  quantity: v.optional(v.number()),
});

const storedItem = v.object({
  serviceId: v.optional(v.id("services")),
  name: v.string(),
  price: v.optional(v.number()),
  durationMinutes: v.number(),
  quantity: v.optional(v.number()),
});

type StoredItem = {
  serviceId?: Id<"services">;
  name: string;
  price?: number;
  durationMinutes: number;
  quantity?: number;
};

// Client lines -> stored snapshot lines. The price falls back to the service's
// list price; passing one explicitly IS the discount, which is why there is no
// separate override field anywhere in this file.
async function resolveLines(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  lines: { serviceId: Id<"services">; price?: number; quantity?: number }[],
): Promise<StoredItem[]> {
  const items: StoredItem[] = [];
  for (const line of lines) {
    const service = await ctx.db.get(line.serviceId);
    if (!service || service.orgId !== orgId) throw new Error("not-found");
    const price = line.price ?? service.price;
    // A good's line stores duration 0 — it adds no time to the visit — and
    // may carry a quantity. Time-bound lines never do.
    const isGood = service.durationMinutes === undefined;
    const quantity =
      isGood && line.quantity !== undefined
        ? Math.min(99, Math.max(1, Math.round(line.quantity)))
        : 1;
    items.push({
      serviceId: service._id,
      name: service.name,
      // Whole minor units only, and never negative — a sum is trustworthy
      // only if nothing feeding it can be a fraction.
      ...(price !== undefined ? { price: Math.max(0, Math.round(price)) } : {}),
      durationMinutes: service.durationMinutes ?? 0,
      ...(quantity > 1 ? { quantity } : {}),
    });
  }
  return items;
}

// What a line is worth: unit price × how many. The helper exists so no summer
// ever multiplies in one place and forgets in another.
export function lineWorth(item: StoredItem): number | undefined {
  if (item.price === undefined) return undefined;
  return item.price * (item.quantity ?? 1);
}

// What the block prints. Two services read "Sac kesimi, Sakal tirasi"; the
// callers that have to fit it in a 30-minute block truncate their own copy.
export function itemsLabel(items: StoredItem[] | undefined): string | undefined {
  if (!items?.length) return undefined;
  return items
    .map((i) => ((i.quantity ?? 1) > 1 ? `${i.quantity}× ${i.name}` : i.name))
    .join(", ");
}

// The visit's total. Undefined when NO line carries a price — "nothing was
// priced" and "this visit was free" are different facts and a bare 0 says the
// wrong one. Lines that are individually unpriced count as zero within a
// visit that has any price at all.
export function itemsTotal(items: StoredItem[] | undefined): number | undefined {
  if (!items?.length) return undefined;
  if (items.every((i) => i.price === undefined)) return undefined;
  return items.reduce((sum, i) => sum + (lineWorth(i) ?? 0), 0);
}

const enrichedAppointment = v.object({
  _id: v.id("appointments"),
  _creationTime: v.number(),
  customerId: v.id("customers"),
  startAt: v.number(),
  durationMinutes: v.optional(v.number()),
  status: appointmentStatus,
  staffId: v.optional(v.id("staff")),
  // Resolved from the staff row. The calendar lanes on staffId; this is only
  // what the block prints.
  staffName: v.optional(v.string()),
  notes: v.optional(v.string()),
  externalUid: v.optional(v.string()),
  source: v.optional(
    v.union(
      v.literal("manual"),
      v.literal("calcom"),
      v.literal("voice"),
      v.literal("booking_page"),
      v.literal("chat"),
    ),
  ),
  reminderSentOffsets: v.optional(v.array(v.number())),
  confirmationSentAt: v.optional(v.number()),
  customer: v.union(
    v.object({
      firstName: v.string(),
      lastName: v.optional(v.string()),
      phone: v.string(),
    }),
    v.null(),
  ),
  serviceName: v.optional(v.string()),
  items: v.optional(v.array(storedItem)),
  total: v.optional(v.number()),
  // Goods-only orders from the booking page: how the order reaches its
  // customer. The sheet reports it read-only; the write side stays public
  // (convex/booking.ts book).
  fulfillment: v.optional(
    v.object({
      kind: v.union(v.literal("pickup"), v.literal("delivery")),
      asap: v.optional(v.boolean()),
      address: v.optional(v.string()),
    }),
  ),
});

// Just the start times, for the year grid's dots.
//
// listRange resolves a customer and a staff row per appointment, which is right
// for a grid that prints names and wrong for one asking "is anything booked on
// this day" 366 times: a year of bookings would be thousands of document reads
// to draw a 4px circle. This is one index scan and nothing else.
//
// Bucketed to local midnight on the CLIENT rather than here, because "which
// day" is a question about the reader's clock and the server does not have it.
export const startsInRange = query({
  args: {
    fromMs: v.number(),
    toMs: v.number(),
    // The calendar side panel's filters (CalendarPanel), so the year's dots
    // agree with the ticks beside them. Absent = everyone and everything, the
    // same "empty means all" the panel stores. Filtered here rather than by
    // returning each row's staff and services: the answer stays a list of
    // numbers, and the filter is in the subscription's args.
    //
    // A team member's id, or "unassigned" for a booking with nobody on it.
    staffIds: v.optional(v.array(v.string())),
    // A booking passes when any of its lines is one of these services.
    serviceIds: v.optional(v.array(v.string())),
  },
  returns: v.array(v.number()),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startAt", args.fromMs).lt("startAt", args.toMs),
      )
      // A year of a busy salon, with room. Past this the dots stop being the
      // interesting part and the month view is the honest answer.
      .take(5000);
    const staffIds = args.staffIds ? new Set(args.staffIds) : null;
    const serviceIds = args.serviceIds ? new Set(args.serviceIds) : null;
    // Cancelled bookings leave no dot: the point of the year is where the shop
    // is committed, and a cancellation is the opposite of a commitment.
    return rows
      .filter((row) => row.status !== "cancelled")
      .filter((row) => !staffIds || staffIds.has(row.staffId ?? "unassigned"))
      .filter(
        (row) =>
          !serviceIds ||
          (row.items ?? []).some((item) => item.serviceId && serviceIds.has(item.serviceId)),
      )
      .map((row) => row.startAt);
  },
});

export const listRange = query({
  args: { fromMs: v.number(), toMs: v.number() },
  returns: v.array(enrichedAppointment),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startAt", args.fromMs).lt("startAt", args.toMs),
      )
      .take(500);
    const out = [];
    for (const row of rows) {
      const customer = await ctx.db.get(row.customerId);
      // Off the calendar the moment its customer is deleted; the deletion
      // removes the row itself a moment later.
      if (customer && isDeleting(customer)) continue;
      const staff = row.staffId ? await ctx.db.get(row.staffId) : null;
      out.push({
        _id: row._id,
        _creationTime: row._creationTime,
        customerId: row.customerId,
        startAt: row.startAt,
        durationMinutes: row.durationMinutes,
        status: row.status,
        staffId: row.staffId,
        staffName: staff?.name,
        notes: row.notes,
        externalUid: row.externalUid,
        source: row.source,
        reminderSentOffsets: row.reminderSentOffsets,
        confirmationSentAt: row.confirmationSentAt,
        customer: customer
          ? {
              firstName: customer.firstName,
              lastName: customer.lastName,
              phone: customer.phone,
            }
          : null,
        serviceName: itemsLabel(row.items),
        items: row.items,
        total: itemsTotal(row.items),
        fulfillment: row.fulfillment,
      });
    }
    return out;
  },
});

// The template preview used to run on a real booking chosen here — the third
// answer to a sample that invented names and prices, after "refuse to draw"
// and "invent everything". It went on 2026-08-19: the preview now invents the
// PERSON and reads the salon's own service catalogue for everything that
// could be mistaken for its data. Nobody's real name appears in a settings
// screen to make a template legible.

// The contact page's history pane: this customer's appointments, newest first.
export const listForCustomer = query({
  args: { customerId: v.id("customers") },
  returns: v.array(
    v.object({
      _id: v.id("appointments"),
      startAt: v.number(),
      status: appointmentStatus,
      serviceName: v.optional(v.string()),
      staffName: v.optional(v.string()),
      total: v.optional(v.number()),
      // Everything below is for EDITING rather than reading. The record used
      // to return only what its list printed, so a booking on a contact card
      // could be looked at and nothing else: no reschedule, no change of
      // service, no cancel, on the one screen where you have the customer in
      // front of you. The calendar's own listRange has always carried these;
      // this is the same booking and it needs the same handles.
      durationMinutes: v.optional(v.number()),
      staffId: v.optional(v.id("staff")),
      notes: v.optional(v.string()),
      // Snapshotted lines, not ids resolved fresh: the sheet has to show what
      // this visit recorded, not what the service costs today.
      items: v.optional(v.array(storedItem)),
    }),
  ),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    // Empty rather than a throw, for the reason spelled out in
    // messages.feedForCustomer: the contact page asks both queries about one
    // id, and that id outlives a workspace switch.
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return [];
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect();
    rows.sort((a, b) => b.startAt - a.startAt);
    const out = [];
    for (const row of rows.slice(0, 50)) {
      const staff = row.staffId ? await ctx.db.get(row.staffId) : null;
      out.push({
        _id: row._id,
        startAt: row.startAt,
        status: row.status,
        serviceName: itemsLabel(row.items),
        staffName: staff?.name,
        total: itemsTotal(row.items),
        durationMinutes: row.durationMinutes,
        staffId: row.staffId,
        notes: row.notes,
        items: row.items,
      });
    }
    return out;
  },
});

// The two message triggers that fire on an EVENT rather than a clock: a
// booking landing, an appointment being cancelled. Shared by every path that
// causes either — manual create, the cal.com intake, the voice agent, the
// WhatsApp İPTAL reply — so the answer to "does this org say something now?"
// lives in exactly one place.
//
// No WhatsApp account is NOT a reason to skip a send. The sender attempts
// each channel independently, so an org with an email address and no WABA
// still confirms its bookings; returning early here once meant an
// unconfigured WhatsApp silently blocked the email lane too.
export async function scheduleLifecycleMessages(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  appointmentId: Id<"appointments">,
  trigger: "booking" | "cancellation",
  options?: {
    // retryConfirmationsAwaitingEmail re-fires the CUSTOMER's confirmation
    // when their email arrives late; the owner already heard about that
    // booking the first time through and must not hear about it again.
    suppressOwnerAlert?: boolean;
    // A person in the business made this change in the app (a cancel from
    // the calendar or the list). On an appointment that has already started
    // that is the record being kept, and the customer hears nothing (below).
    byBusiness?: boolean;
  },
  // How many messages to the CUSTOMER were scheduled: one per live rule on
  // this trigger. Scheduled is not delivered: the assistants pair a nonzero
  // count with lib/lifecycleSend.lifecycleReaches, the send path's own
  // predicates, before they treat the business's message as on its way.
): Promise<number> {
  const org = await ctx.db.get(orgId);
  if (!org) return 0;
  const appointment = await ctx.db.get(appointmentId);
  // Every booking the customer hears about carries a manage token, whichever
  // door it came in through — [manage_link] in a confirmation has to resolve
  // for a voice booking and a hand-typed one, not only for the booking page
  // (which mints its own at insert).
  if (trigger === "booking") {
    if (appointment && appointment.manageToken === undefined) {
      await ctx.db.patch(appointmentId, { manageToken: crypto.randomUUID() });
    }
  }
  // The salon's own side of the event: an email whose calendar invite puts
  // the booking on the reader's calendar (REQUEST), and takes it off again
  // when it dies (CANCEL). newBooking rides users.notifyNewBooking with the
  // same door-based rule as notifyNewContact: only bookings nobody in the
  // salon typed — booking page, voice, chat, cal.com — alert; the grid's own
  // entries are an echo of the reader's typing. A reschedule passes back
  // through the booking trigger, so the invite goes again at its bumped
  // icsSequence and the calendar entry moves.
  //
  // bookingCancelled rides its own switch, and its gate is WHO CANCELLED,
  // not who created: every in-app cancel arrives here with suppressOwnerAlert
  // set, so what remains is customer-caused — including a hand-typed booking
  // the customer kills through their manage link, which is exactly as much
  // news as any other cancellation. The source gate stays on the booking
  // trigger only.
  if (
    appointment &&
    !options?.suppressOwnerAlert &&
    (trigger === "cancellation" ||
      (appointment.source && appointment.source !== "manual"))
  ) {
    const customer = await ctx.db.get(appointment.customerId);
    await queueOrgAlert(ctx, {
      orgId,
      template: trigger === "booking" ? "newBooking" : "bookingCancelled",
      who:
        [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") ||
        customer?.phone ||
        "?",
      detail: formatAppointmentTime(appointment.startAt, org.timezone, org.language),
      appointmentId,
      icsMethod: trigger === "booking" ? "REQUEST" : "CANCEL",
    });
  }
  // PAST BOOKINGS ARE QUIET (2026-10-13, Nudge c8e1e523). An appointment
  // whose start has passed is a record being kept, not news for the
  // customer: logging yesterday's walk-in, or moving a booking into the past,
  // sends no confirmation, and a cancel the business makes on one sends no
  // notice. Only staff can put a booking in the past (every customer-facing
  // door refuses it), and a customer's own late cancel still gets its answer.
  // Reminders already skip the past (wa.sendAppointmentMessage). An ASAP
  // order's startAt records when it was placed, not a time it is for, so it
  // is never "past" here: its confirmation is the reply to the order.
  const started =
    appointment !== null &&
    !appointment.fulfillment?.asap &&
    appointment.startAt <= Date.now();
  if (started && (trigger === "booking" || options?.byBusiness === true)) {
    return 0;
  }
  // Every matching live rule fires — two booking messages is a choice the
  // owner made by having two rows, not a bug to dedupe away.
  //
  // The legacy branch that used to follow this (sendBookingConfirmation +
  // removedRules, for orgs without rulesMigratedAt) is gone: migrateAll has run
  // in prod, seedDefaultRules stamps every new org migrated at creation, and two
  // maintained answers to "what should fire on booking" was one too many.
  const rules = await loadOrgRules(ctx, orgId);
  let scheduled = 0;
  for (const rule of rules) {
    if (rule.trigger !== trigger || rule.paused) continue;
    await ctx.scheduler.runAfter(0, internal.wa.sendAppointmentMessage, {
      appointmentId,
      kind: trigger === "booking" ? "confirmation" : "cancellation",
      ruleId: rule._id,
    });
    scheduled += 1;
  }
  return scheduled;
}

// A confirmation that failed only because the customer had no email yet is
// debt the email's ARRIVAL repays. The voice agent asks for the address
// AFTER booking (deliberately — a booking must not wait on someone spelling
// their email), so the booking-time send finds an empty column and files
// no-email-address (live, Bella, 18 Aug 2026). Called wherever an email
// lands on a customer: re-fires the booking rules for each FUTURE
// appointment whose confirmations ALL failed. The all-failed guard is what
// makes re-firing safe — if any channel already carried a confirmation
// (a delivered WhatsApp, say), nothing re-fires and nobody hears about the
// same booking twice.
export async function retryConfirmationsAwaitingEmail(
  ctx: MutationCtx,
  customerId: Id<"customers">,
) {
  const rows = await ctx.db
    .query("messages")
    .withIndex("by_customer", (q) => q.eq("customerId", customerId))
    .collect();
  const byAppointment = new Map<string, Doc<"messages">[]>();
  for (const message of rows) {
    if (message.kind !== "confirmation" || !message.appointmentId) continue;
    const bucket = byAppointment.get(message.appointmentId) ?? [];
    bucket.push(message);
    byAppointment.set(message.appointmentId, bucket);
  }
  for (const [appointmentId, attempts] of byAppointment) {
    const awaiting = attempts.some(
      (message) => message.status === "failed" && message.error === "no-email-address",
    );
    const carried = attempts.some((message) => message.status !== "failed");
    if (!awaiting || carried) continue;
    const appointment = await ctx.db.get(appointmentId as Id<"appointments">);
    if (!appointment || appointment.startAt <= Date.now()) continue;
    if (appointment.status !== "scheduled" && appointment.status !== "confirmed") {
      continue;
    }
    await scheduleLifecycleMessages(ctx, appointment.orgId, appointment._id, "booking", {
      // The customer's confirmation is the debt being repaid here; the owner
      // was told at booking time and this re-fire is not news to them.
      suppressOwnerAlert: true,
    });
  }
}

// The old name, kept callable while every intake path moves over.
export async function scheduleConfirmationIfConfigured(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  appointmentId: Id<"appointments">,
): Promise<number> {
  return await scheduleLifecycleMessages(ctx, orgId, appointmentId, "booking");
}

export const setStatus = mutation({
  args: { appointmentId: v.id("appointments"), status: appointmentStatus },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId, user } = await requireOrg(ctx);
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment || appointment.orgId !== orgId) throw new Error("not-found");

    // A cal.com-backed cancellation goes through cal.com FIRST, the order the
    // header below states and the voice and WhatsApp lanes already follow. This
    // is the lane staff actually use — the booking sheet's Cancel button — and
    // it was the only one that wrote the status locally and stopped there. The
    // slot stayed blocked in cal.com's inventory, the entry stayed on the
    // salon's Google Calendar, and cal.com kept sending its own reminders for a
    // visit nobody was attending.
    //
    // Returning here means the row does not flip until the action lands, which
    // is the point: if cal.com refuses, the appointment stays as it was and the
    // owner is told, because Resepta showing "cancelled" over a slot cal.com
    // still holds is the worse of the two failures.
    if (
      args.status === "cancelled" &&
      appointment.status !== "cancelled" &&
      appointment.externalUid
    ) {
      await ctx.scheduler.runAfter(0, internal.calcom.pushCancelToCalcom, {
        appointmentId: args.appointmentId,
        orgId,
        externalUid: appointment.externalUid,
        who: user.name ?? user.email ?? "staff",
        reason: "Cancelled by the salon",
        actor: user.name ?? user.email ?? "staff",
      });
      return null;
    }

    await ctx.db.patch(args.appointmentId, { status: args.status });
    // Status decides what is owed: marking a no_show arms the winback,
    // cancelling disarms every reminder still queued behind it.
    await syncAppointmentSchedule(ctx, args.appointmentId);
    // On the TRANSITION only — re-saving an already-cancelled appointment is
    // not a second cancellation and must not message the customer twice.
    // suppressOwnerAlert: everyone who reaches this mutation is inside the
    // app cancelling by hand; the customer still hears, the salon does not
    // get an email about its own tap.
    if (args.status === "cancelled" && appointment.status !== "cancelled") {
      await scheduleLifecycleMessages(ctx, orgId, args.appointmentId, "cancellation", {
        suppressOwnerAlert: true,
        // A person in the business, so a past appointment cancels quietly.
        byBusiness: true,
      });
    }
    await recordActivity(ctx, {
      orgId,
      kind: "appointment_status",
      customerId: appointment.customerId,
      appointmentId: args.appointmentId,
      detail: statusChange(appointment.status, args.status),
    });
    return null;
  },
});

export const remove = mutation({
  args: { appointmentId: v.id("appointments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment || appointment.orgId !== orgId) throw new Error("not-found");
    await ctx.db.delete(args.appointmentId);
    // Logged AFTER the delete but carrying the ids, because this is the one
    // event where the row it describes no longer exists to be looked up.
    await recordActivity(ctx, {
      orgId,
      kind: "appointment_deleted",
      customerId: appointment.customerId,
      appointmentId: args.appointmentId,
    });
    return null;
  },
});

export const stampConfirmationSent = internalMutation({
  args: { appointmentId: v.id("appointments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId);
    if (appointment) {
      await ctx.db.patch(args.appointmentId, { confirmationSentAt: Date.now() });
    }
    return null;
  },
});

// ---- Writes that follow a cal.com confirmation ----
//
// Both lanes (voice via http.ts, WhatsApp via the pushCancelToCalcom action)
// call cal.com FIRST and only then land here. cal.com owns the slot inventory,
// the salon's Google Calendar and the notification emails, so a status written
// before cal.com agrees is a slot the salon holds for someone who is not
// coming. Never patch status straight from a webhook handler again.

export const markCancelled = internalMutation({
  args: {
    appointmentId: v.id("appointments"),
    // Present when a person inside the salon started this, absent when the
    // customer or cal.com did. Carries the feed entry that setStatus would have
    // written itself, had it been allowed to write the status directly.
    actor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) return null;
    await cancelAppointment(ctx, appointment, args.actor);
    return null;
  },
});

// The cancellation write itself, shared by markCancelled and the assistants'
// own cancel (agentAppointments.cancelOwn), so a cancel by phone, by chat and
// by cal.com's echo all retire the reminders and tell the same people.
// Returns how many messages to the customer it scheduled (none when the row
// was already cancelled).
export async function cancelAppointment(
  ctx: MutationCtx,
  appointment: Doc<"appointments">,
  actor?: string,
): Promise<number> {
  const wasCancelled = appointment.status === "cancelled";
  let scheduled = 0;
  await ctx.db.patch(appointment._id, { status: "cancelled" });
  await syncAppointmentSchedule(ctx, appointment._id);
  // cal.com can deliver the same cancellation more than once (the push we
  // initiated comes straight back as a webhook); the notice must not.
  if (!wasCancelled) {
    // actor present = somebody inside the salon started this cancellation
    // (the cal.com push carries their name back here); their own act must
    // not email them. Absent means the customer or cal.com did it, and the
    // booking-cancelled alert is exactly for that.
    scheduled = await scheduleLifecycleMessages(
      ctx,
      appointment.orgId,
      appointment._id,
      "cancellation",
      // actor present = the business's own cancel, quiet on a past
      // appointment like setStatus's.
      { suppressOwnerAlert: actor !== undefined, byBusiness: actor !== undefined },
    );
    if (actor !== undefined) {
      await recordActivity(ctx, {
        orgId: appointment.orgId,
        kind: "appointment_status",
        customerId: appointment.customerId,
        appointmentId: appointment._id,
        detail: statusChange(appointment.status, "cancelled"),
      });
    }
  }
  return scheduled;
}

// The move write itself, shared by the calendar's move (schedule.finishMove,
// which also took over markRescheduled's cal.com echo) and the assistants'
// own move (agentAppointments.moveOwn). It checks nothing: every caller
// decided the new time is allowed before it got here, and each decides
// differently (the calendar's verdict or a person's "move it anyway",
// cal.com's word, the booking page's rules at the moment of the change).
// externalUid moves because cal.com's reschedule mints a new booking and
// retires the uid we were holding. Returns how many messages to the customer
// it scheduled (the confirmation again, at the new time; none when that time
// has already passed).
export async function rescheduleAppointment(
  ctx: MutationCtx,
  appointment: Doc<"appointments">,
  args: { startAt: number; durationMinutes?: number; externalUid?: string },
): Promise<number> {
  await ctx.db.patch(appointment._id, {
    startAt: args.startAt,
    // A new time invalidates the reminders already sent for the old one.
    status: "scheduled",
    reminderSentOffsets: [],
    confirmationSentAt: undefined,
    // The re-confirmation's invite must outrank the one already in the
    // customer's mailbox (schema: icsSequence).
    icsSequence: (appointment.icsSequence ?? 0) + 1,
    ...(args.durationMinutes !== undefined
      ? { durationMinutes: args.durationMinutes }
      : {}),
    ...(args.externalUid ? { externalUid: args.externalUid } : {}),
  });
  // New time, cleared offsets — every reminder is owed again from scratch.
  await syncAppointmentSchedule(ctx, appointment._id);
  const org = await ctx.db.get(appointment.orgId);
  await recordActivity(ctx, {
    orgId: appointment.orgId,
    kind: "appointment_moved",
    customerId: appointment.customerId,
    appointmentId: appointment._id,
    // Rendered in the org's own timezone and language: a reader checking who
    // moved a booking wants the time the salon works in, not a UTC stamp.
    detail: org
      ? formatAppointmentTime(args.startAt, org.timezone, org.language)
      : undefined,
  });
  return await scheduleConfirmationIfConfigured(ctx, appointment.orgId, appointment._id);
}

export function nextUpcomingOf(
  appointments: Doc<"appointments">[],
  now: number,
  statuses: Doc<"appointments">["status"][],
): Doc<"appointments"> | undefined {
  return appointments
    .filter((a) => a.startAt > now && statuses.includes(a.status))
    .sort((a, b) => a.startAt - b.startAt)[0];
}

// Everything the appointment modal edits that cal.com has no opinion about.
// Time and duration are NOT here — those go through schedule.move, because
// cal.com owns them and has to agree first. So does a new team member when
// the time moves in the same save: the move judges the person at the new
// time and writes both.
export const updateDetails = mutation({
  args: {
    appointmentId: v.id("appointments"),
    // The WHOLE line set, replaced. Not a per-index patch: rows get added and
    // removed in the modal, and index-based edits against a list that shifts
    // under them is how the wrong line gets the discount.
    lines: v.optional(v.array(lineInput)),
    staffId: v.optional(v.union(v.id("staff"), v.null())),
    notes: v.optional(v.string()),
    status: v.optional(appointmentStatus),
    // The person confirmed "Save it anyway?" over the new team member's own
    // clash (the calendar's verdict, P6).
    force: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), reason: v.string(), verdict: slotVerdictValidator }),
  ),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment || appointment.orgId !== orgId) throw new Error("not-found");
    const patch: Record<string, unknown> = {};
    if (args.lines !== undefined) {
      patch.items = await resolveLines(ctx, orgId, args.lines);
      // Changing the services does NOT silently restretch the block: the
      // duration on the row may have been drawn by hand, and cal.com would
      // have to agree to a new length anyway. The modal offers the services'
      // combined duration as a separate, explicit resize.
    }
    if (args.staffId !== undefined) {
      if (args.staffId === null) patch.staffId = undefined;
      else {
        const staff = await ctx.db.get(args.staffId);
        if (!staff || staff.orgId !== orgId) throw new Error("not-found");
        // Giving an open booking to someone who already has one then
        // double-books a person: the calendar's verdict judges it, and only
        // that (the time is not moving, so the slot's other facts are not
        // news). Through a query, because schedule.ts imports this module.
        const open = appointment.status === "scheduled" || appointment.status === "confirmed";
        if (open && args.staffId !== appointment.staffId && !args.force) {
          // Annotated: schedule.ts imports this module, and the inferred type
          // would chase itself round the generated api.
          const verdict: SlotVerdict = await ctx.runQuery(internal.schedule.judge, {
            orgId,
            startAt: appointment.startAt,
            durationMinutes:
              appointment.durationMinutes ??
              appointment.items?.reduce((sum, item) => sum + item.durationMinutes, 0) ??
              30,
            staffId: args.staffId,
            ignoreId: appointment._id,
            staffOnly: true,
          });
          if (verdict.conflict) {
            return { ok: false as const, reason: verdict.conflict, verdict };
          }
        }
        patch.staffId = args.staffId;
      }
    }
    if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined;
    if (args.status !== undefined) patch.status = args.status;
    await ctx.db.patch(args.appointmentId, patch);
    if (args.status !== undefined && args.status !== appointment.status) {
      await syncAppointmentSchedule(ctx, args.appointmentId);
      await recordActivity(ctx, {
        orgId,
        kind: "appointment_status",
        customerId: appointment.customerId,
        appointmentId: args.appointmentId,
        detail: statusChange(appointment.status, args.status),
      });
    }
    return { ok: true as const };
  },
});

// Yesterday's bookings are done. Status used to move ONLY by hand, from a
// hover menu that renders in list view alone — so a salon that never opened
// that menu carried every past appointment as a live booking forever, and the
// two greens on the calendar decayed into one colour that meant nothing.
//
// no_show survives as the deliberate exception, and it is not cosmetic:
// reminders.tick sends a win-back only for no_show, so it is the one status
// worth a tap. Completing is the boring 95% and the machine can do it.
//
// The cut is the END OF THE DAY in the ORG's timezone, not startAt + duration.
// An owner has until closing to mark who didn't turn up; marking someone
// completed while they are still in the chair would be worse than waiting.
// Reads by (status, startAt) so it sees ONLY bookings still sitting live in
// the past — the set it might actually change, which drains as it works rather
// than growing with the calendar. Reading the whole two-week window and
// discarding the settled rows was work proportional to how many orgs exist,
// and the .take() that bounded it truncated in silence: past enough salons,
// the ones sorting last never completed at all. Same failure the reminder scan
// had (see lib/reminderSchedule.ts).
export const completePast = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const orgCache = new Map<Id<"orgs">, Doc<"orgs"> | null>();
    // Two weeks covers a salon that was away; anything older is a backlog no
    // cron should quietly rewrite.
    const from = now - 14 * 24 * 3600_000;
    let handled = 0;

    for (const status of ["scheduled", "confirmed"] as const) {
      const past = await ctx.db
        .query("appointments")
        .withIndex("by_status_start", (q) =>
          q.eq("status", status).gt("startAt", from).lt("startAt", now),
        )
        .take(500);
      for (const appointment of past) {
        let org = orgCache.get(appointment.orgId);
        if (org === undefined) {
          org = await ctx.db.get(appointment.orgId);
          orgCache.set(appointment.orgId, org);
        }
        if (!org) continue;
        const then = getLocalPartsSafe(appointment.startAt, org.timezone);
        const today = getLocalPartsSafe(now, org.timezone);
        const sameDay = then.y === today.y && then.m0 === today.m0 && then.d === today.d;
        if (sameDay) continue;
        await ctx.db.patch(appointment._id, { status: "completed" });
        // Completing settles the booking: no reminder is owed any more, and a
        // stale due time would keep the row in the cron's read forever.
        await syncAppointmentSchedule(ctx, appointment._id);
        handled += 1;
      }
    }

    // Drained a full page of one status — come back rather than waiting an
    // hour with a backlog still standing.
    if (handled >= 500) {
      await ctx.scheduler.runAfter(0, internal.appointments.completePast, {});
    }
    return null;
  },
});
