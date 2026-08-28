"use client";

// One track, N named states — the Day/Week/List shape the app already uses,
// lifted out of BusinessView's field-source picker so that the two places that
// now draw the same three agent modes (the business default in Settings, and
// the per-conversation control above the composer) cannot drift into looking
// like different decisions.
//
// A segmented control rather than a switch whenever OFF IS A STATE rather than
// the absence of the control. "Off" for the chat agent is a position on a dial
// somebody chose, not an empty box.

export type Segment<T extends string> = {
  id: T;
  label: string;
  // Shown as the button's title. The modes differ in what happens to a
  // customer, which a one-word pill cannot carry on its own.
  hint?: string;
};

export function SegmentedControl<T extends string>({
  value,
  segments,
  onChange,
  disabled,
  labelledBy,
  size = "md",
}: {
  value: T;
  segments: readonly Segment<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
  labelledBy?: string;
  // "sm" is the in-thread density, where the control sits inside a bar above
  // the composer and must not out-shout the conversation.
  size?: "sm" | "md";
}) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className={`inline-flex rounded-lg bg-[var(--muted-bg)] p-0.5 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {segments.map((segment) => (
        <button
          key={segment.id}
          type="button"
          aria-pressed={value === segment.id}
          title={segment.hint}
          disabled={disabled}
          onClick={() => {
            // A click on the current segment is not a change. Letting it
            // through would write the same value and, where writes clear a
            // per-conversation pin, quietly re-pin it.
            if (!disabled && segment.id !== value) onChange(segment.id);
          }}
          className={`rounded-md transition-colors disabled:cursor-not-allowed ${
            size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
          } ${
            value === segment.id
              ? "bg-[var(--background)] font-medium text-[var(--foreground)]"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}
