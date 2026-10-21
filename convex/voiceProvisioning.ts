import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { connectionField } from "./lib/connections";
import { platformValue } from "./lib/platformConfig";
import { requireOwner } from "./lib/orgAuth";
import {
  VOICE_AGENT_TEMPLATE_KEY,
  VOICE_AGENT_TEMPLATE_VERSION,
} from "./lib/voiceAgentTemplate";
import { resolvePlatformHighPriority, resolvePlatformVoiceModel } from "./lib/voiceModels";

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
    // Set only by a caller that has ALREADY established the org some other
    // way: the MCP connector, whose key re-checks membership on every request,
    // or an operator CLI run. Left unset by the signed-in path, which proves
    // ownership right here.
    //
    // This is safe because `begin` is internal — no client can call it, and
    // the public `createAgent` action does not accept an orgId to forward. If
    // that action ever grows one, this becomes a way to provision into another
    // salon's workspace, so the two facts have to move together.
    orgId: v.optional(v.id("orgs")),
    requestId: v.string(),
    leaseToken: v.string(),
    name: v.string(),
    language,
    voiceId: v.string(),
    inboundNumber: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const orgId = args.orgId ?? (await requireOwner(ctx)).orgId;
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

    // The fleet default a NEW agent is born with — resolved here because the
    // provisioning action has no ctx.db. Null (unset or stale row) means the
    // template's own constant.
    const platformVoiceModel = resolvePlatformVoiceModel(
      await platformValue(ctx, "voiceModel"),
    );
    const platformHighPriority = resolvePlatformHighPriority(
      await platformValue(ctx, "voiceHighPriority"),
    );

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
      return { claimed: false, complete: true, apiKey, orgName: org.name, orgLanguage: org.language, platformVoiceModel, platformHighPriority, row };
    }
    if (row && (row.leaseUntil ?? 0) > Date.now()) {
      return { claimed: false, complete: false, apiKey, orgName: org.name, orgLanguage: org.language, platformVoiceModel, platformHighPriority, row };
    }

    // The line a new agent answers must be one THIS workspace may use: on its
    // allowlist, and not held by another workspace inbound or outbound
    // (retell.lineUsable, the check every later reassignment already runs).
    // The provisioning action's bindInboundNumber only refuses a line that
    // has an inbound agent at the provider right now, so a line provisioned
    // to another salon, or one it dials out from, could be taken by naming it
    // here, from the app or from the MCP's create_phone_agent (2026-10-13).
    //
    // Only when the number asked for becomes the job's number: a new job, or
    // one whose agent does not exist yet. A job resuming after its agent was
    // made keeps its own number, and the action judges THAT one before it
    // records or binds it, dropping it rather than failing (2026-10-13).
    // Refusing here as well wedged such a job: the form resends the job's
    // own number, so a line that became unusable while the job waited
    // refused every retry, and the agent never finished.
    if (inboundNumber && !row?.retellAgentId) {
      const usable = await ctx.runQuery(internal.retell.lineUsable, {
        orgId,
        number: inboundNumber,
      });
      if (!usable.ok) {
        throw new Error(usable.reason ?? "number-not-assigned-to-this-workspace");
      }
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
    return { claimed: true, complete: false, apiKey, orgName: org.name, orgLanguage: org.language, platformVoiceModel, platformHighPriority, row };
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
    // The born prompt and the provider version it published as — the first
    // entry in the prompt mirror (schema: retellAgents.generalPrompt), so a
    // freshly provisioned agent's Talimat is readable by the chat lane
    // before the owner ever opens the editor.
    generalPrompt: v.optional(v.string()),
    promptVersion: v.optional(v.number()),
  },
  returns: v.id("retellAgents"),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseToken !== args.leaseToken) throw new Error("setup-lease-lost");
    const mirror =
      args.generalPrompt !== undefined
        ? {
            generalPrompt: args.generalPrompt,
            promptVersion: args.promptVersion,
            promptMirroredAt: Date.now(),
          }
        : {};
    const claimed = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (claimed) {
      if (claimed.orgId !== job.orgId) throw new Error("agent-already-connected");
      if (args.inboundNumber && claimed.inboundNumber !== args.inboundNumber) {
        await ctx.db.patch(claimed._id, { inboundNumber: args.inboundNumber });
      }
      if (claimed.name !== job.name) {
        await ctx.db.patch(claimed._id, { name: job.name });
      }
      // A resumed job re-connects the same agent it built; the build was from
      // the current template either way. The mirror only ever moves FORWARD
      // here: a resumed job must not overwrite a prompt the owner has since
      // published with the older text it was born with.
      await ctx.db.patch(claimed._id, {
        templateVersion: job.templateVersion,
        ...(claimed.generalPrompt === undefined ? mirror : {}),
      });
      return claimed._id;
    }
    return await ctx.db.insert("retellAgents", {
      orgId: job.orgId,
      retellAgentId: args.retellAgentId,
      name: job.name,
      inboundNumber: args.inboundNumber,
      enabled: true,
      templateVersion: job.templateVersion,
      ...mirror,
    });
  },
});

// A line the job asked for that this workspace may not have after all, or
// that the provider would not give the new agent: let go of, rather than
// failing the job over it (2026-10-13). Failing kept the number on the job,
// and a job whose agent exists never edits its number, so every retry hit
// the same refusal and the agent never finished. Cleared from the job and
// from the agent's own row (an earlier attempt may have recorded it there),
// so nothing goes on claiming the line. The owner attaches a line afterwards
// through the usual picker, which runs its own checks.
export const dropNumber = internalMutation({
  args: {
    jobId: v.id("voiceAgentProvisioning"),
    leaseToken: v.string(),
    retellAgentId: v.string(),
    number: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseToken !== args.leaseToken) throw new Error("setup-lease-lost");
    if (job.inboundNumber === args.number) {
      await ctx.db.patch(job._id, { inboundNumber: undefined, updatedAt: Date.now() });
    }
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (agent && agent.orgId === job.orgId && agent.inboundNumber === args.number) {
      await ctx.db.patch(agent._id, { inboundNumber: undefined });
    }
    return null;
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


// ── Auto-provisioning (docs/chat-agent.md §7) ───────────────────────────────
// The two db-side halves of the onboarding hook in retellAgent.autoProvision:
// whether this org should get an agent made for it, and the key STAMP.

export const autoProvisionPrecheck = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.object({
    eligible: v.boolean(),
    reason: v.optional(v.string()),
    name: v.string(),
    language: v.string(),
    // The org has no retell key of its own; the caller stamps the platform
    // default before provisioning. Null when the org has its own or when
    // there is no default to stamp.
    keyToStamp: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    const no = (reason: string) => ({
      eligible: false,
      reason,
      name: "",
      language: "",
      keyToStamp: null,
    });
    if (!org || !org.name) return no("no-org-or-unnamed");
    if (org.demoMode) return no("demo-org");
    if ((org.status ?? "active") === "suspended") return no("org-suspended");
    // An org that already has an agent — connected OR mid-provisioning — is
    // not a blank slate, and auto-creating a second agent is exactly the
    // duplicate the checkpointed job design exists to prevent.
    const existing = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    if (existing) return no("agent-exists");
    const job = await ctx.db
      .query("voiceAgentProvisioning")
      .withIndex("by_org_updated", (q) => q.eq("orgId", args.orgId))
      .first();
    if (job) return no("provisioning-exists");
    const ownKey = await connectionField(ctx, args.orgId, "retell", "apiKey");
    const defaultKey = ownKey ? null : await platformValue(ctx, "retellApiKey");
    if (!ownKey && !defaultKey) return no("no-retell-key");
    return {
      eligible: true,
      reason: undefined,
      name: org.name,
      language: org.language,
      keyToStamp: defaultKey,
    };
  },
});

// The stamp, not a fallback (docs/chat-agent.md §7): the platform default is
// COPIED into this org's own connections row at provision time, so
// connectionField resolution stays exactly as the doctrine demands and the
// operator can re-key this one client later without touching the default.
export const stampDefaultRetellKey = internalMutation({
  args: { orgId: v.id("orgs"), value: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_org_provider_field", (q) =>
        q.eq("orgId", args.orgId).eq("provider", "retell").eq("field", "apiKey"),
      )
      .unique();
    // Never overwrite: a row that appeared since the precheck is the operator
    // installing a real key, which beats the default by definition.
    if (existing) return null;
    await ctx.db.insert("connections", {
      orgId: args.orgId,
      provider: "retell",
      field: "apiKey",
      value: args.value,
      label: "Platform default (auto-provisioned)",
      updatedAt: Date.now(),
    });
    // The stamped key IS the platform key, i.e. the shared workspace — scope
    // the picker to this org's own agents. Set here because the stamp writes
    // the connections row directly, past setFieldInternal's derivation.
    await ctx.db.patch(args.orgId, { voiceAgentSource: "randevu" });
    return null;
  },
});
