// One message to a group of customers.
//
// ── THE RULE THAT SHAPES THIS WHOLE FILE ────────────────────────────────────
//
// A campaign is business-INITIATED. The customer has not just written to us,
// so Meta's 24h session window is shut and free-form WhatsApp is refused with
// 131047. Cold WhatsApp must be a pre-approved template message. That is not
// an obstacle to route around — it is the rule that keeps WhatsApp worth
// having, and Nudge's broadcast lane sat unusable for months precisely because
// template sends were never built there.
//
// So the salon registers ONE approved campaign template whose third parameter
// is a free line:
//
//     "Merhaba {{1}}! {{2}} olarak {{3}}"
//
// and each campaign supplies that line. One Meta approval, every campaign they
// will ever run. Without this shape a salon would need a fresh approval, and a
// day or two of waiting, for every promotion they think of.
//
// Email carries no such rule, so the same line sends as ordinary text there.
// A customer with an address gets both, which is deliberate: the two channels
// have very different open rates and the salon paid for neither.
//
// ── CONSENT IS NOT NEGOTIABLE ───────────────────────────────────────────────
//
// Every recipient must have consentAt set. This is KVKK, it is also the thing
// that gets a WABA banned, and it is enforced twice — once when the segment is
// built and once by the send path itself. Do not add a bypass.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrg, requireOwner } from "./lib/orgAuth";
import { renderTokens } from "./lib/renderTokens";
import { recordActivity } from "./lib/activity";

const DAY_MS = 24 * 3600_000;

// A campaign is a blunt instrument, so it is capped. A salon with more
// customers than this wants a segment, not a bigger blast, and an accidental
// send to everyone is not an error anyone can take back.
const MAX_RECIPIENTS = 2000;

// Rows created per mutation while a run fans out. Well inside Convex's
// per-execution write limits, and the tail reschedules itself.
const FANOUT_BATCH = 100;

const segmentValidator = v.object({
  notSeenForDays: v.optional(v.number()),
  neverBooked: v.optional(v.boolean()),
  serviceId: v.optional(v.id("services")),
});

type Segment = {
  notSeenForDays?: number;
  neverBooked?: boolean;
  serviceId?: Id<"services">;
};

// ── Building the audience ───────────────────────────────────────────────────
//
// Matched locally against this org's own rows. There is no external CRM to ask
// and no ingest step: the customers table IS the audience.
async function matchSegment(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  segment: Segment,
): Promise<Doc<"customers">[]> {
  const customers = await ctx.db
    .query("customers")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(MAX_RECIPIENTS * 2);

  const now = Date.now();
  const out: Doc<"customers">[] = [];
  for (const customer of customers) {
    // First gate, before any other work: no consent, no campaign. Ever.
    if (customer.consentAt === undefined) continue;

    const needsHistory =
      segment.notSeenForDays !== undefined ||
      segment.neverBooked === true ||
      segment.serviceId !== undefined;

    if (needsHistory) {
      const appointments = await ctx.db
        .query("appointments")
        .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
        .take(200);
      // "Seen" means they actually came. A cancelled booking is not a visit,
      // and treating it as one would exclude exactly the people a win-back
      // campaign exists to reach.
      const visits = appointments.filter((a) => a.status === "completed");

      if (segment.neverBooked === true && visits.length > 0) continue;

      if (segment.notSeenForDays !== undefined) {
        const cutoff = now - segment.notSeenForDays * DAY_MS;
        const lastVisit = visits.reduce((max, a) => Math.max(max, a.startAt), 0);
        // Never visited counts as "not seen": they are overdue by definition.
        if (lastVisit > cutoff) continue;
        // But someone with a FUTURE booking is already coming back, and
        // messaging them about how long it has been reads as not knowing.
        const hasUpcoming = appointments.some(
          (a) =>
            a.startAt > now && (a.status === "scheduled" || a.status === "confirmed"),
        );
        if (hasUpcoming) continue;
      }

      if (segment.serviceId !== undefined) {
        const had = visits.some((a) =>
          (a.items ?? []).some((item) => item.serviceId === segment.serviceId),
        );
        if (!had) continue;
      }
    }

    out.push(customer);
    if (out.length >= MAX_RECIPIENTS) break;
  }
  return out;
}

// What a segment would reach, before anyone commits to it. Its own query so
// the editor can show the number live while the salon adjusts the filters —
// "how many people is this?" is the question that stops a campaign going to
// the wrong list.
export const previewCount = query({
  args: { segment: segmentValidator },
  returns: v.object({ count: v.number(), capped: v.boolean() }),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const matched = await matchSegment(ctx, orgId, args.segment);
    return { count: matched.length, capped: matched.length >= MAX_RECIPIENTS };
  },
});

// ── CRUD ────────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("campaigns"),
      name: v.string(),
      body: v.string(),
      status: v.string(),
      recipientCount: v.optional(v.number()),
      startedAt: v.optional(v.number()),
      sent: v.number(),
      failed: v.number(),
      pending: v.number(),
      opened: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("campaigns")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(50);

    return await Promise.all(
      rows.map(async (row) => {
        // Counted from the message rows rather than kept as running totals on
        // the campaign: a counter incremented from two places (the send path
        // and the retry queue) drifts, and the drift is invisible.
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_campaign", (q) => q.eq("campaignId", row._id))
          .take(MAX_RECIPIENTS + 1);
        return {
          _id: row._id,
          name: row.name,
          body: row.body,
          status: row.status,
          recipientCount: row.recipientCount,
          startedAt: row.startedAt,
          sent: messages.filter((m) => m.status !== "queued" && m.status !== "failed")
            .length,
          failed: messages.filter((m) => m.status === "failed").length,
          // First-open-wins per message (recordEmailOpen), counted live like
          // everything else here. A rate over the run's email half — the only
          // granularity prefetch noise leaves honest.
          opened: messages.filter((m) => m.openedAt !== undefined).length,
          // Still queued: either waiting for its first attempt or backing off
          // between retries. Shown separately because a campaign mid-flight
          // and a campaign that half-failed look identical otherwise.
          pending: messages.filter((m) => m.status === "queued").length,
        };
      }),
    );
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    body: v.string(),
    segment: segmentValidator,
  },
  returns: v.id("campaigns"),
  handler: async (ctx, args) => {
    // Owner-only. A campaign reaches every customer the salon has and cannot
    // be recalled; that is not a decision for whoever is on shift.
    const { orgId, user } = await requireOwner(ctx);
    const body = args.body.trim();
    if (!body) throw new Error("body-required");
    return await ctx.db.insert("campaigns", {
      orgId,
      name: args.name.trim() || body.slice(0, 40),
      body,
      segment: args.segment,
      status: "draft",
      createdBy: user._id,
    });
  },
});

export const remove = mutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.orgId !== orgId) throw new Error("not-found");
    // A run that has gone out is a record of what customers were told. Only a
    // draft can be deleted.
    if (campaign.status !== "draft") throw new Error("already-sent");
    await ctx.db.delete(args.campaignId);
    return null;
  },
});

// ── Sending ─────────────────────────────────────────────────────────────────

export const loadForSend = internalQuery({
  args: { campaignId: v.id("campaigns") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;
    const [org, templates, waAccount] = await Promise.all([
      ctx.db.get(campaign.orgId),
      ctx.db
        .query("waTemplates")
        .withIndex("by_org", (q) => q.eq("orgId", campaign.orgId))
        .collect(),
      ctx.db
        .query("waAccounts")
        .withIndex("by_org", (q) => q.eq("orgId", campaign.orgId))
        .unique(),
    ]);
    if (!org) return null;
    const recipients = await matchSegment(ctx, campaign.orgId, campaign.segment);
    return {
      campaign,
      org,
      hasWa: waAccount !== null,
      templates: templates.filter((t) => t.kind === "campaign" && t.status === "approved"),
      recipientIds: recipients.map((r) => r._id),
    };
  },
});

// Creates the message rows for one page of recipients.
//
// Rows land with nextAttemptAt set to now, which puts them straight into the
// delivery queue (convex/delivery.ts) — the same queue that handles retries,
// backoff, dead-lettering and the stuck-send reaper. A campaign therefore
// inherits all of it for free, including the important part: when Meta starts
// rate-limiting a large run, those 429s classify as transient and the run
// paces ITSELF rather than hammering a provider that is already saying stop.
export const fanOut = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    customerIds: v.array(v.id("customers")),
    templateName: v.optional(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return 0;
    const org = await ctx.db.get(campaign.orgId);
    if (!org) return 0;

    let created = 0;
    for (const customerId of args.customerIds) {
      const customer = await ctx.db.get(customerId);
      if (!customer || customer.orgId !== campaign.orgId) continue;
      // Second consent check, at the moment of writing the row. The segment
      // already filtered, but the two are separated by a fan-out that can span
      // minutes and consent can be withdrawn in between.
      if (customer.consentAt === undefined) continue;

      const line = renderTokens(campaign.body, {
        firstName: customer.firstName,
        lastName: customer.lastName,
        businessName: org.name,
        phone: customer.phone,
      });
      // A body that renders to nothing for THIS customer is a message they
      // should not receive. Better to send them nothing than a bare greeting.
      if (!line) continue;

      if (args.templateName) {
        await ctx.db.insert("messages", {
          orgId: campaign.orgId,
          customerId,
          campaignId: args.campaignId,
          direction: "out",
          kind: "campaign",
          status: "queued",
          templateName: args.templateName,
          templateParams: [customer.firstName, org.name, line],
          body: line,
          nextAttemptAt: Date.now(),
        });
        created += 1;
      }

      // Email rides alongside when we have an address and a From. No Meta
      // approval applies, so the line sends as ordinary text. The tracking
      // token is minted here at fan-out; delivery injects the pixel, and the
      // campaign's open count is read live off these rows — bulk mail is the
      // one place an open rate means something.
      if (customer.email && org.emailFrom) {
        await ctx.db.insert("messages", {
          orgId: campaign.orgId,
          customerId,
          campaignId: args.campaignId,
          direction: "out",
          kind: "email_campaign",
          status: "queued",
          body: line,
          emailSubject: org.name,
          emailFrom: org.emailFrom,
          trackingToken: crypto.randomUUID(),
          nextAttemptAt: Date.now(),
        });
        created += 1;
      }
    }
    return created;
  },
});

export const markStarted = internalMutation({
  args: { campaignId: v.id("campaigns"), recipientCount: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.campaignId, {
      status: "sending",
      startedAt: Date.now(),
      recipientCount: args.recipientCount,
    });
    return null;
  },
});

export const markDone = internalMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;
    await ctx.db.patch(args.campaignId, { status: "done", finishedAt: Date.now() });
    await recordActivity(ctx, {
      orgId: campaign.orgId,
      kind: "settings_changed",
      detail: `campaign: ${campaign.name}`,
    });
    return null;
  },
});

// The one entry point. An action rather than a mutation because a large run
// has to page, and paging inside a single mutation blows Convex's per-execution
// limits well before the cap.
export const send = action({
  args: { campaignId: v.id("campaigns") },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
    queued: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; reason?: string; queued?: number }> => {
    const context = await ctx.runQuery(internal.campaigns.loadForSend, {
      campaignId: args.campaignId,
    });
    if (!context) return { ok: false, reason: "not-found" };
    const { campaign, org, hasWa, templates, recipientIds } = context;

    // Sending twice is not something a campaign gets to do by accident.
    if (campaign.status !== "draft") return { ok: false, reason: "already-sent" };
    if (recipientIds.length === 0) return { ok: false, reason: "no-recipients" };

    // Exact language match, no cross-language fallback — the same rule the
    // appointment sends follow, and for the same reason: the wrong-language
    // message is worse than no message.
    const template = templates.find(
      (t: Doc<"waTemplates">) => t.language === org.language,
    );
    // No WhatsApp lane at all is only fatal if there is no email lane either.
    if ((!hasWa || !template) && !org.emailFrom) {
      return { ok: false, reason: template ? "wa-not-configured" : "no-campaign-template" };
    }

    await ctx.runMutation(internal.campaigns.markStarted, {
      campaignId: args.campaignId,
      recipientCount: recipientIds.length,
    });

    let queued = 0;
    for (let i = 0; i < recipientIds.length; i += FANOUT_BATCH) {
      queued += await ctx.runMutation(internal.campaigns.fanOut, {
        campaignId: args.campaignId,
        customerIds: recipientIds.slice(i, i + FANOUT_BATCH),
        templateName: hasWa && template ? template.metaName : undefined,
      });
    }

    // "done" means every message is queued, NOT that every message arrived.
    // Delivery is the queue's job and the per-campaign counts report it.
    await ctx.runMutation(internal.campaigns.markDone, { campaignId: args.campaignId });
    return { ok: true, queued };
  },
});
