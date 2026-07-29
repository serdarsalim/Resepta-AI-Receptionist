"use client";

// Two sizes, not a free measurement. Default is the settings switch, the one
// you reach for when a row exists to hold it. Small is for a switch sharing a
// line with a value, where the full-size track is louder than the fact it is
// reporting and eats the width the value needs.
const SIZES = {
  md: { track: "h-6 w-11", knob: "h-5 w-5", on: "translate-x-[22px]" },
  sm: { track: "h-5 w-9", knob: "h-4 w-4", on: "translate-x-[18px]" },
} as const;

// iOS-style switch. Use for boolean settings instead of a checkbox.
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  size = "md",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  size?: keyof typeof SIZES;
}) {
  const dims = SIZES[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{ backgroundColor: checked ? "var(--brand)" : undefined }}
      className={`relative inline-flex ${dims.track} shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "" : "bg-zinc-300 dark:bg-zinc-600"
      }`}
    >
      <span
        className={`inline-block ${dims.knob} transform rounded-full bg-white shadow transition-transform ${
          checked ? dims.on : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
