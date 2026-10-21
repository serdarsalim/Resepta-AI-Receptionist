"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { fieldClass } from "./Control";
import { HoverTip } from "./HoverTip";

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

  // The pick stays INSIDE the field's box, with an × to clear it: the
  // combobox shape (a picked value sits in the control that picked it), so a
  // row of fields keeps its shape whether or not someone is chosen (Nudge's
  // test panel, 2026-09-20). The × goes while the field is disabled, which on
  // the browser test is a call in progress.
  if (value) {
    return (
      <div className={`${fieldClass("sm")} flex w-full min-w-0 items-center gap-2`}>
        <span className="min-w-0 flex-1 truncate">{value.name || value.phone}</span>
        {value.name && (
          <span className="shrink-0 text-xs text-[var(--muted)] tabular-nums">{value.phone}</span>
        )}
        {!disabled && (
          <HoverTip text={clearLabel} className="inline-flex shrink-0">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setQuery("");
              }}
              aria-label={clearLabel}
              className="-mr-1 shrink-0 rounded px-1 text-base leading-none text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              ×
            </button>
          </HoverTip>
        )}
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
            className="menu-surface thin-scroll z-[100] max-h-60 overflow-y-auto rounded-lg py-1"
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
