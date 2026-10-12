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
import { cleanError } from "./lib/mcpProtocol";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { voiceVariableInput, normaliseVoiceVariableKey, type VoiceVariableInput } from "./lib/voiceVariables";
import { voiceCatalogue, type CatalogueVoice } from "./lib/voiceCatalogue";
import {
  createVoiceRuntimeToken,
  hashVoiceRuntimeToken,
} from "./lib/voiceRuntime";
import { enginePatchFor } from "./lib/voiceModels";
import {
  appointmentReceptionistTemplate,
  saveCustomerDetailsTool,
  summaryAnalysisField,
  DEFAULT_VOICE_IDS,
  END_CALL_TOOL_NAME,
  VOICE_AGENT_TEMPLATE_VERSION,
  VOICE_SUMMARY_FIELD,
  type VoiceAgentLanguage,
} from "./lib/voiceAgentTemplate";
import { mergeBoostedKeywords } from "./lib/boostedKeywords";

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
  // Voicemail handling. The FIELD'S PRESENCE arms detection and an explicit
  // null disarms it — there is no boolean (lib/voiceAgentTemplate
  // VOICEMAIL_ACTION). Read here for one reason: detection_prompt is a
  // definition of what COUNTS as voicemail that an owner can only write in
  // the provider's dashboard, and a PATCH that omits the key drops it.
  voicemail_option?: {
    action?: { type?: string; text?: string };
    detection_prompt?: string;
  } | null;
  // Words the speech recogniser should expect. Read so a publish can keep
  // the ones Resepta did not put there (lib/boostedKeywords).
  boosted_keywords?: string[];
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
  // Returned by agentEditorContext all along, just never declared. The line
  // guards need it: whether a number may be used is a question about the org,
  // not the agent.
  orgId: Id<"orgs">;
  orgName: string;
  demoMode: boolean;
  apiKey: string | null;
  variables: Array<VoiceVariableInput & { order: number }>;
  variablesSyncedAt: number | null;
  variablesRetellVersion: number | null;
  templateVersion: number | null;
  personaName: string | null;
  canEndCall: boolean;
  llmModel: string | null;
  llmHighPriority: boolean | null;
  // The fleet defaults, already validated by agentEditorContext. Each sits
  // between the per-agent override and the template constant in every
  // resolution: agent ?? fleet ?? template, three steps, same order for the
  // model and for the tier.
  platformVoiceModel: string | null;
  platformHighPriority: boolean | null;
  runtimeConnectedAt: number | null;
  inboundNumber: string | null;
  signatureRejectedAt: number | null;
  voiceLockedIdentity: Array<"firstname" | "lastname" | "email">;
  voiceIdentityDescriptions: Partial<Record<"firstname" | "lastname" | "email", string>>;
  // This org's recogniser words now, and the ones Resepta published last
  // time (agentEditorContext, lib/boostedKeywords).
  keywords: KeywordPlan;
  fields: Array<{
    _id: string;
    key: string;
    label: string;
    type: "text" | "select" | "number" | "date";
    options?: string[];
    voiceDescription?: string;
    voiceConfirm?: boolean;
    voiceVisible?: boolean;
    source?: "manual" | "voice";
  }>;
};

type KeywordPlan = { ours: string[]; previous: string[] | null };

// The boosted_keywords a publish sends: this org's words merged over the ones
// somebody else placed on the agent (lib/boostedKeywords). Every publish that
// already writes the agent doc carries it, the way withRuntimeSaveTool rides
// every engine write, so a renamed service reaches the recogniser the next
// time anything about the agent is published. Empty patch when the merged
// list would be empty: a publish never strips an agent's words.
function keywordPatch(
  live: AgentDoc,
  plan: KeywordPlan,
): { patch: { boosted_keywords?: string[] }; ours: string[] | null } {
  const next = mergeBoostedKeywords({
    live: live.boosted_keywords,
    ours: plan.ours,
    previous: plan.previous,
  });
  return next
    ? { patch: { boosted_keywords: next }, ours: plan.ours }
    : { patch: {}, ours: null };
}

// Records which words were ours, after the publish that sent them succeeded.
async function stampKeywords(
  ctx: Pick<ActionCtx, "runMutation">,
  agentId: string,
  ours: string[] | null,
): Promise<void> {
  if (!ours) return;
  await ctx.runMutation(internal.retell.markBoostedKeywords, {
    retellAgentId: agentId,
    keywords: ours,
  });
}

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

  // The clear credential lives only in the provider configuration. Resepta
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

// NO MCP TOOLS RIDE ON A LIVE CALL ANY MORE. Both that ever did are gone,
// for the same reason, measured twice:
//
// get_call_context cost a caller twenty seconds of silence on a recorded
// call — he gave his name at 13.1s and the agent said nothing until he asked
// what had happened at 33.2s — and it was fetching nothing: every field it
// returned is injected by beforeCallContext while the phone still rings. A
// tool that exists WILL be called; the only reliable way to stop an agent
// using a tool is to take it away (template v7).
//
// save_customer_details survived it because the write is real work — and
// then showed the same signature: a flat ~12 seconds of dead air per save,
// four saves on an 18 Aug call burning 50 of its 180 seconds, while the
// custom-function tools on /retell/functions answered in about a second.
// The transport was the whole cost. So the same write now rides the function
// endpoint (template v10); this helper swaps the tool on every publish path,
// which is how pre-v10 agents get the fast one without waiting for their
// owner to click the template banner. /retell/mcp stays up for agents that
// have published nothing since.
function withRuntimeSaveTool(tools: Record<string, unknown>[] | undefined) {
  const site = siteUrl();
  if (!site) return tools ?? [];
  return [
    ...(tools ?? []).filter(
      (tool) =>
        // Every randevu MCP tool goes, whatever its name — this is also what
        // finally sweeps a stray get_call_context off a pre-v7 engine.
        !(tool.type === "mcp" && tool.mcp_id === "randevu") &&
        // And the custom namesake, so a re-publish refreshes its URL and
        // flags instead of stacking a second copy beside it.
        String(tool.name ?? "") !== "save_customer_details",
    ),
    saveCustomerDetailsTool(site),
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
    // Ours, not the salon's. It shares the analysis list with the contact
    // fields because that is the only list Retell gives us, but it is the call
    // summary — surfacing it here would offer the owner a "field" to rename
    // and retype, and publishing that back would rewrite the instruction that
    // keeps summaries in their language.
    if (String(item.name ?? "") === VOICE_SUMMARY_FIELD) continue;
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
    // Annotated, not inferred: the policy runQuery below references this
    // module's own api types, and letting the handler's type flow through
    // that reference is circular (same fix as voiceBackfill.repairIdentities).
    const lines: { number: string; nickname: string; agentId: string | null }[] =
      await (async () => {
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
        const mapped = items
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
        // Same read-side gate as the roster (retell.listAgents): a shared-
        // account org offers only what the operator provisioned to it, plus
        // whatever it already holds.
        const policy = (await ctx.runQuery(internal.retell.orgNumberPolicy, {
          orgId: context.orgId,
        })) as { restricted: boolean; visible: string[] };
        if (!policy.restricted) return mapped;
        const visible = new Set(policy.visible);
        return mapped.filter((n) => visible.has(n.number));
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
      // A wired webhook that Retell signs with a key this org does not hold
      // looks identical to a healthy one from up here, so it gets its own line
      // rather than folding into webhook.wired: the URL is right, the
      // credential is not, and the fix is a different one.
      signatureRejectedAt: context.signatureRejectedAt,
      // null synced reads as behind, on purpose: an agent from before
      // stamping existed and a hand-built one the org connected both lack the
      // current template's tuning, and the card this drives is an offer the
      // owner clicks, not an automatic rewrite.
      personaName: context.personaName,
      canEndCall: context.canEndCall,
      template: {
        synced: context.templateVersion,
        current: VOICE_AGENT_TEMPLATE_VERSION,
        behind: context.templateVersion !== VOICE_AGENT_TEMPLATE_VERSION,
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
        voiceDescription: field.voiceDescription ?? "",
        voiceConfirm: field.voiceConfirm === true,
        voiceVisible: field.voiceVisible === true,
      })),
      // The editor renders identity capture rows from this rather than a
      // second query: derive and display must read the same lock list.
      voiceLockedIdentity: context.voiceLockedIdentity,
      voiceIdentityDescriptions: context.voiceIdentityDescriptions,
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
  // The recogniser's words (keywordPatch), merged against this same live
  // read so they land in the same version as the prompt.
  keywords?: KeywordPlan,
): Promise<{ version: number | null; keywords: string[] | null }> {
  const id = encodeURIComponent(agentId);
  const live = (await (await call(key, "GET", `get-agent/${id}`)).json()) as AgentDoc;
  if (live.version === undefined) throw new Error("Agent has no version to clone.");
  const boosted = keywords ? keywordPatch(live, keywords) : { patch: {}, ours: null };

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
  const agentFields = { ...(agentPatch ?? {}), ...boosted.patch };
  if (Object.keys(agentFields).length > 0) {
    await call(key, "PATCH", `update-agent/${id}`, {
      version: draft.version,
      ...agentFields,
    });
  }
  await call(key, "POST", `publish-agent-version/${id}`, { version: draft.version });
  return { version: draft.version, keywords: boosted.ours };
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

    const published = await publishViaDraft(key, agentId, llmId, {
      general_prompt: generalPrompt,
      ...(beginMessage !== undefined ? { begin_message: beginMessage } : {}),
      mcps: await runtimeMcpConfig(ctx, agentId, context, before),
      general_tools: withRuntimeSaveTool(before.general_tools),
    },
    voiceId?.trim() ? { voice_id: voiceId.trim() } : undefined,
    context.keywords);
    const version = published.version;
    if (siteUrl()) {
      await ctx.runMutation(internal.retell.markRuntimeConnected, {
        retellAgentId: agentId,
      });
    }
    // The chat lane reads its copy of this text on every turn — see the
    // mirror's schema note on retellAgents.generalPrompt.
    await ctx.runMutation(internal.retell.stampPromptMirror, {
      retellAgentId: agentId,
      generalPrompt,
      promptVersion: version,
    });
    await stampKeywords(ctx, agentId, published.keywords);
    // Returned so the caller can offer "undo" without a second round trip. The
    // LLM is patched in place, so there is no earlier version to point at.
    return { ok: true, version, previousPrompt: before.general_prompt ?? "" };
  },
});

// The sessionless doors for the prompt, same shape and same warning as
// publishVariablesForOrg: editorContext TRUSTS the org it is handed and only
// checks the agent belongs to it, so these are internal and the org comes off
// the MCP key. A public action taking an orgId would let a client edit any
// agent whose id it could name.
export const readPromptForOrg = internalAction({
  args: { orgId: v.id("orgs"), agentId: v.string() },
  returns: v.any(),
  handler: async (ctx, { orgId, agentId }) => {
    const context = await editorContext(ctx, agentId, orgId);
    const key = context.apiKey!;
    const agent = (await (
      await call(key, "GET", `get-agent/${encodeURIComponent(agentId)}`)
    ).json()) as AgentDoc;
    const llmId = agent.response_engine?.llm_id;
    // A null prompt is not "it has none" — a conversation-flow or custom-llm
    // agent keeps its behaviour somewhere this editor cannot reach, and saying
    // so is more use than an empty string the model would try to edit.
    if (!llmId) {
      return {
        name: agent.agent_name ?? agentId,
        prompt: null,
        note: "This agent runs on a conversation flow or a custom LLM, so it has no single prompt to read or change here.",
      };
    }
    const llm = (await (
      await call(key, "GET", `get-retell-llm/${encodeURIComponent(llmId)}`)
    ).json()) as LlmDoc;
    return {
      name: agent.agent_name ?? agentId,
      voiceId: agent.voice_id ?? null,
      prompt: {
        general: llm.general_prompt ?? "",
        beginMessage: llm.begin_message ?? "",
      },
      collects: (agent.post_call_analysis_data ?? []).map((field) => ({
        name: String(field.name ?? ""),
        type: String(field.type ?? ""),
        description: String(field.description ?? ""),
      })),
    };
  },
});

export const publishPromptForOrg = internalAction({
  args: {
    orgId: v.id("orgs"),
    agentId: v.string(),
    generalPrompt: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    version: v.union(v.number(), v.null()),
    previousPrompt: v.string(),
  }),
  handler: async (
    ctx,
    { orgId, agentId, generalPrompt },
  ): Promise<{ ok: boolean; version: number | null; previousPrompt: string }> => {
    const context = await editorContext(ctx, agentId, orgId);
    const key = context.apiKey!;
    const agent = (await (
      await call(key, "GET", `get-agent/${encodeURIComponent(agentId)}`)
    ).json()) as AgentDoc;
    const llmId = agent.response_engine?.llm_id;
    if (!llmId) throw new Error("This agent has no editable prompt.");
    const before = (await (
      await call(key, "GET", `get-retell-llm/${encodeURIComponent(llmId)}`)
    ).json()) as LlmDoc;
    // Same draft-then-publish every other agent edit rides, and the same
    // deliberate omissions: no beginMessage and no voiceId, so publishing a
    // prompt from a chat client cannot quietly drag the opening line or the
    // voice along with it.
    const published = await publishViaDraft(
      key,
      agentId,
      llmId,
      {
        general_prompt: generalPrompt,
        mcps: await runtimeMcpConfig(ctx, agentId, context, before),
        general_tools: withRuntimeSaveTool(before.general_tools),
      },
      undefined,
      context.keywords,
    );
    const version = published.version;
    if (siteUrl()) {
      await ctx.runMutation(internal.retell.markRuntimeConnected, {
        retellAgentId: agentId,
      });
    }
    await ctx.runMutation(internal.retell.stampPromptMirror, {
      retellAgentId: agentId,
      generalPrompt,
      promptVersion: version,
    });
    await stampKeywords(ctx, agentId, published.keywords);
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
      if (
        customerField !== "firstName" &&
        customerField !== "lastName" &&
        customerField !== "email"
      ) {
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
    // Anything the agent captures must say where it lands. A call-only answer
    // is invisible from every screen the business actually reads — the exact
    // "declared in the agent, updates nobody knows what" drift this registry
    // exists to prevent. Context rows (before-only) stay call-scoped; they
    // capture nothing.
    if (
      raw.destination === "call" &&
      (raw.duringMode !== "none" || raw.afterCall)
    ) {
      throw new Error(
        `${label} is asked on the call but saved nowhere. Link it to a customer field.`,
      );
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
// ── Capture rows are DERIVED, not authored (2026-08-25) ─────────────────────
//
// The full merge with the Contact fields Voice column. What the agent collects
// used to be a per-agent registry (voiceAgentVariables capture rows) that the
// variables editor maintained beside the org's contact fields — the same fact
// in two systems, and the systems could disagree: a field flipped to voice in
// Business collected nothing until somebody re-published rows, and a field
// flipped back kept being asked about. Now the field list IS the capture
// config. One switch (the Voice column), one description, one confirm flag,
// all on the field; every agent of the org derives the same capture set from
// it at publish time.
//
// Identity columns ride along automatically: an unlocked first name, last
// name or email is derived as a question landing on the customer's own
// column, under the same key the ring-time injection already uses, so a
// repeat caller is greeted rather than re-interrogated and a first-time
// caller stops becoming a phone number with no name on it. voiceLockedIdentity
// is the opt-out, same as everywhere else. Phone is never derived: the caller
// is MATCHED by it.
//
// What the caller may still author per agent is CONTEXT rows only — static
// values injected into every call. publishVariableSet filters its input down
// to those, so an MCP client or a stale editor sending capture rows cannot
// reintroduce the second registry: they are dropped in favour of what the
// fields say.
function deriveCaptureRows(context: EditorContext): VariableRow[] {
  const locks = new Set(context.voiceLockedIdentity ?? []);
  const rows: VariableRow[] = [];
  const identity = [
    {
      lock: "firstname",
      key: "customer_first_name",
      label: "First name",
      customerField: "firstName",
      beforeSource: "customer_first_name",
      description: "The caller's first name, exactly as they give it.",
    },
    {
      lock: "lastname",
      key: "customer_last_name",
      label: "Last name",
      customerField: "lastName",
      beforeSource: "customer_last_name",
      description: "The caller's last name, exactly as they give it.",
    },
    {
      lock: "email",
      key: "customer_email",
      label: "Email",
      customerField: "email",
      beforeSource: "customer_email",
      description: "The caller's email address, spelled out.",
    },
  ] as const;
  for (const column of identity) {
    if (locks.has(column.lock)) continue;
    rows.push({
      key: column.key,
      label: column.label,
      // The owner's wording when they gave one (the matrix edits it, stored
      // on the org), the stock line otherwise.
      description:
        context.voiceIdentityDescriptions?.[column.lock]?.trim() || column.description,
      type: "string",
      required: false,
      beforeSource: column.beforeSource,
      duringMode: "if_missing",
      afterCall: true,
      destination: "customer",
      customerField: column.customerField,
    });
  }
  for (const field of context.fields) {
    if ((field.source ?? "manual") !== "voice") continue;
    rows.push({
      key: field.key,
      label: field.label,
      // The generic fallback names the thing and nothing else — the
      // abstention suffix publish appends is what stops the analysis pass
      // rationalising an answer for it.
      description: field.voiceDescription?.trim() || `The caller's ${field.label}.`,
      type: field.type === "select" ? "enum" : field.type === "number" ? "number" : "string",
      choices: field.type === "select" ? field.options ?? [] : undefined,
      required: false,
      beforeSource: "contact_field",
      beforeFieldId: field._id as VariableRow["beforeFieldId"],
      // Always ask-when-missing. Confirm-first survived two rounds of matrix
      // simplification and fell in the third (Serdar: "absolutely stupid...
      // confusing"): it was extraction policy leaking into an owner surface.
      // The stored voiceConfirm flags are ignored, not migrated — the column
      // is dead config until someone argues it back.
      duringMode: "if_missing",
      afterCall: true,
      destination: "contact",
      contactFieldId: field._id as VariableRow["contactFieldId"],
    });
  }
  return rows;
}

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
  // Input keeps only its CONTEXT rows (inject, capture nothing); the capture
  // set is derived from the org's fields, and a derived key beats an authored
  // one so the two can never disagree about one variable.
  const derived = deriveCaptureRows(context);
  const derivedKeys = new Set(derived.map((row) => row.key));
  const next = validateVariables(context, [
    ...variables.filter(
      (row) =>
        row.duringMode === "none" &&
        !row.afterCall &&
        row.beforeSource !== "none" &&
        !derivedKeys.has(row.key),
    ),
    ...derived,
  ]);
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
  const generalTools = withRuntimeSaveTool([
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
    // Rebuilt from the agent's CURRENT language rather than carried over from
    // the live copy, so switching an agent to German also switches the
    // summaries. Also the line that installs it on agents provisioned before
    // it existed: this list is rewritten in full on every publish, so the
    // field arrives the next time anything here saves.
    summaryAnalysisField(live.language ?? "en-US"),
    // The abstention rule is appended HERE, not written into the owner's
    // description: analysis is an inference pass over the transcript, and
    // left uninstructed it answers every field it can rationalise — the 20
    // Aug Bella call filed the SERVICE ("Erkek saç kesimi") under hair type,
    // and voiceEvents writes these values onto empty contact-card fields.
    // The during-call extraction keeps its own wording above; a live caller
    // stating a value is exactly when the field should be filled.
    ...next
      .filter((variable) => variable.afterCall)
      .map((variable) => {
        const forRetell = variableForRetell(variable);
        return {
          ...forRetell,
          description:
            `${String(forRetell.description)} Fill this only from something` +
            " the caller actually said about it. If the call does not mention" +
            " it, leave it empty rather than inferring a value.",
        };
      }),
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
  const boosted = keywordPatch(live, context.keywords);
  await call(key, "PATCH", `update-agent/${id}`, {
    version: draft.version,
    post_call_analysis_data: postCallAnalysis,
    ...boosted.patch,
  });
  await call(key, "POST", `publish-agent-version/${id}`, { version: draft.version });
  await ctx.runMutation(internal.retell.replaceAgentVariables, {
    retellAgentId: agentId,
    retellVersion: draft.version,
    variables: next,
  });
  await stampKeywords(ctx, agentId, boosted.ours);
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

// Renames the agent's owner-facing label at the provider, through the same
// draft-then-publish every other agent edit rides, then refreshes the cached
// name so every list renders it before the next roster read. The header
// title is the editor (click it) — a name is identity, and identity edits
// belong on the thing itself, not in a settings row three folds down.
export const renameAgent = action({
  args: { agentId: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { agentId, name }): Promise<null> => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name cannot be empty.");
    const context = await editorContext(ctx, agentId);
    const key = context.apiKey!;
    const id = encodeURIComponent(agentId);
    const live = (await (await call(key, "GET", `get-agent/${id}`)).json()) as AgentDoc;
    if (live.version === undefined) throw new Error("Agent has no version to clone.");
    const draft = (await (
      await call(key, "POST", `create-agent-version/${id}`, { base_version: live.version })
    ).json()) as { version?: number };
    if (draft.version === undefined) throw new Error("Retell returned no draft version.");
    const boosted = keywordPatch(live, context.keywords);
    await call(key, "PATCH", `update-agent/${id}`, {
      version: draft.version,
      agent_name: trimmed,
      ...boosted.patch,
    });
    await call(key, "POST", `publish-agent-version/${id}`, { version: draft.version });
    await ctx.runMutation(internal.retell.rememberAgentName, {
      retellAgentId: agentId,
      name: trimmed,
    });
    await stampKeywords(ctx, agentId, boosted.ours);
    return null;
  },
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
      general_tools: withRuntimeSaveTool(liveLlm.general_tools),
    });
  }
  // The recogniser's words ride this publish too, which is also how a newly
  // provisioned agent gets them: provisioning ends here.
  const boosted = keywordPatch(live, context.keywords);
  await call(key, "PATCH", `update-agent/${id}`, {
    version: draft.version,
    webhook_url: url,
    ...boosted.patch,
  });
  await call(key, "POST", `publish-agent-version/${id}`, { version: draft.version });
  await stampKeywords(ctx, agentId, boosted.ours);

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
    platformVoiceModel: string | null;
    platformHighPriority: boolean | null;
    row: {
      _id: string;
      // The job row as stored: begin hands back the whole document.
      orgId: Id<"orgs">;
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
    // The operator's prompt override, if one stands (convex/voicePrompts).
    // Resolved HERE and nowhere else in this file: an agent's birth is the one
    // moment prompt text is allowed to come from anywhere but the module.
    // syncTemplate, setEndCallEnabled and the model path all build a template
    // too, and all three deliberately send no prompt — so an agent that
    // already exists cannot be changed by an edit in /admin, which is the
    // rule at the top of lib/voiceAgentTemplate.
    const prompt = await ctx.runQuery(internal.voicePrompts.forProvisioning, {
      language: started.row.language,
    });
    const template = appointmentReceptionistTemplate({
      language: started.row.language,
      businessName: started.orgName,
      site,
      prompt,
    });

    let llmId = started.row.retellLlmId;
    if (!llmId) {
      await ctx.runMutation(internal.voiceProvisioning.checkpoint, {
        jobId,
        leaseToken,
        status: "creating_engine",
      });
      // A new agent is born on the fleet default when the operator has set
      // one. enginePatchFor decides which engine field the default lives in
      // and drops the text-pipeline knobs when it is realtime — they belong
      // to the pipeline the agent is not running. It spreads AFTER the
      // template so its resolved model wins over the template's constant.
      const birthEngine = enginePatchFor(
        started.platformVoiceModel ?? (template.llm.model as string),
        {
          temperature: template.llm.model_temperature,
          // A new agent has no per-agent override yet, so this is the fleet
          // row or the template constant — two steps of the usual three.
          highPriority: started.platformHighPriority ?? template.llm.model_high_priority,
        },
      );
      const createdLlm = (await (
        await call(key, "POST", "create-retell-llm", {
          ...template.llm,
          ...birthEngine,
        })
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
        version_title: `Resepta template v${VOICE_AGENT_TEMPLATE_VERSION}`,
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
      generalPrompt: String(template.llm.general_prompt ?? ""),
      promptVersion: initialVersion,
    });
    if (started.row.inboundNumber) {
      // Judged HERE, for the number actually being bound, not only when the
      // request arrived: begin resumes the newest unfinished job, keeps that
      // job's number once its agent exists, and a line can be given to
      // another business while a job sits waiting. The provider-side check in
      // bindInboundNumber sees only whether an agent answers it right now.
      const usable = await ctx.runQuery(internal.retell.lineUsable, {
        orgId: started.row.orgId,
        number: started.row.inboundNumber,
      });
      if (!usable.ok) {
        throw new Error(usable.reason ?? "number-not-assigned-to-this-workspace");
      }
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
    // The code, not the frame a nested call's error arrives in.
    const message = cleanError(error) || "phone-agent-setup-failed";
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
// ── Teardown ────────────────────────────────────────────────────────────────
//
// Deleting a business here has to delete its agents THERE. Retell is a paid
// account the operator owns: an agent left behind after the org is gone is a
// row nobody can trace back to a customer, sitting in a list that is supposed
// to be one-agent-per-business, and its number keeps ringing a webhook for a
// workspace that no longer exists.
//
// Order per agent, and none of it is arbitrary:
//   1. Unbind the number FIRST, while the agent still exists. A number whose
//      inbound agent was deleted underneath it is the state that makes Retell
//      refuse a later reassignment, and the number is the expensive half — it
//      took provisioning and paperwork to get, and the operator will want to
//      hand it to the next business.
//   2. Read the agent to find its response engine, because deleting the agent
//      is what makes the engine unreachable — after that the llm_id is only in
//      our own row, and only if provisioning got that far.
//   3. Delete the agent, then the engine.
//
// The number is UNBOUND, never released. Releasing is irreversible in the way
// that matters (you do not get that number back), and an unbound number is
// immediately reusable — which is the outcome the operator actually wants.
//
// Best effort per resource, and the caller decides what a failure means: this
// returns what it did and what it could not do rather than throwing, so one
// dead agent id from a half-finished provisioning run cannot stop the rest of
// the teardown.
export const teardownForOrg = internalAction({
  args: { orgId: v.id("orgs") },
  returns: v.object({
    deleted: v.array(v.string()),
    freedNumbers: v.array(v.string()),
    failures: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const resources = (await ctx.runQuery(internal.retell.orgVoiceResources, {
      orgId: args.orgId,
    })) as {
      apiKey: string | null;
      demoMode: boolean;
      agents: { retellAgentId: string; inboundNumber: string | null }[];
    };
    const deleted: string[] = [];
    const freedNumbers: string[] = [];
    const failures: string[] = [];
    if (resources.agents.length === 0) return { deleted, freedNumbers, failures };
    // No key, no teardown — and that IS a failure to report rather than a
    // quiet skip, because the agents are real and somebody has to go and
    // remove them by hand. The demo org is the one exception: it holds no
    // credentials by design and never provisioned anything.
    if (resources.demoMode) return { deleted, freedNumbers, failures };
    if (!resources.apiKey) {
      failures.push(
        `no Retell key for this workspace, so ${resources.agents.length} agent(s) were left in place`,
      );
      return { deleted, freedNumbers, failures };
    }
    const key = resources.apiKey;

    for (const agent of resources.agents) {
      if (agent.inboundNumber) {
        try {
          await call(
            key,
            "PATCH",
            `update-phone-number/${encodeURIComponent(agent.inboundNumber)}`,
            { inbound_agents: [] },
          );
          freedNumbers.push(agent.inboundNumber);
        } catch (err) {
          failures.push(`number ${agent.inboundNumber}: ${String(err)}`);
        }
      }
      let engineId: string | null = null;
      try {
        const doc = (await (
          await call(key, "GET", `get-agent/${encodeURIComponent(agent.retellAgentId)}`)
        ).json()) as AgentDoc;
        engineId = doc.response_engine?.llm_id ?? null;
      } catch {
        // An agent that cannot be read is usually one that is already gone.
        // Not a failure on its own; the delete below decides.
      }
      try {
        await call(
          key,
          "DELETE",
          `delete-agent/${encodeURIComponent(agent.retellAgentId)}`,
        );
        deleted.push(agent.retellAgentId);
      } catch (err) {
        // 404 means somebody deleted it in the Retell dashboard already, which
        // is the outcome this function wants.
        if (String(err).includes("retell-404")) deleted.push(agent.retellAgentId);
        else failures.push(`agent ${agent.retellAgentId}: ${String(err)}`);
      }
      if (engineId) {
        try {
          await call(key, "DELETE", `delete-retell-llm/${encodeURIComponent(engineId)}`);
        } catch (err) {
          if (!String(err).includes("retell-404")) {
            failures.push(`engine ${engineId}: ${String(err)}`);
          }
        }
      }
    }
    return { deleted, freedNumbers, failures };
  },
});

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

// Onboarding's auto-provision (docs/chat-agent.md §7): every org that
// finishes naming itself wakes up with a working receptionist, built from the
// same checkpointed job the Add-agent sheet uses. The phone LINE stays a
// manual step — the app assigns unclaimed numbers but never buys them —
// "auto-agent, assisted dial tone". Fire-and-forget from orgs.update; a
// failure lands in the provisioning list on /admin like any other job.
export const autoProvision = internalAction({
  args: { orgId: v.id("orgs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const check = (await ctx.runQuery(
      internal.voiceProvisioning.autoProvisionPrecheck,
      { orgId: args.orgId },
    )) as {
      eligible: boolean;
      reason?: string;
      name: string;
      language: string;
      keyToStamp: string | null;
    };
    if (!check.eligible) return null;
    if (check.keyToStamp) {
      await ctx.runMutation(internal.voiceProvisioning.stampDefaultRetellKey, {
        orgId: args.orgId,
        value: check.keyToStamp,
      });
    }
    const language: VoiceAgentLanguage =
      check.language === "tr" ? "tr-TR" : check.language === "de" ? "de-DE" : "en-US";
    // The BUSINESS's name leads (Serdar, 2026-08-21): every auto-provisioned
    // agent used to be called "Randevu asistanı", which filled the shared
    // Retell workspace with identically named agents nobody could tell
    // apart. The owner can rename it any time.
    const agentName =
      language === "tr-TR"
        ? `${check.name} Sesli Asistanı`
        : language === "de-DE"
          ? `${check.name} Sprachassistent`
          : `${check.name} Voice Agent`;
    let voiceId: string;
    try {
      const voices = (await ctx.runAction(internal.retellAgent.voiceOptionsForOrg, {
        orgId: args.orgId,
      })) as { id: string }[];
      if (voices.length === 0) return null;
      // The curated voice for this language when the workspace offers it
      // (DEFAULT_VOICE_IDS — Bella's own voice for Turkish), any catalogue
      // voice otherwise.
      const available = new Set(voices.map((v) => v.id));
      voiceId =
        DEFAULT_VOICE_IDS[language].find((id) => available.has(id)) ??
        voices[0].id;
    } catch (err) {
      // A voice list that will not load is a key problem, and a key problem is
      // platform-wide the day the default was stamped. Nothing to retry here;
      // the operator's own smoke test hits it immediately.
      console.error("autoProvision voice list failed", err);
      return null;
    }
    // Deterministic per org: a second trigger resumes THIS job through the
    // lease instead of deliberately creating a second agent.
    await ctx.runAction(internal.retellAgent.createAgentForOrg, {
      orgId: args.orgId,
      requestId: `auto-${args.orgId}`,
      name: agentName,
      language,
      voiceId,
    });
    return null;
  },
});

// Push the current template's voice engineering onto an agent that already
// exists. Until this, VOICE_AGENT_TEMPLATE_VERSION was read exactly once, at
// creation — every improvement to the template reached new salons only, and
// an existing tenant's agent kept last month's tuning forever unless someone
// walked into the provider dashboard.
//
// ENGINEERING ONLY, deliberately. What syncs: the turn-taking knobs, the
// model pin, the tool plumbing (speak_during_execution and fresh function
// URLs), and the call-summary analysis field. What never syncs: the prompt
// and the begin message. Those are the owner's — the app hands them an
// editor, and a sync that rewrote their wording back to factory copy would
// be the template silently changing under the salon, the exact thing the
// version constant exists to prevent. The one prompt-line difference between
// template versions rides in through the MCP instructions we serve at call
// time instead.
export const syncTemplate = action({
  args: { agentId: v.string() },
  returns: v.object({ ok: v.boolean(), version: v.union(v.number(), v.null()) }),
  handler: async (ctx, { agentId }) => {
    const context = await editorContext(ctx, agentId);
    const key = context.apiKey!;
    const site = siteUrl();
    if (!site) {
      throw new Error("This deployment exposes no site URL, so there is nothing to point at.");
    }
    const id = encodeURIComponent(agentId);
    const live = (await (await call(key, "GET", `get-agent/${id}`)).json()) as AgentDoc;
    if (live.version === undefined) throw new Error("Agent has no version to clone.");

    // The template needs a language for the summary field's instruction; an
    // agent whose language is outside the template's three gets English,
    // which is at least an instruction rather than a crash.
    const language = (
      ["tr-TR", "en-US", "de-DE"].includes(live.language ?? "")
        ? live.language
        : "en-US"
    ) as VoiceAgentLanguage;
    const template = appointmentReceptionistTemplate({
      language,
      businessName: context.orgName,
      site,
      // The salon's choice survives a sync. Without this the template's
      // default would hand the tool back to a shop that deliberately took it
      // away, every time they clicked Update.
      canEndCall: context.canEndCall,
    });

    const draft = (await (
      await call(key, "POST", `create-agent-version/${id}`, { base_version: live.version })
    ).json()) as { version?: number };
    if (draft.version === undefined) throw new Error("Retell returned no draft version.");
    const draftAgent = (await (
      await call(key, "GET", `get-agent/${id}?version=${draft.version}`)
    ).json()) as AgentDoc;

    const llmId = draftAgent.response_engine?.llm_id;
    if (draftAgent.response_engine?.type === "retell-llm" && llmId) {
      const liveLlm = (await (
        await call(key, "GET", `get-retell-llm/${encodeURIComponent(llmId)}`)
      ).json()) as LlmDoc;
      // The template's five function tools replace their live namesakes —
      // that is where speak_during_execution and the function URL live.
      // Everything else on the engine survives: extract_dynamic_variable
      // from the variables registry, end_call, anything the owner added.
      const templateTools = template.llm.general_tools as Record<string, unknown>[];
      const templateNames = new Set(templateTools.map((tool) => String(tool.name)));
      const kept = (liveLlm.general_tools ?? []).filter(
        (tool) =>
          !templateNames.has(String(tool.name ?? "")) &&
          // Dropped rather than merely absent from the template: `kept` exists
          // to preserve tools the owner added, and end_call switched off has
          // to be REMOVED, not left behind as something we no longer mention.
          !(context.canEndCall === false && String(tool.name ?? "") === END_CALL_TOOL_NAME),
      );
      const llmVersion = draftAgent.response_engine?.version;
      // The operator's per-agent override outranks the template: without
      // this, clicking the update banner silently put every agent back on
      // the platform default — which is exactly how "I set it in Retell and
      // it keeps becoming Haiku" happened before the override existed. Both
      // engine fields ride every PATCH (enginePatchFor), so a realtime
      // override survives a sync and a standard agent never keeps a stale
      // s2s_model, and the text-pipeline knobs ride only when the target IS
      // the text pipeline.
      const syncEngine = enginePatchFor(
        context.llmModel ?? context.platformVoiceModel ?? template.llm.model,
        {
          temperature: template.llm.model_temperature,
          highPriority:
            context.llmHighPriority ??
            context.platformHighPriority ??
            template.llm.model_high_priority,
        },
      );
      await call(key, "PATCH", `update-retell-llm/${encodeURIComponent(llmId)}`, {
        ...(llmVersion !== undefined ? { version: llmVersion } : {}),
        ...syncEngine,
        general_tools: withRuntimeSaveTool([...templateTools, ...kept]),
        mcps: await runtimeMcpConfig(ctx, agentId, context, liveLlm),
      });
    }

    // template.agent, minus what must not follow the template: the agent
    // keeps its own language, and the analysis list is a merge — the live
    // fields stay (system presets, the owner's collected fields), only OUR
    // summary field is replaced so its language instruction tracks the agent.
    const {
      language: _templateLanguage,
      post_call_analysis_data: _templateAnalysis,
      voicemail_option: templateVoicemail,
      ...engineering
    } = template.agent;
    const liveAnalysis = (live.post_call_analysis_data ?? []).filter(
      (item) => String(item.name ?? "") !== VOICE_SUMMARY_FIELD,
    );
    // Voicemail is the template's, EXCEPT for detection_prompt. That field
    // says what counts as an answering machine, it can only be written in the
    // provider's dashboard, and a PATCH that leaves the key out deletes it —
    // so a sync that shipped the template's object bare would silently erase
    // a definition somebody wrote by hand, with nothing to report the loss.
    // Same bargain as the analysis merge directly above: ours replaces ours,
    // theirs survives.
    const voicemail = live.voicemail_option?.detection_prompt
      ? {
          ...templateVoicemail,
          detection_prompt: live.voicemail_option.detection_prompt,
        }
      : templateVoicemail;
    // The recogniser's words (template v14): the same merge bargain once
    // more, ours replaced and anybody else's kept, and never an empty list.
    const boosted = keywordPatch(live, context.keywords);
    await call(key, "PATCH", `update-agent/${id}`, {
      version: draft.version,
      ...engineering,
      voicemail_option: voicemail,
      post_call_analysis_data: [...liveAnalysis, summaryAnalysisField(language)],
      ...boosted.patch,
    });
    await call(key, "POST", `publish-agent-version/${id}`, {
      version: draft.version,
      version_title: `Resepta template v${VOICE_AGENT_TEMPLATE_VERSION}`,
    });
    await ctx.runMutation(internal.retell.markTemplateSynced, {
      retellAgentId: agentId,
      templateVersion: VOICE_AGENT_TEMPLATE_VERSION,
    });
    await stampKeywords(ctx, agentId, boosted.ours);
    return { ok: true, version: draft.version };
  },
});

// Hanging up, switched from here instead of the provider's dashboard.
//
// This one cannot take the persona name's shortcut. A name is a value, so it
// rides in as a dynamic variable while the phone rings and needs no publish;
// a tool is part of the response engine, so turning it on means editing the
// engine and publishing a version. Hence an action, and hence the flag being
// written only after the provider says yes.
export const setEndCallEnabled = action({
  args: { agentId: v.string(), enabled: v.boolean() },
  returns: v.object({ ok: v.boolean(), version: v.union(v.number(), v.null()) }),
  handler: async (ctx, { agentId, enabled }) => {
    const context = await editorContext(ctx, agentId);
    const key = context.apiKey!;
    const id = encodeURIComponent(agentId);
    const live = (await (await call(key, "GET", `get-agent/${id}`)).json()) as AgentDoc;
    const llmId = live.response_engine?.llm_id;
    if (live.response_engine?.type !== "retell-llm" || !llmId) {
      throw new Error("Ending a call is only configurable on a Retell LLM agent.");
    }
    if (live.version === undefined) throw new Error("Agent has no version to clone.");

    const draft = (await (
      await call(key, "POST", `create-agent-version/${id}`, { base_version: live.version })
    ).json()) as { version?: number };
    if (draft.version === undefined) throw new Error("Retell returned no draft version.");
    const draftAgent = (await (
      await call(key, "GET", `get-agent/${id}?version=${draft.version}`)
    ).json()) as AgentDoc;
    const liveLlm = (await (
      await call(key, "GET", `get-retell-llm/${encodeURIComponent(llmId)}`)
    ).json()) as LlmDoc;

    // Everything except the end_call tool survives untouched, then it is put
    // back or left out. Matched on TYPE rather than name, so an agent that
    // arrived from the provider with its own differently-named hang-up tool
    // does not end up with two.
    const others = (liveLlm.general_tools ?? []).filter(
      (tool) => tool.type !== "end_call",
    );
    const template = appointmentReceptionistTemplate({
      language: (["tr-TR", "en-US", "de-DE"].includes(live.language ?? "")
        ? live.language
        : "en-US") as VoiceAgentLanguage,
      businessName: context.orgName,
      site: siteUrl() ?? "",
      canEndCall: enabled,
    });
    const endCallTool = (template.llm.general_tools as Record<string, unknown>[]).find(
      (tool) => tool.type === "end_call",
    );
    const llmVersion = draftAgent.response_engine?.version;
    await call(key, "PATCH", `update-retell-llm/${encodeURIComponent(llmId)}`, {
      ...(llmVersion !== undefined ? { version: llmVersion } : {}),
      general_tools: withRuntimeSaveTool(
        enabled && endCallTool ? [...others, endCallTool] : others,
      ),
    });
    await call(key, "POST", `publish-agent-version/${id}`, { version: draft.version });
    await ctx.runMutation(internal.retell.markEndCallEnabled, {
      retellAgentId: agentId,
      enabled,
    });
    return { ok: true, version: draft.version };
  },
});

export const wireWebhook = action({
  args: { agentId: v.string() },
  returns: v.object({ ok: v.boolean(), url: v.string(), version: v.union(v.number(), v.null()) }),
  handler: async (ctx, { agentId }) => {
    const context = await editorContext(ctx, agentId);
    return await wireAgent(ctx, agentId, context);
  },
});

// What the operator changed. One shape per knob, because the two share every
// line of the publish below and differ only in which override they replace,
// what the version is titled, and which row gets stamped — and because the
// engine PATCH must carry BOTH values every time. Sending one alone is what
// let a model change inherit a stale tier for as long as it did.
type EngineChange =
  | { field: "model"; model: string | null }
  | { field: "highPriority"; highPriority: boolean | null }
  // Both at once, which is what the console sends now that the picker offers
  // an ENGINE rather than a model and a tier to cross-reference. One variant
  // rather than two calls, because two would mean two provider round trips
  // and two published versions for what the operator did once.
  | { field: "engine"; model: string | null; highPriority: boolean | null };

// The provider half of the operator's engine overrides; the gates live in
// platform.setAgentModel / setAgentHighPriority, the only callers. Same
// publish shape as setEndCallEnabled — clone a draft, patch the engine,
// publish — because the model and its tier, like a tool, live in the response
// engine and cannot be injected at ring time. A null override puts the agent
// back on the fleet default. The row is stamped only after the publish
// succeeds, so it can never claim a setting the agent is not running.
async function applyEngineChange(
  ctx: ActionCtx,
  { agentId, orgId, change }: { agentId: string; orgId: Id<"orgs">; change: EngineChange },
): Promise<{ ok: boolean; version: number | null }> {
  const context = await editorContext(ctx, agentId, orgId);
  const key = context.apiKey!;
  const id = encodeURIComponent(agentId);
  const live = (await (await call(key, "GET", `get-agent/${id}`)).json()) as AgentDoc;
  const llmId = live.response_engine?.llm_id;
  if (live.response_engine?.type !== "retell-llm" || !llmId) {
    throw new Error("Engine settings are only configurable on a Retell LLM agent.");
  }
  if (live.version === undefined) throw new Error("Agent has no version to clone.");

  const template = appointmentReceptionistTemplate({
    language: (["tr-TR", "en-US", "de-DE"].includes(live.language ?? "")
      ? live.language
      : "en-US") as VoiceAgentLanguage,
    businessName: context.orgName,
    site: siteUrl() ?? "",
    canEndCall: context.canEndCall,
  });
  const draft = (await (
    await call(key, "POST", `create-agent-version/${id}`, { base_version: live.version })
  ).json()) as { version?: number };
  if (draft.version === undefined) throw new Error("Retell returned no draft version.");
  const draftAgent = (await (
    await call(key, "GET", `get-agent/${id}?version=${draft.version}`)
  ).json()) as AgentDoc;
  const llmVersion = draftAgent.response_engine?.version;
  // The knob being changed takes the new value; the other keeps whatever the
  // operator already chose. Both then fall through fleet default to template
  // constant, the same three steps syncTemplate uses — so a publish here and
  // a publish from the owner's update banner resolve to the same engine.
  const modelOverride =
    change.field === "highPriority" ? context.llmModel : change.model;
  const priorityOverride =
    change.field === "model" ? context.llmHighPriority : change.highPriority;
  // Both fields, always — enginePatchFor nulls whichever side the target
  // does not use, because an omitted field survives the PATCH and would
  // leave both engines configured after a standard↔realtime switch.
  // Clearing an override lands on the FLEET default, not the constant:
  // "platform default" in the picker means whatever /admin currently says.
  //
  // The knobs ride too, which they did not before. This path used to send
  // the engine fields alone, and because an omitted field survives the
  // PATCH, a model change inherited whatever temperature and priority tier
  // the engine happened to be carrying — so switching model was a silent way
  // to keep a setting the operator thought they had left behind.
  await call(key, "PATCH", `update-retell-llm/${encodeURIComponent(llmId)}`, {
    ...(llmVersion !== undefined ? { version: llmVersion } : {}),
    ...enginePatchFor(modelOverride ?? context.platformVoiceModel ?? template.llm.model, {
      temperature: template.llm.model_temperature,
      highPriority:
        priorityOverride ?? context.platformHighPriority ?? template.llm.model_high_priority,
    }),
  });
  await call(key, "POST", `publish-agent-version/${id}`, {
    version: draft.version,
    version_title: versionTitleFor(change),
  });
  // Both stamps for an engine change, each landing only after the publish it
  // describes succeeded — the row must never claim a setting the agent is not
  // running, which is the same contract the single-knob paths keep.
  if (change.field !== "highPriority") {
    await ctx.runMutation(internal.retell.markLlmModel, {
      retellAgentId: agentId,
      model: change.model,
    });
  }
  if (change.field !== "model") {
    await ctx.runMutation(internal.retell.markLlmHighPriority, {
      retellAgentId: agentId,
      highPriority: change.highPriority,
    });
  }
  return { ok: true, version: draft.version };
}

// What the operator will see in Retell's version list. Named after the thing
// they changed, so a version history reads as a log of decisions rather than
// of PATCHes.
function versionTitleFor(change: EngineChange): string {
  if (change.field === "model") {
    return change.model ? `Model → ${change.model}` : "Model → platform default";
  }
  if (change.field === "highPriority") {
    return change.highPriority === null
      ? "Fast tier → platform default"
      : `Fast tier → ${change.highPriority ? "on" : "off"}`;
  }
  if (!change.model) return "Engine → platform default";
  return `Engine → ${change.model}${change.highPriority ? " (fast)" : ""}`;
}

export async function applyAgentModel(
  ctx: ActionCtx,
  { agentId, orgId, model }: { agentId: string; orgId: Id<"orgs">; model: string | null },
): Promise<{ ok: boolean; version: number | null }> {
  return await applyEngineChange(ctx, { agentId, orgId, change: { field: "model", model } });
}

export async function applyAgentEngine(
  ctx: ActionCtx,
  {
    agentId,
    orgId,
    model,
    highPriority,
  }: {
    agentId: string;
    orgId: Id<"orgs">;
    model: string | null;
    highPriority: boolean | null;
  },
): Promise<{ ok: boolean; version: number | null }> {
  return await applyEngineChange(ctx, {
    agentId,
    orgId,
    change: { field: "engine", model, highPriority },
  });
}

export async function applyAgentHighPriority(
  ctx: ActionCtx,
  {
    agentId,
    orgId,
    highPriority,
  }: { agentId: string; orgId: Id<"orgs">; highPriority: boolean | null },
): Promise<{ ok: boolean; version: number | null }> {
  return await applyEngineChange(ctx, {
    agentId,
    orgId,
    change: { field: "highPriority", highPriority },
  });
}

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
    // Before the provider is touched, because a rebind is instant and there is
    // no undo: whichever agent held this line stops answering the moment the
    // PATCH lands.
    const usable = await ctx.runQuery(internal.retell.lineUsable, {
      orgId: context.orgId,
      number: target,
    });
    if (!usable.ok) throw new Error(usable.reason);
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
    await ctx.runMutation(internal.retell.applyLineBinding, {
      orgId: context.orgId,
      number: previous,
      inboundAgentId: null,
      outboundAgentId: null,
    });
  }
  await ctx.runMutation(internal.retell.applyLineAssignment, {
    retellAgentId: agentId,
    number: target,
  });
  if (target) {
    await ctx.runMutation(internal.retell.applyLineBinding, {
      orgId: context.orgId,
      number: target,
      inboundAgentId: agentId,
      outboundAgentId: agentId,
    });
  }
  return null;
}

// The multi-number door: bind ONE MORE line to an agent in ONE direction,
// leaving its other lines and the line's other direction alone — assignLine
// above is the single-line move the provisioning and MCP paths still speak.
// The two directions are separate controls because they are separate facts: a
// line can ring one agent and be another agent's caller ID. Whichever agent
// held this direction stops the moment the PATCH lands, same no-undo as every
// rebind.
const lineDirection = v.union(v.literal("inbound"), v.literal("outbound"));

export const attachLine = action({
  args: { agentId: v.string(), number: v.string(), direction: lineDirection },
  returns: v.null(),
  handler: async (ctx, { agentId, number, direction }): Promise<null> => {
    const context = await editorContext(ctx, agentId);
    const key = context.apiKey!;
    const site = siteUrl();
    const target = number.trim();
    if (!target) throw new Error("number is required");
    const usable = await ctx.runQuery(internal.retell.lineUsable, {
      orgId: context.orgId,
      number: target,
    });
    if (!usable.ok) throw new Error(usable.reason);
    const binding = [
      { agent_id: agentId, agent_version: "latest_published", weight: 1 },
    ];
    await call(key, "PATCH", `update-phone-number/${encodeURIComponent(target)}`, {
      ...(direction === "inbound"
        ? {
            inbound_agents: binding,
            ...(site ? { inbound_webhook_url: `${site}/retell/inbound` } : {}),
          }
        : { outbound_agents: binding }),
    });
    await ctx.runMutation(internal.retell.applyLineBinding, {
      orgId: context.orgId,
      number: target,
      ...(direction === "inbound"
        ? { inboundAgentId: agentId }
        : { outboundAgentId: agentId }),
    });
    return null;
  },
});

export const detachLine = action({
  args: { agentId: v.string(), number: v.string(), direction: lineDirection },
  returns: v.null(),
  handler: async (ctx, { agentId, number, direction }): Promise<null> => {
    const context = await editorContext(ctx, agentId);
    const key = context.apiKey!;
    const target = number.trim();
    await releaseLineIfHeld(key, target, agentId, direction);
    await ctx.runMutation(internal.retell.applyLineBinding, {
      orgId: context.orgId,
      number: target,
      ...(direction === "inbound"
        ? { inboundAgentId: null }
        : { outboundAgentId: null }),
    });
    return null;
  },
});

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
async function releaseLineIfHeld(
  key: string,
  number: string,
  agentId: string,
  // Scope the release to one direction (detachLine); absent releases both —
  // the full-move and disconnect paths.
  direction?: "inbound" | "outbound",
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
    outbound_agent_id?: string;
    inbound_agents?: Array<{ agent_id?: string }>;
    outbound_agents?: Array<{ agent_id?: string }>;
  }>;
  const entry = numbers.find((candidate) => candidate.phone_number === number);
  if (!entry) return;
  // Each direction released only where this agent actually holds it — the
  // other direction may belong to another agent by now.
  const holdsInbound =
    (entry.inbound_agent_id === agentId ||
      entry.inbound_agents?.some((candidate) => candidate.agent_id === agentId)) &&
    direction !== "outbound";
  const holdsOutbound =
    (entry.outbound_agent_id === agentId ||
      entry.outbound_agents?.some((candidate) => candidate.agent_id === agentId)) &&
    direction !== "inbound";
  if (!holdsInbound && !holdsOutbound) return;
  await call(key, "PATCH", `update-phone-number/${encodeURIComponent(number)}`, {
    ...(holdsInbound ? { inbound_agents: [] } : {}),
    ...(holdsOutbound ? { outbound_agents: [] } : {}),
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
    const context = await editorContext(ctx, agentId);
    const key = context.apiKey!;
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
      // The agent's own bound line is the fallback, NOT rows[0]. Every tenant
      // shares one Retell account, so "the first number on the account" is
      // whichever salon happens to be first — this used to place a test call
      // from another business's line, with their number in the callee's phone.
      from =
        rows.find((n) => n.outbound_agent_id === agentId)?.phone_number ??
        context.inboundNumber ??
        "";
    }
    if (!from) {
      throw new Error("This Retell account has no phone number to call from.");
    }
    // Outbound is checked too, not just inbound routing: the caller id a salon
    // shows is as much theirs-or-not-theirs as the line that rings them.
    const usable = await ctx.runQuery(internal.retell.lineUsable, {
      orgId: context.orgId,
      number: from,
    });
    if (!usable.ok) throw new Error(usable.reason);

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

// Sessionless twin of testCall, for the bulk call queue (convex/bulkRuns.ts).
// Same rule as assignLineForOrg: internal only, and the public action above
// must never grow an orgId argument.
//
// Deliberately thinner than testCall, because its caller has already done the
// work testCall does for a human at a keyboard. bulkRuns resolves the
// from-number ONCE per run and freezes it (a shared Retell account makes
// re-resolving per call a way to change which salon's line the second half of
// a run dials from), it checks lineUsable at launch, and it reads
// beforeCallContext itself so it can treat a null as "stop the run" rather
// than dialling anyway. So this function does one thing: place the call and
// hand back the id.
//
// Everything downstream is unchanged: Retell's webhook writes the calls row
// through retell.recordCall, which meters the minutes, freezes the rate and
// draws down a prepaid wallet exactly as it does for a call somebody dialled
// by hand. A bulk call is billed like any other call, and it must be.
export const placeCall = internalAction({
  args: {
    orgId: v.id("orgs"),
    retellAgentId: v.string(),
    fromNumber: v.string(),
    toNumber: v.string(),
    dynamicVariables: v.record(v.string(), v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const context = (await ctx.runQuery(internal.agentTools.phoneAgentContext, {
      orgId: args.orgId,
    })) as { demoMode: boolean; apiKey: string | null };
    // The showroom never rings a real phone, and a keyless org has nothing to
    // ring one with. Both are thrown rather than returned quietly: the queue
    // records the message on the item, and a run that silently placed nothing
    // would look identical to one that worked.
    if (context.demoMode) throw new Error("demo-org");
    if (!context.apiKey) throw new Error("retell-not-configured");

    const res = (await (
      await call(context.apiKey, "POST", "v2/create-phone-call", {
        from_number: args.fromNumber,
        to_number: args.toNumber,
        override_agent_id: args.retellAgentId,
        ...(Object.keys(args.dynamicVariables).length > 0
          ? { retell_llm_dynamic_variables: args.dynamicVariables }
          : {}),
      })
    ).json()) as { call_id?: string };

    // No call id means no way for the webhook to find its way back to the
    // item, which would strand the queue on this row until the reaper. Better
    // to fail it now, while the reason is still in hand.
    if (!res.call_id) throw new Error("retell-no-call-id");
    return res.call_id;
  },
});

// ── Revoking a line from a tenant ────────────────────────────────────────────

// An operator taking a phone line away from a business in /admin used to be an
// APP-SIDE ALLOWLIST EDIT AND NOTHING ELSE (Serdar, 2026-08-21, after removing
// an Austrian number from Bella and finding it still attached): the number went
// out of orgs.allowedPhoneNumbers while Retell happily kept routing it to that
// tenant's agent. Every inbound call still reached a business the operator
// believed had been cut off — and the line could not be handed to anyone else,
// because binding refuses a number another agent still holds.
//
// So the allowlist edit now carries the revocation with it: for each number
// actually dropped, release it at the provider from EVERY agent this org has,
// in BOTH directions, and clear the app's own record of the binding.
//
// Deliberately best-effort per (number, agent): one agent whose release throws
// must not strand the rest, and the operator's intent — this tenant no longer
// has this line — is better served partially than not at all. What is left
// behind shows up on the admin Phone lines card, which reads the provider.
export const releaseOrgLines = internalAction({
  args: { orgId: v.id("orgs"), numbers: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { orgId, numbers }): Promise<null> => {
    if (numbers.length === 0) return null;
    const context = (await ctx.runQuery(internal.agentTools.phoneAgentContext, {
      orgId,
    })) as { demoMode: boolean; apiKey: string | null };
    // A demo org holds no credentials and a keyless org can bind nothing, so
    // there is nothing at the provider to release either way.
    if (context.demoMode || !context.apiKey) return null;
    const agents = (await ctx.runQuery(internal.retell.agentsForOrg, {
      orgId,
    })) as { retellAgentId: string }[];
    for (const number of numbers) {
      for (const agent of agents) {
        try {
          await releaseLineIfHeld(context.apiKey, number, agent.retellAgentId);
        } catch (err) {
          console.error("releaseOrgLines failed", number, agent.retellAgentId, err);
        }
      }
      await ctx.runMutation(internal.retell.applyLineBinding, {
        orgId,
        number,
        inboundAgentId: null,
        outboundAgentId: null,
      });
      await ctx.runMutation(internal.retell.clearAgentInboundNumber, {
        orgId,
        number,
      });
    }
    return null;
  },
});
