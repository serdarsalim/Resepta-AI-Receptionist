"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

// The phone header's pane switcher, HeaderSearch's slot pattern reused
// (Serdar, 2026-08-31): on a contact record below lg, the row of words
// ("Contact fields | Inbox") burned a whole band under the title to say what
// five glyphs can say ON the title line — a person for the record, then the
// channel icons, each one both a pane switch and a filter. The state lives in
// ContactView (it owns mobilePane and the feed filter); the shell renders the
// buttons because the shell renders the header row they sit in. Plain data
// and callbacks through the slot, never elements — the header must not
// depend on a child handing React nodes back up (see ShellHeader's rule).

// "record" is the profile pane; the rest are the conversation pane opened on
// that channel's filter. "form" stays out — it is a rare arrival, not a place
// someone navigates to, and six icons is where a title row stops having a
// title.
export type HeaderPaneTarget = "record" | "call" | "whatsapp" | "email" | "note";

type HeaderPanes = {
  active: HeaderPaneTarget | null;
  select: (target: HeaderPaneTarget) => void;
};

type HeaderPanesValue = {
  panes: HeaderPanes | null;
  setPanes: (panes: HeaderPanes | null) => void;
};

const HeaderPanesContext = createContext<HeaderPanesValue | null>(null);

export function HeaderPanesProvider({ children }: { children: React.ReactNode }) {
  const [panes, setPanes] = useState<HeaderPanes | null>(null);
  const value = useMemo(() => ({ panes, setPanes }), [panes]);
  return (
    <HeaderPanesContext.Provider value={value}>
      {children}
    </HeaderPanesContext.Provider>
  );
}

// What the header reads. Null = no view claimed the slot, draw nothing.
export function useHeaderPanesSlot(): HeaderPanes | null {
  const context = useContext(HeaderPanesContext);
  if (!context) throw new Error("useHeaderPanesSlot outside HeaderPanesProvider");
  return context.panes;
}

// What a view calls. `select` must be referentially stable (useCallback) —
// it sits in the claiming effect's deps, same contract as HeaderSearch's
// onJumpToCustomer and for the same reason: a fresh identity every render
// re-claims the slot in a loop.
export function useHeaderPanes(
  active: HeaderPaneTarget | null,
  select: (target: HeaderPaneTarget) => void,
) {
  const context = useContext(HeaderPanesContext);
  if (!context) throw new Error("useHeaderPanes outside HeaderPanesProvider");
  const { setPanes } = context;
  useEffect(() => {
    setPanes({ active, select });
    // Clearing on the way out matters as much as claiming: navigating off the
    // contact must not leave its switcher over the Customers list.
    return () => setPanes(null);
  }, [active, select, setPanes]);
}
