"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

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
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Focus lands inside the sheet so the first tab stays in it and a screen
    // reader starts where the sheet does.
    panelRef.current?.querySelector<HTMLElement>("input, select, button")?.focus();
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
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl sm:rounded-2xl"
      >
        <h2 className="mb-3 text-sm font-semibold">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
