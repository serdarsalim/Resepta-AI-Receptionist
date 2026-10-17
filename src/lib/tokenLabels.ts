// What a variable is CALLED versus what is STORED, and the round trip between
// them (P15, the Nudge port of src/lib/tokenLabels.ts).
//
// A message body stores tokens by their canonical English key
// (`[business]`, `[date]`, a contact field's own key), because a stored string
// cannot be right in three languages at once (lib/renderTokens). That key is
// not what a Turkish owner should have to read, so a labelled editor holds a
// DISPLAY string, `[İşletme adı]`, and the stored value keeps the key. The
// mirror that paints the chips renders the display string, the same text the
// textarea holds, which is the only reason the caret lands where you clicked.
//
// The mapping has to be one-to-one or the round trip loses tokens, so a label
// that is ambiguous or that spells another token falls back to the key.
// Better a plain-looking chip than a token that turns into a different one
// when you type beside it.
//
// Old bodies may carry the Turkish and German aliases renderTokens still
// honours (`[isletme]`, `[tarih]`). They show as their variable's chip, and
// the first edit stores the canonical key, which renders the same.

import { TOKEN_ALIASES } from "../../convex/lib/renderTokens";

export type TokenVariable = {
  // What gets STORED, e.g. "business".
  key: string;
  // What a person reads, e.g. "İşletme adı".
  label: string;
  // The @ menu's group heading. Entries keep the order given.
  group?: string;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type TokenLabelMap = {
  // key → the text that sits between the brackets while editing
  display: Map<string, string>;
  // normalised label → key
  reverse: Map<string, string>;
  // The bracket contents of a STORED token → its key, accepting a key in any
  // case and every alias renderTokens resolves to one of these variables.
  resolve: (inner: string) => string | undefined;
};

export function buildTokenLabelMap(variables: TokenVariable[]): TokenLabelMap {
  const keys = new Map<string, TokenVariable>();
  for (const v of variables) if (!keys.has(v.key.toLowerCase())) keys.set(v.key.toLowerCase(), v);

  // An alias reaches the first variable whose own key renders the same value.
  const byTarget = new Map<string, string>();
  for (const key of keys.keys()) {
    const target = TOKEN_ALIASES[key];
    if (target && !byTarget.has(target)) byTarget.set(target, keys.get(key)!.key);
  }
  const resolve = (inner: string): string | undefined => {
    const raw = norm(inner);
    const own = keys.get(raw);
    if (own) return own.key;
    const target = TOKEN_ALIASES[raw];
    return target ? byTarget.get(target) : undefined;
  };

  // Count first, decide second: deciding as we go would let whichever
  // variable came first keep a label its twin also claims.
  const labelCount = new Map<string, number>();
  for (const v of keys.values()) {
    const n = norm(v.label);
    if (n) labelCount.set(n, (labelCount.get(n) ?? 0) + 1);
  }

  const display = new Map<string, string>();
  const reverse = new Map<string, string>();
  for (const v of keys.values()) {
    const label = v.label.trim();
    const n = norm(label);
    const spelled = resolve(n);
    const usable =
      !!n &&
      n.length <= 32 &&
      // The brackets are the token's own punctuation; a label carrying one
      // would split the chip in half.
      !/[[\]{}\n]/.test(label) &&
      // Two fields called the same thing: neither may claim it.
      labelCount.get(n) === 1 &&
      // A label that spells another token would swallow that token.
      (spelled === undefined || spelled === v.key);
    if (!usable) continue;
    display.set(v.key, label);
    reverse.set(n, v.key);
  }
  return { display, reverse, resolve };
}

// A stored token: what renderTokens matches.
const STORED = /\[([^\]\n]{1,32})\]/g;
// A token being edited: anything printable between brackets.
export const SHOWN = /\[([^[\]\n]+)\]/g;

export function wrapToken(inner: string): string {
  return `[${inner}]`;
}

// Stored → what the editor shows. An unknown token is left exactly as
// written: that is how a typo stays visible, the same promise renderTokens
// makes.
export function storedToDisplay(stored: string, map: TokenLabelMap): string {
  return stored.replace(STORED, (whole, inner: string) => {
    const key = map.resolve(inner);
    const label = key ? map.display.get(key) : undefined;
    return label ? wrapToken(label) : whole;
  });
}

// What the editor shows → stored. A token typed by hand (`[business]`,
// `[isletme]`) stays as typed; a label goes back to its key.
export function displayToStored(shown: string, map: TokenLabelMap): string {
  return shown.replace(SHOWN, (whole, inner: string) => {
    if (inner.length <= 32 && map.resolve(inner)) return whole;
    const key = map.reverse.get(norm(inner));
    return key ? wrapToken(key) : whole;
  });
}

// The key behind a shown token, by either spelling, or undefined for text
// that only looks like one.
export function keyOfShown(inner: string, map: TokenLabelMap): string | undefined {
  return (inner.length <= 32 ? map.resolve(inner) : undefined) ?? map.reverse.get(norm(inner));
}
