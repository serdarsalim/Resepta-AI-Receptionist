// Retrying sends the provider didn't take, and reaping the ones that vanished.
//
// ── WHY ─────────────────────────────────────────────────────────────────────
//
// A reminder that failed once used to stay failed forever. The send path wrote
// a row with an error on it and stopped, so a Meta 500, a rate limit, or a
// dropped connection meant that customer never heard from the salon — and the
// only trace was a red line in a tab nobody had open. For a product whose
// entire promise is "the reminder goes out", that is the failure that matters
// most, and it was the one thing nothing recovered from.
//
// messages.applySendResult decides WHETHER a failure is worth retrying and
// when (see lib/sendFailure.ts). This file is the other half: the cron that
// picks up rows whose moment has come and actually re-sends them.
//
// ── RE-SENDING THE SAME ROW ─────────────────────────────────────────────────
//
// The retry re-POSTs the message that already exists rather than re-running
// the action that created it. Re-running sendAppointmentMessage would call
// logOutQueued again and leave a SECOND row in the customer's thread for one
// message the customer receives once — a conversation that shows two reminders
// where one was sent is worse than the failure being retried.
//
// So everything a re-send needs is derived from the stored row: the phone from
// the customer, the credentials and business name from the org, the body
// params from the appointment. What cannot be derived — which template, what
// text — is already on the row, because the first attempt put it there.
//
// ── AT-LEAST-ONCE, AND WHY THAT IS THE RIGHT CHOICE HERE ────────────────────
//
// There is no idempotency key on Meta's send endpoint. If a POST succeeds but
// the response is lost, the retry delivers a second copy. The alternative —
// never retrying an ambiguous outcome — loses the message entirely, and a
// customer receiving one reminder twice is a smaller harm than a customer
// receiving none. The reaper below takes the opposite view for a DIFFERENT
// case, and the difference is worth understanding: a claimed row that never
// reported back may have been delivered, so it is failed rather than retried.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { formatAppointmentTime } from "./lib/format";
import { sendEmail, emailLaneConfigured } from "./lib/email";
import { sendWaCloudTemplate, sendWaCloudText } from "./lib/waCloud";

// Rows per tick. Each is a claim mutation plus a POST plus a result mutation,
// and the cron runs every minute — 50 is far more than a healthy deployment
// ever has waiting, and a genuine backlog drains over a few ticks rather than
// stampeding a provider that is already struggling.
const BATCH = 50;

// How long an in-flight row may sit before the reaper calls it dead. Generous
// on purpose: a Convex action gets nowhere near this, so anything still
// claimed after two hours had its execution killed, not delayed.
const STUCK_AFTER_MS = 2 * 3600_000;

// ── The retry sweep ─────────────────────────────────────────────────────────

export const dueRetries = internalQuery({
  args: {},
  returns: v.array(v.id("messages")),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_next_attempt", (q) =>
        // Above zero excludes the unset rows, which is nearly the whole table.
        q.gt("nextAttemptAt", 0).lte("nextAttemptAt", Date.now()),
      )
      .take(BATCH);
    return rows.map((row) => row._id);
  },
});

// Everything one re-send needs, resolved in a single read, plus the claim.
//
// Claiming and loading are ONE mutation deliberately: two overlapping ticks
// must not both decide the same row is theirs, and the only way to guarantee
// that is for the read that decides and the write that claims to be in the
// same transaction. Returns null when another tick got there first.
export const claimForRetry = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) return null;
    // Someone else claimed it, or it landed, or it was cancelled.
    if (message.status !== "queued") return null;
    if (message.nextAttemptAt === undefined || message.nextAttemptAt > Date.now()) {
      return null;
    }

    const [org, customer, appointment] = await Promise.all([
      ctx.db.get(message.orgId),
      message.customerId ? ctx.db.get(message.customerId) : Promise.resolve(null),
      message.appointmentId
        ? ctx.db.get(message.appointmentId)
        : Promise.resolve(null),
    ]);
    if (!org || !customer) return null;

    const waAccount = await ctx.db
      .query("waAccounts")
      .withIndex("by_org", (q) => q.eq("orgId", message.orgId))
      .unique();

    // The template row is looked up by the name the FIRST attempt recorded, so
    // a retry sends the same template even if the org has since registered
    // another one for that kind.
    const templates = message.templateName
      ? await ctx.db
          .query("waTemplates")
          .withIndex("by_org", (q) => q.eq("orgId", message.orgId))
          .collect()
      : [];
    const template = templates.find((t) => t.metaName === message.templateName);

    // Claim: in flight, and no longer due. If this action dies before
    // reporting back, the reaper finds the row by sendingAt.
    await ctx.db.patch(args.messageId, {
      sendingAt: Date.now(),
      nextAttemptAt: undefined,
    });

    const language = customer.language ?? org.language;
    return {
      messageId: args.messageId,
      isEmail: message.kind.startsWith("email_"),
      body: message.body,
      to: customer.phone,
      email: customer.email,
      emailFrom: org.emailFrom,
      orgName: org.name,
      firstName: customer.firstName,
      accessToken: waAccount?.accessToken,
      phoneNumberId: waAccount?.phoneNumberId,
      templateName: message.templateName,
      templateLanguage: template?.language ?? language,
      // Only appointment-bound sends carry the date parameter and the
      // confirm/cancel buttons; a bulk or session message has neither.
      when: appointment
        ? formatAppointmentTime(appointment.startAt, org.timezone, language)
        : undefined,
      appointmentId: message.appointmentId,
    };
  },
});

export const retryDue = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const ids = await ctx.runQuery(internal.delivery.dueRetries, {});
    for (const messageId of ids) {
      const job = await ctx.runMutation(internal.delivery.claimForRetry, { messageId });
      if (!job) continue;

      const result = await attempt(job);
      await ctx.runMutation(internal.messages.applySendResult, {
        messageId,
        ok: result.ok,
        wamid: result.ok ? result.wamid : undefined,
        error: result.ok ? undefined : result.reason,
      });
    }
    // A full batch means more is waiting. Come back now rather than in a
    // minute — a backlog is exactly when latency matters.
    if (ids.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.delivery.retryDue, {});
    }
    return null;
  },
});

type RetryJob = {
  isEmail: boolean;
  body?: string;
  to: string;
  email?: string;
  emailFrom?: string;
  orgName: string;
  firstName: string;
  accessToken?: string;
  phoneNumberId?: string;
  templateName?: string;
  templateLanguage: string;
  when?: string;
  appointmentId?: string;
};

// One re-send, routed by what the row is. Mirrors the three shapes the send
// paths produce: a template message, a session text, an email.
async function attempt(
  job: RetryJob,
): Promise<{ ok: true; wamid?: string } | { ok: false; reason: string }> {
  if (job.isEmail) {
    if (!emailLaneConfigured()) return { ok: false, reason: "email-not-configured" };
    if (!job.email || !job.emailFrom) return { ok: false, reason: "email-not-configured" };
    if (!job.body) return { ok: false, reason: "no-body" };
    const sent = await sendEmail({
      from: job.emailFrom,
      to: job.email,
      // Rebuilt the same way the first attempt built it, so a retry does not
      // arrive under a different subject and start a second thread.
      subject: job.when ? `${job.orgName}, ${job.when}` : job.orgName,
      html: `<p>${job.body.replace(/\n/g, "<br/>")}</p>`,
    });
    return sent.ok ? { ok: true } : { ok: false, reason: sent.reason };
  }

  if (!job.accessToken || !job.phoneNumberId) {
    return { ok: false, reason: "wa-not-configured" };
  }

  if (job.templateName) {
    return await sendWaCloudTemplate({
      accessToken: job.accessToken,
      phoneNumberId: job.phoneNumberId,
      to: job.to,
      templateName: job.templateName,
      languageCode: job.templateLanguage,
      bodyParams: [job.firstName, job.orgName, job.when ?? ""],
      buttons: job.appointmentId
        ? [
            { index: 0, payload: `confirm:${job.appointmentId}` },
            { index: 1, payload: `cancel:${job.appointmentId}` },
          ]
        : undefined,
    });
  }

  if (!job.body) return { ok: false, reason: "no-body" };
  return await sendWaCloudText({
    accessToken: job.accessToken,
    phoneNumberId: job.phoneNumberId,
    to: job.to,
    body: job.body,
  });
}

// ── The reaper ──────────────────────────────────────────────────────────────
//
// A row is claimed by stamping sendingAt and released by applySendResult. If
// the action between those two points dies — deploy mid-flight, execution
// killed, an unhandled throw — nothing ever comes back and the row sits in
// flight forever: never retried, never failed, never visible as either.
//
// This fails those rows rather than retrying them, which is the opposite call
// to the one the retry queue makes, and deliberately so. A claimed row may
// have reached Meta before its action died; re-sending would deliver a second
// copy of a message that already arrived. An unretried failure is one visible
// row somebody can act on. A duplicate is in the customer's hand and cannot be
// taken back.
export const reapStuck = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - STUCK_AFTER_MS;
    const stuck = await ctx.db
      .query("messages")
      .withIndex("by_sending", (q) => q.gt("sendingAt", 0).lte("sendingAt", cutoff))
      .take(200);
    for (const message of stuck) {
      // Landed between the read and here — leave it alone.
      if (message.status !== "queued") {
        await ctx.db.patch(message._id, { sendingAt: undefined });
        continue;
      }
      await ctx.db.patch(message._id, {
        status: "failed",
        error: "dispatch-timeout",
        sendingAt: undefined,
        nextAttemptAt: undefined,
        deadLetteredAt: Date.now(),
      });
    }
    return null;
  },
});
