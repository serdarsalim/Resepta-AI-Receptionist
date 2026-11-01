"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/LanguageProvider";
import { AutoGrowTextarea } from "./AutoGrowTextarea";

// A team's record of one call: what they make of it, in their own words, and
// a verdict, Pass (the agent handled it) or Miss (it got something wrong).
// Nudge's ReviewNotes, ported 2026-10-21 for the call cards
// (ConversationPanel), where the note is one per call and shared by the
// business (calls.setReview). Written as Nudge wrote it, so a browser test can
// take the same component: the Testing tab there shows the pair at all times,
// a call only while the note is open.
//
// Autosaved on blur and on every verdict click, with Saving… and a green
// Saved at the far right of the title row; no Save button. Free text on
// purpose: structured expectations per field would turn reviewing into
// form-filling, and the card around it already carries the actual values.

export type Verdict = "pass" | "miss";

// ONE look for a verdict, picked or read: a compact chip (Nudge: "more
// compact, not that high"), in the tones of the call card's own status pill
// so the two read as one family. Unpicked it is a word on a hover wash with
// no border (a border belongs to containers here, never to a button); the
// transparent border keeps the two states the same size, so picking one moves
// nothing.
const VERDICT_CHIP =
  "inline-flex h-5 shrink-0 items-center rounded-full border border-transparent px-2 text-[11px] font-medium leading-4";
const VERDICT_TONE: Record<Verdict, string> = {
  pass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  miss: "bg-red-500/15 text-red-700 dark:text-red-400",
};

// A verdict to read, not to set: the Inbox's All index marks a reviewed call
// with it.
export function VerdictMark({ verdict }: { verdict: Verdict }) {
  const { t } = useLanguage();
  return (
    <span className={`${VERDICT_CHIP} ${VERDICT_TONE[verdict]}`}>
      {verdict === "pass" ? t("review.pass") : t("review.miss")}
    </span>
  );
}

export function ReviewNotes({
  note,
  verdict,
  onSave,
  placeholder,
  signature,
  signatureTitle,
  className = "",
  verdictOnFocus = false,
}: {
  note: string;
  verdict: Verdict | null;
  onSave: (patch: { note?: string; verdict?: Verdict | null }) => Promise<unknown>;
  placeholder?: string;
  // Who wrote it ("Ayşe · edited by Serdar"), at the right end of the title
  // row whenever nothing is being saved there. On the title row rather than
  // under the note, so its arrival after a save moves nothing below it.
  signature?: string;
  // The same slot's hover: when it last changed.
  signatureTitle?: string;
  className?: string;
  // A real call: both verdicts only while the note is open, just the one
  // picked otherwise, and optional (Nudge, 2026-10-08). Most calls are never
  // reviewed, and a Pass/Miss pair on every card read as if each one owed a
  // verdict; a note with neither picked is a plain comment, which is the
  // third answer without a third button.
  verdictOnFocus?: boolean;
}) {
  const { t } = useLanguage();
  const sectionRef = useRef<HTMLElement>(null);
  const [text, setText] = useState(note);
  const [saved, setSaved] = useState(note);
  const [chosen, setChosen] = useState<Verdict | null>(verdict);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  // Focus anywhere in the box (the field or a verdict). On a call the pair
  // shows only while you are in here; at rest, just the verdict picked.
  const [editing, setEditing] = useState(false);
  // A note that CHANGES on the server after mount (a teammate saved one, or
  // the server trimmed ours) wins over an untouched box, never over one being
  // typed in. It has to be a change of the prop, not a difference from what
  // was saved, or a box would be wiped the moment its own save landed (Nudge,
  // 2026-09-20).
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
  // "Saved" is confirmation, not a label: it gives the slot back to the
  // signature, which by then names the latest writer.
  useEffect(() => {
    if (state !== "saved") return;
    const timer = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const persist = async (patch: { note?: string; verdict?: Verdict | null }) => {
    setState("saving");
    try {
      await onSave(patch);
      if (patch.note !== undefined) setSaved(patch.note);
      setState("saved");
    } catch {
      // Said, in red, until the next try. A note still differs from what was
      // saved, so leaving the field again tries again.
      setState("failed");
    }
  };

  const shownVerdicts = (["pass", "miss"] as const).filter(
    (v) => !verdictOnFocus || editing || chosen === v,
  );
  const verdictButtons = shownVerdicts.length > 0 && (
    <div className="flex items-center gap-1" role="group" aria-label={t("review.verdict")}>
      {shownVerdicts.map((v) => {
        const on = chosen === v;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            // Keep focus in the field: a blur would hide the pair on a call
            // before the click landed.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              // At rest a call shows only the verdict picked. A click on it
              // opens the review, with both verdicts, rather than taking the
              // verdict back without a word.
              if (verdictOnFocus && !editing) {
                sectionRef.current?.querySelector("textarea")?.focus();
                return;
              }
              const next = on ? null : v;
              setChosen(next);
              void persist({ verdict: next });
            }}
            className={`${VERDICT_CHIP} cursor-pointer transition-colors ${
              on
                ? VERDICT_TONE[v]
                : "text-[var(--muted-strong)] hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]"
            }`}
          >
            {v === "pass" ? t("review.pass") : t("review.miss")}
          </button>
        );
      })}
    </div>
  );

  // The title row's right end: what the box is doing, else who wrote it.
  const status =
    state === "saving" ? (
      <span className="shrink-0 animate-pulse text-xs text-[var(--muted)]">{t("common.saving")}</span>
    ) : state === "saved" ? (
      <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">
        {t("common.saved")}
      </span>
    ) : state === "failed" ? (
      <span className="shrink-0 text-xs text-red-600 dark:text-red-400">{t("review.notSaved")}</span>
    ) : signature ? (
      <span className="min-w-0 truncate text-[11px] text-[var(--muted)]" title={signatureTitle}>
        {signature}
      </span>
    ) : null;

  return (
    <section
      ref={sectionRef}
      className={className}
      onFocus={() => setEditing(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditing(false);
      }}
    >
      {/* On a call the pair sits on this row, after the title, and the row
          holds the chips' height (h-6) even while they are hidden, so
          clicking into the note moves nothing. */}
      <div className={`mb-2 flex items-center gap-2 ${verdictOnFocus ? "h-6" : ""}`}>
        <h4 className="shrink-0 text-xs font-medium text-[var(--foreground)]">
          {t("review.title")}
        </h4>
        {verdictOnFocus && verdictButtons}
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {status}
          {!verdictOnFocus && verdictButtons}
        </div>
      </div>
      {/* The box IS the field: no second border inside the panel it sits in
          (a field in a card in a card read as "a tiny input field"), the text
          at rest on the panel's own surface, room for a sentence before it
          grows. */}
      <AutoGrowTextarea
        value={text}
        // Two lines on a call: most notes are a sentence, and the card stays
        // short; it grows as you type. A test keeps four, where the note is
        // the main thing written.
        rows={verdictOnFocus ? 2 : 4}
        placeholder={placeholder ?? t("review.placeholder")}
        aria-label={t("review.title")}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== saved) void persist({ note: text });
        }}
        className="block w-full rounded-none border-0 bg-transparent p-0 text-xs leading-5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none"
      />
    </section>
  );
}
