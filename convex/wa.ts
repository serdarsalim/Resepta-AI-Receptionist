import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { formatAppointmentTime } from "./lib/format";
import { emailBodyHtml, emailLaneConfigured, sendEmail } from "./lib/email";
import {
  fetchWaMedia,
  sendWaCloudImage,
  sendWaCloudTemplate,
  sendWaCloudText,
} from "./lib/waCloud";
import { isOrgSetupFailure } from "./lib/alerts";
import { awayReplyText } from "./lib/awayReply";
import { renderTokens } from "./lib/renderTokens";
import { sendEvolutionText } from "./lib/evolution";
import {
  evolutionReplyHint,
  laneAvailability,
  laneForOutbound,
  laneForReply,
  loadEvolutionCreds,
} from "./lib/waLane";
import { isDemo } from "./demo";
import { requireOrg } from "./lib/orgAuth";

const SESSION_WINDOW_MS = 24 * 3600_000;

// Context for a rep-typed session message. Runs with the caller's auth (auth
// propagates through runQuery), so the org scoping holds inside the action.
export const loadSessionContext = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) return null;
    const [waAccount, org] = await Promise.all([
      ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .unique(),
      ctx.db.get(orgId),
    ]);
    // org rides along for token rendering ([isletme]); the send itself needs
    // only the account.
    const evolution = org
      ? await loadEvolutionCreds(ctx, orgId, org.evolutionInstance)
      : null;
    return { customer, waAccount, org, evolution };
  },
});

// Free-form reply from the contact page composer. Session messages only work
// inside the 24h window the customer's last inbound opened — outside it Meta
// rejects with 131047, so we refuse locally with a readable reason instead.
export const sendSession = action({
  args: {
    customerId: v.id("customers"),
    body: v.string(),
    // Unset = send now. A moment in the future parks the row instead, for the
    // cron to pick up — the salon writing tonight's follow-up at 23:00 and
    // having it land at 10:00 tomorrow.
    scheduledFor: v.optional(v.number()),
    // An image from the library (convex/media.ts). With one attached the body
    // becomes the CAPTION rather than a separate message, because two
    // notifications for one thought is how a salon's thread becomes noise.
    mediaStorageId: v.optional(v.id("_storage")),
  },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  // Annotated explicitly: this handler calls internal.wa.* from the file that
  // defines it, so without a written return type the inference runs back
  // through the generated api and lands on itself (TS7022/7023). The
  // annotation cuts the loop — and losing it degrades the api types to `any`
  // for every caller in src/, which is a much noisier failure than it looks.
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const raw = args.body.trim();
    // An image on its own is a message; text on its own is a message; neither
    // is not.
    if (!raw && !args.mediaStorageId) return { ok: false, reason: "empty" };
    const context = await ctx.runQuery(internal.wa.loadSessionContext, {
      customerId: args.customerId,
    });
    if (!context) return { ok: false, reason: "not-found" };
    const { customer, waAccount, org, evolution } = context;
    // org is non-null for every real send here; the demo path below is the
    // only caller that reaches this with one missing.
    const available = org
      ? laneAvailability({ org, waAccount, evolutionConfigured: Boolean(evolution) })
      : { cloud: false, evolution: false };
    // Rule 1: answer on the number they wrote to. A customer who messaged the
    // shop phone and gets answered from the Cloud number sees an unknown
    // number replying to a conversation they had somewhere else.
    const lane = laneForReply(available, customer);
    // Before the credential check, for the same reason as the template lane:
    // the demo org has no waAccount by design.
    if (!lane && !isDemo(org)) return { ok: false, reason: "wa-not-configured" };
    // Free-form session text, so named tokens work here — this is not a Meta
    // template and nothing about {{1}} applies. Rendered ONCE, at send time,
    // and the stored row keeps the rendered text: the thread has to show what
    // the customer actually received, not the recipe for it.
    const body = renderTokens(raw, {
      firstName: customer.firstName,
      lastName: customer.lastName,
      businessName: org?.name,
      phone: customer.phone,
    });
    if (!body && !args.mediaStorageId) return { ok: false, reason: "empty" };
    if (customer.consentAt === undefined) return { ok: false, reason: "no-consent" };
    // Meta's 24h session window is Meta's rule. Evolution is a linked handset
    // and has no such window — the salon can answer an old message from their
    // phone whenever they like, and refusing to do the same from inside
    // Randevu would just teach them to pick the phone up instead.
    if (
      lane !== "evolution" &&
      (!customer.lastInboundAt ||
        Date.now() - customer.lastInboundAt > SESSION_WINDOW_MS)
    ) {
      // Checked for an immediate send only. A scheduled one is checked again
      // at dispatch, because a window that is open now may be shut by then —
      // and one that is shut now may have re-opened if the customer writes
      // back in the meantime.
      if (!args.scheduledFor) {
        return { ok: false, reason: "session-window-closed" };
      }
    }
    const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
      orgId: customer.orgId,
      customerId: customer._id,
      kind: "session",
      body,
      scheduledFor: args.scheduledFor,
      mediaStorageId: args.mediaStorageId,
      lane: lane ?? undefined,
    });
    // Parked. The row is visible in the thread immediately, counting down,
    // which is the whole point: a scheduled message you cannot see is a
    // message you will send twice.
    if (args.scheduledFor) return { ok: true };

    if (isDemo(org)) {
      await ctx.runMutation(internal.demo.landSimulated, {
        messageId,
        orgId: customer.orgId,
        customerId: customer._id,
      });
      return { ok: true };
    }
    if (lane === "evolution" && evolution) {
      // No image lane here. Evolution can send media, but it fetches the URL
      // itself and Convex storage URLs are signed and short-lived, so a
      // picture would arrive as a broken fetch rather than a photo. Text is
      // what this lane is for.
      const sent = await sendEvolutionText({
        baseUrl: evolution.baseUrl,
        apiKey: evolution.apiKey,
        instance: evolution.instance,
        to: customer.phone,
        body,
      });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId,
        ok: sent.ok,
        wamid: sent.ok ? sent.messageId : undefined,
        error: sent.ok ? undefined : sent.reason,
      });
      return sent.ok ? { ok: true } : { ok: false, reason: sent.reason };
    }
    // Only a demo org reaches this far without one, and that path returned
    // above — so this is narrowing for the compiler, not a real case.
    if (!waAccount) return { ok: false, reason: "wa-not-configured" };

    // Meta fetches the image from this URL itself, so it has to be reachable
    // from the outside. In DEV ctx.storage.getUrl returns a 127.0.0.1 address
    // that Meta obviously cannot reach — image sends only work from a
    // deployed backend. (Nudge hit exactly this and it is worth knowing before
    // you spend an evening on it.)
    const link = args.mediaStorageId
      ? await ctx.storage.getUrl(args.mediaStorageId)
      : null;
    const result =
      args.mediaStorageId && link
        ? await sendWaCloudImage({
            accessToken: waAccount.accessToken,
            phoneNumberId: waAccount.phoneNumberId,
            to: customer.phone,
            link,
            caption: body || undefined,
          })
        : await sendWaCloudText({
            accessToken: waAccount.accessToken,
            phoneNumberId: waAccount.phoneNumberId,
            to: customer.phone,
            body,
          });
    await ctx.runMutation(internal.messages.applySendResult, {
      messageId,
      ok: result.ok,
      wamid: result.ok ? result.wamid : undefined,
      error: result.ok ? undefined : result.reason,
    });
    // No alert here: applySendResult owns that decision now, because it is the
    // only place that knows whether this failure is terminal or about to be
    // retried. The caller still gets the reason back — someone typed this
    // message and is watching for it to land.
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  },
});

// ---- Out-of-hours away-reply ----

export const loadAwayReplyContext = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.any(),
  handler: async (ctx, args) => {
    // No requireOrg: this one is triggered by an inbound webhook, not a signed-in
    // user. The org comes from the customer row, which the webhook already
    // resolved by phone_number_id.
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    const org = await ctx.db.get(customer.orgId);
    if (!org) return null;
    const waAccount = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
      .unique();
    return { customer, org, waAccount };
  },
});

// Deliberately does NOT require consentAt, unlike sendSession. Consent governs
// messages WE start; this is a reply to someone who just wrote to us, which is
// what every business messaging system does and what Meta's own away message
// does. The session window is open by construction — their inbound opened it.
// The once-per-window guard lives in webhook.ts, stamped before this is
// scheduled, same ordering as the reminder tick's double-send guard.
export const sendAwayReply = internalAction({
  args: { customerId: v.id("customers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.wa.loadAwayReplyContext, {
      customerId: args.customerId,
    });
    if (!context) return null;
    const { customer, org, waAccount } = context;
    if (!waAccount) return null;
    const body = awayReplyText({
      businessName: org.name,
      bookingUrl: org.bookingUrl,
      publicPhone: org.publicPhone,
      // The CUSTOMER's language, falling back to the org's.
      language: customer.language ?? org.language,
      override: org.autoReplyText,
      firstName: customer.firstName,
    });
    // Null means no link and no phone are configured, so the message would say
    // "we're closed" and nothing else. The owner's notification is better.
    if (!body) return null;

    const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
      orgId: customer.orgId,
      customerId: customer._id,
      kind: "session",
      body,
    });
    const result = await sendWaCloudText({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: customer.phone,
      body,
    });
    await ctx.runMutation(internal.messages.applySendResult, {
      messageId,
      ok: result.ok,
      wamid: result.ok ? result.wamid : undefined,
      error: result.ok ? undefined : result.reason,
    });
    return null;
  },
});

// Everything one send needs, in one read. Internal-only: the waAccount here
// carries the live access token, which must never transit a public function.
export const loadSendContext = internalQuery({
  args: { appointmentId: v.id("appointments") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) return null;
    const [customer, org, waAccount, templates, staffRow] = await Promise.all([
      ctx.db.get(appointment.customerId),
      ctx.db.get(appointment.orgId),
      ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", appointment.orgId))
        .unique(),
      ctx.db
        .query("waTemplates")
        .withIndex("by_org", (q) => q.eq("orgId", appointment.orgId))
        .collect(),
      // For the [personel] token. Null when nobody is assigned, and the token
      // renders as nothing — renderTokens' whitespace cleanup owns that case.
      appointment.staffId ? ctx.db.get(appointment.staffId) : null,
    ]);
    const evolution = org
      ? await loadEvolutionCreds(ctx, appointment.orgId, org.evolutionInstance)
      : null;
    return { appointment, customer, org, waAccount, templates, evolution, staffRow };
  },
});

// The one outbound path: confirmation on booking, reminders from the cron.
// Business-initiated → always a Meta template message; session messages play
// no part here.
export const sendAppointmentMessage = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    kind: v.union(
      v.literal("confirmation"),
      v.literal("reminder"),
      v.literal("winback"),
    ),
    offsetHours: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.wa.loadSendContext, {
      appointmentId: args.appointmentId,
    });
    if (!context) return null;
    const { appointment, customer, org, waAccount, templates, evolution, staffRow } =
      context;
    if (!customer || !org) return null;

    // Status gate per kind: confirmations/reminders ride live appointments; a
    // winback exists precisely BECAUSE the appointment ended as a no_show.
    if (args.kind === "winback") {
      if (appointment.status !== "no_show") return null;
    } else if (
      appointment.status !== "scheduled" &&
      appointment.status !== "confirmed"
    ) {
      return null;
    }
    // A reminder for a start time already in the past is stale queue noise.
    if (args.kind === "reminder" && appointment.startAt <= Date.now()) return null;

    const messageKind =
      args.kind === "reminder" && args.offsetHours !== undefined
        ? `reminder_${args.offsetHours}h`
        : args.kind;

    // Exact language match, no cross-language fallback (Nudge lesson: the
    // wrong-language message is worse than no message). The template ROW is
    // the content source for both channels; Meta approval only gates the
    // WhatsApp send, not the email.
    const language = customer.language ?? org.language;
    const contentTemplate = templates.find(
      (t: { kind: string; language: string }) =>
        t.kind === args.kind && t.language === language,
    );
    // The Cloud lane needs both halves of the Meta registration: the approved
    // status AND the name to send under. metaName went optional the day orgs
    // without a Cloud number stopped being forced to invent one.
    const cloudTemplate =
      contentTemplate && contentTemplate.status === "approved" && contentTemplate.metaName
        ? { metaName: contentTemplate.metaName, language: contentTemplate.language }
        : undefined;

    const fail = async (reason: string) => {
      if (
        isOrgSetupFailure(reason) &&
        (await ctx.runQuery(internal.messages.hasRecentFailure, {
          orgId: appointment.orgId,
          error: reason,
        }))
      ) {
        // Already on record for this org. The alert below is suppressed for
        // these reasons anyway, so there is nothing else to do.
        return;
      }
      const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: messageKind,
      });
      // applySendResult alerts if this reason warrants it. Every reason that
      // reaches here is a local refusal, so it classifies permanent and fails
      // terminally rather than entering the retry queue — which is right: a
      // customer who never consented will not have consented in five minutes.
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId,
        ok: false,
        error: reason,
      });
    };

    // KVKK consent gates EVERY channel.
    if (customer.consentAt === undefined) {
      await fail("no-consent");
      return null;
    }

    const when = formatAppointmentTime(appointment.startAt, org.timezone, language);
    const bodyParams = [customer.firstName, org.name, when];
    // The authored body, when the owner has written one — named tokens, same
    // vocabulary as the composer and campaigns. The positional bodyPreview
    // survives only as the fallback for rows nobody has authored yet; it is a
    // transcription of Meta's approved string, not something the salon wrote.
    const tokenValues = {
      firstName: customer.firstName,
      lastName: customer.lastName,
      businessName: org.name,
      appointmentAt: when,
      staffName: staffRow?.name,
      phone: customer.phone,
      serviceName: appointment.items
        ?.map((item: { name: string }) => item.name)
        .join(", "),
    };
    const body = contentTemplate?.body
      ? renderTokens(contentTemplate.body, tokenValues)
      : contentTemplate?.bodyPreview
        ? contentTemplate.bodyPreview
            .replace(/\{\{1\}\}/g, customer.firstName)
            .replace(/\{\{2\}\}/g, org.name)
            .replace(/\{\{3\}\}/g, when)
        : undefined;

    // ---- Demo org: nothing leaves the building.
    //
    // Checked BEFORE the waAccount test, not after: the demo org deliberately
    // has no credentials, so the ordinary path would fail it as
    // "wa-not-configured" and the showroom would be a wall of red rows. The
    // simulated send never constructs a request at all.
    if (isDemo(org)) {
      const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: messageKind,
        templateName: contentTemplate?.metaName,
        templateParams: bodyParams,
        body,
      });
      await ctx.runMutation(internal.demo.landSimulated, {
        messageId,
        orgId: appointment.orgId,
        customerId: customer._id,
      });
      if (args.kind === "confirmation") {
        await ctx.runMutation(internal.appointments.stampConfirmationSent, {
          appointmentId: appointment._id,
        });
      }
      return null;
    }

    // ---- WhatsApp attempt. Failures log a visible row and do NOT block the
    // email lane — an unconfigured number is exactly what the Messages tab
    // needs to show the owner.
    const available = laneAvailability({
      org,
      waAccount,
      evolutionConfigured: Boolean(evolution),
    });
    // Rule 2: Cloud wins whenever it exists. A confirmation or a reminder is
    // first contact after silence, which is precisely what Evolution drops
    // silently (Reachout Timelock, ACK 463, while the send returns success).
    const lane = laneForOutbound(available);

    if (lane === "evolution" && evolution) {
      // No Meta template here and none needed — this lane has no approval to
      // satisfy. It does need WORDS: a row whose owner never authored a body
      // and whose bodyPreview is empty has nothing to say, and before this
      // guard the customer received the string "undefined".
      if (!body) {
        await fail(`no-template-text-${language}`);
        return null;
      }
      // What the buttons would have been, in words: Baileys never delivers
      // quick replies, so the customer is told which words to type, and
      // webhook.ts already understands every one of them.
      const text = `${body}\n\n${evolutionReplyHint(language)}`;
      const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: messageKind,
        body: text,
        lane: "evolution",
      });
      const result = await sendEvolutionText({
        baseUrl: evolution.baseUrl,
        apiKey: evolution.apiKey,
        instance: evolution.instance,
        to: customer.phone,
        body: text,
      });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId,
        ok: result.ok,
        wamid: result.ok ? result.messageId : undefined,
        error: result.ok ? undefined : result.reason,
      });
      if (result.ok && args.kind === "confirmation") {
        await ctx.runMutation(internal.appointments.stampConfirmationSent, {
          appointmentId: appointment._id,
        });
      }
    } else if (!waAccount) {
      await fail("wa-not-configured");
    } else if (!cloudTemplate) {
      await fail(`no-approved-template-${language}`);
    } else {
      const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: messageKind,
        templateName: cloudTemplate.metaName,
        templateParams: bodyParams,
        body,
      });
      const result = await sendWaCloudTemplate({
        accessToken: waAccount.accessToken,
        phoneNumberId: waAccount.phoneNumberId,
        to: customer.phone,
        templateName: cloudTemplate.metaName,
        languageCode: cloudTemplate.language,
        bodyParams,
        buttons: [
          { index: 0, payload: `confirm:${appointment._id}` },
          { index: 1, payload: `cancel:${appointment._id}` },
        ],
      });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId,
        ok: result.ok,
        wamid: result.ok ? result.wamid : undefined,
        error: result.ok ? undefined : result.reason,
      });
      if (result.ok && args.kind === "confirmation") {
        await ctx.runMutation(internal.appointments.stampConfirmationSent, {
          appointmentId: appointment._id,
        });
      }
    }

    // Email lane: rides alongside WhatsApp when the customer left an address
    // and the org set a From. No Meta approval applies to email, so the
    // authored body sends as-is.
    if (emailLaneConfigured() && customer.email && org.emailFrom && body) {
      // The authored subject, rendered with the same tokens as the body. The
      // "name, time" fallback covers rows without one — and an authored
      // subject that renders to nothing for this customer falls through too,
      // because an empty subject line reads as spam.
      const subject =
        (contentTemplate?.subject
          ? renderTokens(contentTemplate.subject, tokenValues)
          : "") || `${org.name}, ${when}`;
      // Replies come back to US, not to whatever mailbox the From address
      // belongs to — same wiring as email.sendToCustomer, and for the same
      // reason: an answer that lands in a personal inbox never reaches the
      // timeline.
      const domain = process.env.RESEND_INBOUND_DOMAIN;
      const replyTo =
        org.inboundAddress && domain
          ? `${org.inboundAddress}@${domain}`
          : undefined;
      const emailMessageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: `email_${messageKind}`,
        body,
        // On the row from the start, so the thread shows the real subject and
        // a retry reuses it instead of rebuilding a different one.
        emailSubject: subject,
        emailFrom: org.emailFrom,
      });
      const emailResult = await sendEmail({
        from: `${org.name} <${org.emailFrom}>`,
        to: customer.email,
        subject,
        html: emailBodyHtml(body),
        replyTo,
      });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId: emailMessageId,
        ok: emailResult.ok,
        error: emailResult.ok ? undefined : emailResult.reason,
      });
    }
    return null;
  },
});

// The org's WhatsApp credentials, for the media download below. Its own query
// rather than reusing loadSendContext, which loads a customer this has no
// business reading.
export const accountForOrg = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.union(v.object({ accessToken: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();
    return account ? { accessToken: account.accessToken } : null;
  },
});

// ---- Inbound image download ----
//
// Scheduled by the webhook, never awaited by it. Meta retries a webhook it
// does not get a fast 200 for, so doing two network round-trips inside the
// handler would turn one slow image into duplicate deliveries of the whole
// message.
export const downloadInboundMedia = internalAction({
  args: {
    orgId: v.id("orgs"),
    messageId: v.id("messages"),
    mediaId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.runQuery(internal.wa.accountForOrg, {
      orgId: args.orgId,
    });
    if (!account) {
      // Clear the flag anyway. A row stuck "pending" forever shows a spinner
      // that will never resolve, which is worse than a message with no image.
      await ctx.runMutation(internal.messages.attachMedia, {
        messageId: args.messageId,
      });
      return null;
    }
    const media = await fetchWaMedia({
      accessToken: account.accessToken,
      mediaId: args.mediaId,
    });
    if (!media) {
      await ctx.runMutation(internal.messages.attachMedia, {
        messageId: args.messageId,
      });
      return null;
    }
    const storageId = await ctx.storage.store(media.blob);
    await ctx.runMutation(internal.messages.attachMedia, {
      messageId: args.messageId,
      storageId,
    });
    return null;
  },
});

// ---- Scheduled sends ----

export const dueScheduled = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      messageId: v.id("messages"),
      customerId: v.id("customers"),
      // Optional because an image on its own is a legitimate message; with one
      // attached this is the caption.
      body: v.optional(v.string()),
      mediaStorageId: v.optional(v.id("_storage")),
      // Which number this was written to go out on. Unset = cloud.
      lane: v.optional(v.union(v.literal("cloud"), v.literal("evolution"))),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_status_scheduled", (q) =>
        // Above zero excludes rows with no scheduledFor at all — unset sorts
        // before every number, so without it this range reads every queued
        // message on the deployment, including ones merely waiting on a retry.
        q.eq("status", "queued").gt("scheduledFor", 0).lte("scheduledFor", Date.now()),
      )
      .take(100);
    return rows
      .filter((row) => row.customerId && (row.body || row.mediaStorageId))
      .map((row) => ({
        messageId: row._id,
        customerId: row.customerId!,
        body: row.body,
        mediaStorageId: row.mediaStorageId,
        lane: row.lane,
      }));
  },
});

// Clears the parked marker the moment dispatch starts, BEFORE the send. Same
// ordering the reminder cron uses, and for the same reason: two overlapping
// ticks must not both decide a message is still due.
export const claimScheduled = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.messageId);
    if (!row || row.status !== "queued" || row.scheduledFor === undefined) return false;
    // sendingAt marks it in flight so delivery.reapStuck can find it if this
    // action dies before reporting a result. Without it a parked send whose
    // dispatch was killed would sit queued with nothing left to pick it up.
    await ctx.db.patch(args.messageId, {
      scheduledFor: undefined,
      sendingAt: Date.now(),
    });
    return true;
  },
});

export const sendDueScheduled = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const due = await ctx.runQuery(internal.wa.dueScheduled, {});
    for (const item of due) {
      const claimed = await ctx.runMutation(internal.wa.claimScheduled, {
        messageId: item.messageId,
      });
      if (!claimed) continue;
      const context = await ctx.runQuery(internal.wa.loadSessionContext, {
        customerId: item.customerId,
      });
      // The lane comes off the ROW, set when the salon wrote the message. A
      // reply parked at 23:00 for 10:00 has to leave from the number the
      // conversation is on, not from whatever the org has configured by then.
      const lane = item.lane ?? "cloud";
      if (!context || (lane === "cloud" ? !context.waAccount : !context.evolution)) {
        await ctx.runMutation(internal.messages.applySendResult, {
          messageId: item.messageId,
          ok: false,
          error: lane === "cloud" ? "wa-not-configured" : "evolution-not-configured",
        });
        continue;
      }
      const { customer, waAccount, evolution } = context;
      // Re-checked HERE, not at scheduling time. The 24h window a message was
      // written inside may have shut before its moment arrived, and Meta will
      // reject the send rather than deliver it late. Evolution is a linked
      // handset with no such window, so it is exempt for the same reason the
      // immediate path is.
      if (
        lane === "cloud" &&
        (!customer.lastInboundAt ||
          Date.now() - customer.lastInboundAt > SESSION_WINDOW_MS)
      ) {
        await ctx.runMutation(internal.messages.applySendResult, {
          messageId: item.messageId,
          ok: false,
          error: "session-window-closed",
        });
        continue;
      }
      const link =
        lane === "cloud" && item.mediaStorageId
          ? await ctx.storage.getUrl(item.mediaStorageId)
          : null;
      const result = evolution && lane === "evolution"
        ? await sendEvolutionText({
            baseUrl: evolution.baseUrl,
            apiKey: evolution.apiKey,
            instance: evolution.instance,
            to: customer.phone,
            body: item.body ?? "",
          }).then((sent) =>
            sent.ok
              ? ({ ok: true as const, wamid: sent.messageId })
              : ({ ok: false as const, reason: sent.reason }),
          )
        : !waAccount
          ? ({ ok: false as const, reason: "wa-not-configured" })
          : item.mediaStorageId && link
          ? await sendWaCloudImage({
              accessToken: waAccount.accessToken,
              phoneNumberId: waAccount.phoneNumberId,
              to: customer.phone,
              link,
              caption: item.body || undefined,
            })
          : await sendWaCloudText({
              accessToken: waAccount.accessToken,
              phoneNumberId: waAccount.phoneNumberId,
              to: customer.phone,
              body: item.body ?? "",
            });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId: item.messageId,
        ok: result.ok,
        wamid: result.ok ? result.wamid : undefined,
        error: result.ok ? undefined : result.reason,
      });
    }
    return null;
  },
});

// Cancel a parked send. Deletes the row rather than marking it cancelled: it
// never reached anybody, so leaving a tombstone in the customer's thread
// records a conversation that did not happen.
export const cancelScheduled = mutation({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const row = await ctx.db.get(args.messageId);
    if (!row || row.orgId !== orgId) throw new Error("not-found");
    // Already gone out — nothing to cancel, and pretending otherwise would be
    // telling the salon a message was stopped when the customer has it.
    if (row.scheduledFor === undefined || row.status !== "queued") return null;
    await ctx.db.delete(args.messageId);
    return null;
  },
});
