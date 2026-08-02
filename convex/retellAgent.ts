// The voice agent's editable surface: its prompt, the variables it uses at each
// phase of a call, whether its webhook actually points here, and a test call.
//
// The split that matters: Retell keeps the voice engineering — model, latency,
// interruption, the voice itself. This owns what couples to the salon's data,
// which is the half you change because a customer said something. Walking to
// another product to edit a sentence is the friction worth removing.
//
// Two shapes, not one: the AGENT holds voice/webhook/post_call_analysis_data,
// the RESPONSE ENGINE (a retell-llm doc) holds the prompt. So reading "the
// prompt" is two hops, and publishing one is not a PATCH — see publishViaDraft.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { voiceVariableInput, normaliseVoiceVariableKey, type VoiceVariableInput } from "./lib/voiceVariables";
import { voiceCatalogue, type CatalogueVoice } from "./lib/voiceCatalogue";
import {
  createVoiceRuntimeToken,
  hashVoiceRuntimeToken,
} from "./lib/voiceRuntime";
import {
  appointmentReceptionistTemplate,
  VOICE_AGENT_TEMPLATE_VERSION,
  type VoiceAgentLanguage,
} from "./lib/voiceAgentTemplate";

const API = "https://api.retellai.com";

async function call(
  key: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`retell-${res.status}${t ? `: ${t.slice(0, 180)}` : ""}`);
  }
  return res;
}

type AgentDoc = {
  agent_id: string;
  agent_name?: string;
  version?: number;
  is_published?: boolean;
  webhook_url?: string;
  voice_id?: string;
  language?: string;
  response_engine?: {
    type?: string;
    llm_id?: string;
    conversation_flow_id?: string;
    version?: number;
  };
  post_call_analysis_data?: Record<string, unknown>[];
};

type LlmDoc = {
  llm_id?: string;
  general_prompt?: string;
  begin_message?: string;
  general_tools?: Record<string, unknown>[];
  default_dynamic_variables?: Record<string, string>;
  states?: { name?: string }[];
  mcps?: Array<{
    id?: string;
    name?: string;
    url?: string;
    headers?: Record<string, string>;
    query_params?: Record<string, string>;
    timeout_ms?: number;
    [key: string]: unknown;
  }>;
};

// This deployment's own HTTP origin. Read from the environment rather than
// passed in, so an agent can never be wired to some other deployment's URL.
function siteUrl(): string | null {
  return process.env.CONVEX_SITE_URL ?? null;
}

type EditorContext = {
  orgName: string;
  demoMode: boolean;
  apiKey: string | null;
  variables: Array<VoiceVariableInput & { order: number }>;
  variablesSyncedAt: number | null;
  variablesRetellVersion: number | null;
  runtimeConnectedAt: number | null;
  inboundNumber: string | null;
  fields: Array<{
    _id: string;
    key: string;
    label: string;
    type: "text" | "select" | "number" | "date";
    options?: string[];
    source?: "manual" | "voice";
  }>;
};

async function editorContext(
  ctx: Pick<ActionCtx, "runQuery">,
  agentId: string,
  // Only provisioning passes this, and only on the sessionless path. Every
  // signed-in caller leaves it unset and is authorised by requireOwner.
  orgId?: Id<"orgs">,
): Promise<EditorContext> {
  const context = (await ctx.runQuery(internal.retell.agentEditorContext, {
    retellAgentId: agentId,
    orgId,
  })) as EditorContext | null;
  if (!context) throw new Error("No workspace.");
  if (context.demoMode) {
    throw new Error("This is the demo workspace. It holds no Retell credentials.");
  }
  if (!context.apiKey) {
    throw new Error("No Retell API key for this workspace yet.");
  }
  return context;
}

async function runtimeMcpConfig(
  ctx: Pick<ActionCtx, "runMutation">,
  agentId: string,
  context: EditorContext,
  llm: LlmDoc,
): Promise<LlmDoc["mcps"]> {
  const site = siteUrl();
  if (!site) return undefined;
  const expectedUrl = `${site}/retell/mcp`;
  const current = llm.mcps ?? [];
  const existing = current.find(
    (entry) =>
      (entry.id === "randevu" || entry.name === "randevu") &&
      entry.url === expectedUrl,
  );
  // Omitting the field preserves the provider's stored secret. Re-sending a
  // masked header returned by a read API could replace the usable credential.
  if (existing && context.runtimeConnectedAt !== null) return undefined;

  // The clear credential lives only in the provider configuration. Randevu
  // stores its digest, so a database read cannot recover a live runtime key.
  const token = createVoiceRuntimeToken(agentId);
  await ctx.runMutation(internal.retell.setRuntimeToken, {
    retellAgentId: agentId,
    tokenHash: await hashVoiceRuntimeToken(token),
  });
  return [
    ...current.filter(
      (entry) =>
        entry.id !== "randevu" && entry.name !== "randevu" && entry.url !== expectedUrl,
    ),
    {
      // The deployed update-retell-llm endpoint keys MCP servers by `id` and
      // rejects entries without one ("MCP id cannot be empty or null"); the
      // SDK docs omit the field. general_tools entries reference it as mcp_id.
      id: "randevu",
      name: "randevu",
      url: expectedUrl,
      headers: { Authorization: `Bearer ${token}` },
      timeout_ms: 5000,
    },
  ];
}

// No input_schema on these: the deployed general_tools validator only accepts
// string-valued input_schema.properties/required and 400s on object schemas,
// while tool discovery pulls the real schemas from /retell/mcp anyway.
const RUNTIME_MCP_TOOLS = [
  {
    type: "mcp",
    mcp_id: "randevu",
    name: "get_call_context",
    description:
      "Read the latest Randevu customer record, configured information and active services for the caller. Call this before asking for customer details and pass {{user_number}} as phone.",
    speak_during_execution: false,
    speak_after_execution: false,
  },
  {
    type: "mcp",
    mcp_id: "randevu",
    name: "save_customer_details",
    description:
      "Save information immediately after the caller provides or explicitly confirms it. Use only configured keys, never guess, and pass {{user_number}} as phone.",
    speak_during_execution: false,
    speak_after_execution: false,
  },
] satisfies Record<string, unknown>[];

function withRuntimeMcpTools(tools: Record<string, unknown>[] | undefined) {
  if (!siteUrl()) return tools ?? [];
  const managedNames = new Set(RUNTIME_MCP_TOOLS.map((tool) => tool.name));
  return [
    ...(tools ?? []).filter(
      (tool) =>
        !(
          tool.type === "mcp" &&
          tool.mcp_id === "randevu" &&
          managedNames.has(String(tool.name ?? ""))
        ),
    ),
    ...RUNTIME_MCP_TOOLS,
  ];
}

type VariableRow = VoiceVariableInput;

function humanizeKey(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

function analysisType(value: unknown): VariableRow["type"] | null {
  return value === "string" || value === "number" || value === "boolean" || value === "enum"
    ? value
    : null;
}

function storedVariables(context: EditorContext): VariableRow[] {
  return context.variables.map((row) => ({
    key: row.key,
    label: row.label,
    description: row.description,
    type: row.type,
    choices: row.choices,
    required: row.required,
    beforeSource: row.beforeSource,
    beforeValue: row.beforeValue,
    beforeFieldId: row.beforeFieldId,
    duringMode: row.duringMode,
    afterCall: row.afterCall,
    destination: row.destination,
    contactFieldId: row.contactFieldId,
    customerField: row.customerField,
  }));
}

// Existing agents start in Retell, not in our database. Fold its three provider
// shapes into the same lifecycle rows the editor uses, keyed by variable name.
// A publish then adopts those rows without losing fields the owner already had.
function importVariables(
  context: EditorContext,
  agent: AgentDoc,
  llm: LlmDoc | null,
): VariableRow[] {
  const byKey = new Map<string, VariableRow>();
  const voiceFields = new Map(
    context.fields.filter((field) => field.source === "voice").map((field) => [field.key, field]),
  );
  const ensure = (rawKey: string): VariableRow | null => {
    const key = normaliseVoiceVariableKey(rawKey);
    if (!key) return null;
    const existing = byKey.get(key);
    if (existing) return existing;
    const field = voiceFields.get(key);
    const type: VariableRow["type"] = field
      ? field.type === "select"
        ? "enum"
        : field.type === "number"
          ? "number"
          : "string"
      : "string";
    const row: VariableRow = {
      key,
      label: field?.label ?? humanizeKey(key),
      description: "",
      type,
      choices: type === "enum" ? field?.options ?? [] : undefined,
      required: false,
      beforeSource: "none",
      duringMode: "none",
      afterCall: false,
      destination: field ? "contact" : "call",
      contactFieldId: field?._id as VariableRow["contactFieldId"],
    };
    byKey.set(key, row);
    return row;
  };

  for (const [name, value] of Object.entries(llm?.default_dynamic_variables ?? {})) {
    const row = ensure(name);
    if (!row) continue;
    row.beforeSource = "static";
    row.beforeValue = value;
  }
  for (const tool of llm?.general_tools ?? []) {
    if (tool.type !== "extract_dynamic_variable" || !Array.isArray(tool.variables)) continue;
    for (const item of tool.variables as Record<string, unknown>[]) {
      const row = ensure(String(item.name ?? ""));
      const type = analysisType(item.type);
      if (!row || !type) continue;
      row.type = type;
      row.choices = type === "enum" && Array.isArray(item.choices)
        ? item.choices.map(String)
        : undefined;
      row.description = String(item.description ?? row.description);
      row.required = item.required === true;
      row.duringMode = "if_missing";
    }
  }
  for (const item of agent.post_call_analysis_data ?? []) {
    if (item.type === "system-presets") continue;
    const row = ensure(String(item.name ?? ""));
    const type = analysisType(item.type);
    if (!row || !type) continue;
    row.type = type;
    row.choices = type === "enum" && Array.isArray(item.choices)
      ? item.choices.map(String)
      : undefined;
    row.description = String(item.description ?? row.description);
    row.required = item.required === true;
    row.afterCall = true;
  }
  return [...byKey.values()];
}

// ── Read ─────────────────────────────────────────────────────────────────────

export const read = action({
  args: { agentId: v.string() },
  returns: v.any(),
  handler: async (ctx, { agentId }) => {
    const context = await editorContext(ctx, agentId);
    const key = context.apiKey!;
    const id = encodeURIComponent(agentId);
    const agent = (await (await call(key, "GET", `get-agent/${id}`)).json()) as AgentDoc;
    if (agent.agent_name) {
      await ctx.runMutation(internal.retell.rememberAgentName, {
        retellAgentId: agentId,
        name: agent.agent_name,
      });
    }
    const engine = agent.response_engine ?? {};

    // The voice picker's options, on the same read as the agent. A voice-list
    // outage must not blank the prompt editor — the picker just falls back to
    // showing the id it already has.
    const voices = await (async () => {
      try {
        const res = await call(key, "GET", "list-voices");
        return voiceCatalogue(await res.json(), agent.voice_id ?? null);
      } catch {
        return [];
      }
    })();

    // The account's phone lines, so the agent's own page can say which number
    // rings it — and move or drop that line without a trip back to the list.
    // Same tolerance as the voice catalogue: a numbers outage costs the
    // dropdown, not the prompt editor.
    const lines = await (async () => {
      try {
        const data: unknown = await (await call(key, "GET", "v2/list-phone-numbers")).json();
        const items = (
          Array.isArray(data) ? data : (data as { items?: unknown[] })?.items ?? []
        ) as Array<{
          phone_number?: string;
          nickname?: string;
          inbound_agent_id?: string;
          inbound_agents?: Array<{ agent_id?: string }>;
          outbound_agents?: Array<{ agent_id?: string }>;
        }>;
        return items
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
      } catch {
        return [];
      }
    })();

    let llm: LlmDoc | null = null;
    if (engine.type === "retell-llm" && engine.llm_id) {
      llm = (await (
        await call(key, "GET", `get-retell-llm/${encodeURIComponent(engine.llm_id)}`)
      ).json()) as LlmDoc;
    }

    // The question the old card never answered. It printed two URLs to copy and
    // left you to compare strings across two browser tabs — so an agent could
    // sit there looking connected while its results went nowhere.
    const expected = siteUrl() ? `${siteUrl()}/retell/call-ended` : null;
    const actual = agent.webhook_url ?? null;

    return {
      agentId: agent.agent_id,
      name: agent.agent_name ?? agentId,
      version: agent.version ?? null,
      voiceId: agent.voice_id ?? null,
      voices,
      language: agent.language ?? null,
      engineType: engine.type ?? null,
      llmId: engine.llm_id ?? null,
      lines,
      // The provider's answer, not ours: whoever holds the line at Retell is
      // who the phone actually rings, and a stored value that disagrees is the
      // bug this is meant to show rather than hide.
      inboundNumber: lines.find((line) => line.agentId === agentId)?.number ?? null,
      // A null prompt is not "it has none": conversation-flow and custom-llm
      // agents keep their script elsewhere. The client says which from
      // engineType, in the org's language, so no English copy is baked here.
      prompt: llm
        ? { general: llm.general_prompt ?? "", beginMessage: llm.begin_message ?? "" }
        : null,
      webhook: {
        expected,
        actual,
        // Not a string compare on the whole URL: an agent pointed at this
        // deployment's /retell/functions is still wired to us, just at the
        // wrong path, and that is a different fix from "points at a stranger".
        wired: Boolean(expected && actual && actual === expected),
        pointsElsewhere: Boolean(actual && expected && actual !== expected),
      },
      variables: {
        preCall: Object.entries(llm?.default_dynamic_variables ?? {}).map(
          ([name, value]) => ({ name, value }),
        ),
        duringCall: (llm?.general_tools ?? []).map((tool) => ({
          name: String(tool.name ?? ""),
          type: String(tool.type ?? ""),
          description: String(tool.description ?? ""),
        })),
        postCall: (agent.post_call_analysis_data ?? []).map((field) => ({
          name: String(field.name ?? ""),
          type: String(field.type ?? ""),
          description: String(field.description ?? ""),
        })),
      },
      variableConfig: {
        managed: context.variablesSyncedAt !== null,
        items:
          context.variablesSyncedAt !== null
            ? storedVariables(context)
            : importVariables(context, agent, llm),
      },
      contactFields: context.fields.map((field) => ({
        id: field._id,
        key: field.key,
        label: field.label,
        type: field.type,
        options: field.options ?? [],
        voice: field.source === "voice",
      })),
    };
  },
});

// ── Publish ──────────────────────────────────────────────────────────────────

// A published LLM refuses a bare PATCH ("Cannot update published LLM", 400),
// exactly as a published agent refuses one with 422. LLM versions mirror the
// agent's and cannot be created on their own — there is no
// create-retell-llm-version — so the only writable draft comes from the agent
// side: clone the agent, read the LLM version THAT draft points at, patch that
// version, publish the draft.
//
// Learned the hard way in Nudge: patching the LLM directly works exactly once
// per agent, while it is still a draft, and silently breaks forever after the
// first publish.
async function publishViaDraft(
  key: string,
  agentId: string,
  llmId: string,
  patch: Record<string, unknown>,
  // Fields that live on the AGENT doc rather than the LLM — voice is the one
  // that matters here. Folded into the same draft so "how it speaks" and "what
  // it says" land as ONE published version: two writes would mean a window
  // where a caller hears the new voice reading the old script.
  agentPatch?: Record<string, unknown>,
): Promise<number | null> {
  const id = encodeURIComponent(agentId);
  const live = (await (await call(key, "GET", `get-agent/${id}`)).json()) as AgentDoc;
  if (live.version === undefined) throw new Error("Agent has no version to clone.");

  const draft = (await (
    await call(key, "POST", `create-agent-version/${id}`, { base_version: live.version })
  ).json()) as { version?: number };
  if (draft.version === undefined) throw new Error("Retell returned no draft version.");

  const draftAgent = (await (
    await call(key, "GET", `get-agent/${id}?version=${draft.version}`)
  ).json()) as AgentDoc;
  const llmVersion = draftAgent.response_engine?.version;

  await call(key, "PATCH", `update-retell-llm/${encodeURIComponent(llmId)}`, {
    ...(llmVersion !== undefined ? { version: llmVersion } : {}),
    ...patch,
  });
  if (agentPatch && Object.keys(agentPatch).length > 0) {
    await call(key, "PATCH", `update-agent/${id}`, {
      version: draft.version,
      ...agentPatch,
    });
  }
  await call(key, "POST", `publish-agent-version/${id}`, { version: draft.version });
  return draft.version;
}

export const publishPrompt = action({
  args: {
    agentId: v.string(),
    generalPrompt: v.string(),
    beginMessage: v.optional(v.string()),
    // Omitted means "leave the voice alone" — the undo path republishes an old
    // prompt and must not drag a stale voice back with it.
    voiceId: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    version: v.union(v.number(), v.null()),
    previousPrompt: v.string(),
  }),
  handler: async (ctx, { agentId, generalPrompt, beginMessage, voiceId }) => {
    const context = await editorContext(ctx, agentId);
    const key = context.apiKey!;
    const agent = (await (
      await call(key, "GET", `get-agent/${encodeURIComponent(agentId)}`)
    ).json()) as AgentDoc;
    const llmId = agent.response_engine?.llm_id;
    if (!llmId) throw new Error("This agent has no editable prompt.");

    const before = (await (
      await call(key, "GET", `get-retell-llm/${encodeURIComponent(llmId)}`)
    ).json()) as LlmDoc;

    const version = await publishViaDraft(key, agentId, llmId, {
      general_prompt: generalPrompt,
      ...(beginMessage !== undefined ? { begin_message: beginMessage } : {}),
      mcps: await runtimeMcpConfig(ctx, agentId, context, before),
      general_tools: withRuntimeMcpTools(before.general_tools),
    },
    voiceId?.trim() ? { voice_id: voiceId.trim() } : undefined);
    if (siteUrl()) {
      await ctx.runMutation(internal.retell.markRuntimeConnected, {
        retellAgentId: agentId,
      });
    }
    // Returned so the caller can offer "undo" without a second round trip. The
    // LLM is patched in place, so there is no earlier version to point at.
    return { ok: true, version, previousPrompt: before.general_prompt ?? "" };
  },
});

function variableForRetell(variable: VariableRow): Record<string, unknown> {
  return {
    type: variable.type,
    name: variable.key,
    description: variable.description.trim() || `Capture ${variable.label}.`,
    ...(variable.type === "enum" ? { choices: variable.choices ?? [] } : {}),
    ...(variable.required ? { required: true } : {}),
  };
}

function validateVariables(context: EditorContext, input: VariableRow[]): VariableRow[] {
  if (input.length > 50) throw new Error("Too many variables. Keep the agent under 50 fields.");
  const fields = new Map(context.fields.map((field) => [String(field._id), field]));
  const seen = new Set<string>();
  return input.map((raw) => {
    const key = normaliseVoiceVariableKey(raw.key);
    const label = raw.label.trim();
    if (!key || key !== raw.key.trim()) throw new Error(`Invalid variable key: ${raw.key}`);
    if (!label) throw new Error(`Variable ${key} needs a label.`);
    if (seen.has(key)) throw new Error(`Variable ${key} appears more than once.`);
    seen.add(key);
    let choices =
      raw.type === "enum"
        ? [...new Set((raw.choices ?? []).map((choice) => choice.trim()).filter(Boolean))]
        : undefined;
    if (
      raw.beforeSource === "contact_field" &&
      (!raw.beforeFieldId || !fields.has(String(raw.beforeFieldId)))
    ) {
      throw new Error(`${label} needs a valid before-call source.`);
    }
    let contactFieldId = raw.contactFieldId;
    let customerField = raw.customerField;
    if (raw.destination === "customer") {
      if (customerField !== "name" && customerField !== "email") {
        throw new Error(`${label} needs to say which customer detail it fills.`);
      }
      // Both are free text as spoken. An enum name is not a thing, and an
      // enum email is a way to make the agent pick the wrong one of four.
      if (raw.type !== "string") {
        throw new Error(`${label} must be a text value to fill the customer's ${customerField}.`);
      }
      contactFieldId = undefined;
      choices = undefined;
    } else if (raw.destination === "contact") {
      const field = contactFieldId ? fields.get(String(contactFieldId)) : null;
      if (!field || field.source !== "voice") {
        throw new Error(`${label} needs a voice-filled customer field.`);
      }
      if (field.key !== key) {
        throw new Error(`${label} must use the customer field's variable key.`);
      }
      // The field's options are the live truth for a linked select: editing
      // them in Business ripples into the agent's next publish without the
      // row's stale copy getting a say.
      if (field.type === "select" && raw.type === "enum") {
        choices = [...new Set((field.options ?? []).map((o) => o.trim()).filter(Boolean))];
      }
    } else {
      contactFieldId = undefined;
    }
    if (raw.destination !== "customer") customerField = undefined;
    if (raw.type === "enum" && (choices?.length ?? 0) === 0) {
      throw new Error(`${label} needs at least one option.`);
    }
    if (raw.beforeSource === "none" && raw.duringMode === "none" && !raw.afterCall) {
      throw new Error(`${label} is not used at any point in the call.`);
    }
    return {
      ...raw,
      key,
      label,
      description: raw.description.trim(),
      choices,
      beforeValue: raw.beforeSource === "static" ? raw.beforeValue?.trim() : undefined,
      beforeFieldId: raw.beforeSource === "contact_field" ? raw.beforeFieldId : undefined,
      contactFieldId,
      customerField,
    };
  });
}

// Publishes the lifecycle as one Retell version. One draft contains both the
// response-engine changes (defaults + live extraction) and the agent changes
// (post-call analysis), so callers can never land between two configurations.
// Publishing the lifecycle, minus who is asking. `editorContext` is the only
// thing in here that ever cared about identity, and it now takes the org
// directly, so both doors below share one copy of the draft-then-publish
// ordering rather than growing a second one that drifts.
async function publishVariableSet(
  ctx: ActionCtx,
  {
    agentId,
    baseVersion,
    variables,
    orgId,
  }: {
    agentId: string;
    baseVersion?: number;
    variables: VariableRow[];
    orgId?: Id<"orgs">;
  },
): Promise<{ ok: boolean; version: number | null }> {
  const context = await editorContext(ctx, agentId, orgId);
  const key = context.apiKey!;
  const next = validateVariables(context, variables);
  const id = encodeURIComponent(agentId);
  const live = (await (await call(key, "GET", `get-agent/${id}`)).json()) as AgentDoc;
  if (baseVersion !== undefined && live.version !== baseVersion) {
    throw new Error("This agent changed in Retell. Refresh before publishing.");
  }

  const llmId = live.response_engine?.llm_id;
  const needsLlm = next.some(
    (variable) => variable.beforeSource !== "none" || variable.duringMode !== "none",
  );
  if (needsLlm && (live.response_engine?.type !== "retell-llm" || !llmId)) {
    throw new Error("Before-call and during-call variables require a Retell LLM agent.");
  }
  const liveLlm = llmId
    ? ((await (
        await call(key, "GET", `get-retell-llm/${encodeURIComponent(llmId)}`)
      ).json()) as LlmDoc)
    : null;
  const preservedTools = (liveLlm?.general_tools ?? []).filter(
    (tool) => tool.type !== "extract_dynamic_variable",
  );
  const during = next.filter((variable) => variable.duringMode !== "none");
  const generalTools = withRuntimeMcpTools([
    ...preservedTools,
    ...(during.length > 0
      ? [
          {
            type: "extract_dynamic_variable",
            name: "randevu_collect",
            description:
              "Capture configured customer details when they are provided. Fields marked for confirmation must only be updated after the caller explicitly confirms them.",
            variables: during.map((variable) => ({
              ...variableForRetell(variable),
              description:
                variable.duringMode === "confirm"
                  ? `${variable.description.trim() || variable.label} Only store this after the caller explicitly confirms it.`
                  : variable.description.trim() ||
                    `Capture ${variable.label} when the caller provides it.`,
            })),
            enable_typing_sound: false,
          },
        ]
      : []),
  ]);
  const defaultDynamicVariables: Record<string, string> = {};
  for (const variable of next) {
    if (variable.beforeSource === "static" && variable.beforeValue) {
      defaultDynamicVariables[variable.key] = variable.beforeValue;
    } else if (variable.beforeSource === "business_name") {
      defaultDynamicVariables[variable.key] = context.orgName;
    }
  }
  const postCallAnalysis = [
    ...(live.post_call_analysis_data ?? []).filter(
      (item) => item.type === "system-presets",
    ),
    ...next.filter((variable) => variable.afterCall).map(variableForRetell),
  ];

  if (live.version === undefined) throw new Error("Agent has no version to clone.");
  const draft = (await (
    await call(key, "POST", `create-agent-version/${id}`, { base_version: live.version })
  ).json()) as { version?: number };
  if (draft.version === undefined) throw new Error("Retell returned no draft version.");
  const draftAgent = (await (
    await call(key, "GET", `get-agent/${id}?version=${draft.version}`)
  ).json()) as AgentDoc;

  if (llmId) {
    const llmVersion = draftAgent.response_engine?.version;
    await call(key, "PATCH", `update-retell-llm/${encodeURIComponent(llmId)}`, {
      ...(llmVersion !== undefined ? { version: llmVersion } : {}),
      default_dynamic_variables: defaultDynamicVariables,
      general_tools: generalTools,
      mcps: await runtimeMcpConfig(ctx, agentId, context, liveLlm ?? {}),
    });
  }
  await call(key, "PATCH", `update-agent/${id}`, {
    version: draft.version,
    post_call_analysis_data: postCallAnalysis,
  });
  await call(key, "POST", `publish-agent-version/${id}`, { version: draft.version });
  await ctx.runMutation(internal.retell.replaceAgentVariables, {
    retellAgentId: agentId,
    retellVersion: draft.version,
    variables: next,
  });
  if (siteUrl()) {
    await ctx.runMutation(internal.retell.markRuntimeConnected, {
      retellAgentId: agentId,
    });
  }
  return { ok: true, version: draft.version };
}

export const publishVariables = action({
  args: {
    agentId: v.string(),
    baseVersion: v.optional(v.number()),
    variables: v.array(voiceVariableInput),
  },
  returns: v.object({ ok: v.boolean(), version: v.union(v.number(), v.null()) }),
  handler: async (ctx, args): Promise<{ ok: boolean; version: number | null }> =>
    await publishVariableSet(ctx, args),
});

// The sessionless door. Note this one takes an orgId where the public action
// deliberately cannot: `editorContext` TRUSTS the org it is given and only
// checks that the agent belongs to it, so a public action accepting one would
// let a client edit any agent whose id they could name.
export const publishVariablesForOrg = internalAction({
  args: {
    orgId: v.id("orgs"),
    agentId: v.string(),
    baseVersion: v.optional(v.number()),
    variables: v.array(voiceVariableInput),
  },
  returns: v.object({ ok: v.boolean(), version: v.union(v.number(), v.null()) }),
  handler: async (ctx, args): Promise<{ ok: boolean; version: number | null }> =>
    await publishVariableSet(ctx, args),
});

// ── Webhook ──────────────────────────────────────────────────────────────────

async function wireAgent(
  ctx: ActionCtx,
  agentId: string,
  context: EditorContext,
): Promise<{ ok: true; url: string; version: number | null }> {
  const key = context.apiKey!;
  const site = siteUrl();
  if (!site) {
    throw new Error("This deployment exposes no site URL, so there is nothing to point at.");
  }
  const url = `${site}/retell/call-ended`;
  const id = encodeURIComponent(agentId);
  const live = (await (await call(key, "GET", `get-agent/${id}`)).json()) as AgentDoc;
  if (live.version === undefined) throw new Error("Agent has no version to clone.");
  const draft = (await (
    await call(key, "POST", `create-agent-version/${id}`, { base_version: live.version })
  ).json()) as { version?: number };
  if (draft.version === undefined) throw new Error("Retell returned no draft version.");
  const draftAgent = (await (
    await call(key, "GET", `get-agent/${id}?version=${draft.version}`)
  ).json()) as AgentDoc;
  const llmId = draftAgent.response_engine?.llm_id;
  if (llmId) {
    const liveLlm = (await (
      await call(key, "GET", `get-retell-llm/${encodeURIComponent(llmId)}`)
    ).json()) as LlmDoc;
    const llmVersion = draftAgent.response_engine?.version;
    await call(key, "PATCH", `update-retell-llm/${encodeURIComponent(llmId)}`, {
      ...(llmVersion !== undefined ? { version: llmVersion } : {}),
      mcps: await runtimeMcpConfig(ctx, agentId, context, liveLlm),
      general_tools: withRuntimeMcpTools(liveLlm.general_tools),
    });
  }
  await call(key, "PATCH", `update-agent/${id}`, { version: draft.version, webhook_url: url });
  await call(key, "POST", `publish-agent-version/${id}`, { version: draft.version });

  // Agent webhooks deliver the result. Number-level inbound webhooks run
  // before the call is answered and are the only point where caller-specific
  // context can be injected. Wire every number currently routed to this
  // agent; PATCHing only this field preserves Retell's routing weights.
  const numberData: unknown = await (
    await call(key, "GET", "v2/list-phone-numbers")
  ).json();
  const numbers = (
    Array.isArray(numberData)
      ? numberData
      : (numberData as { items?: unknown[] })?.items ?? []
  ) as Array<{
    phone_number?: string;
    inbound_agent_id?: string;
    inbound_agents?: Array<{ agent_id?: string }>;
  }>;
  const inboundUrl = `${site}/retell/inbound`;
  for (const number of numbers) {
    const belongs =
      number.inbound_agent_id === agentId ||
      number.inbound_agents?.some((candidate) => candidate.agent_id === agentId);
    if (!belongs || !number.phone_number) continue;
    await call(
      key,
      "PATCH",
      `update-phone-number/${encodeURIComponent(number.phone_number)}`,
      { inbound_webhook_url: inboundUrl },
    );
  }
  await ctx.runMutation(internal.retell.markRuntimeConnected, {
    retellAgentId: agentId,
  });
  return { ok: true, url, version: draft.version };
}

async function bindInboundNumber(
  key: string,
  site: string,
  number: string,
  agentId: string,
) {
  const numberData: unknown = await (
    await call(key, "GET", "v2/list-phone-numbers")
  ).json();
  const numbers = (
    Array.isArray(numberData)
      ? numberData
      : (numberData as { items?: unknown[] })?.items ?? []
  ) as Array<{
    phone_number?: string;
    inbound_agent_id?: string;
    inbound_agents?: Array<{ agent_id?: string }>;
  }>;
  const target = numbers.find((candidate) => candidate.phone_number === number);
  if (!target) throw new Error("phone-line-not-found");
  const assigned = [
    target.inbound_agent_id,
    ...(target.inbound_agents ?? []).map((candidate) => candidate.agent_id),
  ].filter(Boolean);
  if (assigned.some((assignedId) => assignedId !== agentId)) {
    throw new Error("phone-line-already-assigned");
  }
  await call(key, "PATCH", `update-phone-number/${encodeURIComponent(number)}`, {
    inbound_agents: [
      { agent_id: agentId, agent_version: "latest_published", weight: 1 },
    ],
    inbound_webhook_url: `${site}/retell/inbound`,
  });
}

// Native creation is a durable orchestration, not a browser sequence. The
// job table checkpoints every external id and leases one worker so a retry,
// refresh or double-click continues the same setup.
const createAgentArgs = {
  requestId: v.string(),
  name: v.string(),
  language: v.union(v.literal("tr-TR"), v.literal("en-US"), v.literal("de-DE")),
  voiceId: v.string(),
  inboundNumber: v.optional(v.string()),
} as const;

const createAgentResult = v.object({
  status: v.union(v.literal("working"), v.literal("complete")),
  agentId: v.union(v.string(), v.null()),
});

// All of provisioning except who is asking. Everything past the lease — engine,
// agent, publish, connect, line, runtime wiring — reads the job row and never
// identity, so one copy serves both doors below and there is a single place
// where the checkpoint order can be got right.
async function provisionAgent(
  ctx: ActionCtx,
  args: {
    requestId: string;
    name: string;
    language: VoiceAgentLanguage;
    voiceId: string;
    inboundNumber?: string;
    // Absent on the signed-in path, where `begin` resolves it from the session.
    orgId?: Id<"orgs">;
  },
): Promise<{ status: "working" | "complete"; agentId: string | null }> {
  const leaseToken = crypto.randomUUID();
  const started = (await ctx.runMutation(internal.voiceProvisioning.begin, {
    ...args,
    leaseToken,
  })) as {
    claimed: boolean;
    complete: boolean;
    apiKey: string;
    orgName: string;
    row: {
      _id: string;
      status: string;
      name: string;
      language: VoiceAgentLanguage;
      voiceId: string;
      inboundNumber?: string;
      retellLlmId?: string;
      retellAgentId?: string;
      retellVersion?: number;
    };
  };
  if (started.complete) {
    return { status: "complete", agentId: started.row.retellAgentId ?? null };
  }
  if (!started.claimed) {
    return { status: "working", agentId: started.row.retellAgentId ?? null };
  }

  const jobId = started.row._id as Id<"voiceAgentProvisioning">;
  const key = started.apiKey;
  try {
    const site = siteUrl();
    if (!site) throw new Error("deployment-site-url-missing");
    const template = appointmentReceptionistTemplate({
      language: started.row.language,
      businessName: started.orgName,
      site,
    });

    let llmId = started.row.retellLlmId;
    if (!llmId) {
      await ctx.runMutation(internal.voiceProvisioning.checkpoint, {
        jobId,
        leaseToken,
        status: "creating_engine",
      });
      const createdLlm = (await (
        await call(key, "POST", "create-retell-llm", template.llm)
      ).json()) as { llm_id?: string };
      if (!createdLlm.llm_id) throw new Error("provider-returned-no-response-engine");
      llmId = createdLlm.llm_id;
      await ctx.runMutation(internal.voiceProvisioning.checkpoint, {
        jobId,
        leaseToken,
        status: "creating_agent",
        retellLlmId: llmId,
      });
    }

    let agentId = started.row.retellAgentId;
    let initialVersion = started.row.retellVersion;
    if (!agentId) {
      const createdAgent = (await (
        await call(key, "POST", "create-agent", {
          response_engine: { type: "retell-llm", llm_id: llmId },
          voice_id: started.row.voiceId,
          agent_name: started.row.name,
          ...template.agent,
        })
      ).json()) as AgentDoc;
      if (!createdAgent.agent_id) throw new Error("provider-returned-no-agent");
      agentId = createdAgent.agent_id;
      initialVersion = createdAgent.version ?? 0;
      await ctx.runMutation(internal.voiceProvisioning.checkpoint, {
        jobId,
        leaseToken,
        status: "publishing",
        retellAgentId: agentId,
        retellVersion: initialVersion,
      });
    }

    if (initialVersion === undefined) initialVersion = 0;
    const initial = (await (
      await call(
        key,
        "GET",
        `get-agent/${encodeURIComponent(agentId)}?version=${initialVersion}`,
      )
    ).json()) as AgentDoc;
    if (!initial.is_published) {
      await call(key, "POST", `publish-agent-version/${encodeURIComponent(agentId)}`, {
        version: initialVersion,
        version_title: `Randevu template v${VOICE_AGENT_TEMPLATE_VERSION}`,
      });
    }
    await ctx.runMutation(internal.voiceProvisioning.checkpoint, {
      jobId,
      leaseToken,
      status: "connecting",
      retellVersion: initialVersion,
    });
    await ctx.runMutation(internal.voiceProvisioning.connect, {
      jobId,
      leaseToken,
      retellAgentId: agentId,
      inboundNumber: started.row.inboundNumber,
    });
    if (started.row.inboundNumber) {
      await bindInboundNumber(key, site, started.row.inboundNumber, agentId);
    }
    const context = await editorContext(ctx, agentId, args.orgId);
    const wired = await wireAgent(ctx, agentId, context);
    await ctx.runMutation(internal.voiceProvisioning.complete, {
      jobId,
      leaseToken,
      retellVersion: wired.version ?? undefined,
    });
    return { status: "complete", agentId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "phone-agent-setup-failed";
    await ctx.runMutation(internal.voiceProvisioning.fail, {
      jobId,
      leaseToken,
      error: message,
    });
    throw error;
  }
}

// The picker's list, for a caller with no browser. `read` already returns
// voices, but only alongside an agent that exists — and choosing a voice is
// something you do BEFORE there is one.
export const voiceOptionsForOrg = internalAction({
  args: { orgId: v.id("orgs") },
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      gender: v.string(),
      accent: v.string(),
      previewUrl: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { orgId }): Promise<CatalogueVoice[]> => {
    const context = (await ctx.runQuery(internal.agentTools.phoneAgentContext, {
      orgId,
    })) as { demoMode: boolean; apiKey: string | null };
    if (context.demoMode) {
      throw new Error("This is the demo workspace. It holds no Retell credentials.");
    }
    if (!context.apiKey) throw new Error("No Retell API key for this workspace yet.");
    return voiceCatalogue(await (await call(context.apiKey, "GET", "list-voices")).json(), null);
  },
});

// The signed-in door. It deliberately does NOT accept an orgId: adding one
// here would let a client provision into another salon's workspace, since
// `begin` trusts the field when it is present.
export const createAgent = action({
  args: createAgentArgs,
  returns: createAgentResult,
  handler: async (ctx, args): Promise<{
    status: "working" | "complete";
    agentId: string | null;
  }> => await provisionAgent(ctx, args),
});

// The same provisioning for a caller that established the org without a
// browser session — the MCP connector, whose key re-checks membership on every
// request, or an operator CLI run. Internal, so no client can reach it; the
// caller is responsible for having proved this person owns this org first.
export const createAgentForOrg = internalAction({
  args: { orgId: v.id("orgs"), ...createAgentArgs },
  returns: createAgentResult,
  handler: async (ctx, args): Promise<{
    status: "working" | "complete";
    agentId: string | null;
  }> => await provisionAgent(ctx, args),
});

export const wireWebhook = action({
  args: { agentId: v.string() },
  returns: v.object({ ok: v.boolean(), url: v.string(), version: v.union(v.number(), v.null()) }),
  handler: async (ctx, { agentId }) => {
    const context = await editorContext(ctx, agentId);
    return await wireAgent(ctx, agentId, context);
  },
});

// The Inbound number dropdown is a routing control, not a note. Assigning a
// line rebinds it at the provider first; only then does the database adopt
// the change, clearing the number from whichever agent held it before.
async function assignLineTo(
  ctx: ActionCtx,
  { agentId, number, orgId }: { agentId: string; number: string | null; orgId?: Id<"orgs"> },
): Promise<null> {
  const context = await editorContext(ctx, agentId, orgId);
  const key = context.apiKey!;
  const site = siteUrl();
  const target = number?.trim() || null;
  const previous = context.inboundNumber;
  if (target) {
    // Replacing inbound_agents outright is also how a line MOVES: whichever
    // agent held it stops answering the moment this lands, at the provider and
    // then in applyLineAssignment.
    await call(key, "PATCH", `update-phone-number/${encodeURIComponent(target)}`, {
      inbound_agents: [
        { agent_id: agentId, agent_version: "latest_published", weight: 1 },
      ],
      ...(site ? { inbound_webhook_url: `${site}/retell/inbound` } : {}),
    });
  }
  if (previous && previous !== target) {
    await releaseLineIfHeld(key, previous, agentId);
  }
  await ctx.runMutation(internal.retell.applyLineAssignment, {
    retellAgentId: agentId,
    number: target,
  });
  return null;
}

export const assignLine = action({
  args: {
    agentId: v.string(),
    number: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => await assignLineTo(ctx, args),
});

// Sessionless twin. Same rule as the others: internal only, and the public
// action above must never accept an orgId.
export const assignLineForOrg = internalAction({
  args: {
    orgId: v.id("orgs"),
    agentId: v.string(),
    number: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => await assignLineTo(ctx, args),
});

// Unbinding must not clobber routing the agent no longer owns: another agent
// may have taken the line between the read and this write, so release only a
// line the departing agent still answers.
async function releaseLineIfHeld(key: string, number: string, agentId: string) {
  const numberData: unknown = await (
    await call(key, "GET", "v2/list-phone-numbers")
  ).json();
  const numbers = (
    Array.isArray(numberData)
      ? numberData
      : (numberData as { items?: unknown[] })?.items ?? []
  ) as Array<{
    phone_number?: string;
    inbound_agent_id?: string;
    inbound_agents?: Array<{ agent_id?: string }>;
  }>;
  const entry = numbers.find((candidate) => candidate.phone_number === number);
  if (!entry) return;
  const holds =
    entry.inbound_agent_id === agentId ||
    entry.inbound_agents?.some((candidate) => candidate.agent_id === agentId);
  if (!holds) return;
  await call(key, "PATCH", `update-phone-number/${encodeURIComponent(number)}`, {
    inbound_agents: [],
  });
}

// ── Test call ────────────────────────────────────────────────────────────────

// Places a REAL outbound call. There is no dry mode in Retell and no way to
// fake one from here — the phone genuinely rings and the minutes are genuinely
// billed. The UI asks before calling this; do not add a caller that does not.
export const testCall = action({
  args: { agentId: v.string(), toNumber: v.string(), fromNumber: v.optional(v.string()) },
  returns: v.object({
    ok: v.boolean(),
    callId: v.union(v.string(), v.null()),
    from: v.string(),
    to: v.string(),
  }),
  handler: async (ctx, { agentId, toNumber, fromNumber }) => {
    const key = (await editorContext(ctx, agentId)).apiKey!;
    const to = toNumber.trim();
    if (!/^\+[1-9]\d{6,14}$/.test(to)) {
      throw new Error("Enter the number in full international form, e.g. +905321234567.");
    }

    // Pick a from-number bound to this agent when one was not given: Retell
    // rejects a call from a number the account does not own, and making the
    // owner hunt for it defeats the point of a test button.
    let from = fromNumber?.trim() ?? "";
    if (!from) {
      const list = (await (
        await call(key, "GET", "v2/list-phone-numbers")
      ).json()) as { phone_number?: string; outbound_agent_id?: string }[];
      const rows = Array.isArray(list) ? list : [];
      from =
        rows.find((n) => n.outbound_agent_id === agentId)?.phone_number ??
        rows[0]?.phone_number ??
        "";
    }
    if (!from) {
      throw new Error("This Retell account has no phone number to call from.");
    }

    const before = (await ctx.runQuery(internal.retell.beforeCallContext, {
      retellAgentId: agentId,
      phone: to,
    })) as { dynamicVariables: Record<string, string> } | null;

    const res = (await (
      await call(key, "POST", "v2/create-phone-call", {
        from_number: from,
        to_number: to,
        override_agent_id: agentId,
        ...(before && Object.keys(before.dynamicVariables).length > 0
          ? { retell_llm_dynamic_variables: before.dynamicVariables }
          : {}),
      })
    ).json()) as { call_id?: string };

    return { ok: true, callId: res.call_id ?? null, from, to };
  },
});
