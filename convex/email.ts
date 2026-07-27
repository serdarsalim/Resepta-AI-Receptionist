import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/orgAuth";
import { sendEmail } from "./lib/email";
import {
  bareAddress,
  displayName,
  normalizeSubject,
  splitName,
} from "./lib/emailInbound";
import { recordCustomerCreated } from "./lib/newCustomer";

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

    // Same stamp the WhatsApp lane sets. It drives "awaiting reply" in the
    // inbox; it does NOT open Meta's session window, which only a WhatsApp
    // inbound can do.
    await ctx.db.patch(customerId, { lastInboundAt: Date.now() });
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
      emailFrom: v.optional(v.string()),
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
    return {
      orgId,
      orgName: org.name,
      emailFrom: org.emailFrom,
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
    if (!context.emailFrom) return { ok: false, reason: "no-from-address" };

    // Replies come back to US, not to whatever mailbox the From address
    // belongs to. Without this the customer's answer lands in the salon
    // owner's personal inbox and never reaches the timeline — which would
    // make the whole inbound lane decorative.
    const domain = process.env.RESEND_INBOUND_DOMAIN;
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
      emailFrom: context.emailFrom,
    });

    const result = await sendEmail({
      from: `${context.orgName} <${context.emailFrom}>`,
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

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
