import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/orgAuth";
import { customerSender, productSender, sendEmail } from "./lib/email";
import { emailConfig } from "./lib/platformConfig";
import {
  bareAddress,
  displayName,
  normalizeSubject,
  splitName,
} from "./lib/emailInbound";
import { recordCustomerCreated } from "./lib/newCustomer";
import { hasBusinessHours, isWithinActiveWindow } from "./lib/businessHours";
import { outOfHoursMessage } from "./lib/awayReply";
import { SESSION_WINDOW_MS } from "./webhook";

// The email lane's own writes. Sending lives in lib/email.ts (transport) and
// wa.ts (the template lane that rides alongside WhatsApp); this file is what
// happens when mail comes BACK.

// Which org owns an inbound address. Routing is on the local part — one
// verified domain serves every org, and `guzellik@…` is org "guzellik".
export const orgByInboundAddress = internalQuery({
  args: { localPart: v.string() },
  returns: v.union(v.id("orgs"), v.null()),
  handler: async (ctx, args) => {
    const wanted = args.localPart.trim().toLowerCase();
    if (!wanted) return null;
    // Scanned rather than indexed on purpose: orgs is a small table (one row
    // per paying business) and an index here would be a second thing to keep
    // in sync for a lookup that runs once per inbound email.
    const orgs = await ctx.db.query("orgs").collect();
    const match = orgs.find((org) => org.inboundAddress?.toLowerCase() === wanted);
    return match?._id ?? null;
  },
});

// Already seen this one? Webhooks retry until they get a 2xx, so the same
// reply arrives more than once whenever we are slow or briefly down.
export const emailAlreadyLogged = internalQuery({
  args: { emailId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_email_id", (q) => q.eq("emailId", args.emailId))
      .first();
    return existing !== null;
  },
});

// Land an inbound email on the customer's timeline.
export const recordInbound = internalMutation({
  args: {
    orgId: v.id("orgs"),
    emailId: v.string(),
    from: v.string(),
    subject: v.optional(v.string()),
    body: v.optional(v.string()),
    html: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Re-checked inside the mutation, not just before it: two retries landing
    // together would both pass a check made outside the transaction.
    const seen = await ctx.db
      .query("messages")
      .withIndex("by_email_id", (q) => q.eq("emailId", args.emailId))
      .first();
    if (seen) return null;

    const from = bareAddress(args.from);
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    let customerId = customers.find(
      (customer) => customer.email?.toLowerCase() === from,
    )?._id;

    // A stranger gets a record rather than the void. Same rule the WhatsApp
    // webhook already follows for an unknown number: a message filed against
    // nobody is invisible in an inbox that groups by customer, so nobody ever
    // learns that someone wrote. The address stands in until a human types a
    // name, and consent stays unset — writing to us is not KVKK consent for
    // us to start messaging them.
    if (!customerId) {
      // The From header usually carries a display name; use it rather than
      // filing a nameless row the salon has to guess at. Blank when the
      // sender's client sent no name, which the record shows as an
      // unnamed-but-reachable customer.
      const named = splitName(displayName(args.from));
      customerId = await ctx.db.insert("customers", {
        orgId: args.orgId,
        firstName: named.firstName,
        ...(named.lastName ? { lastName: named.lastName } : {}),
        phone: "",
        email: from,
      });
      await recordCustomerCreated(ctx, {
        orgId: args.orgId,
        customerId,
        source: "email",
      });
    }

    await ctx.db.insert("messages", {
      orgId: args.orgId,
      customerId,
      direction: "in",
      // The `email_` prefix IS the channel marker the feed reads
      // (messages.channelOfMessage) — renaming it moves this row to WhatsApp.
      kind: "email_reply",
      body: args.body,
      status: "received",
      emailId: args.emailId,
      emailFrom: from,
      emailHtml: args.html,
      // Stored raw, normalized only when threading. The reader should see the
      // subject the customer actually sent, "Re:" and all.
      emailSubject: args.subject,
    });

    // Reply attribution, latest-outbound-wins (Nudge's contract): credit this
    // reply to the newest tracked email the customer was sent in the past 30
    // days. Inbound mail carries no In-Reply-To we can trust through the
    // webhook, so newest-wins IS the attribution. A row already credited is
    // skipped — a chatty customer must not read as a 400% reply rate.
    // Bounded scan: the customer's newest 100 rows.
    const now = Date.now();
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_customer", (q) => q.eq("customerId", customerId))
      .order("desc")
      .take(100);
    const repliedTo = recent.find(
      (m) =>
        m.direction === "out" &&
        m.kind.startsWith("email_") &&
        m.status === "sent" &&
        m.repliedAt === undefined &&
        m.templateId !== undefined &&
        (m.sentAt ?? 0) > now - 30 * 24 * 3600_000,
    );
    if (repliedTo) {
      await ctx.db.patch(repliedTo._id, { repliedAt: now });
      const template = repliedTo.templateId
        ? await ctx.db.get(repliedTo.templateId)
        : null;
      if (template) {
        await ctx.db.patch(template._id, {
          emailReplyCount: (template.emailReplyCount ?? 0) + 1,
        });
      }
    }

    // Same stamp the WhatsApp lane sets. It drives "awaiting reply" in the
    // inbox; it does NOT open Meta's session window, which only a WhatsApp
    // inbound can do.
    await ctx.db.patch(customerId, { lastInboundAt: now });

    // Out-of-hours auto-reply, the email half of the out_of_hours rule. Same
    // shape as the WhatsApp gate in webhook.ts: the rule decides whether, the
    // hours decide when, the throttle stamps BEFORE scheduling so two retries
    // landing together cannot both send.
    const org = await ctx.db.get(args.orgId);
    const hours = org?.businessHours ?? {};
    const customer = await ctx.db.get(customerId);
    const alreadyReplied =
      customer?.lastEmailAutoReplyAt !== undefined &&
      now - customer.lastEmailAutoReplyAt < SESSION_WINDOW_MS;
    const rule = org
      ? (
          await ctx.db
            .query("messageRules")
            .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
            .collect()
        ).find(
          (r) =>
            r.trigger === "out_of_hours" &&
            !r.paused &&
            (r.channel === "email" || r.channel === "both"),
        )
      : undefined;
    if (
      org &&
      rule &&
      hasBusinessHours(hours) &&
      !isWithinActiveWindow(now, org.timezone, hours) &&
      !alreadyReplied &&
      // Machines don't read replies. An auto-reply to a no-reply address is a
      // bounce at best and a mail loop at worst.
      !/no-?reply|mailer-daemon|postmaster|bounce/.test(from)
    ) {
      await ctx.db.patch(customerId, { lastEmailAutoReplyAt: now });
      await ctx.scheduler.runAfter(0, internal.email.sendOutOfHoursReply, {
        customerId,
        ruleId: rule._id,
        // The address they wrote FROM, which may differ from the record's —
        // the reply must go where the person actually is tonight.
        to: from,
      });
    }
    return null;
  },
});

// Everything the out-of-hours reply needs, in one read. Internal-only, no
// requireOrg: like wa.loadAwayReplyContext it is triggered by an inbound
// webhook, and the org comes from the customer row the webhook resolved.
export const loadOutOfHoursContext = internalQuery({
  args: { customerId: v.id("customers"), ruleId: v.id("messageRules") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    const org = await ctx.db.get(customer.orgId);
    if (!org) return null;
    const [rule, templates, contactFields, mailConfig] = await Promise.all([
      ctx.db.get(args.ruleId),
      ctx.db
        .query("waTemplates")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .collect(),
      ctx.db
        .query("contactFields")
        .withIndex("by_org", (q) => q.eq("orgId", customer.orgId))
        .collect(),
      emailConfig(ctx),
    ]);
    return {
      customer,
      org,
      rule,
      templates,
      contactFields,
      sender: customerSender(org, mailConfig),
      apiKey: mailConfig.apiKey,
      inboundDomain: mailConfig.domain,
    };
  },
});

// The email half of the out_of_hours rule: answer a mail that arrived while
// the salon was closed. Deliberately does NOT require consentAt, same
// reasoning as wa.sendAwayReply — consent governs messages WE start; this is a
// reply to someone who just wrote to us.
export const sendOutOfHoursReply = internalAction({
  args: {
    customerId: v.id("customers"),
    ruleId: v.id("messageRules"),
    to: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.email.loadOutOfHoursContext, {
      customerId: args.customerId,
      ruleId: args.ruleId,
    });
    if (!context) return null;
    const { customer, org, rule, templates, contactFields } = context;
    // Paused or deleted between the stamp and this action — err toward silence.
    if (!rule || rule.paused) return null;
    if (!context.sender) return null;

    const custom: Record<string, string> = {};
    for (const field of contactFields as { key: string }[]) {
      custom[field.key] = customer.custom?.[field.key] ?? "";
    }
    const message = outOfHoursMessage({
      templates,
      ruleId: args.ruleId,
      org,
      language: customer.language ?? org.language,
      firstName: customer.firstName,
      lastName: customer.lastName,
      custom,
    });
    // Nothing useful to say — no authored wording, no link, no phone. The
    // owner's notification beats a message that is only "we're closed".
    if (!message) return null;

    // Replies come back to US — same wiring as sendToCustomer above, and the
    // whole reason the customer can keep the conversation going at 23:00.
    const replyTo =
      org.inboundAddress && context.inboundDomain
        ? `${org.inboundAddress}@${context.inboundDomain}`
        : undefined;

    const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
      orgId: customer.orgId,
      customerId: customer._id,
      // The `email_` prefix is the channel marker the feed reads.
      kind: "email_autoreply",
      body: message.body,
      emailSubject: message.subject,
      emailFrom: context.sender,
    });
    const result = await sendEmail({
      apiKey: context.apiKey,
      from: context.sender,
      to: args.to,
      subject: message.subject,
      html: message.bodyHtml ?? `<p>${escapeHtml(message.body).replace(/\n/g, "<br/>")}</p>`,
      replyTo,
    });
    await ctx.runMutation(internal.messages.applySendResult, {
      messageId,
      ok: result.ok,
      error: result.ok ? undefined : result.reason,
    });
    return null;
  },
});

// Thread key for the email tab, exported so the client and the server agree on
// what counts as "the same conversation".
export { normalizeSubject };

// ---- Sending a free-form email to one customer ----
//
// Separate from the template lane in wa.ts, which fires alongside WhatsApp on
// a booking. This is a person typing to a person.

export const loadSendContext = internalQuery({
  args: { customerId: v.id("customers") },
  returns: v.union(
    v.object({
      orgId: v.id("orgs"),
      orgName: v.string(),
      sender: v.optional(v.string()),
      apiKey: v.union(v.string(), v.null()),
      inboundDomain: v.union(v.string(), v.null()),
      inboundAddress: v.optional(v.string()),
      customerEmail: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId) return null;
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    const mailConfig = await emailConfig(ctx);
    return {
      orgId,
      orgName: org.name,
      // Resolved here, where the org doc is in hand. Unset only when the
      // deployment has no verified domain at all.
      sender: customerSender(org, mailConfig),
      apiKey: mailConfig.apiKey,
      inboundDomain: mailConfig.domain,
      inboundAddress: org.inboundAddress,
      customerEmail: customer.email,
    };
  },
});

export const sendToCustomer = action({
  args: {
    customerId: v.id("customers"),
    subject: v.string(),
    body: v.string(),
  },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const subject = args.subject.trim();
    const body = args.body.trim();
    if (!body) return { ok: false, reason: "empty" };
    const context = await ctx.runQuery(internal.email.loadSendContext, {
      customerId: args.customerId,
    });
    if (!context) return { ok: false, reason: "not-found" };
    if (!context.customerEmail) return { ok: false, reason: "missing-email" };
    if (!context.sender) return { ok: false, reason: "email-not-configured" };

    // Replies come back to US, not to whatever mailbox the From address
    // belongs to. Without this the customer's answer lands in the salon
    // owner's personal inbox and never reaches the timeline — which would
    // make the whole inbound lane decorative.
    const domain = context.inboundDomain;
    const replyTo =
      context.inboundAddress && domain
        ? `${context.inboundAddress}@${domain}`
        : undefined;

    const messageId = await ctx.runMutation(internal.messages.logOutQueued, {
      orgId: context.orgId,
      customerId: args.customerId,
      kind: "email_reply",
      body,
      emailSubject: subject || undefined,
      emailFrom: context.sender,
    });

    const result = await sendEmail({
      apiKey: context.apiKey,
      from: context.sender,
      to: context.customerEmail,
      subject: subject || context.orgName,
      // Typed as plain text, sent as HTML: escaped first so a customer name
      // with an ampersand in it can't become markup, then newlines become
      // breaks so the mail reads the way it was written.
      html: `<p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p>`,
      replyTo,
    });
    await ctx.runMutation(internal.messages.applySendResult, {
      messageId,
      ok: result.ok,
      error: result.ok ? undefined : result.reason,
    });
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  },
});

// ── Team invite notice ──────────────────────────────────────────────────────
//
// Fire and forget, scheduled by team.invite. It is a courtesy, not the
// mechanism: the membership or invite row is already written by the time this
// runs, so the person is in the workspace whether or not the mail arrives.
// That is why nothing here throws and why a failure is logged rather than
// surfaced. An owner who added a colleague should not see a red error because
// a Resend domain is not verified yet.
//
// Sent from the product, not from the salon. An invite is Randevu writing to
// you about your account; it is not the salon mailing its customer.
const INVITE_COPY = {
  tr: {
    subject: (org: string) => `${org} sizi Randevu'ya ekledi`,
    line: (org: string, by: string) =>
      `${by}, sizi <strong>${org}</strong> işletmesine ekledi.`,
    action: "Google hesabınızla giriş yapın:",
  },
  en: {
    subject: (org: string) => `${org} added you on Randevu`,
    line: (org: string, by: string) =>
      `${by} added you to <strong>${org}</strong>.`,
    action: "Sign in with your Google account:",
  },
  de: {
    subject: (org: string) => `${org} hat Sie bei Randevu hinzugefügt`,
    line: (org: string, by: string) =>
      `${by} hat Sie zu <strong>${org}</strong> hinzugefügt.`,
    action: "Melden Sie sich mit Ihrem Google-Konto an:",
  },
} as const;

export const sendInvite = internalAction({
  args: {
    to: v.string(),
    orgName: v.string(),
    invitedByName: v.string(),
    language: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const mailConfig = await ctx.runQuery(internal.platformConfig.forSend, {});
    const from = productSender(mailConfig);
    const siteUrl = process.env.SITE_URL;
    // Both are deployment config the owner cannot fix from inside the app, so
    // the only sane response is to skip quietly. The invite still stands.
    if (!from || !siteUrl) return null;

    const copy =
      INVITE_COPY[args.language as keyof typeof INVITE_COPY] ?? INVITE_COPY.tr;
    const org = escapeHtml(args.orgName);
    const by = escapeHtml(args.invitedByName);

    const result = await sendEmail({
      apiKey: mailConfig.apiKey,
      from,
      to: args.to,
      subject: copy.subject(args.orgName),
      html: `<p>${copy.line(org, by)}</p><p>${copy.action}<br/><a href="${siteUrl}">${siteUrl}</a></p>`,
    });
    if (!result.ok) {
      console.warn(`invite email not sent to ${args.to}: ${result.reason}`);
    }
    return null;
  },
});

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
