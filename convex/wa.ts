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
import {
  customerSender,
  emailBodyHtml,
  emailLaneConfigured,
  sendEmail,
  withOpenPixel,
} from "./lib/email";
import { appointmentIcs } from "./lib/ics";
import { resolveWaAccount } from "./lib/platformConfig";
import {
  fetchWaMedia,
  sendWaCloudImage,
  sendWaCloudTemplate,
  sendWaCloudText,
} from "./lib/waCloud";
import { isOrgSetupFailure } from "./lib/alerts";
import { outOfHoursMessage } from "./lib/awayReply";
import { renderTokens, tokenDefaults } from "./lib/renderTokens";
import { sendEvolutionText } from "./lib/evolution";
import {
  evolutionReplyHint,
  laneAvailability,
  laneForOutbound,
  laneForReply,
  loadEvolutionCreds,
} from "./lib/waLane";
import { isDemo } from "./demo";
import { EVOLUTION_NO_MEDIA } from "./lib/sendFailure";
import { formatMoney as formatMinorUnits } from "./lib/money";
import { requireOrg } from "./lib/orgAuth";
import { resolvePublicPhone } from "./lib/publicPhone";

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
    const [waAccount, org, contactFields] = await Promise.all([
      // Resolved here, not at the send: the platform-token fallback
      // (lib/platformConfig resolveWaAccount) needs ctx.db, and the action
      // reading this context has none.
      ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .unique()
        .then((row) => resolveWaAccount(ctx, row)),
      ctx.db.get(orgId),
      ctx.db
        .query("contactFields")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    ]);
    // org rides along for token rendering ([business]); the send itself needs
    // only the account. contactFields feed the same tokens the reminders and
    // campaigns speak — one vocabulary everywhere.
    const evolution = org
      ? await loadEvolutionCreds(ctx, orgId, org.evolutionInstance)
      : null;
    return {
      customer,
      waAccount,
      // publicPhone resolved here, where there is a db: the actions that read
      // this context render [phone] but cannot query the agent table.
      org: org ? { ...org, publicPhone: await resolvePublicPhone(ctx, org) } : org,
      evolution,
      contactFields,
    };
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
    const { customer, waAccount, org, evolution, contactFields } = context;
    // A human is answering this thread, so the chat agent stands down for it
    // (docs/chat-agent.md §5). Stamped before the send on purpose: even a
    // send that fails downstream is a person engaging, and the agent talking
    // over a human mid-repair is the worse failure. Idempotent; hand-back is
    // chatAgent.setPaused from the conversation header.
    await ctx.runMutation(internal.chatAgent.pauseForCustomer, {
      customerId: args.customerId,
    });
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
    const sessionCustom: Record<string, string> = {};
    for (const field of (contactFields ?? []) as { key: string }[]) {
      sessionCustom[field.key] = customer.custom?.[field.key] ?? "";
    }
    const body = renderTokens(raw, {
      firstName: customer.firstName,
      lastName: customer.lastName,
      businessName: org?.name,
      // Business number and link — one vocabulary across every surface.
      phone: org?.publicPhone,
      email: customer.email,
      bookingLink: org?.bookingUrl,
      custom: sessionCustom,
    });
    if (!body && !args.mediaStorageId) return { ok: false, reason: "empty" };
    // Suspension (docs/chat-agent.md §8): outbound stops, and the person
    // typing sees why instead of a silent nothing.
    if (org && (org.status ?? "active") === "suspended") {
      return { ok: false, reason: "org-suspended" };
    }
    if (customer.consentAt === undefined) return { ok: false, reason: "no-consent" };
    // Meta's 24h session window is Meta's rule. Evolution is a linked handset
    // and has no such window — the salon can answer an old message from their
    // phone whenever they like, and refusing to do the same from inside
    // Resepta would just teach them to pick the phone up instead.
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
      //
      // Said out loud rather than dropped: sending the caption alone and
      // returning ok put the photo in the staff thread and nothing in the
      // customer's.
      if (args.mediaStorageId) {
        await ctx.runMutation(internal.messages.applySendResult, {
          messageId,
          ok: false,
          error: EVOLUTION_NO_MEDIA,
        });
        return { ok: false, reason: EVOLUTION_NO_MEDIA };
      }
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
  args: { customerId: v.id("customers"), ruleId: v.id("messageRules") },
  returns: v.any(),
  handler: async (ctx, args) => {
    // No requireOrg: this one is triggered by an inbound webhook, not a signed-in
    // user. The org comes from the customer row, which the webhook already
    // resolved by phone_number_id.
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    const org = await ctx.db.get(customer.orgId);
    if (!org) return null;
    const [waAccount, rule, templates, contactFields] = await Promise.all([
      ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .unique()
        .then((row) => resolveWaAccount(ctx, row)),
      ctx.db.get(args.ruleId),
      ctx.db
        .query("waTemplates")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .collect(),
      ctx.db
        .query("contactFields")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .collect(),
    ]);
    return {
      customer,
      // Same as loadSessionContext: [phone] is resolved where the db is.
      org: { ...org, publicPhone: await resolvePublicPhone(ctx, org) },
      waAccount,
      rule,
      templates,
      contactFields,
    };
  },
});

// Deliberately does NOT require consentAt, unlike sendSession. Consent governs
// messages WE start; this is a reply to someone who just wrote to us, which is
// what every business messaging system does and what Meta's own away message
// does. The session window is open by construction — their inbound opened it.
// The once-per-window guard lives in webhook.ts, stamped before this is
// scheduled, same ordering as the reminder tick's double-send guard.
export const sendAwayReply = internalAction({
  args: { customerId: v.id("customers"), ruleId: v.id("messageRules") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.wa.loadAwayReplyContext, {
      customerId: args.customerId,
      ruleId: args.ruleId,
    });
    if (!context) return null;
    const { customer, org, waAccount, rule, templates, contactFields } = context;
    if (!waAccount) return null;
    // Paused (or deleted) between the webhook's stamp and this action running.
    // The stamp already happened, which errs toward not sending — the right
    // kind of stale, same as sendAppointmentMessage's guard.
    if (!rule || rule.paused) return null;
    const custom: Record<string, string> = {};
    for (const field of contactFields as { key: string }[]) {
      custom[field.key] = customer.custom?.[field.key] ?? "";
    }
    const message = outOfHoursMessage({
      templates,
      ruleId: args.ruleId,
      org,
      // The CUSTOMER's language, falling back to the org's.
      language: customer.language ?? org.language,
      firstName: customer.firstName,
      lastName: customer.lastName,
      custom,
    });
    // Null means nothing useful to say — no wording of the org's own, and no
    // link or phone for the stock text to hand over. The owner's notification
    // is better than "we're closed" and silence after it.
    if (!message) return null;

    const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
      orgId: customer.orgId,
      customerId: customer._id,
      kind: "session",
      body: message.body,
    });
    const result = await sendWaCloudText({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: customer.phone,
      body: message.body,
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
  args: {
    appointmentId: v.id("appointments"),
    // The rule this send belongs to, when it belongs to one — carries the
    // channel and selects the per-rule wording. Legacy sends have none.
    ruleId: v.optional(v.id("messageRules")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) return null;
    const rule = args.ruleId ? await ctx.db.get(args.ruleId) : null;
    const [customer, org, waAccount, templates, staffRow, contactFields] =
      await Promise.all([
        ctx.db.get(appointment.customerId),
        ctx.db.get(appointment.orgId),
        ctx.db
          .query("waAccounts")
          .withIndex("by_org", (q) => q.eq("orgId", appointment.orgId))
          .unique()
          .then((row) => resolveWaAccount(ctx, row)),
        ctx.db
          .query("waTemplates")
          .withIndex("by_org", (q) => q.eq("orgId", appointment.orgId))
          .collect(),
        // For the [staff] token. Null when nobody is assigned, and the token
        // renders as nothing — renderTokens' whitespace cleanup owns that case.
        appointment.staffId ? ctx.db.get(appointment.staffId) : null,
        // The org's field registry, so [age] and friends resolve from the same
        // source of truth the Fields tab shows.
        ctx.db
          .query("contactFields")
          .withIndex("by_org", (q) => q.eq("orgId", appointment.orgId))
          .collect(),
      ]);
    const evolution = org
      ? await loadEvolutionCreds(ctx, appointment.orgId, org.evolutionInstance)
      : null;
    return {
      appointment,
      customer,
      // Same as loadSessionContext: [phone] is resolved where the db is.
      org: org ? { ...org, publicPhone: await resolvePublicPhone(ctx, org) } : org,
      waAccount,
      templates,
      evolution,
      staffRow,
      rule,
      contactFields,
    };
  },
});

// The one outbound path for appointment-lifecycle messages: confirmations on
// booking, reminders and follow-ups from the cron, cancellation notices from
// the mutation that cancelled. Business-initiated → the Cloud lane always
// rides a Meta template message; session messages play no part here.
export const sendAppointmentMessage = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    kind: v.union(
      v.literal("confirmation"),
      v.literal("reminder"),
      v.literal("winback"),
      v.literal("followup"),
      v.literal("cancellation"),
    ),
    offsetHours: v.optional(v.number()),
    // Present on every send that came from a messageRules row. Drives the
    // channel and the per-rule wording; absent means a legacy-model org.
    ruleId: v.optional(v.id("messageRules")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.wa.loadSendContext, {
      appointmentId: args.appointmentId,
      ruleId: args.ruleId,
    });
    if (!context) return null;
    // Deployment-wide mail settings. An action has no ctx.db, so the operator's
    // platformConfig row is read through its own internal query.
    const mailConfig = await ctx.runQuery(internal.platformConfig.forSend, {});
    const {
      appointment,
      customer,
      org,
      waAccount,
      templates,
      evolution,
      staffRow,
      rule,
      contactFields,
    } = context;
    if (!customer || !org) return null;

    // Status gate per kind: each message only makes sense against the state
    // that earned it — a follow-up exists BECAUSE the visit happened, a
    // winback because it didn't, a cancellation notice because it won't.
    if (args.kind === "winback") {
      if (appointment.status !== "no_show") return null;
    } else if (args.kind === "followup") {
      if (appointment.status !== "completed") return null;
    } else if (args.kind === "cancellation") {
      if (appointment.status !== "cancelled") return null;
    } else if (
      appointment.status !== "scheduled" &&
      appointment.status !== "confirmed"
    ) {
      return null;
    }
    // A reminder for a start time already in the past is stale queue noise.
    if (args.kind === "reminder" && appointment.startAt <= Date.now()) return null;
    // A rule paused (or deleted) between the cron's stamp and this action
    // running says nothing should leave. The stamp already happened, which is
    // fine — a guard that errs toward not sending is the right kind of stale.
    if (args.ruleId && (!rule || rule.paused)) return null;

    // Suspension (docs/chat-agent.md §8). One failed row per owed send keeps
    // the stop visible in the thread and the failure counts; the alert lane
    // stays quiet (STEADY_STATE_FAILURES) because the operator did this on
    // purpose and one email per blocked reminder helps nobody.
    if ((org.status ?? "active") === "suspended") {
      const suspendedRow = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: org._id,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: args.kind,
      });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId: suspendedRow,
        ok: false,
        error: "org-suspended",
      });
      return null;
    }

    const messageKind =
      (args.kind === "reminder" || args.kind === "followup") &&
      args.offsetHours !== undefined
        ? `${args.kind}_${args.offsetHours}h`
        : args.kind;

    // Exact language match, no cross-language fallback (Nudge lesson: the
    // wrong-language message is worse than no message). The template ROW is
    // the content source for both channels; Meta approval only gates the
    // WhatsApp send, not the email.
    //
    // Resolution order is the per-message-wording feature: this rule's own row
    // first, the kind-level row for everything the owner has not worded
    // specifically.
    const language = customer.language ?? org.language;
    const ruleTemplate = rule
      ? templates.find(
          (t: { ruleId?: string; language: string }) =>
            t.ruleId === rule._id && t.language === language,
        )
      : undefined;
    const kindTemplate = templates.find(
      (t: { kind: string; language: string; ruleId?: string }) =>
        t.ruleId === undefined && t.kind === args.kind && t.language === language,
    );
    const contentTemplate = ruleTemplate ?? kindTemplate;
    // The Cloud lane needs both halves of the Meta registration: the approved
    // status AND the name to send under. metaName went optional the day orgs
    // without a Cloud number stopped being forced to invent one.
    //
    // Registration resolves SEPARATELY from content, and falls back to the
    // kind-level row: authoring per-rule wording must not cut off a Cloud lane
    // that was sending fine on the shared approved template. Until this rule's
    // own wording is registered and approved with Meta, Cloud sends the
    // generic approved string while email and the shop phone carry the words
    // the owner actually wrote.
    const metaSource =
      ruleTemplate && ruleTemplate.status === "approved" && ruleTemplate.metaName
        ? ruleTemplate
        : kindTemplate;
    const cloudTemplate =
      metaSource && metaSource.status === "approved" && metaSource.metaName
        ? { metaName: metaSource.metaName, language: metaSource.language }
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
    // Every org field key present, empty when this customer has no value —
    // so a real field always resolves (to nothing, cleanly) and only a token
    // nobody defined stays literal. See renderTokens.
    const customValues: Record<string, string> = {};
    for (const field of contactFields as { key: string }[]) {
      customValues[field.key] = customer.custom?.[field.key] ?? "";
    }
    // The appointment total for the [price] token, in the org's currency and
    // the message language. Items store integer minor units; no items or a
    // zero total renders as nothing rather than as a free appointment.
    const totalMinor = (
      (appointment.items ?? []) as { price?: number; quantity?: number }[]
    ).reduce((sum, item) => sum + (item.price ?? 0) * (item.quantity ?? 1), 0);
    // narrowSymbol, and the exponent from Intl rather than a hardcoded /100 —
    // i.e. lib/money.formatMoney, whose own comment names this exact case:
    // English renders TRY as the literal code ("TRY 400.00"), "which is what
    // you want in a table listing many currencies and wrong here". An org has
    // one currency, and this is the surface that reaches the customer, so the
    // dashboard was showing ₺400.00 while the reminder about that same
    // appointment said TRY 400.00.
    const formatMoney = (minor: number) =>
      formatMinorUnits(minor, org.currency ?? "TRY", language, org.priceDecimals);
    const price = totalMinor > 0 ? formatMoney(totalMinor) : undefined;
    // [pricelist] — the receipt look. An unpriced item keeps its bullet
    // without a dangling dash.
    const servicePriceList = appointment.items
      ?.map((item: { name: string; price?: number; quantity?: number }) => {
        const quantity = item.quantity ?? 1;
        const label = quantity > 1 ? `${quantity}× ${item.name}` : item.name;
        // The line's worth, not the unit price — a receipt line for three
        // cakes says what three cakes cost.
        // price === undefined, not falsy. A service priced 0 is "free", which
        // services.ts keeps deliberately distinct from "not priced" — and this
        // rendered both as a bare bullet, so a customer was never told the
        // consultation costs nothing. itemsTotal and lineWorth in
        // appointments.ts both test identity; this line was the holdout.
        return `• ${label}${
          item.price !== undefined ? ` — ${formatMoney(item.price * quantity)}` : ""
        }`;
      })
      .join("\n");
    const tokenValues = {
      firstName: customer.firstName,
      lastName: customer.lastName,
      businessName: org.name,
      appointmentAt: when,
      staffName: staffRow?.name,
      // The BUSINESS's number and link, not the customer's — [phone] is "call
      // us here" in a message the salon sends. See renderTokens.
      phone: org.publicPhone,
      email: customer.email,
      bookingLink: org.bookingUrl,
      // The appointment's own reschedule/cancel page. SITE_URL is deployment
      // config; without it the token renders as nothing rather than a
      // localhost link in a customer's inbox.
      manageLink:
        appointment.manageToken && process.env.SITE_URL
          ? `${process.env.SITE_URL}/appt/${appointment.manageToken}`
          : undefined,
      // One bullet line per booked service — [service] renders as a LIST, so
      // the stock texts put it on its own paragraph rather than mid-sentence.
      serviceName: appointment.items
        ?.map((item: { name: string; quantity?: number }) =>
          (item.quantity ?? 1) > 1 ? `• ${item.quantity}× ${item.name}` : `• ${item.name}`,
        )
        .join("\n"),
      servicePriceList,
      price,
      custom: customValues,
    };
    // The template's own "when empty, print…" table, so a token this
    // customer has no value for still says something (schema:
    // waTemplates.variableDefaults).
    const defaults = tokenDefaults(contentTemplate?.variableDefaults);
    const body = contentTemplate?.body
      ? renderTokens(contentTemplate.body, tokenValues, defaults)
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

    // Which channel(s) this message rides. The RULE owns the choice now — the
    // 24h reminder can be WhatsApp while the review ask goes by mail; the org
    // preference survives as the legacy default. "email" skips the WhatsApp
    // attempt entirely — including its failure rows, because a channel the
    // owner switched off cannot be broken.
    const channelPref = rule?.channel ?? org.messageChannel ?? "both";

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
    const lane = channelPref === "email" ? null : laneForOutbound(available);

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
    } else if (channelPref === "email") {
      // Email-only by choice. Not a failure of any kind: the WhatsApp rows
      // below would tell the owner a channel they switched off is broken.
    } else if (!waAccount && !evolution) {
      // Never connected, which is not the same as broken — and the same
      // reasoning as the branch above, one step further out. The rule stays
      // "both" until someone edits it, so a salon that only ever wanted email
      // still had every booking log a red WhatsApp row. The rule editor
      // already shows these businesses "Email" as the channel; this is the
      // send path finally agreeing with it.
      //
      // Only total absence is silent. A business that HAS WhatsApp and cannot
      // send falls through to the rows below, because that one is a real
      // fault and hiding it is how deliveries fail unnoticed.
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

    // Email lane: rides alongside WhatsApp (or replaces it, when the owner
    // chose email-only) for customers with an address and an org with a From.
    // No Meta approval applies to email, so the authored body sends as-is.
    //
    // On "both", a customer this cannot reach is skipped silently — WhatsApp
    // already carried the message or logged its own failure. On email-only
    // there is no other channel to blame, so every reason nothing went out
    // becomes a visible row: an owner who chose email and set no From, or a
    // customer with no address, must not produce a reminder that vanishes.
    // The From address, resolved rather than required: the salon's own domain
    // if they have one, otherwise the address they already own on ours.
    const sender = customerSender(org, mailConfig);
    if (channelPref === "whatsapp") {
      // Switched off. Same reasoning as the mirror case above.
    } else if (channelPref === "email" && (!emailLaneConfigured(mailConfig) || !sender)) {
      await fail("email-not-configured");
    } else if (channelPref === "email" && !customer.email) {
      await fail("no-email-address");
    } else if (channelPref === "email" && !body) {
      await fail(`no-template-text-${language}`);
    } else if (emailLaneConfigured(mailConfig) && customer.email && sender && body) {
      // The authored subject, rendered with the same tokens as the body. The
      // "name, time" fallback covers rows without one — and an authored
      // subject that renders to nothing for this customer falls through too,
      // because an empty subject line reads as spam.
      const subject =
        (contentTemplate?.subject
          ? renderTokens(contentTemplate.subject, tokenValues, defaults)
          : "") || `${org.name}, ${when}`;
      // The WYSIWYG-authored HTML when there is one — signature tables and
      // all — otherwise the plain body wrapped the way it always was. Tokens
      // render in either; they are literal text in both representations. The
      // service list swaps its newlines for <br/> here, because inside HTML a
      // bare \n is just a space and the list would flatten to one line.
      const emailHtml = contentTemplate?.bodyHtml
        ? renderTokens(
            contentTemplate.bodyHtml,
            {
              ...tokenValues,
              serviceName: tokenValues.serviceName?.replace(/\n/g, "<br/>"),
              servicePriceList: tokenValues.servicePriceList?.replace(/\n/g, "<br/>"),
            },
            defaults,
          )
        : emailBodyHtml(body);
      // Replies come back to US, not to whatever mailbox the From address
      // belongs to — same wiring as email.sendToCustomer, and for the same
      // reason: an answer that lands in a personal inbox never reaches the
      // timeline.
      const domain = mailConfig.domain;
      const replyTo =
        org.inboundAddress && domain
          ? `${org.inboundAddress}@${domain}`
          : undefined;
      // Every rule email counts and tracks now — the editor shows each
      // message's sent count, open rate and reply rate, so the numbers
      // finally report somewhere. Still a RATE over the template, never a
      // per-customer fact; recordEmailOpen's prefetch guard and the relay
      // caveat apply as ever.
      const tracked = contentTemplate;
      const trackingToken = tracked ? crypto.randomUUID() : undefined;
      // Confirmations carry the appointment as a real calendar invite;
      // cancellations carry the retraction under the same UID, so the entry
      // the invite created disappears again. Only these two kinds: a reminder
      // re-attaching the invite would re-prompt "add to calendar" for an event
      // the customer already holds, and a winback has no event at all.
      const ics =
        args.kind === "confirmation" || args.kind === "cancellation"
          ? {
              method: args.kind === "confirmation" ? ("REQUEST" as const) : ("CANCEL" as const),
              content: appointmentIcs({
                method: args.kind === "confirmation" ? "REQUEST" : "CANCEL",
                uid: String(appointment._id),
                startAtMs: appointment.startAt,
                durationMinutes:
                  appointment.durationMinutes ??
                  appointment.items?.reduce(
                    (sum: number, item: { durationMinutes: number }) =>
                      sum + item.durationMinutes,
                    0,
                  ) ??
                  30,
                summary: appointment.items?.length
                  ? `${org.name} — ${appointment.items
                      .map((item: { name: string }) => item.name)
                      .join(", ")}`
                  : org.name,
                ...(staffRow?.name ? { description: staffRow.name } : {}),
                organizerName: org.name,
                organizerEmail: sender,
                attendeeName:
                  [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
                  customer.email,
                attendeeEmail: customer.email,
                sequence: appointment.icsSequence,
              }),
            }
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
        // The resolved From, not the org's raw field: a retry has to leave
        // from the same address this attempt did, and the row is what the
        // retry reads.
        emailFrom: sender,
        trackingToken,
        templateId: tracked ? contentTemplate._id : undefined,
      });
      const emailResult = await sendEmail({
        apiKey: mailConfig.apiKey,
        from: sender,
        to: customer.email,
        subject,
        html: withOpenPixel(emailHtml, trackingToken),
        replyTo,
        ics,
      });
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId: emailMessageId,
        ok: emailResult.ok,
        error: emailResult.ok ? undefined : emailResult.reason,
      });
      // On "both", the WhatsApp branches own this stamp. Email-only has no
      // other branch to do it, and an unstamped confirmation reads as never
      // sent.
      if (emailResult.ok && channelPref === "email" && args.kind === "confirmation") {
        await ctx.runMutation(internal.appointments.stampConfirmationSent, {
          appointmentId: appointment._id,
        });
      }
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
    const account = await resolveWaAccount(
      ctx,
      await ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .unique(),
    );
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

// Context for the DISPATCH of a parked message. Deliberately not
// loadSessionContext: that one begins with requireOrg because its caller is a
// signed-in composer, and this one's caller is a CRON — scheduled functions
// carry no auth identity, so requireOrg throws "not-signed-in" and the whole
// dispatch tick died on the first due message (found 2026-08-11; the claimed
// row then hung in flight until the reaper failed it as "stuck"). The org
// comes from the CUSTOMER row instead, which the message row named — the same
// sessionless resolution loadAwayReplyContext uses, and the same scoping
// guarantee: the org is read off our own stored rows, never off caller input.
export const loadScheduledSendContext = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    const org = await ctx.db.get(customer.orgId);
    if (!org) return null;
    const waAccount = await resolveWaAccount(
      ctx,
      await ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .unique(),
    );
    const evolution = await loadEvolutionCreds(ctx, customer.orgId, org.evolutionInstance);
    return { customer, org, waAccount, evolution };
  },
});

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
      // The sessionless context — see loadScheduledSendContext above for why
      // loadSessionContext must never be called from this cron.
      const context = await ctx.runQuery(internal.wa.loadScheduledSendContext, {
        customerId: item.customerId,
      });
      // The demo boundary, restored: sendSession parks a scheduled row BEFORE
      // its demo branch, so this dispatch is the first point a demo org's
      // parked message could reach a provider. Simulate it instead — the same
      // promise every immediate send path keeps, checked before credentials
      // for the same reason (the demo org has none by design).
      if (context && isDemo(context.org)) {
        await ctx.runMutation(internal.demo.landSimulated, {
          messageId: item.messageId,
          orgId: context.org._id,
          customerId: item.customerId,
        });
        continue;
      }
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
      // Suspension re-checked at dispatch, like the window below: the org may
      // have been suspended between parking the message and its moment.
      if ((context.org?.status ?? "active") === "suspended") {
        await ctx.runMutation(internal.messages.applySendResult, {
          messageId: item.messageId,
          ok: false,
          error: "org-suspended",
        });
        continue;
      }
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
      // Refused, not silently downgraded. Evolution is text-only here for the
      // reason the immediate path states, and that is fine — what was not fine
      // is that this branch dropped the attachment, sent the caption alone, and
      // reported ok:true, so the row went to "sent" and the staff thread
      // rendered a photo the customer never received.
      if (lane === "evolution" && item.mediaStorageId) {
        await ctx.runMutation(internal.messages.applySendResult, {
          messageId: item.messageId,
          ok: false,
          error: EVOLUTION_NO_MEDIA,
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
