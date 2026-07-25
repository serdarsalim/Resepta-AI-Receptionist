import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
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

// ---- Contact properties written by the voice agent ----
//
// The vertical's own vocabulary (plate number for a garage, last cleaning for
// a dentist, insurance for a clinic) lives in contactFields as ORG DATA. The
// agent writes values by key; the fact that a contactFields row exists in this
// org is the entire permission model. An agent that invents a variable name
// changes nothing, which is what keeps this flexible without being clever.

// Built-in columns are off limits to this path. A phone number misheard
// mid-call must never overwrite the number we dialled, and consent is a KVKK
// record with its own moment, not a value an agent infers from a chat.
const RESERVED_CONTACT_KEYS = new Set([
  "firstname",
  "first_name",
  "lastname",
  "last_name",
  "phone",
  "phonenumber",
  "phone_number",
  "email",
  "consent",
  "consentat",
  "consent_at",
]);

const contactUpdateResult = v.object({
  ok: v.boolean(),
  reason: v.optional(v.string()),
  // Keys actually written, the matching labels (for anything spoken), and the
  // keys we dropped so the agent's transcript shows what did not stick.
  updated: v.array(v.string()),
  updatedLabels: v.array(v.string()),
  ignored: v.array(v.string()),
});

// Lenient sibling of assertE164: the voice lane must never throw at Retell,
// so a number we cannot read comes back as a reason instead of a 500.
function toE164(raw: string): string | null {
  const trimmed = raw.replace(/[\s().-]/g, "");
  const phone = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null;
}

// The single mapping both voice write paths share: the mid-call function and
// the post-call webhook. Two copies of this guard would drift.
export async function applyVoiceContactValues(
  ctx: MutationCtx,
  args: { orgId: Id<"orgs">; phone: string; values: Record<string, string> },
): Promise<{
  ok: boolean;
  reason?: string;
  updated: string[];
  updatedLabels: string[];
  ignored: string[];
}> {
  const phone = toE164(args.phone);
  if (!phone) {
    return {
      ok: false,
      reason: "phone-not-recognised",
      updated: [],
      updatedLabels: [],
      ignored: [],
    };
  }
  const customer = await ctx.db
    .query("customers")
    .withIndex("by_org_phone", (q) => q.eq("orgId", args.orgId).eq("phone", phone))
    .unique();
  if (!customer) {
    return {
      ok: false,
      reason: "no-contact-with-that-number",
      updated: [],
      updatedLabels: [],
      ignored: [],
    };
  }
  const fields = await ctx.db
    .query("contactFields")
    .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
    .collect();
  const byKey = new Map(fields.map((field) => [field.key, field]));

  const custom = { ...(customer.custom ?? {}) };
  const updated: string[] = [];
  const updatedLabels: string[] = [];
  const ignored: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(args.values)) {
    const key = rawKey.trim();
    if (!key) continue;
    const field = byKey.get(key);
    if (!field || RESERVED_CONTACT_KEYS.has(key.toLowerCase())) {
      ignored.push(key);
      continue;
    }
    // Everything stores as a string; the field's type drives the editor, not
    // the storage. An empty value clears the property rather than parking an
    // empty string on the record.
    const value = String(rawValue ?? "").trim();
    if (value) custom[key] = value;
    else delete custom[key];
    updated.push(key);
    updatedLabels.push(field.label);
  }
  if (updated.length > 0) await ctx.db.patch(customer._id, { custom });
  return { ok: true, updated, updatedLabels, ignored };
}

// Org comes from the agent id on the signed payload, exactly like every other
// voice entry point. A payload that names an org is a payload we ignore.
export const updateContactFromVoice = internalMutation({
  args: {
    retellAgentId: v.string(),
    phone: v.string(),
    values: v.record(v.string(), v.string()),
  },
  returns: contactUpdateResult,
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent || !agent.enabled) {
      return {
        ok: false,
        reason: "agent-not-configured",
        updated: [],
        updatedLabels: [],
        ignored: [],
      };
    }
    return await applyVoiceContactValues(ctx, {
      orgId: agent.orgId,
      phone: args.phone,
      values: args.values,
    });
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
