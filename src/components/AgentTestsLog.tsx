"use client";

import { useAction, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { InfoTip } from "./InfoTip";
import { AgentTestResult, type TestResult, type Verdict } from "./AgentTestResult";
import { VerdictMark } from "./ReviewNotes";

// Test results: the agent's browser tests, newest first (P9; Nudge's
// AgentTestsCard). One line each: who it called as, which way, which
// version, how long, when. Opening a line fetches its words from the
// provider (agentTests rows hold the summary and what the tools would have
// done, never the transcript). No summary on a closed line: there will be a
// lot of tests, and the summary is the first thing an opened one shows.
//
// The test being run now is this list's open TOP ROW, not a card of its own
// (Nudge, 2026-10-11). The panel that runs the call hands its state in as
// `current`; the row is open until you close it, and becomes an ordinary
// row the moment the next test starts.
//
// Hidden until there is a test: an empty log is a heading over nothing.

export type CurrentTest = {
  // Null until the server has written the test's row.
  testId: Id<"agentTests"> | null;
  who: string;
  // Live / Ended, beside the row's facts.
  status: ReactNode;
  // What the open row shows: the live note while the call is up, the result
  // once it has ended. Handed the row's saved review so the notes open on it.
  body: (review: {
    note: string | null;
    verdict: Verdict | null;
    noteBy: string | null;
    noteEditedBy: string | null;
  }) => ReactNode;
};

type Fetched = TestResult | "loading" | "failed";

// The agent page's pane card, shared by Setup and both Testing cards so the
// two tabs read as one page.
export const AGENT_PANE_CARD = "card-raised p-5";

// The whole row is the disclosure: a hand and a hover fill, so it reads as
// something that opens.
const CHEVRON_ROW =
  "-mx-2 flex w-[calc(100%+1rem)] cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 text-left text-xs hover:bg-[var(--row-hover-bg)]";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 text-[var(--muted-strong)] transition-transform ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function duration(seconds: number | null): string {
  if (seconds === null) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AgentTestsLog({
  agentId,
  current,
  className = "",
}: {
  agentId: string;
  current?: CurrentTest | null;
  className?: string;
}) {
  const { t, language } = useLanguage();
  const rows = useQuery(api.agentTests.listForAgent, { retellAgentId: agentId });
  const readResult = useAction(api.retellAgent.browserTestResult);
  const [openId, setOpenId] = useState<Id<"agentTests"> | null>(null);
  const [fetched, setFetched] = useState<Record<string, Fetched>>({});
  // The current test's row is open by default; this remembers that you
  // closed it, for that test only.
  const [closedCurrent, setClosedCurrent] = useState<string | null>(null);

  const list = rows ?? [];
  if (list.length === 0 && !current) return null;
  const currentKey = current ? (current.testId ?? "pending") : null;
  const currentOpen = !!current && closedCurrent !== currentKey;
  const currentRow = current?.testId
    ? list.find((row) => row.test._id === current.testId)
    : undefined;
  const others = currentRow ? list.filter((row) => row !== currentRow) : list;

  const stamp = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const whoOf = (customerName: string | null, direction: "inbound" | "outbound") =>
    customerName ??
    (direction === "inbound" ? t("agentTest.unknownCaller") : t("agentTest.coldCall"));
  const directionOf = (direction: "inbound" | "outbound") =>
    direction === "inbound" ? t("agentTest.rowInbound") : t("agentTest.rowOutbound");
  const versionOf = (version: number | null, draft: boolean) =>
    version === null ? null : draft ? t("agentTest.versionDraft", { n: version }) : `v${version}`;

  const toggle = (id: Id<"agentTests">, callId: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    // Fetched once per row and kept: reopening a row is free.
    if (fetched[id] === undefined || fetched[id] === "failed") {
      setFetched((all) => ({ ...all, [id]: "loading" }));
      void readResult({ callId })
        .then((result) => setFetched((all) => ({ ...all, [id]: result })))
        .catch(() => setFetched((all) => ({ ...all, [id]: "failed" })));
    }
  };

  return (
    <section className={`${AGENT_PANE_CARD} ${className}`}>
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">{t("agentTest.history")}</h3>
        <InfoTip text={t("agentTest.historyHint")} />
        <span className="ml-1 text-xs tabular-nums text-[var(--muted)]">
          {others.length + (current ? 1 : 0)}
        </span>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {current && (
          <li className="py-2.5">
            <button
              type="button"
              onClick={() => setClosedCurrent(currentOpen ? currentKey : null)}
              aria-expanded={currentOpen}
              className={CHEVRON_ROW}
            >
              <span className="text-[var(--foreground)]">
                {currentRow?.customerName ?? current.who}
              </span>
              {currentRow && (
                <span className="text-[var(--foreground)]">
                  {directionOf(currentRow.test.direction)}
                </span>
              )}
              {current.status}
              {currentRow && (
                <span className="ml-auto text-[var(--muted)]">
                  {stamp.format(currentRow.test.startedAt)}
                </span>
              )}
              <span className={currentRow ? "" : "ml-auto"}>
                <Chevron open={currentOpen} />
              </span>
              <span className="sr-only">
                {currentOpen ? t("agentTest.hide") : t("agentTest.open")}
              </span>
            </button>
            {currentOpen && (
              <div className="mt-3">
                {current.body({
                  note: currentRow?.test.note ?? null,
                  verdict: currentRow?.test.verdict ?? null,
                  noteBy: currentRow?.noteBy ?? null,
                  noteEditedBy: currentRow?.noteEditedBy ?? null,
                })}
              </div>
            )}
          </li>
        )}
        {others.map(({ test, customerName, noteBy, noteEditedBy }) => {
          const open = openId === test._id;
          const got = fetched[test._id];
          const loaded = typeof got === "object" ? got : null;
          // The stored fields win where they exist; the fetch brings the
          // words, and fills in a row opened before its completion landed.
          const result: TestResult = {
            turns: loaded?.turns ?? [],
            summary: test.summary ?? loaded?.summary ?? null,
            collected: test.collected ?? loaded?.collected ?? {},
            recordingUrl: test.recordingUrl ?? loaded?.recordingUrl ?? null,
            durationSec: test.durationSec ?? loaded?.durationSec ?? null,
            actions: loaded?.actions ?? test.actions,
          };
          const version = versionOf(test.agentVersion, test.draft);
          return (
            <li key={test._id} className="py-2.5">
              <button
                type="button"
                onClick={() => toggle(test._id, test.callId)}
                aria-expanded={open}
                className={CHEVRON_ROW}
              >
                {/* Row data is READ, so it is --foreground; only the
                    timestamp steps down. */}
                <span className="text-[var(--foreground)]">
                  {whoOf(customerName, test.direction)}
                </span>
                <span className="text-[var(--foreground)]">{directionOf(test.direction)}</span>
                {version && <span className="text-[var(--foreground)]">{version}</span>}
                {duration(result.durationSec) && (
                  <span className="tabular-nums text-[var(--foreground)]">
                    {duration(result.durationSec)}
                  </span>
                )}
                {test.verdict && <VerdictMark verdict={test.verdict} />}
                <span className="ml-auto text-[var(--muted)]">{stamp.format(test.startedAt)}</span>
                <Chevron open={open} />
                <span className="sr-only">{open ? t("agentTest.hide") : t("agentTest.open")}</span>
              </button>
              {open && (
                <div className="mt-3">
                  <AgentTestResult
                    result={result}
                    note={
                      got === "loading"
                        ? t("agentTest.loadingWords")
                        : got === "failed" || (loaded && loaded.turns.length === 0)
                          ? t("agentTest.noWords")
                          : null
                    }
                    review={{
                      testId: test._id,
                      note: test.note,
                      verdict: test.verdict,
                      noteBy,
                      noteEditedBy,
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
