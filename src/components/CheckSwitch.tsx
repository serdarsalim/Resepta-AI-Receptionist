"use client";

// The check switch: the message-rule channel toggle (RemindersView) with the
// word removed — emerald wash and a check when on, a hollow ring when off.
// Ported, not invented: that control is this app's ON, and Serdar rejected
// the iOS Toggle for in-table state ("apple switches don't look good"). The
// off-state border is sanctioned by the same reference.
//
// Born in the agent's variables matrix, promoted to a shared component when
// the Knowledge tab's Active columns adopted it. Use it for a boolean cell
// INSIDE a table row; the iOS Toggle remains the control for a boolean
// SETTING on a labelled settings row (booking page, revenue tab, hours).
export function CheckSwitch({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange?: (next: boolean) => void;
}) {
  const check = (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange?.(!on)}
      className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
        on
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "border border-[var(--border)] text-transparent hover:text-[var(--muted)]"
      }`}
    >
      {check}
    </button>
  );
}
