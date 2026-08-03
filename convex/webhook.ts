import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { applyWamidStatus, logInboundRow } from "./messages";
import { nextUpcomingOf, scheduleLifecycleMessages } from "./appointments";
import { queueOrgAlert } from "./lib/alerts";
import { hasBusinessHours, isWithinActiveWindow } from "./lib/businessHours";
import { syncAppointmentSchedule } from "./lib/reminderSchedule";
import { recordCustomerCreated } from "./lib/newCustomer";

// Meta's session window: one away-reply per window, not per message. Exported
// because the email lane throttles its out-of-hours reply on the same clock —
// not Meta's rule over there, but the same customer-facing fact: nobody wants
// the identical bot reply twice in one evening.
export const SESSION_WINDOW_MS = 24 * 3600_000;

// Bare-text fallbacks. Button taps are the primary path; these cover a customer
// who types instead of tapping.
//
// All three UI languages, checked as one list rather than per customer language:
// none of these words collides across tr/en/de, and a Turkish-speaking customer
// of a Vienna salon may well reply "ok" to a German reminder. German was missing
// entirely, which mattered more once the away-reply shipped — an unmatched
// "Storno" used to do nothing, and would now answer "we're closed, book here" to
// somebody who was trying to cancel.
const CONFIRM_WORDS = [
  "evet", "onay", "onaylıyorum", "tamam", "olur", // tr
  "ok", "okay", "yes", "confirm", // en
  "ja", "bestätigen", "bestätige", "bestaetigen", // de
];
const CANCEL_WORDS = [
  "iptal", "hayır", "hayir", // tr
  "no", "cancel", // en
  "nein", "storno", "stornieren", "absagen", // de
];

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
          const buttonPayload = (message.button as { payload?: string } | undefined)
            ?.payload;
          const interactivePayload = (
            message.interactive as
              | { button_reply?: { id?: string } }
              | undefined
          )?.button_reply?.id;
          // An image arrives as an id plus an optional caption. A salon gets
          // these constantly — "this is the colour I want" — and dropping
          // them left a bubble saying nothing at all.
          const image = message.image as
            | { id?: string; caption?: string }
            | undefined;
          await processInboundMessage(ctx, {
            orgId,
            phone,
            text: (message.text as { body?: string } | undefined)?.body ?? "",
            payload: buttonPayload ?? interactivePayload ?? "",
            wamid: message.id as string | undefined,
            imageId: image?.id,
            imageCaption: image?.caption,
          });
        }
      }
    }
    return null;
  },
});

// One inbound customer message, normalised, whichever lane carried it.
//
// Extracted so the Evolution lane reuses the confirm/cancel handling rather
// than growing a second copy of it. The two lanes differ ONLY in how the
// bytes arrive: Meta posts a signed envelope naming a phone_number_id, and
// Evolution posts a Baileys event naming an instance. By the time the message
// is here, that difference is spent.
//
// `payload` is a quick-reply button id and is always empty on the Evolution
// lane, because Baileys never delivers buttons (see lib/evolution.ts). That is
// not a special case in here — an empty payload already falls through to the
// typed-text path, which is exactly what the Evolution lane depends on.
export async function processInboundMessage(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    phone: string;
    text: string;
    payload: string;
    wamid?: string;
    imageId?: string;
    imageCaption?: string;
    // Unset = cloud, which is what the Meta caller passes by omission.
    lane?: "cloud" | "evolution";
  },
): Promise<void> {
  const { orgId, phone, text, payload } = args;
  const customer = await ctx.db
    .query("customers")
    .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
    .unique();
  const image = args.imageId
    ? { id: args.imageId, caption: args.imageCaption }
    : undefined;
  const message = { id: args.wamid };

  // A number we have never seen is not noise, it is the new customer
  // this product exists to catch. It used to be logged with no
  // customerId, and the inbox groups by customer, so the message was
  // invisible everywhere: nobody ever learned that someone had
  // written. Create the record instead, with the phone standing in
  // until a human types a name. Consent stays unset; them writing to
  // us opens Meta's session window, it is not KVKK consent for us to
  // start messaging them.
  let contactId = customer?._id;
  if (!contactId) {
    contactId = await ctx.db.insert("customers", {
      orgId,
      firstName: "",
      phone,
    });
    await recordCustomerCreated(ctx, {
      orgId,
      customerId: contactId,
      source: "whatsapp",
    });
  }

  const loggedId = await logInboundRow(ctx, {
    orgId,
    customerId: contactId,
    body: payload || text || image?.caption || "",
    wamid: message.id as string | undefined,
    mediaPending: Boolean(image?.id),
    lane: args.lane,
  });
  // Scheduled, not awaited: Meta retries a webhook that does not get a
  // fast 200, so two network round-trips inside this handler would
  // turn one slow image into duplicate deliveries of the message.
  if (image?.id) {
    await ctx.scheduler.runAfter(0, internal.wa.downloadInboundMedia, {
      orgId,
      messageId: loggedId,
      mediaId: image.id,
    });
  }
  // Opens Meta's 24h session window for any future free-form reply, and
  // records WHICH number they wrote to, so the answer goes back the same way.
  await ctx.db.patch(contactId, {
    lastInboundAt: Date.now(),
    lastInboundLane: args.lane ?? "cloud",
  });

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
    // The out_of_hours rule owns whether (and on which channels) the salon
    // answers a closed-hours message; orgs.autoReplyEnabled is legacy once
    // the rule row exists (messageRules.migrateOutOfHoursOrg).
    const rule = org
      ? (
          await ctx.db
            .query("messageRules")
            .withIndex("by_org", (q) => q.eq("orgId", org._id))
            .collect()
        ).find(
          (r) =>
            r.trigger === "out_of_hours" &&
            !r.paused &&
            (r.channel === "whatsapp" || r.channel === "both"),
        )
      : undefined;
    if (
      org &&
      rule &&
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
        ruleId: rule._id,
      });
    }
    return;
  }
  if (!intent) return;

  const appointment = await ctx.db.get(appointmentId);
  // Org check: a spoofed payload must not reach another salon's row.
  if (!appointment || appointment.orgId !== orgId) return;
  if (appointment.status === "completed") return;

  // Confirming is Randevu's own concept — cal.com bookings are already
  // accepted, so there is nothing to tell it.
  if (intent === "confirm") {
    await ctx.db.patch(appointment._id, { status: "confirmed" });
    // Confirmed is still a live booking, so reminders continue — but
    // the recompute has to run or the field drifts from the row.
    await syncAppointmentSchedule(ctx, appointment._id);
    return;
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
    return;
  }
  // A walk-in typed in by hand exists nowhere but here.
  await ctx.db.patch(appointment._id, { status: "cancelled" });
  await syncAppointmentSchedule(ctx, appointment._id);
  // The customer asked by message; the cancellation rule, if the org has one,
  // is what answers them.
  await scheduleLifecycleMessages(ctx, orgId, appointment._id, "cancellation");
}

// ---- The Evolution lane ----
//
// Baileys is a LINKED DEVICE, not an API endpoint, and that one fact is what
// this handler is for. A Cloud API number is removed from the consumer
// WhatsApp app, so every staff reply has to be typed into Randevu. An
// Evolution number stays an ordinary WhatsApp account the salon uses on their
// own phone, and we see everything on it — including what THEY send.
//
// So this handler writes two kinds of row where the Cloud lane writes one:
//
//   fromMe false → the customer wrote. Same path as Meta's, normalised.
//   fromMe true  → a stylist answered from their own phone, and the only
//                  record of that conversation is this event. Logged as an
//                  outbound row so the thread reads in order instead of
//                  showing a customer talking to nobody.
//
// That second case is the whole reason to keep this lane after a WABA lands,
// and it cannot be rebuilt on Cloud API at any price.
export const handleEvolutionEvent = internalMutation({
  args: { payload: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payload = args.payload as {
      event?: string;
      instance?: string;
      data?: Record<string, unknown> | Record<string, unknown>[];
    };
    // Evolution sends connection updates, presence, receipts and more down the
    // same webhook. Only new messages matter here.
    if (payload.event !== "messages.upsert") return null;
    const instance = payload.instance?.trim();
    if (!instance) return null;

    // The instance names the org, the same job phone_number_id does on the
    // Cloud lane. Never the customer's number: one person can be a customer
    // of two salons on this deployment.
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_evolution_instance", (q) => q.eq("evolutionInstance", instance))
      .unique();
    // No lane check beyond this. The index lookup IS the guard: an org that
    // has stopped running Evolution clears its instance name, and a stale
    // linked phone then resolves to no org at all. Running Cloud as well is
    // not a reason to reject this — the two lanes are two numbers and both
    // are live (see schema.ts orgs.evolutionInstance).
    if (!org) return null;

    const items = Array.isArray(payload.data) ? payload.data : [payload.data ?? {}];
    for (const item of items) {
      const key = item.key as
        | { remoteJid?: string; fromMe?: boolean; id?: string }
        | undefined;
      const jid = key?.remoteJid;
      if (!jid) continue;
      // Groups, broadcasts and status posts all arrive here. A salon's group
      // chat is not a customer conversation and must not mint a contact.
      if (!jid.endsWith("@s.whatsapp.net")) continue;
      const phone = `+${jid.split("@")[0].replace(/[^\d]/g, "")}`;
      if (phone.length < 8) continue;

      const body = evolutionText(item.message);
      if (!body) continue;

      if (key.fromMe) {
        // The salon answering from their own phone. There is no appointment
        // intent to read here — nobody confirms their own reminder — so this
        // is purely the record of what was said.
        const customer = await ctx.db
          .query("customers")
          .withIndex("by_org_phone", (q) => q.eq("orgId", org._id).eq("phone", phone))
          .unique();
        // Deliberately NOT creating a contact from an outbound message. A
        // stylist messaging their own family from the salon phone is not a new
        // customer, and the inbound path already catches anyone who writes in.
        if (!customer) continue;
        // Dedupe on Evolution's own message id. It replays events, and a
        // replayed reply must not become a second bubble in the thread.
        if (key.id) {
          const seen = await ctx.db
            .query("messages")
            .withIndex("by_wamid", (q) => q.eq("wamid", key.id))
            .unique();
          if (seen) continue;
        }
        await ctx.db.insert("messages", {
          orgId: org._id,
          customerId: customer._id,
          direction: "out",
          // Its own kind, because it is not something Randevu sent. A staff
          // reply typed on a phone has no template, no delivery guarantee and
          // no retry — treating it as a normal send would put it in the reach
          // of the retry queue, which has nothing to retry it with.
          kind: "staff_reply",
          body,
          wamid: key.id,
          status: "sent",
          lane: "evolution",
        });
        continue;
      }

      await processInboundMessage(ctx, {
        orgId: org._id,
        phone,
        text: body,
        // Always empty on this lane: Baileys never delivers quick replies, so
        // there is no button id to carry. The typed-text path handles it.
        payload: "",
        wamid: key.id,
        lane: "evolution",
      });
    }
    return null;
  },
});

// Baileys nests the text differently per message type, and an unhandled shape
// reads as an empty message rather than an error. Covers the three a salon
// actually receives; anything else (stickers, locations, reactions) returns
// null and is skipped rather than logged as a blank bubble.
function evolutionText(message: unknown): string | null {
  const m = message as
    | {
        conversation?: string;
        extendedTextMessage?: { text?: string };
        imageMessage?: { caption?: string };
      }
    | undefined;
  const text =
    m?.conversation ?? m?.extendedTextMessage?.text ?? m?.imageMessage?.caption ?? "";
  return text.trim() ? text : null;
}
