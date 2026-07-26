import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { bareAddress, normalizeSubject } from "./lib/emailInbound";

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
      customerId = await ctx.db.insert("customers", {
        orgId: args.orgId,
        firstName: "",
        phone: "",
        email: from,
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
