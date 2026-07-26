// The arithmetic behind dragging on the calendar, kept out of the component so
// it can be exercised without a browser. Three gestures, one reducer: drawing a
// new slot on empty grid, moving a block, and resizing one by its bottom edge.
// They differ only in which edge the pointer controls.

// A salon books in quarter hours, and finer snapping only demands a steadier
// hand than a counter phone allows.
export const SNAP_MINUTES = 15;

export type DragKind = "create" | "move" | "resize";

export type DragGeometry = {
  kind: DragKind;
  // Fixed end for a create drag: the minute the pointer went down. Unused by
  // the other two.
  anchorMinute: number;
  // Where inside a block the pointer grabbed it, so picking one up does not
  // jerk its top edge to the cursor.
  grabOffset: number;
  startMinute: number;
  endMinute: number;
  moved: boolean;
};

export function snapMinute(minute: number): number {
  return Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES;
}

// Which day column the pointer is over, as an index into the visible columns.
// The hour gutter is not a day, so it comes off the width before dividing.
//
// Clamped rather than nullable on purpose: dragging a block past the left or
// right edge of the week should park it on Monday or Sunday, not drop the
// gesture. The pointer leaves the grid constantly during a real drag.
export function columnIndexAt(
  clientX: number,
  gridLeftPx: number,
  gutterPx: number,
  gridWidthPx: number,
  columnCount: number,
): number {
  if (columnCount <= 1) return 0;
  const columnWidth = (gridWidthPx - gutterPx) / columnCount;
  if (!(columnWidth > 0)) return 0;
  const index = Math.floor((clientX - gridLeftPx - gutterPx) / columnWidth);
  return Math.min(columnCount - 1, Math.max(0, index));
}

// Where the pointer is, in minutes since midnight, given the grid's own top.
export function minuteAt(
  clientY: number,
  gridTopPx: number,
  dayStartHour: number,
  hourPx: number,
): number {
  return snapMinute(dayStartHour * 60 + ((clientY - gridTopPx) / hourPx) * 60);
}

// One pointermove. Returns a new geometry; never mutates.
export function advanceDrag(drag: DragGeometry, minute: number): DragGeometry {
  if (drag.kind === "create") {
    // Drag up or down from where the pointer went down: the anchor is the
    // fixed end, the pointer is the loose one.
    const lo = Math.min(drag.anchorMinute, minute);
    const hi = Math.max(drag.anchorMinute, minute);
    return {
      ...drag,
      startMinute: lo,
      endMinute: Math.max(lo + SNAP_MINUTES, hi),
      moved: true,
    };
  }
  if (drag.kind === "resize") {
    // A block may never end before it starts; one snap step is the floor.
    return {
      ...drag,
      endMinute: Math.max(drag.startMinute + SNAP_MINUTES, minute),
      moved: true,
    };
  }
  const length = drag.endMinute - drag.startMinute;
  const startMinute = minute - drag.grabOffset;
  return { ...drag, startMinute, endMinute: startMinute + length, moved: true };
}

// What a finished gesture means. `defaultDuration` covers the click case: a
// plain click on empty grid is "book here", not a fifteen-minute booking.
export function dragResult(
  drag: DragGeometry,
  dayMs: number,
  defaultDuration: number,
): { startAt: number; durationMinutes: number } {
  const durationMinutes =
    drag.kind === "create" && !drag.moved
      ? defaultDuration
      : Math.max(SNAP_MINUTES, drag.endMinute - drag.startMinute);
  return { startAt: dayMs + drag.startMinute * 60_000, durationMinutes };
}
