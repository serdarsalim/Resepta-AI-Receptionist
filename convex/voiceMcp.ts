// Runtime MCP surface for a phone agent. This is intentionally separate from
// the user-facing /mcp connector: a phone agent acts as the connected agent,
// not as a staff member.
//
// LEGACY since template v10: no current agent engine references these tools.
// Retell's MCP transport cost a flat ~12 seconds of dead air per call on a
// live phone line, so save_customer_details now rides /retell/functions like
// every other tool, and withRuntimeSaveTool strips the MCP copy on any
// publish. This server stays up for agents whose owners have published
// nothing since v10 — their engines still hold the MCP tool and it must keep
// answering. Remove it only when no enabled agent predates v10.
//
// NO TOOL HERE KNOWS WHO IS CALLING (2026-10-13). Both tools used to take the
// caller's identity as a `phone` argument the model filled in from
// {{user_number}}, which made identity whatever the model was told: a caller
// reading out somebody else's number got that person's record read back and
// written to. /retell/functions now reads the caller from the call leg Retell
// signs (retell.callerOfCall). This transport carries no call at all, only the
// agent's bearer token: the MCP entry these agents were published with has an
// Authorization header and nothing per call, and the publish that could add
// one also removes these tools (retellAgent.withRuntimeSaveTool). So the
// business context still answers, nothing customer-specific does, and a save
// is refused. One publish moves an agent onto the custom function, which
// knows its caller.

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import {
  bearer,
  jsonResponse,
  NOT_STREAMABLE_HTTP,
  serveMcp,
  type ToolDef,
} from "./lib/mcpProtocol";
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
      "Read the information this business collects, who works here, and the local date and time right now. Who the caller is was given in your instructions before the call. Services and prices are NOT here and do not need to be: they are already in your instructions, injected before the call. Call this before turning anything the caller says about timing into a booking.",
    // No `phone` any more, and no additionalProperties lock: an engine
    // published before 2026-10-13 still sends the argument it was taught, and
    // that call must keep answering rather than fail validation. It is read
    // by nothing.
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, _args, who) => {
      const context = await ctx.runQuery(internal.retell.runtimeCallContext, {
        orgId: who.orgId,
        retellAgentId: who.retellAgentId,
      });
      // Stringified HERE rather than left to toolContent, which pretty-prints
      // with two-space indentation. That is right for the office MCP, whose
      // results a person may well end up reading, and wrong down a phone line:
      // this result stays in the conversation and is re-sent on every turn
      // that follows, so the indentation is a tax charged once per turn for
      // the rest of the call. Measured on a real one — 4141 characters, of
      // which 1225 were whitespace.
      //
      // toolContent passes a string through untouched, so this needs no change
      // to the vendored protocol file that both apps share.
      return JSON.stringify(context);
    },
  },
  {
    name: "save_customer_details",
    title: "Save details the caller provided",
    description:
      "Not available on this connection: details the caller gives cannot be saved during the call here. Do not tell the caller anything was saved.",
    inputSchema: {
      type: "object",
      properties: {
        values: {
          type: "object",
          description: "Configured information key to the caller-confirmed value.",
          additionalProperties: {
            anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
          },
        },
      },
    },
    annotations: { idempotentHint: true },
    // Refused, never written. The only identity this request carries is the
    // one the model typed into `phone`, and writing to whichever customer
    // owns that number is the hole this file closed (see the header). The
    // values still reach the record the way every call's do: the post-call
    // analysis, which identifies the caller from the call (voiceEvents →
    // retell.updateContactFromVoice, fill-only-missing).
    handler: async () => ({
      saved: false,
      reason: "caller-not-identified",
      message:
        "Saving is not available on this connection. Carry on with the call and do not say anything was saved.",
    }),
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
      "Resepta is the source of truth for what this business sells, what it charges and what time it is where it is. Quote prices only from the service list in your instructions, never from memory, and read the wording there aloud as written — it is already shaped for speech, with no symbols, abbreviations or thousands separators. Resolve every relative time the caller says against the local date and time this returns. Who the caller is was given in your instructions before the call; nothing here identifies a caller or saves to their record. Never invent or infer a value during the live call.",
  });
});
