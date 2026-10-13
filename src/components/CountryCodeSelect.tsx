"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import {
  countryOptions,
  findCountryByCode,
  formatCountryLabel,
  type CountryOption,
} from "@/lib/phone";
import { useLanguage } from "@/lib/LanguageProvider";
import type { Language } from "@/lib/i18n";
import { fieldClass, type ControlSize } from "./Control";

// The country dial-code picker, ported from Nudge (src/components/CountryCodeSelect.tsx)
// with two corrections that Resepta's own rules demand:
//
//   1. The panel PORTALS to document.body. Nudge renders it fixed but in place;
//      here every card and the shell's main pane are overflow-hidden scrollers,
//      and AGENTS.md is explicit that a floating panel goes through a portal.
//   2. Form controls sit at 16px, not 14px. Below that iOS Safari zooms the
//      viewport on focus and the salon owner is left panned halfway off screen.
//
// Everything else is Nudge's: same geometry constants, same flip-above rule,
// same outside-mousedown / Escape close, same preventScroll focus, same flag +
// dial code trigger. One more correction since 2026-10-13: the panel FOLLOWS
// the trigger when an ancestor scrolls (useAnchoredPanel) instead of closing,
// so the record's phone row can be scrolled into view with the list open.

type Props = {
  // Selected country prefix in "+digits" form (e.g. "+90"), or null/empty for none.
  value: string | null | undefined;
  // Emits "+digits" on selection or "" when cleared.
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  // "flag" shrinks the trigger to flag + dial code + chevron, for sitting flush
  // against a phone-number input. Default keeps the bordered form-field look
  // with the country spelled out.
  variant?: "default" | "flag";
  // The control scale's field height (Control.tsx), for a form whose other
  // fields wear it: the booking sheet. Unset keeps the 16px public-page size
  // the booking page's phone row was measured at.
  size?: ControlSize;
};

// Panel geometry. PANEL_W must match the rendered width below, it's what the
// viewport clamp is computed against.
const PANEL_W = 256; // 16rem
const PANEL_MAX_H = 300;
const MIN_PANEL_H = 180; // below this, flipping above is worth it
const GAP = 6; // trigger to panel; the 8px viewport margin is the hook's

// Strings live here rather than in src/lib/i18n.ts because that dictionary is
// owned elsewhere right now. Same shape as its entries, typed against the same
// Language union, so adding a language column there breaks this file too and
// these lift straight in when the file is free.
const COPY: Record<string, Record<Language, string>> = {
  pick: { tr: "Ülke kodu", en: "Country code", de: "Ländervorwahl" },
  search: {
    tr: "Ülke veya kod arayın",
    en: "Search country or code",
    de: "Land oder Vorwahl suchen",
  },
  none: { tr: "Ülke bulunamadı", en: "No countries found", de: "Keine Länder gefunden" },
  noCode: { tr: "Kod yok", en: "No code", de: "Keine Vorwahl" },
};

// The "no country" sentinel: the one option with no ISO, and so no flag.
const NOT_SET: CountryOption = { name: "", code: "", iso: "" };

export function CountryCodeSelect({
  value,
  onChange,
  disabled,
  className,
  variant = "default",
  size,
}: Props) {
  const { language } = useLanguage();
  // Borders belong to containers, and a combobox trigger IS a form field: it
  // stands flush against the number input and the pair has to read as one
  // control. This is not the bordered-secondary-button case.
  const triggerCls = size
    ? variant === "flag"
      ? `${fieldClass(size)} inline-flex shrink-0 items-center gap-1 hover:bg-[var(--muted-bg)] disabled:cursor-not-allowed`
      : `${fieldClass(size)} inline-flex w-full items-center justify-between gap-2 hover:bg-[var(--muted-bg)] disabled:cursor-not-allowed`
    : variant === "flag"
      ? "inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-2 text-base hover:bg-[var(--muted-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
      : "w-full inline-flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-base hover:bg-[var(--muted-bg)] disabled:opacity-50 disabled:cursor-not-allowed";

  // The listbox needs a stable id so the trigger can point aria-controls at
  // it; useId keeps two pickers on one page from colliding.
  const listId = useId();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // It renders `fixed` inside a PORTAL, not absolute: an absolutely-positioned
  // 16rem panel hanging off a ~60px trigger overflows whatever column it sits
  // in, and `overflow-y-auto` makes that column a horizontal scroller too (CSS
  // promotes the other axis), so opening the picker grew the scroll area and
  // then focusing the search box scrolled it into view, yanking the whole card
  // sideways. Portal + fixed takes the panel out of every clip context, so it
  // can't contribute scrollWidth anywhere and no overflow-hidden ancestor can
  // crop it. Flips above when there is less than MIN_PANEL_H below and more
  // room above; `room` is what the side it opened on can hold.
  const { triggerRef, panelRef, pos, room, open, toggle, close } = useAnchoredPanel(
    PANEL_W,
    MIN_PANEL_H - 12,
    "left",
    { gap: GAP },
  );
  const maxH = Math.max(MIN_PANEL_H, Math.min(PANEL_MAX_H, room));

  const selectedDigits = String(value ?? "").replace(/\D/g, "");
  const selected = useMemo(
    () => (selectedDigits ? findCountryByCode(selectedDigits) : null),
    [selectedDigits],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    // preventScroll is the other half of the fix above: focusing the search
    // box otherwise asks the browser to scroll it into view, which is what
    // actually moved the card even before the panel overflowed anything.
    const raf = requestAnimationFrame(() =>
      searchRef.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const filtered = useMemo(() => {
    const all: CountryOption[] = [NOT_SET, ...countryOptions(language)];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) =>
      (c.search ?? `${c.name} ${c.code}`.toLowerCase()).includes(q),
    );
    // language matters: the list is labelled AND sorted in it.
  }, [query, language]);

  const select = (code: string) => {
    onChange(code ? `+${code}` : "");
    close();
  };

  const placeholder = COPY.pick[language];

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={triggerCls}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={placeholder}
      >
        {variant === "flag" ? (
          // Flag AND dial code. The flag alone made the trigger compact but the
          // number unreadable: you'd be editing "5321234567" with no way to see
          // which country it was about to be sent to. FlagByIso still brings
          // the hover tooltip naming the country.
          selected ? (
            <span className="inline-flex items-center gap-1.5">
              <FlagByIso iso={selected.iso} label={selected.name} />
              <span className="tabular-nums">+{selectedDigits}</span>
            </span>
          ) : (
            <span className="text-[var(--muted)]">{placeholder}</span>
          )
        ) : (
          <span className={`truncate ${selectedDigits ? "" : "text-[var(--muted)]"}`}>
            {formatCountryLabel(selectedDigits) || placeholder}
          </span>
        )}
        <span
          aria-hidden
          className={`text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: PANEL_W }}
            className="fixed z-[100] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
            role="listbox"
            id={listId}
          >
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={COPY.search[language]}
              aria-label={COPY.search[language]}
              className="block w-full rounded-none border-0 border-b border-[var(--border)] bg-[var(--background)] px-3 py-2 text-base outline-none"
            />
            <div className="thin-scroll overflow-y-auto p-1" style={{ maxHeight: maxH - 44 }}>
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-[var(--muted)]">
                  {COPY.none[language]}
                </div>
              ) : (
                filtered.map((c) => {
                  const isSelected = c.code === selectedDigits;
                  return (
                    <button
                      key={c.code ? `${c.iso}-${c.code}` : "__none__"}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => select(c.code)}
                      className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-[var(--row-hover-bg)] ${
                        isSelected ? "bg-[var(--row-hover-bg)] font-medium" : ""
                      }`}
                    >
                      {c.iso ? (
                        <span className={`fi fi-${c.iso} shrink-0 rounded-[2px]`} aria-hidden />
                      ) : (
                        <span className="w-[1.33333em] shrink-0" aria-hidden />
                      )}
                      <span className="min-w-0 truncate">
                        {c.code ? `${c.name} (+${c.code})` : COPY.noCode[language]}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// A flag from an ISO code, with a hover tooltip naming the country: a bare flag
// answers "where?" only if you already know the flag.
//
// flag-icons CSS sprites (<span class="fi fi-tr">), never Unicode flag emoji.
// Windows Chrome has no flag glyphs and renders those as the bare letters "TR",
// which is why this rule exists.
//
// The tooltip goes through a portal with fixed positioning, the same shape as
// InfoTip, and is only mounted while shown. An absolute tooltip gets clipped by
// the contact card, and a hidden one with a layout box inflates the card's
// scroll width into a phantom scrollbar.
const FLAG_TIP_W = 180; // used for the viewport clamp only

export function FlagByIso({ iso, label }: { iso: string; label: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const centred = r.left + r.width / 2 - FLAG_TIP_W / 2;
    setPos({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(centred, window.innerWidth - FLAG_TIP_W - 8)),
    });
  };
  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      className="inline-flex shrink-0 items-center align-middle"
    >
      <span className={`fi fi-${iso} rounded-[2px]`} role="img" aria-label={label} />
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ position: "fixed", width: FLAG_TIP_W, ...pos }}
            className="pointer-events-none z-[100] rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-center text-xs text-[var(--foreground)] shadow-lg"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
