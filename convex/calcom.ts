import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { requireOrg } from "./lib/orgAuth";
import { scheduleConfirmationIfConfigured } from "./appointments";

// cal.com intake. The salon keeps booking in cal.com (or its customers book
// themselves there); Randevu is the WhatsApp layer on top. The org is resolved
// from a per-org token in the webhook URL — cal.com's payload carries no
// tenant identity of its own.
//
// Setup, per org: Settings → Bookings shows
//   <convex-site-url>/calcom/webhook?token=<calcomWebhookToken>
// pasted into cal.com's webhook settings, subscribed to BOOKING_CREATED,
// BOOKING_RESCHEDULED and BOOKING_CANCELLED.

export const rotateWebhookToken = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const token = crypto.randomUUID().replace(/-/g, "");
    await ctx.db.patch(orgId, { calcomWebhookToken: token });
    return token;
  },
});

function attendeeOf(payload: Record<string, unknown>) {
  const attendees = (payload.attendees ?? []) as Record<string, unknown>[];
  const first = attendees[0] ?? {};
  const name = String(first.name ?? "").trim();
  const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
  // cal.com puts the phone in a booking question; field naming varies by
  // event type, so check the documented spots in order.
  const responses = (payload.responses ?? {}) as Record<string, unknown>;
  const raw =
    (responses.attendeePhoneNumber as { value?: string } | string | undefined) ??
    (responses.phone as { value?: string } | string | undefined) ??
    (responses.smsReminderNumber as { value?: string } | string | undefined) ??
    (first.phoneNumber as string | undefined);
  const phone =
    typeof raw === "string" ? raw : ((raw as { value?: string })?.value ?? "");
  return {
    firstName: firstName || name || "",
    lastName: rest.join(" ") || undefined,
    phone: String(phone).replace(/[\s().-]/g, ""),
    language: (first.language as string | undefined) ?? undefined,
  };
}

export const handleCalcomEvent = internalMutation({
  args: { token: v.string(), payload: v.any() },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_calcom_token", (q) => q.eq("calcomWebhookToken", args.token))
      .unique();
    if (!org) return { ok: false, reason: "unknown-token" };

    const triggerEvent = String(args.payload?.triggerEvent ?? "");
    const booking = (args.payload?.payload ?? {}) as Record<string, unknown>;
    const uid = String(booking.uid ?? "");
    if (!uid) return { ok: false, reason: "no-uid" };

    const existing = await ctx.db
      .query("appointments")
      .withIndex("by_org_external", (q) =>
        q.eq("orgId", org._id).eq("externalUid", uid),
      )
      .unique();

    if (triggerEvent === "BOOKING_CANCELLED") {
      if (existing) await ctx.db.patch(existing._id, { status: "cancelled" });
      return { ok: true };
    }

    const startAt = Date.parse(String(booking.startTime ?? ""));
    if (Number.isNaN(startAt)) return { ok: false, reason: "bad-start-time" };
    const endAt = Date.parse(String(booking.endTime ?? ""));
    const durationMinutes = Number.isNaN(endAt)
      ? undefined
      : Math.round((endAt - startAt) / 60000);

    if (triggerEvent === "BOOKING_RESCHEDULED" && existing) {
      // New time ⇒ the sent reminders no longer apply; reset and re-confirm.
      await ctx.db.patch(existing._id, {
        startAt,
        durationMinutes,
        status: "scheduled",
        reminderSentOffsets: [],
        confirmationSentAt: undefined,
      });
      await scheduleConfirmationIfConfigured(ctx, org._id, existing._id);
      return { ok: true };
    }

    const attendee = attendeeOf(booking);
    // No phone means no WhatsApp — accept the webhook (a 4xx would make
    // cal.com retry forever) but record why nothing was created.
    if (!/^\+[1-9]\d{6,14}$/.test(attendee.phone)) {
      return { ok: false, reason: "attendee-phone-missing-or-not-e164" };
    }

    let customer = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) =>
        q.eq("orgId", org._id).eq("phone", attendee.phone),
      )
      .unique();
    if (!customer) {
      const customerId = await ctx.db.insert("customers", {
        orgId: org._id,
        firstName: attendee.firstName || attendee.phone,
        lastName: attendee.lastName,
        phone: attendee.phone,
        language: attendee.language,
        // Booking through the salon's own cal.com page IS the opt-in moment.
        consentAt: Date.now(),
      });
      customer = await ctx.db.get(customerId);
    }
    if (!customer) return { ok: false, reason: "customer-failed" };

    if (existing) {
      await ctx.db.patch(existing._id, { startAt, durationMinutes });
      return { ok: true };
    }

    const appointmentId = await ctx.db.insert("appointments", {
      orgId: org._id,
      customerId: customer._id,
      startAt,
      durationMinutes,
      status: "scheduled",
      notes: String(booking.title ?? "") || undefined,
      source: "calcom",
      externalUid: uid,
    });
    await scheduleConfirmationIfConfigured(ctx, org._id, appointmentId);
    return { ok: true };
  },
});
