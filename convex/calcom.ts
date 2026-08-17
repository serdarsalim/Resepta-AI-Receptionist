import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOwner } from "./lib/orgAuth";
import {
  scheduleConfirmationIfConfigured,
  scheduleLifecycleMessages,
} from "./appointments";
import { cancelBooking } from "./lib/calcomApi";
import { queueOrgAlert } from "./lib/alerts";
import { syncAppointmentSchedule } from "./lib/reminderSchedule";
import { recordCustomerCreated } from "./lib/newCustomer";
import { recordActivity } from "./lib/activity";
import { dialCodeForTimezone, normalisePhone } from "./lib/phone";
import { formatAppointmentTime } from "./lib/format";

// cal.com intake. The salon keeps booking in cal.com (or its customers book
// themselves there); Resepta is the WhatsApp layer on top. The org is resolved
// from a per-org token in the webhook URL — cal.com's payload carries no
// tenant identity of its own.
//
// Setup, per org: Settings → Bookings shows
//   <convex-site-url>/calcom/webhook?token=<calcomWebhookToken>
// pasted into cal.com's webhook settings, subscribed to BOOKING_CREATED,
// BOOKING_RESCHEDULED and BOOKING_CANCELLED.

// cal.com API credentials (Settings → Bookings). Key is write-only from the
// client; orgs.current returns only a tail.
export const setApi = mutation({
  args: { apiKey: v.optional(v.string()), eventTypeId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const patch: Record<string, unknown> = {};
    if (args.apiKey !== undefined) patch.calcomApiKey = args.apiKey.trim() || undefined;
    if (args.eventTypeId !== undefined) {
      patch.calcomEventTypeId = args.eventTypeId.trim() || undefined;
    }
    await ctx.db.patch(orgId, patch);
    return null;
  },
});

export const rotateWebhookToken = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const { orgId } = await requireOwner(ctx);
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
    // RAW, exactly as the customer typed it. Normalising happens at the call
    // site with the org's country in hand, and the untouched string is what
    // the dropped-booking record shows the salon so they can read the number
    // off the screen and phone the person.
    phone: String(phone).trim(),
    name,
    email: String(first.email ?? "").trim() || undefined,
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
    // Allowlisted, because the org picks its own triggers in cal.com's
    // multiselect and our only influence is a hint string next to the URL.
    // This used to test for CANCELLED and RESCHEDULED and let everything else
    // fall through to the create path — so BOOKING_REJECTED, or
    // BOOKING_REQUESTED on a confirmation-required event type, inserted a
    // "scheduled" appointment and sent the customer a WhatsApp confirmation
    // for a booking nobody had accepted. A later REJECTED for that same uid
    // then found the row and only patched its time, so the phantom stayed on
    // the salon's calendar for good.
    //
    // An unrecognised trigger is acknowledged, not failed: cal.com retries a
    // non-2xx, and "we do not act on this event" is not an error worth
    // retrying. An empty triggerEvent still runs, which keeps the older
    // payload shape and hand-rolled test posts working.
    const HANDLED = [
      "",
      "BOOKING_CREATED",
      "BOOKING_CANCELLED",
      "BOOKING_RESCHEDULED",
    ];
    if (!HANDLED.includes(triggerEvent)) {
      return { ok: true, reason: `ignored-${triggerEvent}` };
    }
    const booking = (args.payload?.payload ?? {}) as Record<string, unknown>;
    const uid = String(booking.uid ?? "");
    if (!uid) return { ok: false, reason: "no-uid" };

    const findByUid = async (candidate: string) =>
      candidate
        ? await ctx.db
            .query("appointments")
            .withIndex("by_org_external", (q) =>
              q.eq("orgId", org._id).eq("externalUid", candidate),
            )
            .unique()
        : null;

    // A reschedule is a NEW cal.com booking: the payload's `uid` is the new one
    // and `rescheduleUid` points at the booking we already store. Resolving
    // only `uid` found nothing, so the BOOKING_RESCHEDULED branch was skipped
    // and the create path below inserted a SECOND appointment while the old
    // time stayed on the salon's calendar. `uid` stays the first candidate
    // because every other trigger reports the live booking there.
    const previousUid = String(booking.rescheduleUid ?? "");
    let existing = await findByUid(uid);
    if (!existing && previousUid) existing = await findByUid(previousUid);

    if (triggerEvent === "BOOKING_CANCELLED") {
      // Transition guard doubles as the echo guard: our own pushCancelToCalcom
      // comes back through here, by which time markCancelled already wrote the
      // status and sent the notice.
      if (existing && existing.status !== "cancelled") {
        await ctx.db.patch(existing._id, { status: "cancelled" });
        await syncAppointmentSchedule(ctx, existing._id);
        await scheduleLifecycleMessages(ctx, org._id, existing._id, "cancellation");
      }
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
      // externalUid moves to the new booking: cal.com retires the old uid, so
      // a later cancel or reschedule aimed at it would 404.
      await ctx.db.patch(existing._id, {
        startAt,
        durationMinutes,
        externalUid: uid,
        status: "scheduled",
        reminderSentOffsets: [],
        confirmationSentAt: undefined,
      });
      await syncAppointmentSchedule(ctx, existing._id);
      await scheduleConfirmationIfConfigured(ctx, org._id, existing._id);
      return { ok: true };
    }

    const attendee = attendeeOf(booking);
    // The customer wrote their number the way people write their own number.
    // Nobody types +90 in a booking form, so the org's country turns
    // "0532 123 45 67" into something Meta will accept (lib/phone.ts).
    const attendeePhone = normalisePhone(
      attendee.phone,
      dialCodeForTimezone(org.timezone),
    );
    // No usable phone means no WhatsApp. Accept the webhook anyway (a 4xx makes
    // cal.com retry forever) — but this booking EXISTS: it is on the salon's
    // cal.com calendar, the customer has a confirmation email, and they are
    // going to turn up. Returning the reason to cal.com's delivery log, which
    // is what used to happen, tells the one party who will never read it.
    // Nothing was written here, so no reminder, no confirmation, and no way
    // for the salon to know the booking is missing until the chair sits empty.
    // Hence a row they can actually see, carrying the number as typed so the
    // failure is one phone call away from fixed.
    if (!attendeePhone) {
      await recordActivity(ctx, {
        orgId: org._id,
        kind: "booking_dropped",
        // A webhook, not a person. Without this the salon owner happening to
        // be signed in in some browser gets credited with the customer's
        // booking (see lib/activity.ts).
        system: true,
        // Name, when they were coming, and the number as typed. The number is
        // dropped from the line rather than replaced by a placeholder when the
        // form came in blank: nothing typed is already what the label says,
        // and a row reading "· ·" invites the reader to hunt for a value that
        // was never there.
        detail: [
          attendee.name || "?",
          formatAppointmentTime(startAt, org.timezone, org.language),
          attendee.phone,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      return { ok: false, reason: "attendee-phone-missing-or-not-e164" };
    }

    let customer = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) =>
        q.eq("orgId", org._id).eq("phone", attendeePhone),
      )
      .unique();
    if (!customer) {
      const customerId = await ctx.db.insert("customers", {
        orgId: org._id,
        firstName: attendee.firstName || attendeePhone,
        lastName: attendee.lastName,
        phone: attendeePhone,
        email: attendee.email,
        language: attendee.language,
        // Booking through the salon's own cal.com page IS the opt-in moment.
        consentAt: Date.now(),
      });
      await recordCustomerCreated(ctx, {
        orgId: org._id,
        customerId,
        source: "calcom",
      });
      customer = await ctx.db.get(customerId);
    }
    if (!customer) return { ok: false, reason: "customer-failed" };

    if (existing) {
      await ctx.db.patch(existing._id, { startAt, durationMinutes });
      await syncAppointmentSchedule(ctx, existing._id);
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
    await syncAppointmentSchedule(ctx, appointmentId);
    await scheduleConfirmationIfConfigured(ctx, org._id, appointmentId);
    return { ok: true };
  },
});

// ---- Pushing a WhatsApp cancel back to cal.com ----

export const calcomKeyOf = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    return org?.calcomApiKey ?? null;
  },
});

// A customer tapping Cancel on WhatsApp arrives in a mutation, and a Convex
// mutation cannot reach the network — so the tap schedules this instead of
// patching status itself. Same order as the voice lane: cal.com first, our row
// second. If cal.com refuses, the appointment deliberately stays as it was and
// the owner gets told, because the alternative is Resepta showing "cancelled"
// over a slot cal.com still holds blocked for a customer who is not coming.
export const pushCancelToCalcom = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    orgId: v.id("orgs"),
    externalUid: v.string(),
    who: v.string(),
    // The salon reads this in cal.com and in Google Calendar, so it has to say
    // who actually cancelled. Defaults to the WhatsApp wording this action was
    // originally written for.
    reason: v.optional(v.string()),
    // Set when a person inside the salon started this, so markCancelled writes
    // the activity entry setStatus can no longer write itself. Absent for a
    // customer cancelling by message, which the inbound message already records.
    actor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const apiKey = await ctx.runQuery(internal.calcom.calcomKeyOf, {
      orgId: args.orgId,
    });
    const fail = async (detail: string) => {
      console.error(
        `calcom cancel failed for appointment ${args.appointmentId}: ${detail}`,
      );
      await queueOrgAlert(ctx, {
        orgId: args.orgId,
        template: "failedCalendarCancel",
        who: args.who,
        detail,
      });
    };
    if (!apiKey) {
      await fail("no cal.com API key on this org");
      return null;
    }
    const result = await cancelBooking({
      apiKey,
      uid: args.externalUid,
      reason: args.reason ?? "Cancelled by the customer on WhatsApp",
    });
    if (!result.ok) {
      await fail(result.reason);
      return null;
    }
    await ctx.runMutation(internal.appointments.markCancelled, {
      appointmentId: args.appointmentId,
      ...(args.actor !== undefined ? { actor: args.actor } : {}),
    });
    return null;
  },
});
