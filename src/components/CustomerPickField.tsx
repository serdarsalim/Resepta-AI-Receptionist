"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { fieldClass } from "./Control";

// Pick one of this business's customers by typing part of a name, number or
// address (customers.quickSearch, two characters or more). Used where a test
// runs AS somebody: the voice agent's browser test and the chat simulator.
// The list is a portalled panel (AGENTS.md: popovers never position absolute
// inside a card), as wide as the field.

export type PickedCustomer = { id: Id<"customers">; name: string; phone: string };

export function CustomerPickField({
  value,
  onChange,
  disabled = false,
  placeholder,
  clearLabel,
}: {
  value: PickedCustomer | null;
  onChange: (next: PickedCustomer | null) => void;
  disabled?: boolean;
  placeholder: string;
  // What clearing the pick means here ("A new caller").
  clearLabel: string;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const term = query.trim();
  const results = useQuery(
    api.customers.quickSearch,
    !value && term.length >= 2 ? { q: term } : "skip",
  );
  const { triggerRef, panelRef, pos, show, close } = useAnchoredPanel<HTMLInputElement>(
    "trigger",
    240,
  );
  const hasResults = !!results && results.length > 0;
  useEffect(() => {
    if (hasResults) show();
    else close();
  }, [hasResults, show, close]);

  if (value) {
    return (
      <div className="flex min-h-8 min-w-0 items-center gap-2 text-sm">
        <span className="truncate">{value.name || value.phone}</span>
        <span className="shrink-0 text-xs text-[var(--muted)] tabular-nums">{value.phone}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange(null);
            setQuery("");
          }}
          aria-label={clearLabel}
          title={clearLabel}
          className="ml-auto shrink-0 rounded px-1.5 text-[var(--muted)] hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={triggerRef}
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        aria-label={t("agentTest.searchCustomer")}
        className={`${fieldClass("sm")} w-full`}
      />
      {pos &&
        results &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
            }}
            className="thin-scroll z-[100] max-h-60 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
          >
            {results.map((row) => (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onChange(row);
                  close();
                }}
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--control-hover)]"
              >
                <span className="truncate">{row.name || row.phone}</span>
                <span className="ml-auto shrink-0 text-xs text-[var(--muted)] tabular-nums">
                  {row.phone}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
