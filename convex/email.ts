import { v } from "convex/values";
import { syncCustomerSearch } from "./lib/customerSearch";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOrg } from "./lib/orgAuth";
import { isDemo } from "./demo";
import { customerSender, productSender, sendEmail } from "./lib/email";
import { emailConfig } from "./lib/platformConfig";
import {
  bareAddress,
  displayName,
  htmlToText,
  normalizeSubject,
  splitName,
} from "./lib/emailInbound";
import { recordCustomerCreated } from "./lib/newCustomer";
import { noteMessageById, recomputeThread } from "./lib/thread";
import { isDeleting } from "./lib/customerDeletion";
import { hasBusinessHours, isWithinActiveWindow } from "./lib/businessHours";
import { outOfHoursMessage } from "./lib/awayReply";
import { resolvePublicPhone } from "./lib/publicPhone";
import { SESSION_WINDOW_MS } from "./webhook";
import { renderTokens } from "./lib/renderTokens";
import { formatAppointmentTime } from "./lib/format";
import { formatMoney } from "./lib/money";

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
    // Indexed. Stored addresses are already lower-cased by
    // resolveInboundAddress, which is what makes an equality lookup safe here —
    // the old scan lower-cased each candidate as it went and could afford to.
    const match = await ctx.db
      .query("orgs")
      .withIndex("by_inbound_address", (q) => q.eq("inboundAddress", wanted))
      .unique();
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
    // name.
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
      await syncCustomerSearch(ctx, customerId);
      await recordCustomerCreated(ctx, {
        orgId: args.orgId,
        customerId,
        source: "email",
      });
    }

    const inboundId = await ctx.db.insert("messages", {
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
    await noteMessageById(ctx, inboundId);

    // Reply attribution, latest-outbound-wins (Nudge's contract): credit this
    // reply to the newest tracked email the customer was sent in the past 30
    // days. Inbound mail carries no In-Reply-To we can trust through the
    // webhook, so newest-wins IS the attribution. A row already credited is
    // skipped — a chatty customer must not read as a 400% reply rate. Any
    // email of ours counts, not only a template's (P13b): a bulk mail carries
    // no templateId, and requiring one handed its reply to whichever older
    // template mail sat behind it. The template's counter moves only when the
    // credited mail had a template.
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
    // Closures are deliberately NOT consulted here (2026-08-29). The away-reply
    // means "nobody is here, do not wait up"; during a lunch break somebody IS
    // here and will answer in forty minutes, so "we're closed" is a worse
    // answer than the silence it replaces. It would also contradict itself:
    // the throttle is one reply per session window, so a customer who wrote at
    // 12:55 and got nothing would get "we're closed" at 13:15.
    //
    // Opening hours keep driving this. Closures drive what may be BOOKED.
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
    if (!customer || isDeleting(customer)) return null;
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
      // publicPhone resolved here, where there is a db: the action that reads
      // this context renders [phone] but cannot query the agent table.
      org: { ...org, publicPhone: await resolvePublicPhone(ctx, org) },
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
// the salon was closed. A reply to someone who just wrote to us, so not
// marketing and never stopped by Unsubscribe (wa.sendAwayReply's reasoning).
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
    // The demo workspace answers nobody for real (convex/demo.ts).
    if (isDemo(org)) return null;
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
      // Suspension rides the context read so the action can refuse without a
      // second query (docs/chat-agent.md §8). demoMode rides it for the same
      // reason, and had to be added: this was the ONLY send path in the product
      // that never checked it, so an anonymous walk-in with a staff membership
      // in the demo org could point a demo customer at any real address and
      // send whatever they liked from the platform's verified domain.
      suspended: v.boolean(),
      demo: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
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
      suspended: (org.status ?? "active") === "suspended",
      demo: isDemo(org),
    };
  },
});

// One [token] for one customer, rendered as a send would render it (P26,
// Nudge 4a232eae). The composer is a one-off email to ONE customer and
// nothing renders its body on the way out, so a variable picked there goes in
// as this customer's VALUE ("Ayşe"), never as a chip that would reach them as
// "[firstname]". Appointment facts come from their next open appointment,
// which is the one a reply to them is about. Null when the token renders to
// nothing for them; the composer then inserts nothing and says so.
export const renderTokenForCustomer = query({
  args: { customerId: v.id("customers"), token: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    if (!/^\[[A-Za-z0-9_]{1,32}\]$/.test(args.token)) return null;
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.orgId !== orgId || isDeleting(customer)) return null;
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    const language = customer.language ?? org.language ?? "tr";

    const contactFields = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const custom: Record<string, string> = {};
    for (const field of contactFields) custom[field.key] = customer.custom?.[field.key] ?? "";

    const now = Date.now();
    const next = (
      await ctx.db
        .query("appointments")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
        .take(500)
    )
      .filter(
        (a) =>
          a.orgId === orgId &&
          a.startAt >= now &&
          (a.status === "scheduled" || a.status === "confirmed"),
      )
      .sort((a, b) => a.startAt - b.startAt)[0];
    const staff = next?.staffId ? await ctx.db.get(next.staffId) : null;
    const money = (minor: number) =>
      formatMoney(minor, org.currency ?? "TRY", language, org.priceDecimals);
    const items = next?.items ?? [];
    const totalMinor = items.reduce(
      (sum, item) => sum + (item.price ?? 0) * (item.quantity ?? 1),
      0,
    );

    const out = renderTokens(args.token, {
      firstName: customer.firstName,
      lastName: customer.lastName,
      businessName: org.name,
      phone: await resolvePublicPhone(ctx, org),
      email: customer.email,
      bookingLink: org.bookingUrl,
      address: org.address,
      appointmentAt: next
        ? formatAppointmentTime(next.startAt, org.timezone, language)
        : undefined,
      staffName: staff && staff.orgId === orgId ? staff.name : undefined,
      manageLink:
        next?.manageToken && process.env.SITE_URL
          ? `${process.env.SITE_URL}/appt/${next.manageToken}`
          : undefined,
      serviceName: items.length
        ? items
            .map((item) =>
              (item.quantity ?? 1) > 1 ? `• ${item.quantity}× ${item.name}` : `• ${item.name}`,
            )
            .join("\n")
        : undefined,
      servicePriceList: items.length
        ? items
            .map((item) => {
              const quantity = item.quantity ?? 1;
              const label = quantity > 1 ? `${quantity}× ${item.name}` : item.name;
              return `• ${label}${item.price !== undefined ? ` — ${money(item.price * quantity)}` : ""}`;
            })
            .join("\n")
        : undefined,
      price: totalMinor > 0 ? money(totalMinor) : undefined,
      custom,
    }).trim();
    return out && out !== args.token ? out : null;
  },
});

// The address the compose window's From line shows (P28): the business's one
// sender, as sendToCustomer will send it. Null when the deployment has no
// verified domain, which the window says instead of offering Send.
export const composeSender = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    return customerSender(org, await emailConfig(ctx)) ?? null;
  },
});

// How long a composed email waits before it goes, so Undo can take it back
// (P28, Gmail's "Sending… Undo"). Nudge holds ten seconds; so does this.
const EMAIL_UNDO_HOLD_MS = 10_000;
// The furthest ahead a person may schedule one. A year is far past any real
// use, and a bound keeps a typo in the year from parking a row forever.
const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 3600_000;

export const sendToCustomer = action({
  args: {
    customerId: v.id("customers"),
    subject: v.string(),
    body: v.string(),
    // Markup from the composer's rich editor. `body` stays the plain lane —
    // the chat agent, the auto-reply and everything else that writes a
    // sentence still send only that — so this is additive and every existing
    // caller keeps working untouched.
    //
    // It is safe to send unescaped because of WHERE it comes from: tiptap
    // serialises its own document, which can only hold the nodes and marks the
    // editor registers (paragraphs, headings, lists, links, images, tables,
    // colour). Pasted markup is coerced into that schema on the way in, so
    // there is no path from a paste to a <script> here. Anything arriving from
    // OUTSIDE — an inbound mail — is a different question and is sanitised at
    // render (src/lib/sanitizeHtml.ts), which is where the untrusted markup
    // actually is.
    html: v.optional(v.string()),
    // The compose window's two ways of NOT sending this instant (P28). `hold`
    // parks the row for EMAIL_UNDO_HOLD_MS so the Sending… Undo note can
    // cancel it; `scheduledFor` parks it until that moment (Schedule send).
    // Either way the row sits queued with scheduledFor set, visible in the
    // thread with its time and a Cancel, and goes out through sendParked.
    // Neither = send now, the old behaviour every other caller keeps.
    hold: v.optional(v.boolean()),
    scheduledFor: v.optional(v.number()),
  },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
    // Set when the row was parked: the id Undo cancels and when it goes.
    messageId: v.optional(v.id("messages")),
    sendAt: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; reason?: string; messageId?: Id<"messages">; sendAt?: number }> => {
    const subject = args.subject.trim();
    const html = args.html?.trim() || undefined;
    // The flattening is what the feed index, the inbox preview and any future
    // search read. Derived rather than asked for, so the two can never
    // disagree about what this mail said.
    const body = html ? htmlToText(html) : args.body.trim();
    if (!body) return { ok: false, reason: "empty" };
    const now = Date.now();
    if (
      args.scheduledFor !== undefined &&
      (!Number.isFinite(args.scheduledFor) || args.scheduledFor > now + MAX_SCHEDULE_AHEAD_MS)
    ) {
      return { ok: false, reason: "bad-schedule" };
    }
    // A moment already passed (a slow click on "in a minute") is a send now,
    // still with the hold, rather than a refusal.
    const sendAt =
      args.scheduledFor !== undefined && args.scheduledFor > now + EMAIL_UNDO_HOLD_MS
        ? args.scheduledFor
        : args.hold || args.scheduledFor !== undefined
          ? now + EMAIL_UNDO_HOLD_MS
          : undefined;
    const context = await ctx.runQuery(internal.email.loadSendContext, {
      customerId: args.customerId,
    });
    if (!context) return { ok: false, reason: "not-found" };
    // Suspension (docs/chat-agent.md §8): outbound stops, visibly.
    if (context.suspended) {
      return { ok: false, reason: "org-suspended" };
    }
    // The demo workspace never reaches a provider (convex/demo.ts). Same
    // refusal wa.ts and chatAgent.ts have carried all along.
    if (context.demo) return { ok: false, reason: "demo-org" };
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
      emailHtml: html,
      scheduledFor: sendAt,
    });

    // Parked: sendParked takes it at its moment, and the every-minute sweep
    // (sendDueParked) is the backstop if that scheduled run is lost. Both
    // claim through claimParked, so only one of them sends.
    if (sendAt !== undefined) {
      await ctx.scheduler.runAt(sendAt, internal.email.sendParked, { messageId });
      return { ok: true, messageId, sendAt };
    }

    const result = await sendEmail({
      apiKey: context.apiKey,
      from: context.sender,
      to: context.customerEmail,
      subject: subject || context.orgName,
      // Composed markup goes out as it was written. Typed plain text is
      // escaped first — so a customer name with an ampersand in it can't
      // become markup — and then newlines become breaks, so the mail reads
      // the way it was typed.
      html: html ?? `<p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p>`,
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

// ── A parked email reaching its moment (P28) ─────────────────────────────────
//
// The claim and everything the send needs in ONE transaction, the same shape
// as delivery.claimForRetry and wa.claimScheduled: the scheduled run and the
// sweep may both reach a row, and only the one whose claim clears
// scheduledFor sends it. Everything a send must refuse is re-checked here,
// because the world moves while a row waits: the customer may be being
// deleted (the row goes with them, wa.claimScheduled's rule), the org may be
// suspended, the address may be gone. demoMode is checked before any
// credential, the rule every send path keeps, though sendToCustomer already
// refuses the demo org before it parks anything.
export const claimParked = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.union(
    v.null(),
    v.object({ refused: v.string() }),
    v.object({
      apiKey: v.union(v.string(), v.null()),
      from: v.string(),
      to: v.string(),
      subject: v.string(),
      html: v.string(),
      replyTo: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.messageId);
    if (
      !row ||
      row.kind !== "email_reply" ||
      row.status !== "queued" ||
      row.scheduledFor === undefined ||
      row.scheduledFor > Date.now() + 1000 ||
      !row.customerId
    ) {
      return null;
    }
    const customer = await ctx.db.get(row.customerId);
    if (!customer || customer.orgId !== row.orgId || isDeleting(customer)) {
      await ctx.db.delete(row._id);
      if (customer) await recomputeThread(ctx, customer._id);
      return null;
    }
    await ctx.db.patch(row._id, { scheduledFor: undefined, sendingAt: Date.now() });
    const org = await ctx.db.get(row.orgId);
    if (!org) return { refused: "not-found" };
    if ((org.status ?? "active") === "suspended") return { refused: "org-suspended" };
    if (isDemo(org)) return { refused: "demo-org" };
    if (!customer.email) return { refused: "missing-email" };
    const mailConfig = await emailConfig(ctx);
    const from = row.emailFrom ?? customerSender(org, mailConfig);
    if (!from) return { refused: "email-not-configured" };
    return {
      apiKey: mailConfig.apiKey,
      from,
      to: customer.email,
      subject: row.emailSubject || org.name,
      html: row.emailHtml ?? `<p>${escapeHtml(row.body ?? "").replace(/\n/g, "<br/>")}</p>`,
      replyTo:
        org.inboundAddress && mailConfig.domain
          ? `${org.inboundAddress}@${mailConfig.domain}`
          : undefined,
    };
  },
});

// One parked row: claim, then send or report the refusal. Shared by the
// scheduled run and the sweep, so the two cannot drift.
async function dispatchParked(ctx: ActionCtx, messageId: Id<"messages">): Promise<void> {
  const job = await ctx.runMutation(internal.email.claimParked, { messageId });
  if (!job) return;
  if ("refused" in job) {
    await ctx.runMutation(internal.messages.applySendResult, {
      messageId,
      ok: false,
      error: job.refused,
    });
    return;
  }
  const result = await sendEmail(job);
  await ctx.runMutation(internal.messages.applySendResult, {
    messageId,
    ok: result.ok,
    error: result.ok ? undefined : result.reason,
  });
}

export const sendParked = internalAction({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await dispatchParked(ctx, args.messageId);
    return null;
  },
});

// The parked emails whose moment has passed. Only email rows: WhatsApp's own
// sweep (wa.dueScheduled) takes the rest and leaves these alone.
export const dueParked = internalQuery({
  args: {},
  returns: v.array(v.id("messages")),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_status_scheduled", (q) =>
        q.eq("status", "queued").gt("scheduledFor", 0).lte("scheduledFor", Date.now()),
      )
      .filter((q) => q.eq(q.field("kind"), "email_reply"))
      .take(50);
    return rows.map((row) => row._id);
  },
});

// The backstop sweep, every minute (crons.ts). A parked row normally goes by
// the run sendToCustomer scheduled for it; this catches one whose run was
// lost, a minute late rather than never.
export const sendDueParked = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const ids = await ctx.runQuery(internal.email.dueParked, {});
    for (const messageId of ids) await dispatchParked(ctx, messageId);
    return null;
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
// Sent from the product, not from the salon. An invite is Resepta writing to
// you about your account; it is not the salon mailing its customer.
const INVITE_COPY = {
  tr: {
    subject: (org: string) => `${org} sizi Resepta'ya ekledi`,
    line: (org: string, by: string) =>
      `${by}, sizi <strong>${org}</strong> işletmesine ekledi.`,
    action: "Google hesabınızla giriş yapın:",
  },
  en: {
    subject: (org: string) => `${org} added you on Resepta`,
    line: (org: string, by: string) =>
      `${by} added you to <strong>${org}</strong>.`,
    action: "Sign in with your Google account:",
  },
  de: {
    subject: (org: string) => `${org} hat Sie bei Resepta hinzugefügt`,
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
    // Present when the invited address has no account yet, in which case this
    // mail carries the only thing that can admit them to the workspace. Absent
    // when the account already existed and was joined outright, so the mail is
    // a notification and the plain site URL is the right destination.
    token: v.optional(v.string()),
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
      // The join link carries the token as a query param, which is where an
      // invite secret belongs: it is the credential the recipient is meant to
      // present, and it grants one membership to one named address.
      html: (() => {
        const link = args.token
          ? `${siteUrl}/join?t=${encodeURIComponent(args.token)}`
          : siteUrl;
        return `<p>${copy.line(org, by)}</p><p>${copy.action}<br/><a href="${link}">${link}</a></p>`;
      })(),
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
