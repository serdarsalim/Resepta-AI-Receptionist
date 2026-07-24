import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { formatAppointmentTime } from "./lib/format";
import { sendWaCloudTemplate } from "./lib/waCloud";

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
    kind: v.union(v.literal("confirmation"), v.literal("reminder")),
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

    // A cancelled/completed appointment gets no message; a reminder for a
    // start time already in the past is stale queue noise, drop it.
    if (appointment.status !== "scheduled" && appointment.status !== "confirmed") {
      return null;
    }
    if (args.kind === "reminder" && appointment.startAt <= Date.now()) return null;

    const messageKind =
      args.kind === "reminder" && args.offsetHours !== undefined
        ? `reminder_${args.offsetHours}h`
        : args.kind;

    // Exact language match, no cross-language fallback (Nudge lesson: the
    // wrong-language message is worse than no message).
    const language = customer.language ?? org.language;
    const template = templates.find(
      (t: { kind: string; language: string; status: string }) =>
        t.kind === args.kind && t.language === language && t.status === "approved",
    );

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

    // Each of these logs a failed row rather than throwing silently — an
    // unconfigured number or an unapproved template is exactly what the
    // Messages tab needs to show the owner.
    if (!waAccount) {
      await fail("wa-not-configured");
      return null;
    }
    if (!template) {
      await fail(`no-approved-template-${language}`);
      return null;
    }
    if (customer.consentAt === undefined) {
      await fail("no-consent");
      return null;
    }

    const when = formatAppointmentTime(appointment.startAt, org.timezone, language);
    const bodyParams = [customer.firstName, org.name, when];
    const body = template.bodyPreview
      ? template.bodyPreview
          .replace(/\{\{1\}\}/g, customer.firstName)
          .replace(/\{\{2\}\}/g, org.name)
          .replace(/\{\{3\}\}/g, when)
      : undefined;

    const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
      orgId: appointment.orgId,
      customerId: customer._id,
      appointmentId: appointment._id,
      kind: messageKind,
      templateName: template.metaName,
      body,
    });

    const result = await sendWaCloudTemplate({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: customer.phone,
      templateName: template.metaName,
      languageCode: template.language,
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
    return null;
  },
});
