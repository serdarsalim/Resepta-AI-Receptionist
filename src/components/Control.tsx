// The app's control scale: three heights, one radius per kind, one type size,
// for every button and field that is not a page's own special case. Ported
// from Nudge's Control.tsx (2026-09-19 there, 2026-10-13 here), keeping
// Resepta's own shape rules: no border on a button (AGENTS.md, "Borders only
// when absolutely necessary"), the outlined tier only where the card-action
// rule allows it, and a field that is a well in its card (RowLabel's FIELD).
//
// HEIGHT IS DECLARED, NEVER DERIVED. That is the rule that prevents the
// drift. `px-3 py-1.5 text-sm` is 32px only while the line-height is 20px,
// and a native <select> ignores line-height altogether, so the Business
// card's inputs and its selects, built from the SAME classes, came out 34px
// and ~31px side by side. A size names its h-*, and padding only sets the
// horizontal rhythm. Every height here is in rem, which is the other half:
// Serdar's Chrome runs a 17px base font, where h-8 is 34px for everything at
// once, while a control mixing rem with px borders or a text-[11px] label
// drifts off its neighbours by a pixel or two.
//
// xs  28px  dense chrome: the pickers in an editor toolbar, a section action
//           beside a record's ⋯, a per-row action in a list.
// sm  32px  the default. Every button on a control row, every settings
//           field, the booking sheet's fields, the save bar. One row, one
//           height.
// md  36px  the booking sheet's footer, where the Google-style Save pill
//           sets the row's height.
//
// ONE type size across the tiers. A size is how much room a control gets,
// never how small its label goes. Below sm the iOS rule in globals.css still
// renders every field at 16px; it is un-layered CSS, so it beats text-sm.
export type ControlSize = "xs" | "sm" | "md";

const HEIGHT: Record<ControlSize, string> = {
  xs: "h-7",
  sm: "h-8",
  md: "h-9",
};

// The vertical padding that reproduces each height when a field CANNOT take
// one (a textarea that grows). One line of text-sm (1.25rem) plus a 1px border
// on each side, so a one-row textarea starts exactly as tall as the
// single-line field beside it.
const PAD_Y: Record<ControlSize, string> = {
  xs: "py-[calc(0.25rem-1px)]",
  sm: "py-[calc(0.375rem-1px)]",
  md: "py-[calc(0.5rem-1px)]",
};

const PAD_X: Record<ControlSize, string> = {
  xs: "px-2.5",
  sm: "px-3",
  md: "px-3",
};

const GAP: Record<ControlSize, string> = {
  xs: "gap-1",
  sm: "gap-1.5",
  md: "gap-1.5",
};

// Buttons have DEPTH, not a flat outline (Nudge, 2026-10-20; here
// 2026-10-21): `primary` is crisp (--solid-shadow: a darker edge and a light
// line along the top) and darkens on hover instead of fading its label;
// `outline` is RAISED (--raised*: white, a hairline ring, a soft drop; a
// lighter surface in dark). Rings, not borders, so the box keeps its height.
//
// primary  the one action a card, sheet or editor is FOR. Filled accent.
// ghost    a real action that is not the main one: text on a hover wash, no
//          border (AGENTS.md: secondary and ghost buttons are text plus a
//          wash). Foreground ink.
// quiet    the same, one ink tier down: Discard, Cancel, a picker in an
//          editor toolbar. Things you reach for, not things the row is for.
// outline  the card-action tier: a card's own action in its header and a
//          section's "+ Add" inside a card. `.card-action` in globals.css is
//          this look at sm and stays the class Card headers use; the two
//          must agree. Raised, and boxed (rounded-lg): it does work.
// pill     a VIEW control, the switch's thumb as a button (Nudge's `lifted`):
//          a raised round pill. The calendar's Today and its view menu, a
//          picker that changes what a list shows. Round because shape says
//          what a control is: rounded-lg does work, rounded-full chooses what
//          you see (Nudge's Control.tsx, rule 2).
// danger   destructive. Muted at rest and red on hover, so a Delete does not
//          shout from the foot of every editor it sits in.
//
// Pick the variant that already looks right; never compose a colour on top
// of one. `${buttonClass("quiet")} hover:text-red-600` is a bet on which
// utility Tailwind happens to emit last, not an override. If nothing fits,
// build from controlClass, which carries geometry and no colour.
//
// The hover wash is --control-hover, a foreground mix, not --muted-bg: in
// dark --muted-bg IS --card, so a muted-bg hover on a card shows nothing.
export type ControlVariant = "primary" | "ghost" | "quiet" | "outline" | "pill" | "danger";

const VARIANT: Record<ControlVariant, string> = {
  primary:
    "bg-[var(--primary-bg)] text-[var(--accent-fg)] shadow-[var(--solid-shadow)] hover:bg-[var(--primary-hover)]",
  ghost: "text-[var(--foreground)] hover:bg-[var(--control-hover)]",
  quiet:
    "text-[var(--muted)] hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]",
  outline:
    "bg-[var(--raised)] text-[var(--foreground)] shadow-[var(--raised-shadow)] hover:bg-[var(--raised-hover)]",
  // Hover steps a hair toward the ink: greyer in light, lighter in dark.
  pill: "bg-[var(--segment-thumb)] text-[var(--foreground)] shadow-[var(--segment-thumb-shadow)] hover:bg-[color-mix(in_srgb,var(--segment-thumb)_95%,var(--foreground))]",
  danger:
    "text-[var(--muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400",
};

// Buttons take focus-visible, so a mouse click does not leave a ring behind.
// Fields keep the base layer's own focus outline (globals.css).
const FOCUS_BUTTON =
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40";

const DISABLED =
  "disabled:pointer-events-none disabled:opacity-50 cursor-pointer disabled:cursor-default";

// Geometry only: height, radius, type, rhythm. For a control that cannot take
// a variant's colours but still has to line up with the ones that do.
// `round` swaps the radius rather than stacking a second one: two radius
// utilities are decided by Tailwind's order, not the class string.
export function controlClass(size: ControlSize = "sm", round = false): string {
  return `inline-flex ${HEIGHT[size]} shrink-0 items-center justify-center ${GAP[size]} whitespace-nowrap ${round ? "rounded-full" : "rounded-lg"} ${PAD_X[size]} text-sm font-medium transition-colors`;
}

export function buttonClass(
  variant: ControlVariant = "ghost",
  size: ControlSize = "sm",
): string {
  return `${controlClass(size, variant === "pill")} ${VARIANT[variant]} ${FOCUS_BUTTON} ${DISABLED}`;
}

// A square button with no label: a × that removes a row, a kebab. Same height
// as its lettered neighbours so a row of mixed controls sits on one line, and
// width equals height so the glyph is optically centred rather than riding the
// text baseline the way a typed "×" does.
export function iconButtonClass(
  variant: ControlVariant = "quiet",
  size: ControlSize = "sm",
): string {
  const box = { xs: "h-7 w-7", sm: "h-8 w-8", md: "h-9 w-9" }[size];
  return `inline-flex ${box} shrink-0 items-center justify-center ${variant === "pill" ? "rounded-full" : "rounded-lg"} text-sm transition-colors ${VARIANT[variant]} ${FOCUS_BUTTON} ${DISABLED}`;
}

// Inputs, selects, textareas, and a button that stands in for a field (a
// picker's trigger). A field and a button of the same size are the same
// height, so anything sharing a row can share a size and simply line up.
//
// rounded-md and the PAGE background, not the card's: that is the FIELD look
// Serdar pointed at on the timezone picker and said "like that" (RowLabel.tsx,
// 2026-08-27). The background makes the box read as a well in the card, and
// in dark it is what keeps a field from vanishing into it.
//
// py-0 on the single-line form is load-bearing. The base layer pads every
// input, select and textarea 0.5rem top and bottom, which inside a declared
// 32px left a 14px box for a 20px line. `multiline` swaps the declared height
// for the padding that reproduces it. font-normal because the booking sheet
// wraps its fields in labels that are font-medium, and a typed value inherits
// the label's weight otherwise.
//
// No width: callers set their own, and baking one in here meant every inline
// select had to fight it back off.
//
// `tight` takes the side padding down a step (px-2) for a field whose value
// is five characters and always will be: the booking sheet's start and end
// times, which have to share one line with a date in a 19rem column. An
// option rather than a px-2 composed on top, which would be a bet on the
// order Tailwind emits the two in.
export function fieldClass(
  size: ControlSize = "sm",
  opts: { multiline?: boolean; tight?: boolean } = {},
): string {
  const vertical = opts.multiline ? PAD_Y[size] : `${HEIGHT[size]} py-0`;
  const horizontal = opts.tight ? "px-2" : PAD_X[size];
  return `${vertical} rounded-md border border-[var(--border)] bg-[var(--background)] ${horizontal} text-sm font-normal text-[var(--foreground)] placeholder:text-[var(--muted)] disabled:opacity-50`;
}
