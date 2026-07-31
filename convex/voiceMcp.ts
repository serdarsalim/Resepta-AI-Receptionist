// Runtime MCP surface for a phone agent. This is intentionally separate from
// the user-facing /mcp connector: a phone agent acts as the connected agent,
// not as a staff member, and receives only the two customer-context tools it
// needs during a conversation.

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import {
  bearer,
  jsonResponse,
  NOT_STREAMABLE_HTTP,
  serveMcp,
  str,
  type ToolDef,
} from "./lib/mcpProtocol";
import { voiceValuesFromToolArgs } from "./lib/voicePayload";
import {
  agentFromVoiceRuntimeToken,
  hashVoiceRuntimeToken,
} from "./lib/voiceRuntime";

const SERVER_INFO = { name: "randevu-phone-agent", version: "1.0.0" };

type Who = {
  orgId: Id<"orgs">;
  retellAgentId: string;
};

const TOOLS: ToolDef<ActionCtx, Who>[] = [
  {
    name: "get_call_context",
    title: "Get the latest customer and business context",
    description:
      "Read the latest Randevu record for this caller, the information this business wants collected, and its active services. Call this before asking for customer details. For a phone call, pass the system {{user_number}} value as phone.",
    inputSchema: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Caller number in international form. Use {{user_number}}.",
        },
      },
      required: ["phone"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, args, who) => {
      const phone = str(args, "phone");
      if (!phone) throw new Error("phone is required");
      return await ctx.runQuery(internal.retell.runtimeCallContext, {
        orgId: who.orgId,
        retellAgentId: who.retellAgentId,
        phone,
      });
    },
  },
  {
    name: "save_customer_details",
    title: "Save details the caller provided",
    description:
      "Save information immediately after the caller provides or explicitly confirms it. Use only keys returned by get_call_context. Never guess a value. For a phone call, pass {{user_number}} as phone. Repeating the same save is safe.",
    inputSchema: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Caller number in international form. Use {{user_number}}.",
        },
        values: {
          type: "object",
          description: "Configured information key to the caller-confirmed value.",
          additionalProperties: {
            anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
          },
        },
      },
      required: ["phone", "values"],
      additionalProperties: false,
    },
    annotations: { idempotentHint: true },
    handler: async (ctx, args, who) => {
      const phone = str(args, "phone");
      if (!phone) throw new Error("phone is required");
      const values = voiceValuesFromToolArgs(args);
      if (Object.keys(values).length === 0) throw new Error("values are required");
      const result = await ctx.runMutation(internal.retell.updateContactFromVoice, {
        retellAgentId: who.retellAgentId,
        phone,
        values,
      });
      if (!result.ok) return { saved: false, reason: result.reason };
      return {
        saved: result.updated.length > 0,
        updated: result.updated,
        rejected: result.rejected,
        ignored: result.ignored,
      };
    },
  },
];

export const handler = httpAction(async (ctx, req) => {
  if (req.method === "GET") return jsonResponse(NOT_STREAMABLE_HTTP, 405);
  if (req.method !== "POST") return jsonResponse({ error: "method-not-allowed" }, 405);

  const token = bearer(req);
  const agentId = agentFromVoiceRuntimeToken(token);
  if (!agentId) return jsonResponse({ error: "invalid-key" }, 401, "randevu-phone-agent");
  const tokenHash = await hashVoiceRuntimeToken(token);
  const who = await ctx.runQuery(internal.retell.verifyRuntimeToken, {
    retellAgentId: agentId,
    tokenHash,
  });
  if (!who) return jsonResponse({ error: "invalid-key" }, 401, "randevu-phone-agent");

  return await serveMcp<ActionCtx, Who>(ctx, req, who, {
    tools: TOOLS,
    serverInfo: SERVER_INFO,
    instructions:
      "Randevu is the source of truth. Read call context before collecting customer information. Save only details the caller actually provided or confirmed, using the exact configured keys. Never invent or infer a value during the live call; post-call reconciliation handles missed information separately.",
  });
});
