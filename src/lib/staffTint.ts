import type { CSSProperties } from "react";
import { DEFAULT_STAFF_COLOR, staffColor } from "../../convex/lib/staffColors";

// How a booking takes its team member's colour (Nudge's hostTint). The chip
// sets --event and --event-fg inline, and the `.staff-tint` class in
// globals.css re-derives the washes FROM that --event on the chip itself: a
// custom property inherits its computed value, so the :root washes, already
// mixed from lavender, would not follow a chip's own colour.
//
// Lavender, the default, sets nothing: it IS the --event token, which carries
// its own dark value (#8b6ef5), so an unassigned booking and the first person
// on the team look exactly as every booking did before colours existed.
export const STAFF_TINT = "staff-tint";

export function staffTint(key: string | undefined): CSSProperties {
  const c = staffColor(key);
  if (c.key === DEFAULT_STAFF_COLOR.key) return {};
  return { ["--event" as string]: c.hex, ["--event-fg" as string]: c.fg } as CSSProperties;
}

// The swatch itself, for a dot or a tick box: the theme's own lavender for
// the default, the palette hex for the rest.
export function staffSwatch(key: string | undefined): string {
  const c = staffColor(key);
  return c.key === DEFAULT_STAFF_COLOR.key ? "var(--event)" : c.hex;
}

// The check drawn on a filled swatch.
export function staffSwatchInk(key: string | undefined): string {
  return staffColor(key).fg;
}
