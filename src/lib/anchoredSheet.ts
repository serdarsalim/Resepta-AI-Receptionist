// Where a popover goes when it is attached to something on screen.
//
// Google Calendar's booking popover is the reference, and the thing that makes
// it read as attached rather than floating is not the animation: it is that it
// NEVER covers the block it just created. It takes the side with room, and only
// falls back to overlapping when neither side has any.
//
// Pure arithmetic, no DOM, so the placement rules can be reasoned about (and
// checked) without mounting anything.

export type Rect = { top: number; left: number; width: number; height: number };

export type Viewport = { width: number; height: number };

export type Placement = {
  top: number;
  left: number;
  // Which side of the anchor it landed on. Only useful for a caller that wants
  // to point an arrow at the anchor; the position is already resolved.
  side: "right" | "left" | "over";
};

// Breathing room between the popover and the anchor, and between the popover
// and the window edge. Same number for both so the panel never looks pinned to
// one and loose against the other.
const GAP = 8;

// Below this there is no "beside" to speak of: a 512px panel next to anything
// on a 600px screen is a panel with 80px of calendar showing. The caller drops
// to its full-width sheet instead, so this returns null rather than a bad
// answer.
export const MIN_ANCHORED_WIDTH = 900;

export function placeBeside(
  anchor: Rect,
  panel: { width: number; height: number },
  viewport: Viewport,
): Placement | null {
  if (viewport.width < MIN_ANCHORED_WIDTH) return null;

  const anchorRight = anchor.left + anchor.width;
  const roomRight = viewport.width - anchorRight - GAP * 2;
  const roomLeft = anchor.left - GAP * 2;

  let side: Placement["side"];
  let left: number;
  if (roomRight >= panel.width) {
    // Preferred: reading order puts the panel after the thing it belongs to.
    side = "right";
    left = anchorRight + GAP;
  } else if (roomLeft >= panel.width) {
    side = "left";
    left = anchor.left - GAP - panel.width;
  } else {
    // Neither side fits, so stop pretending. Centre it horizontally and accept
    // the overlap rather than jamming it against an edge at an angle nobody
    // asked for. A 512px panel on a 900px window is this case.
    side = "over";
    left = (viewport.width - panel.width) / 2;
  }
  left = clamp(left, GAP, viewport.width - panel.width - GAP);

  // Vertically it wants to START at the anchor, so the top of the panel and the
  // top of the block line up and the eye reads them as one object. It only
  // slides up when the panel would run off the bottom, and it never goes above
  // the top edge.
  const top = clamp(anchor.top, GAP, Math.max(GAP, viewport.height - panel.height - GAP));

  return { top, left, side };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
