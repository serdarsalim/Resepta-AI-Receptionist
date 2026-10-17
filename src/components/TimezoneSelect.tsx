"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { fieldClass } from "./Control";
// The table's search folding, not a second copy. It handles the dotted/dotless
// i BEFORE lowercasing — JS turns "İ" into i + a combining dot, so a fold that
// lowercases first never matches "İstanbul" typed on a Turkish keyboard, which
// is the one market this launches in.
import { foldSearch } from "@/lib/useTableState";

// Searchable timezone picker. Ported from Nudge's TimezoneSelect, with three
// changes it needed to belong here:
//
//  1. The panel PORTALS and positions fixed (useAnchoredPanel). Nudge's uses
//     `absolute`, which works there and would clip here — this control lives
//     in a Card inside the shell's overflow-hidden main pane, which is exactly
//     the ancestor AGENTS.md warns about. Copying it verbatim would have
//     imported a known bug.
//  2. There is no "not set" option. orgs.timezone is required and everything
//     dated reads through it; an org without one silently falls back to UTC
//     (getLocalPartsSafe), which for a Turkish salon is every reminder three
//     hours wrong and nothing on screen saying so.
//  3. Copy goes through the dictionary, since this app ships in three
//     languages.
//
// The list is Intl.supportedValuesOf("timeZone") — every IANA zone the
// browser knows, ~400 of them. That replaced a hardcoded five, which was fine
// while the only customers were Turkish and wrong the moment one was not.

function listTimezones(): string[] {
  type IntlWithSupported = typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  const intl = Intl as IntlWithSupported;
  return intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : [];
}

// "Europe/Istanbul" → "Istanbul". What the salon owner is looking for is the
// city; the region is a disambiguator, not the answer.
function cityFromIana(iana: string): string {
  const last = iana.split("/").pop() ?? iana;
  return last.replace(/_/g, " ");
}

function regionFromIana(iana: string): string {
  return iana.split("/")[0] ?? "";
}

const PANEL_MAX_H = 260;

export function TimezoneSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  // "trigger": the panel matches the field it hangs off. A narrow dropdown
  // under a full-width settings input reads as a rendering mistake.
  const { triggerRef, panelRef, pos, open, toggle, close } = useAnchoredPanel(
    "trigger",
    PANEL_MAX_H,
  );
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const zones = useMemo(() => listTimezones(), []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    // After paint: the portal's input does not exist until the panel renders.
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const filtered = useMemo(() => {
    const q = foldSearch(query.trim());
    if (!q) return zones;
    // Matches the city AND the full identifier, so "europe" finds the region
    // and "istanbul" finds the city.
    return zones.filter((tz) => foldSearch(`${cityFromIana(tz)} ${tz}`).includes(q));
  }, [query, zones]);

  const select = (tz: string) => {
    onChange(tz);
    close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        // The scale's sm field (Control.tsx), the look FIELD was matched to,
        // now at a declared height like the inputs beside it.
        className={`${fieldClass("sm")} inline-flex w-full items-center justify-between gap-2 transition-colors hover:bg-[var(--muted-bg)] disabled:cursor-not-allowed`}
      >
        <span className="truncate">{cityFromIana(value)}</span>
        <span
          aria-hidden
          className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", ...pos }}
            className="menu-surface z-[100] overflow-hidden rounded-lg text-sm text-[var(--foreground)]"
          >
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings.timezoneSearch")}
              className="block w-full border-0 border-b border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
            />
            <div
              className="thin-scroll overflow-y-auto p-1"
              style={{ maxHeight: PANEL_MAX_H }}
            >
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[var(--muted)]">
                  {t("settings.timezoneNone")}
                </div>
              ) : (
                filtered.map((tz) => (
                  <button
                    key={tz}
                    type="button"
                    onClick={() => select(tz)}
                    className={`flex w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--row-hover-bg)] ${
                      tz === value ? "bg-[var(--row-hover-bg)] font-medium" : ""
                    }`}
                  >
                    <span className="truncate">{cityFromIana(tz)}</span>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {regionFromIana(tz)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
