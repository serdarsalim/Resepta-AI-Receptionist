"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/LanguageProvider";

// The instructions textarea with @-completion for the agent's variables.
//
// The owner thinks in labels ("Customer name"), the provider speaks keys
// ("{{customer_name}}"). Typing @ opens a picker of labels and inserts the
// key form, and a chip strip under the editor reads the draft back in labels,
// so nobody has to remember or retype key syntax. A full token-pill editor
// (contentEditable) was considered and rejected: autosave, caret and paste
// behavior all get fragile, and the chip strip carries the readability win
// at a fraction of the risk.

export type PromptVariable = { key: string; label: string };

// Same Turkish folding as variable keys, so "müş" matches "musteri_adi".
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u");
}

// Where the caret is on screen, via a hidden mirror of the textarea. The
// mirror must copy every property that affects wrapping or the marker lands
// on the wrong line.
function caretViewportPos(textarea: HTMLTextAreaElement): { left: number; top: number } {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  for (const prop of [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "boxSizing",
  ] as const) {
    mirror.style[prop] = style[prop];
  }
  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.textContent = textarea.value.slice(0, textarea.selectionStart ?? 0);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const box = textarea.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || 18;
  const left = box.left + marker.offsetLeft - textarea.scrollLeft;
  const top = box.top + marker.offsetTop - textarea.scrollTop + lineHeight;
  mirror.remove();
  return {
    left: Math.min(Math.max(8, left), window.innerWidth - 240),
    top: Math.min(Math.max(8, top), window.innerHeight - 40),
  };
}

type Menu = {
  anchor: { left: number; top: number };
  start: number; // index of the "@" in the value
  fragment: string;
};

// A variable in the text is a THING, not the seven characters of punctuation
// around its name. The braces still occupy their exact width — the mirror's
// metrics have to match the real text underneath it character for character —
// but render transparent, so inside the tinted pill they read as its padding.
//
// NOTHING HERE MAY CHANGE A GLYPH'S ADVANCE WIDTH. The pill carried
// `font-medium` until 2026-08-21: in the mono prompt that is free (Geist Mono
// advances identically at 400 and 500), but the opening line is proportional
// Geist, where it made every pill 2.41px wider in the mirror than the real
// text underneath — so the caret drifted a pill's worth further left with
// each token and typing landed beside where the cursor stood. Colour and
// background are the emphasis; weight, size, letter-spacing and family are
// the textarea's to decide.
const TOKEN_RE = /(\{\{\s*[a-z0-9_]+\s*\}\})/gi;

function renderTokens(text: string) {
  return text.split(TOKEN_RE).map((part, i) => {
    const match = part.match(/^(\{\{\s*)([a-z0-9_]+)(\s*\}\})$/i);
    if (!match) return <span key={i}>{part}</span>;
    return (
      <span
        key={i}
        className="rounded bg-blue-100 text-blue-700 dark:bg-blue-500/25 dark:text-blue-300"
      >
        <span className="text-transparent">{match[1]}</span>
        {match[2]}
        <span className="text-transparent">{match[3]}</span>
      </span>
    );
  });
}

export function PromptEditor({
  value,
  onChange,
  variables,
  rows = 14,
  singleLine = false,
}: {
  value: string;
  onChange: (next: string) => void;
  variables: PromptVariable[];
  rows?: number;
  // One LOGICAL line that wraps and grows rather than scrolling off the right
  // edge — the opening line. Enter is swallowed and pasted newlines become
  // spaces, so the value stays one line and only the box gets taller. The
  // footer is dropped too: a hint and a chip row under a one-line field is
  // more chrome than field.
  singleLine?: boolean;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    if (!menu) return [];
    const needle = fold(menu.fragment.trim());
    const list = needle
      ? variables.filter(
          (row) => fold(row.label).includes(needle) || fold(row.key).includes(needle),
        )
      : variables;
    return list.slice(0, 8);
  }, [menu, variables]);

  const close = useCallback(() => {
    setMenu(null);
    setActive(0);
  }, []);

  // The @ trigger: an @ at a word boundary with the caret still on its line.
  // Reads the textarea directly, never the value prop: inside an input event
  // the prop still holds the previous render's text, which made the menu lag
  // one keystroke behind and miss the "@" itself.
  const detect = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    if (el.selectionEnd !== caret) return close();
    const before = el.value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0) return close();
    if (at > 0 && /[\w{}@]/.test(before[at - 1])) return close();
    const fragment = before.slice(at + 1);
    if (fragment.length > 40 || fragment.includes("\n")) return close();
    setMenu({ anchor: caretViewportPos(el), start: at, fragment });
    setActive(0);
  }, [close]);

  useEffect(() => {
    if (!menu) return;
    // Capture-phase so scrolls inside any ancestor close the menu (the
    // anchor moves with them) — but the menu's OWN scrollbar must not:
    // scrolling the list is using it, not leaving it.
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onResize = () => close();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [menu, close]);

  const insert = (variable: PromptVariable) => {
    const el = ref.current;
    if (!el || !menu) return;
    const caret = el.selectionStart ?? 0;
    const token = `{{${variable.key}}}`;
    const next = value.slice(0, menu.start) + token + value.slice(caret);
    onChange(next);
    close();
    const pos = menu.start + token.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const used = useMemo(() => {
    const byKey = new Map(variables.map((row) => [row.key, row.label]));
    const seen = new Set<string>();
    const chips: { key: string; label: string | null }[] = [];
    for (const match of value.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
      const key = match[1];
      if (seen.has(key)) continue;
      seen.add(key);
      chips.push({ key, label: byKey.get(key) ?? null });
    }
    return chips;
  }, [value, variables]);

  // Applied to BOTH layers, or the pills drift off the words they mark.
  //
  // EVERYTHING THAT DECIDES WHERE A LINE BREAKS BELONGS IN HERE. The two
  // layers only stay aligned while they wrap at exactly the same character,
  // and one line of divergence anywhere puts every line below it one row out
  // — the caret then sits on one line while typing edits the one above.
  //
  // The scrollbar is the one that bit. A textarea long enough to scroll grows
  // one INSIDE its content box, so it wrapped against 595px while the mirror,
  // overflow-hidden and barless, wrapped against 610. Measured, not assumed —
  // and the same measurement showed the two still landing on equal line counts
  // for one sample of this prompt, so the 15px is a divergence waiting for
  // text that breaks near the boundary rather than a guaranteed one.
  // stable-gutter reserves the track in BOTH layers, which closes it either
  // way.
  //
  // thin-scroll is the in-card rail the inbox and every other pane already
  // use: a 3px hairline that grows to 6px under the pointer, against Chrome's
  // default 15px slab. It also shrinks the reserved gutter to 9px, so the
  // alignment fix costs almost no width.
  //
  // Neither on the single line: the opening line is field-sized to its content
  // and never scrolls, so a reserved gutter there is just a gap on the right.
  //
  // whitespace and overflow-wrap sit here rather than on the mirror alone for
  // the same reason — a textarea's defaults are close enough to be invisible
  // until a long unbroken word disagrees.
  const fieldClass = `w-full rounded-lg border text-xs leading-relaxed whitespace-pre-wrap break-words ${
    singleLine ? "px-2 py-1.5" : "px-3.5 py-3 font-mono thin-scroll stable-gutter"
  }`;

  return (
    <div>
      <div className="relative w-full">
        {/* The pills live here, under a text-transparent textarea. A
            contenteditable would render them directly but takes the caret,
            undo stack and IME with it — this keeps a plain textarea. */}
        <div
          ref={mirrorRef}
          aria-hidden
          className={`${fieldClass} pointer-events-none absolute inset-0 overflow-hidden border-transparent`}
        >
          {renderTokens(value)}
          {/* Stops a trailing blank line collapsing out of the mirror. */}
          {"​"}
        </div>
        <textarea
        ref={ref}
        value={value}
        onChange={(event) => {
          onChange(singleLine ? event.target.value.replace(/\n/g, " ") : event.target.value);
          detect();
        }}
        onClick={detect}
        onBlur={() => setTimeout(close, 150)}
        onScroll={(event) => {
          const mirror = mirrorRef.current;
          if (!mirror) return;
          mirror.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          if (singleLine && event.key === "Enter" && !menu) {
            event.preventDefault();
            return;
          }
          if (!menu || matches.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => (index + 1) % matches.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => (index - 1 + matches.length) % matches.length);
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            insert(matches[active]);
          } else if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
        rows={singleLine ? 1 : rows}
        spellCheck={false}
        className={`${fieldClass} relative block border-[var(--border)] bg-transparent text-transparent caret-[var(--foreground)] ${
          singleLine ? "resize-none [field-sizing:content]" : ""
        }`}
      />
      </div>
      <div
        className={`mt-1 flex flex-wrap items-center gap-1.5 ${singleLine ? "hidden" : ""}`}
      >
        <span className="text-[11px] text-[var(--muted)]">{t("voiceDetail.atHint")}</span>
        {/* ONLY the tokens that will not resolve — a typo'd {{variabel}} gets
            spoken literally on a live call, and this is the one surface that
            catches it. Recognized tokens used to render here too, grey, and
            a healthy prompt wore a row of chips restating what the editor
            already highlights inline; the strip now stays empty until it has
            a problem to report. */}
        {used
          .filter((chip) => !chip.label)
          .map((chip) => (
            <span
              key={chip.key}
              title={t("voiceVariables.notConfigured")}
              className="rounded-md bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
            >
              {chip.key}
            </span>
          ))}
      </div>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            style={{ left: menu.anchor.left, top: menu.anchor.top }}
            className="fixed z-[60] max-h-48 w-64 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
          >
            {/* An empty menu still renders: silence after typing @ reads as
                broken. The row says where variables come from instead. */}
            {matches.length === 0 && (
              <div className="px-2.5 py-1.5 text-xs text-[var(--muted)]">
                {t("voiceDetail.atEmpty")}
              </div>
            )}
            {matches.map((row, index) => (
              <button
                key={row.key}
                type="button"
                // mousedown so the textarea's blur cannot close the menu
                // before the click lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  insert(row);
                }}
                onMouseEnter={() => setActive(index)}
                className={`flex w-full items-baseline justify-between gap-2 px-2.5 py-1.5 text-left text-xs ${
                  index === active ? "bg-[var(--muted-bg)]" : ""
                }`}
              >
                <span className="truncate">{row.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--muted)]">
                  {row.key}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
