// The agent's first sentence, chosen and written by Resepta at ring time
// (P34 of the Nudge port, 2026-10-18; Nudge's lib/opener.ts and
// lib/callVariables.ts). A LEAF with no imports: retell.beforeCallContext
// renders it, the publish path strips it into the provider's fallback, and
// scripts/opener.test.mjs reads it directly.
//
// Why Resepta writes it and not the prompt: the provider's opening line is a
// fixed string. Nudge's June Mcclurg was called three days after saying yes
// and still heard the cold line, with everything she had said injected
// below it: what the agent knows governs what it says AFTER the first
// sentence, never the first sentence. Resepta knows the same facts while the
// phone rings, so Resepta writes the sentence into {{opener}}, and the owner
// puts {{opener}} in the opening line where it should be said.
//
// Four sentences per agent, all the business's own words
// (retellAgents.openers), and ONE choice:
//   a call we place, after a real CONVERSATION (customers.lastConversationAt)
//     → followUp, "we spoke {{when}}";
//   a call we place, after only ATTEMPTS nobody took
//     (customers.lastCallAttemptAt) → missed, "I tried you {{when}}";
//   a call that comes IN → inbound;
//   anything else, or the chosen one left empty → cold;
//   cold empty too → the template's own greeting tail ("buyurun."), so an
//     opening line of "{{business_name}}, {{opener}}" never reads "Bella, ."
// A six-second hang-up used to earn "we spoke yesterday" in Nudge, which is
// why the two clocks are separate.
//
// Syntax, the agent page's own: {{key}} is any ring-time variable plus
// {{when}}; a clause wrapped in [[ … ]] is dropped whole when a variable in it
// is blank, so "[[about your {{next_appointment}} appointment]]" vanishes
// cleanly instead of reading "about your  appointment".

export const OPENER_KEY = "opener";

export type AgentOpeners = {
  cold?: string;
  followUp?: string;
  missed?: string;
  inbound?: string;
};

export type OpenerKind = "followUp" | "missed" | "inbound" | "cold" | "default";

type Lang = "tr" | "en" | "de";

function lang(language: string | null | undefined): Lang {
  const code = (language ?? "").trim().toLowerCase().slice(0, 2);
  return code === "tr" || code === "de" ? code : "en";
}

const LOCALE: Record<Lang, string> = { tr: "tr-TR", en: "en-GB", de: "de-DE" };

// How long ago, in words a person would say, in the agent's language. The
// buckets must not flatter the gap: until Nudge 0095eb5 every gap from two
// to six weeks read "a couple of weeks ago", and a customer called 42 days
// on heard a first sentence that was off by a month.
export function whenPhrase(
  days: number,
  language: string | null | undefined,
  now: number = Date.now(),
  timezone?: string,
): string {
  if (!Number.isFinite(days) || days < 0) return "";
  const l = lang(language);
  if (days < 7 && days > 1) {
    const weekday = new Date(now - days * 86_400_000).toLocaleDateString(LOCALE[l], {
      weekday: "long",
      ...(timezone ? { timeZone: timezone } : {}),
    });
    return l === "tr" ? `${weekday} günü` : l === "de" ? `am ${weekday}` : `on ${weekday}`;
  }
  const words: Record<Lang, string[]> = {
    // today, yesterday, (weekday), last week, ~2 weeks, few weeks, ~a month,
    // ~2 months, few months, a good while, over a year
    tr: [
      "bugün",
      "dün",
      "",
      "geçen hafta",
      "iki hafta kadar önce",
      "birkaç hafta önce",
      "bir ay kadar önce",
      "iki ay kadar önce",
      "birkaç ay önce",
      "epey önce",
      "bir yıldan uzun süre önce",
    ],
    en: [
      "earlier today",
      "yesterday",
      "",
      "last week",
      "a couple of weeks ago",
      "a few weeks ago",
      "about a month ago",
      "a couple of months ago",
      "a few months ago",
      "a good while ago",
      "over a year ago",
    ],
    de: [
      "heute",
      "gestern",
      "",
      "letzte Woche",
      "vor etwa zwei Wochen",
      "vor ein paar Wochen",
      "vor etwa einem Monat",
      "vor etwa zwei Monaten",
      "vor ein paar Monaten",
      "vor längerer Zeit",
      "vor über einem Jahr",
    ],
  };
  const w = words[l];
  if (days === 0) return w[0];
  if (days === 1) return w[1];
  if (days < 14) return w[3];
  if (days < 21) return w[4];
  if (days < 35) return w[5];
  if (days < 50) return w[6];
  if (days < 80) return w[7];
  if (days < 180) return w[8];
  if (days < 365) return w[9];
  return w[10];
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
// A clause holds plain text and whole {{tokens}}; matching token by token is
// what keeps "{{x}}]]" from closing the clause early.
const CLAUSE = /\[\[((?:[^[\]{}]|\{\{\s*[a-zA-Z0-9_]+\s*\}\})*)\]\]/g;

// The template with every {{token}} filled from `vars` ({{when}} from
// vars.when). An unknown or empty token renders as nothing, a clause holding
// one goes whole, and the gaps and stray spaces before punctuation close up.
export function renderOpener(template: string, vars: Record<string, string>): string {
  const lookup = (name: string) => String(vars[name] ?? "").trim();
  const withClauses = template.replace(CLAUSE, (_whole, inner: string) => {
    let missing = false;
    const out = inner.replace(TOKEN, (_t, name: string) => {
      const value = lookup(name);
      if (!value) missing = true;
      return value;
    });
    return missing ? "" : out;
  });
  return withClauses
    .replace(TOKEN, (_t, name: string) => lookup(name))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/^[,.;:]\s*/, "")
    .trim();
}

// What a Resepta template's opening line said after "{{business_name}}, "
// before openers existed, so the fallback reproduces the old greeting
// word for word. Her name goes in when the business gave her one.
export function defaultOpenerTail(
  language: string | null | undefined,
  personaName?: string | null,
): string {
  const name = (personaName ?? "").trim();
  const l = lang(language);
  if (l === "tr") return name ? `ben ${name}. Buyurun.` : "buyurun.";
  if (l === "de") return name ? `hier ist ${name}. Guten Tag.` : "guten Tag.";
  return name ? `this is ${name}. How can I help?` : "how can I help?";
}

// The two clocks as the ring-time variables a prompt may read: whole days
// and minutes since, and the same gaps in words. Only the clocks that exist
// produce keys, so "never spoken" reads as the variable being absent.
export function clockVariables(
  customer: { lastConversationAt?: number; lastCallAttemptAt?: number } | null,
  language: string | null | undefined,
  timezone: string | undefined,
  now: number = Date.now(),
): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (at: number | undefined, days: string, minutes: string, words: string) => {
    if (at === undefined || at > now) return;
    const d = Math.floor((now - at) / 86_400_000);
    out[days] = String(d);
    out[minutes] = String(Math.floor((now - at) / 60_000));
    const phrase = whenPhrase(d, language, now, timezone);
    if (phrase) out[words] = phrase;
  };
  put(customer?.lastConversationAt, "days_since_last_call", "minutes_since_last_call", "when_we_spoke");
  put(
    customer?.lastCallAttemptAt,
    "days_since_last_attempt",
    "minutes_since_last_attempt",
    "when_we_tried",
  );
  return out;
}

// Which sentence this call opens with, and the sentence itself, from the
// variables the call already carries (the clocks above among them). Never
// empty: the template's greeting tail is the last word.
export function chooseOpener(args: {
  direction: "inbound" | "outbound";
  openers: AgentOpeners | null | undefined;
  vars: Record<string, string>;
  language: string | null | undefined;
  personaName?: string | null;
}): { kind: OpenerKind; text: string } {
  const openers = args.openers ?? {};
  const attempt = (kind: OpenerKind, template: string | undefined, when?: string) => {
    if (!template?.trim()) return null;
    const text = renderOpener(template, { ...args.vars, when: when ?? "" });
    return text ? { kind, text } : null;
  };
  const specific =
    args.direction === "inbound"
      ? attempt("inbound", openers.inbound)
      : args.vars.days_since_last_call !== undefined
        ? attempt("followUp", openers.followUp, args.vars.when_we_spoke)
        : args.vars.days_since_last_attempt !== undefined
          ? attempt("missed", openers.missed, args.vars.when_we_tried)
          : null;
  return (
    specific ??
    attempt("cold", openers.cold) ?? {
      kind: "default",
      text: defaultOpenerTail(args.language, args.personaName),
    }
  );
}

// The provider's own fallback for {{opener}}, for a ring where Resepta is
// not asked (the inbound hook unreachable): the cold sentence with its
// variables taken out, since the provider substitutes nothing inside a
// default, or the greeting tail.
export function openerFallback(
  openers: AgentOpeners | null | undefined,
  language: string | null | undefined,
  personaName?: string | null,
): string {
  const cold = openers?.cold?.trim() ? renderOpener(openers.cold, {}) : "";
  return cold || defaultOpenerTail(language, personaName);
}

// Whether an opening line says the opener at all. Without it the four
// sentences are never heard, and the agent page says so.
export function usesOpener(beginMessage: string | null | undefined): boolean {
  return /\{\{\s*opener\s*\}\}/.test(beginMessage ?? "");
}
