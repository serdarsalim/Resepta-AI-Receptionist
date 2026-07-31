"use client";

import { useAction } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { InfoTip } from "./InfoTip";
import { Sheet } from "./Sheet";

// Everything about one voice agent that couples to this salon's data: the
// prompt it speaks from, the variables it uses before/during/after a call,
// whether its webhook actually reaches us, and a way to hear it.
//
// Voice, latency and interruption stay in Retell — those are audio engineering
// and nobody edits them because a customer said something. The prompt is the
// opposite: it changes weekly, and walking to another product to change one
// sentence is the friction this removes.

type Detail = {
  agentId: string;
  name: string;
  version: number | null;
  voiceId: string | null;
  language: string | null;
  engineType: string | null;
  llmId: string | null;
  prompt: { general: string; beginMessage: string } | null;
  unsupportedReason: string | null;
  webhook: {
    expected: string | null;
    actual: string | null;
    wired: boolean;
    pointsElsewhere: boolean;
  };
  variables: {
    preCall: { name: string; value: string }[];
    duringCall: { name: string; type: string; description: string }[];
    postCall: { name: string; type: string; description: string }[];
  };
};

function VarList({
  title,
  hint,
  rows,
  empty,
}: {
  title: string;
  hint: string;
  rows: { name: string; description?: string; value?: string; type?: string }[];
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5">
        <h4 className="text-xs font-medium">{title}</h4>
        <InfoTip text={hint} />
        <span className="text-xs text-[var(--muted)]">{rows.length || ""}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.name} className="min-w-0 text-xs">
              <code className="text-[var(--fg)]">{r.name}</code>
              {r.value ? <span className="text-[var(--muted)]"> = {r.value}</span> : null}
              {r.description ? (
                <span className="block truncate text-[var(--muted)]" title={r.description}>
                  {r.description}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VoiceAgentDetail({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const read = useAction(api.retellAgent.read);
  const publishPrompt = useAction(api.retellAgent.publishPrompt);
  const wireWebhook = useAction(api.retellAgent.wireWebhook);
  const testCall = useAction(api.retellAgent.testCall);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [begin, setBegin] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Kept so an accidental publish is one click to reverse, in the session that
  // made it. Not persisted: an undo offered after a reload would be a promise
  // about state nobody checked.
  const [previous, setPrevious] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");

  const load = useCallback(() => {
    setError(null);
    void read({ agentId })
      .then((d) => {
        const detail = d as Detail;
        setDetail(detail);
        setDraft(detail.prompt?.general ?? "");
        setBegin(detail.prompt?.beginMessage ?? "");
      })
      .catch((e: Error) => setError(e.message));
  }, [read, agentId]);

  useEffect(() => load(), [load]);

  const dirty = detail?.prompt ? draft !== detail.prompt.general || begin !== detail.prompt.beginMessage : false;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(label);
    try {
      await fn();
    } catch (e) {
      setStatus((e as Error).message);
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  return (
    <Sheet title={detail?.name ?? "Voice agent"} onClose={onClose}>
      {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
      {!detail && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {detail && (
        <div className="space-y-5">
          {/* Webhook first. It is the difference between an agent that works and
              one that answers the phone and quietly drops every result — and
              the old card showed two URLs without ever saying which state you
              were in. */}
          <div className="rounded-lg border border-[var(--border)] p-3">
            <div className="mb-1 flex items-center gap-2">
              <h4 className="text-xs font-medium">Results webhook</h4>
              <InfoTip text="Where Retell sends the outcome when a call ends. Without it the agent still answers, but nothing it collects reaches this app." />
            </div>
            {detail.webhook.wired ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Wired to this workspace.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {detail.webhook.pointsElsewhere
                    ? "Points somewhere else, so call results are not reaching this app."
                    : "Not set, so call results are not reaching this app."}
                </p>
                {detail.webhook.actual && (
                  <code className="block truncate text-xs text-[var(--muted)]">
                    now: {detail.webhook.actual}
                  </code>
                )}
                <button
                  type="button"
                  disabled={busy || !detail.webhook.expected}
                  onClick={() =>
                    void run("Wiring…", async () => {
                      await wireWebhook({ agentId });
                      setStatus("Webhook wired.");
                      load();
                    })
                  }
                  className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Point it here
                </button>
              </div>
            )}
          </div>

          {/* Prompt */}
          {detail.unsupportedReason ? (
            <p className="text-sm text-[var(--muted)]">{detail.unsupportedReason}</p>
          ) : (
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <h4 className="text-xs font-medium">Prompt</h4>
                <InfoTip text="What the agent is told to do. Publishing takes effect on the very next call." />
                {detail.version !== null && (
                  <span className="text-xs text-[var(--muted)]">v{detail.version}</span>
                )}
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={14}
                spellCheck={false}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 font-mono text-xs leading-relaxed"
              />
              <label className="mt-2 block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Opening line
                  <InfoTip text="What it says first. Leave empty to have the agent open on its own." />
                </span>
                <input
                  value={begin}
                  onChange={(e) => setBegin(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
                />
              </label>

              <div className="mt-2 flex items-center gap-2">
                {/* Deliberate Save rather than autosave: this changes what real
                    callers hear, and a half-typed sentence going live mid-edit
                    is not a tradeoff worth the convenience. */}
                <button
                  type="button"
                  disabled={!dirty || busy}
                  onClick={() =>
                    void run("Publishing…", async () => {
                      const res = (await publishPrompt({
                        agentId,
                        generalPrompt: draft,
                        beginMessage: begin,
                      })) as { previousPrompt: string; version: number | null };
                      setPrevious(res.previousPrompt);
                      setStatus(`Published v${res.version ?? "?"}, live on the next call.`);
                      load();
                    })
                  }
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  Publish
                </button>
                {previous !== null && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run("Reverting…", async () => {
                        await publishPrompt({ agentId, generalPrompt: previous });
                        setPrevious(null);
                        setStatus("Reverted to the previous prompt.");
                        load();
                      })
                    }
                    className="rounded-lg px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
                  >
                    Undo publish
                  </button>
                )}
                {status && <span className="text-xs text-[var(--muted)]">{status}</span>}
              </div>
            </div>
          )}

          {/* The three phases, together, because that is the whole reason to
              read this here rather than in Retell. */}
          <div className="grid gap-4 sm:grid-cols-3">
            <VarList
              title="Before the call"
              hint="Values handed to the agent when the call is placed, so it already knows who it is calling."
              rows={detail.variables.preCall}
              empty="Nothing injected."
            />
            <VarList
              title="During the call"
              hint="Functions the agent can call mid-conversation. This is how it checks the diary and books."
              rows={detail.variables.duringCall}
              empty="No functions. It can talk, but not book."
            />
            <VarList
              title="After the call"
              hint="What Retell extracts from the transcript once the call ends."
              rows={detail.variables.postCall}
              empty="Nothing extracted."
            />
          </div>

          {/* Test call */}
          <div className="rounded-lg border border-[var(--border)] p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <h4 className="text-xs font-medium">Test call</h4>
              <InfoTip text="Places a real call to the number you enter, using this agent. The phone genuinely rings and the minutes are billed." />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="+905321234567"
                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
              />
              <button
                type="button"
                disabled={busy || !testTo.trim()}
                onClick={() =>
                  void run("Calling…", async () => {
                    // Confirmed here rather than in the action: the phone rings
                    // for a real person, and a mis-click should cost nothing.
                    if (!window.confirm(`Call ${testTo.trim()} now with ${detail.name}?`)) {
                      setStatus(null);
                      return;
                    }
                    const res = (await testCall({ agentId, toNumber: testTo.trim() })) as {
                      from: string;
                      to: string;
                    };
                    setStatus(`Calling ${res.to} from ${res.from}…`);
                  })
                }
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--muted-bg)] disabled:opacity-40"
              >
                Call me
              </button>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
