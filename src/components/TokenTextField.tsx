"use client";

// A plain-text message field whose variables read as CHIPS carrying their
// label and are inserted by typing "@" (P15, the Nudge port of
// TokenTextField). Used by every plain-text box that holds tokens: the message
// rule's body, a campaign's line, a bulk message.
//
// Two layers, exactly aligned: a mirror div paints the chips, the real
// <textarea> sits on top with transparent text and a visible caret. It holds
// only while both layers wrap identically, which is why they share one
// `fieldClass`, the same gutter, and the phone's 16px rule (`token-mirror` in
// globals.css).
//
// The field EDITS a display string and REPORTS a stored one (lib/tokenLabels):
// the chip reads "İşletme adı" while `[business]` is what is saved and sent.

import { useEffect, useMemo, useRef, useState } from "react";
import { caretViewportPos } from "@/lib/caretPosition";
import { atFragment, matchTokenVariables, TokenSuggestMenu } from "./TokenSuggestMenu";
import {
  buildTokenLabelMap,
  displayToStored,
  keyOfShown,
  SHOWN,
  storedToDisplay,
  wrapToken,
  type TokenLabelMap,
  type TokenVariable,
} from "@/lib/tokenLabels";

export type TokenTextFieldHandle = {
  // Insert STORED text at the caret: a `[token]` from the dropdown, an emoji.
  // Returns the new stored value, so a caller that autosaves can pass it
  // along before React has re-rendered.
  insert: (stored: string) => string;
  focus: () => void;
};

// The field's look, applied to BOTH layers so their metrics match exactly:
// the base form styles (globals.css) reach the textarea only, so the box is
// spelled out here.
export const TOKEN_FIELD_CLASS =
  "rounded-lg border px-3 py-2 text-sm leading-5";

type Part = { text: string; inner?: string };

function splitTokens(text: string): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(SHOWN)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i) });
    out.push({ text: m[0], inner: m[1] });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

// The chip's LABEL floats over the transparent stored text, centred and
// clipped to it, so the pill is exactly the token's own width and the caret
// (painted by the textarea) lands where the text is. An unrecognised token
// stays plain: it ships literally, and dressing it as a chip is how a typo
// hides.
function renderParts(text: string, map: TokenLabelMap) {
  return splitTokens(text).map((part, i) => {
    const key = part.inner === undefined ? undefined : keyOfShown(part.inner, map);
    if (part.inner === undefined || !key) return <span key={i}>{part.text}</span>;
    return (
      <span key={i} className="relative rounded bg-blue-100 text-transparent dark:bg-blue-500/25">
        {part.text}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden whitespace-nowrap font-medium text-blue-700 dark:text-blue-300"
        >
          {map.display.get(key) ?? part.inner}
        </span>
      </span>
    );
  });
}

const TOKEN_BEFORE = /\[[^[\]\n]+\]$/;
const TOKEN_AFTER = /^\[[^[\]\n]+\]/;

type AtMenu = {
  anchor: { left: number; top: number };
  start: number;
  fragment: string;
};

export function TokenTextField({
  value,
  onChange,
  onBlur,
  variables,
  handleRef,
  rows = 3,
  placeholder,
  disabled = false,
  ariaLabel,
}: {
  // STORED value, `[business]`, never the label.
  value: string;
  onChange: (nextStored: string) => void;
  onBlur?: (stored: string) => void;
  // What "@" offers, in the order it should be offered.
  variables: TokenVariable[];
  handleRef?: React.MutableRefObject<TokenTextFieldHandle | null>;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const backRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<AtMenu | null>(null);
  const [active, setActive] = useState(0);
  const focused = useRef(false);

  const map = useMemo(() => buildTokenLabelMap(variables), [variables]);
  const [shown, setShown] = useState(() => storedToDisplay(value, map));

  // Keep the display in step with the stored value WITHOUT rewriting it under
  // the cursor. While focused only a genuine outside change re-seeds it;
  // unfocused, the display also re-derives when the variables finally load,
  // which is what turns `[business]` into a labelled chip on a cold page.
  useEffect(() => {
    if (displayToStored(shown, map) === value) {
      if (focused.current) return;
      const next = storedToDisplay(value, map);
      if (next !== shown) setShown(next);
      return;
    }
    setShown(storedToDisplay(value, map));
    // `shown` is deliberately not a dependency: this reconciles the INCOMING
    // value, and re-running it on every keystroke is how a caret jumps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, map]);

  const push = (nextShown: string) => {
    setShown(nextShown);
    onChange(displayToStored(nextShown, map));
  };

  const openAt = (el: HTMLTextAreaElement) => {
    if (!variables.length) return;
    const caret = el.selectionStart ?? 0;
    const hit = atFragment(el.value.slice(0, caret));
    if (!hit) return setMenu(null);
    setActive(0);
    setMenu({ anchor: caretViewportPos(el), start: hit.start, fragment: hit.fragment });
  };

  const matches = useMemo(
    () => (menu ? matchTokenVariables(variables, menu.fragment) : []),
    [menu, variables],
  );

  const placeCaret = (pos: number) => {
    const el = fieldRef.current;
    // React has to have rewritten the value first, or the position is set
    // against the old text and jumps.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const accept = (v: TokenVariable) => {
    if (!menu) return;
    const el = fieldRef.current;
    const caret = el?.selectionStart ?? menu.start + menu.fragment.length + 1;
    const text = wrapToken(map.display.get(v.key) ?? v.key);
    push(`${shown.slice(0, menu.start)}${text}${shown.slice(caret)}`);
    setMenu(null);
    placeCaret(menu.start + text.length);
  };

  const insertStored = (stored: string): string => {
    const el = fieldRef.current;
    const text = storedToDisplay(stored, map);
    const start = el?.selectionStart ?? shown.length;
    const end = el?.selectionEnd ?? shown.length;
    const next = shown.slice(0, start) + text + shown.slice(end);
    push(next);
    placeCaret(start + text.length);
    return displayToStored(next, map);
  };

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      insert: insertStored,
      focus: () => fieldRef.current?.focus(),
    };
    return () => {
      handleRef.current = null;
    };
  });

  // A token deletes as ONE thing: backspace flush against a chip used to eat
  // one bracket and leave text that is no longer a token. Only for a collapsed
  // caret against a COMPLETE token; a selection, or a caret inside the name,
  // still edits character by character.
  const onKeyDownToken = (e: React.KeyboardEvent): boolean => {
    if (e.key !== "Backspace" && e.key !== "Delete") return false;
    const el = fieldRef.current;
    if (!el) return false;
    const start = el.selectionStart ?? 0;
    if (start !== (el.selectionEnd ?? 0)) return false;
    const m =
      e.key === "Backspace"
        ? shown.slice(0, start).match(TOKEN_BEFORE)
        : shown.slice(start).match(TOKEN_AFTER);
    if (!m) return false;
    const inner = m[0].slice(1, -1);
    if (!keyOfShown(inner, map)) return false;
    e.preventDefault();
    const from = e.key === "Backspace" ? start - m[0].length : start;
    push(shown.slice(0, from) + shown.slice(from + m[0].length));
    setMenu(null);
    placeCaret(from);
    return true;
  };

  const onKeyDownMenu = (e: React.KeyboardEvent): boolean => {
    if (!menu || !matches.length) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % matches.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + matches.length) % matches.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(matches[active]);
      return true;
    }
    if (e.key === "Escape") {
      // Stopped here so a sheet the field sits in does not close with it.
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
      return true;
    }
    return false;
  };

  // THE SCROLLBAR IS PART OF THE BOX METRICS. The textarea scrolls once the
  // text outgrows its rows; the mirror never does. A classic scrollbar takes
  // width from the textarea and nothing from the overflow-hidden mirror, so
  // the two would wrap at different points and the caret would sit lines away
  // from the text. Both reserve the same gutter.
  const gutter = "thin-scroll stable-gutter";

  return (
    <div className="relative w-full rounded-lg bg-[var(--card)]">
      <div
        ref={backRef}
        aria-hidden
        className={`${TOKEN_FIELD_CLASS} token-mirror pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words border-transparent ${gutter}`}
      >
        {renderParts(shown, map)}
        {/* Keeps a trailing empty line from collapsing out of the mirror. */}
        {"​"}
      </div>
      <textarea
        ref={fieldRef}
        value={shown}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        spellCheck={false}
        onClick={(e) => openAt(e.currentTarget)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          setMenu(null);
          onBlur?.(displayToStored(shown, map));
        }}
        onScroll={(e) => {
          const b = backRef.current;
          if (b) b.scrollTop = e.currentTarget.scrollTop;
          // A fixed menu would detach from a caret that just scrolled.
          setMenu(null);
        }}
        onChange={(e) => {
          push(e.target.value);
          openAt(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (onKeyDownMenu(e)) return;
          onKeyDownToken(e);
        }}
        // resize-y, not both: dragging sideways would widen the textarea
        // while the mirror stays pinned to the wrapper.
        className={`${TOKEN_FIELD_CLASS} relative block w-full resize-y border-[var(--border)] bg-transparent text-transparent caret-[var(--foreground)] placeholder:text-[var(--muted)] ${gutter}`}
      />
      {menu && (
        <TokenSuggestMenu
          anchor={menu.anchor}
          matches={matches}
          active={active}
          onPick={accept}
          onHover={setActive}
        />
      )}
    </div>
  );
}
