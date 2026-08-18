"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchFrom, type Search } from "./useTableState";

// One search box for the whole app, parked top-right in the header, exactly
// where it sits on every tab that has one. Borrowed from Nudge, whose AppHeader
// carries "an optional search box, shown only when a tab provides a search
// slot" — the value of a fixed position is that it is fixed, which is only
// true if the shell owns the box rather than each view drawing its own.
//
// The state has to live above both: the header renders the input, a view three
// levels down does the filtering. So the shell holds the query and a view
// declares, by rendering, that it wants a box and what it should say.

type HeaderSearchValue = {
  query: string;
  setQuery: (query: string) => void;
  placeholder: string | null;
  setPlaceholder: (placeholder: string | null) => void;
  // Set by the contact page only (also Nudge's shape). The box keeps
  // filtering whatever the view is showing; claiming this slot ALSO offers
  // matching customers as a jump list, so looking somebody else up doesn't
  // mean going back to Customers first. The shell renders the list
  // (CustomerJump) because the shell renders the input it anchors to.
  jumpToCustomer: ((customerId: string) => void) | null;
  setJumpToCustomer: (jump: ((customerId: string) => void) | null) => void;
};

const HeaderSearchContext = createContext<HeaderSearchValue | null>(null);

export function HeaderSearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const [jumpToCustomer, setJumpToCustomer] = useState<
    ((customerId: string) => void) | null
  >(null);
  // STABLE, or the whole header search dies: this setter sits in the claiming
  // effect's deps, and when it was recreated inside the value memo, every
  // keystroke rebuilt it (query is a memo dep) → the effect re-ran → its
  // cleanup wiped the query. The box ate what you typed, live, 18 Aug 2026.
  // useState treats a bare function argument as an updater; the wrapper lets
  // a callback be STORED through the setter without being invoked.
  const storeJumpToCustomer = useCallback(
    (jump: ((customerId: string) => void) | null) => setJumpToCustomer(() => jump),
    [],
  );
  const value = useMemo(
    () => ({
      query,
      setQuery,
      placeholder,
      setPlaceholder,
      jumpToCustomer,
      setJumpToCustomer: storeJumpToCustomer,
    }),
    [query, placeholder, jumpToCustomer, storeJumpToCustomer],
  );
  return (
    <HeaderSearchContext.Provider value={value}>
      {children}
    </HeaderSearchContext.Provider>
  );
}

// What the header reads. Null placeholder = this tab has nothing to search, so
// no box is drawn at all rather than one that filters nothing.
export function useHeaderSearchSlot(): HeaderSearchValue {
  const context = useContext(HeaderSearchContext);
  if (!context) throw new Error("useHeaderSearchSlot outside HeaderSearchProvider");
  return context;
}

// What a view calls. Pass the placeholder to claim the header's box; pass null
// to stand down, which the appointments calendar does — searching a week grid
// means nothing, and a box that cannot act is worse than no box.
//
// onJumpToCustomer must be REFERENTIALLY STABLE (useCallback or a stable prop)
// — it sits in the claiming effect's deps, and a fresh identity every render
// would re-claim the slot in a loop.
export function useHeaderSearch(
  placeholder: string | null,
  onJumpToCustomer?: (customerId: string) => void,
): Search {
  const context = useContext(HeaderSearchContext);
  if (!context) throw new Error("useHeaderSearch outside HeaderSearchProvider");
  const { query, setQuery, setPlaceholder, setJumpToCustomer } = context;

  useEffect(() => {
    setPlaceholder(placeholder);
    setJumpToCustomer(onJumpToCustomer ?? null);
    // Clearing on the way out matters as much as claiming on the way in. A
    // query typed in Customers must not still be filtering the Inbox after a
    // tab switch, invisibly, because the box it was typed into is gone.
    return () => {
      setPlaceholder(null);
      setJumpToCustomer(null);
      setQuery("");
    };
  }, [placeholder, onJumpToCustomer, setPlaceholder, setJumpToCustomer, setQuery]);

  return useSearchFrom(query, setQuery);
}
