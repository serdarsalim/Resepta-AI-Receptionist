"use client";

import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { buttonClass, fieldClass } from "./Control";
import { InfoTip } from "./InfoTip";
import { SegmentedControl } from "./SegmentedControl";
import { CustomerPickField, type PickedCustomer } from "./CustomerPickField";

// A test of the agent in the browser (P9 of the Nudge port; Nudge's
// AgentTestPanel). The owner talks to the agent through the microphone, as a
// customer they pick or as a stranger, and nobody's phone rings. The agent
// hears exactly what it would hear on a real ring (the backend builds the
// variables with the same read every call uses), and the owner can type over
// any of them first.
//
// Nothing it does is real: on a test call the agent's tools answer dry, and
// what they would have done is listed afterwards (convex/agentTests.ts). The
// minutes are real and billed like a call.
//
// The SDK is imported lazily, inside the click: it pulls in a whole WebRTC
// stack, far too much for a page whose job is editing text, and most opens of
// the agent page never press Start.
//
// NOTE for whoever bumps the SDK past 3.x: RetellWebClient is the token-only
// client and goes away in 4.0. Its replacement takes an API KEY in the
// browser, which is not a trade to make; keep the token path (Nudge's note).

type Phase = "idle" | "connecting" | "live" | "ended";
type Direction = "outbound" | "inbound";
type Action = { tool: string; detail: string; ok: boolean; at: number };
type Result = {
  ready: boolean;
  turns: { role: string; text: string }[];
  summary: string | null;
  collected: Record<string, unknown>;
  recordingUrl: string | null;
  durationSec: number | null;
  actions: Action[];
};

export const TOOL_LABELS: Record<string, TranslationKey> = {
  book_appointment: "agentTest.toolBook",
  cancel_appointment: "agentTest.toolCancel",
  reschedule_appointment: "agentTest.toolMove",
  save_customer_details: "agentTest.toolSave",
  update_contact: "agentTest.toolSave",
};

export function AgentBrowserTest({
  agentId,
  hasEdits,
  stage,
  onLiveChange,
}: {
  agentId: string;
  // Whether the page holds edits (or a provider draft) the test should hear.
  hasEdits: boolean;
  // Puts those edits on the provider's draft and says which version to dial;
  // null = dial the published version.
  stage: () => Promise<number | null>;
  // Lets the sheet refuse to close on Escape while a call is up.
  onLiveChange?: (live: boolean) => void;
}) {
  const { t } = useLanguage();
  const readVariables = useAction(api.retellAgent.browserTestVariables);
  const startTest = useAction(api.retellAgent.startBrowserTest);
  const readResult = useAction(api.retellAgent.browserTestResult);

  const [picked, setPicked] = useState<PickedCustomer | null>(null);
  const [direction, setDirection] = useState<Direction>("outbound");
  const [vars, setVars] = useState<Record<string, string> | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [showEmpty, setShowEmpty] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [talking, setTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [usedDraft, setUsedDraft] = useState(false);

  // The live client. A ref, not state: it is an event emitter with a socket
  // behind it, and a re-render must never be what tears a call down.
  const clientRef = useRef<{ stopCall: () => void } | null>(null);

  const live = phase === "connecting" || phase === "live";
  useEffect(() => onLiveChange?.(live), [live, onLiveChange]);

  // What the agent would be handed, refreshed whenever the person changes.
  // A read: it costs nothing and runs before anybody commits to a minute.
  useEffect(() => {
    let cancelled = false;
    void readVariables({ agentId, ...(picked ? { customerId: picked.id } : {}) })
      .then((r) => {
        if (cancelled) return;
        setVars(r.variables);
        setUnavailable(r.unavailable);
        setOverrides({});
      })
      .catch(() => {
        if (!cancelled) setError(t("agentTest.failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, picked, readVariables, t]);

  const hangUp = () => {
    try {
      clientRef.current?.stopCall();
    } catch {
      // Already gone.
    }
    clientRef.current = null;
  };
  // Leaving the page hangs up: a web call left running bills by the minute
  // and no other surface would show it.
  useEffect(() => hangUp, []);

  // The provider writes the call up a beat after it ends, so this asks a few
  // times rather than show an empty result and call it done.
  const fetchResult = async (callId: string) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 1500 : 2500));
      try {
        const r = await readResult({ callId });
        setResult(r);
        if (r.ready && (r.summary || r.turns.length > 0) && r.recordingUrl) return;
      } catch {
        return;
      }
    }
  };

  const start = () => {
    setError(null);
    setResult(null);
    setPhase("connecting");
    void (async () => {
      // The page's edits go onto the draft FIRST, so the call hears what is
      // on screen.
      const version = hasEdits ? await stage() : null;
      setUsedDraft(version !== null);
      // Server first: if the provider refuses, nothing has asked for the
      // microphone and the panel can say why without a prompt in the way.
      const session = await startTest({
        agentId,
        direction,
        ...(picked ? { customerId: picked.id } : {}),
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
        ...(version !== null ? { agentVersion: version } : {}),
      });
      const { RetellWebClient } = await import("retell-client-js-sdk");
      const client = new RetellWebClient();
      clientRef.current = client;
      client.on("call_started", () => setPhase("live"));
      client.on("call_ended", () => {
        setPhase("ended");
        setTalking(false);
        clientRef.current = null;
        void fetchResult(session.callId);
      });
      client.on("agent_start_talking", () => setTalking(true));
      client.on("agent_stop_talking", () => setTalking(false));
      client.on("error", () => {
        setError(t("agentTest.failed"));
        hangUp();
        setPhase("ended");
        void fetchResult(session.callId);
      });
      // Everything the provider answered with, handed straight back. The
      // transport is load-bearing (see the returns note on startBrowserTest).
      await client.startCall({
        accessToken: session.accessToken,
        callId: session.callId,
        ...(session.transport
          ? { transport: session.transport as "livekit" | "gateway" }
          : {}),
        ...(session.iceServers.length > 0
          ? { iceServers: session.iceServers as RTCIceServer[] }
          : {}),
      });
    })().catch((err: unknown) => {
      const raw = err instanceof Error ? `${err.name} ${err.message}` : String(err);
      setError(
        /NotAllowed|Permission/i.test(raw)
          ? t("agentTest.micDenied")
          : raw.includes("test-unavailable")
            ? t("agentTest.unavailable")
            : t("agentTest.failed"),
      );
      hangUp();
      setPhase("idle");
    });
  };

  const entries = Object.entries(vars ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const valueOf = (key: string, value: string) => overrides[key] ?? value;
  const filled = entries.filter(([key, value]) => valueOf(key, value).trim());
  const empty = entries.filter(([key, value]) => !valueOf(key, value).trim());
  const rows = showEmpty ? entries : filled;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">{t("agentTest.browserHint")}</p>

      <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5">
        <span className="text-xs font-medium">{t("agentTest.callAs")}</span>
        <div className="min-w-0">
          <CustomerPickField
            value={picked}
            onChange={setPicked}
            disabled={live}
            placeholder={`${t("agentTest.stranger")} · ${t("agentTest.searchCustomer")}`}
            clearLabel={t("agentTest.stranger")}
          />
        </div>

        <span className="text-xs font-medium">{t("agentTest.direction")}</span>
        <div>
          <SegmentedControl
            value={direction}
            disabled={live}
            ariaLabel={t("agentTest.direction")}
            onChange={setDirection}
            segments={[
              { id: "outbound", label: t("agentTest.outbound") },
              { id: "inbound", label: t("agentTest.inbound") },
            ]}
          />
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <h4 className="text-xs font-medium">{t("agentTest.variables")}</h4>
          <InfoTip text={t("agentTest.variablesHint")} />
          {empty.length > 0 && (
            <button
              type="button"
              onClick={() => setShowEmpty((open) => !open)}
              className="ml-auto text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              {t.plural("agentTest.emptyCount", empty.length)}
            </button>
          )}
        </div>
        {vars === null ? (
          <p className="text-xs text-[var(--muted)]">{t("common.loading")}</p>
        ) : (
          <div className="thin-scroll max-h-56 space-y-1 overflow-y-auto">
            {rows.map(([key, value]) => (
              <label
                key={key}
                className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-2"
              >
                <span className="truncate font-mono text-[11px] text-[var(--muted-strong)]">
                  {key}
                </span>
                <input
                  value={valueOf(key, value)}
                  disabled={live}
                  onChange={(event) =>
                    setOverrides((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className={`${fieldClass("xs")} w-full`}
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {unavailable && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{t("agentTest.unavailable")}</p>
      )}
      {hasEdits && phase === "idle" && (
        <p className="text-xs text-[var(--muted)]">{t("agentTest.draftIncluded")}</p>
      )}
      {error && <p className="text-xs text-amber-700 dark:text-amber-400">{error}</p>}

      <div className="flex min-h-8 items-center gap-3">
        {live ? (
          <>
            <span className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${
                  talking ? "bg-emerald-500" : "bg-[var(--muted)]"
                }`}
              />
              {phase === "connecting"
                ? t("agentTest.connecting")
                : talking
                  ? t("agentTest.agentTalking")
                  : t("agentTest.live")}
            </span>
            <button
              type="button"
              onClick={() => {
                hangUp();
                setPhase("ended");
              }}
              className={`${buttonClass("danger", "sm")} ml-auto`}
            >
              {t("agentTest.hangUp")}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={unavailable || vars === null}
            onClick={start}
            className={`${buttonClass("primary", "sm")} ml-auto`}
          >
            {phase === "ended" ? t("agentTest.again") : t("agentTest.start")}
          </button>
        )}
      </div>

      {phase === "ended" && (
        <TestResultView result={result} draft={usedDraft} />
      )}

    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// What a finished test came to: what the agent would have done, the summary,
// what it heard, the recording and the words. Shared with the test log.
export function TestResultView({
  result,
  draft = false,
}: {
  result: Result | null;
  draft?: boolean;
}) {
  const { t } = useLanguage();
  if (!result || (!result.ready && result.turns.length === 0)) {
    return <p className="text-xs text-[var(--muted)]">{t("agentTest.waiting")}</p>;
  }
  const collected = Object.entries(result.collected).filter(([, value]) =>
    formatValue(value).trim(),
  );
  return (
    <div className="space-y-3 border-t border-[var(--border)] pt-3 text-sm">
      {draft && (
        <p className="text-xs text-[var(--muted)]">{t("agentTest.draftIncluded")}</p>
      )}
      <section>
        <h5 className="mb-1 text-xs font-medium">{t("agentTest.wouldDo")}</h5>
        {result.actions.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">{t("agentTest.wouldDoNone")}</p>
        ) : (
          <ul className="space-y-0.5">
            {result.actions.map((action) => (
              <li key={action.at + action.tool} className="flex gap-2 text-xs">
                <span className="shrink-0 font-medium">
                  {TOOL_LABELS[action.tool] ? t(TOOL_LABELS[action.tool]) : action.tool}
                </span>
                <span className="min-w-0 truncate text-[var(--muted-strong)]">
                  {action.detail}
                </span>
                {!action.ok && (
                  <span className="shrink-0 text-amber-700 dark:text-amber-400">
                    {t("agentTest.refused")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {result.summary && (
        <section>
          <h5 className="mb-1 text-xs font-medium">{t("agentTest.summary")}</h5>
          <p className="text-xs leading-relaxed">{result.summary}</p>
        </section>
      )}
      {collected.length > 0 && (
        <section>
          <h5 className="mb-1 text-xs font-medium">{t("agentTest.collected")}</h5>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
            {collected.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="font-mono text-[11px] text-[var(--muted-strong)]">{key}</dt>
                <dd className="min-w-0 break-words">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {result.recordingUrl && (
        <audio controls preload="none" src={result.recordingUrl} className="h-8 w-full" />
      )}
      {result.turns.length > 0 && (
        <section>
          <h5 className="mb-1 text-xs font-medium">{t("agentTest.transcript")}</h5>
          <div className="thin-scroll max-h-64 space-y-1.5 overflow-y-auto">
            {result.turns.map((turn, index) => (
              <p key={index} className="text-xs leading-relaxed">
                <span className="font-medium text-[var(--muted-strong)]">
                  {turn.role === "agent" ? t("agentTest.agentRole") : t("agentTest.callerRole")}
                  :
                </span>{" "}
                {turn.text}
              </p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
