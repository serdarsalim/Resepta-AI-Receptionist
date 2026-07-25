import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, internalQuery } from "./_generated/server";
import { formatAppointmentTime } from "./lib/format";
import { sendEmailViaN8n } from "./lib/email";
import { sendWaCloudTemplate, sendWaCloudText } from "./lib/waCloud";
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
    const waAccount = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    return { customer, waAccount };
  },
});

// Free-form reply from the contact page composer. Session messages only work
// inside the 24h window the customer's last inbound opened — outside it Meta
// rejects with 131047, so we refuse locally with a readable reason instead.
export const sendSession = action({
  args: { customerId: v.id("customers"), body: v.string() },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const body = args.body.trim();
    if (!body) return { ok: false, reason: "empty" };
    const context = await ctx.runQuery(internal.wa.loadSessionContext, {
      customerId: args.customerId,
    });
    if (!context) return { ok: false, reason: "not-found" };
    const { customer, waAccount } = context;
    if (!waAccount) return { ok: false, reason: "wa-not-configured" };
    if (customer.consentAt === undefined) return { ok: false, reason: "no-consent" };
    if (
      !customer.lastInboundAt ||
      Date.now() - customer.lastInboundAt > SESSION_WINDOW_MS
    ) {
      return { ok: false, reason: "session-window-closed" };
    }
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
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
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
    const [customer, org, waAccount, templates] = await Promise.all([
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
    ]);
    return { appointment, customer, org, waAccount, templates };
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
    const { appointment, customer, org, waAccount, templates } = context;
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
    const waTemplate =
      contentTemplate?.status === "approved" ? contentTemplate : undefined;

    const fail = async (reason: string) => {
      const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: messageKind,
      });
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
    const body = contentTemplate?.bodyPreview
      ? contentTemplate.bodyPreview
          .replace(/\{\{1\}\}/g, customer.firstName)
          .replace(/\{\{2\}\}/g, org.name)
          .replace(/\{\{3\}\}/g, when)
      : undefined;

    // ---- WhatsApp attempt. Failures log a visible row and do NOT block the
    // email lane — an unconfigured number is exactly what the Messages tab
    // needs to show the owner.
    if (!waAccount) {
      await fail("wa-not-configured");
    } else if (!waTemplate) {
      await fail(`no-approved-template-${language}`);
    } else {
      const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: messageKind,
        templateName: waTemplate.metaName,
        body,
      });
      const result = await sendWaCloudTemplate({
        accessToken: waAccount.accessToken,
        phoneNumberId: waAccount.phoneNumberId,
        to: customer.phone,
        templateName: waTemplate.metaName,
        languageCode: waTemplate.language,
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

    // Email lane (n8n-delivered): rides alongside WhatsApp when the customer
    // left an email and the org set a From. No Meta approval applies to
    // email, so the template's bodyPreview text sends as-is.
    const emailWebhook = process.env.N8N_EMAIL_WEBHOOK_URL;
    if (emailWebhook && customer.email && org.emailFrom && body) {
      const emailMessageId = await ctx.runMutation(internal.messages.logOutQueued, {
        orgId: appointment.orgId,
        customerId: customer._id,
        appointmentId: appointment._id,
        kind: `email_${messageKind}`,
        body,
      });
      const emailResult = await sendEmailViaN8n({
        webhookUrl: emailWebhook,
        from: org.emailFrom,
        to: customer.email,
        subject: `${org.name} — ${when}`,
        html: `<p>${body.replace(/\n/g, "<br/>")}</p>`,
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
