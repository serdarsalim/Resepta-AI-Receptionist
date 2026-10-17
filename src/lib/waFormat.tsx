import type { ReactNode } from "react";

// WhatsApp's markdown, rendered. Ported from Nudge as it stands (P10 of the
// port, 2026-10-17, with 0772ac98's token shield); Resepta's thread bubbles,
// their quotes and the WhatsApp face of the message preview use it.
//
// A body is stored and SENT as plain characters — `*bold*` goes to Meta with
// the asterisks in it, and WhatsApp applies the styling on delivery. So every
// surface that shows a message the way the contact will see it has to apply the
// same styling itself, or it is showing something the contact never gets.
// Nothing in this app did: the template editor's preview, the library preview,
// the contact card and the conversation all printed the raw markers (Serdar,
// 2026-09-19: "preview isn't showing bold, strikethrough and italic
// correctly"). One renderer, so they cannot disagree about what a message looks
// like.
//
// This deliberately matches WHATSAPP, not intuition. Two consequences worth
// knowing before "fixing" them:
//   - markers work mid-word. `actuall*y ... toolbo*x` really does bold
//     "y ... toolbo" in WhatsApp, odd as it reads.
//   - an unpaired marker is literal. One `*` in a line stays an asterisk.
//
// Order matters: ``` is tried first, because its fence is three of a character
// that means nothing on its own and would otherwise be eaten as an empty pair.
const RULES: {
  re: RegExp;
  // Monospace is LITERAL inside, as it is in WhatsApp: ```a*b*c``` shows the
  // asterisks. Caught by running the parser over a table of cases rather than
  // by looking at it, which is the only way this one shows up.
  raw?: true;
  wrap: (kids: ReactNode, key: string) => ReactNode;
}[] = [
  {
    re: /```([\s\S]+?)```/,
    raw: true,
    wrap: (kids, key) => (
      <code key={key} className="font-mono text-[0.95em]">
        {kids}
      </code>
    ),
  },
  {
    re: /\*([^*\n]+)\*/,
    wrap: (kids, key) => <strong key={key}>{kids}</strong>,
  },
  {
    re: /_([^_\n]+)_/,
    wrap: (kids, key) => <em key={key}>{kids}</em>,
  },
  {
    re: /~([^~\n]+)~/,
    wrap: (kids, key) => (
      <s key={key} className="line-through">
        {kids}
      </s>
    ),
  },
];

// How a run of plain text becomes nodes. The default is the text itself; the
// conversation passes one that wraps each run in <Highlight> so search marking
// and formatting compose instead of fighting over the same string.
export type LeafRenderer = (text: string, key: string) => ReactNode;

function parse(text: string, keyPrefix: string, leaf: LeafRenderer): ReactNode[] {
  // The EARLIEST match across all four rules wins, not the first rule that
  // happens to match anywhere. Scanning rule-by-rule would let a `*` late in
  // the line claim priority over an `_` at its start and nest them the wrong
  // way round.
  let best: { at: number; len: number; inner: string; ruleIdx: number } | null = null;
  RULES.forEach((rule, ruleIdx) => {
    const m = rule.re.exec(text);
    if (!m || m.index === undefined) return;
    if (best && m.index >= best.at) return;
    best = { at: m.index, len: m[0].length, inner: m[1], ruleIdx };
  });
  if (!best) return [leaf(text, `${keyPrefix}t`)];

  // TS narrows `best` to null inside the closure above, so read it once here.
  const hit: { at: number; len: number; inner: string; ruleIdx: number } = best;
  const before = text.slice(0, hit.at);
  const after = text.slice(hit.at + hit.len);
  return [
    ...(before ? [leaf(before, `${keyPrefix}b`)] : []),
    // Recurse INSIDE the match: WhatsApp nests, so `*_both_*` is bold italic.
    RULES[hit.ruleIdx].raw
      ? RULES[hit.ruleIdx].wrap(leaf(hit.inner, `${keyPrefix}r`), `${keyPrefix}${hit.at}`)
      : RULES[hit.ruleIdx].wrap(parse(hit.inner, `${keyPrefix}i`, leaf), `${keyPrefix}${hit.at}`),
    ...(after ? parse(after, `${keyPrefix}a`, leaf) : []),
  ];
}

// A [token] still in the text is a PLACEHOLDER: a preview with no contact
// picked shows the message as written. No send ever carries one, so its
// underscores are not WhatsApp markers, and "[meeting_date] at
// [meeting_time]" must not italicise " at " (2026-10-09). They are swapped
// for a private-use character while parsing and put back in every leaf.
const TOKEN_UNDERSCORE = "\uE000";
const TOKEN_UNDERSCORE_RE = /\uE000/g;

// Render a WhatsApp message body with its formatting applied. The caller still
// owns whitespace — every bubble in this app sets `whitespace-pre-wrap`, and
// this returns inline nodes only, so newlines survive untouched.
export function waFormat(text: string, leaf?: LeafRenderer): ReactNode {
  if (!text) return text;
  const base: LeafRenderer = leaf ?? ((t) => t);
  const shielded = text.replace(/\[[A-Za-z0-9_]+\]/g, (m) => m.replace(/_/g, TOKEN_UNDERSCORE));
  if (shielded === text) return parse(text, "w", base);
  return parse(shielded, "w", (t, key) => base(t.replace(TOKEN_UNDERSCORE_RE, "_"), key));
}
