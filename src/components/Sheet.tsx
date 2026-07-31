"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { InfoTip } from "./InfoTip";

// The one modal shell. Adding something is a sheet you open, never a pair of
// empty inputs parked at the foot of a list waiting for somebody to notice
// them — an empty field is a question the page is asking nobody, and it costs
// vertical space on every single visit to pay for a task you do twice a year.
//
// Full-width sheet from the bottom on a phone, centred card above sm. A salon
// owner adds a person from the counter phone more often than from a desk.
//
// Extracted from AppointmentModal, which still carries its own copy of this
// markup and should be moved onto this component next time it is touched.
export function Sheet({
  title,
  hint,
  wide = false,
  onClose,
  children,
}: {
  title: string;
  hint?: string;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Sheets can open another sheet (for example an agent detail opening a
      // variable editor). Only the topmost dialog owns Escape; otherwise one
      // keypress closes both layers because both listeners live on window.
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] === panelRef.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Focus lands inside the sheet so the first tab stays in it and a screen
    // reader starts where the sheet does.
    const preferred = panelRef.current?.querySelector<HTMLElement>("[data-sheet-autofocus]");
    const fallback = panelRef.current?.querySelector<HTMLElement>("input, select, button");
    (preferred ?? fallback)?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      // mousedown, not click: a drag that starts inside the panel and ends on
      // the backdrop must not close it.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl sm:rounded-2xl ${
          wide ? "sm:max-w-3xl" : "sm:max-w-md"
        }`}
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <InfoTip text={hint} />}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
