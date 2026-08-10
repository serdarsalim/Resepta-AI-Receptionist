// Phone numbers: country data plus the helpers the UI needs.
//
// The 201-country table that used to sit here (ported from Nudge, which had
// hand-maintained it too) is GONE, along with the longest-prefix guesser and
// the hand-kept list of dial codes that keep a leading zero. All of it now
// comes from react-phone-number-input / libphonenumber-js — the same library
// egitimirlanda-portal uses. One phone system across the projects, which is the
// point: three copies of a country list were three chances to disagree about
// what a phone number is, and all three feed the same Meta Cloud sender.
//
// What the library buys beyond not retyping the data:
//   - Real parsing instead of prefix matching. +1268 resolves to Antigua and
//     +1416 to Canada, because it knows area codes; the old longestCode() flew
//     the US flag for every +1 number that was not a full island prefix.
//   - Trunk-prefix handling for every country, not just the "39" special case
//     somebody remembered to write down.
//   - Country names in Turkish, German and English, so the picker stops showing
//     "Germany" to a Turkish salon.
//
// Resepta's backend rule (convex/lib/orgAuth.ts, assertE164) is stricter than a
// display concern: a stored number is `+<dial code><national>` or the mutation
// throws. Everything here exists so the UI can never hand it anything else.

import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumber,
  type Country,
} from "react-phone-number-input/min";
import en from "react-phone-number-input/locale/en.json";
import tr from "react-phone-number-input/locale/tr.json";
import de from "react-phone-number-input/locale/de.json";
import type { Language } from "@/lib/i18n";

export type CountryOption = {
  name: string;
  code: string;
  iso: string;
  // Prebuilt haystack for the picker's search box; see build().
  search?: string;
};

const LABELS: Record<Language, Record<string, string>> = { en, tr, de };

// Code values are digits-only ("60", not "+60"); the picker formats the display
// label and emits "+60" to the API layer. `iso` is the flag sprite key, which is
// lowercase where the library's country codes are upper.
function build(language: Language): CountryOption[] {
  const labels = LABELS[language] ?? en;
  return getCountries()
    .map((country) => ({
      name: labels[country] ?? country,
      code: getCountryCallingCode(country),
      iso: country.toLowerCase(),
      // Everything the picker's search should match, lower-cased once here
      // rather than per keystroke: the localised name, the English name (a
      // Turkish user still types "Germany" half the time), the ISO code, and
      // the dial code with and without its plus.
      search: [
        labels[country] ?? country,
        en[country] ?? country,
        country,
        getCountryCallingCode(country),
      ]
        .join(" ")
        .toLowerCase(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, language));
}

const CACHE = new Map<Language, CountryOption[]>();

// Sorted by NAME in the caller's own language, so a Turkish user scrolls a
// Turkish alphabet. Cached per language: it is ~250 rows and the picker would
// otherwise rebuild the whole list on every keystroke.
export function countryOptions(language: Language): CountryOption[] {
  const hit = CACHE.get(language);
  if (hit) return hit;
  const built = build(language);
  CACHE.set(language, built);
  return built;
}

// English default, for callers with no language in hand.
export const COUNTRY_OPTIONS: ReadonlyArray<CountryOption> = countryOptions("en");

const CALLING_CODES = new Set(COUNTRY_OPTIONS.map((c) => c.code));

// Dial code to a representative country, so a national number can be parsed
// against real metadata instead of a guess.
const REGION_BY_CODE = new Map<string, Country>();
for (const country of getCountries()) {
  const code = getCountryCallingCode(country);
  if (!REGION_BY_CODE.has(code)) REGION_BY_CODE.set(code, country);
}

export type PhoneCountry = {
  iso: string;
  // What to show on hover.
  label: string;
};

function parse(value: string | undefined | null, region?: Country) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  if (!raw.startsWith("+") && !region) return undefined;
  try {
    return parsePhoneNumber(raw, region);
  } catch {
    return undefined;
  }
}

export function findCountryByCode(code: string | null | undefined): CountryOption | null {
  const digits = String(code ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return COUNTRY_OPTIONS.find((c) => c.code === digits) ?? null;
}

// "Germany (+49)" for a known code, "(+999)" for one we do not carry, "" for
// nothing. Empty rather than a "Not set" string on purpose: the placeholder is
// the caller's to translate.
export function formatCountryLabel(
  code: string | null | undefined,
  language: Language = "en",
): string {
  const digits = String(code ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const matched = countryOptions(language).find((c) => c.code === digits);
  return matched ? `${matched.name} (+${matched.code})` : `(+${digits})`;
}

// "+421908174875" to { iso: "sk", label: "Slovakia" }. Null for a blank, local,
// or unrecognised number, so the caller renders nothing rather than a wrong flag.
//
// The leading "+" is REQUIRED. That is what keeps a flag off a value that merely
// starts with a digit: a house number, an order reference, a custom field
// holding "90 minutes" all resolve to null here.
export function phoneCountry(
  phone: string | undefined | null,
  language: Language = "en",
): PhoneCountry | null {
  const raw = String(phone ?? "").trim();
  if (!raw.startsWith("+")) return null;
  const parsed = parse(raw);
  if (!parsed?.country) return null;
  const labels = LABELS[language] ?? en;
  return {
    iso: parsed.country.toLowerCase(),
    label: labels[parsed.country] ?? parsed.country,
  };
}

// Split a stored number into the two halves the editor edits separately:
// "+905321234567" to { code: "90", national: "5321234567" }. Both digits-only.
//
// An unrecognised or local number keeps every digit in `national` with an empty
// `code`, which is what makes the editor's "pick a country" requirement bite on
// exactly the rows that need fixing, instead of silently inventing a prefix.
export function splitPhone(phone: string | undefined | null): {
  code: string;
  national: string;
} {
  const raw = String(phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return { code: "", national: "" };
  if (!raw.startsWith("+")) return { code: "", national: digits };
  const parsed = parse(raw);
  if (parsed?.countryCallingCode) {
    return {
      code: String(parsed.countryCallingCode),
      national: String(parsed.nationalNumber),
    };
  }
  // Half-typed, most often. Fall back to the longest dial code that prefixes it
  // so the picker still tracks along while somebody is mid-number.
  for (let len = 4; len >= 1; len--) {
    const candidate = digits.slice(0, len);
    if (CALLING_CODES.has(candidate)) {
      return { code: candidate, national: digits.slice(len) };
    }
  }
  return { code: "", national: digits };
}

// The inverse. Empty national gives "" (the number is being cleared, and a bare
// dial code is not a phone number).
//
// Strips the national TRUNK PREFIX, the 0 you dial domestically and never keep
// in E.164. Typing a country and then the number as you would say it out loud
// ("0532 123 45 67") is the normal way to enter a Turkish number, and without
// this it stores +905321234567 as +9005321234567, which no gateway delivers.
// libphonenumber knows which countries genuinely keep the zero — Italy really
// is +39 06… — so this no longer depends on somebody having remembered to add
// "39" to a hand-written exception list.
export function joinPhone(code: string, national: string): string {
  const n = String(national ?? "").replace(/\D/g, "");
  const c = String(code ?? "").replace(/\D/g, "");
  if (!n) return "";
  if (!c) return n;
  const region = REGION_BY_CODE.get(c);
  if (region) {
    try {
      const parsed = parsePhoneNumber(n, region);
      if (parsed?.number) return parsed.number;
    } catch {
      /* half-typed: fall through */
    }
  }
  // Mid-typing, or a code the library does not map. Keep the digits so the
  // field stays live; assertE164 on the backend is the real gate.
  return `+${c}${n}`;
}

// A number typed or pasted WITH its country code belongs in the picker, not in
// the national box. Handles both the way people write it ("+90 532…") and the
// way they dial it abroad ("0090 532…", the international access prefix used
// across TR/DE/AT), which the old field turned into a national number starting
// with 0090.
//
// Returns null when the input is an ordinary national number, so the caller
// leaves it alone. Never returns a code it cannot recognise: "+999…" stays in
// the national box rather than becoming a silent, undeliverable prefix.
export function absorbInternational(
  raw: string,
): { code: string; national: string } | null {
  const trimmed = String(raw ?? "").trim();
  const international = trimmed.startsWith("+")
    ? trimmed
    : /^00\d/.test(trimmed)
      ? `+${trimmed.slice(2)}`
      : null;
  if (!international) return null;
  const { code, national } = splitPhone(international);
  return code ? { code, national } : null;
}
