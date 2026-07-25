import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireOrg, requireOwner, assertE164 } from "./lib/orgAuth";
import { nextUpcomingOf, scheduleConfirmationIfConfigured } from "./appointments";

// Voice lane (spec Phase C): one Retell agent per org. Function calls and the
// post-call webhook resolve the org by retellAgentId — never by caller number.

export const config = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("retellAgents"),
      retellAgentId: v.string(),
      inboundNumber: v.optional(v.string()),
      transferNumber: v.optional(v.string()),
      enabled: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    if (!agent) return null;
    return {
      _id: agent._id,
      retellAgentId: agent.retellAgentId,
      inboundNumber: agent.inboundNumber,
      transferNumber: agent.transferNumber,
      enabled: agent.enabled,
    };
  },
});

export const setConfig = mutation({
  args: {
    retellAgentId: v.string(),
    inboundNumber: v.optional(v.string()),
    transferNumber: v.optional(v.string()),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const retellAgentId = args.retellAgentId.trim();
    if (!retellAgentId) throw new Error("agent-id-required");
    // Agent ids are globally unique at Retell; refuse one another org claimed.
    const claimed = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (claimed && claimed.orgId !== orgId) throw new Error("agent-already-connected");
    const existing = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    const patch = {
      retellAgentId,
      inboundNumber: args.inboundNumber?.trim() || undefined,
      transferNumber: args.transferNumber?.trim() || undefined,
      enabled: args.enabled,
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("retellAgents", { orgId, ...patch });
    return null;
  },
});

const callDoc = v.object({
  _id: v.id("calls"),
  _creationTime: v.number(),
  customerId: v.optional(v.id("customers")),
  direction: v.union(v.literal("inbound"), v.literal("outbound")),
  fromNumber: v.optional(v.string()),
  startedAt: v.number(),
  durationSec: v.optional(v.number()),
  outcome: v.optional(v.string()),
  summary: v.optional(v.string()),
  transcript: v.optional(v.string()),
  recordingUrl: v.optional(v.string()),
  customerName: v.optional(v.string()),
});

export const listCalls = query({
  args: {},
  returns: v.array(callDoc),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("calls")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(100);
    const out = [];
    for (const row of rows) {
      const customer = row.customerId ? await ctx.db.get(row.customerId) : null;
      out.push({
        _id: row._id,
        _creationTime: row._creationTime,
        customerId: row.customerId,
        direction: row.direction,
        fromNumber: row.fromNumber,
        startedAt: row.startedAt,
        durationSec: row.durationSec,
        outcome: row.outcome,
        summary: row.summary,
        transcript: row.transcript,
        recordingUrl: row.recordingUrl,
        customerName: customer
          ? `${customer.firstName} ${customer.lastName ?? ""}`.trim()
          : undefined,
      });
    }
    return out;
  },
});

// ---- Internal plumbing for the HTTP endpoints ----

// Org + scheduling config for a function call, resolved by agent id.
export const loadVoiceContext = internalQuery({
  args: { retellAgentId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent || !agent.enabled) return null;
    const org = await ctx.db.get(agent.orgId);
    if (!org) return null;
    return { agent, org };
  },
});

// Voice booking: find/create the customer by phone, insert the appointment.
// externalUid (cal.com's uid when the booking went through cal.com) is what
// dedupes the webhook echo via by_org_external.
export const voiceBook = internalMutation({
  args: {
    orgId: v.id("orgs"),
    name: v.string(),
    phone: v.string(),
    startAt: v.number(),
    externalUid: v.optional(v.string()),
    durationMinutes: v.optional(v.number()),
  },
  returns: v.id("appointments"),
  handler: async (ctx, args) => {
    const phone = assertE164(args.phone);
    let customer = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) => q.eq("orgId", args.orgId).eq("phone", phone))
      .unique();
    if (!customer) {
      const [firstName, ...rest] = args.name.trim().split(/\s+/).filter(Boolean);
      const customerId = await ctx.db.insert("customers", {
        orgId: args.orgId,
        firstName: firstName || phone,
        lastName: rest.join(" ") || undefined,
        phone,
        // Booking by calling the salon IS the opt-in moment (same reasoning
        // as the cal.com page).
        consentAt: Date.now(),
      });
      customer = await ctx.db.get(customerId);
    }
    if (!customer) throw new Error("customer-failed");
    const appointmentId = await ctx.db.insert("appointments", {
      orgId: args.orgId,
      customerId: customer._id,
      startAt: args.startAt,
      durationMinutes: args.durationMinutes,
      status: "scheduled",
      source: "voice",
      externalUid: args.externalUid,
    });
    await scheduleConfirmationIfConfigured(ctx, args.orgId, appointmentId);
    return appointmentId;
  },
});

export const voiceCancel = internalMutation({
  args: { orgId: v.id("orgs"), phone: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const phone = assertE164(args.phone);
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) => q.eq("orgId", args.orgId).eq("phone", phone))
      .unique();
    if (!customer) return false;
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();
    const next = nextUpcomingOf(appointments, Date.now(), ["scheduled", "confirmed"]);
    if (!next) return false;
    await ctx.db.patch(next._id, { status: "cancelled" });
    return true;
  },
});

// Post-call webhook: one row per Retell call, idempotent by retellCallId.
export const recordCall = internalMutation({
  args: {
    retellAgentId: v.string(),
    retellCallId: v.string(),
    fromNumber: v.optional(v.string()),
    startedAt: v.number(),
    durationSec: v.optional(v.number()),
    outcome: v.optional(v.string()),
    summary: v.optional(v.string()),
    transcript: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent) return null;
    const existing = await ctx.db
      .query("calls")
      .withIndex("by_retell_call", (q) => q.eq("retellCallId", args.retellCallId))
      .unique();
    if (existing) return null; // Retell retries webhooks; first write wins
    let customerId;
    if (args.fromNumber) {
      const phone = args.fromNumber.startsWith("+")
        ? args.fromNumber
        : `+${args.fromNumber}`;
      const customer = await ctx.db
        .query("customers")
        .withIndex("by_org_phone", (q) => q.eq("orgId", agent.orgId).eq("phone", phone))
        .unique();
      customerId = customer?._id;
    }
    await ctx.db.insert("calls", {
      orgId: agent.orgId,
      customerId,
      direction: "inbound",
      fromNumber: args.fromNumber,
      startedAt: args.startedAt,
      durationSec: args.durationSec,
      outcome: args.outcome,
      summary: args.summary,
      transcript: args.transcript,
      recordingUrl: args.recordingUrl,
      retellCallId: args.retellCallId,
    });
    return null;
  },
});
