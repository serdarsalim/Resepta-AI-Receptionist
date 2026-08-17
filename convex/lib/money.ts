// The currency allowlist, shared by the backend (validating a Settings save)
// and the frontend (rendering the picker). One list, because two lists is how
// a code becomes savable in Settings and unrenderable everywhere else.
//
// Formatting lives here too, and used to live only in src/lib/money.ts on the
// grounds that "the server has no reader to format for". It has exactly one: an
// outbound message. wa.ts renders [price] and [pricelist] for a customer in that
// customer's language, and because it could not reach the shared formatter it
// hand-rolled its own — without narrowSymbol, so an English-speaking customer of
// a Turkish salon was told "TRY 400.00" about the same appointment the dashboard
// showed as "₺400.00", and with a hardcoded /100 that the first zero-decimal
// currency would render 100× too small. src/lib/money.ts re-exports what is
// below, so there is one implementation and one place to fix.

export const CURRENCIES = ["TRY", "EUR", "USD", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const DEFAULT_CURRENCY: Currency = "TRY";

export function isCurrency(code: string): code is Currency {
  return (CURRENCIES as readonly string[]).includes(code);
}

// Exported because parseMoney and moneyInputValue in src/lib/money.ts need the
// same exponent this formatter uses — a parser that disagrees with its renderer
// about how many decimals a currency has is a field that eats a digit.
export function fractionDigits(currency: string, locale: string): number {
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
