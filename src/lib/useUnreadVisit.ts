"use client";

import { useCallback, useSyncExternalStore } from "react";

// Reading a conversation changes its dot, not its place in this visit to
// Unread (P21, Nudge 0ed5a4bd, WhatsApp's unread list). Open a person from
// the Unread view and come back: they are still there, without the dot,
// and the count has gone down. Without this the row vanished the moment its
// read stamp landed, and "who was that I just answered" had no answer.
//
// Only rows the person OPENED are kept, as snapshots; current server rows
// merge over them, so a kept row that is still listed shows live data. A
// kept row that gets a NEW reply lights again.
//
// Module state, not component state, and that is the Resepta difference: a
// row here opens the customer's record, which unmounts the Inbox, so a
// visit held in the view would end the moment it began. The visit lasts
// while the reader stays under the Inbox tab (records opened from it
// included) and ends when they pick a filter chip, leave the tab
// (`resetUnreadVisit`, called by AppHome), switch business, or reload.

type VisitRow = { customerId: string; lastInboundAt: number; unseen: boolean };
type Visit = { scope: string | null; rows: VisitRow[] };

let visit: Visit = { scope: null, rows: [] };
const listeners = new Set<() => void>();

function write(next: Visit) {
  visit = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => visit;

// A new visit: forget every kept row.
export function resetUnreadVisit() {
  if (visit.rows.length > 0 || visit.scope !== null) write({ scope: null, rows: [] });
}

// `scope` names the visit (the business, while the Unread view is showing
// and no search is); null when retention does not apply, and then the live
// rows pass through untouched.
export function useUnreadVisit<T extends VisitRow>(liveRows: T[], scope: string | null) {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Rows kept for another scope (the other business, a visit since reset)
  // are never painted, even for one frame.
  const retained = (current.scope === scope ? current.rows : []) as T[];
  const rows =
    scope === null || retained.length === 0
      ? liveRows
      : [
          ...new Map<string, T>([
            ...retained.map((row) => [row.customerId, row] as const),
            ...liveRows.map((row) => {
              const read = retained.find((item) => item.customerId === row.customerId);
              // Still listed and nothing new since it was opened: keep it
              // read here even if the server's stamp has not landed yet.
              return [
                row.customerId,
                read && row.lastInboundAt <= read.lastInboundAt ? { ...row, unseen: false } : row,
              ] as const;
            }),
          ]).values(),
        ].sort((a, b) => b.lastInboundAt - a.lastInboundAt);

  const keep = useCallback(
    (row: T) => {
      if (scope === null) return;
      const others = visit.scope === scope ? visit.rows : [];
      write({
        scope,
        rows: [...others.filter((item) => item.customerId !== row.customerId), { ...row, unseen: false }],
      });
    },
    [scope],
  );
  const remove = useCallback(
    (customerIds: readonly string[]) => {
      if (visit.scope !== scope) return;
      write({
        scope,
        rows: visit.rows.filter((row) => !customerIds.includes(row.customerId)),
      });
    },
    [scope],
  );
  const patch = useCallback(
    (customerId: string, changes: Partial<T>) => {
      if (visit.scope !== scope || !visit.rows.some((row) => row.customerId === customerId)) {
        return;
      }
      write({
        scope,
        rows: visit.rows.map((row) =>
          row.customerId === customerId ? { ...row, ...changes } : row,
        ),
      });
    },
    [scope],
  );
  return { rows, keep, remove, patch };
}
