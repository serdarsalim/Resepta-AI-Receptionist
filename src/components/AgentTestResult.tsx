"use client";

import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { CollectedList } from "./CallDetail";
import { CallRecording } from "./CallRecording";
import { InfoTip } from "./InfoTip";
import { ReviewNotes, type Verdict } from "./ReviewNotes";

// One browser test's result, the same right after a call (the running test's
// open row) and in an opened older row of Test results (Nudge's
// TestResultView): on top what the agent's tools would have done; under it
// the conversation on the left, and on the right the summary, what it heard
// and the owner's note, each a titled box. Below `lg` it stacks,
// conversation first.

export type TestAction = { tool: string; detail: string; ok: boolean; at: number };
export type { Verdict };

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
// separates a nested surface here. Shared with the Notes tab's review page.
export const BOX = "min-w-0 rounded-lg border border-[var(--border)] p-4";
export const BOX_TITLE = "text-xs font-medium text-[var(--foreground)]";

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
  // The test's row, so the note saves onto it, and who signs the note. Null
  // while the test has no row yet, which hides the notes rather than
  // offering a box that cannot save.
  review: {
    testId: Id<"agentTests"> | null;
    note: string | null;
    verdict: Verdict | null;
    noteBy?: string | null;
    noteEditedBy?: string | null;
  };
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
      <WouldDo actions={actions} />

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
            <TranscriptThread
              turns={turns.map((turn) => ({ agent: turn.role === "agent", text: turn.text }))}
              other={t("agentTest.callerRole")}
            />
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
              noteBy={review.noteBy ?? null}
              noteEditedBy={review.noteEditedBy ?? null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// What the agent's tools would have done on a real call: a test books, moves,
// cancels and saves nothing, so this is the whole of its effect. Shared with
// the Notes tab's review of a test.
export function WouldDo({ actions }: { actions: TestAction[] }) {
  const { t } = useLanguage();
  return (
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
  );
}

// The words, as a thread: the agent on the right in our green, the other
// side on the left, the arrangement the call cards and the WhatsApp thread
// use. Drawn here rather than through the call card's transcript, which sits
// on the chat paper: these sit on a card, where the other side's bubble needs
// a wash of the ink rather than the paper's raised white. A test's turns come
// structured; a call's stored transcript goes through the call card's own
// parser first (the Notes tab).
export function TranscriptThread({
  turns,
  other,
  capped = true,
}: {
  turns: { agent: boolean; text: string }[];
  // What the other side is called: "You" on a test, the customer on a call.
  other: string;
  // A scroll of its own, for a column that should not run on.
  capped?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className={`space-y-2 ${capped ? "thin-scroll max-h-[28rem] overflow-y-auto pr-1" : ""}`}>
      {turns.map((turn, index) => (
        <div key={index} className={`flex ${turn.agent ? "justify-end" : "justify-start"}`}>
          <div className="min-w-0 max-w-[80%]">
            <div
              className={`mb-0.5 text-[10px] text-[var(--muted)] ${
                turn.agent ? "text-right" : "text-left"
              }`}
            >
              {turn.agent ? t("agentTest.agentRole") : other}
            </div>
            <div
              className={`whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-xs text-[var(--foreground)] ${
                turn.agent ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-[var(--note-bubble-bg)]"
              }`}
            >
              {turn.text}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// The owner's record of a test: the call card's own Notes (ReviewNotes, one
// component for a call and a test, as in Nudge), with both verdicts always
// showing, since a test is run to get one, and four lines of room.
function TestNotes({
  testId,
  note,
  verdict,
  noteBy,
  noteEditedBy,
}: {
  testId: Id<"agentTests">;
  note: string;
  verdict: Verdict | null;
  noteBy: string | null;
  noteEditedBy: string | null;
}) {
  const { t } = useLanguage();
  const setReview = useMutation(api.agentTests.setReview);
  const signature = [noteBy, noteEditedBy ? t("review.editedBy", { name: noteEditedBy }) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <ReviewNotes
      className={BOX}
      note={note}
      verdict={verdict}
      placeholder={t("agentTest.notesPlaceholder")}
      signature={signature || undefined}
      onSave={(patch) => setReview({ id: testId, ...patch })}
    />
  );
}
