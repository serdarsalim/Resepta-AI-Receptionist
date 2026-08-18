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

const SERVER_INFO = { name: "randevu", version: "1.1.0" };

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
      "Add people to the book — one, or up to 100 in a call. Deduped by phone: a number already on file updates that person instead of making a second row, so re-running the same list is safe. Numbers may be written the way the salon says them ('0532 123 45 67'); they are read against the business's own country and stored international. A number that still cannot be read is REPORTED BACK, never dropped silently. Nothing is sent and no reminder is scheduled — these arrive as records. KVKK consent is NOT implied by importing: leave consentAt unset unless the salon can say when that person actually agreed, because WhatsApp sends stay blocked without it and that is the correct failure. Reversible: undo deletes the ones it created, keeping anyone who has since got an appointment or a message.",
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
      })) as { status: "working" | "complete"; agentId: string | null };

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
      return {
        ok: true,
        agentId: result.agentId,
        voiceId,
        language,
        actionId: recorded.actionId,
        note: `Created "${name}". It is connected and enabled${
          str(args, "inboundNumber") ? ` on ${str(args, "inboundNumber")}` : ", with no inbound line yet"
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
    tools: TOOLS,
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
