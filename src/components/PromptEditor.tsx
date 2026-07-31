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

export function PromptEditor({
  value,
  onChange,
  variables,
  rows = 14,
}: {
  value: string;
  onChange: (next: string) => void;
  variables: PromptVariable[];
  rows?: number;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLTextAreaElement>(null);
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
    const onAway = () => close();
    window.addEventListener("scroll", onAway, true);
    window.addEventListener("resize", onAway);
    return () => {
      window.removeEventListener("scroll", onAway, true);
      window.removeEventListener("resize", onAway);
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

  return (
    <div>
      <textarea
        ref={ref}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          detect();
        }}
        onClick={detect}
        onBlur={() => setTimeout(close, 150)}
        onKeyDown={(event) => {
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
        rows={rows}
        spellCheck={false}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 font-mono text-xs leading-relaxed"
      />
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-[var(--muted)]">{t("voiceDetail.atHint")}</span>
        {used.map((chip) => (
          <span
            key={chip.key}
            title={chip.label ?? t("voiceVariables.notConfigured")}
            className={`rounded-md px-1.5 py-0.5 text-[11px] ${
              chip.label
                ? "bg-[var(--muted-bg)]"
                : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
            }`}
          >
            {chip.label ?? chip.key}
          </span>
        ))}
      </div>
      {menu &&
        createPortal(
          <div
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
