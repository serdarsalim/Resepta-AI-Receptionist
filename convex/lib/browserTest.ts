// Recognising a browser test of a voice agent and reading its facts (P8 of
// the Nudge port). Shared by the two places a finished test arrives: the
// post-call webhook (http.ts /retell/call-ended) and the transcript poll
// (retellAgent.browserTestResult).
//
// The marker rides the web call's metadata, which only we set (create-web-call
// with the platform key) and which the provider signs back to us. It is still
// never trusted alone: the agentTests row for the call id, in the agent's own
// org, is what makes a call a test (agentTests.testOfCall), and a marked call
// with no row is answered as a test with nobody on the line, never as a real
// call.

import { withoutNonAnswers } from "./nonAnswer";
import { CALLBACK_TIME_FIELD, NO_AI_CALLS_FIELD, VOICE_SUMMARY_FIELD } from "./voiceAgentTemplate";

export const BROWSER_TEST_MARKER = "resepta_browser_test";
// Who placed a call by hand (P11): a user id in the dial's metadata, kept by
// recordCall only for a member of the call's org.
export const PLACED_BY_MARKER = "resepta_placed_by";

export function placedByOf(call: Record<string, unknown>): string | undefined {
  const metadata = call.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>)[PLACED_BY_MARKER];
  return typeof value === "string" && value ? value : undefined;
}

export function isBrowserTestCall(call: Record<string, unknown>): boolean {
  const metadata = call.metadata;
  return (
    !!metadata &&
    typeof metadata === "object" &&
    (metadata as Record<string, unknown>)[BROWSER_TEST_MARKER] === true
  );
}

export type BrowserTestFacts = {
  endedAt?: number;
  durationSec?: number;
  outcome?: string;
  summary?: string;
  collected?: Record<string, unknown>;
  recordingUrl?: string;
  disconnectionReason?: string;
  retellCostMicroUsd?: number;
};

// The same split voiceEvents.process makes for a real call: our summary and
// the no-AI-calls flag and the callback time lifted out of the analysis bag, non-answers dropped,
// live values over inferred ones, the price in micro-USD.
export function browserTestFacts(call: Record<string, unknown>): BrowserTestFacts {
  const analysis = (call.call_analysis ?? {}) as Record<string, unknown>;
  const startedAt = Number(call.start_timestamp ?? 0);
  const endedAt = Number(call.end_timestamp ?? 0);
  const after = {
    ...((analysis.custom_analysis_data as Record<string, unknown> | undefined) ?? {}),
  };
  const summary = String(after[VOICE_SUMMARY_FIELD] ?? "") || String(analysis.call_summary ?? "");
  delete after[VOICE_SUMMARY_FIELD];
  delete after[NO_AI_CALLS_FIELD];
  // A test queues nothing, so a callback the caller asked for is not an
  // answer to show among the collected values either (P36).
  delete after[CALLBACK_TIME_FIELD];
  const during =
    (call.collected_dynamic_variables as Record<string, unknown> | undefined) ?? {};
  const collected = { ...withoutNonAnswers(after), ...withoutNonAnswers(during) };
  const costCents = Number(((call.call_cost ?? {}) as Record<string, unknown>).combined_cost);
  return {
    ...(endedAt > 0 ? { endedAt } : {}),
    ...(endedAt > startedAt && startedAt > 0
      ? { durationSec: Math.round((endedAt - startedAt) / 1000) }
      : {}),
    ...(analysis.call_successful !== undefined
      ? { outcome: String(analysis.call_successful) }
      : {}),
    ...(summary ? { summary } : {}),
    ...(Object.keys(collected).length > 0 ? { collected } : {}),
    ...(call.recording_url ? { recordingUrl: String(call.recording_url) } : {}),
    ...(call.disconnection_reason
      ? { disconnectionReason: String(call.disconnection_reason) }
      : {}),
    ...(Number.isFinite(costCents) ? { retellCostMicroUsd: Math.round(costCents * 10_000) } : {}),
  };
}
