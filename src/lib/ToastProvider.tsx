"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NoticeHost } from "./notices";

// Autosave is the right behaviour and the wrong feeling. Every settings field
// in this app commits on blur or on change with no Save button anywhere, which
// is correct — a Save button is a chance to lose work — but people who have
// spent twenty years with Save buttons do not believe a screen that says
// nothing. So the screen says something.
//
// One line, bottom centre, gone in two and a half seconds. Deliberately not a
// dismissible card: a toast you have to close is a dialog, and there is nothing
// here to decide. role="status" + aria-live="polite" so a screen reader hears
// the confirmation without having focus yanked out of the field just saved.

type Toast = { id: number; message: string };

const ToastContext = createContext<{ toast: (message: string) => void }>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext).toast;
}

const VISIBLE_MS = 2500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Monotonic rather than Date.now(): two saves inside one millisecond would
  // otherwise share a key and React would reuse the exiting node.
  const nextId = useRef(0);
  // Cleared on unmount so a timer cannot call setState against a dead tree.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const toast = useCallback((message: string) => {
    const id = (nextId.current += 1);
    setToasts((prev) => [...prev, { id, message }]);
    timers.current.push(
      setTimeout(() => {
        setToasts((prev) => prev.filter((entry) => entry.id !== id));
      }, VISIBLE_MS),
    );
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* The notes that outlive their caller (lib/notices), bottom-left. */}
      <NoticeHost />
      {/* pointer-events-none on the stack, so a toast that lands over a
          control never eats the click meant for it. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((entry) => (
          <div
            key={entry.id}
            className="animate-[toast-in_150ms_ease-out] rounded-full border border-[var(--border)] bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] shadow-lg"
          >
            {entry.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
