"use client";

import { useState } from "react";

// A short list of words as removable pills, and a dashed "+ Add" pill that
// turns into an input where it stands. Ported from Nudge's TagPillsEditor
// (2026-10-13) for the list field's options on the Business page, which were
// Resepta's copy of Nudge's older editor: the pills plus an input and an Add
// button parked under them on every visit. That is the permanent empty field
// AGENTS.md's rule 2 forbids; here the field appears when you mean it.
//
// Enter adds and keeps the input open for the next one; blur adds what was
// typed and closes, so a click elsewhere does not eat a word; Escape drops
// it. A word already in the list, in any casing, is not added twice. The
// whole array goes back through onChange, so the caller decides where it
// lands.
//
// Nudge's also suggests from a shared tag library, renames in place, protects
// some values and reorders by drag. Resepta has no tag vocabulary yet, and an
// option renamed in place would strand every customer already holding the old
// word, so those wait for a surface that needs them.
export function TagPillsEditor({
  values,
  onChange,
  copy,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  copy: {
    // The dashed pill's words, "+ Add option".
    add: string;
    placeholder: string;
    remove: (value: string) => string;
  };
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const value = raw.trim();
    setDraft("");
    if (!value) return;
    if (values.some((v) => v.toLocaleLowerCase() === value.toLocaleLowerCase())) return;
    onChange([...values, value]);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {values.map((value) => (
        // --card, not Nudge's --muted-bg: the options open in a table row
        // that is --muted-bg itself, where a pill of the same colour would be
        // an outline with words in it.
        <span
          key={value}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 text-sm"
        >
          {value}
          <button
            type="button"
            onClick={() => onChange(values.filter((v) => v !== value))}
            aria-label={copy.remove(value)}
            className="-mr-0.5 rounded-full p-0.5 text-[var(--muted)] transition-colors hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              add(draft);
            } else if (event.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
          }}
          onBlur={() => {
            add(draft);
            setAdding(false);
          }}
          placeholder={copy.placeholder}
          aria-label={copy.placeholder}
          // py-0: the base layer pads every input 0.5rem, which inside h-7
          // left no room for the line.
          className="h-7 w-auto min-w-[140px] rounded-full border border-[var(--accent)] bg-[var(--background)] px-2.5 py-0 text-sm outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-7 items-center rounded-full border border-dashed border-[var(--border)] px-2.5 text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--foreground)]"
        >
          {copy.add}
        </button>
      )}
    </div>
  );
}
