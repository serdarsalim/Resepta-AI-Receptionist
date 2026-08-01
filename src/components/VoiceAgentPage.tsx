"use client";

import { useAction } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { InfoTip } from "./InfoTip";
import { PromptEditor } from "./PromptEditor";
import { Sheet } from "./Sheet";
import {
  VoiceVariablesEditor,
  builtinVoiceVariables,
  type VoiceContactField,
  type VoiceEditorSaveState,
  type VoiceVariable,
} from "./VoiceVariablesEditor";

// Everything about one voice agent that couples to this salon's data: the
// prompt it speaks from, the variables it uses before/during/after a call,
// whether its webhook actually reaches us, and a way to hear it.
//
// Voice, latency and interruption stay in Retell — those are audio engineering
// and nobody edits them because a customer said something. The prompt is the
// opposite: it changes weekly, and walking to another product to change one
// sentence is the friction this removes.
//
// A PAGE, not a sheet. It was a centred modal with the prompt, the variables
// grid and a test-call box crammed into a 55vh scroller, so the prompt — the
// thing people actually come here to edit — got about eight visible lines and
// its Save button lived below two folds. On a page the prompt gets room, and
// Save moves to the header where it is reachable from any scroll position.
//
// One Save covers both tabs. Variables publish first: publishVariables guards
// on the agent's Retell version, so publishing the prompt first would bump the
// version out from under it and the variables save would fail with a stale-
// version error the person did nothing to cause.

type Detail = {
  agentId: string;
  name: string;
  version: number | null;
  voiceId: string | null;
  language: string | null;
  engineType: string | null;
  llmId: string | null;
  prompt: { general: string; beginMessage: string } | null;
  webhook: {
    expected: string | null;
    actual: string | null;
    wired: boolean;
    pointsElsewhere: boolean;
  };
  variableConfig: {
    managed: boolean;
    items: VoiceVariable[];
  };
  contactFields: VoiceContactField[];
};

const E164_RE = /^\+[1-9]\d{6,14}$/;

export function VoiceAgentPage({
  agentId,
  onBack,
}: {
  agentId: string;
  onBack: () => void;
}) {
  const { t } = useLanguage();
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
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testError, setTestError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Instructions and Variables are one system (the prompt references the
  // variables), but stacked they made the page a scroll. Two tabs, and the
  // @-picker bridges them: the prompt can reach every variable by label.
  const [tab, setTab] = useState<"instructions" | "variables">("instructions");
  // Mirrored out of the variables editor so the header can save it too.
  const [varsState, setVarsState] = useState<VoiceEditorSaveState | null>(null);

  const load = useCallback(() => {
    setError(null);
    void read({ agentId })
      .then((d) => {
        const detail = d as Detail;
        setDetail(detail);
        setDraft(detail.prompt?.general ?? "");
        setBegin(detail.prompt?.beginMessage ?? "");
      })
      .catch(() => setError(t("settings.voiceActionFailed")));
  }, [read, agentId, t]);

  useEffect(() => load(), [load]);

  // useCallback: the editor publishes its state from an effect, so a handler
  // with a new identity each render would re-run that effect forever.
  const onVarsSaveState = useCallback((s: VoiceEditorSaveState) => setVarsState(s), []);

  const promptDirty = detail?.prompt
    ? draft !== detail.prompt.general || begin !== detail.prompt.beginMessage
    : false;
  const dirty = promptDirty || !!varsState?.dirty;
  const saving = busy || !!varsState?.busy;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(label);
    try {
      await fn();
    } catch {
      setStatus(t("settings.voiceActionFailed"));
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  const savePrompt = () =>
    run(t("voiceDetail.publishing"), async () => {
      const res = (await publishPrompt({
        agentId,
        generalPrompt: draft,
        beginMessage: begin,
      })) as { previousPrompt: string; version: number | null };
      setPrevious(res.previousPrompt);
      setStatus(t("voiceDetail.published").replace("{n}", String(res.version ?? "?")));
      load();
    });

  // Variables first, then the prompt — see the version note at the top.
  const saveAll = () => {
    if (varsState?.dirty) varsState.save();
    if (promptDirty) void savePrompt();
  };

  const discardAll = () => {
    varsState?.discard();
    setDraft(detail?.prompt?.general ?? "");
    setBegin(detail?.prompt?.beginMessage ?? "");
    setStatus(null);
  };

  const leave = () => {
    if (dirty) {
      setConfirmLeave(true);
      return;
    }
    onBack();
  };

  const placeTestCall = () => {
    const to = testTo.trim();
    // Checked here as well as in the action: the action's error is English,
    // this one speaks the org's language.
    if (!E164_RE.test(to)) {
      setTestError(t("voiceDetail.badNumber"));
      return;
    }
    setTestOpen(false);
    setTestError(null);
    void run(t("voiceDetail.calling"), async () => {
      const res = (await testCall({ agentId, toNumber: to })) as {
        from: string;
        to: string;
      };
      setStatus(
        t("voiceDetail.callingFromTo").replace("{to}", res.to).replace("{from}", res.from),
      );
    });
  };

  // Not from the backend: the backend would have to pick a language. Which of
  // the two unsupported shapes this is, the client can tell from engineType.
  const unsupported = !detail
    ? null
    : detail.engineType === "conversation-flow"
      ? t("voiceDetail.flowAgent")
      : detail.prompt
        ? null
        : t("voiceDetail.noPrompt");

  return (
    <>
      <div className="mx-auto max-w-3xl space-y-4">
        {/* The header carries the way back, the agent's name, and every action
            that applies to the whole agent. It stays put while the prompt
            scrolls under it. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={leave}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
            {t("voice.agents")}
          </button>
          <h2 className="min-w-[8rem] flex-1 text-lg font-semibold">
            {detail?.name ?? t("settings.voiceAgent")}
          </h2>
          {/* Hear the agent live, from the page where you just edited it.
              Quiet next to Save: it costs real minutes but changes nothing. */}
          <button
            type="button"
            disabled={saving || !detail}
            onClick={() => {
              setTestError(null);
              setTestOpen(true);
            }}
            className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            {t("voiceDetail.test")}
          </button>
          {dirty && (
            <>
              {/* Said out loud rather than implied by an enabled button: an
                  edited prompt looks live, and the agent is still answering
                  the phone with the version Retell has. */}
              <span
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400"
                title={t("voiceDetail.unsavedHint")}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {t("voiceDetail.unsaved")}
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={discardAll}
                className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] hover:border-red-300 hover:text-red-600 disabled:opacity-50"
              >
                {t("voiceDetail.discard")}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={saveAll}
                className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-50"
              >
                {saving ? t("voiceDetail.publishing") : t("voiceDetail.publish")}
              </button>
            </>
          )}
          {status && !dirty && (
            <span className="shrink-0 text-xs text-[var(--muted)]">{status}</span>
          )}
        </div>

        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {!detail && !error && (
          <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
        )}

        {detail && (
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            {/* Only when it is broken. A green "yes, the wiring is fine" line
                on every visit is a permanent reminder of a problem nobody
                has. */}
            {!detail.webhook.wired && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                <div className="mb-1 flex items-center gap-2">
                  <h4 className="text-xs font-medium">{t("voiceDetail.webhook")}</h4>
                  <InfoTip text={t("voiceDetail.webhookHint")} />
                </div>
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
                  {detail.webhook.pointsElsewhere
                    ? t("voiceDetail.webhookElsewhere")
                    : t("voiceDetail.webhookMissing")}
                </p>
                <button
                  type="button"
                  disabled={saving || !detail.webhook.expected}
                  onClick={() =>
                    void run(t("voiceDetail.wiring"), async () => {
                      await wireWebhook({ agentId });
                      setStatus(t("voiceDetail.wired"));
                      load();
                    })
                  }
                  className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-50"
                >
                  {t("voiceDetail.webhookFix")}
                </button>
              </div>
            )}

            <div className="flex gap-1">
              {[
                { id: "instructions" as const, label: t("voiceDetail.prompt") },
                { id: "variables" as const, label: t("voiceVariables.title") },
              ].map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  aria-current={tab === entry.id ? "page" : undefined}
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${
                    tab === entry.id
                      ? "bg-[var(--accent)] font-medium text-[var(--accent-fg)]"
                      : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {tab === "instructions" &&
              (unsupported ? (
                <p className="text-sm text-[var(--muted)]">{unsupported}</p>
              ) : (
                <div>
                  <div className="mb-1.5 flex items-center gap-2">
                    <h4 className="text-xs font-medium">{t("voiceDetail.prompt")}</h4>
                    <InfoTip text={t("voiceDetail.promptHint")} />
                    {detail.version !== null && (
                      <span className="text-xs text-[var(--muted)]">v{detail.version}</span>
                    )}
                  </div>
                  <PromptEditor
                    value={draft}
                    onChange={setDraft}
                    // The registry's rows plus the built-ins the runtime always
                    // injects (customer, business, next appointment, services).
                    // A registry row with the same key wins, mirroring the
                    // injection's precedence.
                    variables={(() => {
                      const rows = detail.variableConfig.items.map((row) => ({
                        key: row.key,
                        label: row.label,
                      }));
                      const seen = new Set(rows.map((row) => row.key));
                      return [
                        ...rows,
                        ...builtinVoiceVariables(t).filter((row) => !seen.has(row.key)),
                      ];
                    })()}
                  />
                  <label className="mt-3 block">
                    <span className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                      {t("voiceDetail.opening")}
                      <InfoTip text={t("voiceDetail.openingHint")} />
                    </span>
                    {/* A textarea, not an input: an opening line is a spoken
                        sentence and often two, and a single-line field made
                        the end of it scroll out of sight while typing. */}
                    <textarea
                      value={begin}
                      onChange={(e) => setBegin(e.target.value)}
                      rows={2}
                      className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
                    />
                  </label>

                  {previous !== null && !promptDirty && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        void run(t("voiceDetail.reverting"), async () => {
                          await publishPrompt({ agentId, generalPrompt: previous });
                          setPrevious(null);
                          setStatus(t("voiceDetail.reverted"));
                          load();
                        })
                      }
                      className="mt-2 rounded-lg px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
                    >
                      {t("voiceDetail.undo")}
                    </button>
                  )}
                </div>
              ))}

            {tab === "variables" && (
              <VoiceVariablesEditor
                agentId={agentId}
                version={detail.version}
                engineType={detail.engineType}
                managed={detail.variableConfig.managed}
                initial={detail.variableConfig.items}
                contactFields={detail.contactFields}
                onPublished={load}
                onSaveStateChange={onVarsSaveState}
              />
            )}
          </div>
        )}
      </div>

      {testOpen && detail && (
        <Sheet
          title={t("voiceDetail.test")}
          hint={t("voiceDetail.testHint")}
          onClose={() => setTestOpen(false)}
        >
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted)]">
              {t("voiceDetail.confirmCall")
                .replace("{to}", testTo.trim() || "…")
                .replace("{name}", detail.name)}
            </p>
            {/* Unsaved edits are not part of the call — Retell runs the saved
                config. Saying so here beats hearing the old prompt and
                assuming the editor is broken. */}
            {dirty && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t("voiceDetail.testUnsaved")}
              </p>
            )}
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && placeTestCall()}
              placeholder="+905321234567"
              autoFocus
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
            />
            {testError && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{testError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTestOpen(false)}
                className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={!testTo.trim()}
                onClick={placeTestCall}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-40"
              >
                {t("voiceDetail.callMe")}
              </button>
            </div>
          </div>
        </Sheet>
      )}

      {confirmLeave && (
        <Sheet title={t("voiceDetail.leaveTitle")} onClose={() => setConfirmLeave(false)}>
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted)]">{t("voiceDetail.leaveBody")}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmLeave(false)}
                className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmLeave(false);
                  onBack();
                }}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-[var(--muted-bg)]"
              >
                {t("voiceDetail.leave")}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
