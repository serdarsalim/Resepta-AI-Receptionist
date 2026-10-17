"use client";

// The list that drops out of an "@" (P15, the Nudge port). One component for
// every editor that has one, the plain-text token field and the email body
// editor, so the two cannot match on different things or group differently.
// Each host owns only the part it cannot share: where its caret is.

import { createPortal } from "react-dom";
import { foldSearch } from "@/lib/useTableState";
import { AT_MENU_W } from "@/lib/caretPosition";
import type { TokenVariable } from "@/lib/tokenLabels";

// Matched against the label, the raw key, and the key with its underscores
// gone, so the words you are reading are typeable as you read them. A label
// may contain spaces, so the fragment does not end at one: "@randevu tar" has
// to keep matching "Randevu tarihi".
export function matchTokenVariables(
  variables: TokenVariable[],
  fragment: string,
): TokenVariable[] {
  const f = foldSearch(fragment.trim());
  return variables
    .filter(
      (v) =>
        !f ||
        foldSearch(v.label).includes(f) ||
        foldSearch(v.key).includes(f) ||
        foldSearch(v.key.replace(/_/g, "")).includes(f),
    )
    .slice(0, 10);
}

// Everything after an "@" at a word boundary, up to the caret, or null when
// what is there is not a pick. A newline or a bracket closes it, a mid-word
// "@" is an email address, and "@ " with nothing but blanks after it closes
// too, or "write to me @ work" drops the list open mid-sentence.
export function atFragment(before: string): { start: number; fragment: string } | null {
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const fragment = before.slice(at + 1);
  if (/[\n{}[\]]/.test(fragment)) return null;
  if (fragment.length > 0 && !fragment.trim()) return null;
  if (fragment.length > 40) return null;
  if (at > 0 && /\S/.test(before[at - 1])) return null;
  return { start: at, fragment };
}

export function TokenSuggestMenu({
  anchor,
  matches,
  active,
  onPick,
  onHover,
}: {
  anchor: { left: number; top: number };
  matches: TokenVariable[];
  active: number;
  onPick: (v: TokenVariable) => void;
  onHover: (i: number) => void;
}) {
  if (matches.length === 0 || typeof document === "undefined") return null;
  // Portalled and fixed, like every anchored menu here: these editors sit
  // inside overflow-hidden cards. onMouseDown (not onClick) because the
  // field's own blur closes the menu first otherwise, and the click then
  // lands on nothing.
  return createPortal(
    <ul
      style={{
        position: "fixed",
        left: anchor.left,
        top: anchor.top,
        width: AT_MENU_W,
        zIndex: 60,
      }}
      className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 text-xs shadow-lg"
    >
      {matches.map((v, i) => (
        <li key={v.key}>
          {/* A heading only where the group CHANGES. */}
          {v.group && v.group !== matches[i - 1]?.group && (
            <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
              {v.group}
            </div>
          )}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(v);
            }}
            onMouseEnter={() => onHover(i)}
            className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left ${
              i === active ? "bg-[var(--row-hover-bg)]" : ""
            }`}
          >
            {/* Dressed the way the chip it inserts will be. */}
            <span className="truncate font-medium text-blue-700 dark:text-blue-300">
              {v.label}
            </span>
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
