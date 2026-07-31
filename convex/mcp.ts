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

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "randevu", version: "1.0.0" };

// Claude.ai/Desktop cuts a tool result near 150k characters, Claude Code at 25k
// tokens. Blowing the cap mangles the result rather than failing loudly, so
// clamping happens here instead of each tool being trusted to behave.
const MAX_RESULT_CHARS = 100_000;

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

type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  handler: (ctx: ActionCtx, args: Record<string, unknown>, who: Who) => Promise<unknown>;
};

const str = (a: Record<string, unknown>, k: string): string | undefined => {
  const val = a[k];
  return typeof val === "string" && val.trim() ? val.trim() : undefined;
};
const num = (a: Record<string, unknown>, k: string): number | undefined => {
  const val = a[k];
  return typeof val === "number" && Number.isFinite(val) ? val : undefined;
};

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

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

type RpcId = string | number | null;
const rpcResult = (id: RpcId, result: unknown) => ({ jsonrpc: "2.0", id, result }) as const;
const rpcError = (id: RpcId, code: number, message: string) =>
  ({ jsonrpc: "2.0", id, error: { code, message } }) as const;

// Convex wraps a throw as "Uncaught Error: <msg>\n    at handler (…)". The model
// reads all of it and starts reasoning about our file paths, burying the
// sentence the tool wrote on purpose. Keep the sentence, drop the frame.
function cleanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return (
    raw
      .replace(/^\s*Uncaught\s+(ConvexError|Error):\s*/i, "")
      .split(/\n\s*at\s/)[0]
      .trim() || "The request failed."
  );
}

function toolContent(value: unknown) {
  let text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length > MAX_RESULT_CHARS) {
    text =
      text.slice(0, MAX_RESULT_CHARS) +
      `\n\n[truncated at ${MAX_RESULT_CHARS} characters — narrow the query and ask again; this is not the complete result]`;
  }
  return { content: [{ type: "text", text }] };
}

async function handleRpc(
  ctx: ActionCtx,
  msg: Record<string, unknown>,
  who: Who,
): Promise<object | null> {
  const id = (msg.id ?? null) as RpcId;
  const method = String(msg.method ?? "");
  if (method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: `You are connected to ${who.orgName}, an appointment business. Everything you do is recorded in their activity feed against ${who.userName}, and reversible actions can be undone. Read before you write — check a customer's history before logging a note about it. Never invent a customer id; search first.`,
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        })),
      });
    case "tools/call": {
      const params = (msg.params ?? {}) as Record<string, unknown>;
      const name = String(params.name ?? "");
      const tool = TOOL_BY_NAME.get(name);
      // A result, not a transport error: a JSON-RPC error reads to the model as
      // "the server broke", where this reads as "that name does not exist, here
      // are the ones that do" — actionable in the same turn.
      if (!tool) {
        return rpcResult(id, {
          content: [
            {
              type: "text",
              text: `Error: no tool named "${name}". Available: ${TOOLS.map((t) => t.name).join(", ")}`,
            },
          ],
          isError: true,
        });
      }
      try {
        const out = await tool.handler(ctx, (params.arguments ?? {}) as Record<string, unknown>, who);
        return rpcResult(id, toolContent(out));
      } catch (e: unknown) {
        return rpcResult(id, {
          content: [{ type: "text", text: `Error: ${cleanError(e)}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function bearer(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  // Claude's request-header auth allowlists x-api-key, and it is what a curl
  // smoke test reaches for first.
  return req.headers.get("x-api-key")?.trim() ?? "";
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(status === 401
        ? { "www-authenticate": 'Bearer realm="randevu", error="invalid_token"' }
        : {}),
    },
  });

export const handler = httpAction(async (ctx, req) => {
  if (req.method === "GET") {
    // A bare GET is a client probing for the deprecated SSE transport. Say so,
    // rather than 404ing, which reads as a wrong URL.
    return json(
      { error: "This endpoint speaks Streamable HTTP. POST JSON-RPC 2.0 here." },
      405,
    );
  }
  if (req.method !== "POST") return json({ error: "method-not-allowed" }, 405);

  const key = bearer(req);
  if (!key) return json({ error: "missing-key" }, 401);
  const who = await ctx.runQuery(internal.mcpKeys.verify, { key });
  if (!who) return json({ error: "invalid-key" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  // Fire-and-forget so logging never delays the response.
  await ctx.scheduler.runAfter(0, internal.mcpKeys.stampUsed, {
    connectionId: who.connectionId,
  });

  if (Array.isArray(body)) {
    const out = (
      await Promise.all(body.map((m) => handleRpc(ctx, m as Record<string, unknown>, who)))
    ).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const res = await handleRpc(ctx, body as Record<string, unknown>, who);
  return res ? json(res) : new Response(null, { status: 202 });
});

// So the settings UI can show what a connected client can do without keeping a
// second copy of the registry in the frontend.
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
