// The draft an agent's edits land on, and the provider's rule for finding it.
// Ported from Nudge's lib/retellDraft.ts (2026-09-19), P7 of the Nudge port.
//
// Retell keeps ONE working copy per agent. `GET /get-agent/{id}` with no
// version answers the LATEST version: the unpublished draft when one exists,
// the live version otherwise (`get-retell-llm` behaves the same way). So "the
// draft" needs no table of ours: it IS the latest version when that version is
// unpublished, and it is created from the latest version otherwise.
//
// Why it matters here: every agent edit used to clone a fresh version and
// publish it on the spot, so one Publish on the agent page (variables, then
// the prompt) made TWO live versions, and nothing could hold an edit without
// putting it in front of callers. Writing on the draft first means one Publish
// is one version with one note, and a later browser test can dial an edit
// before anyone publishes it.
//
// One provider account serves every business. Nothing here lists the account:
// every function takes ONE agent id that the caller has already proven belongs
// to its org (retell.agentEditorContext).
//
// A LEAF: imports nothing. The caller's fetch helper is handed in as `call`.
// Every function here throws on a non-2xx like that helper does.

export type RetellCall = (method: string, path: string, body?: unknown) => Promise<Response>;

export type LatestAgent = {
  version: number;
  // The provider's own flag on the version doc. Absent is treated as
  // published, so a missing flag can never make a live version look like a
  // draft (and get it discarded).
  isPublished: boolean;
  // begin_message_delay_ms as the version carries it; null when unset.
  beginDelayMs: number | null;
};

type AgentVersionDoc = {
  version?: number;
  is_published?: boolean;
  begin_message_delay_ms?: number | null;
};

export function latestFromDoc(doc: AgentVersionDoc): LatestAgent {
  if (doc.version === undefined) throw new Error("Agent has no version.");
  return {
    version: doc.version,
    isPublished: doc.is_published !== false,
    beginDelayMs: doc.begin_message_delay_ms ?? null,
  };
}

// A pause before the first sentence on every draft Resepta writes, when the
// agent has none set (Nudge, 2026-09-20). A web call loses its first half
// second to setup and the person hears the greeting cut off; on a phone it is
// a beat after pickup, which is how a person answers too. An EXPLICIT value,
// zero included, is somebody's decision and stays.
export const DEFAULT_BEGIN_DELAY_MS = 1000;

// The draft to write on. Reused when the latest version is already one,
// created from the latest version when it is not.
export async function draftVersionFor(
  call: RetellCall,
  agentId: string,
  latest: LatestAgent,
): Promise<{ version: number; created: boolean }> {
  const id = encodeURIComponent(agentId);
  let version = latest.version;
  let created = false;
  if (latest.isPublished) {
    const draft = (await (
      await call("POST", `create-agent-version/${id}`, { base_version: latest.version })
    ).json()) as { version?: number };
    if (draft.version === undefined) throw new Error("Retell returned no draft version.");
    version = draft.version;
    created = true;
  }
  if (latest.beginDelayMs === null) {
    await call("PATCH", `update-agent/${id}`, {
      version,
      begin_message_delay_ms: DEFAULT_BEGIN_DELAY_MS,
    });
  }
  return { version, created };
}

type VersionRow = {
  version?: number;
  is_published?: boolean;
  version_title?: string;
  version_description?: string;
  last_modification_timestamp?: number;
};

// The newest page of an agent's versions, newest first. One page on purpose:
// an agent at v100 has a hundred rows and nobody scrolls to v3.
export async function listAgentVersions(call: RetellCall, agentId: string): Promise<VersionRow[]> {
  const id = encodeURIComponent(agentId);
  const json = (await (
    await call("GET", `list-agent-versions/${id}?sort_order=descending&limit=50`)
  ).json()) as { items?: VersionRow[] } | VersionRow[];
  const rows = Array.isArray(json) ? json : json.items ?? [];
  return rows.filter((row) => typeof row.version === "number");
}

// The version callers hear: the latest when it is published, else the newest
// published one below the draft. Null when the agent has never been published.
export async function publishedVersionOf(
  call: RetellCall,
  agentId: string,
  latest: LatestAgent,
): Promise<number | null> {
  if (latest.isPublished) return latest.version;
  const rows = await listAgentVersions(call, agentId);
  const live = rows
    .filter((row) => row.is_published === true)
    .map((row) => row.version as number)
    .sort((a, b) => b - a);
  return live[0] ?? null;
}

// Delete a draft version. The version rides as a query parameter AND in the
// body, as in Nudge: the SDK does not say which the endpoint reads, and
// sending both is harmless.
export async function deleteDraftVersion(
  call: RetellCall,
  agentId: string,
  version: number,
): Promise<void> {
  const id = encodeURIComponent(agentId);
  await call("DELETE", `delete-agent-version/${id}?version=${version}`, { version });
}

// The LLM read for an agent doc in hand, at the LLM version THAT doc points
// at (Nudge 6f02acca). Deleting an agent version leaves its LLM version
// behind, and a bare get-retell-llm answers the LATEST LLM version, so after a
// discard a bare read returns the orphan carrying the discarded prompt.
export function llmPath(llmId: string, llmVersion: number | undefined): string {
  return `get-retell-llm/${encodeURIComponent(llmId)}${
    llmVersion !== undefined ? `?version=${llmVersion}` : ""
  }`;
}
