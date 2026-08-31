"use client";

// The check switch: the message-rule channel toggle (RemindersView) with the
// word removed — emerald wash and a check when on, a hollow ring when off.
// Ported, not invented: that control is this app's ON, and Serdar rejected
// the iOS Toggle for in-table state ("apple switches don't look good"). The
// off-state border is sanctioned by the same reference.
//
// Born in the agent's variables matrix, promoted to a shared component when
// the Knowledge tab's Active columns adopted it, and no longer table-only:
// the Business card's settings rows took it on 2026-08-29 (Serdar). The rule
// this control was carrying — a table cell gets the check, a settings row
// gets the pill — was a distinction the app could not justify out loud, and
// the note on the voice table said as much before the switch: two controls
// answering the same yes/no question should not be two different shapes.
//
// The iOS Toggle survives on Account and the voice agent detail. Not a
// principle, just the parts that have not been converted yet — the contact
// record's Consent/Mute footer converted 2026-08-31.
export function CheckSwitch({
  on,
  label,
  onChange,
  disabled,
}: {
  on: boolean;
  label: string;
  onChange?: (next: boolean) => void;
  // Arrived with the pickup/delivery pair, where the last one still on cannot
  // be switched off. Greyed rather than absent: a control that vanishes at the
  // boundary reads as a bug, one that dims reads as a rule.
  disabled?: boolean;
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
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        on
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "border border-[var(--border)] text-transparent enabled:hover:text-[var(--muted)]"
      }`}
    >
      {check}
    </button>
  );
}
