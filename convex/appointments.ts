import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { appointmentStatus } from "./schema";
import { assertE164, requireOrg } from "./lib/orgAuth";
import { getLocalPartsSafe } from "./lib/businessHours";

// A line as the client asks for it: which service, and optionally what it
// actually cost this time. Everything else on the stored line — the name, the
// duration — is resolved SERVER-side from the service, so a client can't
// invent a service called "Free" or a zero-minute haircut.
const lineInput = v.object({
  serviceId: v.id("services"),
  price: v.optional(v.number()),
});

const storedItem = v.object({
  serviceId: v.optional(v.id("services")),
  name: v.string(),
  price: v.optional(v.number()),
  durationMinutes: v.number(),
});

type StoredItem = {
  serviceId?: Id<"services">;
  name: string;
  price?: number;
  durationMinutes: number;
};

// Client lines -> stored snapshot lines. The price falls back to the service's
// list price; passing one explicitly IS the discount, which is why there is no
// separate override field anywhere in this file.
async function resolveLines(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  lines: { serviceId: Id<"services">; price?: number }[],
): Promise<StoredItem[]> {
  const items: StoredItem[] = [];
  for (const line of lines) {
    const service = await ctx.db.get(line.serviceId);
    if (!service || service.orgId !== orgId) throw new Error("not-found");
    const price = line.price ?? service.price;
    items.push({
      serviceId: service._id,
      name: service.name,
      // Whole minor units only, and never negative — a sum is trustworthy
      // only if nothing feeding it can be a fraction.
      ...(price !== undefined ? { price: Math.max(0, Math.round(price)) } : {}),
      durationMinutes: service.durationMinutes,
    });
  }
  return items;
}

// What the block prints. Two services read "Sac kesimi, Sakal tirasi"; the
// callers that have to fit it in a 30-minute block truncate their own copy.
export function itemsLabel(items: StoredItem[] | undefined): string | undefined {
  if (!items?.length) return undefined;
  return items.map((i) => i.name).join(", ");
}

// The visit's length: what the services add up to. Only used as the DEFAULT at
// create — once a row has a durationMinutes it is authoritative, because
// somebody may have drawn the block by hand.
function itemsDuration(items: StoredItem[]): number | undefined {
  return items.length
    ? items.reduce((sum, i) => sum + i.durationMinutes, 0)
    : undefined;
}

// The visit's total. Undefined when NO line carries a price — "nothing was
// priced" and "this visit was free" are different facts and a bare 0 says the
// wrong one. Lines that are individually unpriced count as zero within a
// visit that has any price at all.
export function itemsTotal(items: StoredItem[] | undefined): number | undefined {
  if (!items?.length) return undefined;
  if (items.every((i) => i.price === undefined)) return undefined;
  return items.reduce((sum, i) => sum + (i.price ?? 0), 0);
}

const enrichedAppointment = v.object({
  _id: v.id("appointments"),
  _creationTime: v.number(),
  customerId: v.id("customers"),
  startAt: v.number(),
  durationMinutes: v.optional(v.number()),
  status: appointmentStatus,
  staffId: v.optional(v.id("staff")),
  // Resolved from the staff row, falling back to the legacy free-text column
  // for orgs that have not run migrations:backfillStaff yet. The calendar lanes
  // on staffId; this is only what the block prints.
  staffName: v.optional(v.string()),
  notes: v.optional(v.string()),
  externalUid: v.optional(v.string()),
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
  items: v.optional(v.array(storedItem)),
  total: v.optional(v.number()),
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
      const staff = row.staffId ? await ctx.db.get(row.staffId) : null;
      out.push({
        _id: row._id,
        _creationTime: row._creationTime,
        customerId: row.customerId,
        startAt: row.startAt,
        durationMinutes: row.durationMinutes,
        status: row.status,
        staffId: row.staffId,
        staffName: staff?.name ?? row.staffName,
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
              consented: customer.consentAt !== undefined,
            }
          : null,
        serviceName: itemsLabel(row.items),
        items: row.items,
        total: itemsTotal(row.items),
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
      total: v.optional(v.number()),
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
      const staff = row.staffId ? await ctx.db.get(row.staffId) : null;
      out.push({
        _id: row._id,
        startAt: row.startAt,
        status: row.status,
        serviceName: itemsLabel(row.items),
        staffName: staff?.name ?? row.staffName,
        total: itemsTotal(row.items),
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
    lines: v.optional(v.array(lineInput)),
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

    const items = await resolveLines(ctx, orgId, args.lines ?? []);

    const appointmentId = await ctx.db.insert("appointments", {
      orgId,
      customerId,
      items,
      startAt: args.startAt,
      // The block starts as long as the work takes; a drag can redraw it after.
      durationMinutes: itemsDuration(items),
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
// ---- Writes that follow a cal.com confirmation ----
//
// Both lanes (voice via http.ts, WhatsApp via the pushCancelToCalcom action)
// call cal.com FIRST and only then land here. cal.com owns the slot inventory,
// the salon's Google Calendar and the notification emails, so a status written
// before cal.com agrees is a slot the salon holds for someone who is not
// coming. Never patch status straight from a webhook handler again.

export const markCancelled = internalMutation({
  args: { appointmentId: v.id("appointments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.appointmentId, { status: "cancelled" });
    return null;
  },
});

// externalUid moves because cal.com's reschedule mints a new booking and
// retires the uid we were holding.
export const markRescheduled = internalMutation({
  args: {
    appointmentId: v.id("appointments"),
    startAt: v.number(),
    durationMinutes: v.optional(v.number()),
    externalUid: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) return null;
    await ctx.db.patch(args.appointmentId, {
      startAt: args.startAt,
      // A new time invalidates the reminders already sent for the old one.
      status: "scheduled",
      reminderSentOffsets: [],
      confirmationSentAt: undefined,
      ...(args.durationMinutes !== undefined
        ? { durationMinutes: args.durationMinutes }
        : {}),
      ...(args.externalUid ? { externalUid: args.externalUid } : {}),
    });
    await scheduleConfirmationIfConfigured(ctx, appointment.orgId, args.appointmentId);
    return null;
  },
});

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
// cal.com owns them and has to agree first.
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
  },
  returns: v.null(),
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
        patch.staffId = args.staffId;
      }
    }
    if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined;
    if (args.status !== undefined) patch.status = args.status;
    await ctx.db.patch(args.appointmentId, patch);
    return null;
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
export const completePast = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const orgCache = new Map<Id<"orgs">, Doc<"orgs"> | null>();
    // Bounded like reminders.tick: two weeks covers a salon that was away, and
    // anything older is a backlog no cron should quietly rewrite.
    const past = await ctx.db
      .query("appointments")
      .withIndex("by_start", (q) =>
        q.gt("startAt", now - 14 * 24 * 3600_000).lt("startAt", now),
      )
      .take(500);
    for (const appointment of past) {
      if (appointment.status !== "scheduled" && appointment.status !== "confirmed") {
        continue;
      }
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
    }
    return null;
  },
});
