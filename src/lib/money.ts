// Money, stored and rendered the way money has to be.
//
// Amounts are INTEGER MINOR UNITS everywhere — 40000 is ₺400,00. Never a float:
// 0.1 + 0.2 is not 0.3 in binary floating point, and the entire reason this
// field exists is so someone can add up a month of them. The rounding error is
// invisible on one appointment and wrong on a hundred.
//
// The exponent (2 for TRY/EUR/USD, 0 for JPY) comes from Intl rather than a
// table we maintain, so adding a currency is one entry in CURRENCIES below and
// nothing else.

// The allowlist itself lives next to the mutation that validates against it,
// so Settings can never save a code this file can't render.
export {
  CURRENCIES,
  DEFAULT_CURRENCY,
  type Currency,
} from "../../convex/lib/money";

function fractionDigits(currency: string, locale: string): number {
  // Typed optional because the option is optional on the way IN; for a
  // currency-style formatter Intl always resolves it. 2 is only a floor.
  return (
    new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions()
      .minimumFractionDigits ?? 2
  );
}

// "₺400,00" in Turkish, "€400.00" in English — symbol, placement, separators
// and digit grouping all come from Intl. No symbol table, no per-locale
// branching, and it is right in languages nobody on the team reads.
export function formatMoney(
  minor: number,
  currency: string,
  locale: string,
): string {
  const digits = fractionDigits(currency, locale);
  // narrowSymbol, not the default: English renders TRY as the literal code
  // ("TRY 400.00"), which is what you want in a table listing many currencies
  // and wrong here. An org has exactly one currency, so the symbol is never
  // ambiguous and "₺400.00" is what its staff actually recognise.
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(minor / 10 ** digits);
}

// What a person typed → minor units. Accepts "400", "400,50", "400.50" and
// "1.234,56": the last separator followed by 1-2 digits is the decimal one,
// everything before it is grouping. Returns undefined for anything that isn't
// a number, so a blank field stays blank rather than becoming zero — "free"
// and "not priced yet" are different facts.
export function parseMoney(
  input: string,
  currency: string,
  locale: string,
): number | undefined {
  const raw = input.trim();
  if (!raw) return undefined;
  const digits = fractionDigits(currency, locale);
  // Split on the LAST separator, and only treat it as a decimal point if what
  // follows is short enough to be one. "1.234" is a thousand, not 1.234.
  const match = raw.match(/^(.*)[.,](\d{1,2})$/);
  const whole = (match ? match[1] : raw).replace(/[^\d]/g, "");
  const frac = match ? match[2] : "";
  if (!whole && !frac) return undefined;
  const scaled = `${whole || "0"}${frac.padEnd(digits, "0").slice(0, digits)}`;
  const value = Number(scaled);
  return Number.isFinite(value) ? value : undefined;
}

// The bare number for an input field — no symbol, no grouping, because the
// user is about to type over it and "₺1.234,00" is not something you can edit.
export function moneyInputValue(
  minor: number | undefined,
  currency: string,
  locale: string,
): string {
  if (minor === undefined) return "";
  const digits = fractionDigits(currency, locale);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(minor / 10 ** digits);
}

// Just the symbol, for the suffix beside a price input — the same slot "min"
// occupies beside a duration.
export function currencySymbol(currency: string, locale: string): string {
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? currency;
}
