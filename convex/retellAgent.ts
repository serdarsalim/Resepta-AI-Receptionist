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
import { action, type ActionCtx } from "./_generated/server";

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
  webhook_url?: string;
  voice_id?: string;
  language?: string;
  response_engine?: {
    type?: string;
    llm_id?: string;
    conversation_flow_id?: string;
    version?: number;
  };
  post_call_analysis_data?: { name?: string; description?: string; type?: string }[];
};

type LlmDoc = {
  llm_id?: string;
  general_prompt?: string;
  begin_message?: string;
  general_tools?: { name?: string; type?: string; description?: string }[];
  default_dynamic_variables?: Record<string, string>;
  states?: { name?: string }[];
};

// This deployment's own HTTP origin. Read from the environment rather than
// passed in, so an agent can never be wired to some other deployment's URL.
function siteUrl(): string | null {
  return process.env.CONVEX_SITE_URL ?? null;
}

async function orgKey(ctx: Pick<ActionCtx, "runQuery">): Promise<string> {
  const context = await ctx.runQuery(internal.retell.agentListContext, {});
  if (!context) throw new Error("No workspace.");
  if (context.demoMode) {
    throw new Error("This is the demo workspace — it holds no Retell credentials.");
  }
  if (!context.apiKey) {
    throw new Error("No Retell API key for this workspace yet.");
  }
  return context.apiKey;
}

// ── Read ─────────────────────────────────────────────────────────────────────

export const read = action({
  args: { agentId: v.string() },
  returns: v.any(),
  handler: async (ctx, { agentId }) => {
    const key = await orgKey(ctx);
    const id = encodeURIComponent(agentId);
    const agent = (await (await call(key, "GET", `get-agent/${id}`)).json()) as AgentDoc;
    const engine = agent.response_engine ?? {};

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
      language: agent.language ?? null,
      engineType: engine.type ?? null,
      llmId: engine.llm_id ?? null,
      prompt: llm
        ? { general: llm.general_prompt ?? "", beginMessage: llm.begin_message ?? "" }
        : null,
      // A conversation-flow agent is drawn in Retell's visual editor. Saying so
      // beats returning an empty prompt, which reads as "it has none".
      unsupportedReason:
        engine.type === "conversation-flow"
          ? "This agent runs a conversation flow, so its script lives in Retell's flow editor and cannot be edited here."
          : engine.type === "custom-llm"
            ? "This agent runs a custom LLM over a websocket, so there is no prompt to edit here."
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
        // Injected at dial time.
        preCall: Object.entries(llm?.default_dynamic_variables ?? {}).map(
          ([name, value]) => ({ name, value }),
        ),
        // Called back mid-conversation — this is how the agent books.
        duringCall: (llm?.general_tools ?? []).map((t) => ({
          name: t.name ?? "",
          type: t.type ?? "",
          description: t.description ?? "",
        })),
        // Extracted after the call ends.
        postCall: (agent.post_call_analysis_data ?? []).map((f) => ({
          name: f.name ?? "",
          type: f.type ?? "",
          description: f.description ?? "",
        })),
      },
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
  await call(key, "POST", `publish-agent-version/${id}`, { version: draft.version });
  return draft.version;
}

export const publishPrompt = action({
  args: {
    agentId: v.string(),
    generalPrompt: v.string(),
    beginMessage: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    version: v.union(v.number(), v.null()),
    previousPrompt: v.string(),
  }),
  handler: async (ctx, { agentId, generalPrompt, beginMessage }) => {
    const key = await orgKey(ctx);
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
    });
    // Returned so the caller can offer "undo" without a second round trip. The
    // LLM is patched in place, so there is no earlier version to point at.
    return { ok: true, version, previousPrompt: before.general_prompt ?? "" };
  },
});

// ── Webhook ──────────────────────────────────────────────────────────────────

export const wireWebhook = action({
  args: { agentId: v.string() },
  returns: v.object({ ok: v.boolean(), url: v.string(), version: v.union(v.number(), v.null()) }),
  handler: async (ctx, { agentId }) => {
    const key = await orgKey(ctx);
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
    await call(key, "PATCH", `update-agent/${id}`, { version: draft.version, webhook_url: url });
    await call(key, "POST", `publish-agent-version/${id}`, { version: draft.version });
    return { ok: true, url, version: draft.version };
  },
});

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
    const key = await orgKey(ctx);
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

    const res = (await (
      await call(key, "POST", "v2/create-phone-call", {
        from_number: from,
        to_number: to,
        override_agent_id: agentId,
      })
    ).json()) as { call_id?: string };

    return { ok: true, callId: res.call_id ?? null, from, to };
  },
});
