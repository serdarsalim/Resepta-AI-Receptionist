"use client";

import { InfoTip } from "./InfoTip";

// Section card, shared by Settings and Workspace setup. Title is optional:
// where the surface already names the card (a settings section holding one
// card), a title would just restate the heading above it.
export function Card({
  title,
  tip,
  disabled,
  children,
}: {
  title?: string;
  tip?: string;
  // Staff see owner-only cards read-only; a native fieldset disables every
  // input and button inside without per-control wiring.
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    // Lifted, not outlined, and rounded-lg rather than -xl. Both come from the
    // reference table: dropping the 1px line is what softens the corners, so
    // the radius has to come down with it or the card starts looking like a
    // pill. Border lives in --card-shadow now, which is a real ring only in
    // dark mode, where a shadow would be invisible.
    <section className="rounded-lg bg-[var(--card)] p-4 shadow-[var(--card-shadow)]">
      {title && (
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {tip && <InfoTip text={tip} />}
        </div>
      )}
      {/* min-w-0 is load-bearing, not tidying. Browsers give <fieldset> a
          default min-width of min-content and it refuses to shrink below its
          content — so ANY overflow-x-auto inside a Card is defeated and wide
          children escape the card's right edge instead of scrolling. The voice
          agent table was clipped past the border for exactly this reason, and
          two fixes on the table itself did nothing because the table was never
          the problem. */}
      <fieldset
        disabled={disabled}
        className={`min-w-0 ${disabled ? "opacity-70" : ""}`}
      >
        {children}
      </fieldset>
    </section>
  );
}
