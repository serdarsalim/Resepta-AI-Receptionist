// A team member's colour on the calendar (Nudge's host colours, lib/
// hostColors.ts there, 2026-10-12). Their appointments wear it on the week,
// day and month grids, the list and the drawn slot, so a glance down a busy
// week says WHO as well as when, which a salon with four chairs reads first.
//
// Google Calendar's own event palette, because that is the set people already
// know as calendar colours, with Resepta's lavender FIRST. Lavender has been
// the colour of a booking here since 2026-08-19 (design-language.md, "Events
// wear lavender"), so a business with one person, or with nobody's colour
// chosen yet, keeps exactly the calendar it had; the second person is the
// first to change anything. Nudge put Google's Peacock first, on Serdar's ask
// for Nudge. Left out of Google's eleven: Tomato, because red on this
// calendar means a no-show and the now-line and nothing else, and Google's
// own Lavender, which would be a second violet beside this one.
//
// One colour per PERSON (staff.color, a key below), never per service. Two
// people must not share one, so an unset colour is RESOLVED, not defaulted:
// people without one take, in the order their rows were made, the first
// colour nobody in THIS business has yet, so adding someone never repaints
// anyone already there. Deactivated people keep theirs (their past bookings
// still draw), which is also why switching someone off repaints nobody. Only
// a person deleted outright frees a colour, and only the unchosen colours of
// people added after them move. Past ten people a colour repeats.
//
// Resolved among one business's staff rows and nothing wider: one deployment
// serves every business, and another salon's choices are none of this one's
// business.
//
// A LEAF: the server resolves, the client draws, both from this one list.

import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type StaffColor = {
  key: string;
  // The solid chip. The lavender entry's hex is the light theme's; the grid
  // draws lavender from the --event token instead, which has its own dark
  // value (#8b6ef5), so the default reads exactly as it always has.
  hex: string;
  // Text on the solid: white, except where white would not be readable.
  fg: string;
};

export const STAFF_COLORS: readonly StaffColor[] = [
  { key: "lavender", hex: "#7c5cf0", fg: "#ffffff" },
  { key: "peacock", hex: "#039be5", fg: "#ffffff" },
  { key: "sage", hex: "#33b679", fg: "#ffffff" },
  { key: "tangerine", hex: "#f4511e", fg: "#ffffff" },
  { key: "grape", hex: "#8e24aa", fg: "#ffffff" },
  { key: "banana", hex: "#f6bf26", fg: "#3d2e00" },
  { key: "blueberry", hex: "#3f51b5", fg: "#ffffff" },
  { key: "flamingo", hex: "#e67c73", fg: "#ffffff" },
  { key: "basil", hex: "#0b8043", fg: "#ffffff" },
  { key: "graphite", hex: "#616161", fg: "#ffffff" },
];

// The booking colour of anything with nobody on it: an unassigned
// appointment, a slot being drawn in a week column.
export const DEFAULT_STAFF_COLOR = STAFF_COLORS[0];

export function isStaffColorKey(key: string | undefined): key is string {
  return !!key && STAFF_COLORS.some((c) => c.key === key);
}

export function staffColor(key: string | undefined): StaffColor {
  return STAFF_COLORS.find((c) => c.key === key) ?? DEFAULT_STAFF_COLOR;
}

/** Every staff row's colour key. Chosen colours stand; the rest take the
 *  first colour nobody has, oldest row first, so a new person never moves an
 *  existing one. */
export function resolveStaffColors(
  rows: readonly { _id: string; color?: string; _creationTime: number }[],
): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const row of rows) {
    if (isStaffColorKey(row.color)) {
      out.set(row._id, row.color);
      used.add(row.color);
    }
  }
  const unset = rows
    .filter((row) => !out.has(row._id))
    .sort((a, b) => a._creationTime - b._creationTime);
  let cycle = 0;
  for (const row of unset) {
    const free = STAFF_COLORS.find((c) => !used.has(c.key));
    const key = free ? free.key : STAFF_COLORS[cycle++ % STAFF_COLORS.length].key;
    out.set(row._id, key);
    used.add(key);
  }
  return out;
}

// Far past any salon's team; a bound so the read stays a bound.
const MAX_STAFF = 500;

/** One business's staff rows with their resolved colours, oldest first: the
 *  same rows the calendar, the Team card and the colour write all judge by,
 *  so the three cannot disagree about who holds what. */
export async function loadStaffColors(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
): Promise<Map<string, string>> {
  const rows = await ctx.db
    .query("staff")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(MAX_STAFF);
  return resolveStaffColors(rows);
}
