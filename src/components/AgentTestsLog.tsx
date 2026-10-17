"use client";

import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { InfoTip } from "./InfoTip";
import { TestResultView } from "./AgentBrowserTest";

// The agent's browser tests, newest first (P9; Nudge's AgentTestsCard). One
// line each: when, who it called as, how long, which version. Opening a line
// fetches its words from the provider (agentTests rows hold the summary and
// what the tools would have done, never the transcript). Hidden until there
// is a test: an empty log is a heading over nothing.

type Opened = FunctionReturnType<typeof api.retellAgent.browserTestResult>;

function duration(seconds: number | null): string {
  if (seconds === null) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AgentTestsLog({ agentId }: { agentId: string }) {
  const { t, language } = useLanguage();
  const rows = useQuery(api.agentTests.listForAgent, { retellAgentId: agentId });
  const readResult = useAction(api.retellAgent.browserTestResult);
  const [openId, setOpenId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);

  if (!rows || rows.length === 0) return null;

  const toggle = (callId: string) => {
    if (openId === callId) {
      setOpenId(null);
      return;
    }
    setOpenId(callId);
    setOpened(null);
    void readResult({ callId })
      .then(setOpened)
      .catch(() => setOpened(null));
  };

  return (
    <div className="border-t border-[var(--border)] pt-4">
      <div className="mb-2 flex items-center gap-1.5">
        <h4 className="text-xs font-medium">{t("agentTest.history")}</h4>
        <InfoTip text={t("agentTest.historyHint")} />
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {rows.map(({ test, customerName }) => (
          <li key={test._id}>
            <button
              type="button"
              onClick={() => toggle(test.callId)}
              aria-expanded={openId === test.callId}
              className="grid w-full grid-cols-[max-content_minmax(0,1fr)_max-content] items-baseline gap-x-3 py-2 text-left text-xs hover:bg-[var(--control-hover)]"
            >
              <span className="tabular-nums text-[var(--muted)]">
                {new Date(test.startedAt).toLocaleString(language, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="min-w-0 truncate">
                <span className="font-medium">{customerName ?? t("agentTest.stranger")}</span>
                {" · "}
                <span className="text-[var(--muted-strong)]">
                  {test.summary ?? t("agentTest.noSummary")}
                </span>
              </span>
              <span className="tabular-nums text-[var(--muted)]">
                {[
                  duration(test.durationSec),
                  test.agentVersion !== null
                    ? `v${test.agentVersion}${test.draft ? ` · ${t("voiceDetail.versionDraft")}` : ""}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
            {openId === test.callId && (
              <div className="pb-3">
                <TestResultView
                  result={
                    opened ?? {
                      ready: test.endedAt !== null,
                      turns: [],
                      summary: test.summary,
                      collected: test.collected ?? {},
                      recordingUrl: test.recordingUrl,
                      durationSec: test.durationSec,
                      actions: test.actions,
                    }
                  }
                  draft={test.draft}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
