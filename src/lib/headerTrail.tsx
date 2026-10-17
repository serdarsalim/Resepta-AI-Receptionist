"use client";

// A record opened INSIDE a tab (a voice agent, a message rule, a bulk run)
// names itself in the shell's title bar as a breadcrumb, "Messages › Reminder
// 24h before", instead of drawing its own back arrow in the page body (P25,
// Nudge 763509b5 and 7a123cf0). Before this each drill-in drew its own: a
// drawn arrow with "Back", a chevron with "Back", a text "←", all a row below
// the title they belonged to.
//
// A view calls `useHeaderTrail` while its record is open; AppShell owns the
// title bar and turns the trail into crumbs. One slot: the last view to
// register wins, and unmounting clears it. A customer record opened over a
// tab replaces the tab's view (AppHome), so a trail and a contact never stack.

import { createContext, useContext, useEffect, useLayoutEffect, useRef } from "react";

export type HeaderTrail = {
  // The open record's name, the title's own step.
  title: string;
  // Closes the record, back to the list it was opened from.
  back: () => void;
  // The list's name when the tab's own title isn't it ("Bulk" inside
  // Customers). Defaults to the tab title.
  backLabel?: string;
};

const Ctx = createContext<(trail: HeaderTrail | null) => void>(() => {});

export const HeaderTrailProvider = Ctx.Provider;

export function useHeaderTrail(trail: HeaderTrail | null) {
  const set = useContext(Ctx);
  // `back` is usually a fresh closure each render; publishing it would loop
  // the shell's state. Publish a stable caller and keep the latest here.
  const backRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    if (trail) backRef.current = trail.back;
  });
  const title = trail?.title;
  const backLabel = trail?.backLabel;
  const open = trail !== null;
  useEffect(() => {
    if (!open) return;
    set({ title: title ?? "", backLabel, back: () => backRef.current() });
    return () => set(null);
  }, [open, title, backLabel, set]);
}
