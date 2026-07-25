import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { appointmentStatus } from "./schema";
import { assertE164, requireOrg } from "./lib/orgAuth";

const enrichedAppointment = v.object({
  _id: v.id("appointments"),
  _creationTime: v.number(),
  customerId: v.id("customers"),
  startAt: v.number(),
  durationMinutes: v.optional(v.number()),
  status: appointmentStatus,
  staffName: v.optional(v.string()),
  notes: v.optional(v.string()),
  source: v.optional(
    v.union(
      v.literal("manual"),
      v.literal("calcom"),
      v.literal("voice"),
      v.literal("booking_page"),
    ),
  ),
  reminderSentOffsets: v.optional(v.array(v.number())),
  confirmationSentAt: v.optional(v.number()),
  customer: v.union(
    v.object({
      firstName: v.string(),
      lastName: v.optional(v.string()),
      phone: v.string(),
      consented: v.boolean(),
    }),
    v.null(),
  ),
  serviceName: v.optional(v.string()),
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
      const service = row.serviceId ? await ctx.db.get(row.serviceId) : null;
      out.push({
        _id: row._id,
        _creationTime: row._creationTime,
        customerId: row.customerId,
        startAt: row.startAt,
        durationMinutes: row.durationMinutes,
        status: row.status,
        staffName: row.staffName,
        notes: row.notes,
        source: row.source,
        reminderSentOffsets: row.reminderSentOffsets,
        confirmationSentAt: row.confirmationSentAt,
        customer: customer
          ? {
              firstName: customer.firstName,
              lastName: customer.lastName,
              phone: customer.phone,
              consented: customer.consentAt !== undefined,
            }
          : null,
        serviceName: service?.name,
      });
    }
    return out;
  },
});

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
    }),
  ),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect();
    rows.sort((a, b) => b.startAt - a.startAt);
    const out = [];
    for (const row of rows.slice(0, 50)) {
      const service = row.serviceId ? await ctx.db.get(row.serviceId) : null;
      out.push({
        _id: row._id,
        startAt: row.startAt,
        status: row.status,
        serviceName: service?.name,
        staffName: row.staffName,
      });
    }
    return out;
  },
});

// Shared by manual create and the cal.com intake: after a booking lands,
// queue the confirmation template if the org wants one and can send one.
export async function scheduleConfirmationIfConfigured(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  appointmentId: Id<"appointments">,
) {
  const org = await ctx.db.get(orgId);
  if (!org || org.sendBookingConfirmation === false) return;
  // No WhatsApp account is NOT a reason to skip the confirmation. The sender
  // attempts each channel independently, so an org with an email address and
  // no WABA still confirms its bookings; returning here meant an unconfigured
  // WhatsApp silently blocked the email lane too.
  await ctx.scheduler.runAfter(0, internal.wa.sendAppointmentMessage, {
    appointmentId,
    kind: "confirmation",
  });
}

export const create = mutation({
  args: {
    customerId: v.optional(v.id("customers")),
    // Quick-create straight from the booking form — the common path for a
    // walk-in salon; names optional-lite, phone mandatory.
    newCustomer: v.optional(
      v.object({
        firstName: v.string(),
        lastName: v.optional(v.string()),
        phone: v.string(),
        consent: v.boolean(),
      }),
    ),
    serviceId: v.optional(v.id("services")),
    startAt: v.number(),
    staffName: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.id("appointments"),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);

    let customerId = args.customerId;
    if (!customerId) {
      if (!args.newCustomer) throw new Error("customer-required");
      const phone = assertE164(args.newCustomer.phone);
      // Same phone → same person; reuse the row instead of erroring, so
      // booking a repeat customer by phone just works.
      const existing = await ctx.db
        .query("customers")
        .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
        .unique();
      customerId =
        existing?._id ??
        (await ctx.db.insert("customers", {
          orgId,
          firstName: args.newCustomer.firstName.trim() || phone,
          lastName: args.newCustomer.lastName?.trim() || undefined,
          phone,
          consentAt: args.newCustomer.consent ? Date.now() : undefined,
        }));
    } else {
      const customer = await ctx.db.get(customerId);
      if (!customer || customer.orgId !== orgId) throw new Error("not-found");
    }

    let durationMinutes: number | undefined;
    if (args.serviceId) {
      const service = await ctx.db.get(args.serviceId);
      if (!service || service.orgId !== orgId) throw new Error("not-found");
      durationMinutes = service.durationMinutes;
    }

    const appointmentId = await ctx.db.insert("appointments", {
      orgId,
      customerId,
      serviceId: args.serviceId,
      startAt: args.startAt,
      durationMinutes,
      status: "scheduled",
      staffName: args.staffName?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      source: "manual",
    });
    await scheduleConfirmationIfConfigured(ctx, orgId, appointmentId);
    return appointmentId;
  },
});

export const setStatus = mutation({
  args: { appointmentId: v.id("appointments"), status: appointmentStatus },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment || appointment.orgId !== orgId) throw new Error("not-found");
    await ctx.db.patch(args.appointmentId, { status: args.status });
    return null;
  },
});

export const reschedule = mutation({
  args: { appointmentId: v.id("appointments"), startAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment || appointment.orgId !== orgId) throw new Error("not-found");
    // A new time means the old reminders never happened: reset the sent
    // stamps, revive a cancelled row, and re-confirm.
    await ctx.db.patch(args.appointmentId, {
      startAt: args.startAt,
      reminderSentOffsets: [],
      confirmationSentAt: undefined,
      status:
        appointment.status === "cancelled" ? "scheduled" : appointment.status,
    });
    await scheduleConfirmationIfConfigured(ctx, orgId, args.appointmentId);
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

// Webhook-side transition (button tap / EVET / İPTAL). Not org-authed — the
// caller (webhook.ts) already resolved the org and passes the row it loaded.
export function nextUpcomingOf(
  appointments: Doc<"appointments">[],
  now: number,
  statuses: Doc<"appointments">["status"][],
): Doc<"appointments"> | undefined {
  return appointments
    .filter((a) => a.startAt > now && statuses.includes(a.status))
    .sort((a, b) => a.startAt - b.startAt)[0];
}
