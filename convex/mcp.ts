// The MCP control surface: one endpoint that lets a chat client (Claude,
// ChatGPT) read and act on ONE workspace as ONE person.
//
// Streamable HTTP carrying JSON-RPC 2.0. The legacy HTTP+SSE transport is being
// deprecated and is deliberately not implemented. Auth is a bearer key from
// mcpConnections; mcpKeys.verify turns it into an identity AND re-checks the
// membership, so a removed team member's connector stops working without anyone
// having to remember it exists.
//
// The tool annotations are half the safety model, and the free half: both
// Claude and ChatGPT treat a tool without readOnlyHint as a write and confirm
// with the user before running it. The other half — the journal and undo — is
// in agentTools.ts.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalQuery, type ActionCtx } from "./_generated/server";
import {
  bearer,
  jsonResponse,
  num,
  serveMcp,
  str,
  NOT_STREAMABLE_HTTP,
  type ToolDef as ProtocolToolDef,
} from "./lib/mcpProtocol";

const SERVER_INFO = { name: "randevu", version: "1.0.0" };

type Who = {
  connectionId: string;
  orgId: string;
  userId: string;
  name: string;
  client: string;
  userName: string;
  orgName: string;
  role: string;
  label: string;
};

type ToolDef = ProtocolToolDef<ActionCtx, Who>;

const TOOLS: ToolDef[] = [
  {
    name: "whoami",
    title: "Which salon am I connected to",
    description:
      "Confirm which workspace this connection points at and which person it acts as. Use this first if anything seems to be acting on the wrong business.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (_ctx, _args, who) => ({
      workspace: who.orgName,
      actingAs: who.userName,
      role: who.role,
      client: who.client,
      note: `Everything done here is recorded in the ${who.orgName} activity feed as "${who.label}".`,
    }),
  },
  {
    name: "search_customers",
    title: "Find a customer",
    description:
      "Search by name, phone or email. Accents fold, so 'gul' finds 'Gül'. Returns a compact list — use get_customer for one person's full record with their notes and appointments.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "Max results, 1-50. Default 20." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, args, who) =>
      await ctx.runQuery(internal.agentTools.searchCustomers, {
        orgId: who.orgId as never,
        query: str(args, "query"),
        limit: num(args, "limit"),
      }),
  },
  {
    name: "get_customer",
    title: "One customer in full",
    description:
      "Everything about one customer: details, their last ten notes and their last ten appointments. Read this before writing a note, so you are not guessing at what already happened.",
    inputSchema: {
      type: "object",
      properties: { customerId: { type: "string" } },
      required: ["customerId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, args, who) => {
      const customerId = str(args, "customerId");
      if (!customerId) throw new Error("customerId is required");
      return await ctx.runQuery(internal.agentTools.getCustomer, {
        orgId: who.orgId as never,
        customerId,
      });
    },
  },
  {
    name: "schedule",
    title: "What is coming up",
    description:
      "Upcoming appointments over the next N days with a per-status count. This is the tool for 'how does next week look' or 'how many no-shows' — do not try to answer those by listing customers.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days ahead, 1-60. Default 7." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, args, who) =>
      await ctx.runQuery(internal.agentTools.schedule, {
        orgId: who.orgId as never,
        days: num(args, "days"),
      }),
  },
  {
    name: "add_note",
    title: "Write a note on a customer",
    description:
      "Log what a customer said or wants — visible to everyone in the salon. Reversible: the result carries an actionId for undo.",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string" },
        body: { type: "string", description: "What a colleague would need to know." },
      },
      required: ["customerId", "body"],
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const customerId = str(args, "customerId");
      const body = str(args, "body");
      if (!customerId) throw new Error("customerId is required");
      if (!body) throw new Error("body is required");
      const res = await ctx.runMutation(internal.agentTools.addNote, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        customerId,
        body,
      });
      return {
        ok: true,
        note: `Added a note on ${res.customerName}.`,
        actionId: res.actionId,
        undoWith: `undo(actionId: "${res.actionId}")`,
      };
    },
  },
  {
    name: "update_customer",
    title: "Edit a customer's details",
    description:
      "Change firstName, lastName, phone, email or language. Pass only what should change. Reversible, with a drift check: if someone edits the same field after you, the undo refuses rather than discarding their work.",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string" },
        fields: {
          type: "object",
          description: "Field to new value. Only firstName, lastName, phone, email, language.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["customerId", "fields"],
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const customerId = str(args, "customerId");
      if (!customerId) throw new Error("customerId is required");
      const raw = args.fields;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("fields must be an object of field name to value");
      }
      const fields: Record<string, string> = {};
      for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
        fields[k] = val === null || val === undefined ? "" : String(val);
      }
      const res = await ctx.runMutation(internal.agentTools.updateCustomer, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        customerId,
        fields,
      });
      return {
        ok: true,
        note: `Updated ${res.changed.join(", ")} on ${res.customerName}.`,
        actionId: res.actionId,
        undoWith: `undo(actionId: "${res.actionId}")`,
      };
    },
  },
  {
    name: "undo",
    title: "Undo an earlier action",
    description:
      "Reverse something you did, by its actionId. Use recent_actions if you do not have the id. Refuses when someone has changed the same field since, because undoing would throw their edit away.",
    inputSchema: {
      type: "object",
      properties: { actionId: { type: "string" } },
      required: ["actionId"],
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const actionId = str(args, "actionId");
      if (!actionId) throw new Error("actionId is required");
      const res = await ctx.runMutation(internal.agentTools.undo, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        actionId,
      });
      return { ok: true, note: res.summary };
    },
  },
  {
    name: "recent_actions",
    title: "What have I changed",
    description:
      "Recent actions through this connection, newest first, each with the actionId needed to undo it. Use when asked what you changed, or told 'undo that' without a name.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        everyone: {
          type: "boolean",
          description: "Include actions by other people and clients in this workspace.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, args, who) => {
      const all = args.everyone === true;
      const actions = await ctx.runQuery(internal.agentTools.listRecent, {
        orgId: who.orgId as never,
        connectionId: all ? undefined : (who.connectionId as never),
        limit: num(args, "limit"),
      });
      return { scope: all ? who.orgName : `this connection (${who.name})`, actions };
    },
  },
];

export const handler = httpAction(async (ctx, req) => {
  if (req.method === "GET") return jsonResponse(NOT_STREAMABLE_HTTP, 405);
  if (req.method !== "POST") return jsonResponse({ error: "method-not-allowed" }, 405);

  const key = bearer(req);
  if (!key) return jsonResponse({ error: "missing-key" }, 401, "randevu");
  // verify re-checks `memberships`, so a removed team member's connector stops
  // working without anyone having to remember it exists.
  const who = await ctx.runQuery(internal.mcpKeys.verify, { key });
  if (!who) return jsonResponse({ error: "invalid-key" }, 401, "randevu");

  // Scheduled so logging never delays the response.
  await ctx.scheduler.runAfter(0, internal.mcpKeys.stampUsed, {
    connectionId: who.connectionId,
  });

  return await serveMcp<ActionCtx, Who>(ctx, req, who, {
    tools: TOOLS,
    serverInfo: SERVER_INFO,
    instructions: `You are connected to ${who.orgName}, an appointment business. Everything you do is recorded in their activity feed against ${who.userName}, and reversible actions can be undone. Read before you write — check a customer's history before logging a note about it. Never invent a customer id; search first.`,
  });
});


export const listTools = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      name: v.string(),
      title: v.string(),
      description: v.string(),
      readOnly: v.boolean(),
    }),
  ),
  handler: async () =>
    TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      readOnly: !!t.annotations.readOnlyHint,
    })),
});
