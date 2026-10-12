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

import { recomputeThread } from "./lib/thread";
import { isDeleting } from "./lib/customerDeletion";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { formatAppointmentTime } from "./lib/format";
import {
  customerSender,
  emailBodyHtml,
  emailLaneConfigured,
  isMarketingEmailKind,
  sendEmail,
  unsubscribeUrl,
  withOpenPixel,
  withUnsubscribeFooter,
} from "./lib/email";
import { emailConfig, resolveWaAccount, type EmailConfig } from "./lib/platformConfig";
import { sendWaCloudImage, sendWaCloudTemplate, sendWaCloudText } from "./lib/waCloud";
import { sendEvolutionText } from "./lib/evolution";
import { loadEvolutionCreds } from "./lib/waLane";
import { isDemo } from "./demo";
import { bulkRunGate, noteBulkItemResult } from "./bulkRuns";
import { EVOLUTION_NO_MEDIA } from "./lib/sendFailure";

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
    // A retry owed to a customer who is being deleted is cancelled, not sent:
    // deleting the queued row is the cancellation (wa.cancelScheduled's rule),
    // and the row was going with the customer anyway.
    if (isDeleting(customer)) {
      await ctx.db.delete(message._id);
      return null;
    }
    // Two reasons a queued row must not reach a provider, both refused here at
    // claim time and reported through applySendResult like any other outcome:
    // the operator suspended the org (docs/chat-agent.md §8), or this is the
    // demo workspace (convex/demo.ts: "Every send path checks demoMode BEFORE
    // it reaches a provider").
    //
    // demoMode was missing, and this is the chokepoint every queued send
    // crosses on BOTH lanes — so a demo campaign's email rows were reaching
    // Resend for real, from the platform's own verified domain.
    if ((org.status ?? "active") === "suspended") {
      return { refused: "org-suspended" as const };
    }
    if (isDemo(org)) return { refused: "demo-org" as const };
    // A bulk run that was paused or stopped after its rows were already
    // queued. The check has to be HERE, at claim time, and not where the rows
    // were written: by the time anybody reaches for the stop button the whole
    // run is sitting in this queue, so a flag read only on the way in would be
    // decorative.
    //
    // Paused deliberately returns null rather than a refusal. null means "not
    // this tick" and leaves the row queued and due, so the run picks up where
    // it left off when it resumes; reporting a refusal would fail the row and
    // turn every pause into a cancel.
    const bulk = await bulkRunGate(ctx, message);
    if (bulk === "paused") return null;
    if (bulk === "cancelled") return { refused: "bulk-cancelled" as const };
    // Marketing mail to a customer who unsubscribed after it was queued: a
    // campaign or bulk row written before they clicked, or a win-back's
    // retry. Every queued marketing mail crosses this claim, so this is the
    // check that cannot be skipped (customers.marketingEmailOptOutAt).
    if (isMarketingEmailKind(message.kind) && customer.marketingEmailOptOutAt !== undefined) {
      return { refused: "unsubscribed" as const };
    }

    const waAccount = await resolveWaAccount(
      ctx,
      await ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", message.orgId))
        .unique(),
    );

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

    const mailConfig = await emailConfig(ctx);
    const language = customer.language ?? org.language;
    // A retry has to go back out the SAME number the first attempt used. The
    // lane is read off the row rather than re-derived: an org that added a
    // Cloud number between the two attempts would otherwise have its queued
    // Evolution messages surface from a number the customer has never seen,
    // mid-conversation.
    const evolution =
      message.lane === "evolution"
        ? await loadEvolutionCreds(ctx, message.orgId, org.evolutionInstance)
        : null;
    return {
      messageId: args.messageId,
      lane: message.lane ?? "cloud",
      evolution,
      isEmail: message.kind.startsWith("email_"),
      // Campaign, bulk and win-back mail carry the unsubscribe link and
      // headers (lib/email), in the customer's language.
      marketing: isMarketingEmailKind(message.kind),
      language,
      body: message.body,
      to: customer.phone,
      email: customer.email,
      // What the first attempt sent as, falling back to resolving it now for
      // rows written before the row carried a full sender.
      emailFrom: message.emailFrom ?? customerSender(org, mailConfig),
      // Carried on the job so `attempt` — which runs in an action — has the
      // key and domain without a second round trip.
      mailConfig,
      // For the reply-to on a retried email — same wiring as the first
      // attempt, so the customer's answer still lands in the timeline.
      inboundAddress: org.inboundAddress,
      orgName: org.name,
      firstName: customer.firstName,
      accessToken: waAccount?.accessToken,
      phoneNumberId: waAccount?.phoneNumberId,
      templateName: message.templateName,
      templateLanguage: template?.language ?? language,
      // What the first attempt actually put in front of the customer. Used in
      // preference to rebuilding: a reschedule or a rename between attempts
      // would otherwise make the retry say something different from the send
      // it is retrying.
      templateParams: message.templateParams,
      emailSubject: message.emailSubject,
      // The token the first attempt minted (or the fan-out stamped), so a
      // retried mail carries the same pixel and its open resolves to this row.
      trackingToken: message.trackingToken,
      // Resolved here rather than in the action: a retry of an image send has
      // to go back out as an image, and getUrl needs the storage id from the
      // row we just read.
      mediaLink: message.mediaStorageId
        ? await ctx.storage.getUrl(message.mediaStorageId)
        : null,
      // Only appointment-bound sends carry the date parameter and the
      // confirm/cancel buttons; a bulk or session message has neither.
      when: appointment
        ? formatAppointmentTime(appointment.startAt, org.timezone, language)
        : undefined,
      appointmentId: message.appointmentId,
      // A scheduled quote-reply keeps its quote at dispatch time — the row
      // stored the wamid when the send was queued (wa.sendSession).
      replyToWamid: message.replyToWamid,
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

      if ("refused" in job && job.refused) {
        await ctx.runMutation(internal.messages.applySendResult, {
          messageId,
          ok: false,
          error: job.refused,
        });
        continue;
      }
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
  marketing: boolean;
  language: string;
  // Which number the FIRST attempt went out on, read off the row rather than
  // re-derived. See claimForRetry.
  lane: "cloud" | "evolution";
  evolution: { baseUrl: string; apiKey: string; instance: string } | null;
  body?: string;
  to: string;
  email?: string;
  emailFrom?: string;
  mailConfig: EmailConfig;
  inboundAddress?: string;
  orgName: string;
  firstName: string;
  accessToken?: string;
  phoneNumberId?: string;
  templateName?: string;
  templateLanguage: string;
  templateParams?: string[];
  emailSubject?: string;
  trackingToken?: string;
  when?: string;
  appointmentId?: string;
  mediaLink?: string | null;
  replyToWamid?: string;
};

// One re-send, routed by what the row is. Mirrors the three shapes the send
// paths produce: a template message, a session text, an email.
async function attempt(
  job: RetryJob,
): Promise<{ ok: true; wamid?: string } | { ok: false; reason: string }> {
  if (job.isEmail) {
    if (!emailLaneConfigured(job.mailConfig)) {
      return { ok: false, reason: "email-not-configured" };
    }
    if (!job.email || !job.emailFrom) return { ok: false, reason: "email-not-configured" };
    if (!job.body) return { ok: false, reason: "no-body" };
    // Mirrors the first attempt exactly — display From, escaped body,
    // reply-to into the app — so a retry is the same mail, later, not a
    // slightly different one. A marketing mail's unsubscribe link resolves
    // through the same token as its pixel.
    const domain = job.mailConfig.domain;
    const unsubscribe = job.marketing ? unsubscribeUrl(job.trackingToken) : undefined;
    const sent = await sendEmail({
      apiKey: job.mailConfig.apiKey,
      from: job.emailFrom,
      to: job.email,
      // The stored subject when there is one, so a retry lands in the same
      // thread rather than starting a second one. Older rows predate the
      // field and are rebuilt the way the first attempt built them.
      subject:
        job.emailSubject ?? (job.when ? `${job.orgName}, ${job.when}` : job.orgName),
      html: withOpenPixel(
        withUnsubscribeFooter(emailBodyHtml(job.body), unsubscribe, job.language),
        job.trackingToken,
      ),
      replyTo:
        job.inboundAddress && domain ? `${job.inboundAddress}@${domain}` : undefined,
      unsubscribeUrl: unsubscribe,
    });
    return sent.ok ? { ok: true } : { ok: false, reason: sent.reason };
  }

  if (job.lane === "evolution") {
    // The lane the row was sent on is gone — the instance was cleared or its
    // credentials removed between attempts. Failing is right: silently
    // re-routing to Cloud would put this in front of the customer from a
    // different number, which is the one thing lib/waLane exists to prevent.
    if (!job.evolution) return { ok: false, reason: "evolution-not-configured" };
    if (!job.body) return { ok: false, reason: "no-body" };
    // Text only. Templates are a Meta concept and a stored mediaLink is a
    // short-lived signed URL that Evolution fetches server-side, so a retried
    // image would arrive as a failed fetch rather than a photo.
    //
    // Which is why a row carrying one is refused instead of sent without it.
    // Sending the caption alone reported success, so the row reached "sent"
    // and the staff thread rendered a photo the customer never received.
    if (job.mediaLink) return { ok: false, reason: EVOLUTION_NO_MEDIA };
    const sent = await sendEvolutionText({
      baseUrl: job.evolution.baseUrl,
      apiKey: job.evolution.apiKey,
      instance: job.evolution.instance,
      to: job.to,
      body: job.body,
      quotedId: job.replyToWamid,
    });
    return sent.ok
      ? { ok: true, wamid: sent.messageId }
      : { ok: false, reason: sent.reason };
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
      bodyParams: job.templateParams ?? [job.firstName, job.orgName, job.when ?? ""],
      // Only appointment sends carry the confirm/cancel buttons. A campaign
      // template has none, and attaching payloads to buttons that were never
      // registered is a 400 from Meta rather than a harmless extra.
      buttons: job.appointmentId
        ? [
            { index: 0, payload: `confirm:${job.appointmentId}` },
            { index: 1, payload: `cancel:${job.appointmentId}` },
          ]
        : undefined,
    });
  }

  if (job.mediaLink) {
    return await sendWaCloudImage({
      accessToken: job.accessToken,
      phoneNumberId: job.phoneNumberId,
      to: job.to,
      link: job.mediaLink,
      caption: job.body || undefined,
    });
  }

  if (!job.body) return { ok: false, reason: "no-body" };
  return await sendWaCloudText({
    accessToken: job.accessToken,
    phoneNumberId: job.phoneNumberId,
    to: job.to,
    body: job.body,
    contextMessageId: job.replyToWamid,
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
      if (message.customerId) await recomputeThread(ctx, message.customerId);
      // This reaper is the ONE terminal outcome that does not go through
      // applySendResult — it patches the row itself — so a bulk run's item
      // would never learn its message died here. Without this line a single
      // dispatch action that never came back leaves its item "queued"
      // forever, and the run it belongs to stays "running" for good: the
      // progress bar stops, pause and stop stay lit, and nothing ever
      // finishes it. Every other terminal path reports through
      // applySendResult, which is why this was the easy one to miss.
      await noteBulkItemResult(ctx, { ...message, error: "dispatch-timeout" }, false);
    }
    return null;
  },
});
