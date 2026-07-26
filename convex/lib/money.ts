// The currency allowlist, shared by the backend (validating a Settings save)
// and the frontend (rendering the picker). One list, because two lists is how
// a code becomes savable in Settings and unrenderable everywhere else.
//
// Formatting lives in src/lib/money.ts — it is Intl work with a locale, and
// the server has no reader to format for.

export const CURRENCIES = ["TRY", "EUR", "USD", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const DEFAULT_CURRENCY: Currency = "TRY";

export function isCurrency(code: string): code is Currency {
  return (CURRENCIES as readonly string[]).includes(code);
}
