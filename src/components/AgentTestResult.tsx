"use client";

import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { CollectedList } from "./CallDetail";
import { CallRecording } from "./CallRecording";
import { InfoTip } from "./InfoTip";

// One browser test's result, the same right after a call (the running test's
// open row) and in an opened older row of Test results (Nudge's
// TestResultView): on top what the agent's tools would have done; under it
// the conversation on the left, and on the right the summary, what it heard
// and the owner's note, each a titled box. Below `lg` it stacks,
// conversation first.

export type TestAction = { tool: string; detail: string; ok: boolean; at: number };
export type Verdict = "pass" | "miss";

export type TestResult = {
  turns: { role: string; text: string }[];
  summary: string | null;
  collected: Record<string, unknown>;
  recordingUrl: string | null;
  durationSec: number | null;
  actions: TestAction[];
};

export const TOOL_LABELS: Record<string, TranslationKey> = {
  book_appointment: "agentTest.toolBook",
  cancel_appointment: "agentTest.toolCancel",
  reschedule_appointment: "agentTest.toolMove",
  save_customer_details: "agentTest.toolSave",
  update_contact: "agentTest.toolSave",
};

// A titled box inside the flat card: a border, never a fill, is what
// separates a nested surface here.
const BOX = "min-w-0 rounded-lg border border-[var(--border)] p-4";
const BOX_TITLE = "text-xs font-medium text-[var(--foreground)]";

// "customer_first_name" → "Customer first name": what the analysis wrote,
// dressed the way the variables are when there is no label to read.
export function dressKey(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

export function AgentTestResult({
  result,
  note,
  review,
}: {
  // Null while the provider is still writing the call up.
  result: TestResult | null;
  // A muted line in place of the conversation while it is not there yet (or
  // never will be).
  note?: string | null;
  // The test's row, so the note saves onto it. Null while the test has no
  // row yet, which hides the notes rather than offering a box that cannot
  // save.
  review: { testId: Id<"agentTests"> | null; note: string | null; verdict: Verdict | null };
}) {
  const { t } = useLanguage();
  const actions = result?.actions ?? [];
  const collected = result?.collected ?? {};
  const heardAnything = Object.values(collected).some(
    (value) => value !== null && value !== undefined && value !== "",
  );
  const turns = result?.turns ?? [];

  return (
    // Side room on both surfaces: the result never runs to the card's edges.
    <div className="space-y-4 px-1 sm:px-4 lg:px-8">
      <section className={BOX}>
        <div className="mb-2 flex items-center gap-1.5">
          <h4 className={BOX_TITLE}>{t("agentTest.wouldDo")}</h4>
          <InfoTip text={t("agentTest.wouldDoHint")} />
        </div>
        {actions.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">{t("agentTest.wouldDoNone")}</p>
        ) : (
          <ul className="space-y-1">
            {actions.map((action) => (
              <li key={action.at + action.tool} className="flex min-w-0 gap-2 text-xs">
                <span className="shrink-0 font-medium">
                  {TOOL_LABELS[action.tool] ? t(TOOL_LABELS[action.tool]) : dressKey(action.tool)}
                </span>
                <span className="min-w-0 break-words text-[var(--foreground)]">{action.detail}</span>
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className={`${BOX} space-y-4`}>
          <h4 className={BOX_TITLE}>{t("agentTest.conversation")}</h4>
          {result?.recordingUrl && (
            <CallRecording
              url={result.recordingUrl}
              durationMs={result.durationSec !== null ? result.durationSec * 1000 : undefined}
            />
          )}
          {turns.length > 0 ? (
            <TestTranscript turns={turns} />
          ) : (
            note && <p className="text-xs text-[var(--muted)]">{note}</p>
          )}
        </section>
        {/* Stays put while the words scroll beside it. */}
        <div className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          {result?.summary && (
            <section className={BOX}>
              <h4 className={`mb-2 ${BOX_TITLE}`}>{t("agentTest.summary")}</h4>
              <p className="text-xs leading-relaxed text-[var(--foreground)]">{result.summary}</p>
            </section>
          )}
          {/* The call card's own list, so a test and a call say what was
              heard the same way (yes and no, lists, nested answers). */}
          {heardAnything && (
            <section className={BOX}>
              <h4 className={`mb-2 ${BOX_TITLE}`}>{t("agentTest.collected")}</h4>
              <CollectedList values={collected} />
            </section>
          )}
          {review.testId && (
            <TestNotes
              key={review.testId}
              testId={review.testId}
              note={review.note ?? ""}
              verdict={review.verdict}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// The words, as a thread: the agent on the right in our green, the person
// testing on the left, the arrangement the call cards and the WhatsApp
// thread use. Drawn here rather than through the call card's transcript,
// which parses a stored string and sits on the chat paper: these turns come
// structured, and they sit on the card, where the caller's bubble needs a
// wash of the ink rather than the paper's raised white.
function TestTranscript({ turns }: { turns: { role: string; text: string }[] }) {
  const { t } = useLanguage();
  return (
    <div className="thin-scroll max-h-[28rem] space-y-2 overflow-y-auto pr-1">
      {turns.map((turn, index) => {
        const agent = turn.role === "agent";
        return (
          <div key={index} className={`flex ${agent ? "justify-end" : "justify-start"}`}>
            <div className="min-w-0 max-w-[80%]">
              <div
                className={`mb-0.5 text-[10px] text-[var(--muted)] ${
                  agent ? "text-right" : "text-left"
                }`}
              >
                {agent ? t("agentTest.agentRole") : t("agentTest.callerRole")}
              </div>
              <div
                className={`whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-xs text-[var(--foreground)] ${
                  agent
                    ? "bg-emerald-100 dark:bg-emerald-900/30"
                    : "bg-[var(--note-bubble-bg)]"
                }`}
              >
                {turn.text}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ONE look for a verdict: a compact chip, green for pass and red for miss
// once picked (Nudge's ReviewNotes).
const VERDICT_BOX =
  "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4";
const VERDICT_TONE: Record<Verdict, string> = {
  pass: "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400",
  miss: "border-red-200 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400",
};

// The owner's record of a test: what should have happened, in their words,
// and a verdict. Autosaved on blur and on every verdict click, with the
// house Saving…/Saved word; no Save button. Free text on purpose: the boxes
// beside it already carry what the agent actually did.
function TestNotes({
  testId,
  note,
  verdict,
}: {
  testId: Id<"agentTests">;
  note: string;
  verdict: Verdict | null;
}) {
  const { t } = useLanguage();
  const setReview = useMutation(api.agentTests.setReview);
  const [text, setText] = useState(note);
  const [saved, setSaved] = useState(note);
  const [chosen, setChosen] = useState<Verdict | null>(verdict);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  // A note that CHANGES on the server after mount wins over an untouched
  // box, never over one being typed in. A change of the prop, not a
  // difference from what was saved: the running test's row only learns its
  // note from the list, and comparing against an empty prop wiped the box
  // the moment a note was saved (Nudge, 2026-09-20).
  const [seenProp, setSeenProp] = useState(note);
  useEffect(() => {
    if (note === seenProp) return;
    setSeenProp(note);
    if (text === saved) {
      setText(note);
      setSaved(note);
    }
  }, [note, seenProp, text, saved]);
  useEffect(() => setChosen(verdict), [verdict]);

  const persist = async (patch: { note?: string; verdict?: Verdict | null }) => {
    setState("saving");
    try {
      await setReview({ id: testId, ...patch });
      if (patch.note !== undefined) setSaved(patch.note);
      setState("saved");
    } catch {
      setState("idle");
    }
  };

  return (
    <section className={BOX}>
      <div className="mb-2 flex items-center gap-2">
        <h4 className={BOX_TITLE}>{t("agentTest.notes")}</h4>
        <div className="ml-auto flex items-center gap-3">
          {state !== "idle" && (
            <span
              className={`text-xs ${
                state === "saving"
                  ? "animate-pulse text-[var(--muted)]"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {state === "saving" ? t("common.saving") : t("common.saved")}
            </span>
          )}
          <div role="group" aria-label={t("agentTest.verdict")} className="flex items-center gap-1.5">
            {(["pass", "miss"] as const).map((value) => {
              const on = chosen === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? null : value;
                    setChosen(next);
                    void persist({ verdict: next });
                  }}
                  className={`${VERDICT_BOX} cursor-pointer transition-colors ${
                    on
                      ? VERDICT_TONE[value]
                      : "border-[var(--border)] text-[var(--muted-strong)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {value === "pass" ? t("agentTest.pass") : t("agentTest.miss")}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {/* The box IS the field: no second border inside the first. */}
      <AutoGrowTextarea
        value={text}
        rows={4}
        placeholder={t("agentTest.notesPlaceholder")}
        aria-label={t("agentTest.notes")}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== saved) void persist({ note: text });
        }}
        className="block w-full border-0 bg-transparent p-0 text-xs leading-5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none"
      />
    </section>
  );
}
