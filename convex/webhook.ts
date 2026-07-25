import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { applyWamidStatus, logInboundRow } from "./messages";
import { nextUpcomingOf } from "./appointments";
import { queueOrgAlert } from "./lib/alerts";
import { hasBusinessHours, isWithinActiveWindow } from "./lib/businessHours";

// Meta's session window: one away-reply per window, not per message.
const SESSION_WINDOW_MS = 24 * 3600_000;

// Bare-text fallbacks, per language. Button taps are the primary path; these
// cover a customer who types instead of tapping.
const CONFIRM_WORDS = ["evet", "onay", "onaylıyorum", "tamam", "ok", "yes", "confirm"];
const CANCEL_WORDS = ["iptal", "hayır", "hayir", "no", "cancel"];

function intentOf(text: string): "confirm" | "cancel" | null {
  const norm = text.trim().toLowerCase();
  if (CONFIRM_WORDS.some((w) => norm === w || norm.startsWith(w + " "))) return "confirm";
  if (CANCEL_WORDS.some((w) => norm === w || norm.startsWith(w + " "))) return "cancel";
  return null;
}

// Meta's inbound payload, already parsed by http.ts. One entry can carry both
// messages and delivery statuses.
export const handleWhatsappEvent = internalMutation({
  args: { payload: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entries = (args.payload?.entry ?? []) as Record<string, unknown>[];
    for (const entry of entries) {
      const changes = (entry.changes ?? []) as { value?: Record<string, unknown> }[];
      for (const change of changes) {
        const value = change.value;
        if (!value) continue;

        // Resolve the org by phone_number_id — never by the customer's number
        // (the same person can be a customer of two salons on this deployment).
        const phoneNumberId = (value.metadata as { phone_number_id?: string })
          ?.phone_number_id;
        if (!phoneNumberId) continue;
        const waAccount = await ctx.db
          .query("waAccounts")
          .withIndex("by_phone_number_id", (q) => q.eq("phoneNumberId", phoneNumberId))
          .unique();
        if (!waAccount) continue;
        const orgId = waAccount.orgId;

        for (const status of (value.statuses ?? []) as Record<string, unknown>[]) {
          const id = status.id as string | undefined;
          const state = status.status as string | undefined;
          if (!id || !state) continue;
          const errors = status.errors as { title?: string }[] | undefined;
          await applyWamidStatus(ctx, id, state, errors?.[0]?.title);
        }

        for (const message of (value.messages ?? []) as Record<string, unknown>[]) {
          const from = message.from as string | undefined;
          if (!from) continue;
          // Meta reports `from` without the leading +; our store is E.164.
          const phone = from.startsWith("+") ? from : `+${from}`;
          const customer = await ctx.db
            .query("customers")
            .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
            .unique();

          const buttonPayload = (message.button as { payload?: string } | undefined)
            ?.payload;
          const interactivePayload = (
            message.interactive as
              | { button_reply?: { id?: string } }
              | undefined
          )?.button_reply?.id;
          const text = (message.text as { body?: string } | undefined)?.body ?? "";
          const payload = buttonPayload ?? interactivePayload ?? "";

          // A number we have never seen is not noise, it is the new customer
          // this product exists to catch. It used to be logged with no
          // customerId, and the inbox groups by customer, so the message was
          // invisible everywhere: nobody ever learned that someone had
          // written. Create the record instead, with the phone standing in
          // until a human types a name. Consent stays unset; them writing to
          // us opens Meta's session window, it is not KVKK consent for us to
          // start messaging them.
          const contactId =
            customer?._id ??
            (await ctx.db.insert("customers", {
              orgId,
              firstName: "",
              phone,
            }));

          await logInboundRow(ctx, {
            orgId,
            customerId: contactId,
            body: payload || text,
            wamid: message.id as string | undefined,
          });
          // Opens Meta's 24h session window for any future free-form reply.
          await ctx.db.patch(contactId, { lastInboundAt: Date.now() });

          // Tell the staff who opted in. Scheduled, never inline: a broken
          // alert must not cost the salon the customer's actual message. The
          // wording resolves from the org's language at delivery time, so this
          // side only picks WHICH alert and hands over the substitutions.
          const who = customer
            ? `${customer.firstName} ${customer.lastName ?? ""}`.trim()
            : phone;
          const tap = /^(confirm|cancel):/.exec(payload)?.[1];
          // Never the raw button payload: that is an appointment id, not
          // something a person should read in an email.
          await queueOrgAlert(ctx, {
            orgId,
            template: tap
              ? tap === "confirm"
                ? "inboundConfirmed"
                : "inboundCancelled"
              : text
                ? "inboundText"
                : "inboundPlain",
            who,
            detail: tap ? undefined : text || undefined,
          });

          // A button payload names its exact appointment; typed text falls
          // back to the customer's next upcoming one.
          const match = /^(confirm|cancel):(.+)$/.exec(payload);
          let intent: "confirm" | "cancel" | null = null;
          let appointmentId: Id<"appointments"> | null = null;
          if (match) {
            intent = match[1] as "confirm" | "cancel";
            appointmentId = match[2] as Id<"appointments">;
          } else if (customer) {
            intent = intentOf(text);
            if (intent) {
              const appointments = await ctx.db
                .query("appointments")
                .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
                .collect();
              appointmentId =
                nextUpcomingOf(appointments, Date.now(), ["scheduled", "confirmed"])
                  ?._id ?? null;
            }
          }
          // Nothing actionable: they typed something that isn't a confirm or
          // cancel, or said EVET with no upcoming appointment to apply it to.
          // Out of hours that gets one away-reply with the booking link;
          // in hours it gets nothing, because the staff are reading this and an
          // auto-reply on top of a human who answers in five minutes reads like
          // a robot on the one channel where the customer thinks they are
          // talking to the salon. The owner alert above already fired either way.
          if (!appointmentId) {
            const org = await ctx.db.get(orgId);
            const hours = org?.businessHours ?? {};
            const now = Date.now();
            const alreadyReplied =
              customer?.lastAutoReplyAt !== undefined &&
              now - customer.lastAutoReplyAt < SESSION_WINDOW_MS;
            if (
              org &&
              (org.autoReplyEnabled ?? false) &&
              // Unset hours mean nobody has said when this salon is closed, so
              // we do not get to announce it. See lib/businessHours.ts.
              hasBusinessHours(hours) &&
              !isWithinActiveWindow(now, org.timezone, hours) &&
              !alreadyReplied
            ) {
              // Stamped BEFORE scheduling: two inbound messages arriving as two
              // separate webhook POSTs are two mutations, and the stamp is what
              // stops both from sending. Same ordering as the reminder tick.
              await ctx.db.patch(contactId, { lastAutoReplyAt: now });
              await ctx.scheduler.runAfter(0, internal.wa.sendAwayReply, {
                customerId: contactId,
              });
            }
            continue;
          }
          if (!intent) continue;

          const appointment = await ctx.db.get(appointmentId);
          // Org check: a spoofed payload must not reach another salon's row.
          if (!appointment || appointment.orgId !== orgId) continue;
          if (appointment.status === "completed") continue;

          // Confirming is Randevu's own concept — cal.com bookings are already
          // accepted, so there is nothing to tell it.
          if (intent === "confirm") {
            await ctx.db.patch(appointment._id, { status: "confirmed" });
            continue;
          }

          // Cancelling is not ours to record alone: cal.com holds the slot, the
          // salon's Google Calendar and the notification emails. This used to
          // patch "cancelled" here and stop, so the slot stayed blocked for a
          // customer who had already said they were not coming. A mutation
          // cannot fetch, so the push runs as an action which writes our status
          // only once cal.com agrees.
          if (appointment.externalUid) {
            await ctx.scheduler.runAfter(0, internal.calcom.pushCancelToCalcom, {
              appointmentId: appointment._id,
              orgId,
              externalUid: appointment.externalUid,
              who,
            });
            continue;
          }
          // A walk-in typed in by hand exists nowhere but here.
          await ctx.db.patch(appointment._id, { status: "cancelled" });
        }
      }
    }
    return null;
  },
});
