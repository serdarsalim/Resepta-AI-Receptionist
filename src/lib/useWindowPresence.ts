"use client";

// Is this person actually looking at the app right now?
//
// Two things depend on the honest answer, and both get it wrong in the same
// direction without it. Marking a conversation read tells the INBOX DOT that
// nothing is waiting; a read receipt tells the CUSTOMER that a human has seen
// their message. Firing either while the window sits behind a browser tab
// somebody left open all afternoon is a claim nobody made.
//
// Focus as well as visibility: a visible-but-unfocused window is a second
// monitor with the app parked on it, which is exactly the "open all day" case.

import { useEffect, useState } from "react";

export function useWindowPresence(): boolean {
  // Starts true so the first paint behaves like an ordinary open. The listener
  // below corrects it on the same tick if it is wrong — and a page nobody is
  // looking at does not usually get rendered in the first place.
  const [present, setPresent] = useState(true);

  useEffect(() => {
    const update = () =>
      setPresent(document.visibilityState === "visible" && document.hasFocus());
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);

  return present;
}
