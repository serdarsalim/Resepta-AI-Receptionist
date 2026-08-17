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
  fill = false,
}: {
  transcript: string;
  // Labels the human side. Falls back to a generic "Caller" for a first-time
  // number that has no name on it yet.
  contactName?: string | null;
  // Take the height left in the pane instead of capping at 24rem. For the call
  // tab's detail view, where the transcript IS the page and a box ending
  // two-thirds down leaves a band of empty card under the thing you are
  // reading. The mixed feed keeps the cap: there the transcript is one card
  // among many and a full-height one would bury everything after it.
  fill?: boolean;
}) {
  const { t } = useLanguage();
  const turns = useMemo(() => parseTranscript(transcript), [transcript]);

  if (turns.length === 0) {
    return (
      <pre className={`thin-scroll overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border)] bg-[var(--chat-field)] p-3 font-sans text-xs leading-relaxed ${
        fill ? "min-h-32 flex-1" : "max-h-96"
      }`}>
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
    <div
      // The bubbles sit DIRECTLY on the chat paper — no inner box (Nudge's
      // shape, ported back 2026-08-17). A card here would be a third surface
      // level (paper → card → bubble) and would leave the agent's bubble with
      // nothing to be white against.
      //
      // pr-3 for the scrollbar: the caller's bubbles are right-aligned, so
      // without it they butt straight against the thumb. The left needs no
      // counterpart — the scroller's own left edge already sits inside the
      // pane's padding. min-h so a long summary above can never squeeze this to
      // nothing; it keeps its own scrollbar and a floor.
      className={`thin-scroll space-y-2 overflow-y-auto pr-3 ${
        fill ? "min-h-32 flex-1" : "max-h-96"
      }`}
    >
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
                  // Emerald for OUR side, the same colour and the same weights
                  // the WhatsApp thread gives an outbound message. The agent is
                  // us; the caller is not.
                  //
                  // The caller's bubbles used to be --accent, and --accent is
                  // this app's ACTION colour — Reply, Compose, Send, Place call
                  // are all that blue. Blue meant "click me" and "the customer
                  // said this" on one screen (Serdar, 2026-08-18). Colour now
                  // carries the PARTY and alignment carries the flow, so
                  // neither has to do the other's job.
                  //
                  // --chat-field for the caller, not --card: this sits ON the
                  // chat paper, and --chat-field is the raised surface defined
                  // against it in both themes (white on beige, #242424 on
                  // #0f0f0f).
                  ? "bg-emerald-100 text-[var(--foreground)] dark:bg-emerald-900/30"
                  : "bg-[var(--chat-field)] text-[var(--foreground)]"
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
// "preferred_staff" → "Preferred staff". Done in JS rather than with CSS
// `capitalize` because nested keys are rendered INSIDE a value string, where a
// class on the <dt> cannot reach them — and because `capitalize` would title
// case every word, turning "party size" into "Party Size".
function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === "";

// What the agent heard, as a sentence rather than as storage. `collected` is
// typed `v.any()` because it is whatever Retell's post-call analysis returned,
// so this has to survive shapes nobody designed for.
//
// It used to JSON.stringify anything object-shaped, which put
// `{"after":"18:00","number":"+905338518505"}` — braces, quotes and all — in
// front of a salon owner. Nested values are rare in practice, but "rare" is not
// "never", and the fallback for a shape you did not expect should still be
// READABLE.
//
// Depth is capped rather than recursed freely: past two levels an inline
// rendering stops being clearer than the JSON, so that is where it gives up and
// admits it.
function formatCollected(
  value: unknown,
  t: (key: TranslationKey) => string,
  depth = 0,
): string {
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
  if (Array.isArray(value)) {
    // A list is a list: "Saç kesimi, Boya". Retell returns these for anything
    // the caller could say more than one of.
    return value
      .filter((item) => !isEmpty(item))
      .map((item) => formatCollected(item, t, depth + 1))
      .join(", ");
  }
  if (value !== null && typeof value === "object") {
    if (depth >= 2) return JSON.stringify(value);
    return Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => !isEmpty(nested))
      .map(
        ([nestedKey, nested]) =>
          `${humanizeKey(nestedKey)}: ${formatCollected(nested, t, depth + 1)}`,
      )
      // A middle dot, not a comma: the pairs already contain commas of their
      // own once a nested value is a list.
      .join(" · ");
  }
  return String(value);
}

function CollectedList({ values }: { values: Record<string, unknown> }) {
  const { t } = useLanguage();
  const rows = Object.entries(values)
    .filter(([, value]) => !isEmpty(value))
    // An object or array that held nothing but empties formats to "", which is
    // a label with no answer beside it.
    .map(([key, value]) => [key, formatCollected(value, t)] as const)
    .filter(([, text]) => text !== "");
  if (rows.length === 0) return null;

  return (
    <dl className="space-y-0.5">
      {rows.map(([key, text]) => (
        <div key={key} className="flex gap-2 text-xs">
          <dt className="shrink-0 text-[var(--muted)]">{humanizeKey(key)}:</dt>
          <dd className="min-w-0 break-words">{text}</dd>
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
  // What this call cost the business (calls.billedMicroUsd) — the meter's
  // frozen price, never Retell's own cost. Optional and shown only when
  // non-zero: a $0.00 line on every unanswered call is noise, not billing
  // transparency.
  billedMicroUsd?: number | null;
};

export function CallDetail({
  call,
  contactName,
  className = "",
  fill = false,
}: {
  call: CallDetailItem;
  contactName?: string | null;
  className?: string;
  // Fill the pane: the recording, summary and collected values keep their own
  // height and the TRANSCRIPT takes whatever is left. See CallTranscript.
  fill?: boolean;
}) {
  const { t } = useLanguage();
  const ended = humanizeCallEnd(call.disconnectionReason, t);
  const hasCollected = !!call.collected && Object.keys(call.collected).length > 0;
  const hasAnything =
    !!call.recordingUrl || !!call.summary || !!call.transcript || hasCollected || !!ended;

  if (!hasAnything) {
    return <p className="text-xs text-[var(--muted)]">{t("calls.nothingCaptured")}</p>;
  }

  const billed =
    typeof call.billedMicroUsd === "number" && call.billedMicroUsd > 0
      ? t("calls.billedLine").replace(
          "{amount}",
          `$${(call.billedMicroUsd / 1_000_000).toFixed(2)}`,
        )
      : null;
  const hasArtefact = !!call.summary || !!ended || !!billed || hasCollected;

  return (
    <div
      className={
        fill
          ? `flex min-h-0 flex-1 flex-col gap-3 ${className}`
          : `space-y-3 ${className}`
      }
    >
      {call.recordingUrl && (
        <audio controls src={call.recordingUrl} className="h-9 w-full shrink-0" />
      )}
      {hasArtefact && (
        /* Everything the call PRODUCED, as ONE artefact on the paper: what was
           said in summary, how it ended, what it cost, what it collected. The
           transcript below is the other half — what was actually said. Three
           separate blocks made a reader assemble that themselves.

           --chat-field, not --card: this sits ON the paper, and in dark --card
           IS the card colour (#171717) against a #0f0f0f paper, which is near
           invisible. --chat-field is the raised surface defined against the
           paper in both themes. */
        <div className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--chat-field)] px-2.5 py-2">
          {call.summary && (
            <p className="mb-2 whitespace-pre-wrap text-xs">{call.summary}</p>
          )}
          {/* Under the summary, quiet: on an answered call it is a footnote. On
              an unanswered one it is the only line there is, which is why the
              card renders for it alone. */}
          {ended && <p className="mb-2 text-xs text-[var(--muted)]">{ended}</p>}
          {billed && <p className="mb-2 text-xs text-[var(--muted)]">{billed}</p>}
          {hasCollected && <CollectedList values={call.collected!} />}
        </div>
      )}
      {/* No "Transcript" heading: a column of chat bubbles is self-evidently
          the conversation, and the label was one more line of chrome between
          the summary and the thing you opened the call to read. */}
      {call.transcript && (
        <CallTranscript
          fill={fill}
          transcript={call.transcript}
          contactName={contactName}
        />
      )}
    </div>
  );
}
