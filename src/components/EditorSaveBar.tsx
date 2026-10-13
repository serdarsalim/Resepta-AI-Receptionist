"use client";

import { buttonClass } from "./Control";

// The "you have unsaved work" control group, in ONE place. Ported from Nudge
// (2026-09-21 there, 2026-10-13 here), where four editors had each grown
// their own copy of a state pill, a Discard and a Save, and all four drifted.
// Resepta had three: the agent page's header and foot, and the automation
// editor's header. They boxed the state in an amber rounded-full pill, gave
// Discard a border that went red on hover, and drew Publish at text-xs, so a
// header held three boxes and two of them coloured.
//
// The rule this encodes, Serdar's pick in Nudge: exactly ONE thing in the row
// is boxed, the action that ends the state. The state is a dot and a sentence,
// unboxed: it is a condition, not a control, and boxing it made it compete
// with the two real buttons beside it. Discard is `quiet`: dropping edits you
// have not saved is not destructive enough to earn red next to a primary.
// Amber is the app's colour for UNSAVED and only that (AGENTS.md, "One state,
// one hue").
//
// Sizes come from Control.tsx: the scale's sm, the height of any control row.
export function EditorSaveBar({
  status,
  statusTitle,
  statusFromSm = false,
  onDiscard,
  discardLabel,
  discardTitle,
  onSave,
  saveLabel,
  saveTitle,
  saveDisabled,
  busy,
}: {
  // The condition, already worded ("Unsaved", "Draft saved · not live yet").
  // Omitted when there is nothing pending; the bar then shows its action
  // alone.
  status?: string | null;
  statusTitle?: string;
  // Hide the sentence below sm, where a header row cannot spare its width:
  // the automation editor's header shares one line with Back and the rule's
  // name. The buttons alone still say there is something to save.
  statusFromSm?: boolean;
  // Omitted when there is nothing to discard.
  onDiscard?: () => void;
  discardLabel?: string;
  discardTitle?: string;
  onSave: () => void;
  saveLabel: string;
  saveTitle?: string;
  saveDisabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {status ? (
        <span
          title={statusTitle}
          className={`${
            statusFromSm ? "hidden sm:inline-flex" : "inline-flex"
          } shrink-0 items-center gap-1.5 px-1 text-sm font-medium text-amber-600 dark:text-amber-400`}
        >
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          {status}
        </span>
      ) : null}
      {onDiscard && discardLabel ? (
        <button
          type="button"
          disabled={busy}
          onClick={onDiscard}
          title={discardTitle}
          className={buttonClass("quiet", "sm")}
        >
          {discardLabel}
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy || saveDisabled}
        onClick={onSave}
        title={saveTitle}
        className={buttonClass("primary", "sm")}
      >
        {saveLabel}
      </button>
    </div>
  );
}
