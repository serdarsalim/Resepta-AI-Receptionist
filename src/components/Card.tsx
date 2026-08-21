"use client";

import { InfoTip } from "./InfoTip";

// Section card, shared by Settings and Workspace setup. Title is optional:
// where the surface already names the card (a settings section holding one
// card), a title would just restate the heading above it.
export function Card({
  title,
  tip,
  action,
  disabled,
  children,
}: {
  title?: string;
  tip?: string;
  // The card's ONE primary action, hard right on the title line. Every list in
  // this app puts it there — Add agent, Add message, Add customer all sit top
  // right of the thing they add to — and a card that parks it at the foot of
  // its list instead puts the primary action below however many rows the salon
  // happens to have.
  //
  // It renders OUTSIDE the fieldset below, so `disabled` does not reach it. An
  // action passed to a card that can be read-only has to gate itself.
  action?: React.ReactNode;
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
    // 12px inside on a phone, 16 from sm. Deliberately tighter than Nudge,
    // whose content cards run p-4 sm:p-6 — its cards hold forms, ours hold
    // rows that already carry their own columns (a service key chip, a price,
    // a switch), and those rows are what runs out of width first. The shell
    // outside is down to 8px for the same reason.
    <section className="rounded-lg bg-[var(--card)] p-3 shadow-[var(--card-shadow)] sm:p-4">
      {(title || action) && (
        // min-h-8 so a card WITH an action and a card without keep the same
        // header height, and a row of cards down a page does not step in and
        // out where the buttons happen to fall.
        <div className="mb-3 flex min-h-8 items-center gap-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {tip && <InfoTip text={tip} />}
          {action && <div className="ml-auto flex items-center">{action}</div>}
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
