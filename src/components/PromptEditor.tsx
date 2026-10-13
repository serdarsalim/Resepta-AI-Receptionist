"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";

// The instructions textarea with @-completion for the agent's variables.
//
// The owner thinks in labels ("Customer name"), the provider speaks keys
// ("{{customer_name}}"), and since 2026-08-25 the owner never sees a key: the
// textarea holds label form and it is translated to key form at the boundary.
// See "The two faces of one prompt" below for how, and why that is not the
// contentEditable token-pill editor this file has twice refused to become.

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

// Where the caret's line is on screen, via a hidden mirror of the textarea.
// The mirror must copy every property that affects wrapping or the marker
// lands on the wrong line. A zero-width rect one line tall: useAnchoredPanel
// hangs the @ menu under it, or over it near the bottom of the screen, and
// re-reads it as the page scrolls.
function caretRect(textarea: HTMLTextAreaElement): DOMRect {
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
  const top = box.top + marker.offsetTop - textarea.scrollTop;
  mirror.remove();
  return new DOMRect(left, top, 0, lineHeight);
}

type Menu = {
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
// Anything between braces that is not itself a brace or a newline. It used to
// be [a-z0-9_]+, which was the KEY alphabet — the editor now speaks labels, and
// "Business name" has a space in it.
const TOKEN_RE = /(\{\{\s*[^{}\n]+?\s*\}\})/g;
const TOKEN_PARTS = /^(\{\{\s*)([^{}\n]+?)(\s*\}\})$/;

// ── The two faces of one prompt ──────────────────────────────────────────────
//
// STORED is key form, "{{business_name}}", and it is what the parent holds,
// what the draft saves and what Retell receives. DISPLAYED is label form,
// "{{Business name}}", and it exists only inside this textarea.
//
// Serdar, on being told the mirror could not paint labels over keys: "we send
// retell still business_name that's fine but we don't have to see business_name
// ourselves no?!?" He was right and the objection was answerable. The mirror
// cannot paint a string of one width over a string of another, so the fix is
// not to paint over anything — put the LABEL in the textarea itself, and
// translate at the boundary. The mirror then matches character for character
// because it is rendering the same text the caret is walking through.
//
// The round trip has to be identity or the value changes under the cursor:
// toStored(toDisplayed(x)) === x for every known variable, and anything
// unrecognised passes through untouched in both directions, which is also what
// keeps a half-typed "{{Business nam" from being rewritten mid-keystroke.
//
// This is why labels have to be unique (Serdar again, one message earlier —
// he had the answer before I did). Two variables sharing a label would make
// the way back ambiguous, so the map is built label-first and an exact match
// is required; a duplicate silently keeps whichever came first and the other
// stays literal, which shows up as an unresolved token rather than as a
// wrong one.
function tokenMaps(variables: PromptVariable[]) {
  const byKey = new Map<string, string>();
  const byLabel = new Map<string, string>();
  for (const row of variables) {
    if (!byKey.has(row.key)) byKey.set(row.key, row.label);
    if (!byLabel.has(row.label)) byLabel.set(row.label, row.key);
  }
  return { byKey, byLabel };
}

function swapTokens(text: string, lookup: Map<string, string>): string {
  return text.replace(TOKEN_RE, (whole) => {
    const parts = whole.match(TOKEN_PARTS);
    if (!parts) return whole;
    const found = lookup.get(parts[2]);
    return found === undefined ? whole : `{{${found}}}`;
  });
}

function renderTokens(text: string, known: Set<string>) {
  return text.split(TOKEN_RE).map((part, i) => {
    const match = part.match(TOKEN_PARTS);
    if (!match) return <span key={i}>{part}</span>;
    // An unrecognised token stays plain text rather than wearing the pill: a
    // typo that looks like a variable is the one thing this highlight exists
    // to expose, and tinting it would hide it.
    if (!known.has(match[2])) return <span key={i}>{part}</span>;
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
  const [menu, setMenu] = useState<Menu | null>(null);
  const [active, setActive] = useState(0);
  // The @ menu hangs off the CARET, through the shared hook: the textarea is
  // its trigger (a click in it is not an outside click), the caret's line is
  // what it measures, and it follows when the page scrolls. It closed on any
  // scroll until 2026-10-13, so scrolling a long prompt to see the line you
  // were typing on took the menu away mid-word.
  const {
    panelRef: menuRef,
    pos: menuPos,
    open: menuShown,
    show: showMenu,
    close: hideMenu,
  } = useAnchoredPanel<HTMLTextAreaElement>(256, 192, "left", {
    triggerRef: ref,
    anchorRect: () => (ref.current ? caretRect(ref.current) : null),
  });
  // What the keyboard and the panel act on: a fragment is being typed AND the
  // panel is up. The hook can drop the panel on its own (an outside click, the
  // caret's line scrolled off screen) while `menu` still holds the fragment.
  const menuOpen = menu !== null && menuShown;

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

  // The label form the textarea actually holds. Everything below that touches
  // text — the mirror, the caret, @-insert, the selection maths — works in
  // THIS string; `value` and `onChange` stay key form so nothing outside this
  // component learns that labels exist.
  const { byKey, byLabel } = useMemo(() => tokenMaps(variables), [variables]);
  const displayed = useMemo(() => swapTokens(value, byKey), [value, byKey]);
  const knownLabels = useMemo(
    () => new Set(variables.map((row) => row.label)),
    [variables],
  );

  const close = useCallback(() => {
    setMenu(null);
    setActive(0);
    hideMenu();
  }, [hideMenu]);

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
    setMenu({ start: at, fragment });
    setActive(0);
    // Opens the panel, or moves it to where the caret is now.
    showMenu();
  }, [close, showMenu]);

  const insert = (variable: PromptVariable) => {
    const el = ref.current;
    if (!el || !menuOpen || !menu) return;
    const caret = el.selectionStart ?? 0;
    // The LABEL goes in, and menu.start indexes the textarea, so both sides of
    // the splice have to come from the textarea too — slicing `value` here
    // would cut key-form text at a label-form offset.
    const token = `{{${variable.label}}}`;
    const source = el.value;
    const next = source.slice(0, menu.start) + token + source.slice(caret);
    onChange(swapTokens(next, byLabel));
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
          {renderTokens(displayed, knownLabels)}
          {/* Stops a trailing blank line collapsing out of the mirror. */}
          {"​"}
        </div>
        <textarea
        ref={ref}
        value={displayed}
        onChange={(event) => {
          const next = singleLine
            ? event.target.value.replace(/\n/g, " ")
            : event.target.value;
          onChange(swapTokens(next, byLabel));
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
          if (singleLine && event.key === "Enter" && !menuOpen) {
            event.preventDefault();
            return;
          }
          if (!menuOpen || matches.length === 0) return;
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
      {menuOpen &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              left: menuPos.left,
              top: menuPos.top,
              bottom: menuPos.bottom,
              width: menuPos.width,
            }}
            className="fixed z-[60] max-h-48 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
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
                  index === active ? "bg-[var(--row-hover-bg)]" : ""
                }`}
              >
                {/* The label alone. It carried the key beside it for people
                    who had to type key syntax, and nobody types it now
                    (Serdar: "why do we need to see both key and label??"). */}
                <span className="truncate">{row.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
