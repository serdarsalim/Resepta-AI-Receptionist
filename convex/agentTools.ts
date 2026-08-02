// The data layer behind the MCP surface. Every function here takes orgId and
// the acting person EXPLICITLY, because the MCP door has no session: the
// workspace and the user come off the key (see mcpKeys.verify, which re-checks
// membership), not from requireOrg.
//
// That is the one structural difference from the rest of the backend, and it is
// why these live apart from customers.ts / appointments.ts rather than being
// extra args on the mutations already there. Mixing "trust the cookie" and
// "trust the key" inside one function is how a scoping bug gets written.
//
// Two rules, same as the Nudge side:
//   1. before/after capture ONLY the keys a tool wrote. A whole-document
//      snapshot means an undo silently reverts a stylist's edit made in between.
//   2. Undo goes forward through the same write path, never a raw patch.

import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { recordActivity } from "./lib/activity";
import { connectionField } from "./lib/connections";
import { RESERVED_CONTACT_KEYS, keyFromLabel, normaliseKey, uniqueKey } from "./lib/keys";
import { serviceKey } from "./services";

const scope = {
  orgId: v.id("orgs"),
  userId: v.id("users"),
  connectionId: v.id("mcpConnections"),
} as const;

// Every read and write goes through this. Fetching by id and THEN comparing the
// org is the whole guard: without it a customer id from another salon would
// resolve happily, and the tool would answer questions about a business the
// caller has nothing to do with.
async function customerInOrg(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  customerId: string,
): Promise<Doc<"customers">> {
  const row = await ctx.db.get(customerId as Id<"customers">).catch(() => null);
  if (!row || row.orgId !== orgId) throw new Error("No customer with that id.");
  return row;
}

function fullName(c: Doc<"customers">): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.phone;
}

async function journal(
  ctx: MutationCtx,
  a: {
    orgId: Id<"orgs">;
    connectionId: Id<"mcpConnections">;
    userId: Id<"users">;
    tool: string;
    args: unknown;
    targetTable: string;
    targetId: string;
    before: unknown;
    after: unknown;
    reversible: boolean;
  },
): Promise<Id<"agentActions">> {
  return await ctx.db.insert("agentActions", {
    orgId: a.orgId,
    connectionId: a.connectionId,
    userId: a.userId,
    tool: a.tool,
    args: JSON.stringify(a.args),
    targetTable: a.targetTable,
    targetId: a.targetId,
    before: JSON.stringify(a.before),
    after: JSON.stringify(a.after),
    at: Date.now(),
    reversible: a.reversible,
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

export const searchCustomers = internalQuery({
  args: { orgId: v.id("orgs"), query: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { orgId, query, limit }) => {
    const take = Math.min(Math.max(limit ?? 20, 1), 50);
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const needle = query?.trim().toLowerCase();
    // Diacritics fold, because a salon's book is full of names a phone keyboard
    // will not reproduce exactly — searching "gul" has to find "Gül".
    const fold = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const matched = needle
      ? rows.filter((c) => {
          const hay = fold(`${c.firstName} ${c.lastName ?? ""} ${c.phone} ${c.email ?? ""}`);
          return hay.includes(fold(needle));
        })
      : rows;
    return {
      count: Math.min(matched.length, take),
      totalMatches: matched.length,
      customers: matched.slice(0, take).map((c) => ({
        id: c._id,
        name: fullName(c),
        phone: c.phone,
        email: c.email ?? null,
        muted: !!c.mutedAt,
      })),
    };
  },
});

export const getCustomer = internalQuery({
  args: { orgId: v.id("orgs"), customerId: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, customerId }) => {
    const c = await ctx.db.get(customerId as Id<"customers">).catch(() => null);
    if (!c || c.orgId !== orgId) throw new Error("No customer with that id.");
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_customer", (q) => q.eq("customerId", c._id))
      .order("desc")
      .take(10);
    const appts = await ctx.db
      .query("appointments")
      .withIndex("by_customer", (q) => q.eq("customerId", c._id))
      .order("desc")
      .take(10);
    return {
      id: c._id,
      name: fullName(c),
      firstName: c.firstName,
      lastName: c.lastName ?? null,
      phone: c.phone,
      email: c.email ?? null,
      language: c.language ?? null,
      muted: !!c.mutedAt,
      custom: c.custom ?? {},
      notes: notes.map((n) => ({
        id: n._id,
        body: n.body,
        at: new Date(n._creationTime).toISOString(),
        edited: !!n.editedAt,
      })),
      appointments: appts.map((a) => ({
        id: a._id,
        startAt: new Date(a.startAt).toISOString(),
        status: a.status,
        durationMinutes: a.durationMinutes ?? null,
        services: (a.items ?? []).map((i) => i.name),
      })),
    };
  },
});

export const schedule = internalQuery({
  args: { orgId: v.id("orgs"), days: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { orgId, days }) => {
    const span = Math.min(Math.max(days ?? 7, 1), 60);
    const now = Date.now();
    const until = now + span * 86_400_000;
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startAt", now).lte("startAt", until),
      )
      .collect();
    const customerIds = [...new Set(rows.map((r) => r.customerId))];
    const names = new Map(
      (await Promise.all(customerIds.map((id) => ctx.db.get(id)))).flatMap((c) =>
        c ? [[c._id, fullName(c)] as const] : [],
      ),
    );
    // Counted here rather than handed over as rows to tally. Same reason as the
    // Nudge reports: a model asked to count a list it can only partly see will
    // produce a number, and the number will be wrong.
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return {
      from: new Date(now).toISOString(),
      days: span,
      total: rows.length,
      byStatus,
      appointments: rows
        .sort((a, b) => a.startAt - b.startAt)
        .slice(0, 100)
        .map((a) => ({
          id: a._id,
          customer: names.get(a.customerId) ?? "(deleted)",
          customerId: a.customerId,
          startAt: new Date(a.startAt).toISOString(),
          status: a.status,
          services: (a.items ?? []).map((i) => i.name),
        })),
      ...(rows.length > 100
        ? { truncated: `Showing the first 100 of ${rows.length}; narrow the window.` }
        : {}),
    };
  },
});

// ── Writes ───────────────────────────────────────────────────────────────────

export const addNote = internalMutation({
  args: { ...scope, customerId: v.string(), body: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, customerId, body }) => {
    const text = body.trim();
    if (!text) throw new Error("The note is empty.");
    const customer = await customerInOrg(ctx, orgId, customerId);
    const noteId = await ctx.db.insert("notes", {
      orgId,
      customerId: customer._id,
      body: text,
      authorId: userId,
    });
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "add_note",
      args: { customerId, body: text },
      targetTable: "notes",
      targetId: noteId,
      // The note did not exist. That is a real prior state, not a missing one.
      before: null,
      after: { body: text },
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "note_added",
      customerId: customer._id,
      detail: text.length > 120 ? `${text.slice(0, 117)}…` : text,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { noteId, actionId, customerName: fullName(customer) };
  },
});

const EDITABLE = ["firstName", "lastName", "phone", "email", "language"] as const;
type Editable = (typeof EDITABLE)[number];

export const updateCustomer = internalMutation({
  args: { ...scope, customerId: v.string(), fields: v.record(v.string(), v.string()) },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, customerId, fields }) => {
    const customer = await customerInOrg(ctx, orgId, customerId);
    const before: Record<string, string | null> = {};
    const after: Record<string, string> = {};
    for (const [rawKey, rawVal] of Object.entries(fields)) {
      const key = rawKey.trim() as Editable;
      if (!EDITABLE.includes(key)) {
        throw new Error(
          `"${rawKey}" is not editable here. Editable: ${EDITABLE.join(", ")}.`,
        );
      }
      const value = rawVal.trim();
      const prior = (customer[key] ?? "") as string;
      if (prior === value) continue;
      // A customer with no phone cannot be messaged, and messaging is the whole
      // product. Refusing beats writing a row the reminder job will skip
      // forever without telling anyone.
      if (key === "phone" && !value) throw new Error("A customer must keep a phone number.");
      if (key === "firstName" && !value) throw new Error("A customer must keep a first name.");
      before[key] = prior || null;
      after[key] = value;
    }
    const changed = Object.keys(after);
    if (changed.length === 0) {
      throw new Error("Nothing to change — those are the values it already has.");
    }
    await ctx.db.patch(customer._id, after as Partial<Doc<"customers">>);
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "update_customer",
      args: { customerId, fields: after },
      targetTable: "customers",
      targetId: customer._id,
      before,
      after,
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "customer_updated",
      customerId: customer._id,
      detail: `Updated ${changed.join(", ")}`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { actionId, customerName: fullName(customer), changed };
  },
});

// ── Configuration ────────────────────────────────────────────────────────────
// Setting the business up, rather than running it day to day. These exist
// because a connector that can read a salon's book but cannot give it a
// service list or a phone agent is a reporting tool, not a control surface —
// and the setup is exactly the part somebody wants done FOR them.
//
// The permission split mirrors the app exactly: services.create takes any
// member, contactFields.create and phone-agent provisioning take an owner.
// It is re-derived from `memberships` here rather than read off the key,
// because the connector must not become a way around the app's own rules.

async function assertOwner(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  userId: Id<"users">,
  what: string,
): Promise<void> {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", orgId))
    .unique();
  if (!membership || membership.role !== "owner") {
    throw new Error(`Only an owner can ${what}.`);
  }
}

export const listServices = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.any(),
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.get(orgId);
    const rows = await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return {
      // Prices are minor units OF THIS. A bare integer is not an amount
      // anybody can read back to a caller.
      currency: org?.currency ?? null,
      services: rows.map((row) => ({
        id: row._id,
        name: row.name,
        key: serviceKey(row),
        durationMinutes: row.durationMinutes,
        active: row.active,
        price: row.price ?? null,
      })),
    };
  },
});

export const listContactFields = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.any(),
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .sort((a, b) => a.order - b.order)
      .map((row) => ({
        id: row._id,
        key: row.key,
        label: row.label,
        type: row.type,
        options: row.options ?? null,
        filledBy: row.source === "voice" ? "voice agent" : "staff",
      }));
  },
});

export const listPhoneAgents = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.any(),
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query("retellAgents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.map((row) => ({
      id: row._id,
      name: row.name,
      enabled: row.enabled,
      inboundNumber: row.inboundNumber ?? null,
      // Whether Randevu's private runtime is published to it. An agent without
      // this can take a call but cannot read or write customer data.
      runtimeConnected: row.runtimeConnectedAt !== undefined,
      lastCallAt: row.lastCallEventAt ? new Date(row.lastCallEventAt).toISOString() : null,
    }));
  },
});

export const createService = internalMutation({
  args: {
    ...scope,
    name: v.string(),
    durationMinutes: v.number(),
    price: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, name, durationMinutes, price }) => {
    const label = name.trim();
    if (!label) throw new Error("A service needs a name.");
    const rows = await ctx.db
      .query("services")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    // Case-folded: "Saç kesimi" and "saç kesimi" are one service to a caller,
    // and two rows the voice agent would have to choose between.
    if (rows.some((row) => row.name.trim().toLowerCase() === label.toLowerCase())) {
      throw new Error(`"${label}" already exists.`);
    }
    const taken = new Set(rows.map(serviceKey));
    const base = keyFromLabel(label) || `service_${taken.size + 1}`;
    const key = uniqueKey(base, taken);
    const duration = Math.max(5, Math.round(durationMinutes));
    const amount = price === undefined ? undefined : Math.max(0, Math.round(price));
    const serviceId = await ctx.db.insert("services", {
      orgId,
      name: label,
      key,
      durationMinutes: duration,
      active: true,
      ...(amount !== undefined ? { price: amount } : {}),
    });
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "create_service",
      args: { name: label, durationMinutes: duration, price: amount ?? null },
      targetTable: "services",
      targetId: serviceId,
      before: null,
      after: { name: label, key },
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `Added the service "${label}" (${duration} min)`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { serviceId, key, name: label, actionId };
  },
});

export const createContactField = internalMutation({
  args: {
    ...scope,
    label: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("select"),
      v.literal("number"),
      v.literal("date"),
    ),
    options: v.optional(v.array(v.string())),
    source: v.optional(v.union(v.literal("manual"), v.literal("voice"))),
    key: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgId, userId, connectionId } = args;
    await assertOwner(ctx, orgId, userId, "add contact fields");
    const label = args.label.trim();
    if (!label) throw new Error("A field needs a label.");
    const key = args.key?.trim() ? normaliseKey(args.key) : keyFromLabel(label);
    if (!key) throw new Error("That label does not produce a usable key.");
    if (RESERVED_CONTACT_KEYS.has(key)) {
      throw new Error(
        `"${key}" is reserved. Name, phone, email and consent already exist and cannot be redefined.`,
      );
    }
    const existing = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (existing.some((row) => row.key === key)) {
      throw new Error(`A field already addresses "${key}".`);
    }
    const options =
      args.type === "select"
        ? (args.options ?? []).map((o) => o.trim()).filter(Boolean)
        : undefined;
    // A select with no choices is a field the agent can never fill.
    if (args.type === "select" && (!options || options.length === 0)) {
      throw new Error("A select field needs at least one option.");
    }
    const fieldId = await ctx.db.insert("contactFields", {
      orgId,
      key,
      label,
      type: args.type,
      options,
      order: existing.length,
      source: args.source === "voice" ? "voice" : undefined,
    });
    const filledBy = args.source === "voice" ? "voice agent" : "staff";
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "create_contact_field",
      args: { label, type: args.type, source: args.source ?? "manual" },
      targetTable: "contactFields",
      targetId: fieldId,
      before: null,
      after: { key, label },
      reversible: true,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `Added the contact field "${label}", filled by ${filledBy}`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { fieldId, key, label, filledBy, actionId };
  },
});

// The org's provider credentials, for the action that provisions. Every other
// context query in retell.ts resolves the org from a session or from a
// globally unique agent id; this one is handed the org, because the connector
// already knows it and there is no agent yet to look one up from.
export const phoneAgentContext = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: v.object({
    demoMode: v.boolean(),
    apiKey: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.get(orgId);
    return {
      demoMode: org?.demoMode === true,
      apiKey: await connectionField(ctx, orgId, "retell", "apiKey"),
    };
  },
});

// Owner check for the phone-agent paths, which cannot use assertOwner: they run
// from an ACTION (the provider is talked to over the network), and an action
// has no database handle of its own.
export const assertCanProvision = internalQuery({
  args: { orgId: v.id("orgs"), userId: v.id("users"), what: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { orgId, userId, what }) => {
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", orgId))
      .unique();
    if (!membership || membership.role !== "owner") {
      throw new Error(`Only an owner can ${what ?? "create a phone agent"}.`);
    }
    return null;
  },
});

// Agents are addressed by their RANDEVU id, the one list_phone_agents returns.
// The provider's id is deliberately not the handle: "Retell is an
// implementation detail" is a product rule, and a connector that made owners
// pass provider ids around would be the loudest possible violation of it.
export const resolvePhoneAgent = internalQuery({
  args: { orgId: v.id("orgs"), agentId: v.string() },
  returns: v.object({ retellAgentId: v.string(), name: v.string() }),
  handler: async (ctx, { orgId, agentId }) => {
    const row = await ctx.db.get(agentId as Id<"retellAgents">).catch(() => null);
    if (!row || row.orgId !== orgId) {
      throw new Error("No phone agent with that id. Use list_phone_agents to get one.");
    }
    // `name` is optional on the row: an agent adopted through Connect existing
    // carries the provider's name only once something has read it back.
    return { retellAgentId: row.retellAgentId, name: row.name ?? "this agent" };
  },
});

export const listAgentVariables = internalQuery({
  args: { orgId: v.id("orgs"), agentId: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, agentId }) => {
    const agent = await ctx.db.get(agentId as Id<"retellAgents">).catch(() => null);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("No phone agent with that id. Use list_phone_agents to get one.");
    }
    const rows = await ctx.db
      .query("voiceAgentVariables")
      .withIndex("by_org_agent", (q) =>
        q.eq("orgId", orgId).eq("retellAgentId", agent.retellAgentId),
      )
      .collect();
    return {
      agent: agent.name,
      publishedAt: agent.variablesSyncedAt
        ? new Date(agent.variablesSyncedAt).toISOString()
        : null,
      variables: rows
        .sort((a, b) => a.order - b.order)
        .map((row) => ({
          key: row.key,
          label: row.label,
          // Where the answer goes. "contact" writes it to a property on the
          // customer card, "customer" to the card's own name or email, and
          // "call" keeps it on the call record only.
          destination: row.destination,
          ...(row.customerField ? { customerField: row.customerField } : {}),
          asks:
            row.duringMode === "confirm"
              ? "confirms the current value"
              : row.duringMode === "if_missing"
                ? "asks when missing"
                : "does not ask",
        })),
    };
  },
});

// Turning a list of field keys into a valid variable set. The caller names
// fields; everything validateVariables insists on — the contactFieldId link,
// the key matching the field's, enum choices coming from the field's options —
// is derived here rather than asked for, because every one of those is a
// publish error waiting to happen and none of them is a decision.
//
// business_name is ALWAYS included and that is not decoration: publishing
// rebuilds the provider's default dynamic variables from this set alone, so a
// set without it silently blanks {{business_name}} and the agent opens by
// greeting nobody.
export const buildAgentVariables = internalQuery({
  args: {
    orgId: v.id("orgs"),
    fieldKeys: v.array(v.string()),
    // Field key → the instruction the agent follows for that one value. Left
    // out, publishing substitutes "Capture <label> when the caller provides
    // it", which is enough to work and not enough to be good: it is the only
    // place to say "map what they describe onto these options, do not read the
    // list aloud", and an enum without that gets read aloud.
    descriptions: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, fieldKeys, descriptions }) => {
    const fields = await ctx.db
      .query("contactFields")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const byKey = new Map(fields.map((field) => [field.key, field]));

    const variables: Record<string, unknown>[] = [
      {
        key: "business_name",
        label: "Business name",
        description: "",
        type: "string",
        required: false,
        beforeSource: "business_name",
        duringMode: "none",
        afterCall: false,
        destination: "call",
      },
      {
        key: "customer_name",
        label: "Caller name",
        description: "",
        type: "string",
        required: false,
        beforeSource: "customer_name",
        duringMode: "if_missing",
        afterCall: true,
        // Onto the customer, not the call. Every agent built through this tool
        // used to ask a first-time caller their name and drop it, leaving a
        // record with a phone number and nothing else on it.
        destination: "customer",
        customerField: "name",
      },
    ];

    const missing: string[] = [];
    const notVoice: string[] = [];
    for (const key of fieldKeys) {
      if (key === "business_name" || key === "customer_name") continue;
      const field = byKey.get(key);
      if (!field) {
        missing.push(key);
        continue;
      }
      // A field staff fill in is not one the agent may write. The runtime
      // refuses it too; refusing here says why while it can still be fixed.
      if (field.source !== "voice") {
        notVoice.push(key);
        continue;
      }
      variables.push({
        key: field.key,
        label: field.label,
        description: (descriptions?.[field.key] ?? "").trim(),
        type:
          field.type === "select" ? "enum" : field.type === "number" ? "number" : "string",
        ...(field.type === "select" ? { choices: field.options ?? [] } : {}),
        required: false,
        // The repeat-caller path the picker wires by hand in the app: read the
        // stored value before the call, only ask when it is missing, write the
        // answer back to the same field.
        beforeSource: "contact_field",
        beforeFieldId: field._id,
        duringMode: "if_missing",
        afterCall: true,
        destination: "contact",
        contactFieldId: field._id,
      });
    }
    if (missing.length > 0) {
      throw new Error(
        `No contact field with key: ${missing.join(", ")}. Use list_contact_fields to see them.`,
      );
    }
    if (notVoice.length > 0) {
      throw new Error(
        `These fields are filled by staff, not the phone agent: ${notVoice.join(", ")}. Create them with filledBy "voice" to have the agent collect them.`,
      );
    }
    return variables;
  },
});

// reversible:false for the same reason as every other provider write: putting
// the line back is another routing change, not an undo of this one. The feed
// still names both agents so it is obvious what moved.
export const recordLineAssigned = internalMutation({
  args: {
    ...scope,
    retellAgentId: v.string(),
    agentName: v.string(),
    number: v.union(v.string(), v.null()),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, retellAgentId, agentName, number }) => {
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "assign_phone_number",
      args: { retellAgentId, number },
      targetTable: "retellAgents",
      targetId: retellAgentId,
      before: null,
      after: { number: number ?? "" },
      reversible: false,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: number
        ? `${number} now rings "${agentName}"`
        : `"${agentName}" no longer answers an inbound line`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { actionId };
  },
});

// Journalled reversible:false. The publish already created a version at the
// provider; putting the old set back means publishing ANOTHER version, which
// is a new action rather than an undo of this one.
export const recordVariablesPublished = internalMutation({
  args: { ...scope, retellAgentId: v.string(), agentName: v.string(), keys: v.array(v.string()) },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, retellAgentId, agentName, keys }) => {
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "set_agent_variables",
      args: { retellAgentId, keys },
      targetTable: "voiceAgentVariables",
      targetId: retellAgentId,
      before: null,
      after: { keys: keys.join(", ") },
      reversible: false,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `Set what "${agentName}" collects: ${keys.join(", ")}`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { actionId };
  },
});

// Journalled AFTER the provider call, never before: the agent is an external
// resource, so the only honest moment to record it is once it exists.
// reversible:false because nothing here can un-create it — `undo` says so in
// those words rather than failing on a missing branch.
export const recordAgentCreated = internalMutation({
  args: { ...scope, retellAgentId: v.string(), name: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, userId, connectionId, retellAgentId, name }) => {
    const row = await ctx.db
      .query("retellAgents")
      .withIndex("by_agent", (q) => q.eq("retellAgentId", retellAgentId))
      .unique();
    const actionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "create_phone_agent",
      args: { name },
      targetTable: "retellAgents",
      targetId: row?._id ?? retellAgentId,
      before: null,
      after: { name, retellAgentId },
      reversible: false,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: `Created the phone agent "${name}"`,
      agent: { actorId: userId, connectionId, agentActionId: actionId },
    });
    return { actionId, agentRowId: row?._id ?? null };
  },
});

// ── Undo ─────────────────────────────────────────────────────────────────────

export const undo = internalMutation({
  args: { ...scope, actionId: v.string() },
  returns: v.object({ summary: v.string() }),
  handler: async (ctx, { orgId, userId, connectionId, actionId }) => {
    const action = await ctx.db.get(actionId as Id<"agentActions">).catch(() => null);
    if (!action || action.orgId !== orgId) throw new Error("No such action.");
    if (action.undoneAt) throw new Error("That action was already undone.");
    if (!action.reversible) {
      throw new Error(
        `${action.tool} cannot be undone — it already left the building. Nothing was changed.`,
      );
    }

    const before = JSON.parse(action.before) as Record<string, string | null> | null;
    const after = JSON.parse(action.after) as Record<string, string>;
    let summary: string;

    if (action.tool === "add_note") {
      const note = await ctx.db.get(action.targetId as Id<"notes">).catch(() => null);
      if (!note || note.orgId !== orgId) throw new Error("That note is already gone.");
      await ctx.db.delete(note._id);
      summary = "Removed the note.";
    } else if (action.tool === "update_customer") {
      const customer = await customerInOrg(ctx, orgId, action.targetId);
      // The drift check. If a stylist edited the same field after the agent
      // did, restoring would throw THEIR work away — so refuse and name what
      // moved. Undo takes back your own change; it does not win races.
      const drifted = Object.entries(after).filter(
        ([k, wrote]) => ((customer[k as Editable] ?? "") as string) !== wrote,
      );
      if (drifted.length > 0) {
        throw new Error(
          `Refusing to undo: ${drifted
            .map(([k, wrote]) => `"${k}" now reads "${customer[k as Editable] ?? ""}", not "${wrote}"`)
            .join("; ")}. Someone changed it after this action, and undoing would discard their edit.`,
        );
      }
      // null in the journal means the field was UNSET, not empty. Restoring it
      // as "" would leave a customer whose email is an empty string rather than
      // absent — which reads the same in the UI and differently everywhere that
      // checks `if (customer.email)`. Patching undefined removes the field, so
      // undo puts the row back exactly as it was.
      const restore: Record<string, string | undefined> = {};
      for (const [k, prior] of Object.entries(before ?? {})) {
        restore[k] = prior === null ? undefined : prior;
      }
      await ctx.db.patch(customer._id, restore as Partial<Doc<"customers">>);
      summary = `Restored ${Object.keys(restore).join(", ")} on ${fullName(customer)}.`;
    } else if (action.tool === "create_service") {
      const service = await ctx.db.get(action.targetId as Id<"services">).catch(() => null);
      if (!service || service.orgId !== orgId) throw new Error("That service is already gone.");
      // Same drift rule as update_customer, for the same reason: if the salon
      // renamed or repriced it after the agent added it, deleting takes their
      // work with it. Undo takes back your own change; it does not win races.
      if (service.name !== after.name) {
        throw new Error(
          `Refusing to undo: the service now reads "${service.name}", not "${after.name}". Someone edited it after this action.`,
        );
      }
      await ctx.db.delete(service._id);
      summary = `Removed the service "${after.name}".`;
    } else if (action.tool === "create_contact_field") {
      const field = await ctx.db.get(action.targetId as Id<"contactFields">).catch(() => null);
      if (!field || field.orgId !== orgId) throw new Error("That field is already gone.");
      // The guard `contactFields.remove` applies, reached the same way: a field
      // an agent references leaves a dangling id in the variable registry, and
      // that agent's next publish dies on it.
      const variables = await ctx.db
        .query("voiceAgentVariables")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      const inUse = variables.some(
        (row) => row.contactFieldId === field._id || row.beforeFieldId === field._id,
      );
      if (inUse) {
        throw new Error(
          `Refusing to undo: "${field.label}" is now referenced by a phone agent. Unlink it there first.`,
        );
      }
      await ctx.db.delete(field._id);
      summary = `Removed the contact field "${field.label}".`;
    } else {
      throw new Error(`No undo is implemented for ${action.tool}.`);
    }

    const undoActionId = await journal(ctx, {
      orgId,
      connectionId,
      userId,
      tool: "undo",
      args: { actionId },
      targetTable: action.targetTable,
      targetId: action.targetId,
      before: after,
      after: before,
      reversible: false,
    });
    // Marked, never deleted: "changed, then put back" is the honest history,
    // and erasing half of it lies to whoever reads the feed next.
    await ctx.db.patch(action._id, {
      undoneAt: Date.now(),
      undoneByActionId: undoActionId,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "agent_undo",
      detail: summary,
      agent: { actorId: userId, connectionId, agentActionId: undoActionId },
    });
    return { summary };
  },
});

export const listRecent = internalQuery({
  args: {
    orgId: v.id("orgs"),
    connectionId: v.optional(v.id("mcpConnections")),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, connectionId, limit }) => {
    const take = Math.min(Math.max(limit ?? 20, 1), 100);
    const rows = connectionId
      ? await ctx.db
          .query("agentActions")
          .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
          .order("desc")
          .take(take)
      : await ctx.db
          .query("agentActions")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .order("desc")
          .take(take);
    return rows.map((r) => ({
      actionId: r._id,
      tool: r.tool,
      at: new Date(r.at).toISOString(),
      args: JSON.parse(r.args),
      canUndo: r.reversible && !r.undoneAt,
      undone: !!r.undoneAt,
    }));
  },
});
