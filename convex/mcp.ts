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
import { planToken } from "./lib/planToken";
import { DELETE_CONFIRM_TTL_MS, deleteConfirmToken } from "./customerDeletion";
import type { VoiceVariableInput } from "./lib/voiceVariables";
import {
  bearer,
  jsonResponse,
  num,
  serveMcp,
  str,
  NOT_STREAMABLE_HTTP,
  type ToolDef as ProtocolToolDef,
} from "./lib/mcpProtocol";

const SERVER_INFO = { name: "randevu", version: "1.4.0" };

// Which lines went and which arrived. A whole-prompt dump makes a human scroll
// two screens to find the sentence that changed, and approve it without having
// read it — which defeats the point of showing them at all.
function lineDiff(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");
  const bSet = new Set(b);
  const aSet = new Set(a);
  const removed = a.filter((l) => !bSet.has(l) && l.trim());
  const added = b.filter((l) => !aSet.has(l) && l.trim());
  const CAP = 40;
  return {
    removed: removed.slice(0, CAP),
    added: added.slice(0, CAP),
    ...(removed.length > CAP || added.length > CAP
      ? { truncated: `Showing ${CAP} lines per side; the change is larger than that.` }
      : {}),
  };
}

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
  viaOperator: boolean;
};

type ToolDef = ProtocolToolDef<ActionCtx, Who>;

// Owner-gated at the handler, and therefore hidden from everyone else's tool
// list. Kept as a name set beside the array rather than a flag on each entry:
// the gate itself lives in the handler (assertOwner / assertCanProvision), and
// a second field would read like the thing doing the gating.
const OWNER_ONLY = new Set([
  "create_contact_field",
  "create_phone_agent",
  "assign_phone_number",
  "set_agent_variables",
  "publish_agent_prompt",
  "set_message_rule",
  "update_template",
]);

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
      // An operator's key is entitled by the platform allowlist rather than by
      // membership, and its writes appear to the salon as the brand. Saying so
      // matters: somebody using this key is working inside a business that is
      // not theirs, and the feed will not carry their name to remind them.
      ...(who.viaOperator ? { connectedAs: "platform operator" } : {}),
      note: who.viaOperator
        ? `You are connected to ${who.orgName} as the platform operator, not as a member of it. Everything done here is recorded in their activity feed as the operator brand, not under your name.`
        : `Everything done here is recorded in the ${who.orgName} activity feed as "${who.label}".`,
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
    name: "activity_report",
    title: "How the last N days went",
    description:
      "Appointments, calls and messages over a period, with no-show, answered and reply rates already worked out. THIS is the tool for 'how was last week' or 'how many no-shows' — do not answer those by listing customers and counting them, because the list is paged and the count will be wrong. Looks backward; schedule looks forward.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back, 1-90. Default 7." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, args, who) =>
      await ctx.runQuery(internal.agentReports.activityReport, {
        orgId: who.orgId as never,
        days: num(args, "days"),
      }),
  },
  {
    name: "get_customer_history",
    title: "One customer's whole timeline",
    description:
      "Everything that has passed between the salon and one person, newest first: messages either way, calls with their summaries, notes and appointments, merged into a single ordered list. get_customer gives the record and the last ten of each; this gives the story. Read it before writing a note or messaging someone, so you are not repeating what they were already told.",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string" },
        limit: { type: "number", description: "Max entries, 1-200. Default 50." },
      },
      required: ["customerId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, args, who) => {
      const customerId = str(args, "customerId");
      if (!customerId) throw new Error("customerId is required");
      return await ctx.runQuery(internal.agentReports.customerHistory, {
        orgId: who.orgId as never,
        customerId,
        limit: num(args, "limit"),
      });
    },
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
    name: "create_customers",
    title: "Bring a customer list in",
    description:
      "Add people to the book — one, or up to 100 in a call. Deduped by phone: a number already on file updates that person instead of making a second row, so re-running the same list is safe. Numbers may be written the way the salon says them ('0532 123 45 67'); they are read against the business's own country and stored international. A number that still cannot be read is REPORTED BACK, never dropped silently. Nothing is sent and no reminder is scheduled — these arrive as records. KVKK consent is NOT implied by importing: leave consentAt unset unless the salon can say when that person actually agreed, because WhatsApp sends stay blocked without it and that is the correct failure. Reversible: undo deletes the ones it created, with everything attached to them, keeping anyone who has since booked, written, called or had a note written about them.",
    inputSchema: {
      type: "object",
      properties: {
        customers: {
          type: "array",
          maxItems: 100,
          description: "The people to add. Phone is the identity and what a repeat run matches on.",
          items: {
            type: "object",
            properties: {
              firstName: { type: "string", description: "What staff would call them." },
              lastName: { type: "string" },
              phone: {
                type: "string",
                description:
                  "Local or international. '0532 123 45 67' is read against the salon's country; '+905321234567' always works.",
              },
              email: { type: "string" },
              language: { type: "string", description: "Two-letter code, e.g. tr, en, de." },
              notes: { type: "string", description: "Anything a colleague should know." },
              consentAt: {
                type: "number",
                description:
                  "Epoch ms of when this person agreed to be messaged. OMIT unless the salon actually knows — do not stamp it to make sends work.",
              },
            },
            required: ["phone"],
            additionalProperties: false,
          },
        },
      },
      required: ["customers"],
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const raw = args.customers;
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error("customers must be a non-empty array");
      }
      const res = await ctx.runMutation(internal.agentTools.createCustomers, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        customers: raw as never,
      });
      const parts = [`Added ${res.created.length}`];
      if (res.updated.length > 0) parts.push(`updated ${res.updated.length} already on file`);
      if (res.skippedBadPhone.length > 0) {
        parts.push(`could not read the number for ${res.skippedBadPhone.length}`);
      }
      return {
        ok: true,
        note: `${parts.join(", ")}.`,
        created: res.created,
        updated: res.updated,
        skippedBadPhone: res.skippedBadPhone,
        actionId: res.actionId,
        ...(res.actionId ? { undoWith: `undo(actionId: "${res.actionId}")` } : {}),
      };
    },
  },
  {
    name: "create_appointments",
    title: "Seed the calendar",
    description:
      "Bring an existing book in: appointments this business already has, past or future, up to 50 a call. The customer must ALREADY be on file — pass customerId, or the phone number they are filed under (search_customers and create_customers are the doors for that) — because a nameless row minted to hang an appointment on is how a customer list rots. `start` is read as wall time AT THE BUSINESS ('2026-03-14 14:30'); a string carrying a zone is taken as the instant it names. Services are given by the key list_services publishes, and each one SNAPSHOTS its name, price and duration, so a later price rise never rewrites what March charged. Status is optional and reads off the clock when omitted: a past visit is completed, a future one is scheduled. NOTHING IS SENT — no booking confirmation, and any reminder, follow-up or winback that was already due before you seeded is stamped as sent rather than fired, so importing six months of no-shows does not message six months of customers tonight. Reminders that fall genuinely in the future stay armed, because next week's book should still remind next week. These do not go to cal.com; they are Resepta's own rows. A row that cannot be placed is REPORTED BACK with its number and the reason, never dropped silently. Reversible: undo deletes the ones it created that are still as you wrote them, keeping any the business has since moved, cancelled or otherwise changed and any the customer has been messaged about.",
    inputSchema: {
      type: "object",
      properties: {
        appointments: {
          type: "array",
          maxItems: 50,
          description: "The appointments to bring in.",
          items: {
            type: "object",
            properties: {
              customerId: {
                type: "string",
                description: "From search_customers or create_customers. Use this or phone.",
              },
              phone: {
                type: "string",
                description:
                  "The number the customer is filed under. Local form is read against the business's own country.",
              },
              start: {
                type: "string",
                description:
                  "When it starts, as the business says it: '2026-03-14 14:30'. Read as local time at the business unless the string carries a zone.",
              },
              serviceKeys: {
                type: "array",
                items: { type: "string" },
                description:
                  "What was booked, by the key from list_services. Several make ONE appointment with several lines, which is what a cut plus a beard trim is.",
              },
              durationMinutes: {
                type: "number",
                description:
                  "Only when it differs from what the services add up to. Omit and the services decide.",
              },
              status: {
                type: "string",
                description:
                  "scheduled, confirmed, completed, cancelled or no_show. Omit and a past appointment is completed, a future one scheduled.",
              },
              staffName: {
                type: "string",
                description: "Who did it, exactly as the team member is named. Omit if it does not matter.",
              },
              notes: { type: "string" },
            },
            required: ["start"],
            additionalProperties: false,
          },
        },
      },
      required: ["appointments"],
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const raw = args.appointments;
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error("appointments must be a non-empty array");
      }
      const res = await ctx.runMutation(internal.agentTools.createAppointments, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        appointments: raw as never,
      });
      const parts = [`Added ${res.created.length} to the calendar`];
      if (res.skipped.length > 0) parts.push(`could not place ${res.skipped.length}`);
      return {
        ok: true,
        note: `${parts.join(", ")}. Nothing was sent to anybody.`,
        created: res.created,
        skipped: res.skipped,
        actionId: res.actionId,
        ...(res.actionId ? { undoWith: `undo(actionId: "${res.actionId}")` } : {}),
      };
    },
  },
  {
    name: "log_activity",
    title: "Record calls and messages that already happened",
    description:
      "Put history onto a customer's timeline: a call the salon took, a WhatsApp exchange, an email thread. NOTHING IS SENT — these are records of things that already occurred, written finished so no dispatch path can see them. Use it to bring an existing business's history in, or to log a conversation that happened somewhere Resepta cannot see. Up to 200 entries a call, across any number of customers. Reversible with undo.",
    inputSchema: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          maxItems: 200,
          items: {
            type: "object",
            properties: {
              customerId: {
                type: "string",
                description: "Who it happened with. Search first; never invent one.",
              },
              channel: { type: "string", enum: ["call", "whatsapp", "email"] },
              direction: {
                type: "string",
                enum: ["inbound", "outbound"],
                description: "inbound = the customer contacted the salon, outbound = the salon contacted them.",
              },
              at: {
                type: "number",
                description:
                  "When it happened, epoch MILLISECONDS, and in the past. Each message in a thread gets its own time or they all stack on one moment.",
              },
              body: {
                type: "string",
                description: "What was said. For a call, the summary; for a message, that one message's text.",
              },
              subject: { type: "string", description: "Email only." },
              from: { type: "string", description: "Email only — the sending address. Defaults to the customer's." },
              durationSeconds: { type: "number", description: "Call only." },
              outcome: { type: "string", description: "Call only — e.g. booked, no answer, called back." },
              transcript: { type: "string", description: "Call only — the full transcript if there is one." },
            },
            required: ["customerId", "channel", "direction", "at"],
            additionalProperties: false,
          },
        },
      },
      required: ["entries"],
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const raw = args.entries;
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error("entries must be a non-empty array");
      }
      const res = await ctx.runMutation(internal.agentTools.logActivity, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        entries: raw as never,
      });
      const parts: string[] = [];
      if (res.calls > 0) parts.push(`${res.calls} call${res.calls === 1 ? "" : "s"}`);
      if (res.messages > 0) {
        parts.push(`${res.messages} message${res.messages === 1 ? "" : "s"}`);
      }
      return {
        ok: true,
        note: parts.length > 0 ? `Logged ${parts.join(" and ")}. Nothing was sent.` : "Nothing was logged.",
        skipped: res.skipped,
        actionId: res.actionId,
        ...(res.actionId ? { undoWith: `undo(actionId: "${res.actionId}")` } : {}),
      };
    },
  },
  // ── Deleting a customer (any member, as in the app) ─────────────────────────
  // A data-removal request: the person asked this business to erase them.
  // Preview first, always: the token binds the delete to the counts shown.
  {
    name: "preview_delete_customer",
    title: "Preview deleting a customer",
    description:
      "Step one of erasing a person from this business, for a data-removal request. Owners only: a team member's request is refused. Takes the exact customer id (from search_customers or get_customer, never a name) and returns who that is and what would go with them: appointments, messages, calls, notes, assistant replies, bulk-send entries and inbox marks, plus the audit rows that would be emptied of them. Returns a confirmToken that delete_customer needs, valid for 10 minutes. Show the person the name and the counts and get a clear yes before deleting.",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "From search_customers or get_customer." },
      },
      required: ["customerId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, args, who) => {
      const customerId = str(args, "customerId");
      if (!customerId) throw new Error("customerId is required");
      const res = await ctx.runQuery(internal.agentTools.previewDeleteCustomer, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        customerId,
      });
      const { counts, capped } = res.footprint;
      // The clock is read here, in the action: a query must not.
      const expiresAt = Date.now() + DELETE_CONFIRM_TTL_MS;
      return {
        customer: res.customer,
        willDelete: {
          appointments: counts.appointments,
          messages: counts.messages,
          calls: counts.calls,
          notes: counts.notes,
          assistantReplies: counts.chatTurns,
          bulkSendEntries: counts.bulkRunItems,
          inboxPins: counts.inboxPins,
          inboxReadMarks: counts.inboxReads,
        },
        willEmpty: { activityRows: counts.activity, journalEntries: counts.journal },
        ...(capped.length > 0
          ? { atLeast: `These counts stopped at a cap and mean "at least": ${capped.join(", ")}.` }
          : {}),
        confirmToken: deleteConfirmToken(res.customer.id, res.signature, expiresAt),
        expiresInMinutes: DELETE_CONFIRM_TTL_MS / 60_000,
        note:
          "Deleting cannot be undone, and nothing is sent to the customer about it. Their record leaves every list and search at once and the rest is removed in the background within moments; anything still waiting to be sent to them is cancelled. The activity feed keeps a line saying a customer was deleted and by whom, never who. Copies outside this business's records are not touched: the phone provider's recordings and transcripts of their calls, and the copies the messaging and email providers keep. Confirm with the person, then call delete_customer with this confirmToken and the same customerId.",
      };
    },
  },
  {
    name: "delete_customer",
    title: "Delete a customer permanently",
    description:
      "Step two. Permanently erases the customer and everything this business holds on them, and cancels anything still waiting to be sent to them. Owners only. Needs the confirmToken from preview_delete_customer for the same customer, less than 10 minutes old; if anything changed since the preview (a message arrived, a note was added), this refuses and you preview again. Not undoable: undo refuses it. Only call after the person has seen the preview and said yes.",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string" },
        confirmToken: { type: "string", description: "From preview_delete_customer." },
      },
      required: ["customerId", "confirmToken"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, idempotentHint: false },
    handler: async (ctx, args, who) => {
      const customerId = str(args, "customerId");
      const confirmToken = str(args, "confirmToken");
      if (!customerId) throw new Error("customerId is required");
      if (!confirmToken) {
        throw new Error("confirmToken is required: run preview_delete_customer first");
      }
      const res = await ctx.runMutation(internal.agentTools.deleteCustomer, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        customerId,
        confirmToken,
      });
      return {
        ok: true,
        note: `Deleted ${res.name}. They are gone from every list now, and the rest of their records are being removed in the background. This cannot be undone; recent_actions keeps a line that a customer was deleted, without their name.`,
        actionId: res.actionId,
      };
    },
  },
  {
    name: "read_agent_prompt",
    title: "Read a phone agent's prompt",
    description:
      "The full prompt a phone agent runs on, plus what it collects after a call — without opening the provider's console. Pass the agentId from list_phone_agents. An agent built on a conversation flow has no single prompt and says so.",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string", description: "From list_phone_agents." } },
      required: ["agentId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, args, who) => {
      const agentId = str(args, "agentId");
      if (!agentId) throw new Error("agentId is required");
      const agent = (await ctx.runQuery(internal.agentTools.resolvePhoneAgent, {
        orgId: who.orgId as never,
        agentId,
      })) as { retellAgentId: string; name: string };
      return await ctx.runAction(internal.retellAgent.readPromptForOrg, {
        orgId: who.orgId as never,
        agentId: agent.retellAgentId,
      });
    },
  },
  {
    name: "preview_agent_prompt",
    title: "Preview a prompt change before publishing",
    description:
      "REQUIRED before publish_agent_prompt. Shows exactly which lines would go and which would arrive, and returns a planToken. Publishing needs that token and it only matches the exact text previewed, so a prompt cannot reach real callers without the change having been shown first.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        generalPrompt: {
          type: "string",
          description: "The complete new prompt, not a fragment — it REPLACES what is there.",
        },
      },
      required: ["agentId", "generalPrompt"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    handler: async (ctx, args, who) => {
      const agentId = str(args, "agentId");
      const next = typeof args.generalPrompt === "string" ? args.generalPrompt : undefined;
      if (!agentId) throw new Error("agentId is required");
      if (next === undefined) throw new Error("generalPrompt is required");
      const agent = (await ctx.runQuery(internal.agentTools.resolvePhoneAgent, {
        orgId: who.orgId as never,
        agentId,
      })) as { retellAgentId: string; name: string };
      const read = (await ctx.runAction(internal.retellAgent.readPromptForOrg, {
        orgId: who.orgId as never,
        agentId: agent.retellAgentId,
      })) as { name: string; prompt: { general: string } | null; note?: string };
      if (!read.prompt) throw new Error(read.note ?? "That agent has no single prompt to change.");
      const current = read.prompt.general;
      if (current === next) throw new Error("That is the prompt it already has.");
      return {
        agent: read.name,
        planToken: planToken(agent.retellAgentId, next),
        diff: lineDiff(current, next),
        currentLength: current.length,
        newLength: next.length,
        warning:
          "Publishing changes what real callers hear on the very next call. Show the user this diff and get a clear yes before calling publish_agent_prompt.",
      };
    },
  },
  {
    name: "publish_agent_prompt",
    title: "Publish a new prompt to a phone agent",
    description:
      "Publishes a new prompt. Requires the planToken from preview_agent_prompt for this exact text. The old prompt can be restored with undo — but any call that comes in while the new one is live uses it, and that part cannot be taken back. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        generalPrompt: { type: "string" },
        planToken: { type: "string", description: "From preview_agent_prompt." },
      },
      required: ["agentId", "generalPrompt", "planToken"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
    handler: async (ctx, args, who) => {
      const agentId = str(args, "agentId");
      const next = typeof args.generalPrompt === "string" ? args.generalPrompt : undefined;
      const token = str(args, "planToken");
      if (!agentId) throw new Error("agentId is required");
      if (next === undefined) throw new Error("generalPrompt is required");
      await ctx.runQuery(internal.agentTools.assertCanProvision, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        what: "change a phone agent's prompt",
      });
      const agent = (await ctx.runQuery(internal.agentTools.resolvePhoneAgent, {
        orgId: who.orgId as never,
        agentId,
      })) as { retellAgentId: string; name: string };
      // The token is a hash of exactly this agent and this text. A mismatch
      // means the text drifted after the preview — usually the model tidying it
      // once more on the way past — so the human approved a diff that is not
      // the one about to go live.
      if (token !== planToken(agent.retellAgentId, next)) {
        throw new Error(
          "That planToken does not match this prompt. Call preview_agent_prompt with the exact text you intend to publish, show the user the diff, then publish that.",
        );
      }
      const res = (await ctx.runAction(internal.retellAgent.publishPromptForOrg, {
        orgId: who.orgId as never,
        agentId: agent.retellAgentId,
        generalPrompt: next,
      })) as { version: number | null; previousPrompt: string };
      const recorded = (await ctx.runMutation(internal.agentTools.recordPromptPublished, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        retellAgentId: agent.retellAgentId,
        agentName: agent.name,
        previousPrompt: res.previousPrompt,
        newPrompt: next,
      })) as { actionId: string };
      return {
        ok: true,
        note: `Published to ${agent.name}. It is live for the next call.`,
        version: res.version,
        actionId: recorded.actionId,
        undoWith: `undo(actionId: "${recorded.actionId}")`,
      };
    },
  },
  {
    name: "list_message_rules",
    title: "What the business sends on its own",
    description:
      "Every automatic message rule — the confirmation, the reminders, the cancellation note, the winback, the out-of-hours reply — with its timing, its channel and whether it is paused, plus which languages it has its own wording in. Read this before changing anything: a rule's offsetHours means different things per trigger (hours BEFORE the start for a reminder, hours AFTER the end for a follow-up).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, _args, who) =>
      await ctx.runQuery(internal.agentTools.listMessageRules, {
        orgId: who.orgId as never,
      }),
  },
  {
    name: "get_template",
    title: "The exact words one message sends",
    description:
      "One piece of wording in full, by templateId from list_message_rules. Read metaStatus before offering to rewrite it: when a template is Meta-approved, the WhatsApp Cloud lane sends the string Meta approved, NOT this body — so editing the words changes the email and shop-phone lanes and leaves Cloud WhatsApp saying what it said before.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string" } },
      required: ["templateId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, args, who) => {
      const templateId = str(args, "templateId");
      if (!templateId) throw new Error("templateId is required");
      return await ctx.runQuery(internal.agentTools.getTemplate, {
        orgId: who.orgId as never,
        templateId,
      });
    },
  },
  {
    name: "set_message_rule",
    title: "Change when and how the business sends",
    description:
      "Create a rule, or change an existing one's timing, channel or paused state. Pass ruleId to change one, or trigger to create one. offsetHours is read against the trigger and clamped to what that trigger allows — 1-168 before a start, 1-720 after an end, 24-2160 after a no-show, and ignored entirely for booking, cancellation and out_of_hours, which fire on the event. THIS CHANGES WHAT REAL CUSTOMERS RECEIVE, including for appointments already on the book, so say what will change and get a clear yes first. Owner only. Reversible.",
    inputSchema: {
      type: "object",
      properties: {
        ruleId: { type: "string", description: "From list_message_rules. Omit to create a new rule." },
        trigger: {
          type: "string",
          enum: ["booking", "before_start", "after_end", "cancellation", "no_show", "out_of_hours"],
          description: "Required when creating; ignored when changing an existing rule.",
        },
        offsetHours: { type: "number", description: "Hours from the anchor. Clamped per trigger." },
        channel: { type: "string", enum: ["whatsapp", "email", "both"] },
        paused: { type: "boolean", description: "true stops it sending without deleting it." },
      },
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const ruleId = str(args, "ruleId");
      const trigger = str(args, "trigger");
      const channel = str(args, "channel");
      const res = (await ctx.runMutation(internal.agentTools.upsertMessageRule, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        ...(ruleId ? { ruleId } : {}),
        ...(trigger ? { trigger } : {}),
        ...(typeof args.offsetHours === "number" ? { offsetHours: args.offsetHours } : {}),
        ...(channel ? { channel } : {}),
        ...(typeof args.paused === "boolean" ? { paused: args.paused } : {}),
      })) as { ruleId: string; trigger: string; created: boolean; actionId: string };
      return {
        ok: true,
        note: `${res.created ? "Added" : "Changed"} the ${res.trigger} rule. Appointments already on the book have been rescheduled to match.`,
        ruleId: res.ruleId,
        actionId: res.actionId,
        undoWith: `undo(actionId: "${res.actionId}")`,
      };
    },
  },
  {
    name: "update_template",
    title: "Rewrite what a message says",
    description:
      "Change the words one rule sends. READ get_template FIRST and show the owner the current text beside the new one — this is what their customers read, and there is no draft state between saving and sending. If the template is Meta-approved, the WhatsApp Cloud lane keeps sending the approved string and only email and the shop phone pick up the new wording; the result says which case it was. Approval is never touched, because a reword must not cost an approval that took weeks. Owner only. Reversible.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "From list_message_rules or get_template." },
        body: { type: "string", description: "The complete new text, with its [name] / [business] / [date] tokens kept." },
        subject: { type: "string", description: "Email subject line. Only used on the email lane." },
      },
      required: ["templateId"],
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const templateId = str(args, "templateId");
      if (!templateId) throw new Error("templateId is required");
      const body = typeof args.body === "string" ? args.body : undefined;
      const subject = typeof args.subject === "string" ? args.subject : undefined;
      if (body === undefined && subject === undefined) {
        throw new Error("Pass body, subject, or both.");
      }
      const res = (await ctx.runMutation(internal.agentTools.updateTemplateBody, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        templateId,
        ...(body !== undefined ? { body } : {}),
        ...(subject !== undefined ? { subject } : {}),
      })) as {
        kind: string;
        language: string;
        metaApproved: boolean;
        actionId: string;
      };
      return {
        ok: true,
        note: res.metaApproved
          ? `Rewrote the ${res.kind} wording (${res.language}). This template is Meta-approved, so WhatsApp sent over the Cloud number KEEPS THE OLD WORDING — the new text goes out by email and from the shop phone. Changing what Cloud sends means registering a new template with Meta.`
          : `Rewrote the ${res.kind} wording (${res.language}). It is live on the next send.`,
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

      // A phone agent's prompt lives behind a network call, so its reversal is
      // an action and cannot run inside the mutation that handles everything
      // else. Branched here rather than having the mutation schedule it: undo
      // must either happen or say why it did not, and a scheduled restore
      // would report "done" before it had been.
      const prior = (await ctx.runQuery(internal.agentTools.getAction, {
        orgId: who.orgId as never,
        actionId,
      })) as {
        tool: string;
        userId: string;
        before: string;
        args: string;
        undone: boolean;
      } | null;
      if (prior && prior.tool === "publish_agent_prompt") {
        // Before the republish, not only in markUndone after it: that check
        // ran once the old prompt was already live again, so any member could
        // roll back a colleague's prompt with an id from recent_actions and
        // the refusal came too late to stop it (2026-10-13).
        if (prior.userId !== who.userId) {
          throw new Error("That action was somebody else's. You can only undo your own.");
        }
        if (prior.undone) throw new Error("That action was already undone.");
        const before = JSON.parse(prior.before) as { prompt: string };
        const journalled = JSON.parse(prior.args) as { retellAgentId?: string };
        if (!journalled.retellAgentId) {
          throw new Error(
            "That publish was recorded without an agent id, so it cannot be undone here.",
          );
        }
        await ctx.runAction(internal.retellAgent.publishPromptForOrg, {
          orgId: who.orgId as never,
          agentId: journalled.retellAgentId,
          generalPrompt: before.prompt,
        });
        const summary = "Restored the previous phone-agent prompt.";
        // Marked only after the republish returned. The ownership check lives
        // in markUndone as well as here, because this is a second door into
        // the same state change.
        await ctx.runMutation(internal.agentTools.markUndone, {
          orgId: who.orgId as never,
          userId: who.userId as never,
          connectionId: who.connectionId as never,
          actionId,
          summary,
        });
        return {
          ok: true,
          note: `${summary} Calls that came in while the new prompt was live used it — that part cannot be taken back.`,
        };
      }

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

  // ── Setting the business up ────────────────────────────────────────────────
  // The tools above run a salon that already exists. These build one. They are
  // here because the setup is the part an owner most wants done FOR them, and
  // a connector that could read the book but not fill it in sent people back
  // to the app for the only job they had asked for help with.
  {
    name: "list_services",
    title: "What this business sells",
    description:
      "Everything this business sells, with the key the phone agent books by, duration, price and whether it is active. A row with durationMinutes null is a GOOD (a cake, a delivery): sold at a moment, no calendar footprint, orderable in quantity. Prices are minor units of the returned currency — 40000 is 400,00. Read this before adding one, so you do not create a near-duplicate.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, _args, who) =>
      await ctx.runQuery(internal.agentTools.listServices, {
        orgId: who.orgId as never,
      }),
  },
  {
    name: "create_service",
    title: "Add a bookable service",
    description:
      "Add one service. The phone agent reads this list at call time, so a service that is not here is one it will refuse to book. Price is optional and in MINOR UNITS of the org's currency (40000 = 400,00) — omit it rather than guessing. Reversible.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "What a customer would call it." },
        durationMinutes: {
          type: "number",
          description:
            "Minimum 5. OMIT ENTIRELY for a good — a thing sold at a moment (a cake, a delivery) rather than time. Goods never block the calendar and can be ordered in quantity.",
        },
        leadMinutes: {
          type: "number",
          description:
            "Goods only: minimum notice in minutes (1440 = order a day ahead). Omit for no lead time.",
        },
        price: {
          type: "number",
          description: "Minor units (40000 = 400,00). Omit if the business does not track it.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const name = str(args, "name");
      if (!name) throw new Error("name is required");
      const res = await ctx.runMutation(internal.agentTools.createService, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        name,
        durationMinutes: num(args, "durationMinutes"),
        leadMinutes: num(args, "leadMinutes"),
        price: num(args, "price"),
      });
      return {
        ok: true,
        note: `Added "${res.name}". The phone agent books it as "${res.key}".`,
        serviceId: res.serviceId,
        key: res.key,
        actionId: res.actionId,
        undoWith: `undo(actionId: "${res.actionId}")`,
      };
    },
  },
  {
    name: "list_contact_fields",
    title: "What this business records about a customer",
    description:
      "The custom properties on a customer card, in display order, each with the key values are stored under and whether staff or the phone agent fills it. Name, phone and email are built in and never appear here.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, _args, who) =>
      await ctx.runQuery(internal.agentTools.listContactFields, {
        orgId: who.orgId as never,
      }),
  },
  {
    name: "create_contact_field",
    title: "Add a customer detail to collect",
    description:
      "Add one custom property to every customer card. Set filledBy to \"voice\" for something the phone agent should collect on a call, \"staff\" for something typed in the app. A select needs its options up front. Owner only. Reversible until an agent references it.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "What staff see, e.g. \"Company name\"." },
        type: { type: "string", enum: ["text", "select", "number", "date"] },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Required for select, ignored otherwise.",
        },
        filledBy: {
          type: "string",
          enum: ["staff", "voice"],
          description: "Who fills it in. Defaults to staff.",
        },
        key: {
          type: "string",
          description:
            "Optional. The permanent write address. Derived from the label when omitted; declare it only when the label makes a poor one.",
        },
      },
      required: ["label", "type"],
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const label = str(args, "label");
      const type = str(args, "type");
      if (!label) throw new Error("label is required");
      if (!["text", "select", "number", "date"].includes(type ?? "")) {
        throw new Error("type must be one of text, select, number, date");
      }
      const rawOptions = args.options;
      const options = Array.isArray(rawOptions) ? rawOptions.map((o) => String(o)) : undefined;
      const res = await ctx.runMutation(internal.agentTools.createContactField, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        label,
        type: type as "text" | "select" | "number" | "date",
        options,
        source: str(args, "filledBy") === "voice" ? "voice" : "manual",
        key: str(args, "key"),
      });
      return {
        ok: true,
        note: `Added "${res.label}", filled by ${res.filledBy}. Values are stored under "${res.key}".`,
        fieldId: res.fieldId,
        key: res.key,
        actionId: res.actionId,
        undoWith: `undo(actionId: "${res.actionId}")`,
      };
    },
  },
  {
    name: "create_workspace",
    title: "Found another business",
    description:
      "Create a brand-new, SEPARATE business under the person behind this connection — the same thing as the app's \"Add business\". The new business is born empty and unnamed; its owner completes onboarding (name, language, setup) by picking it in the app's workspace switcher. This connection stays pinned to the CURRENT business and cannot read or set up the new one — a new connector minted inside that workspace is how Claude gets there. Confirm with the owner before calling: a whole business is not a row, and there is no undo.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: {},
    handler: async (ctx, _args, who) => {
      const res = await ctx.runMutation(internal.agentTools.createWorkspace, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
      });
      return {
        ok: true,
        orgId: res.orgId,
        note: "Founded. Tell the owner: open the app, pick the new business in the workspace switcher (top left), and complete onboarding there. To let Claude manage the new business too, mint a key inside it (Account panel, AI card) and add it as a new connector.",
        actionId: res.actionId,
      };
    },
  },
  {
    name: "list_phone_agents",
    title: "The phone agents this business has",
    description:
      "Every phone agent connected to this workspace, whether it is enabled, which inbound number it answers on, and whether Resepta's private runtime is published to it. An agent without the runtime can take a call but cannot read or write customer data.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, _args, who) =>
      await ctx.runQuery(internal.agentTools.listPhoneAgents, {
        orgId: who.orgId as never,
      }),
  },
  {
    name: "list_voices",
    title: "Voices a phone agent can use",
    description:
      "The voices available to this workspace, for choosing one before creating a phone agent. Only needed if the caller cares which voice — create_phone_agent picks one when none is given.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, _args, who) =>
      await ctx.runAction(internal.retellAgent.voiceOptionsForOrg, {
        orgId: who.orgId as never,
      }),
  },
  {
    name: "list_agent_variables",
    title: "What a phone agent collects",
    description:
      "What one agent reads and asks for on a call, and whether each answer is written to the customer card or kept on the call record. An agent with nothing here answers and books but records no details.",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string", description: "From list_phone_agents." } },
      required: ["agentId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (ctx, args, who) => {
      const agentId = str(args, "agentId");
      if (!agentId) throw new Error("agentId is required");
      return await ctx.runQuery(internal.agentTools.listAgentVariables, {
        orgId: who.orgId as never,
        agentId,
      });
    },
  },
  {
    name: "set_agent_variables",
    title: "Choose what a phone agent collects",
    description:
      "Point an agent at the contact fields it should collect, by their keys. Each one is wired the way a repeat caller expects: read from the customer card before the call, asked only when missing, written back after. REPLACES the agent's whole set, so pass every field you want it collecting, not just new ones. Only fields whose filledBy is \"voice\" are eligible. The caller's name and the business name are always included and do not need listing. Publishes a new version at the phone provider and cannot be undone. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "From list_phone_agents." },
        fieldKeys: {
          type: "array",
          items: { type: "string" },
          description: "Contact field keys from list_contact_fields, in the order to ask.",
        },
        descriptions: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Field key to the instruction the agent follows for that value, e.g. \"Map what they describe onto one of the options; do not read the list aloud.\" Optional — omitted fields get a generic \"capture this when offered\", which works but is the difference between an agent that functions and one that sounds like it knows the business.",
        },
      },
      required: ["agentId", "fieldKeys"],
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const agentId = str(args, "agentId");
      if (!agentId) throw new Error("agentId is required");
      const raw = args.fieldKeys;
      if (!Array.isArray(raw)) throw new Error("fieldKeys must be an array of field keys");
      const fieldKeys = raw.map((k) => String(k));
      await ctx.runQuery(internal.agentTools.assertCanProvision, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        what: "change what a phone agent collects",
      });
      // Built here, never accepted from the caller: the contact-field link,
      // the matching key and a select's choices are all derivable, and each is
      // a publish error rather than a decision.
      const rawDescriptions = args.descriptions;
      const descriptions =
        rawDescriptions && typeof rawDescriptions === "object" && !Array.isArray(rawDescriptions)
          ? Object.fromEntries(
              Object.entries(rawDescriptions as Record<string, unknown>).map(([k, val]) => [
                k,
                String(val ?? ""),
              ]),
            )
          : undefined;
      const variables = (await ctx.runQuery(internal.agentTools.buildAgentVariables, {
        orgId: who.orgId as never,
        fieldKeys,
        descriptions,
      })) as VoiceVariableInput[];
      const agent = (await ctx.runQuery(internal.agentTools.resolvePhoneAgent, {
        orgId: who.orgId as never,
        agentId,
      })) as { retellAgentId: string; name: string };
      const published = (await ctx.runAction(internal.retellAgent.publishVariablesForOrg, {
        orgId: who.orgId as never,
        agentId: agent.retellAgentId,
        variables,
      })) as { ok: boolean; version: number | null };
      const recorded = await ctx.runMutation(internal.agentTools.recordVariablesPublished, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        retellAgentId: agent.retellAgentId,
        agentName: agent.name,
        keys: fieldKeys,
      });
      return {
        ok: published.ok,
        version: published.version,
        collecting: fieldKeys,
        actionId: recorded.actionId,
        note: `Published. It now asks for ${
          fieldKeys.length > 0 ? fieldKeys.join(", ") : "nothing beyond the caller's name"
        } and writes the answers to the customer card. This cannot be undone.`,
      };
    },
  },
  {
    name: "assign_phone_number",
    title: "Move an inbound line to an agent",
    description:
      "Point an inbound number at one agent, or pass null to unassign. A line answers for exactly one agent, so assigning a number another agent holds MOVES it — that agent stops taking calls immediately. Use list_phone_agents to see who holds what. Resepta never buys numbers; this only routes ones the business already has. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "From list_phone_agents." },
        number: {
          type: "string",
          description: "The line in international form. Omit or pass null to unassign.",
        },
      },
      required: ["agentId"],
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const agentId = str(args, "agentId");
      if (!agentId) throw new Error("agentId is required");
      await ctx.runQuery(internal.agentTools.assertCanProvision, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        what: "move an inbound line",
      });
      const number = str(args, "number") || null;
      const agent = (await ctx.runQuery(internal.agentTools.resolvePhoneAgent, {
        orgId: who.orgId as never,
        agentId,
      })) as { retellAgentId: string; name: string };
      await ctx.runAction(internal.retellAgent.assignLineForOrg, {
        orgId: who.orgId as never,
        agentId: agent.retellAgentId,
        number,
      });
      const recorded = await ctx.runMutation(internal.agentTools.recordLineAssigned, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        agentName: agent.name,
        retellAgentId: agent.retellAgentId,
        number,
      });
      return {
        ok: true,
        actionId: recorded.actionId,
        note: number
          ? `${number} now rings "${agent.name}". Any agent that held it has stopped answering.`
          : `"${agent.name}" no longer answers an inbound line.`,
      };
    },
  },
  {
    name: "create_phone_agent",
    title: "Create a phone agent",
    description:
      "Build a new appointment receptionist: it answers, tells callers what the business offers, collects the details this workspace records, and books. Add the services and voice-filled contact fields FIRST — the agent reads both at call time, and one created against an empty business has nothing to say. Creates a real resource at the phone provider and CANNOT be undone. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "What the salon calls this agent, e.g. \"Reception\"." },
        language: {
          type: "string",
          enum: ["tr-TR", "en-US", "de-DE"],
          description: "The language it speaks. Defaults to en-US.",
        },
        voiceId: { type: "string", description: "From list_voices. One is chosen if omitted." },
        inboundNumber: {
          type: "string",
          description:
            "An unassigned line already provisioned at the provider. Resepta never buys numbers, so a number it does not already hold will fail.",
        },
        requestId: {
          type: "string",
          description:
            "Pass the SAME value when retrying a call that timed out. It continues the existing setup instead of creating a second agent.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: {},
    handler: async (ctx, args, who) => {
      const name = str(args, "name");
      if (!name) throw new Error("name is required");
      const language = str(args, "language") || "en-US";
      if (!["tr-TR", "en-US", "de-DE"].includes(language)) {
        throw new Error("language must be one of tr-TR, en-US, de-DE");
      }
      // Refused BEFORE the provider is touched. An owner check that ran after
      // would leave a real external agent behind every rejected attempt.
      await ctx.runQuery(internal.agentTools.assertCanProvision, {
        orgId: who.orgId as never,
        userId: who.userId as never,
      });
      let voiceId = str(args, "voiceId");
      if (!voiceId) {
        const voices = (await ctx.runAction(internal.retellAgent.voiceOptionsForOrg, {
          orgId: who.orgId as never,
        })) as { id: string }[];
        if (voices.length === 0) {
          throw new Error("The provider offered no voices. Pass voiceId explicitly.");
        }
        voiceId = voices[0].id;
      }
      const requestId = str(args, "requestId") || crypto.randomUUID();
      const result = (await ctx.runAction(internal.retellAgent.createAgentForOrg, {
        orgId: who.orgId as never,
        requestId,
        name,
        language: language as "tr-TR" | "en-US" | "de-DE",
        voiceId,
        inboundNumber: str(args, "inboundNumber"),
      })) as { status: "working" | "complete"; agentId: string | null; lineRefused?: string };

      if (result.status !== "complete" || !result.agentId) {
        // Another attempt holds the lease. Handing back the SAME requestId is
        // the whole answer: retrying with it resumes that job, and retrying
        // without one is how a business ends up paying for two agents.
        return {
          ok: false,
          status: result.status,
          requestId,
          note: `Setup for "${name}" is already running. Retry create_phone_agent with requestId "${requestId}" — do not start a new one.`,
        };
      }
      const recorded = await ctx.runMutation(internal.agentTools.recordAgentCreated, {
        orgId: who.orgId as never,
        userId: who.userId as never,
        connectionId: who.connectionId as never,
        retellAgentId: result.agentId,
        name,
      });
      const asked = str(args, "inboundNumber");
      return {
        ok: true,
        agentId: result.agentId,
        voiceId,
        language,
        actionId: recorded.actionId,
        // A line provisioning let go of (lineUsable or the provider refused
        // it) is said, not implied: the agent exists without it.
        ...(result.lineRefused ? { lineRefused: result.lineRefused } : {}),
        note: `Created "${name}". It is connected and enabled${
          result.lineRefused
            ? `, but ${asked || "the line asked for"} could not be attached (${result.lineRefused}), so it has no inbound line yet`
            : asked
              ? ` on ${asked}`
              : ", with no inbound line yet"
        }. This cannot be undone.`,
      };
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
    // Role-scoped, so a stylist's Claude does not offer to rewrite the salon's
    // confirmation message and then fail at the last step. This is NOT the
    // permission boundary — every one of these handlers re-derives the role
    // from `memberships` and refuses on its own, which is what actually stops
    // a non-owner who names the tool anyway. Hiding them just means the model
    // never proposes work the person cannot authorise.
    tools: who.role === "owner" ? TOOLS : TOOLS.filter((t) => !OWNER_ONLY.has(t.name)),
    serverInfo: SERVER_INFO,
    instructions: `You are connected to ${who.orgName}, an appointment business. Everything you do is recorded in their activity feed against ${who.userName}, and reversible actions can be undone. Read before you write — check a customer's history before logging a note about it. Never invent a customer id; search first. Setting the business up has an order: services and contact fields first, then a phone agent, because the agent reads both at call time and one built against an empty business has nothing to say. Creating a phone agent makes a real resource at the phone provider and cannot be undone — confirm the name and language with the owner before you call it.`,
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
