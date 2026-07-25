"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  COUNTRY_OPTIONS,
  findCountryByCode,
  formatCountryLabel,
  type CountryOption,
} from "@/lib/phone";
import { useLanguage } from "@/lib/LanguageProvider";

// The country dial-code picker, ported from Nudge (src/components/CountryCodeSelect.tsx)
// with two corrections that Randevu's own rules demand:
//
//   1. The panel PORTALS to document.body. Nudge renders it fixed but in place;
//      here every card and the shell's main pane are overflow-hidden scrollers,
//      and AGENTS.md is explicit that a floating panel goes through a portal.
//   2. Form controls sit at 16px, not 14px. Below that iOS Safari zooms the
//      viewport on focus and the salon owner is left panned halfway off screen.
//
// Everything else is Nudge's: same geometry constants, same flip-above rule,
// same outside-mousedown / Escape / capture-scroll close, same preventScroll
// focus, same flag + dial code trigger.

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
};

// Panel geometry. PANEL_W must match the rendered width below, it's what the
// viewport clamp is computed against.
const PANEL_W = 256; // 16rem
const PANEL_MAX_H = 300;
const MIN_PANEL_H = 180; // below this, flipping above is worth it
const GAP = 6; // trigger to panel
const EDGE = 8; // keep clear of the viewport edge

// Strings live here rather than in src/lib/i18n.ts because that dictionary is
// owned elsewhere right now. Same tr/en shape, so they lift straight into it.
const COPY = {
  pick: { tr: "Ülke kodu", en: "Country code" },
  search: { tr: "Ülke veya kod arayın", en: "Search country or code" },
  none: { tr: "Ülke bulunamadı", en: "No countries found" },
  noCode: { tr: "Kod yok", en: "No code" },
} as const;

// The "no country" sentinel: the one option with no ISO, and so no flag.
const NOT_SET: CountryOption = { name: "", code: "", iso: "" };

export function CountryCodeSelect({
  value,
  onChange,
  disabled,
  className,
  variant = "default",
}: Props) {
  const { language } = useLanguage();
  // Borders belong to containers, and a combobox trigger IS a form field: it
  // stands flush against the number input and the pair has to read as one
  // control. This is not the bordered-secondary-button case.
  const triggerCls =
    variant === "flag"
      ? "inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-2 text-base hover:bg-[var(--muted-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
      : "w-full inline-flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-base hover:bg-[var(--muted-bg)] disabled:opacity-50 disabled:cursor-not-allowed";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Viewport coordinates for the panel. It renders `fixed` inside a PORTAL, not
  // absolute: an absolutely-positioned 16rem panel hanging off a ~60px trigger
  // overflows whatever column it sits in, and `overflow-y-auto` makes that
  // column a horizontal scroller too (CSS promotes the other axis), so opening
  // the picker grew the scroll area and then focusing the search box scrolled
  // it into view, yanking the whole card sideways. Portal + fixed takes the
  // panel out of every clip context, so it can't contribute scrollWidth
  // anywhere and no overflow-hidden ancestor can crop it.
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);

  const selectedDigits = String(value ?? "").replace(/\D/g, "");
  const selected = useMemo(
    () => (selectedDigits ? findCountryByCode(selectedDigits) : null),
    [selectedDigits],
  );

  // Place the panel under the trigger, clamped into the viewport, flipping
  // above when there isn't room below. Recomputed on open and on resize.
  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const flip = below < MIN_PANEL_H && above > below;
    const maxH = Math.max(MIN_PANEL_H, Math.min(PANEL_MAX_H, flip ? above : below));
    setPos({
      top: flip ? r.top - GAP - maxH : r.bottom + GAP,
      left: Math.min(Math.max(EDGE, r.left), window.innerWidth - PANEL_W - EDGE),
      maxH,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // A fixed panel can't follow a scrolling ancestor, so close instead of
    // letting it drift away from its trigger. Capture catches inner scrollers.
    const onScroll = () => setOpen(false);
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (open) {
      setQuery("");
      place();
      // preventScroll is the other half of the fix: focusing the search box
      // otherwise asks the browser to scroll it into view, which is what
      // actually moved the card even before the panel overflowed anything.
      requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    } else {
      setPos(null);
    }
  }, [open, place]);

  const filtered = useMemo(() => {
    const all: CountryOption[] = [NOT_SET, ...COUNTRY_OPTIONS];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => `${c.name} ${c.code}`.toLowerCase().includes(q));
  }, [query]);

  const select = (code: string) => {
    onChange(code ? `+${code}` : "");
    setOpen(false);
  };

  const placeholder = COPY.pick[language];

  return (
    <div ref={containerRef} className={className}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={triggerCls}
        role="combobox"
        aria-expanded={open}
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
            style={{ top: pos.top, left: pos.left, width: PANEL_W }}
            className="fixed z-[100] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
            role="listbox"
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
            <div className="thin-scroll overflow-y-auto p-1" style={{ maxHeight: pos.maxH - 44 }}>
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
                      className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-[var(--muted-bg)] ${
                        isSelected ? "bg-[var(--muted-bg)] font-medium" : ""
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
