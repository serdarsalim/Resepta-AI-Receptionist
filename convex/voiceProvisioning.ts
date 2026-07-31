import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { connectionField } from "./lib/connections";
import { requireOwner } from "./lib/orgAuth";
import {
  VOICE_AGENT_TEMPLATE_KEY,
  VOICE_AGENT_TEMPLATE_VERSION,
} from "./lib/voiceAgentTemplate";

const language = v.union(v.literal("tr-TR"), v.literal("en-US"), v.literal("de-DE"));
const status = v.union(
  v.literal("pending"),
  v.literal("creating_engine"),
  v.literal("creating_agent"),
  v.literal("publishing"),
  v.literal("connecting"),
  v.literal("complete"),
  v.literal("failed"),
);

const publicJob = v.object({
  requestId: v.string(),
  status,
  name: v.string(),
  language,
  voiceId: v.string(),
  inboundNumber: v.union(v.string(), v.null()),
  error: v.union(v.string(), v.null()),
  agentId: v.union(v.string(), v.null()),
  working: v.boolean(),
});

// A refresh during a provider timeout restores the same form and request id.
// Only the newest row matters: a completed job closes the history behind it,
// while a failed newest row is the one setup the owner can retry.
export const active = query({
  args: {},
  returns: v.union(publicJob, v.null()),
  handler: async (ctx) => {
    const { orgId } = await requireOwner(ctx);
    const row = await ctx.db
      .query("voiceAgentProvisioning")
      .withIndex("by_org_updated", (q) => q.eq("orgId", orgId))
      .order("desc")
      .first();
    if (!row || row.status === "complete") return null;
    return {
      requestId: row.requestId,
      status: row.status,
      name: row.name,
      language: row.language,
      voiceId: row.voiceId,
      inboundNumber: row.inboundNumber ?? null,
      error: row.error ?? null,
      agentId: row.retellAgentId ?? null,
      working: (row.leaseUntil ?? 0) > Date.now(),
    };
  },
});

// The signed-in action acquires one five-minute lease before it calls the
// provider. A duplicate click sees claimed=false and cannot create a second
// external resource. An interrupted action becomes retryable when the lease
// expires, using the ids checkpointed below.
export const begin = internalMutation({
  args: {
    requestId: v.string(),
    leaseToken: v.string(),
    name: v.string(),
    language,
    voiceId: v.string(),
    inboundNumber: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");
    if (org.demoMode) throw new Error("demo-workspace");
    const apiKey = await connectionField(ctx, orgId, "retell", "apiKey");
    if (!apiKey) throw new Error("phone-agent-not-configured");

    const name = args.name.trim().slice(0, 80);
    const voiceId = args.voiceId.trim();
    const inboundNumber = args.inboundNumber?.trim() || undefined;
    if (!name) throw new Error("agent-name-required");
    if (!voiceId) throw new Error("agent-voice-required");

    const exact = await ctx.db
      .query("voiceAgentProvisioning")
      .withIndex("by_org_request", (q) =>
        q.eq("orgId", orgId).eq("requestId", args.requestId),
      )
      .unique();
    const latest = await ctx.db
      .query("voiceAgentProvisioning")
      .withIndex("by_org_updated", (q) => q.eq("orgId", orgId))
      .order("desc")
      .first();
    let row = exact ?? (latest?.status !== "complete" ? latest : null);

    if (row?.status === "complete") {
      return { claimed: false, complete: true, apiKey, orgName: org.name, row };
    }
    if (row && (row.leaseUntil ?? 0) > Date.now()) {
      return { claimed: false, complete: false, apiKey, orgName: org.name, row };
    }

    const now = Date.now();
    if (!row) {
      const id = await ctx.db.insert("voiceAgentProvisioning", {
        orgId,
        requestId: args.requestId,
        status: "pending",
        templateKey: VOICE_AGENT_TEMPLATE_KEY,
        templateVersion: VOICE_AGENT_TEMPLATE_VERSION,
        name,
        language: args.language,
        voiceId,
        inboundNumber,
        leaseToken: args.leaseToken,
        leaseUntil: now + 5 * 60_000,
        createdAt: now,
        updatedAt: now,
      });
      row = (await ctx.db.get(id))!;
    } else {
      // Before an agent exists, a failed voice or language choice can be fixed
      // in place while preserving a response engine already created for the
      // request. Once an agent exists its identity is stable and retry only
      // repairs publication, routing or runtime wiring.
      const editable = !row.retellAgentId;
      await ctx.db.patch(row._id, {
        status: "pending",
        ...(editable
          ? {
              name,
              language: args.language,
              voiceId,
              inboundNumber,
            }
          : {}),
        error: undefined,
        leaseToken: args.leaseToken,
        leaseUntil: now + 5 * 60_000,
        updatedAt: now,
      });
      row = (await ctx.db.get(row._id))!;
    }
    return { claimed: true, complete: false, apiKey, orgName: org.name, row };
  },
});

export const checkpoint = internalMutation({
  args: {
    jobId: v.id("voiceAgentProvisioning"),
    leaseToken: v.string(),
    status,
    retellLlmId: v.optional(v.string()),
    retellAgentId: v.optional(v.string()),
    retellVersion: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.jobId);
    if (!row || row.leaseToken !== args.leaseToken) throw new Error("setup-lease-lost");
    await ctx.db.patch(row._id, {
      status: args.status,
      ...(args.retellLlmId ? { retellLlmId: args.retellLlmId } : {}),
      ...(args.retellAgentId ? { retellAgentId: args.retellAgentId } : {}),
      ...(args.retellVersion !== undefined ? { retellVersion: args.retellVersion } : {}),
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const connect = internalMutation({
  args: {
    jobId: v.id("voiceAgentProvisioning"),
    leaseToken: v.string(),
    retellAgentId: v.string(),
    inboundNumber: v.optional(v.string()),
  },
  returns: v.id("retellAgents"),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseToken !== args.leaseToken) throw new Error("setup-lease-lost");
    const claimed = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (claimed) {
      if (claimed.orgId !== job.orgId) throw new Error("agent-already-connected");
      if (args.inboundNumber && claimed.inboundNumber !== args.inboundNumber) {
        await ctx.db.patch(claimed._id, { inboundNumber: args.inboundNumber });
      }
      return claimed._id;
    }
    return await ctx.db.insert("retellAgents", {
      orgId: job.orgId,
      retellAgentId: args.retellAgentId,
      inboundNumber: args.inboundNumber,
      enabled: true,
    });
  },
});

export const complete = internalMutation({
  args: {
    jobId: v.id("voiceAgentProvisioning"),
    leaseToken: v.string(),
    retellVersion: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.jobId);
    if (!row || row.leaseToken !== args.leaseToken) throw new Error("setup-lease-lost");
    await ctx.db.patch(row._id, {
      status: "complete",
      ...(args.retellVersion !== undefined ? { retellVersion: args.retellVersion } : {}),
      error: undefined,
      leaseToken: undefined,
      leaseUntil: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const fail = internalMutation({
  args: {
    jobId: v.id("voiceAgentProvisioning"),
    leaseToken: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.jobId);
    if (!row || row.leaseToken !== args.leaseToken) return null;
    await ctx.db.patch(row._id, {
      status: "failed",
      error: args.error.slice(0, 500),
      leaseToken: undefined,
      leaseUntil: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});
