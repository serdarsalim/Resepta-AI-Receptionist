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
  type VoiceContactField,
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

export function VoiceAgentDetail({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
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
  const [testTo, setTestTo] = useState("");
  // Instructions and Variables are one system (the prompt references the
  // variables), but stacked they made the sheet a scroll. Two tabs, and the
  // @-picker bridges them: the prompt can reach every variable by label.
  const [tab, setTab] = useState<"instructions" | "variables">("instructions");

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

  const dirty = detail?.prompt ? draft !== detail.prompt.general || begin !== detail.prompt.beginMessage : false;

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
    <Sheet title={detail?.name ?? t("settings.voiceAgent")} wide onClose={onClose}>
      {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
      {!detail && !error && <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>}

      {detail && (
        <div className="space-y-5">
          {/* Results first. It is the difference between an agent that works and
              one that answers the phone and quietly drops every result. The
              provider connection stays behind the native status and fix. */}
          <div className="rounded-lg border border-[var(--border)] p-3">
            <div className="mb-1 flex items-center gap-2">
              <h4 className="text-xs font-medium">{t("voiceDetail.webhook")}</h4>
              <InfoTip text={t("voiceDetail.webhookHint")} />
            </div>
            {detail.webhook.wired ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {t("voiceDetail.webhookWired")}
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {detail.webhook.pointsElsewhere
                    ? t("voiceDetail.webhookElsewhere")
                    : t("voiceDetail.webhookMissing")}
                </p>
                <button
                  type="button"
                  disabled={busy || !detail.webhook.expected}
                  onClick={() =>
                    void run(t("voiceDetail.wiring"), async () => {
                      await wireWebhook({ agentId });
                      setStatus(t("voiceDetail.wired"));
                      load();
                    })
                  }
                  className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {t("voiceDetail.webhookFix")}
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-1">
            {(
              [
                { id: "instructions" as const, label: t("voiceDetail.prompt") },
                { id: "variables" as const, label: t("voiceVariables.title") },
              ]
            ).map((entry) => (
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

          {/* Prompt */}
          {tab === "instructions" && (unsupported ? (
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
                variables={detail.variableConfig.items.map((row) => ({
                  key: row.key,
                  label: row.label,
                }))}
              />
              <label className="mt-2 block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  {t("voiceDetail.opening")}
                  <InfoTip text={t("voiceDetail.openingHint")} />
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
                    void run(t("voiceDetail.publishing"), async () => {
                      const res = (await publishPrompt({
                        agentId,
                        generalPrompt: draft,
                        beginMessage: begin,
                      })) as { previousPrompt: string; version: number | null };
                      setPrevious(res.previousPrompt);
                      setStatus(
                        t("voiceDetail.published").replace("{n}", String(res.version ?? "?")),
                      );
                      load();
                    })
                  }
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {t("voiceDetail.publish")}
                </button>
                {previous !== null && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(t("voiceDetail.reverting"), async () => {
                        await publishPrompt({ agentId, generalPrompt: previous });
                        setPrevious(null);
                        setStatus(t("voiceDetail.reverted"));
                        load();
                      })
                    }
                    className="rounded-lg px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
                  >
                    {t("voiceDetail.undo")}
                  </button>
                )}
                {status && <span className="text-xs text-[var(--muted)]">{status}</span>}
              </div>
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
            />
          )}

          {/* Test call */}
          <div className="rounded-lg border border-[var(--border)] p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <h4 className="text-xs font-medium">{t("voiceDetail.test")}</h4>
              <InfoTip text={t("voiceDetail.testHint")} />
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
                  void run(t("voiceDetail.calling"), async () => {
                    const to = testTo.trim();
                    // Checked here too, not only in the action: the action's
                    // error is English, this one speaks the org's language.
                    if (!/^\+[1-9]\d{6,14}$/.test(to)) {
                      setStatus(t("voiceDetail.badNumber"));
                      return;
                    }
                    // Confirmed here rather than in the action: the phone rings
                    // for a real person, and a mis-click should cost nothing.
                    if (
                      !window.confirm(
                        t("voiceDetail.confirmCall")
                          .replace("{to}", to)
                          .replace("{name}", detail.name),
                      )
                    ) {
                      setStatus(null);
                      return;
                    }
                    const res = (await testCall({ agentId, toNumber: to })) as {
                      from: string;
                      to: string;
                    };
                    setStatus(
                      t("voiceDetail.callingFromTo")
                        .replace("{to}", res.to)
                        .replace("{from}", res.from),
                    );
                  })
                }
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--muted-bg)] disabled:opacity-40"
              >
                {t("voiceDetail.callMe")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
