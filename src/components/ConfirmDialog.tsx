"use client";

// Destructive confirmations, in the app's own dialog rather than the
// browser's.
//
// window.confirm was doing this job, and it announces itself as
// "localhost:3006 says" — a chrome-coloured box that belongs to the browser,
// not the product, with two buttons whose order and wording we cannot touch.
// The one that deletes something should say what it deletes.
//
// Built on Sheet so it inherits the backdrop, Escape (topmost dialog only) and
// the focus landing inside, instead of a second implementation of all three.
//
// Exposed as a hook returning a promise, because the call sites read
// `if (!(await confirm(...))) return;` — one line, in the handler, in the
// order the reader thinks about it. A bare component would push every caller
// into holding a pending-action state of its own.

import { useCallback, useRef, useState } from "react";
import { Sheet } from "./Sheet";
import { useLanguage } from "@/lib/LanguageProvider";

type ConfirmRequest = {
  title: string;
  body?: string;
  // Defaults to the generic Delete. Say the verb the button performs.
  confirmLabel?: string;
  // Red button. On by default — everything routed through here is a deletion
  // today, and an accidental blue "Delete" is worse than a needless red one.
  destructive?: boolean;
};

export function useConfirm(): [
  (request: ConfirmRequest) => Promise<boolean>,
  React.ReactNode,
] {
  const { t } = useLanguage();
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  // Held in a ref, not state: resolving is not a render, and storing the
  // resolver in state would make every keystroke elsewhere a new promise.
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((request: ConfirmRequest) => {
    setPending(request);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = (ok: boolean) => {
    setPending(null);
    resolveRef.current?.(ok);
    resolveRef.current = null;
  };

  const dialog = pending ? (
    // Escape and backdrop both mean no. A dismissed confirmation that resolved
    // true would delete things by accident, so the cancel path is the default
    // and `onClose` is wired to it rather than left to unmount silently.
    <Sheet title={pending.title} onClose={() => settle(false)}>
      {pending.body && (
        <p className="text-sm text-[var(--muted)]">{pending.body}</p>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => settle(false)}
          className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          // The confirming button takes focus, not the cancel: somebody who
          // opened this meant to do the thing, and Escape is right there.
          data-sheet-autofocus
          onClick={() => settle(true)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors ${
            pending.destructive === false
              ? "bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90"
              : "bg-red-600 hover:bg-red-700"
          }`}
        >
          {pending.confirmLabel ?? t("common.delete")}
        </button>
      </div>
    </Sheet>
  ) : null;

  return [confirm, dialog];
}
