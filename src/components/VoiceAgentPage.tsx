"use client";

import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
// ONE COLUMN, no tabs: instructions → opening line → voice → variables. That
// is the order a call happens in, and it is the whole agent on one screen. It
// was briefly two tabs, which made the first screen a lone giant textarea over
// dead space and hid the variables behind a pill nobody clicked — a page that
// looks empty reads as a page that isn't finished.
//
// One Save covers everything. Variables publish first: publishVariables guards
// on the agent's Retell version, so publishing the prompt first would bump the
// version out from under it and the variables save would fail with a stale-
// version error the person did nothing to cause.
//
// Unsaved work SURVIVES leaving. There was a leave-guard dialog here that
// threw the draft away on confirm, which is the wrong trade: a half-written
// prompt is real work, and losing it to a mis-click is worse than the thing
// the guard protected against. The amber pill was already doing that job —
// nothing on this page can be mistaken for live while it is showing.

type Detail = {
  agentId: string;
  name: string;
  version: number | null;
  voiceId: string | null;
  voices: {
    id: string;
    name: string;
    gender: string;
    accent: string;
    previewUrl: string | null;
  }[];
  language: string | null;
  engineType: string | null;
  llmId: string | null;
  lines: { number: string; nickname: string; agentId: string | null }[];
  inboundNumber: string | null;
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

// The unsaved draft, per agent, on this browser. Deliberately NOT on the
// server: an unpublished prompt is one person's thinking-in-progress, and
// syncing it would mean a colleague opening the agent and finding text nobody
// decided to ship yet.
type StoredDraft = {
  prompt?: string;
  begin?: string;
  voice?: string;
  rows?: VoiceVariable[];
};

const draftKey = (agentId: string) => `randevu.agentDraft.${agentId}`;

function readDraft(agentId: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(agentId));
    return raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    // Corrupt or unavailable storage must not take the editor down with it.
    return null;
  }
}

function writeDraft(agentId: string, draft: StoredDraft) {
  try {
    window.localStorage.setItem(draftKey(agentId), JSON.stringify(draft));
  } catch {
    // Private mode, or the quota. The editor still works, it just forgets.
  }
}

function clearDraft(agentId: string) {
  try {
    window.localStorage.removeItem(draftKey(agentId));
  } catch {
    // Nothing to do — the draft was never the source of truth.
  }
}

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
  const assignLine = useAction(api.retellAgent.assignLine);
  const testCall = useAction(api.retellAgent.testCall);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [begin, setBegin] = useState("");
  const [voice, setVoice] = useState("");
  // Only one preview plays at a time — clicking down the list otherwise leaves
  // four voices talking over each other.
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Kept so an accidental publish is one click to reverse, in the session that
  // made it. Not persisted: an undo offered after a reload would be a promise
  // about state nobody checked.
  const [previous, setPrevious] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testError, setTestError] = useState<string | null>(null);
  // The line dropdown writes straight to the provider — no Save, because it
  // isn't part of the draft the prompt and variables share. It gets its own
  // in-flight and failed states, and the reload restores the real binding if
  // the provider refuses.
  const [assigning, setAssigning] = useState(false);
  const [lineError, setLineError] = useState(false);
  // Mirrored out of the variables editor so the header can save it too.
  const [varsState, setVarsState] = useState<VoiceEditorSaveState | null>(null);
  // Rows recovered from a stored draft, handed to the editor as its seed.
  const [seed, setSeed] = useState<VoiceVariable[] | null>(null);
  // Until the first read lands there is nothing to compare a draft against,
  // and writing one would persist empty strings over real work.
  const [restored, setRestored] = useState(false);

  const load = useCallback(() => {
    setError(null);
    void read({ agentId })
      .then((d) => {
        const detail = d as Detail;
        setDetail(detail);
        setDraft(detail.prompt?.general ?? "");
        setBegin(detail.prompt?.beginMessage ?? "");
        setVoice(detail.voiceId ?? "");
        // A draft left behind on this browser wins over what the server says,
        // because it is the newer intent. The amber pill keeps it honest about
        // not being live.
        const stored = readDraft(agentId);
        if (stored) {
          if (stored.prompt !== undefined) setDraft(stored.prompt);
          if (stored.begin !== undefined) setBegin(stored.begin);
          if (stored.voice !== undefined) setVoice(stored.voice);
          setSeed(stored.rows ?? null);
        }
        setRestored(true);
      })
      .catch(() => setError(t("settings.voiceActionFailed")));
  }, [read, agentId, t]);

  useEffect(() => load(), [load]);

  // Stop a preview that is still talking when the page goes away.
  useEffect(
    () => () => {
      previewRef.current?.pause();
      previewRef.current = null;
    },
    [],
  );

  // useCallback: the editor publishes its state from an effect, so a handler
  // with a new identity each render would re-run that effect forever.
  const onVarsSaveState = useCallback((s: VoiceEditorSaveState) => setVarsState(s), []);

  const voiceDirty = !!detail && voice !== (detail.voiceId ?? "");
  const promptDirty =
    (detail?.prompt
      ? draft !== detail.prompt.general || begin !== detail.prompt.beginMessage
      : false) || voiceDirty;
  const dirty = promptDirty || !!varsState?.dirty;
  const saving = busy || !!varsState?.busy;

  // The draft follows the edits. Leaving the page, closing the tab or coming
  // back tomorrow all find the work where it was left — losing typed work to a
  // mis-click is worse than the thing a leave-guard was protecting against,
  // and the amber pill already stops a draft being mistaken for live.
  useEffect(() => {
    if (!restored) return;
    if (dirty) {
      writeDraft(agentId, { prompt: draft, begin, voice, rows: varsState?.rows });
    } else {
      clearDraft(agentId);
    }
  }, [restored, dirty, agentId, draft, begin, voice, varsState?.rows]);

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
        // Only when it changed: an unchanged voice sent every time is a field
        // the undo path would drag back with an old prompt.
        ...(voiceDirty ? { voiceId: voice } : {}),
      })) as { previousPrompt: string; version: number | null };
      setPrevious(res.previousPrompt);
      setStatus(t("voiceDetail.published").replace("{n}", String(res.version ?? "?")));
      load();
    });

  // Variables first, then the prompt — see the version note at the top.
  const saveAll = () => {
    setSeed(null);
    if (varsState?.dirty) varsState.save();
    if (promptDirty) void savePrompt();
    clearDraft(agentId);
  };

  // The only way work is thrown away, and it takes a deliberate click.
  const discardAll = () => {
    setSeed(null);
    varsState?.discard();
    setDraft(detail?.prompt?.general ?? "");
    setBegin(detail?.prompt?.beginMessage ?? "");
    setVoice(detail?.voiceId ?? "");
    clearDraft(agentId);
    setStatus(null);
  };

  // Binding a line is immediate and unrelated to the draft: it changes which
  // phone rings this agent, not what the agent says. Riding Save would mean an
  // unsaved prompt held the phone number hostage.
  const chooseLine = (number: string | null) => {
    setAssigning(true);
    setLineError(false);
    void assignLine({ agentId, number })
      .then(() => load())
      .catch(() => setLineError(true))
      .finally(() => setAssigning(false));
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

  // The registry's rows plus the built-ins the runtime always injects
  // (customer, business, next appointment, services). A registry row with the
  // same key wins, mirroring the injection's precedence. Shared by the prompt
  // and the opening line so the @ picker offers the same list in both.
  const promptVariables = useMemo(() => {
    const rows = (detail?.variableConfig.items ?? []).map((row) => ({
      key: row.key,
      label: row.label,
    }));
    const seen = new Set(rows.map((row) => row.key));
    return [...rows, ...builtinVoiceVariables(t).filter((row) => !seen.has(row.key))];
  }, [detail, t]);

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
      {/* Wider than the rest of Voice agent on purpose: the variables grid is
          six columns and the prompt is prose. At the list's width the grid
          horizontally scrolled on every visit. */}
      <div className="mx-auto max-w-4xl space-y-4">
        {/* The header carries the way back, the agent's name, and every action
            that applies to the whole agent. It stays put while the prompt
            scrolls under it. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={onBack}
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
            {t("common.back")}
          </button>
          {/* Centred, not left-aligned: butted up against Back it read as the
              button's second line rather than the name of the thing. */}
          <h2 className="min-w-[8rem] flex-1 text-center text-lg font-semibold">
            {detail?.name ?? t("settings.voiceAgent")}
          </h2>
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
          {lineError && (
            <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">
              {t("voiceDetail.lineFailed")}
            </span>
          )}
          {/* Which phone rings this agent, next to the button that makes it
              ring. The list already had this control per row, but by the time
              you are editing the agent the list is two clicks behind you — and
              "why didn't my test number reach it" is answered right here.
              Options are every line on the account, not just the free ones:
              picking one another agent holds MOVES it, which is the whole
              point when you are switching which agent answers. */}
          {detail && (
            <select
              value={detail.inboundNumber ?? ""}
              disabled={assigning || saving}
              title={t("settings.inboundNumber")}
              aria-label={t("settings.inboundNumber")}
              onChange={(e) => chooseLine(e.target.value || null)}
              // w-auto is load-bearing: globals.css gives every select
              // width:100% in the base layer, so a select without it eats its
              // whole flex line and drops Test call to the next row.
              className="w-auto shrink-0 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--muted)] disabled:opacity-50"
            >
              <option value="">{t("voiceDetail.noLine")}</option>
              {/* The number, never the nickname. A nickname is what someone
                  called the line at the provider, and prepending it pushed the
                  number itself out of a control this narrow — leaving "austrian
                  number · +435…", which answers nothing. */}
              {detail.lines.map((line) => (
                <option key={line.number} value={line.number}>
                  {line.number}
                </option>
              ))}
            </select>
          )}
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
        </div>

        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {!detail && !error && (
          <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
        )}

        {detail && (
          <div className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            {/* One quiet line, not a slab. It only appears when the plumbing is
                actually broken, and a boxed amber warning the height of a
                paragraph made a fixable config detail the loudest thing on a
                page about what the agent says. */}
            {!detail.webhook.wired && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                <span>
                  {detail.webhook.pointsElsewhere
                    ? t("voiceDetail.webhookElsewhere")
                    : t("voiceDetail.webhookMissing")}
                </span>
                <InfoTip text={t("voiceDetail.webhookHint")} />
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
                  className="rounded-lg border border-current px-2 py-0.5 font-medium hover:bg-amber-500/10 disabled:opacity-50"
                >
                  {t("voiceDetail.webhookFix")}
                </button>
              </div>
            )}

            {unsupported ? (
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
                <PromptEditor value={draft} onChange={setDraft} variables={promptVariables} />
                <label className="mt-3 block">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                    {t("voiceDetail.opening")}
                    <InfoTip text={t("voiceDetail.openingHint")} />
                  </span>
                  {/* The same editor as the prompt, in single-line mode: the
                      opening line is where {{customer_name}} matters most, and
                      it deserves the same @ picker and the same pills. It
                      wraps and grows rather than scrolling, because an opening
                      line is a spoken sentence and often two. */}
                  <PromptEditor
                    value={begin}
                    onChange={setBegin}
                    variables={promptVariables}
                    singleLine
                  />
                </label>

                {/* Voice sits with the prompt: both are "how this agent comes
                    across", and both ride the same Save. Previously it was
                    only settable when creating an agent, so changing your
                    mind meant making a new one. */}
                <div className="mt-3">
                  <span className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium">
                    {t("voiceDetail.voice")}
                    <InfoTip text={t("voiceDetail.voiceHint")} />
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Sized to a voice name, not to the card. A full-width
                        select for "Andrew · American · male" reads as an empty
                        field with a word in the corner. */}
                    <select
                      value={voice}
                      onChange={(e) => setVoice(e.target.value)}
                      className="w-full max-w-xs rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
                    >
                      {/* An agent whose voice is not in the catalogue still
                          shows what it is actually using, rather than
                          silently reading as the first option in the list. */}
                      {!detail.voices.some((v) => v.id === voice) && (
                        <option value={voice}>{voice || t("voiceDetail.voicePick")}</option>
                      )}
                      {detail.voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {[v.name, v.accent, v.gender].filter(Boolean).join(" · ")}
                        </option>
                      ))}
                    </select>
                    {(() => {
                      const url = detail.voices.find((v) => v.id === voice)?.previewUrl;
                      if (!url) return null;
                      return (
                        <button
                          type="button"
                          title={t("voiceDetail.voicePreview")}
                          onClick={() => {
                            previewRef.current?.pause();
                            const audio = new Audio(url);
                            previewRef.current = audio;
                            void audio.play().catch(() => {});
                          }}
                          className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                        >
                          ▶
                        </button>
                      );
                    })()}
                  </div>
                </div>

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
                    className="mt-3 rounded-lg px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
                  >
                    {t("voiceDetail.undo")}
                  </button>
                )}
              </div>
            )}

            {/* The variables the prompt above refers to, on the same screen as
                the prompt. The @-picker reaches them by label; a tab between
                the two meant checking a variable's name cost a click and lost
                your place in the prompt. */}
            <div className="border-t border-[var(--border)] pt-4">
              <VoiceVariablesEditor
                agentId={agentId}
                version={detail.version}
                engineType={detail.engineType}
                managed={detail.variableConfig.managed}
                initial={detail.variableConfig.items}
                seed={seed}
                contactFields={detail.contactFields}
                onPublished={load}
                onSaveStateChange={onVarsSaveState}
              />
            </div>
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

    </>
  );
}
