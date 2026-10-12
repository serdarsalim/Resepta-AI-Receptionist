import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { applyWamidStatus, logInboundRow } from "./messages";
import { REPEAT_WINDOW_MS, withChange } from "./lib/agentChange";
import { channelOfMessage, noteMessageById } from "./lib/thread";
import { scheduleLifecycleMessages } from "./appointments";
import { queueOrgAlert } from "./lib/alerts";
import { hasBusinessHours, isWithinActiveWindow } from "./lib/businessHours";
import { syncAppointmentSchedule } from "./lib/reminderSchedule";
import { recordCustomerCreated } from "./lib/newCustomer";
import {
  agentAnswersCustomer,
  agentGenerates,
  conversationAgentMode,
} from "./lib/agentMode";

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

// `bareOnly` is the agent boundary. The prefix match exists for orgs where
// nobody else will read the message — there, "ok thanks" confirming beats
// silence. An org running an agent is the opposite case: "Tamam saat 14
// olsun" is a RESCHEDULE that happens to open with a confirm word, and the
// prefix match confirming the old slot instead (Bella, 2026-08-31) is the
// agent going mute at the exact moment it was needed. With an agent in the
// conversation, only the bare word — trailing punctuation aside — is
// unambiguous enough to shortcut it.
function intentOf(text: string, bareOnly: boolean): "confirm" | "cancel" | null {
  // U+0307 stripped because "İptal".toLowerCase() is "i" plus a combining
  // dot, which never equalled "iptal" — the capitalised Turkish cancel, the
  // single likeliest thing a customer types, silently missed this list until
  // 2026-08-31.
  const norm = text
    .trim()
    .toLowerCase()
    .replace(/\u0307/g, "")
    .replace(/[.!?…]+$/, "");
  const hit = (w: string) => norm === w || (!bareOnly && norm.startsWith(w + " "));
  if (CONFIRM_WORDS.some(hit)) return "confirm";
  if (CANCEL_WORDS.some(hit)) return "cancel";
  return null;
}

// WHICH appointment a typed EVET or İPTAL answers (2026-10-13): the one the
// latest WhatsApp reminder or confirmation to this customer was about, since
// that is the message they are replying to. Both used to fall back to "the
// next upcoming", so İPTAL typed twice cancelled two appointments: the second
// "next" was the one after the appointment just cancelled.
//
// A cancel whose appointment was cancelled inside REPEAT_WINDOW_MS of the
// customer's last change is the same İPTAL again: that appointment comes
// back, already cancelled, and the caller changes nothing. With no such
// message, or one about an appointment long settled, the next upcoming one is
// used only when it is the only one. With several, nothing is guessed: the
// message goes where any other text goes, to the assistant or the team.
async function typedReplyTarget(
  ctx: MutationCtx,
  customer: Doc<"customers">,
  intent: "confirm" | "cancel",
  now: number,
): Promise<Id<"appointments"> | null> {
  const open = (row: Doc<"appointments">) =>
    (row.status === "scheduled" || row.status === "confirmed") && row.startAt > now;
  // Newest first, bounded: the reply answers something recent, and these
  // rows carry bodies.
  const recent = await ctx.db
    .query("messages")
    .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
    .order("desc")
    .take(50);
  const answered = recent.find(
    (message) =>
      message.direction === "out" &&
      message.appointmentId !== undefined &&
      message.status !== "failed" &&
      channelOfMessage(message.kind) === "whatsapp" &&
      (message.kind === "confirmation" || message.kind.startsWith("reminder")),
  );
  if (answered?.appointmentId) {
    const appointment = await ctx.db.get(answered.appointmentId);
    if (
      appointment &&
      appointment.orgId === customer.orgId &&
      appointment.customerId === customer._id
    ) {
      if (open(appointment)) return appointment._id;
      const lastChange = Math.max(0, ...(customer.agentChangesAt ?? []));
      if (
        intent === "cancel" &&
        appointment.status === "cancelled" &&
        now - lastChange < REPEAT_WINDOW_MS
      ) {
        return appointment._id;
      }
    }
  }
  const upcoming = (
    await ctx.db
      .query("appointments")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect()
  ).filter((row) => row.orgId === customer.orgId && open(row));
  return upcoming.length === 1 ? upcoming[0]._id : null;
}

// Meta's inbound payload, already parsed by http.ts. One entry can carry both
// messages and delivery statuses.
export const handleWhatsappEvent = internalMutation({
  args: { payload: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entries = (args.payload?.entry ?? []) as Record<string, unknown>[];
    for (const entry of entries) {
      const changes = (entry.changes ?? []) as {
        field?: string;
        value?: Record<string, unknown>;
      }[];
      for (const change of changes) {
        const value = change.value;
        if (!value) continue;

        // A template review verdict, which is NOT a message and carries no
        // phone_number_id — the guard below would drop it. It names a WABA
        // (entry.id) and a template, so it is dispatched before any of the
        // message handling and never reaches it.
        //
        // The app has been subscribed to this field all along; until now the
        // payloads were parsed and thrown away, which is why a rejection at
        // Meta never reached the person who could fix it.
        if (change.field === "message_template_status_update") {
          const event = value.event as string | undefined;
          if (event) {
            const templateId = value.message_template_id as
              | number
              | string
              | undefined;
            await ctx.runMutation(internal.waTemplates.applyStatusUpdate, {
              // A NUMBER in Meta's payload; ours is a string, and comparing
              // the two would never match.
              metaTemplateId:
                templateId != null ? String(templateId) : undefined,
              wabaId: entry.id as string | undefined,
              metaName: value.message_template_name as string | undefined,
              language: value.message_template_language as string | undefined,
              status: event,
              reason: (value.reason as string | null | undefined) ?? undefined,
            });
          }
          continue;
        }

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
          await applyWamidStatus(ctx, orgId, id, state, errors?.[0]?.title);
        }

        for (const message of (value.messages ?? []) as Record<string, unknown>[]) {
          const from = message.from as string | undefined;
          if (!from) continue;
          // Meta reports `from` without the leading +; our store is E.164.
          const phone = from.startsWith("+") ? from : `+${from}`;
          // Both button shapes carry the id AND the words on the button; the
          // id drives the confirm/cancel machinery, the words are what the
          // thread shows.
          const button = message.button as
            | { payload?: string; text?: string }
            | undefined;
          const buttonPayload = button?.payload;
          const buttonReply = (
            message.interactive as
              | { button_reply?: { id?: string; title?: string } }
              | undefined
          )?.button_reply;
          const interactivePayload = buttonReply?.id;
          const buttonLabel = button?.text ?? buttonReply?.title;
          // Every attachment Meta delivers shares one shape: an id that is a
          // HANDLE rather than the file, an optional caption the sender typed
          // beside it, and — for a document — the filename they picked.
          //
          // All five types are read, not just the image. A salon gets photos
          // constantly ("this is the colour I want") and those were already
          // handled, but a voice note is a REPLY — somebody answering in
          // words, just spoken — and dropping it lost exactly what a dropped
          // text would. Documents, video and stickers were the same silent
          // hole: the row landed with an empty body, and an empty body
          // renders as "template message", so the thread actively told the
          // salon that nothing had arrived.
          const type = message.type as string | undefined;
          const part = (
            type && type !== "text" && type !== "reaction"
              ? (message as Record<string, unknown>)[type]
              : undefined
          ) as
            | { id?: string; caption?: string; filename?: string; mime_type?: string }
            | undefined;
          // A reaction is NOT a message. It carries an emoji and the wamid of
          // the message it belongs to, so it lands ON that bubble rather than
          // becoming a bubble of its own — which is all a "[reaction]" row
          // would ever have been, a line saying an emoji happened somewhere.
          // An EMPTY emoji means the reaction was taken back.
          const reactionPart = message.reaction as
            | { message_id?: string; emoji?: string }
            | undefined;
          // A swipe-reply names what it answers: context.id is the wamid of
          // the quoted message. Dropped for years at this exact spot, which is
          // how an answer to "which time?" rendered as a free-standing "Bu
          // tamam" with the question nowhere near it.
          const contextPart = message.context as { id?: string } | undefined;
          await processInboundMessage(ctx, {
            orgId,
            phone,
            text: (message.text as { body?: string } | undefined)?.body ?? "",
            payload: buttonPayload ?? interactivePayload ?? "",
            buttonLabel,
            wamid: message.id as string | undefined,
            mediaId: part?.id,
            mediaCaption: part?.caption,
            mediaFileName: part?.filename,
            mediaContentType: part?.mime_type,
            // Carried so a type we cannot fetch (a location, an unknown
            // future one) still names itself in the bubble instead of
            // arriving blank.
            messageType: type,
            replyToWamid: contextPart?.id,
            reaction:
              type === "reaction" && reactionPart?.message_id
                ? {
                    targetWamid: reactionPart.message_id,
                    emoji: reactionPart.emoji ?? "",
                  }
                : undefined,
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
    // What the tapped button SAID ("İptal", "Onayla") — the words the
    // customer chose, as against the machine id in `payload`. This is what
    // the thread shows; the payload never is.
    buttonLabel?: string;
    wamid?: string;
    // Any attachment: photo, voice note, video, document, sticker. One shape
    // because Meta uses one shape — only the key it hangs under differs, and
    // the webhook has already resolved that.
    mediaId?: string;
    mediaCaption?: string;
    mediaFileName?: string;
    // Meta declares this on the webhook itself, so the row can record WHAT
    // arrived before the bytes do. That is the difference between a failed
    // download leaving "a voice message we could not load" and leaving a
    // blank bubble that reads as "the customer sent nothing".
    mediaContentType?: string;
    // Meta's own word for the message type. Only consulted for the types we
    // cannot fetch (a location, a contact card) so the bubble names them
    // rather than arriving empty.
    messageType?: string;
    // A reaction on one of OUR messages. Not a message of its own — see the
    // branch below.
    reaction?: { targetWamid: string; emoji: string };
    // The wamid this message QUOTED (a swipe-reply). Resolved to a snapshot
    // below so the row renders its quote without a per-bubble lookup.
    replyToWamid?: string;
    // Unset = cloud, which is what the Meta caller passes by omission.
    lane?: "cloud" | "evolution";
  },
): Promise<void> {
  const { orgId, phone, text, payload } = args;
  // A DELIVERY SEEN TWICE IS ONE MESSAGE (2026-10-13). Meta retries any
  // webhook it did not see acknowledged in time and Evolution replays events,
  // and every retry used to land as a second bubble, a second alert to the
  // staff and a second turn for the assistant (which then answered twice).
  // Only the shop phone's own replies were deduped (handleEvolutionEvent).
  // The wamid is the message's own id, so a row already holding it in THIS
  // org means this delivery has been handled. The index spans every org,
  // hence the org check; take() rather than unique(), because a duplicate
  // that slipped in before this guard must not make every later delivery
  // throw. Race-free: a mutation's read of this index range conflicts with
  // a concurrent insert into it, so two simultaneous deliveries serialise
  // and the second one finds the first.
  if (args.wamid) {
    const seen = await ctx.db
      .query("messages")
      .withIndex("by_wamid", (q) => q.eq("wamid", args.wamid))
      .take(10);
    if (seen.some((row) => row.orgId === orgId && row.direction === "in")) return;
  }
  const customer = await ctx.db
    .query("customers")
    .withIndex("by_org_phone", (q) => q.eq("orgId", orgId).eq("phone", phone))
    .unique();
  const media = args.mediaId
    ? { id: args.mediaId, caption: args.mediaCaption }
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

  // A reaction writes ONTO the message it belongs to and then stops. It is
  // not a row: a bubble whose entire content is "somebody put an emoji
  // somewhere" is the noise this replaces. It does not wake the chat agent
  // and it does not alert the staff either — a thumbs-up is an
  // acknowledgement, and paging someone for it teaches them to ignore the
  // alerts that matter.
  //
  // It IS an inbound signal, so the window stamp below still fires: a person
  // who reacts has engaged with the thread, whether or not they typed.
  if (args.reaction) {
    const target = await ctx.db
      .query("messages")
      .withIndex("by_wamid", (q) => q.eq("wamid", args.reaction!.targetWamid))
      .first();
    if (!target) {
      // A message we never stored — sent from the shop's own handset, or
      // older than this lane. There is nothing to hang the emoji on, and a
      // free-floating one is exactly the noise being removed.
      console.warn(`wa reaction: no message for wamid ${args.reaction.targetWamid}`);
    } else if (target.orgId !== orgId) {
      // A wamid is globally unique so this should be unreachable, but the
      // alternative to checking is writing one salon's customer's emoji onto
      // another salon's conversation.
      console.warn(`wa reaction: wamid ${args.reaction.targetWamid} belongs to another org`);
    } else {
      // Patching to undefined DELETES the field, which is exactly right for
      // a reaction that was taken back — Meta signals that with an empty
      // emoji, not with a separate event.
      await ctx.db.patch(target._id, {
        reactionEmoji: args.reaction.emoji || undefined,
      });
    }
    await ctx.db.patch(contactId, {
      lastInboundAt: Date.now(),
      lastInboundLane: args.lane ?? "cloud",
    });
    return;
  }

  // Resolve the quote BEFORE logging, so the row lands complete. A quoted
  // message we never stored (sent from the shop's own handset, older than
  // this lane) degrades to no quote rather than a broken one; the reply
  // itself still lands whole.
  let replyTo: { wamid: string; body: string; direction: "in" | "out" } | null = null;
  if (args.replyToWamid) {
    const quoted = await ctx.db
      .query("messages")
      .withIndex("by_wamid", (q) => q.eq("wamid", args.replyToWamid!))
      .first();
    if (quoted && quoted.orgId === orgId) {
      replyTo = {
        wamid: args.replyToWamid,
        // The snapshot is for a two-line quote chip; 200 chars is more than
        // it can show. A media-only quoted message has no body and the chip
        // names the kind at render time from an empty string.
        body: (quoted.body ?? "").slice(0, 200),
        direction: quoted.direction,
      };
    }
  }

  const loggedId = await logInboundRow(ctx, {
    orgId,
    customerId: contactId,
    // A caption is real words the customer typed beside the photo, so it is
    // the body. Failing all three, a type we cannot fetch names itself —
    // otherwise a shared location lands as an empty bubble, which renders as
    // "template message" and tells the salon a lie about what happened.
    //
    // The button LABEL, never its payload: "cancel:<appointment id>" in a
    // bubble reads as a glitch, and what the customer actually did was tap a
    // button that said "İptal" (Serdar, 2026-08-31). The payload keeps doing
    // its job below — naming the exact appointment — it just never renders.
    body:
      args.buttonLabel ||
      text ||
      media?.caption ||
      (!media && args.messageType && args.messageType !== "text"
        ? `[${args.messageType}]`
        : ""),
    wamid: message.id as string | undefined,
    mediaPending: Boolean(media?.id),
    mediaContentType: args.mediaContentType,
    mediaFileName: args.mediaFileName,
    lane: args.lane,
    ...(replyTo
      ? {
          replyToWamid: replyTo.wamid,
          replyToBody: replyTo.body,
          replyToDirection: replyTo.direction,
        }
      : {}),
  });
  // Scheduled, not awaited: Meta retries a webhook that does not get a
  // fast 200, so two network round-trips inside this handler would
  // turn one slow image into duplicate deliveries of the message.
  if (media?.id) {
    await ctx.scheduler.runAfter(0, internal.wa.downloadInboundMedia, {
      orgId,
      messageId: loggedId,
      mediaId: media.id,
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

  // Who answers this conversation, resolved BEFORE the typed-text match
  // below, because it is one of the match's inputs: an eligible agent narrows
  // intentOf to bare words. Guards repeat inside the action authoritatively;
  // this check only avoids scheduling work that would refuse itself.
  const org = await ctx.db.get(orgId);
  const contact = customer ?? (await ctx.db.get(contactId));
  // The business default and any disagreement this thread has with it, from
  // the one resolver.
  const agentMode = org
    ? conversationAgentMode(org, contact).effective
    : "off";
  const agentEligible =
    agentGenerates(agentMode) &&
    !org?.demoMode &&
    (org?.status ?? "active") !== "suspended" &&
    Boolean(text.trim());

  // A button payload names its exact appointment; typed text answers the
  // appointment the latest reminder or confirmation was about
  // (typedReplyTarget).
  const match = /^(confirm|cancel):(.+)$/.exec(payload);
  let intent: "confirm" | "cancel" | null = null;
  let appointmentId: Id<"appointments"> | null = null;
  if (match) {
    intent = match[1] as "confirm" | "cancel";
    appointmentId = match[2] as Id<"appointments">;
  } else if (customer) {
    intent = intentOf(text, agentEligible);
    if (intent) {
      appointmentId = await typedReplyTarget(ctx, customer, intent, Date.now());
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
    // The chat agent (docs/chat-agent.md §2): anything non-deterministic is
    // its job when the org runs one. Buttons and bare EVET/İPTAL never reach
    // here — the deterministic paths above are cheaper, safer and already
    // correct.
    if (agentEligible) {
      // Immediate, since 2026-08-31: the wait that coalesced fragmented
      // thoughts moved to the SEND side (AUTO_SEND_GRACE_MS), so the owner
      // sees the draft the moment it exists. A customer sending one thought
      // as four messages still gets one answer — each fragment's turn
      // supersedes the last (loadTurnContext's check at load, recordTurn's
      // retire at record).
      //
      // The marker is stamped in the same mutation that schedules, and it is
      // what the check reads — so a turn only ever stands down for a message
      // that actually took over from it. Rows that reach the agent's eligible
      // set are the only ones that move it.
      await ctx.db.patch(contactId, { agentTurnScheduledFor: loggedId });
      await ctx.scheduler.runAfter(0, internal.chatAgent.respond, {
        customerId: contactId,
        inboundMessageId: loggedId,
      });
    }
    // A LIVE agent answers at any hour, which supersedes "we're closed, book
    // here". The other modes deliberately change nothing the customer sees:
    // shadow and suggest both leave the customer waiting on a person, so the
    // away-reply below still runs and the agent's reply goes to the flight
    // recorder or the staff member's draft box instead.
    if (agentAnswersCustomer(agentMode) && agentEligible) return;
    // Closures are deliberately NOT consulted here (2026-08-29). The away-reply
    // means "nobody is here, do not wait up"; during a lunch break somebody IS
    // here and will answer in forty minutes, so "we're closed" is a worse
    // answer than the silence it replaces. It would also contradict itself:
    // the throttle is one reply per session window, so a customer who wrote at
    // 12:55 and got nothing would get "we're closed" at 13:15.
    //
    // Opening hours keep driving this. Closures drive what may be BOOKED.
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
      // Suspended stops every outbound, the away-reply included; the inbound
      // above was still logged, which is the whole shape of suspension.
      (org.status ?? "active") !== "suspended" &&
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
  // And the SENDER's own row (2026-10-13). A button names its appointment by
  // id, and the typed path already reads only the sender's appointments; a
  // tap is honoured on the tapper's own booking and nobody else's.
  if (appointment.customerId !== contactId) return;
  if (appointment.status === "completed") return;

  // Confirming is Resepta's own concept — cal.com bookings are already
  // accepted, so there is nothing to tell it.
  if (intent === "confirm") {
    // Only a LIVE booking can be confirmed. The button path takes its
    // appointment id straight from the payload, so a reminder still sitting in
    // the customer's thread can be tapped days after the booking was cancelled
    // — and this used to patch it back to confirmed, re-arming every reminder
    // the cancellation disarmed and re-blocking the slot it freed, while
    // cal.com kept its own cancelled state and was never told. The typed-text
    // path never had this hole, because typedReplyTarget hands a confirm only
    // an open appointment; the button path had to be told the same thing.
    if (appointment.status !== "scheduled" && appointment.status !== "confirmed") {
      return;
    }
    await ctx.db.patch(appointment._id, { status: "confirmed" });
    // Confirmed is still a live booking, so reminders continue — but
    // the recompute has to run or the field drifts from the row.
    await syncAppointmentSchedule(ctx, appointment._id);
    return;
  }

  // A second İPTAL (typedReplyTarget hands it back the appointment the first
  // one cancelled), or a tap on a reminder for an appointment already
  // cancelled, changes nothing, and must not send the cancellation again.
  if (appointment.status === "cancelled") return;
  // The customer's own cancel COUNTS toward the daily change cap
  // (lib/agentChange.ts) and is NEVER refused: cancelling is always theirs.
  // Counting it is what stops a cancel-and-rebook loop that alternates this
  // button with an assistant's bookings.
  if (contact) {
    await ctx.db.patch(contact._id, {
      agentChangesAt: withChange(contact.agentChangesAt, Date.now()),
    });
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
// WhatsApp app, so every staff reply has to be typed into Resepta. An
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
  args: { token: v.string(), payload: v.any() },
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

    // The TOKEN names the org, the same job it does on the cal.com route and
    // phone_number_id does on the Cloud lane. It used to be the instance name
    // out of the payload — a string nothing in this codebase generates, with no
    // length or charset rule, which made this endpoint unauthenticated in
    // practice: an anonymous POST naming an instance and a customer's number
    // reached the cancel path, pushed that cancellation to cal.com, and
    // scheduled a chat-agent reply on the org's budget.
    const token = args.token.trim();
    if (!token) return null;
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_evolution_token", (q) => q.eq("evolutionWebhookToken", token))
      .unique();
    if (!org) return null;
    // The instance name is now a label, but it still has to MATCH: one
    // deployment can run several instances, and a payload from the wrong one
    // must not be filed against this org's customers. Checked only when the org
    // has a name on file, so an org mid-setup is not locked out of its own
    // inbound.
    const instance = payload.instance?.trim();
    if (org.evolutionInstance && instance && org.evolutionInstance !== instance) {
      return null;
    }

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
        const staffReplyId = await ctx.db.insert("messages", {
          orgId: org._id,
          customerId: customer._id,
          direction: "out",
          // Its own kind, because it is not something Resepta sent. A staff
          // reply typed on a phone has no template, no delivery guarantee and
          // no retry — treating it as a normal send would put it in the reach
          // of the retry queue, which has nothing to retry it with.
          kind: "staff_reply",
          body,
          wamid: key.id,
          status: "sent",
          lane: "evolution",
        });
        await noteMessageById(ctx, staffReplyId);
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
