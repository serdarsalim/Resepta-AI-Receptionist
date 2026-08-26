import { v } from "convex/values";
import { builtinAgentVariables } from "./lib/agentVariables";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { connectionField } from "./lib/connections";
import { requireOrg, requireOwner, assertE164 } from "./lib/orgAuth";
import { dialCodeForTimezone, normalisePhone } from "./lib/phone";
import { voiceCatalogue } from "./lib/voiceCatalogue";
import {
  nextUpcomingOf,
  retryConfirmationsAwaitingEmail,
  scheduleConfirmationIfConfigured,
} from "./appointments";
import { serviceKey } from "./services";
import { syncAppointmentSchedule } from "./lib/reminderSchedule";
import { recordCustomerCreated } from "./lib/newCustomer";
import { monthKey } from "./lib/usage";
import { platformValue } from "./lib/platformConfig";
import { resolvePlatformHighPriority, resolvePlatformVoiceModel } from "./lib/voiceModels";
import { queueOrgAlert } from "./lib/alerts";
import { WALLET_LOW_MICRO_USD } from "./wallet";
import { getLocalPartsSafe, localWallTimeToUtcMs } from "./lib/businessHours";
import { voiceVariableInput } from "./lib/voiceVariables";
import { spokenClock, spokenDateTime, spokenLead } from "./lib/speech";
import { customerConflict } from "./lib/overlap";
import { RESERVED_CONTACT_KEYS } from "./lib/keys";

// Voice lane (spec Phase C). Function calls and the post-call webhook resolve
// the org by retellAgentId — never by caller number.
//
// An org may connect MANY agents. A salon that greets in Turkish and German
// runs one per language; a two-chair shop with two lines runs one per number.
// Nothing on the inbound path had to change for that: every webhook reader
// resolves through the `by_agent` index, and Retell's agent ids are globally
// unique, so how many rows an org owns was never a question those paths asked.
// Only this file's read/write surface assumed a single row.
//
// A CONNECTED AGENT IS A ROW. There is no hidden flag: an agent with no row
// cannot resolve an org, so it cannot route a call, so a row that exists and a
// row that is active are the same fact. Connecting and disconnecting is the
// show/hide. `enabled` is the softer control on top — keep the wiring, stop
// taking calls — which is what an owner wants when they close for a week.

const agentRow = v.object({
  _id: v.id("retellAgents"),
  retellAgentId: v.string(),
  // The cached provider name (schema: refreshed on every detail read). The
  // table renders it when the live roster is slow or failed — a row reading
  // "Unavailable agent" while the database knows "Bella Randevu Asistanı"
  // was the roster's transient outage presented as the agent's identity.
  name: v.optional(v.string()),
  inboundNumber: v.optional(v.string()),
  transferNumber: v.optional(v.string()),
  enabled: v.boolean(),
  connectedAt: v.number(),
});

export const list = query({
  args: {},
  returns: v.array(agentRow),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.map((a) => ({
      _id: a._id,
      retellAgentId: a.retellAgentId,
      name: a.name,
      inboundNumber: a.inboundNumber,
      transferNumber: a.transferNumber,
      enabled: a.enabled,
      connectedAt: a._creationTime,
    }));
  },
});

// Every mutation below takes a document id from the browser, so each one
// re-reads the row and checks its orgId. A caller can name any id they like;
// the id is not the authorization.
async function ownedAgent(ctx: MutationCtx, agentId: Id<"retellAgents">) {
  const { orgId } = await requireOwner(ctx);
  const row = await ctx.db.get(agentId);
  if (!row || row.orgId !== orgId) throw new Error("no-such-agent");
  return row;
}

export const connect = mutation({
  args: {
    retellAgentId: v.string(),
    inboundNumber: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  returns: v.id("retellAgents"),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const retellAgentId = args.retellAgentId.trim();
    if (!retellAgentId) throw new Error("agent-id-required");
    const name = args.name?.trim() || undefined;
    // Agent ids are globally unique at Retell, so one already claimed belongs
    // to somebody. Another org's is refused; this org's is a no-op re-add
    // rather than a duplicate row the webhook path would then find twice.
    const claimed = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (claimed) {
      if (claimed.orgId !== orgId) throw new Error("agent-already-connected");
      if (name && claimed.name !== name) await ctx.db.patch(claimed._id, { name });
      return claimed._id;
    }
    return await ctx.db.insert("retellAgents", {
      orgId,
      retellAgentId,
      name,
      inboundNumber: args.inboundNumber?.trim() || undefined,
      enabled: true,
    });
  },
});

// Cosmetic cache refresh: whichever action just fetched the provider's agent
// tells the row its current display name, so name-bearing surfaces stay
// truthful without their own provider round trip.
export const rememberAgentName = internalMutation({
  args: { retellAgentId: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { retellAgentId, name }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (agent && agent.name !== name) await ctx.db.patch(agent._id, { name });
    return null;
  },
});

export const disconnect = mutation({
  args: { agentId: v.id("retellAgents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ownedAgent(ctx, args.agentId);
    await ctx.db.delete(row._id);
    return null;
  },
});

// Which phone agents reference each customer field, by name. The Business
// fields card reads this so "used by Booking assistant" is visible where
// fields are managed — and deleting a field an agent still writes to stops
// being a silent break. Names come from the cached retellAgents.name; a row
// connected before that cache existed reads as its agent id tail.
export const fieldUsage = query({
  args: {},
  returns: v.record(v.string(), v.array(v.string())),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const [rows, agents] = await Promise.all([
      ctx.db
        .query("voiceAgentVariables")
        .withIndex("by_org_agent", (q) => q.eq("orgId", orgId))
        .collect(),
      ctx.db
        .query("retellAgents")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    ]);
    const nameOf = new Map(
      agents.map((agent) => [
        agent.retellAgentId,
        agent.name ?? `…${agent.retellAgentId.slice(-6)}`,
      ]),
    );
    const byField = new Map<string, Set<string>>();
    for (const row of rows) {
      for (const fieldId of [row.contactFieldId, row.beforeFieldId]) {
        if (!fieldId) continue;
        const key = String(fieldId);
        const names = byField.get(key) ?? new Set<string>();
        names.add(nameOf.get(row.retellAgentId) ?? `…${row.retellAgentId.slice(-6)}`);
        byField.set(key, names);
      }
    }
    return Object.fromEntries(
      [...byField.entries()].map(([key, names]) => [key, [...names].sort()]),
    );
  },
});

// Deliberately no inboundNumber here: the line is provider routing, not a
// note, so it only moves through retellAgent.assignLine, which rebinds it at
// Retell before the database adopts the change.
export const update = mutation({
  args: {
    agentId: v.id("retellAgents"),
    transferNumber: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ownedAgent(ctx, args.agentId);
    await ctx.db.patch(row._id, {
      transferNumber:
        args.transferNumber === undefined
          ? row.transferNumber
          : args.transferNumber.trim() || undefined,
      enabled: args.enabled ?? row.enabled,
    });
    return null;
  },
});

// Applied only after Retell accepted the routing change. One line answers as
// exactly one agent, so adopting a number clears it from every other row of
// the org in the same mutation.
export const applyLineAssignment = internalMutation({
  args: {
    retellAgentId: v.string(),
    number: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { retellAgentId, number }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent) return null;
    if (number) {
      const rows = await ctx.db
        .query("retellAgents")
        .withIndex("by_org", (q) => q.eq("orgId", agent.orgId))
        .collect();
      for (const row of rows) {
        if (row._id !== agent._id && row.inboundNumber === number) {
          await ctx.db.patch(row._id, { inboundNumber: undefined });
        }
      }
    }
    await ctx.db.patch(agent._id, { inboundNumber: number ?? undefined });
    return null;
  },
});

// Retell owns the routing, so our copy of it is a CACHE of a decision made
// somewhere else — and it drifts. Someone moves a line in Retell's own
// dashboard, or one key serves two orgs and the second one takes the number:
// either way our rows go on naming lines that no longer ring these agents,
// and the salon reads it as fact on four screens.
//
// So every clean read of the provider's numbers reconciles BOTH copies: the
// agentLines table (every line bound to one of this org's agents, inbound or
// outbound) and the legacy one-line inboundNumber cache (kept as "the
// agent's primary line" for the surfaces that show a single number). Only
// ever called with a numbers fetch that came back OK — reconciling from a
// failed or partial read would clear every line in the org and call it truth.
export const reconcileLines = internalMutation({
  args: {
    orgId: v.id("orgs"),
    bindings: v.array(
      v.object({
        number: v.string(),
        nickname: v.optional(v.string()),
        inboundAgentId: v.optional(v.string()),
        outboundAgentId: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, bindings }) => {
    const agents = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const ownAgentIds = new Set(agents.map((a) => a.retellAgentId));
    // A line belongs in the table only while one of THIS org's agents holds
    // it in either direction — the account may be shared across orgs.
    const ours = bindings.filter(
      (b) =>
        (b.inboundAgentId && ownAgentIds.has(b.inboundAgentId)) ||
        (b.outboundAgentId && ownAgentIds.has(b.outboundAgentId)),
    );
    const wanted = new Map(ours.map((b) => [b.number, b]));
    const existing = await ctx.db
      .query("agentLines")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    for (const row of existing) {
      const binding = wanted.get(row.number);
      if (!binding) {
        await ctx.db.delete(row._id);
        continue;
      }
      wanted.delete(row.number);
      // Patch only on a real change — same no-churn rule as the legacy cache
      // below: repainting the reactive lines query for agreement is noise.
      if (
        row.inboundAgentId !== binding.inboundAgentId ||
        row.outboundAgentId !== binding.outboundAgentId ||
        row.nickname !== binding.nickname
      ) {
        await ctx.db.patch(row._id, {
          nickname: binding.nickname,
          inboundAgentId: binding.inboundAgentId,
          outboundAgentId: binding.outboundAgentId,
        });
      }
    }
    for (const binding of wanted.values()) {
      await ctx.db.insert("agentLines", { orgId, ...binding });
    }

    // Legacy single-line cache: the agent's primary line is its first
    // inbound one, in the provider's listing order.
    const held = new Map<string, string>();
    for (const b of ours) {
      if (b.inboundAgentId && !held.has(b.inboundAgentId)) {
        held.set(b.inboundAgentId, b.number);
      }
    }
    for (const row of agents) {
      // undefined on both sides is agreement, not a change: patching every
      // unbound agent on every list would churn the reactive query and
      // repaint the whole section for nothing.
      const actual = held.get(row.retellAgentId);
      if ((row.inboundNumber ?? undefined) === actual) continue;
      await ctx.db.patch(row._id, { inboundNumber: actual });
    }
    return null;
  },
});

// The attach/detach twin of reconcileLines: one line changed at the provider,
// so one row changes here — without waiting for the next full roster read.
// Each direction updates independently, because the UI binds them
// independently: absent = leave that direction alone, null = unbind it, a
// string = bind it to that agent. A row with both directions unbound is
// deleted.
export const applyLineBinding = internalMutation({
  args: {
    orgId: v.id("orgs"),
    number: v.string(),
    nickname: v.optional(v.string()),
    inboundAgentId: v.optional(v.union(v.string(), v.null())),
    outboundAgentId: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentLines")
      .withIndex("by_number", (q) => q.eq("number", args.number))
      .collect();
    const row = rows.find((r) => r.orgId === args.orgId);
    const inbound =
      args.inboundAgentId === undefined
        ? row?.inboundAgentId
        : args.inboundAgentId ?? undefined;
    const outbound =
      args.outboundAgentId === undefined
        ? row?.outboundAgentId
        : args.outboundAgentId ?? undefined;
    if (!inbound && !outbound) {
      if (row) await ctx.db.delete(row._id);
    } else if (row) {
      await ctx.db.patch(row._id, {
        nickname: args.nickname ?? row.nickname,
        inboundAgentId: inbound,
        outboundAgentId: outbound,
      });
    } else {
      await ctx.db.insert("agentLines", {
        orgId: args.orgId,
        number: args.number,
        nickname: args.nickname,
        inboundAgentId: inbound,
        outboundAgentId: outbound,
      });
    }
    // Keep the legacy primary-line cache coherent for the agents this change
    // touched: an agent that lost its cached line falls back to another of
    // its lines; one that gained its first line adopts it.
    const org = await ctx.db
      .query("agentLines")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const agents = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    for (const agent of agents) {
      const lines = org.filter((l) => l.inboundAgentId === agent.retellAgentId);
      const stillHeld = lines.some((l) => l.number === agent.inboundNumber);
      const primary = stillHeld ? agent.inboundNumber : lines[0]?.number;
      if ((agent.inboundNumber ?? undefined) !== (primary ?? undefined)) {
        await ctx.db.patch(agent._id, { inboundNumber: primary });
      }
    }
    return null;
  },
});

// The org's lines as the app's reactive truth — what the agents table renders
// its number chips from. The provider remains the authority; these rows are
// the copy attach/detach and reconcileLines maintain.
export const orgLines = query({
  args: {},
  returns: v.array(
    v.object({
      number: v.string(),
      nickname: v.union(v.string(), v.null()),
      inboundAgentId: v.union(v.string(), v.null()),
      outboundAgentId: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("agentLines")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.map((r) => ({
      number: r.number,
      nickname: r.nickname ?? null,
      inboundAgentId: r.inboundAgentId ?? null,
      outboundAgentId: r.outboundAgentId ?? null,
    }));
  },
});

// The numbers this business has been GRANTED, for the number-request card to
// close its own loop with.
//
// orgLines is not the same question and cannot answer this: it reads
// agentLines, which only has a row once a number is BOUND to an agent. A line
// the operator has provisioned but the owner has not pointed at an agent yet
// is invisible there — and that gap is exactly the moment this card is trying
// to report, between "approved" and the owner wiring it up.
//
// Allowlist plus bound, same union orgNumberPolicy computes, so the card and
// the picker can never disagree about what the business has.
export const myNumbers = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    const allowed = org?.allowedPhoneNumbers ?? [];
    const bound = await ctx.db
      .query("agentLines")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return [...new Set([...allowed, ...bound.map((line) => line.number)])];
  },
});

// Per-agent call tallies for the details expansion. "Today" means the salon's
// today: a call at 23:50 Istanbul time should not survive into tomorrow's
// count because the server thinks in UTC. One org-wide pass — a salon's call
// history is bounded and this renders on one Phone agent section, not a hot
// path. Rows older than the retellAgentId stamp have no agent and count
// nowhere.
export const agentCallStats = query({
  args: {},
  returns: v.record(
    v.string(),
    v.object({
      today: v.number(),
      total: v.number(),
      lastAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    const tz = org?.timezone || "UTC";
    const now = Date.now();
    const local = getLocalPartsSafe(now, tz);
    const dayStart = localWallTimeToUtcMs(local.y, local.m0, local.d, 0, 0, tz);
    const rows = await ctx.db
      .query("calls")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const stats: Record<string, { today: number; total: number; lastAt: number | null }> =
      {};
    for (const row of rows) {
      if (!row.retellAgentId) continue;
      const s = (stats[row.retellAgentId] ??= { today: 0, total: 0, lastAt: null });
      s.total += 1;
      if (row.startedAt >= dayStart) s.today += 1;
      if (s.lastAt === null || row.startedAt > s.lastAt) s.lastAt = row.startedAt;
    }
    return stats;
  },
});

// ---- The live agent list ----

// Each client gets their own Retell account, so the roster is whatever THEIR
// key returns. Nothing is mirrored into our tables: Retell owns the agent, we
// own only which one this org has connected (retellAgents.retellAgentId).
// That is why the picker below is a live call and not a cached list — a stale
// cache here means the operator wires an agent that was renamed or deleted.

export const agentListContext = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      orgId: v.id("orgs"),
      demoMode: v.boolean(),
      apiKey: v.union(v.string(), v.null()),
      connectedAgentId: v.union(v.string(), v.null()),
      hiddenAgentIds: v.array(v.string()),
      agentSource: v.union(v.literal("randevu"), v.literal("account")),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    // collect(), never unique(): an org may connect many agents (see the file
    // header), and unique() here threw the moment a second one was connected —
    // taking listAgents and every retellAgent action down with it.
    const agents = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return {
      orgId,
      demoMode: org.demoMode === true,
      // Demo orgs hold no credentials by construction; resolve anyway so the
      // shape is uniform, and let the caller's demo check win first.
      apiKey: await connectionField(ctx, orgId, "retell", "apiKey"),
      // Legacy singular: the demo seed and error paths want one id to name.
      connectedAgentId: agents[0]?.retellAgentId ?? null,
      hiddenAgentIds: org.hiddenRetellAgentIds ?? [],
      // Unset reads as the narrow one. A workspace nobody has told us about is
      // assumed shared, because that assumption is only ever too cautious,
      // while the other one leaks.
      agentSource: org.voiceAgentSource ?? "randevu",
    };
  },
});

// ── Agent ownership tags ────────────────────────────────────────────────────
//
// One Retell workspace can serve several businesses on this deployment, and
// the connect picker used to offer every agent in it — including agents that
// already belong to somebody else. The fix is a marker saying "Resepta made
// this one, for that org", and the marker lives AT RETELL rather than in a
// column here: a row of ours dies when an agent is disconnected, and the fact
// has to outlive that, or reconnecting your own agent means being shown
// everyone else's again.
//
// Retell's tags are asymmetric — an array of strings when you write them, an
// object keyed by tag when you read them back from the list endpoint — so both
// shapes are handled here rather than at every call site.
export function orgAgentTag(orgId: Id<"orgs">): string {
  return `randevu:${orgId}`;
}

export function tagsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === "string");
  if (raw && typeof raw === "object") return Object.keys(raw as Record<string, unknown>);
  return [];
}

// Every org that has connected agents, with the key those agents live behind.
// Operator-only by construction: it takes no user and is reachable only from
// the backfill action below, which is itself CLI-only.
export const agentTagBackfillContext = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      orgId: v.id("orgs"),
      orgName: v.string(),
      apiKey: v.union(v.string(), v.null()),
      agentIds: v.array(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("retellAgents").collect();
    const byOrg = new Map<string, string[]>();
    for (const row of rows) {
      const key = String(row.orgId);
      byOrg.set(key, [...(byOrg.get(key) ?? []), row.retellAgentId]);
    }
    const out = [];
    for (const [orgKey, agentIds] of byOrg) {
      const orgId = orgKey as Id<"orgs">;
      const org = await ctx.db.get(orgId);
      if (!org) continue;
      out.push({
        orgId,
        orgName: org.name,
        apiKey: await connectionField(ctx, orgId, "retell", "apiKey"),
        agentIds,
      });
    }
    return out;
  },
});

// One-off, re-runnable, CLI-only:
//
//   npx convex run --prod retell:backfillAgentTags '{}'
//
// Stamps every already-connected agent with its org's tag so the picker can
// start filtering on ownership without the agents that predate tagging
// vanishing from it. Idempotent — an agent that already carries its tag is
// skipped, and existing tags (staging, prod, whatever the workspace uses) are
// merged rather than replaced. Nothing here disconnects, renames or reroutes
// anything; tags are the only field written.
export const backfillAgentTags = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, { dryRun }) => {
    const orgs = await ctx.runQuery(internal.retell.agentTagBackfillContext, {});
    const report: Array<Record<string, unknown>> = [];
    for (const org of orgs) {
      if (!org.apiKey) {
        report.push({ org: org.orgName, skipped: "no-retell-key", agents: org.agentIds.length });
        continue;
      }
      const headers = { authorization: `Bearer ${org.apiKey}` };
      const tag = orgAgentTag(org.orgId);
      // Tags come back on the LIST endpoint and not on get-agent, so the
      // current set is read here once per org rather than per agent.
      let current = new Map<string, string[]>();
      try {
        const res = await fetch("https://api.retellai.com/v2/list-agents", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ limit: 200 }),
        });
        if (res.ok) {
          const data = (await res.json()) as { items?: Array<{ agent_id?: string; tags?: unknown }> };
          current = new Map(
            (data.items ?? [])
              .filter((a) => a.agent_id)
              .map((a) => [a.agent_id!, tagsOf(a.tags)]),
          );
        }
      } catch {
        report.push({ org: org.orgName, skipped: "list-unreachable" });
        continue;
      }
      const tagged: string[] = [];
      const already: string[] = [];
      const failed: string[] = [];
      for (const agentId of org.agentIds) {
        const existing = current.get(agentId);
        if (existing === undefined) {
          // Connected here, absent from the workspace this key opens. Usually
          // the org's key was rotated to a different Retell account.
          failed.push(`${agentId} (not-in-workspace)`);
          continue;
        }
        if (existing.includes(tag)) {
          already.push(agentId);
          continue;
        }
        if (dryRun) {
          tagged.push(agentId);
          continue;
        }
        try {
          const res = await fetch(
            `https://api.retellai.com/update-agent/${encodeURIComponent(agentId)}`,
            {
              method: "PATCH",
              headers: { ...headers, "content-type": "application/json" },
              body: JSON.stringify({ tags: [...existing, tag] }),
            },
          );
          if (res.ok) tagged.push(agentId);
          else failed.push(`${agentId} (http-${res.status})`);
        } catch {
          failed.push(`${agentId} (unreachable)`);
        }
      }
      report.push({ org: org.orgName, tag, tagged, already, failed });
    }
    return { dryRun: dryRun === true, report };
  },
});

// One owner-scoped read for the agent editor. The Retell key never reaches the
// browser: actions use it server-side, while the client receives only the
// variable rows and the org's possible contact-field destinations.
// Everything the provider teardown needs about one org, read in one go: the
// key that authenticates the deletes, and every resource this deployment ever
// made at Retell for this business.
//
// Its own query rather than a reuse of agentEditorContext below, because that
// one is keyed by AGENT and refuses an org with none — and an org being
// deleted is exactly as likely to have a half-provisioned agent as a finished
// one. A teardown that throws on the messy cases is a teardown that leaves
// orphans in the account the operator is paying for.
export const orgVoiceResources = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.object({
    apiKey: v.union(v.string(), v.null()),
    demoMode: v.boolean(),
    agents: v.array(
      v.object({
        retellAgentId: v.string(),
        inboundNumber: v.union(v.string(), v.null()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    const rows = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    // Provisioning rows carry an agent id from the moment the provider made
    // one, which is BEFORE the retellAgents row exists. A run that died
    // between those two writes is the single most likely way to own an agent
    // nobody can see, so the teardown reads both and dedupes.
    const jobs = await ctx.db
      .query("voiceAgentProvisioning")
      .withIndex("by_org_updated", (q) => q.eq("orgId", args.orgId))
      .collect();
    const seen = new Map<string, string | null>();
    for (const row of rows) {
      seen.set(row.retellAgentId, row.inboundNumber ?? null);
    }
    for (const job of jobs) {
      if (!job.retellAgentId) continue;
      if (!seen.has(job.retellAgentId)) {
        seen.set(job.retellAgentId, job.inboundNumber ?? null);
      }
    }
    return {
      apiKey: await connectionField(ctx, args.orgId, "retell", "apiKey"),
      demoMode: org?.demoMode === true,
      agents: [...seen].map(([retellAgentId, inboundNumber]) => ({
        retellAgentId,
        inboundNumber,
      })),
    };
  },
});

export const agentEditorContext = internalQuery({
  args: {
    retellAgentId: v.string(),
    // Same rule as voiceProvisioning.begin: set only by a caller that has
    // already established the org — the connector, or an operator CLI run —
    // and unset by the signed-in path, which proves ownership right here.
    // Safe for the same reason: this is internal, no public action forwards a
    // caller-supplied orgId into it, and the agent-belongs-to-this-org check
    // below still runs either way.
    //
    // Provisioning is why this exists. The runtime wiring at the END of
    // creating an agent reads this context, so without it every non-UI
    // creation got a real provider agent and no Resepta runtime.
    orgId: v.optional(v.id("orgs")),
  },
  returns: v.any(),
  handler: async (ctx, { retellAgentId, orgId: providedOrgId }) => {
    const orgId = providedOrgId ?? (await requireOwner(ctx)).orgId;
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent || agent.orgId !== orgId) throw new Error("no-such-agent");
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");
    const [variables, fields] = await Promise.all([
      ctx.db
        .query("voiceAgentVariables")
        .withIndex("by_org_agent", (q) =>
          q.eq("orgId", orgId).eq("retellAgentId", retellAgentId),
        )
        .collect(),
      ctx.db
        .query("contactFields")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    ]);
    return {
      orgId,
      orgName: org.name,
      timezone: org.timezone,
      language: org.language,
      demoMode: org.demoMode === true,
      apiKey: await connectionField(ctx, orgId, "retell", "apiKey"),
      variables: variables.sort((a, b) => a.order - b.order),
      variablesSyncedAt: agent.variablesSyncedAt ?? null,
      variablesRetellVersion: agent.variablesRetellVersion ?? null,
      templateVersion: agent.templateVersion ?? null,
      personaName: agent.personaName ?? null,
      canEndCall: agent.canEndCall ?? true,
      llmModel: agent.llmModel ?? null,
      llmHighPriority: agent.llmHighPriority ?? null,
      platformVoiceModel: resolvePlatformVoiceModel(await platformValue(ctx, "voiceModel")),
      platformHighPriority: resolvePlatformHighPriority(
        await platformValue(ctx, "voiceHighPriority"),
      ),
      runtimeConnectedAt: agent.runtimeConnectedAt ?? null,
      inboundNumber: agent.inboundNumber ?? null,
      signatureRejectedAt: agent.signatureRejectedAt ?? null,
      fields: fields.sort((a, b) => a.order - b.order),
      // Which identity columns the agent may not write — deriveCaptureRows
      // reads this so a locked column is never offered as a question.
      voiceLockedIdentity: org.voiceLockedIdentity ?? [],
      voiceIdentityDescriptions: org.voiceIdentityDescriptions ?? {},
    };
  },
});

// Whether this org may use this line — for inbound routing or as an outbound
// caller id. Two independent reasons it may not, and they are deliberately
// separate:
//
//   1. The operator's per-tenant allowlist (orgs.allowedPhoneNumbers). Unset
//      reads as "not restricted yet", which is what keeps every existing org
//      working the day this deploys. Set it in /admin to make it authoritative.
//
//   2. Another org's agent already holds it. This runs whether or not a list
//      exists, because it is the actual theft rather than a policy: every
//      tenant shares one Retell account and therefore one phone-number
//      namespace (voiceProvisioning.stampDefaultRetellKey copies the platform
//      key onto each org), so a connector could otherwise name ANY number in
//      that namespace and rebind a stranger's line to its own agent — their
//      callers reaching the wrong agent, and those callers' names and emails
//      landing in the wrong customer table.
// Which numbers an org's pickers may OFFER — the read-side twin of
// lineUsable's write-side gate. Provisioned numbers (the /admin allowlist)
// plus anything the org already holds: a line the operator later removed from
// the list keeps rendering where it is bound, because hiding it would not
// unbind it, just make the binding invisible.
export const orgNumberPolicy = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.object({
    restricted: v.boolean(),
    visible: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return { restricted: true, visible: [] };
    const allowed = org.allowedPhoneNumbers ?? [];
    if (allowed.length === 0 && (org.voiceAgentSource ?? "randevu") === "account") {
      return { restricted: false, visible: [] };
    }
    const bound = await ctx.db
      .query("agentLines")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return {
      restricted: true,
      visible: [...new Set([...allowed, ...bound.map((line) => line.number)])],
    };
  },
});

export const lineUsable = internalQuery({
  args: { orgId: v.id("orgs"), number: v.string() },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const number = args.number.trim();
    // Unassigning is always allowed — it takes a line away, it cannot take one.
    if (!number) return { ok: true };
    const org = await ctx.db.get(args.orgId);
    if (!org) return { ok: false, reason: "no-org" };
    const allowed = org.allowedPhoneNumbers ?? [];
    if (allowed.length > 0 && !allowed.includes(number)) {
      return { ok: false, reason: "number-not-assigned-to-this-workspace" };
    }
    // An org on the platform's SHARED account starts with nothing: numbers
    // reach it when the operator provisions them in /admin
    // (setAllowedPhoneNumbers), not by grabbing from the pool. Empty used to
    // mean "unrestricted", which handed a fresh org the whole shared
    // account. An org on its OWN Retell account ("account") keeps empty =
    // unrestricted — those are its numbers, bought by it.
    if (allowed.length === 0 && (org.voiceAgentSource ?? "randevu") !== "account") {
      return { ok: false, reason: "number-not-assigned-to-this-workspace" };
    }
    // The multi-number table first: an org's second line, or one it holds
    // outbound-only, never reaches the legacy inboundNumber cache below, so
    // that scan alone would let another workspace's line be taken.
    const lines = await ctx.db
      .query("agentLines")
      .withIndex("by_number", (q) => q.eq("number", number))
      .collect();
    if (
      lines.some(
        (line) =>
          line.orgId !== args.orgId && (line.inboundAgentId || line.outboundAgentId),
      )
    ) {
      return { ok: false, reason: "number-held-by-another-workspace" };
    }
    // Scanned, not indexed: retellAgents holds one row per connected agent, so
    // a handful per org. Kept as the fallback for rows from before agentLines.
    const holder = (await ctx.db.query("retellAgents").collect()).find(
      (row) => row.inboundNumber === number && row.orgId !== args.orgId,
    );
    if (holder) return { ok: false, reason: "number-held-by-another-workspace" };
    return { ok: true };
  },
});

// Provider publication happens before this mutation. If Retell rejects the
// draft, the Resepta registry stays untouched and the editor can retry without
// presenting a configuration that never went live.
export const replaceAgentVariables = internalMutation({
  args: {
    retellAgentId: v.string(),
    retellVersion: v.optional(v.number()),
    variables: v.array(voiceVariableInput),
  },
  returns: v.null(),
  handler: async (ctx, { retellAgentId, retellVersion, variables }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent) throw new Error("no-such-agent");
    const fields = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", agent.orgId))
      .collect();
    const fieldIds = new Set(fields.map((field) => String(field._id)));
    const existing = await ctx.db
      .query("voiceAgentVariables")
      .withIndex("by_org_agent", (q) =>
        q.eq("orgId", agent.orgId).eq("retellAgentId", retellAgentId),
      )
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const now = Date.now();
    for (const [order, variable] of variables.entries()) {
      if (variable.beforeFieldId && !fieldIds.has(String(variable.beforeFieldId))) {
        throw new Error("before-field-not-found");
      }
      if (variable.contactFieldId && !fieldIds.has(String(variable.contactFieldId))) {
        throw new Error("contact-field-not-found");
      }
      await ctx.db.insert("voiceAgentVariables", {
        orgId: agent.orgId,
        retellAgentId,
        ...variable,
        choices: variable.type === "enum" ? variable.choices : undefined,
        beforeValue:
          variable.beforeSource === "static" ? variable.beforeValue : undefined,
        beforeFieldId:
          variable.beforeSource === "contact_field" ? variable.beforeFieldId : undefined,
        contactFieldId:
          variable.destination === "contact" ? variable.contactFieldId : undefined,
        customerField:
          variable.destination === "customer" ? variable.customerField : undefined,
        order,
        updatedAt: now,
      });
    }
    await ctx.db.patch(agent._id, {
      variablesSyncedAt: now,
      variablesRetellVersion: retellVersion,
    });
    return null;
  },
});

// The inbound call webhook has no signed-in user. Tenant resolution therefore
// starts from the Retell agent id, exactly like the function and call-ended
// webhooks, and every subsequent read stays on that org.
// Who answers on this line. The inbound webhook used to trust call_inbound's
// agent_id alone — but a number bound through Retell's newer weighted
// inbound_agents array sends that field EMPTY (observed live, 18 Aug 2026:
// top-level inbound_agent_id null, only the array set). The handler answered
// "unknown agent", Retell connected the call to the bound agent anyway, and
// the agent ran with zero dynamic variables: no {{now}} — it resolved
// "yarın" to a 2025 date and every booking failed as start-is-in-the-past —
// no customer recognition, no business name. This resolver is the fallback:
// the dialled number names the agent when the payload does not.
export const agentForInboundNumber = internalQuery({
  args: { number: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { number }) => {
    const phone = normalisePhone(number);
    if (!phone) return null;
    // The lines table first — it knows every number an agent holds, not just
    // the primary one the legacy cache remembers. first(), not unique(): this
    // path must never throw at Retell, and a double-assigned line is a data
    // problem to surface elsewhere, not a reason to answer a ring with a 500.
    const lines = await ctx.db
      .query("agentLines")
      .withIndex("by_number", (q) => q.eq("number", phone))
      .collect();
    const bound = lines.find((line) => line.inboundAgentId);
    if (bound?.inboundAgentId) return bound.inboundAgentId;
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_inbound_number", (q) => q.eq("inboundNumber", phone))
      .first();
    return agent?.retellAgentId ?? null;
  },
});

export const beforeCallContext = internalQuery({
  args: { retellAgentId: v.string(), phone: v.string() },
  returns: v.any(),
  handler: async (ctx, { retellAgentId, phone }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent || !agent.enabled) return null;
    const org = await ctx.db.get(agent.orgId);
    if (!org) return null;
    // Suspension (schema: orgs.status) "stops SPEND and OUTBOUND at the send
    // chokepoints", and a ring the platform pays Retell for is spend. Ten
    // message and provisioning lanes each carry a copy of this check; the voice
    // lane, the largest bill in the product, carried none — so a suspended org
    // kept answering, kept booking through voiceBook, and kept drawing its
    // wallet down in meterCall, while the confirmation WhatsApp for that
    // booking was refused by wa.ts. Booked and never told is the worst of the
    // available outcomes.
    //
    // Ring time only, like the wallet check below, and deliberately NOT in
    // loadVoiceContext: suspending mid-call would fail the agent's tool calls
    // halfway through a conversation with a real customer on the line. One
    // call finishing is the same bounded overdraft the wallet already accepts.
    if ((org.status ?? "active") === "suspended") return null;
    // Prepaid enforcement (schema: orgs.billingMode): resolving null means
    // the inbound webhook answers without an agent override and Retell
    // declines the ring, so an empty wallet sounds like a busy line, never
    // an agent that answers and cannot help. Ring time only — a call
    // already in progress is never touched, which bounds the overdraft at
    // one call. Topping up needs no re-enable step: the next ring reads the
    // balance again.
    if (org.billingMode === "prepaid" && (org.walletBalanceMicroUsd ?? 0) <= 0)
      return null;
    // The org's dial code, because the trunk delivers national-format caller
    // IDs (05386906897, live 18 Aug 2026) — without it the regular calling
    // their own salon greeted as a stranger.
    const normalised = normalisePhone(phone, dialCodeForTimezone(org.timezone));
    const customer = normalised
      ? await ctx.db
          .query("customers")
          .withIndex("by_org_phone", (q) =>
            q.eq("orgId", agent.orgId).eq("phone", normalised),
          )
          .unique()
      : null;
    const [variables, fields, appointments, services, staffRows, knowledgeRows] = await Promise.all([
      ctx.db
        .query("voiceAgentVariables")
        .withIndex("by_org_agent", (q) =>
          q.eq("orgId", agent.orgId).eq("retellAgentId", retellAgentId),
        )
        .collect(),
      ctx.db
        .query("contactFields")
        .withIndex("by_org", (q) => q.eq("orgId", agent.orgId))
        .collect(),
      customer
        ? ctx.db
            .query("appointments")
            .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
            .collect()
        : Promise.resolve([]),
      ctx.db
        .query("services")
        .withIndex("by_org", (q) => q.eq("orgId", agent.orgId))
        .collect(),
      ctx.db
        .query("staff")
        .withIndex("by_org", (q) => q.eq("orgId", agent.orgId))
        .collect(),
      ctx.db
        .query("knowledge")
        .withIndex("by_org", (q) => q.eq("orgId", agent.orgId))
        .collect(),
    ]);
    const next = nextUpcomingOf(appointments, Date.now(), ["scheduled", "confirmed"]);
    const fieldsById = new Map(fields.map((field) => [String(field._id), field]));
    const dynamicVariables: Record<string, string> = {};
    for (const variable of variables.sort((a, b) => a.order - b.order)) {
      let value = "";
      switch (variable.beforeSource) {
        case "static":
          value = variable.beforeValue ?? "";
          break;
        case "business_name":
          value = org.name;
          break;
        case "customer_name":
          value = customer
            ? [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim()
            : "";
          break;
        case "customer_first_name":
          value = customer?.firstName ?? "";
          break;
        case "customer_last_name":
          value = customer?.lastName ?? "";
          break;
        case "customer_phone":
          value = customer?.phone ?? normalised ?? "";
          break;
        case "customer_email":
          value = customer?.email ?? "";
          break;
        case "customer_language":
          value = customer?.language ?? org.language;
          break;
        case "next_appointment":
          value = next
            ? spokenDateTime(next.startAt, org.timezone, customer?.language ?? org.language)
            : "";
          break;
        case "contact_field": {
          const field = variable.beforeFieldId
            ? fieldsById.get(String(variable.beforeFieldId))
            : null;
          value = field && customer ? customer.custom?.[field.key] ?? "" : "";
          break;
        }
      }
      if (value) dynamicVariables[variable.key] = String(value);
    }
    // Well-known context every agent may reference without configuring a
    // registry row first — the @ picker offers these as built-ins, so the
    // injection must not depend on the owner having added them. A registry
    // row with the same key is deliberate configuration and wins.
    //
    // Everything the agent needs BEFORE it can be useful, handed over while the
    // phone is still ringing.
    //
    // This list grew on purpose. get_call_context used to supply the local
    // time, the roster and the collectable fields, which meant the first thing
    // every conversation did was stop for a tool call: two LLM round trips and
    // an HTTP hop, in silence, at the exact moment the caller has just said
    // what they want. Measured on a real call, that is where "neyi
    // bekliyorsun?" landed.
    //
    // None of it was worth waiting for. The roster and the field list are
    // static, the business is static, the caller is resolved from the number
    // that is ringing, and the clock is knowable here. So it arrives up front
    // and the tool becomes what it should always have been — a way to
    // re-check something mid-call, not a toll on the first sentence.
    const builtins = builtinAgentVariables({
      style: "spoken",
      org,
      personaName: agent.personaName ?? "",
      customer,
      fallbackPhone: normalised ?? undefined,
      nextAppointmentAt: next ? next.startAt : null,
      staffRows,
      services,
      knowledgeRows,
      contactFields: fields,
    });
    for (const [key, value] of Object.entries(builtins)) {
      if (!(key in dynamicVariables)) dynamicVariables[key] = value;
    }
    return {
      apiKey: await connectionField(ctx, agent.orgId, "retell", "apiKey"),
      dynamicVariables,
      signatureRejected: agent.signatureRejectedAt !== undefined,
    };
  },
});

// Explicit, because listAgents' handler calls a query in this same file and
// Convex's generated `internal` type is derived from these exports — without an
// annotation the inference is circular and the WHOLE api type degrades to any,
// which shows up as implicit-any errors in unrelated components.
type AgentListResult = {
  configured: boolean;
  error: string | null;
  connectedAgentId: string | null;
  agents: {
    id: string;
    name: string;
    languages: string[];
    collects: string[];
    webhookUrl: string | null;
    // Carries this org's tag at Retell — i.e. Resepta made it for this
    // business. Reported rather than filtered on here, so a connected agent
    // that predates tagging keeps its details (and its webhook health check)
    // while the PICKER is the only thing ownership narrows.
    ownedHere: boolean;
  }[];
  agentSource: "randevu" | "account";
  phoneNumbers: {
    number: string;
    nickname: string;
    // Per-direction holders, because an agent may hold several lines and a
    // line's two directions may belong to different agents. agentId remains
    // as "whoever holds it in any direction" for the picker's taken-check.
    inboundAgentId: string | null;
    outboundAgentId: string | null;
    agentId: string | null;
  }[];
  voices: {
    id: string;
    name: string;
    gender: string;
    accent: string;
    previewUrl: string | null;
  }[];
  hiddenAgentIds: string[];
};

const DEMO_AGENTS = [
  {
    id: "agent_demo_reception",
    name: "Salon reception",
    languages: ["tr-TR"],
    collects: ["customer_name", "service", "preferred_time"],
    webhookUrl: null,
    ownedHere: true,
  },
];

// Never throws on a provider failure. This renders inside a salon's own Phone
// agent view, and a red banner is not what an owner should get because a key was
// rotated — `error` carries the reason so the surface can say which of "not
// set up yet", "key rejected" and "Retell is down" it is looking at.
export const listAgents = action({
  args: {},
  returns: v.object({
    configured: v.boolean(),
    error: v.union(v.string(), v.null()),
    connectedAgentId: v.union(v.string(), v.null()),
    agents: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        languages: v.array(v.string()),
        collects: v.array(v.string()),
        webhookUrl: v.union(v.string(), v.null()),
        ownedHere: v.boolean(),
      }),
    ),
    agentSource: v.union(v.literal("randevu"), v.literal("account")),
    // Convex validates RETURNS as strictly as arguments: when the handler
    // grew per-direction holder fields, this validator not naming them made
    // EVERY roster call throw on return — one-option pickers, a disabled
    // Add agent, and the "Unavailable agent" rows of 18 Aug 2026, all one
    // missing pair of lines. TypeScript cannot catch it (extra properties
    // pass structural assignment), so when the result type changes, change
    // this with it.
    phoneNumbers: v.array(
      v.object({
        number: v.string(),
        nickname: v.string(),
        inboundAgentId: v.union(v.string(), v.null()),
        outboundAgentId: v.union(v.string(), v.null()),
        agentId: v.union(v.string(), v.null()),
      }),
    ),
    voices: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        gender: v.string(),
        accent: v.string(),
        previewUrl: v.union(v.string(), v.null()),
      }),
    ),
    hiddenAgentIds: v.array(v.string()),
  }),
  handler: async (ctx): Promise<AgentListResult> => {
    const context = await ctx.runQuery(internal.retell.agentListContext, {});
    if (!context) return empty("no-org");

    // demoMode is checked BEFORE credentials, matching every send path in this
    // codebase: the showroom org shares a deployment with real salons, so the
    // guard that keeps it off a provider has to sit in front of the code that
    // reaches one, not behind it.
    if (context.demoMode) {
      return {
        configured: true,
        error: null,
        connectedAgentId: context.connectedAgentId ?? DEMO_AGENTS[0].id,
        // The demo agent reads as wired: the showroom exists to look healthy,
        // and an amber "results not arriving" dot on a fake agent would be
        // a defect tour, not a demo.
        agents: DEMO_AGENTS.map((a) => ({
          ...a,
          webhookUrl: process.env.CONVEX_SITE_URL
            ? `${process.env.CONVEX_SITE_URL}/retell/call-ended`
            : null,
        })),
        phoneNumbers: [
          {
            number: "+902121112233",
            nickname: "Salon line",
            inboundAgentId: DEMO_AGENTS[0].id,
            outboundAgentId: DEMO_AGENTS[0].id,
            agentId: DEMO_AGENTS[0].id,
          },
        ],
        voices: [],
        hiddenAgentIds: [],
        agentSource: "randevu",
      };
    }

    // No row means this org was never provisioned. It does NOT mean "fall back
    // to a deployment-wide key" — see lib/connections.ts for why that fallback
    // would be a cross-org leak here even though Nudge relies on it.
    if (!context.apiKey) return empty(null, context.connectedAgentId);

    const headers = { authorization: `Bearer ${context.apiKey}` };
    let aRes: Response;
    let nRes: Response;
    let vRes: Response | null = null;
    try {
      [aRes, nRes, vRes] = await Promise.all([
        // POST /v2/list-agents, because GET /list-agents is deprecated and
        // Retell now emails the account about every call to it.
        //
        // The new endpoint lists UNIQUE agents, so the is_latest=true trick
        // that stopped the picker showing the same agent once per version is
        // no longer needed — the dedupe below stays as belt and braces.
        //
        // What it does NOT return is language, webhook_url or the post-call
        // fields, all of which the picker shows. Those come from get-agent per
        // row, below. One request became one plus N, which is the price of the
        // migration; this is a settings screen opened by hand, not a send path.
        fetch("https://api.retellai.com/v2/list-agents", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            limit: 200,
            filter_criteria: {
              channel: { type: "string", op: "eq", value: "voice" },
            },
          }),
        }),
        fetch("https://api.retellai.com/v2/list-phone-numbers", { headers }),
        // Voice names and previews are customer-facing, but provider names are
        // intentionally discarded below. A voice-list outage must not take
        // down the existing-agent connect flow.
        fetch("https://api.retellai.com/list-voices", { headers }).catch(() => null),
      ]);
    } catch {
      return empty("unreachable", context.connectedAgentId);
    }
    if (aRes.status === 401 || nRes.status === 401)
      return empty("unauthorized", context.connectedAgentId);
    if (!aRes.ok) return empty(`list-agents-http-${aRes.status}`, context.connectedAgentId);
    if (!nRes.ok) return empty(`list-numbers-http-${nRes.status}`, context.connectedAgentId);

    const aData: unknown = await aRes.json();
    const nData: unknown = await nRes.json();
    const vData: unknown = vRes?.ok ? await vRes.json() : [];
    const agentItems = (
      Array.isArray(aData) ? aData : (aData as { items?: unknown[] })?.items ?? []
    ) as Array<{
      agent_id?: string;
      agent_name?: string;
      tags?: unknown;
    }>;
    const numItems = (
      Array.isArray(nData) ? nData : (nData as { items?: unknown[] })?.items ?? []
    ) as Array<{
      phone_number?: string;
      nickname?: string;
      inbound_agent_id?: string;
      inbound_agents?: Array<{ agent_id?: string }>;
      outbound_agents?: Array<{ agent_id?: string }>;
    }>;
    const seen = new Set<string>();
    const listed: { id: string; name: string; ownedHere: boolean }[] = [];
    for (const a of agentItems) {
      if (!a.agent_id || seen.has(a.agent_id)) continue;
      seen.add(a.agent_id);
      listed.push({
        id: a.agent_id,
        name: a.agent_name?.trim() || a.agent_id,
        ownedHere: tagsOf(a.tags).includes(orgAgentTag(context.orgId)),
      });
    }
    // The three things the picker shows that the list endpoint stopped
    // carrying. Fetched per agent and in parallel, and a row whose detail call
    // fails still appears — with a name and nothing else — because an agent you
    // cannot see is worse than an agent you cannot describe.
    const details = await Promise.all(
      listed.map(async (row) => {
        try {
          const res = await fetch(
            `https://api.retellai.com/get-agent/${encodeURIComponent(row.id)}`,
            { headers },
          );
          if (!res.ok) return null;
          return (await res.json()) as {
            language?: string | string[];
            webhook_url?: string;
            post_call_analysis_data?: Array<{ name?: string; type?: string }>;
          };
        } catch {
          return null;
        }
      }),
    );
    const agents: AgentListResult["agents"] = listed.map((row, i) => {
      const d = details[i];
      return {
        id: row.id,
        name: row.name,
        languages: Array.isArray(d?.language)
          ? d.language
          : d?.language
            ? [d.language]
            : [],
        // What the agent captures on a call. Retell's system presets
        // (call_summary and friends) arrive elsewhere in the payload and are
        // not things the salon configured, so they are not "what it collects".
        collects: (d?.post_call_analysis_data ?? [])
          .filter((f) => f.name && f.type !== "system-presets")
          .map((f) => f.name!),
        webhookUrl: d?.webhook_url?.trim() || null,
        ownedHere: row.ownedHere,
      };
    });

    const phoneNumbers = numItems
      .filter((n) => n.phone_number)
      .map((n) => ({
        number: n.phone_number!,
        nickname: n.nickname?.trim() || n.phone_number!,
        inboundAgentId:
          n.inbound_agent_id ?? n.inbound_agents?.[0]?.agent_id ?? null,
        outboundAgentId: n.outbound_agents?.[0]?.agent_id ?? null,
        agentId:
          n.inbound_agent_id ??
          n.inbound_agents?.[0]?.agent_id ??
          n.outbound_agents?.[0]?.agent_id ??
          null,
      }));

    const voices = voiceCatalogue(vData);

    // The one place in the app that reads every number and every agent in the
    // same breath, so it is the place that puts our copy back in agreement.
    await ctx.runMutation(internal.retell.reconcileLines, {
      orgId: context.orgId,
      bindings: phoneNumbers.map((n) => ({
        number: n.number,
        nickname: n.nickname,
        inboundAgentId: n.inboundAgentId ?? undefined,
        outboundAgentId: n.outboundAgentId ?? undefined,
      })),
    });

    // Reconcile saw every number (it needs the whole account to know the
    // bindings); the CLIENT sees only what this org may use. Read after the
    // reconcile on purpose, so a line the org holds is visible through the
    // just-refreshed table even if the operator's list no longer names it.
    const policy = await ctx.runQuery(internal.retell.orgNumberPolicy, {
      orgId: context.orgId,
    });
    const visible = new Set(policy.visible);

    return {
      configured: true,
      error: null,
      connectedAgentId: context.connectedAgentId,
      agents,
      phoneNumbers: policy.restricted
        ? phoneNumbers.filter((n) => visible.has(n.number))
        : phoneNumbers,
      voices,
      hiddenAgentIds: context.hiddenAgentIds,
      agentSource: context.agentSource,
    };
  },
});

// Archive is OUR bookkeeping, not Retell's: the agent keeps existing and
// keeps taking calls if wired; it just stops cluttering the connect picker.
export const setAgentArchived = mutation({
  args: { retellAgentId: v.string(), archived: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { retellAgentId, archived }) => {
    const { orgId } = await requireOwner(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("no-org");
    const current = org.hiddenRetellAgentIds ?? [];
    const next = archived
      ? [...new Set([...current, retellAgentId])]
      : current.filter((id) => id !== retellAgentId);
    await ctx.db.patch(orgId, { hiddenRetellAgentIds: next });
    return null;
  },
});

function empty(
  error: string | null,
  connectedAgentId: string | null = null,
): AgentListResult {
  return {
    configured: false,
    error,
    connectedAgentId,
    agents: [],
    phoneNumbers: [],
    voices: [],
    hiddenAgentIds: [],
    agentSource: "randevu",
  };
}

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

// Authentication lookup for provider-originated HTTP requests. Parsing the
// signed body tells us the agent id; the agent id tells us which org-owned key
// must verify it. A deployment-wide fallback would let one client's key sign
// traffic into another client's workspace.
export const webhookAuthContext = internalQuery({
  args: { retellAgentId: v.string() },
  returns: v.union(
    v.object({
      orgId: v.id("orgs"),
      apiKey: v.union(v.string(), v.null()),
      // So the caller can skip the clearing write on the happy path, which is
      // every webhook of every healthy agent.
      signatureRejected: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { retellAgentId }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent) return null;
    return {
      orgId: agent.orgId,
      apiKey: await connectionField(ctx, agent.orgId, "retell", "apiKey"),
      signatureRejected: agent.signatureRejectedAt !== undefined,
    };
  },
});

// Agent ids are not secret — they sit in the dashboard URL an owner can paste
// into a chat — so this runs for anyone who can post a malformed body to a
// public route. Hence the window: a stamp already younger than this says the
// same thing the write would, and a caller hammering the endpoint gets one
// write a minute rather than one per request.
const SIGNATURE_REJECTION_WINDOW_MS = 60_000;

export const recordSignatureRejection = internalMutation({
  args: { retellAgentId: v.string(), route: v.string() },
  returns: v.null(),
  handler: async (ctx, { retellAgentId, route }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent) return null;
    const now = Date.now();
    if (
      agent.signatureRejectedAt !== undefined &&
      now - agent.signatureRejectedAt < SIGNATURE_REJECTION_WINDOW_MS
    ) {
      return null;
    }
    await ctx.db.patch(agent._id, {
      signatureRejectedAt: now,
      signatureRejectedRoute: route,
    });
    return null;
  },
});

export const clearSignatureRejection = internalMutation({
  args: { retellAgentId: v.string() },
  returns: v.null(),
  handler: async (ctx, { retellAgentId }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent || agent.signatureRejectedAt === undefined) return null;
    await ctx.db.patch(agent._id, {
      signatureRejectedAt: undefined,
      signatureRejectedRoute: undefined,
    });
    return null;
  },
});

export const setRuntimeToken = internalMutation({
  args: { retellAgentId: v.string(), tokenHash: v.string() },
  returns: v.null(),
  handler: async (ctx, { retellAgentId, tokenHash }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent) throw new Error("no-such-agent");
    await ctx.db.patch(agent._id, {
      runtimeTokenHash: tokenHash,
      // One generation back stays valid. This hash is committed before the
      // publish chain that DELIVERS the new token to Retell, so a 429 halfway
      // through would otherwise leave the provider holding a token we no longer
      // recognise — 401 on every save_customer_details, on every call, silently.
      // Not carried when the hash has not actually changed, so a no-op
      // republish cannot resurrect a generation we already retired.
      ...(agent.runtimeTokenHash && agent.runtimeTokenHash !== tokenHash
        ? { runtimeTokenHashPrevious: agent.runtimeTokenHash }
        : {}),
      // The provider must be able to authenticate while it discovers the
      // tools, but this is not "connected" until its draft publishes.
      runtimeConnectedAt: undefined,
    });
    return null;
  },
});

export const markRuntimeConnected = internalMutation({
  args: { retellAgentId: v.string() },
  returns: v.null(),
  handler: async (ctx, { retellAgentId }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent) throw new Error("no-such-agent");
    await ctx.db.patch(agent._id, { runtimeConnectedAt: Date.now() });
    return null;
  },
});

// The prompt mirror (schema: retellAgents.generalPrompt) — called by every
// path that just sent prompt text to the provider, AFTER the publish
// succeeded, so the mirror can claim nothing the live agent does not say.
// Tolerant of a missing row rather than throwing: the publish already
// happened, and failing here would report a successful publish as an error.
export const stampPromptMirror = internalMutation({
  args: {
    retellAgentId: v.string(),
    generalPrompt: v.string(),
    promptVersion: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { retellAgentId, generalPrompt, promptVersion }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent) return null;
    await ctx.db.patch(agent._id, {
      generalPrompt,
      promptVersion: promptVersion ?? undefined,
      promptMirroredAt: Date.now(),
    });
    return null;
  },
});

// The caller-facing name, owned by Resepta and read at ring time. A plain
// mutation, not an action: nothing about it lives at the provider, so naming
// her costs no draft, no publish and no provider round trip, and takes effect
// on the very next call.
// Stores the flag only. The tool is added or removed at the provider by
// retellAgent.setEndCallEnabled, which calls this once the publish succeeds —
// same order as every other provider-backed setting here, so a row never
// claims a capability the agent does not have.
export const markEndCallEnabled = internalMutation({
  args: { retellAgentId: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { retellAgentId, enabled }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent) throw new Error("no-such-agent");
    await ctx.db.patch(agent._id, { canEndCall: enabled });
    return null;
  },
});

// Stores the operator's model override only. Same contract as
// markEndCallEnabled above: the model itself changes at the provider first
// (platform.setAgentModel publishes it), and this stamp lands afterwards so
// the row never claims a model the agent is not running. Null clears the
// override — the agent is back on the platform default.
export const markLlmModel = internalMutation({
  args: { retellAgentId: v.string(), model: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { retellAgentId, model }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent) throw new Error("no-such-agent");
    await ctx.db.patch(agent._id, { llmModel: model ?? undefined });
    return null;
  },
});

// Stores the operator's fast-tier override only — the tier itself changes at
// the provider first (platform.setAgentHighPriority publishes it), and this
// stamp lands afterwards. Same contract as markLlmModel above, and null
// clears the override back to the fleet default.
export const markLlmHighPriority = internalMutation({
  args: { retellAgentId: v.string(), highPriority: v.union(v.boolean(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { retellAgentId, highPriority }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent) throw new Error("no-such-agent");
    await ctx.db.patch(agent._id, { llmHighPriority: highPriority ?? undefined });
    return null;
  },
});

export const setAgentPersona = mutation({
  args: { retellAgentId: v.string(), personaName: v.string() },
  returns: v.null(),
  handler: async (ctx, { retellAgentId, personaName }) => {
    const { orgId } = await requireOwner(ctx);
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent || agent.orgId !== orgId) throw new Error("no-such-agent");
    const trimmed = personaName.trim().slice(0, 40);
    await ctx.db.patch(agent._id, {
      // Cleared rather than stored blank, so "has a name" is one check
      // everywhere instead of two.
      personaName: trimmed || undefined,
    });
    return null;
  },
});

// Stamped only after the provider publish succeeds, mirroring the
// variablesSyncedAt rule: a version this row claims is a version that is
// actually live at Retell, so a sync that dies mid-flight keeps offering
// the update instead of pretending it landed.
export const markTemplateSynced = internalMutation({
  args: { retellAgentId: v.string(), templateVersion: v.number() },
  returns: v.null(),
  handler: async (ctx, { retellAgentId, templateVersion }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent) throw new Error("no-such-agent");
    await ctx.db.patch(agent._id, { templateVersion });
    return null;
  },
});

export const verifyRuntimeToken = internalQuery({
  args: { retellAgentId: v.string(), tokenHash: v.string() },
  returns: v.union(
    v.object({ orgId: v.id("orgs"), retellAgentId: v.string() }),
    v.null(),
  ),
  handler: async (ctx, { retellAgentId, tokenHash }) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    if (!agent || !agent.enabled) return null;
    // Either generation. See schema.retellAgents.runtimeTokenHashPrevious: the
    // new hash is stored before the publish that hands Retell the matching
    // token, so accepting only the current one turned any mid-publish provider
    // error into a permanently 401ing agent.
    const known =
      agent.runtimeTokenHash === tokenHash ||
      agent.runtimeTokenHashPrevious === tokenHash;
    if (!known) return null;
    return { orgId: agent.orgId, retellAgentId };
  },
});

export const runtimeCallContext = internalQuery({
  args: {
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    phone: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent || !agent.enabled || agent.orgId !== args.orgId) {
      throw new Error("agent-not-available");
    }
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("business-not-found");
    const phone = toE164(args.phone);
    const customer = phone
      ? await ctx.db
          .query("customers")
          .withIndex("by_org_phone", (q) => q.eq("orgId", args.orgId).eq("phone", phone))
          .unique()
      : null;
    // The services table is deliberately NOT read here any more. Nothing in
    // the response needs it, and this query runs while a caller is holding.
    const [variables, fields, staffRows] = await Promise.all([
      ctx.db
        .query("voiceAgentVariables")
        .withIndex("by_org_agent", (q) =>
          q.eq("orgId", args.orgId).eq("retellAgentId", args.retellAgentId),
        )
        .collect(),
      ctx.db.query("contactFields").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect(),
      ctx.db.query("staff").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect(),
    ]);
    const fieldsById = new Map(fields.map((field) => [String(field._id), field]));
    // What "tomorrow at 5" means. The agent was given a timezone and nothing
    // to apply it to, so a caller saying "tomorrow" had to be talked into
    // reciting a full calendar date before book_appointment could be handed
    // one — the model has no reliable clock of its own and book_appointment
    // takes an absolute time.
    const nowMs = Date.now();
    const parts = getLocalPartsSafe(nowMs, org.timezone);
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      business: {
        name: org.name,
        timezone: org.timezone,
        language: org.language,
      },
      now: {
        date: `${parts.y}-${pad(parts.m0 + 1)}-${pad(parts.d)}`,
        time: `${pad(parts.hour)}:${pad(parts.minutesOfDay % 60)}`,
        timezone: org.timezone,
        spoken: spokenDateTime(nowMs, org.timezone, org.language),
        // Terse on purpose: this note rides along in every later turn, and the
        // prompt already carries the same rule once.
        note: "Business local time now. Resolve relative times against this.",
      },
      caller: customer
        ? {
            known: true,
            name: [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim(),
            phone: customer.phone,
            language: customer.language ?? org.language,
          }
        : { known: false, phone: phone ?? args.phone },
      // Both destinations that end up on the customer. A row the agent is
      // never told about is a row it never collects, so "customer" has to be
      // here or the name goes on being asked for and dropped.
      information: variables
        .sort((a, b) => a.order - b.order)
        .filter(
          (variable) =>
            variable.destination === "contact" || variable.destination === "customer",
        )
        // A LOCKED field never reaches the agent — not its definition and not
        // this caller's value. The lock (contactFields.source) started life as
        // a write permission, and a read the agent could still perform meant
        // "the agent may not change your address" quietly also meant "but it
        // will happily read it back to whoever is on the phone".
        //
        // Withheld rather than marked. An instruction not to say something the
        // model is holding is a request, and the model is talking to a caller
        // who can ask the same question four different ways. Data that never
        // arrives cannot be talked out of it.
        //
        // Built-ins (first name, last name, email) carry no contact field and
        // are not lockable: they are how the agent addresses the person and
        // where the confirmation goes.
        .filter((variable) => {
          if (!variable.contactFieldId) return true;
          const field = fieldsById.get(String(variable.contactFieldId));
          return !field || field.source === "voice";
        })
        .map((variable) => {
          const field = variable.contactFieldId
            ? fieldsById.get(String(variable.contactFieldId))
            : null;
          const builtIn =
            variable.destination === "customer" && customer
              ? variable.customerField === "email"
                ? customer.email ?? null
                : variable.customerField === "lastName"
                  ? customer.lastName ?? null
                  : customer.firstName || null
              : null;
          return {
            key: variable.key,
            label: variable.label,
            description: variable.description,
            type: variable.type,
            choices: variable.choices ?? [],
            required: variable.required,
            collect:
              variable.duringMode === "confirm"
                ? "confirm explicitly"
                : variable.duringMode === "if_missing"
                  ? "ask when missing"
                  : "do not ask",
            currentValue: field && customer ? customer.custom?.[field.key] ?? null : builtIn,
          };
        }),
      // Who works here. The agent has never been told, so a caller asking for
      // a person by name — the most ordinary request a salon takes — got an
      // agent that could not confirm the name exists, and book_appointment
      // still takes no staff argument, so it books the shop rather than the
      // person. Names only: which of them is free at 3pm is availability's
      // job, and a rota is not something to read down a phone line.
      staff: staffRows
        .filter((row) => row.active)
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
        .map((row) => ({ name: row.name })),
      // NO SERVICE LIST HERE. It used to be the biggest thing this returned —
      // 1411 of 4141 characters on a measured call — and every one of them was
      // a duplicate: beforeCallContext injects {{services}}, already worded for
      // speech, into the prompt before the phone is answered. So the agent was
      // handed the menu, then spent a silent round trip fetching the menu, and
      // then re-sent the menu to the model on every turn for the rest of the
      // call. Prices are answered from the prompt; this tool is for the things
      // the prompt does NOT carry — who the caller is, what this business
      // collects, and what time it is here.
    };
  },
});

// What the caller asked for, matched against what the salon actually sells.
//
// THE KEY WINS. An agent configured from the Services table sends `manikur`,
// and that is an address the salon can rename "Manikür & pedikür" behind
// without the agent noticing. Everything below the key check is a net for an
// agent that was given a sentence instead: folded exact match, then
// containment either way, longest name first so "Saç boyama" beats a bare
// "Saç". Only active services — a service the salon switched off is not
// something the phone should be able to book.
//
// A miss is NOT a booking failure. cal.com already holds the slot by the time
// this runs, so refusing here would strand a reservation, and an appointment
// missing its service name is a great deal better than a caller told "sorry"
// because the agent improvised a synonym. The salon sees an unnamed block and
// fixes it in one click; the customer keeps their slot.
// A matched line as voiceBook stores it. durationMinutes 0 means the service
// is a GOOD (a cake, a delivery) — services can never store a real 0, the
// writers floor at 5 — and only goods ever carry quantity or leadMinutes.
type MatchedLine = {
  serviceId: Id<"services">;
  name: string;
  price?: number;
  durationMinutes: number;
  leadMinutes?: number;
  quantity?: number;
};

async function matchService(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  spoken: string,
): Promise<MatchedLine | undefined> {
  const wanted = foldForMatch(spoken);
  if (!wanted) return undefined;
  const services = (
    await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
  ).filter((service) => service.active);
  const folded = services
    .map((service) => ({ service, name: foldForMatch(service.name) }))
    .sort((a, b) => b.name.length - a.name.length);
  const hit =
    // Keys are already folded snake_case, so the spoken string is compared
    // raw-trimmed too: an agent sending `sac_boyama` must not have to survive
    // a space-collapsing pass meant for sentences.
    folded.find((row) => serviceKey(row.service) === spoken.trim()) ??
    folded.find((row) => row.name === wanted) ??
    // Two-character names would match almost any sentence, so containment
    // only applies once a name is long enough to mean something.
    folded.find(
      (row) =>
        row.name.length >= 3 &&
        (row.name.includes(wanted) || wanted.includes(row.name)),
    );
  if (!hit) return undefined;
  // Snapshotted, not referenced: raising the price in September must not
  // rewrite what this booking recorded. See the items comment in schema.ts.
  return {
    serviceId: hit.service._id,
    name: hit.service.name,
    price: hit.service.price,
    durationMinutes: hit.service.durationMinutes ?? 0,
    ...(hit.service.leadMinutes !== undefined
      ? { leadMinutes: hit.service.leadMinutes }
      : {}),
  };
}

// Several spoken services against the salon's list, in the order the caller
// said them. TIME-BOUND repeats are deduplicated by id: one visit does not
// contain the same haircut twice, so a repeat is the matcher having caught
// the same thing twice (a caller saying "saç kesimi, normal saç kesimi")
// rather than a real second booking. A repeated GOOD is the opposite — "two
// chocolate cakes" is a real order of two, and the agent asks for multiples
// exactly by repeating the name — so a good's repeats accumulate as quantity
// on its one line. Unmatched words are dropped rather than guessed at, exactly
// as the singular path drops them — the appointment still stands and the agent
// reads back what DID match, which is its cue to ask again.
async function matchServices(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  spoken: string[],
): Promise<MatchedLine[]> {
  const lines: MatchedLine[] = [];
  const byId = new Map<string, MatchedLine>();
  for (const one of spoken) {
    const hit = await matchService(ctx, orgId, one);
    if (!hit) continue;
    const existing = byId.get(String(hit.serviceId));
    if (existing) {
      if (existing.durationMinutes === 0) {
        existing.quantity = Math.min(99, (existing.quantity ?? 1) + 1);
      }
      continue;
    }
    byId.set(String(hit.serviceId), hit);
    lines.push(hit);
  }
  return lines;
}

// Whether the spoken order is goods through and through. http.ts asks BEFORE
// deciding to involve cal.com: a goods-only order has no zero-length
// representation there and consumes no inventory, so it must stay local —
// not least because an externalUid would skip voiceBook's own guards, lead
// time included. Anything unmatched or mixed keeps the current cal.com path;
// unknown words defaulting to "not goods" is the conservative reading.
export const classifyServices = internalQuery({
  args: { orgId: v.id("orgs"), spoken: v.array(v.string()) },
  returns: v.object({ goodsOnly: v.boolean() }),
  handler: async (ctx, args) => {
    const lines = await matchServices(ctx, args.orgId, args.spoken);
    return {
      goodsOnly:
        lines.length > 0 &&
        lines.length === args.spoken.length &&
        lines.every((line) => line.durationMinutes === 0),
    };
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
    // What the caller asked for, in their own words. Matched below rather
    // than by the agent, so a salon renaming a service does not mean editing
    // a prompt in Retell.
    //
    // Both shapes, because an agent provisioned before template v4 still
    // sends the singular one and must keep working until its owner clicks the
    // update banner. `services` wins when present.
    service: v.optional(v.string()),
    services: v.optional(v.array(v.string())),
    // Which agent made this booking. Unset = "voice", which every existing
    // caller means; the chat agent passes "chat" so the appointment row says
    // honestly which lane wrote it (docs/chat-agent.md).
    source: v.optional(v.union(v.literal("voice"), v.literal("chat"))),
  },
  // The matched name goes back to the agent so it can read the booking back
  // to the caller in the salon's own vocabulary — and so a miss is visible to
  // whoever is reading the call rather than silent.
  returns: v.object({
    appointmentId: v.id("appointments"),
    // The first match, kept for the singular caller. serviceNames carries the
    // whole visit.
    serviceName: v.optional(v.string()),
    serviceNames: v.optional(v.array(v.string())),
  }),
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
      await recordCustomerCreated(ctx, {
        orgId: args.orgId,
        customerId,
        source: "voice",
      });
      customer = await ctx.db.get(customerId);
    } else if (!customer.firstName || customer.firstName === phone) {
      // A caller the agent already saved details for exists BEFORE the
      // booking — save_customer_details creates them from the number alone —
      // so this branch, not the insert above, is the common one on a real
      // call. It used to leave the name it was just handed on the floor, and
      // the card kept showing the phone number where a name belongs.
      //
      // Still split here, because book_appointment takes ONE name argument:
      // it is the caller's name for the booking, not a customer record edit.
      // A record that already has its first and last name from the agent's
      // own capture never reaches this branch.
      const [firstName, ...rest] = args.name.trim().split(/\s+/).filter(Boolean);
      if (firstName) {
        await ctx.db.patch(customer._id, {
          firstName,
          ...(rest.length > 0 ? { lastName: rest.join(" ") } : {}),
        });
      }
    }
    if (!customer) throw new Error("customer-failed");
    // Consent, on the branch that was missing it. The insert above stamps it
    // because booking by calling the salon IS the opt-in moment — and that is
    // just as true of a caller who ALREADY has a record. On a real call they
    // always do: save_customer_details creates them from the number before
    // the booking, with no consent on it, so every voice booking by an
    // agent that collects details first landed here unconsented.
    //
    // wa.ts gates EVERY channel on consentAt, so the confirmation did not
    // fail on its way out — it never left. It was logged as a bodyless
    // no-consent failure, which reads in the feed as a template message that
    // simply did nothing.
    if (customer.consentAt === undefined) {
      await ctx.db.patch(customer._id, { consentAt: Date.now() });
    }
    const spokenServices =
      args.services && args.services.length > 0
        ? args.services
        : args.service
          ? [args.service]
          : [];
    const lines = await matchServices(ctx, args.orgId, spokenServices);
    const line = lines[0];
    // Double-booking guard, but only when Resepta's own book is the truth. An
    // externalUid means cal.com already accepted this slot — it owns the
    // inventory, and refusing here after it said yes would leave the two
    // calendars telling different stories.
    // The whole visit, not the first service. A haircut then a beard trim is
    // one 45-minute block, and guarding only the first 30 would leave the
    // second half of it bookable by somebody else.
    const totalMinutes = lines.length
      ? lines.reduce((sum, item) => sum + item.durationMinutes, 0)
      : undefined;
    if (!args.externalUid) {
      // Goods-only orders sum to 0 and fall through every occupancy guard
      // below by construction — a cake holds no chair. What a good DOES
      // enforce is its lead time: the baker's warning is a real constraint
      // where the chair count is not.
      const leadMs = lines.reduce(
        (max, item) => Math.max(max, (item.leadMinutes ?? 0) * 60_000),
        0,
      );
      if (leadMs > 0 && args.startAt < Date.now() + leadMs) {
        const needed = lines.find(
          (item) => (item.leadMinutes ?? 0) * 60_000 === leadMs,
        );
        // Read only on the failure path — the happy path must not pay for it.
        const bookingOrg = await ctx.db.get(args.orgId);
        const notice =
          spokenLead(leadMs / 60_000, bookingOrg?.language) ?? `${leadMs / 60_000} minutes`;
        // A sentence, not a slug, for the same reason as customer-busy below:
        // the agent reads this back, and it must name the remedy.
        throw new Error(
          `lead-time: "${needed?.name ?? "this item"}" must be ordered ${notice} in advance. Apologise, say how much notice it needs, and offer the earliest day that satisfies it.`,
        );
      }
      const duration = totalMinutes ?? args.durationMinutes ?? 30;
      const endAt = args.startAt + duration * 60_000;
      // One day either side is enough: nothing a salon books runs longer.
      const nearby = await ctx.db
        .query("appointments")
        .withIndex("by_org_start", (q) =>
          q
            .eq("orgId", args.orgId)
            .gte("startAt", args.startAt - 24 * 60 * 60_000)
            .lt("startAt", endAt),
        )
        .collect();
      // Before capacity, the caller themselves. Capacity asks whether the shop
      // has a free chair; a two-chair salon says yes to 14:00 twice, and on a
      // real call that booked one man a haircut and a beard trim at the same
      // minute. The message is the tool result the agent reads back, so it
      // says what to do instead — the prompt already tells it to run a second
      // service back to back.
      const clash = customerConflict(nearby, customer._id, args.startAt, duration);
      if (clash) {
        // A sentence, not a slug: http.ts hands err.message to the agent
        // verbatim, and "customer-busy" alone leaves it guessing at the
        // remedy. This names the remedy the prompt already asks for.
        const freeAt = clash.startAt + (clash.durationMinutes ?? 30) * 60_000;
        // Read only on the failure path — the happy path must not pay for it.
        const bookingOrg = await ctx.db.get(args.orgId);
        const when = bookingOrg
          ? spokenClock(freeAt, bookingOrg.timezone, bookingOrg.language)
          : new Date(freeAt).toISOString();
        throw new Error(
          `customer-busy: this caller already has an appointment overlapping that time. Theirs ends at ${when}. Offer that time or later, and never put two services at the same moment.`,
        );
      }
      // Goods rows (an explicit 0 — unset means a legacy row, assume 30)
      // hold no chair, so they never count toward a full shop.
      const overlapping = nearby.filter(
        (row) =>
          (row.status === "scheduled" || row.status === "confirmed") &&
          row.durationMinutes !== 0 &&
          row.startAt < endAt &&
          args.startAt < row.startAt + (row.durationMinutes ?? 30) * 60_000,
      ).length;
      // How many people can be working at once. One booking at 14:00 used to
      // close 14:00 for the whole shop, which in a salon with four chairs
      // refuses three slots that are genuinely free — and refuses them more
      // often the bigger the salon gets.
      //
      // Counted here rather than assigned: the booking still lands on the shop
      // and not on a named person, so what this guards is CAPACITY, not
      // Elif's afternoon. Which chair the caller gets is the salon's to decide
      // when they look at the day. A staff argument on book_appointment is the
      // version where the caller chooses, and that is a bigger conversation.
      //
      // An org with nobody on the roster still books one at a time: a shop
      // that has not filled in its team is not a shop with no chairs.
      const capacity = Math.max(
        1,
        (
          await ctx.db
            .query("staff")
            .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
            .collect()
        ).filter((row) => row.active).length,
      );
      if (duration > 0 && overlapping >= capacity) {
        // The message is the tool result the agent reads back, so it names
        // the conflict in a way the agent can act on: offer another time.
        throw new Error("slot-taken");
      }
    }
    const appointmentId = await ctx.db.insert("appointments", {
      orgId: args.orgId,
      customerId: customer._id,
      startAt: args.startAt,
      // The services' own durations win over anything the call reported: they
      // are what the salon says the work takes, and the block staff read.
      durationMinutes: totalMinutes ?? args.durationMinutes,
      // leadMinutes is matcher plumbing, not a line fact — the stored
      // snapshot carries what was sold, not the baker's scheduling rule.
      items: lines.length
        ? lines.map(({ leadMinutes: _lead, ...item }) => item)
        : undefined,
      status: "scheduled",
      source: args.source ?? "voice",
      externalUid: args.externalUid,
    });
    await syncAppointmentSchedule(ctx, appointmentId);
    await scheduleConfirmationIfConfigured(ctx, args.orgId, appointmentId);
    return {
      appointmentId,
      serviceName: line?.name,
      serviceNames: lines.length ? lines.map((item) => item.name) : undefined,
    };
  },
});

// The salon's own book, for agents with no cal.com. Resepta IS a calendar —
// every appointment in the org lives in this table — so "calendar not
// connected" was never true, just the only answer check_availability had when
// its single backend was missing. Scheduled and confirmed block a slot;
// cancelled and no_show do not.
export const bookedBetween = internalQuery({
  args: { orgId: v.id("orgs"), startMs: v.number(), endMs: v.number() },
  returns: v.object({
    capacity: v.number(),
    full: v.array(
      v.object({ startAt: v.number(), durationMinutes: v.union(v.number(), v.null()) }),
    ),
  }),
  handler: async (ctx, args) => {
    const rows = (
      await ctx.db
        .query("appointments")
        .withIndex("by_org_start", (q) =>
          q.eq("orgId", args.orgId).gte("startAt", args.startMs).lt("startAt", args.endMs),
        )
        .collect()
    ).filter(
      (row) =>
        (row.status === "scheduled" || row.status === "confirmed") &&
        // Goods orders (explicit 0) hold no chair — a Saturday of cake
        // pickups must not read as a full shop.
        row.durationMinutes !== 0,
    );
    // Every booked time used to come back as unavailable, which is only true
    // of a one-chair shop. What the agent needs is the times that are FULL —
    // where as many appointments already overlap as there are people to work
    // them. A salon with four chairs and one 14:00 booking has three left, and
    // saying otherwise turns down business.
    const capacity = Math.max(
      1,
      (
        await ctx.db
          .query("staff")
          .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
          .collect()
      ).filter((row) => row.active).length,
    );
    const endOf = (row: { startAt: number; durationMinutes?: number }) =>
      row.startAt + (row.durationMinutes ?? 30) * 60_000;
    const full = rows.filter((row) => {
      const overlapping = rows.filter(
        (other) => other.startAt < endOf(row) && row.startAt < endOf(other),
      ).length;
      return overlapping >= capacity;
    });
    return {
      capacity,
      full: full.map((row) => ({
        startAt: row.startAt,
        durationMinutes: row.durationMinutes ?? null,
      })),
    };
  },
});

// Cancel and reschedule are split into a lookup and a write because a Convex
// mutation cannot reach the network, and cal.com has to be told first: it owns
// the slot inventory, the salon's Google Calendar and the notification emails.
// The old single mutation patched status locally and stopped, so Resepta said
// cancelled while cal.com kept the slot blocked for a customer who was not
// coming. http.ts calls this, then cal.com, then the write below.
export const nextAppointmentForPhone = internalQuery({
  args: { orgId: v.id("orgs"), phone: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      appointmentId: v.id("appointments"),
      externalUid: v.optional(v.string()),
      startAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const phone = toE164(args.phone);
    if (!phone) return null;
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) => q.eq("orgId", args.orgId).eq("phone", phone))
      .unique();
    if (!customer) return null;
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();
    const next = nextUpcomingOf(appointments, Date.now(), ["scheduled", "confirmed"]);
    if (!next) return null;
    return {
      appointmentId: next._id,
      externalUid: next.externalUid,
      startAt: next.startAt,
    };
  },
});

// The writes themselves live in appointments.ts (markCancelled,
// markRescheduled) — the WhatsApp lane cancels through the same pair, and an
// appointment state transition does not belong in the voice module.

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
// RESERVED_CONTACT_KEYS moved to lib/keys.ts — contactFields validates
// user-declared keys against the same list this write gate enforces.

const contactUpdateResult = v.object({
  ok: v.boolean(),
  reason: v.optional(v.string()),
  // Keys actually written, the matching labels (for anything spoken), and
  // three separate rejection buckets so the agent's transcript shows WHY
  // something did not stick rather than just that it did not.
  updated: v.array(v.string()),
  updatedLabels: v.array(v.string()),
  // Keys this org has no field for, plus the built-in columns. Machine keys,
  // because no label exists for a key nobody defined.
  ignored: v.array(v.string()),
  // Fields that exist but are marked staff-filled. Labels, because these are
  // real columns a person named.
  notForVoice: v.array(v.string()),
  // Fields the agent may write, whose value did not survive its type.
  rejected: v.array(v.string()),
});

type ContactUpdateResult = {
  ok: boolean;
  reason?: string;
  updated: string[];
  updatedLabels: string[];
  ignored: string[];
  notForVoice: string[];
  rejected: string[];
};

function contactUpdateFailure(reason: string): ContactUpdateResult {
  return {
    ok: false,
    reason,
    updated: [],
    updatedLabels: [],
    ignored: [],
    notForVoice: [],
    rejected: [],
  };
}

// ---- Type coercion for values a model spoke ---------------------------------
//
// Retell hands every collected variable over as a string, whatever the field's
// type is. Storing "14 March" raw on a date field is how a value looks LOST:
// the contact page renders it into <input type="date">, the browser cannot
// read it, and the input shows blank. So a value either fits its type or it
// comes back as rejected; nothing lands raw.
//
// Pure on purpose. Both voice write paths (the mid-call function and the
// post-call webhook) reach the customer through applyVoiceContactValues, and
// this is the single place that decides what a spoken value means.

export type VoiceFieldSpec = {
  type: "text" | "select" | "number" | "date";
  options?: string[];
};

export type CoercedContactValue =
  // value null means "clear this property" — blank beats an empty string on
  // the record.
  { ok: true; value: string | null } | { ok: false };

// Match-only folding for select options: a caller who says "renkli" should hit
// the option "Renkli", and "grosse" should hit "Große". Turkish dotted/dotless
// i is folded the same way contactFields derives its keys.
function foldForMatch(raw: string): string {
  return raw
    .trim()
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .replace(/[äÄ]/g, "a")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this one, leap years included.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string | null {
  if (!isRealDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The formats a person actually dictates or a model actually emits. Day-first
// for the separated forms because both Turkey and the DACH market write
// 14.03.2026; there is no market on this deployment that writes month first,
// so accepting mm/dd would only make 03/04 ambiguous. A relative phrase
// ("next Tuesday") is deliberately NOT resolved: guessing a date onto a
// customer record is worse than handing the miss back to the agent.
function toIsoDate(text: string): string | null {
  const isoish = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (isoish) return iso(+isoish[1], +isoish[2], +isoish[3]);
  const yearFirst = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(text);
  if (yearFirst) return iso(+yearFirst[1], +yearFirst[2], +yearFirst[3]);
  const dayFirst = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text);
  if (dayFirst) {
    const rawYear = +dayFirst[3];
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return iso(year, +dayFirst[2], +dayFirst[1]);
  }
  return null;
}

// "42", "3,5", "2 kişi" all mean a number to a salon. Comma is the decimal
// point in both Turkish and German, so it normalises to a dot on the way in.
function toNumberString(text: string): string | null {
  const match = /-?\d+(?:[.,]\d+)?/.exec(text.replace(/\s/g, ""));
  if (!match) return null;
  return match[0].replace(",", ".");
}

export function coerceContactValue(
  field: VoiceFieldSpec,
  raw: unknown,
): CoercedContactValue {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  if (field.type === "number") {
    const value = toNumberString(text);
    return value === null ? { ok: false } : { ok: true, value };
  }
  if (field.type === "date") {
    const value = toIsoDate(text);
    return value === null ? { ok: false } : { ok: true, value };
  }
  if (field.type === "select") {
    // Only a defined option, never a near miss: the record page renders this
    // through a select, so a value outside the list has nothing to show.
    const wanted = foldForMatch(text);
    const match = (field.options ?? []).find((o) => foldForMatch(o) === wanted);
    return match === undefined ? { ok: false } : { ok: true, value: match };
  }
  return { ok: true, value: text };
}

// Lenient sibling of assertE164: the voice lane must never throw at Retell,
// so a number we cannot read comes back as a reason instead of a 500.
//
// The dial code is the org's own (dialCodeForTimezone). This used to refuse
// one on the theory that a caller ID arrives from the carrier already
// international — and then a Turkish trunk delivered "05386906897", live, on
// 18 Aug 2026. Without the dial code that string normalises to null, so the
// call matched no contact, created none, and every value the agent collected
// was dropped on the floor. A caller ID on the org's own line is dialable
// from the org's country by definition; attaching the org's dial code to it
// is the safe reading, and normalisePhone stays strict about numbers that
// already carry their own.
function toE164(raw: string, dialCode?: string): string | null {
  return normalisePhone(raw, dialCode);
}

// The single mapping both voice write paths share: the mid-call function and
// the post-call webhook. Two copies of this guard would drift.
// Deliberately loose. A stricter pattern rejects real addresses, and the cost
// of a wrong reject here is the agent asking a caller to spell their email a
// third time. What it does catch is the transcription that came back as words
// rather than an address.
const SPOKEN_EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export async function applyVoiceContactValues(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    phone: string;
    values: Record<string, string>;
    fillOnlyMissing?: boolean;
    // Which incoming keys mean a column on the customer rather than an entry
    // in its custom map. Resolved by the caller from the agent's own
    // variables, so a key only reaches a built-in if the owner said it should.
    identity?: Record<string, { field: "firstName" | "lastName" | "email"; label: string }>;
  },
): Promise<ContactUpdateResult> {
  const phone = toE164(args.phone);
  if (!phone) return contactUpdateFailure("phone-not-recognised");
  const customer = await ctx.db
    .query("customers")
    .withIndex("by_org_phone", (q) => q.eq("orgId", args.orgId).eq("phone", phone))
    .unique();
  if (!customer) return contactUpdateFailure("no-contact-with-that-number");
  const fields = await ctx.db
    .query("contactFields")
    .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
    .collect();
  const byKey = new Map(fields.map((field) => [field.key, field]));
  // Enforced HERE, not in each caller, so the live save and the post-call
  // reconciliation cannot disagree about what locked means.
  const lockedIdentity = new Set(
    (await ctx.db.get(args.orgId))?.voiceLockedIdentity ?? [],
  );
  if (args.identity) {
    for (const key of Object.keys(args.identity)) {
      const canonical = args.identity[key].field === "firstName"
        ? "firstname"
        : args.identity[key].field === "lastName"
          ? "lastname"
          : "email";
      if (lockedIdentity.has(canonical)) delete args.identity[key];
    }
  }

  const custom = { ...(customer.custom ?? {}) };
  const identityPatch: { firstName?: string; lastName?: string; email?: string } = {};
  const updated: string[] = [];
  const updatedLabels: string[] = [];
  const ignored: string[] = [];
  const notForVoice: string[] = [];
  const rejected: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(args.values)) {
    const key = rawKey.trim();
    if (!key) continue;

    // The built-in columns, before the custom map is consulted: name and email
    // are reserved keys down there and would otherwise be ignored on the way
    // past. Only keys the agent's own configuration nominated get here.
    const target = args.identity?.[key];
    if (target) {
      const value = rawValue.trim();
      // Never blank one out. Clearing a custom property is a legitimate thing
      // for a caller to do; clearing the name off a record because a model
      // returned "" is not.
      if (!value) continue;
      if (target.field === "email") {
        if (args.fillOnlyMissing && customer.email) continue;
        if (!SPOKEN_EMAIL_RE.test(value)) {
          rejected.push(target.label);
          continue;
        }
        identityPatch.email = value.toLowerCase();
      } else {
        // Stored exactly as the agent gave it. It heard the whole sentence
        // and decided where the given name ended; this is not the place to
        // second-guess that with a rule about spaces.
        const current = target.field === "firstName" ? customer.firstName : customer.lastName;
        if (args.fillOnlyMissing && current) continue;
        identityPatch[target.field] = value;
      }
      updated.push(key);
      updatedLabels.push(target.label);
      continue;
    }

    const field = byKey.get(key);
    if (!field || RESERVED_CONTACT_KEYS.has(key.toLowerCase())) {
      ignored.push(key);
      continue;
    }
    // "Filled by" is a two-state contract the business chose in settings, not
    // a hint: a field marked staff-filled belongs to a human, and an agent
    // that mishears is exactly who must not overwrite it. Unset reads as
    // staff, the same way it reads everywhere else.
    if (field.source !== "voice") {
      notForVoice.push(field.label);
      continue;
    }
    // Post-call analysis is an inference over a transcript, not a correction
    // from the caller. It may recover a value the live extraction missed, but
    // it never gets to replace something already confirmed during this or an
    // earlier call.
    if (args.fillOnlyMissing && custom[key]) continue;
    const coerced = coerceContactValue(field, rawValue);
    if (!coerced.ok) {
      rejected.push(field.label);
      continue;
    }
    // Storage stays a string; what changed is that the string now fits the
    // type the record page renders it with.
    if (coerced.value === null) delete custom[key];
    else custom[key] = coerced.value;
    updated.push(key);
    updatedLabels.push(field.label);
  }
  if (updated.length > 0) {
    await ctx.db.patch(customer._id, { custom, ...identityPatch });
    // The email arriving NOW is what an earlier no-email-address confirmation
    // was waiting for — the agent asks for the address after booking, so the
    // booking-time send raced an empty column and lost. Repay it.
    if (identityPatch.email && !customer.email) {
      await retryConfirmationsAwaitingEmail(ctx, customer._id);
    }
  }
  return { ok: true, updated, updatedLabels, ignored, notForVoice, rejected };
}

// Every line the org itself answers or transfers on, normalized. A call leg
// whose counterparty resolves to one of these is the business phoning itself
// — an outbound test, a transfer leg, a misread — and must never become a
// contact: the inbox is people, and the salon is not one of its own
// customers. Checked as a hard guard wherever voice creates or matches a
// contact, independent of what the payload claims about direction.
export async function orgOwnNumbers(
  ctx: { db: QueryCtx["db"] },
  orgId: Id<"orgs">,
): Promise<Set<string>> {
  const [agents, lines] = await Promise.all([
    ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect(),
    ctx.db
      .query("agentLines")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect(),
  ]);
  const own = new Set<string>();
  const add = (raw: string | undefined) => {
    const phone = raw ? normalisePhone(raw) : null;
    if (phone) own.add(phone);
  };
  for (const agent of agents) {
    add(agent.inboundNumber);
    add(agent.transferNumber);
  }
  for (const line of lines) add(line.number);
  return own;
}

// Org comes from the agent id on the signed payload, exactly like every other
// voice entry point. A payload that names an org is a payload we ignore.
export const updateContactFromVoice = internalMutation({
  args: {
    retellAgentId: v.string(),
    phone: v.string(),
    values: v.record(v.string(), v.string()),
    fillOnlyMissing: v.optional(v.boolean()),
  },
  returns: contactUpdateResult,
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", args.retellAgentId))
      .unique();
    if (!agent || !agent.enabled) return contactUpdateFailure("agent-not-configured");
    const org = await ctx.db.get(agent.orgId);
    const phone = toE164(args.phone, org ? dialCodeForTimezone(org.timezone) : undefined);
    if (!phone) return contactUpdateFailure("phone-not-recognised");
    // The business's own line is not a contact — see orgOwnNumbers. Reached
    // when an outbound leg's from_number is handed in as "the caller".
    if ((await orgOwnNumbers(ctx, agent.orgId)).has(phone)) {
      return contactUpdateFailure("own-number");
    }
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_org_phone", (q) => q.eq("orgId", agent.orgId).eq("phone", phone))
      .unique();
    if (!existing) {
      const customerId = await ctx.db.insert("customers", {
        orgId: agent.orgId,
        firstName: "",
        phone,
      });
      await recordCustomerCreated(ctx, {
        orgId: agent.orgId,
        customerId,
        source: "voice",
      });
    }
    // Only this agent's own rows decide what may reach a built-in column. A
    // key is not privileged because of what it is called — "email" typed into
    // some other agent's variable list stays a custom property.
    const rows = await ctx.db
      .query("voiceAgentVariables")
      .withIndex("by_org_agent", (q) =>
        q.eq("orgId", agent.orgId).eq("retellAgentId", args.retellAgentId),
      )
      .collect();
    const identity: Record<
      string,
      { field: "firstName" | "lastName" | "email"; label: string }
    > = {
      // The identity columns are ALWAYS writable by voice, under the exact
      // keys the Contact fields table shows. This used to require a per-agent
      // variable to nominate each one — a second vocabulary ("Müşteri
      // e-postası") beside the field list the whole app runs on, and the two
      // disagreeing is how an agent told a live caller the system had no room
      // for email addresses. One list now. Phone is deliberately not here:
      // the caller was matched by it, and letting a call rewrite its own
      // match key would detach the record from the number on the line.
      firstname: { field: "firstName", label: "firstname" },
      lastname: { field: "lastName", label: "lastname" },
      email: { field: "email", label: "email" },
    };
    for (const row of rows) {
      if (row.destination === "customer" && row.customerField) {
        identity[row.key] = { field: row.customerField, label: row.label };
      }
    }
    return await applyVoiceContactValues(ctx, {
      orgId: agent.orgId,
      phone,
      values: args.values,
      fillOnlyMissing: args.fillOnlyMissing,
      identity,
    });
  },
});

// The call meter (schema: calls.billedMicroUsd / usageMonthly.voice*). One
// helper serves both recordCall branches. Two independent, idempotent stamps:
//
//   billed  — the first time a duration is known. Frozen at the org's rate at
//             that instant; bumps voiceCalls/voiceSeconds/voiceBilledMicroUsd.
//   cost    — the first time Retell's own price is known (call_analyzed).
//             Bumps voiceCostMicroUsd.
//
// Each keys on its own field being unset, so the call_ended/call_analyzed
// double-fire and any webhook retry can never double-bill or double-bump the
// month. The ledger row is bumped in the SAME mutation as the stamp — the
// usageMonthly rule the chat lane already lives by. The month is the month of
// the call's startedAt in the org's zone: a call analysed after midnight
// bills into the month it was made.
async function meterCall(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  existing: Doc<"calls"> | null,
  args: { durationSec?: number; retellCostMicroUsd?: number },
  startedAt: number,
): Promise<{ billedMicroUsd?: number; retellCostMicroUsd?: number }> {
  const durationSec = existing?.durationSec ?? args.durationSec;
  const stampBilled =
    durationSec !== undefined && existing?.billedMicroUsd === undefined;
  const stampCost =
    args.retellCostMicroUsd !== undefined &&
    existing?.retellCostMicroUsd === undefined;
  if (!stampBilled && !stampCost) return {};
  const org = await ctx.db.get(orgId);
  if (!org) return {};
  // Org override first, then the platform-wide default (set once in /admin →
  // Platform), then zero — usage still counts either way, the bill is just 0.
  // An explicit org 0 beats the default: that is what an override means.
  const rate =
    org.voiceRateMicroUsdPerMinute ??
    Math.max(
      0,
      Math.round(
        Number(await platformValue(ctx, "voiceRateMicroUsdPerMinute")) || 0,
      ),
    );
  const billedMicroUsd = stampBilled
    ? Math.round(((durationSec ?? 0) * rate) / 60)
    : undefined;
  const month = monthKey(startedAt, org.timezone);
  const usage = await ctx.db
    .query("usageMonthly")
    .withIndex("by_org_month", (q) => q.eq("orgId", orgId).eq("month", month))
    .unique();
  const bump = {
    voiceCalls: stampBilled ? 1 : 0,
    voiceSeconds: stampBilled ? (durationSec ?? 0) : 0,
    voiceBilledMicroUsd: billedMicroUsd ?? 0,
    voiceCostMicroUsd: stampCost ? (args.retellCostMicroUsd ?? 0) : 0,
  };
  // Budget alerts — the whole budget feature; there is deliberately no cap on
  // the dispatch path (schema: orgs.voiceMonthlyBudgetMicroUsd). Once per
  // threshold per month via the stamps on this row. Current month only, so a
  // call analysed late into LAST month cannot fire a stale alert. A single
  // call jumping straight past 100% stamps BOTH thresholds — firing the 80%
  // alert afterwards would read as spend going backwards.
  const budget = org.voiceMonthlyBudgetMicroUsd;
  const spentAfter = (usage?.voiceBilledMicroUsd ?? 0) + bump.voiceBilledMicroUsd;
  let alertTemplate: "voiceBudget80" | "voiceBudget100" | null = null;
  let alertStamps: Record<string, number> = {};
  if (
    stampBilled &&
    budget &&
    budget > 0 &&
    month === monthKey(Date.now(), org.timezone)
  ) {
    const crossed100 = spentAfter >= budget && !usage?.voiceBudgetAlert100At;
    const crossed80 =
      spentAfter >= Math.floor(budget * 0.8) && !usage?.voiceBudgetAlert80At;
    if (crossed100 || crossed80) {
      alertTemplate = crossed100 ? "voiceBudget100" : "voiceBudget80";
      alertStamps = {
        voiceBudgetAlert80At: Date.now(),
        ...(crossed100 ? { voiceBudgetAlert100At: Date.now() } : {}),
      };
    }
  }
  if (usage) {
    await ctx.db.patch(usage._id, {
      voiceCalls: (usage.voiceCalls ?? 0) + bump.voiceCalls,
      voiceSeconds: (usage.voiceSeconds ?? 0) + bump.voiceSeconds,
      voiceBilledMicroUsd:
        (usage.voiceBilledMicroUsd ?? 0) + bump.voiceBilledMicroUsd,
      voiceCostMicroUsd:
        (usage.voiceCostMicroUsd ?? 0) + bump.voiceCostMicroUsd,
      ...alertStamps,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("usageMonthly", {
      orgId,
      month,
      llmTurns: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      llmCostMicroUsd: 0,
      ...bump,
      ...alertStamps,
      updatedAt: Date.now(),
    });
  }
  if (alertTemplate && budget) {
    const fmt = (m: number) => `$${(m / 1_000_000).toFixed(2)}`;
    await queueOrgAlert(ctx, {
      orgId,
      template: alertTemplate,
      who: org.name || "—",
      detail: `${fmt(spentAfter)} / ${fmt(budget)}`,
    });
  }
  // The prepaid drawdown (schema: orgs.billingMode). Same mutation as the
  // stamp, so the wallet can never disagree with the line items it paid
  // for. The low/empty mails fire on the way down, once per descent — their
  // stamps clear on top-up (wallet.creditTopup), not on a new month. Empty
  // also stamps low, for the same reason a call jumping past 100% stamps
  // both budget thresholds: "running low" after "ran out" reads as the
  // balance going backwards.
  if (stampBilled && org.billingMode === "prepaid") {
    const after = (org.walletBalanceMicroUsd ?? 0) - (billedMicroUsd ?? 0);
    const crossedEmpty = after <= 0 && !org.walletAlertEmptyAt;
    const crossedLow =
      after <= WALLET_LOW_MICRO_USD && !org.walletAlertLowAt;
    await ctx.db.patch(orgId, {
      walletBalanceMicroUsd: after,
      ...(crossedLow || crossedEmpty ? { walletAlertLowAt: Date.now() } : {}),
      ...(crossedEmpty ? { walletAlertEmptyAt: Date.now() } : {}),
    });
    if (crossedEmpty || crossedLow) {
      await queueOrgAlert(ctx, {
        orgId,
        template: crossedEmpty ? "walletEmpty" : "walletLow",
        who: org.name || "—",
        detail: `$${(Math.max(after, 0) / 1_000_000).toFixed(2)}`,
      });
    }
  }
  return {
    ...(billedMicroUsd !== undefined ? { billedMicroUsd } : {}),
    ...(stampCost ? { retellCostMicroUsd: args.retellCostMicroUsd } : {}),
  };
}

// Post-call webhook: one row per Retell call, idempotent by retellCallId.
export const recordCall = internalMutation({
  args: {
    retellAgentId: v.string(),
    retellCallId: v.string(),
    // Both legs as Retell reported them, plus its direction. Which one is the
    // customer is decided HERE, not by the caller: an outbound leg carries the
    // agent's own line in from_number, and reading that as "the caller" is how
    // the salon's own number spent a morning in the inbox as a contact.
    direction: v.optional(v.union(v.literal("inbound"), v.literal("outbound"))),
    fromNumber: v.optional(v.string()),
    toNumber: v.optional(v.string()),
    startedAt: v.number(),
    durationSec: v.optional(v.number()),
    outcome: v.optional(v.string()),
    summary: v.optional(v.string()),
    transcript: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    collected: v.optional(v.record(v.string(), v.any())),
    disconnectionReason: v.optional(v.string()),
    retellCostMicroUsd: v.optional(v.number()),
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
    if (existing) {
      // Not a plain retry-dedupe: Retell sends call_ended first and the
      // ANALYSIS on a later call_analyzed event. Pure first-write-wins locked
      // the row in before the summary, outcome and collected values existed —
      // so the second event fills exactly the fields the first one could not
      // know, and never overwrites one it did.
      await ctx.db.patch(existing._id, {
        durationSec: existing.durationSec ?? args.durationSec,
        outcome: existing.outcome ?? args.outcome,
        summary: existing.summary ?? args.summary,
        transcript: existing.transcript ?? args.transcript,
        recordingUrl: existing.recordingUrl ?? args.recordingUrl,
        disconnectionReason: existing.disconnectionReason ?? args.disconnectionReason,
        collected:
          existing.collected || args.collected
            ? { ...(args.collected ?? {}), ...(existing.collected ?? {}) }
            : undefined,
        ...(await meterCall(ctx, agent.orgId, existing, args, existing.startedAt)),
      });
      return null;
    }
    // A caller the salon has never seen is the normal case, not the edge: it is
    // every first-time caller, and it is every demo. This row used to be
    // written with customerId undefined, and the inbox groups by customer (the
    // `push` guard in messages.ts), so the call landed nowhere — the agent
    // booked correctly and the screen stayed empty. Create the contact, the
    // same way an unknown inbound WhatsApp does, with the phone standing in
    // until a human types a name. Consent stays unset: them ringing us is not
    // KVKK consent for us to start messaging them.
    // A withheld or unreadable caller ID still leaves this undefined, because
    // there is no number to build a contact from.
    let customerId: Id<"customers"> | undefined;
    const org = await ctx.db.get(agent.orgId);
    const dialCode = org ? dialCodeForTimezone(org.timezone) : undefined;
    const direction = args.direction ?? "inbound";
    // The customer's leg: who called us, or who we dialled. A web test call
    // carries neither number and stays undefined.
    const rawCounterparty =
      direction === "outbound" ? args.toNumber : args.fromNumber;
    const counterparty = rawCounterparty ? toE164(rawCounterparty, dialCode) : null;
    if (counterparty && !(await orgOwnNumbers(ctx, agent.orgId)).has(counterparty)) {
      const customer = await ctx.db
        .query("customers")
        .withIndex("by_org_phone", (q) =>
          q.eq("orgId", agent.orgId).eq("phone", counterparty),
        )
        .unique();
      customerId = customer?._id;
      if (!customerId) {
        customerId = await ctx.db.insert("customers", {
          orgId: agent.orgId,
          firstName: "",
          phone: counterparty,
        });
        await recordCustomerCreated(ctx, {
          orgId: agent.orgId,
          customerId,
          source: "voice",
        });
      }
    }
    await ctx.db.insert("calls", {
      orgId: agent.orgId,
      customerId,
      direction,
      retellAgentId: args.retellAgentId,
      // Normalized when readable so the row and the contact agree on one
      // identity; the raw string when not, because a number we could not
      // parse is still worth showing over "Unknown".
      fromNumber: counterparty ?? rawCounterparty,
      startedAt: args.startedAt,
      durationSec: args.durationSec,
      outcome: args.outcome,
      summary: args.summary,
      transcript: args.transcript,
      recordingUrl: args.recordingUrl,
      retellCallId: args.retellCallId,
      collected: args.collected,
      disconnectionReason: args.disconnectionReason,
      ...(await meterCall(ctx, agent.orgId, null, args, args.startedAt)),
    });
    return null;
  },
});

// The org's agents, for the operator paths that act on all of them at once
// (retellAgent.releaseOrgLines). Internal and org-passed: the caller is an
// action with no session, exactly like every other sessionless path here.
export const agentsForOrg = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.array(v.object({ retellAgentId: v.string() })),
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.map((row) => ({ retellAgentId: row.retellAgentId }));
  },
});

// The cached "this agent answers on this line" label, dropped when the line is
// revoked. Cosmetic next to the provider binding — but a stale number under an
// agent's name is the same lie the revocation exists to end.
export const clearAgentInboundNumber = internalMutation({
  args: { orgId: v.id("orgs"), number: v.string() },
  returns: v.null(),
  handler: async (ctx, { orgId, number }) => {
    const rows = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    for (const row of rows) {
      if (row.inboundNumber === number) {
        await ctx.db.patch(row._id, { inboundNumber: undefined });
      }
    }
    return null;
  },
});
