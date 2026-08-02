import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { connectionField } from "./lib/connections";
import { requireOrg, requireOwner, assertE164 } from "./lib/orgAuth";
import { normalisePhone } from "./lib/phone";
import { voiceCatalogue } from "./lib/voiceCatalogue";
import { nextUpcomingOf, scheduleConfirmationIfConfigured } from "./appointments";
import { serviceKey } from "./services";
import { syncAppointmentSchedule } from "./lib/reminderSchedule";
import { recordCustomerCreated } from "./lib/newCustomer";
import { getLocalPartsSafe, localWallTimeToUtcMs } from "./lib/businessHours";
import { formatAppointmentTime } from "./lib/format";
import { voiceVariableInput } from "./lib/voiceVariables";
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

// Retell owns the routing, so our inboundNumber is a CACHE of a decision made
// somewhere else — and it drifts. Someone moves a line in Retell's own
// dashboard, or one key serves two orgs and the second one takes the number:
// either way the row goes on naming a line that no longer rings this agent,
// and the salon reads it as fact on four screens.
//
// So every clean read of the provider's numbers reconciles it. Only ever
// called with a numbers fetch that came back OK — reconciling from a failed
// or partial read would clear every line in the org and call it truth.
export const reconcileLines = internalMutation({
  args: {
    orgId: v.id("orgs"),
    bindings: v.array(v.object({ number: v.string(), agentId: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, bindings }) => {
    const held = new Map(bindings.map((b) => [b.agentId, b.number]));
    const rows = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    for (const row of rows) {
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
    };
  },
});

// One owner-scoped read for the agent editor. The Retell key never reaches the
// browser: actions use it server-side, while the client receives only the
// variable rows and the org's possible contact-field destinations.
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
    // creation got a real provider agent and no Randevu runtime.
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
      runtimeConnectedAt: agent.runtimeConnectedAt ?? null,
      inboundNumber: agent.inboundNumber ?? null,
      fields: fields.sort((a, b) => a.order - b.order),
    };
  },
});

// Provider publication happens before this mutation. If Retell rejects the
// draft, the Randevu registry stays untouched and the editor can retry without
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
    const normalised = normalisePhone(phone);
    const customer = normalised
      ? await ctx.db
          .query("customers")
          .withIndex("by_org_phone", (q) =>
            q.eq("orgId", agent.orgId).eq("phone", normalised),
          )
          .unique()
      : null;
    const [variables, fields, appointments, services] = await Promise.all([
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
        case "customer_phone":
          value = customer?.phone ?? normalised ?? "";
          break;
        case "customer_language":
          value = customer?.language ?? org.language;
          break;
        case "next_appointment":
          value = next
            ? formatAppointmentTime(next.startAt, org.timezone, customer?.language ?? org.language)
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
    const lang = customer?.language ?? org.language;
    const currency = org.currency ?? "TRY";
    const priceDigits =
      new Intl.NumberFormat(lang, { style: "currency", currency }).resolvedOptions()
        .minimumFractionDigits ?? 2;
    const priceOf = (minor: number) =>
      new Intl.NumberFormat(lang, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      }).format(minor / 10 ** priceDigits);
    const builtins: Record<string, string> = {
      business_name: org.name,
      customer_name: customer
        ? [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim()
        : "",
      customer_phone: customer?.phone ?? normalised ?? "",
      customer_language: lang,
      next_appointment: next
        ? formatAppointmentTime(next.startAt, org.timezone, lang)
        : "",
      services: services
        .filter((service) => service.active)
        .map((service) => {
          const duration = `${service.durationMinutes} ${lang === "tr" ? "dk" : "min"}`;
          return service.price !== undefined
            ? `${service.name} (${duration}, ${priceOf(service.price)})`
            : `${service.name} (${duration})`;
        })
        .join("; "),
    };
    for (const [key, value] of Object.entries(builtins)) {
      if (!(key in dynamicVariables)) dynamicVariables[key] = value;
    }
    return {
      apiKey: await connectionField(ctx, agent.orgId, "retell", "apiKey"),
      dynamicVariables,
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
  }[];
  phoneNumbers: { number: string; nickname: string; agentId: string | null }[];
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
      }),
    ),
    phoneNumbers: v.array(
      v.object({
        number: v.string(),
        nickname: v.string(),
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
          { number: "+902121112233", nickname: "Salon line", agentId: DEMO_AGENTS[0].id },
        ],
        voices: [],
        hiddenAgentIds: [],
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
        // is_latest=true or Retell returns one row per agent VERSION, which
        // shows the same agent five times in the picker.
        fetch("https://api.retellai.com/list-agents?is_latest=true", { headers }),
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
      language?: string | string[];
      webhook_url?: string;
      post_call_analysis_data?: Array<{ name?: string; type?: string }>;
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
    const agents: AgentListResult["agents"] = [];
    for (const a of agentItems) {
      if (!a.agent_id || seen.has(a.agent_id)) continue;
      seen.add(a.agent_id);
      agents.push({
        id: a.agent_id,
        name: a.agent_name?.trim() || a.agent_id,
        languages: Array.isArray(a.language)
          ? a.language
          : a.language
            ? [a.language]
            : [],
        // What the agent captures on a call. Retell's system presets
        // (call_summary and friends) arrive elsewhere in the payload and are
        // not things the salon configured, so they are not "what it collects".
        collects: (a.post_call_analysis_data ?? [])
          .filter((f) => f.name && f.type !== "system-presets")
          .map((f) => f.name!),
        webhookUrl: a.webhook_url?.trim() || null,
      });
    }

    const phoneNumbers = numItems
      .filter((n) => n.phone_number)
      .map((n) => ({
        number: n.phone_number!,
        nickname: n.nickname?.trim() || n.phone_number!,
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
      bindings: phoneNumbers.flatMap((n) =>
        n.agentId ? [{ number: n.number, agentId: n.agentId }] : [],
      ),
    });

    return {
      configured: true,
      error: null,
      connectedAgentId: context.connectedAgentId,
      agents,
      phoneNumbers,
      voices,
      hiddenAgentIds: context.hiddenAgentIds,
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
    };
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
    if (!agent || !agent.enabled || agent.runtimeTokenHash !== tokenHash) return null;
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
    const [variables, fields, services] = await Promise.all([
      ctx.db
        .query("voiceAgentVariables")
        .withIndex("by_org_agent", (q) =>
          q.eq("orgId", args.orgId).eq("retellAgentId", args.retellAgentId),
        )
        .collect(),
      ctx.db.query("contactFields").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect(),
      ctx.db.query("services").withIndex("by_org", (q) => q.eq("orgId", args.orgId)).collect(),
    ]);
    const fieldsById = new Map(fields.map((field) => [String(field._id), field]));
    return {
      business: {
        name: org.name,
        timezone: org.timezone,
        language: org.language,
      },
      caller: customer
        ? {
            known: true,
            name: [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim(),
            phone: customer.phone,
            language: customer.language ?? org.language,
          }
        : { known: false, phone: phone ?? args.phone },
      information: variables
        .sort((a, b) => a.order - b.order)
        .filter((variable) => variable.destination === "contact")
        .map((variable) => {
          const field = variable.contactFieldId
            ? fieldsById.get(String(variable.contactFieldId))
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
            currentValue: field && customer ? customer.custom?.[field.key] ?? null : null,
          };
        }),
      services: services
        .filter((service) => service.active)
        .map((service) => ({
          key: serviceKey(service),
          name: service.name,
          durationMinutes: service.durationMinutes,
        })),
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
async function matchService(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  spoken: string,
): Promise<{
  serviceId: Id<"services">;
  name: string;
  price?: number;
  durationMinutes: number;
} | undefined> {
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
    durationMinutes: hit.service.durationMinutes,
  };
}

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
    service: v.optional(v.string()),
  },
  // The matched name goes back to the agent so it can read the booking back
  // to the caller in the salon's own vocabulary — and so a miss is visible to
  // whoever is reading the call rather than silent.
  returns: v.object({
    appointmentId: v.id("appointments"),
    serviceName: v.optional(v.string()),
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
    }
    if (!customer) throw new Error("customer-failed");
    const line = args.service
      ? await matchService(ctx, args.orgId, args.service)
      : undefined;
    const appointmentId = await ctx.db.insert("appointments", {
      orgId: args.orgId,
      customerId: customer._id,
      startAt: args.startAt,
      // The service's own duration wins over anything the call reported: it is
      // what the salon says the work takes, and the block staff read.
      durationMinutes: line?.durationMinutes ?? args.durationMinutes,
      items: line ? [line] : undefined,
      status: "scheduled",
      source: "voice",
      externalUid: args.externalUid,
    });
    await syncAppointmentSchedule(ctx, appointmentId);
    await scheduleConfirmationIfConfigured(ctx, args.orgId, appointmentId);
    return { appointmentId, serviceName: line?.name };
  },
});

// Cancel and reschedule are split into a lookup and a write because a Convex
// mutation cannot reach the network, and cal.com has to be told first: it owns
// the slot inventory, the salon's Google Calendar and the notification emails.
// The old single mutation patched status locally and stopped, so Randevu said
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
// No dial code passed, deliberately. A caller ID arrives from the carrier
// already international, and a number the caller SPELLS OUT mid-call is
// transcribed speech that could be anything — neither is a case where
// attaching the salon's country to a bare string is safe. The cal.com path
// does pass one because there the digits came off a form the customer filled
// in themselves (lib/phone.ts).
function toE164(raw: string): string | null {
  return normalisePhone(raw);
}

// The single mapping both voice write paths share: the mid-call function and
// the post-call webhook. Two copies of this guard would drift.
export async function applyVoiceContactValues(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    phone: string;
    values: Record<string, string>;
    fillOnlyMissing?: boolean;
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

  const custom = { ...(customer.custom ?? {}) };
  const updated: string[] = [];
  const updatedLabels: string[] = [];
  const ignored: string[] = [];
  const notForVoice: string[] = [];
  const rejected: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(args.values)) {
    const key = rawKey.trim();
    if (!key) continue;
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
  if (updated.length > 0) await ctx.db.patch(customer._id, { custom });
  return { ok: true, updated, updatedLabels, ignored, notForVoice, rejected };
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
    const phone = toE164(args.phone);
    if (!phone) return contactUpdateFailure("phone-not-recognised");
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
    return await applyVoiceContactValues(ctx, {
      orgId: agent.orgId,
      phone,
      values: args.values,
      fillOnlyMissing: args.fillOnlyMissing,
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
    collected: v.optional(v.record(v.string(), v.any())),
    disconnectionReason: v.optional(v.string()),
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
    const callerPhone = args.fromNumber ? toE164(args.fromNumber) : null;
    if (callerPhone) {
      const customer = await ctx.db
        .query("customers")
        .withIndex("by_org_phone", (q) =>
          q.eq("orgId", agent.orgId).eq("phone", callerPhone),
        )
        .unique();
      customerId = customer?._id;
      if (!customerId) {
        customerId = await ctx.db.insert("customers", {
          orgId: agent.orgId,
          firstName: "",
          phone: callerPhone,
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
      direction: "inbound",
      retellAgentId: args.retellAgentId,
      fromNumber: args.fromNumber,
      startedAt: args.startedAt,
      durationSec: args.durationSec,
      outcome: args.outcome,
      summary: args.summary,
      transcript: args.transcript,
      recordingUrl: args.recordingUrl,
      retellCallId: args.retellCallId,
      collected: args.collected,
      disconnectionReason: args.disconnectionReason,
    });
    return null;
  },
});
