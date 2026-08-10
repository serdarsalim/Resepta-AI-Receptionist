"use client";

import { useMemo } from "react";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";

// One opened call, everywhere a call is opened: Voice → Calls, the contact
// feed's expanded Calls column, and the mixed feed's card. Three screens used
// to render three different subsets of the same row — the feed showed a
// transcript blob with no collected values, Voice → Calls showed collected
// values as chips with no speaker labels — so "where do I look" had a
// different answer depending on how you got there. It is one component now.
//
// The order is the order you read a call in: hear it, then what it produced,
// then why it ended, then what was actually said. Summary before transcript
// because the summary is right most of the time; the transcript is what you
// drop to when it isn't.

// Retell's disconnect codes. Anything not listed falls back to de-underscored
// raw text rather than disappearing — a code we haven't met yet still explains
// more than a blank row does.
const END_REASON_KEYS: Record<string, TranslationKey> = {
  agent_hangup: "calls.end.agent_hangup",
  user_hangup: "calls.end.user_hangup",
  dial_no_answer: "calls.end.dial_no_answer",
  dial_busy: "calls.end.dial_busy",
  dial_failed: "calls.end.dial_failed",
  voicemail_reached: "calls.end.voicemail_reached",
  call_transfer: "calls.end.call_transfer",
  inactivity: "calls.end.inactivity",
  machine_detected: "calls.end.machine_detected",
  max_duration_reached: "calls.end.max_duration_reached",
  concurrency_limit_reached: "calls.end.concurrency_limit_reached",
  error: "calls.end.error",
};

export function humanizeCallEnd(
  code: string | null | undefined,
  t: (key: TranslationKey) => string,
): string | null {
  if (!code) return null;
  const key = END_REASON_KEYS[code];
  return key ? t(key) : code.replace(/_/g, " ");
}

// ── Outcome ──────────────────────────────────────────────────────────────────

// Retell reports `call_successful` as a boolean, and it reached the table as
// the literal strings "true" and "false" — a raw field name leaking into a
// salon owner's screen. Green when the agent got what it called for, amber
// when it didn't; amber rather than red because an unsuccessful call is a
// normal outcome, not a fault.
export function CallOutcomePill({ outcome }: { outcome: string | null | undefined }) {
  const { t } = useLanguage();
  if (!outcome) return null;
  const successful = outcome === "true" ? true : outcome === "false" ? false : null;
  const label =
    successful === true
      ? t("calls.successful")
      : successful === false
        ? t("calls.unsuccessful")
        : outcome;
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        successful === true
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : successful === false
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            : "border border-[var(--border)] text-[var(--muted)]"
      }`}
    >
      {label}
    </span>
  );
}

// ── Transcript ───────────────────────────────────────────────────────────────

type Turn = { agent: boolean; text: string };

// Retell hands us the transcript as one string, speaker-prefixed per line:
//   Agent: Hi Mandy, this is Grace…
//   User: I did. Yeah.
// We already store that string on the call row, so the chat view is a parse,
// not a second API call — it works for every call ever recorded, including the
// ones from before this view existed.
//
// The labels are NOT always English — a Turkish call comes back "Ajan:" /
// "Müşteri:". So this doesn't match on a word list. It reads whatever labels
// the transcript actually uses, then decides which one is the agent: the known
// agent words in any language Resepta speaks, and failing that the label that
// speaks FIRST, because the agent always opens the call. Getting that backwards
// only mirrors the layout, which is recoverable; refusing to parse at all is
// the wall of grey text this replaced.
const LABELLED_LINE = /^\s*([\p{L}][\p{L} .'-]{0,24}?)\s*:\s+(?=\S)/u;
const AGENT_WORDS = /^(agent|assistant|bot|ai|ajan|asistan|assistent)$/i;

export function parseTranscript(raw: string): Turn[] {
  const lines: Array<{ label: string; text: string }> = [];
  for (const line of raw.split("\n")) {
    const match = line.match(LABELLED_LINE);
    if (match) {
      lines.push({ label: match[1].trim(), text: line.slice(match[0].length).trim() });
      continue;
    }
    const text = line.trim();
    if (!text) continue;
    // A transcript that never labels a speaker is not a conversation we can
    // lay out — the caller renders it as plain text instead.
    if (lines.length === 0) return [];
    // Retell wraps long turns, so an unlabelled line continues the last one.
    lines[lines.length - 1].text += `\n${text}`;
  }

  const labels = [...new Set(lines.map((line) => line.label.toLocaleLowerCase()))];
  // Three or more speakers is not a two-sided call — more likely a transcript
  // whose content happens to contain colons. Don't force it into bubbles.
  if (labels.length === 0 || labels.length > 2) return [];
  const agentLabel =
    labels.find((label) => AGENT_WORDS.test(label)) ??
    (labels.length === 2 ? lines[0].label.toLocaleLowerCase() : null);

  return lines
    .filter((line) => line.text.length > 0)
    .map((line) => ({
      agent: line.label.toLocaleLowerCase() === agentLabel,
      text: line.text,
    }));
}

export function CallTranscript({
  transcript,
  contactName,
}: {
  transcript: string;
  // Labels the human side. Falls back to a generic "Caller" for a first-time
  // number that has no name on it yet.
  contactName?: string | null;
}) {
  const { t } = useLanguage();
  const turns = useMemo(() => parseTranscript(transcript), [transcript]);

  if (turns.length === 0) {
    return (
      <pre className="thin-scroll max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 font-sans text-xs leading-relaxed">
        {transcript}
      </pre>
    );
  }

  // Agent left, customer right — the same read as any messaging thread, so
  // who-said-what needs no legend. It also matches the WhatsApp panel this app
  // already has, which is where an owner's eye is trained.
  //
  // The whole thread sits on its own white card. Loose on the expanded row's
  // grey it read as text scattered across the page rather than one artefact
  // you can scroll — and it gives the agent's grey bubbles something to be
  // grey against.
  return (
    <div className="thin-scroll max-h-96 space-y-2 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
      {turns.map((turn, i) => (
        <div key={i} className={`flex ${turn.agent ? "justify-start" : "justify-end"}`}>
          <div className="min-w-0 max-w-[80%]">
            <div
              className={`mb-0.5 text-[10px] text-[var(--muted)] ${
                turn.agent ? "text-left" : "text-right"
              }`}
            >
              {turn.agent ? t("calls.agent") : contactName || t("calls.theCaller")}
            </div>
            <div
              className={`whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-xs ${
                turn.agent
                  ? "bg-[var(--pane)] text-[var(--foreground)]"
                  : "bg-[var(--accent)] text-[var(--accent-fg)]"
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

// ── Collected values ─────────────────────────────────────────────────────────

// Chips lost the pairing: "room type · triple room" reads as two tags, and a
// long value wrapped into a shape that no longer looked attached to its label.
// A definition list keeps label and answer on one line and lets the values
// left-align down the column, which is how you scan eight of them.
function CollectedList({ values }: { values: Record<string, unknown> }) {
  const { t } = useLanguage();
  const rows = Object.entries(values).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  if (rows.length === 0) return null;

  return (
    <dl className="space-y-0.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2">
      {rows.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-xs">
          <dt className="shrink-0 capitalize text-[var(--muted)]">
            {key.replace(/_/g, " ")}:
          </dt>
          <dd className="min-w-0 break-words">
            {typeof value === "boolean"
              ? value
                ? t("common.yes")
                : t("common.no")
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ── The call ─────────────────────────────────────────────────────────────────

export type CallDetailItem = {
  summary?: string | null;
  transcript?: string | null;
  recordingUrl?: string | null;
  collected?: Record<string, unknown> | null;
  disconnectionReason?: string | null;
};

export function CallDetail({
  call,
  contactName,
  className = "",
}: {
  call: CallDetailItem;
  contactName?: string | null;
  className?: string;
}) {
  const { t } = useLanguage();
  const ended = humanizeCallEnd(call.disconnectionReason, t);
  const hasCollected = !!call.collected && Object.keys(call.collected).length > 0;
  const hasAnything =
    !!call.recordingUrl || !!call.summary || !!call.transcript || hasCollected || !!ended;

  if (!hasAnything) {
    return <p className="text-xs text-[var(--muted)]">{t("calls.nothingCaptured")}</p>;
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {call.recordingUrl && (
        <audio controls src={call.recordingUrl} className="h-9 w-full" />
      )}
      {call.summary && <p className="whitespace-pre-wrap text-sm">{call.summary}</p>}
      {/* Under the summary, quiet: on an answered call it is a footnote. On an
          unanswered one it is the only line there is, which is why it renders
          even when nothing else does. */}
      {ended && <p className="text-xs text-[var(--muted)]">{ended}</p>}
      {hasCollected && <CollectedList values={call.collected!} />}
      {call.transcript && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-[var(--muted)]">
            {t("calls.transcript")}
          </div>
          <CallTranscript transcript={call.transcript} contactName={contactName} />
        </div>
      )}
    </div>
  );
}
