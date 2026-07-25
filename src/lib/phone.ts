// Phone numbers: the dial-code table plus the four helpers the UI needs.
//
// Ported wholesale from Nudge (`src/lib/countries.ts` + `src/lib/phoneCountry.ts`),
// merged into one file because Randevu has exactly one consumer for both halves.
// Same data, same longest-prefix rule, same trunk-zero handling — the two apps
// must agree on what a phone number is, since both feed the same Meta Cloud
// sender.
//
// Randevu's backend rule (convex/lib/orgAuth.ts, assertE164) is stricter than a
// display concern: a stored number is `+<dial code><national>` or the mutation
// throws. Everything here exists so the UI can never hand it anything else.

export type CountryOption = { name: string; code: string; iso: string };

// Code values are digits-only ("60", not "+60"); the picker formats the display
// label and emits "+60" to the API layer. `iso` is the flag-icons sprite key.
export const COUNTRY_OPTIONS: ReadonlyArray<CountryOption> = Object.freeze([
  { name: "Afghanistan", code: "93", iso: "af" },
  { name: "Albania", code: "355", iso: "al" },
  { name: "Algeria", code: "213", iso: "dz" },
  { name: "Andorra", code: "376", iso: "ad" },
  { name: "Angola", code: "244", iso: "ao" },
  { name: "Antigua and Barbuda", code: "1268", iso: "ag" },
  { name: "Argentina", code: "54", iso: "ar" },
  { name: "Armenia", code: "374", iso: "am" },
  { name: "Australia", code: "61", iso: "au" },
  { name: "Austria", code: "43", iso: "at" },
  { name: "Azerbaijan", code: "994", iso: "az" },
  { name: "Bahamas", code: "1242", iso: "bs" },
  { name: "Bahrain", code: "973", iso: "bh" },
  { name: "Bangladesh", code: "880", iso: "bd" },
  { name: "Barbados", code: "1246", iso: "bb" },
  { name: "Belarus", code: "375", iso: "by" },
  { name: "Belgium", code: "32", iso: "be" },
  { name: "Belize", code: "501", iso: "bz" },
  { name: "Benin", code: "229", iso: "bj" },
  { name: "Bhutan", code: "975", iso: "bt" },
  { name: "Bolivia", code: "591", iso: "bo" },
  { name: "Bosnia and Herzegovina", code: "387", iso: "ba" },
  { name: "Botswana", code: "267", iso: "bw" },
  { name: "Brazil", code: "55", iso: "br" },
  { name: "Brunei", code: "673", iso: "bn" },
  { name: "Bulgaria", code: "359", iso: "bg" },
  { name: "Burkina Faso", code: "226", iso: "bf" },
  { name: "Burundi", code: "257", iso: "bi" },
  { name: "Cambodia", code: "855", iso: "kh" },
  { name: "Cameroon", code: "237", iso: "cm" },
  { name: "Canada", code: "1", iso: "ca" },
  { name: "Cape Verde", code: "238", iso: "cv" },
  { name: "Central African Republic", code: "236", iso: "cf" },
  { name: "Chad", code: "235", iso: "td" },
  { name: "Chile", code: "56", iso: "cl" },
  { name: "China", code: "86", iso: "cn" },
  { name: "Colombia", code: "57", iso: "co" },
  { name: "Comoros", code: "269", iso: "km" },
  { name: "Congo (Republic)", code: "242", iso: "cg" },
  { name: "Congo (DRC)", code: "243", iso: "cd" },
  { name: "Costa Rica", code: "506", iso: "cr" },
  { name: "Cote d'Ivoire", code: "225", iso: "ci" },
  { name: "Croatia", code: "385", iso: "hr" },
  { name: "Cuba", code: "53", iso: "cu" },
  { name: "Cyprus", code: "357", iso: "cy" },
  { name: "Czechia", code: "420", iso: "cz" },
  { name: "Denmark", code: "45", iso: "dk" },
  { name: "Djibouti", code: "253", iso: "dj" },
  { name: "Dominica", code: "1767", iso: "dm" },
  { name: "Dominican Republic", code: "1809", iso: "do" },
  { name: "Ecuador", code: "593", iso: "ec" },
  { name: "Egypt", code: "20", iso: "eg" },
  { name: "El Salvador", code: "503", iso: "sv" },
  { name: "Equatorial Guinea", code: "240", iso: "gq" },
  { name: "Eritrea", code: "291", iso: "er" },
  { name: "Estonia", code: "372", iso: "ee" },
  { name: "Eswatini", code: "268", iso: "sz" },
  { name: "Ethiopia", code: "251", iso: "et" },
  { name: "Fiji", code: "679", iso: "fj" },
  { name: "Finland", code: "358", iso: "fi" },
  { name: "France", code: "33", iso: "fr" },
  { name: "Gabon", code: "241", iso: "ga" },
  { name: "Gambia", code: "220", iso: "gm" },
  { name: "Georgia", code: "995", iso: "ge" },
  { name: "Germany", code: "49", iso: "de" },
  { name: "Ghana", code: "233", iso: "gh" },
  { name: "Greece", code: "30", iso: "gr" },
  { name: "Grenada", code: "1473", iso: "gd" },
  { name: "Guatemala", code: "502", iso: "gt" },
  { name: "Guinea", code: "224", iso: "gn" },
  { name: "Guinea-Bissau", code: "245", iso: "gw" },
  { name: "Guyana", code: "592", iso: "gy" },
  { name: "Haiti", code: "509", iso: "ht" },
  { name: "Honduras", code: "504", iso: "hn" },
  { name: "Hungary", code: "36", iso: "hu" },
  { name: "Iceland", code: "354", iso: "is" },
  { name: "India", code: "91", iso: "in" },
  { name: "Indonesia", code: "62", iso: "id" },
  { name: "Iran", code: "98", iso: "ir" },
  { name: "Iraq", code: "964", iso: "iq" },
  { name: "Ireland", code: "353", iso: "ie" },
  { name: "Israel", code: "972", iso: "il" },
  { name: "Italy", code: "39", iso: "it" },
  { name: "Jamaica", code: "1876", iso: "jm" },
  { name: "Japan", code: "81", iso: "jp" },
  { name: "Jordan", code: "962", iso: "jo" },
  { name: "Kazakhstan", code: "7", iso: "kz" },
  { name: "Kenya", code: "254", iso: "ke" },
  { name: "Kiribati", code: "686", iso: "ki" },
  { name: "Kuwait", code: "965", iso: "kw" },
  { name: "Kyrgyzstan", code: "996", iso: "kg" },
  { name: "Laos", code: "856", iso: "la" },
  { name: "Latvia", code: "371", iso: "lv" },
  { name: "Lebanon", code: "961", iso: "lb" },
  { name: "Lesotho", code: "266", iso: "ls" },
  { name: "Liberia", code: "231", iso: "lr" },
  { name: "Libya", code: "218", iso: "ly" },
  { name: "Liechtenstein", code: "423", iso: "li" },
  { name: "Lithuania", code: "370", iso: "lt" },
  { name: "Luxembourg", code: "352", iso: "lu" },
  { name: "Madagascar", code: "261", iso: "mg" },
  { name: "Malawi", code: "265", iso: "mw" },
  { name: "Malaysia", code: "60", iso: "my" },
  { name: "Maldives", code: "960", iso: "mv" },
  { name: "Mali", code: "223", iso: "ml" },
  { name: "Malta", code: "356", iso: "mt" },
  { name: "Marshall Islands", code: "692", iso: "mh" },
  { name: "Mauritania", code: "222", iso: "mr" },
  { name: "Mauritius", code: "230", iso: "mu" },
  { name: "Mexico", code: "52", iso: "mx" },
  { name: "Micronesia", code: "691", iso: "fm" },
  { name: "Moldova", code: "373", iso: "md" },
  { name: "Monaco", code: "377", iso: "mc" },
  { name: "Mongolia", code: "976", iso: "mn" },
  { name: "Montenegro", code: "382", iso: "me" },
  { name: "Morocco", code: "212", iso: "ma" },
  { name: "Mozambique", code: "258", iso: "mz" },
  { name: "Myanmar", code: "95", iso: "mm" },
  { name: "Namibia", code: "264", iso: "na" },
  { name: "Nauru", code: "674", iso: "nr" },
  { name: "Nepal", code: "977", iso: "np" },
  { name: "Netherlands", code: "31", iso: "nl" },
  { name: "New Zealand", code: "64", iso: "nz" },
  { name: "Nicaragua", code: "505", iso: "ni" },
  { name: "Niger", code: "227", iso: "ne" },
  { name: "Nigeria", code: "234", iso: "ng" },
  { name: "North Korea", code: "850", iso: "kp" },
  { name: "North Macedonia", code: "389", iso: "mk" },
  { name: "Norway", code: "47", iso: "no" },
  { name: "Oman", code: "968", iso: "om" },
  { name: "Pakistan", code: "92", iso: "pk" },
  { name: "Palau", code: "680", iso: "pw" },
  { name: "Palestine", code: "970", iso: "ps" },
  { name: "Panama", code: "507", iso: "pa" },
  { name: "Papua New Guinea", code: "675", iso: "pg" },
  { name: "Paraguay", code: "595", iso: "py" },
  { name: "Peru", code: "51", iso: "pe" },
  { name: "Philippines", code: "63", iso: "ph" },
  { name: "Poland", code: "48", iso: "pl" },
  { name: "Portugal", code: "351", iso: "pt" },
  { name: "Qatar", code: "974", iso: "qa" },
  { name: "Romania", code: "40", iso: "ro" },
  { name: "Russia", code: "7", iso: "ru" },
  { name: "Rwanda", code: "250", iso: "rw" },
  { name: "Saint Kitts and Nevis", code: "1869", iso: "kn" },
  { name: "Saint Lucia", code: "1758", iso: "lc" },
  { name: "Saint Vincent and the Grenadines", code: "1784", iso: "vc" },
  { name: "Samoa", code: "685", iso: "ws" },
  { name: "San Marino", code: "378", iso: "sm" },
  { name: "Sao Tome and Principe", code: "239", iso: "st" },
  { name: "Saudi Arabia", code: "966", iso: "sa" },
  { name: "Senegal", code: "221", iso: "sn" },
  { name: "Serbia", code: "381", iso: "rs" },
  { name: "Seychelles", code: "248", iso: "sc" },
  { name: "Sierra Leone", code: "232", iso: "sl" },
  { name: "Singapore", code: "65", iso: "sg" },
  { name: "Slovakia", code: "421", iso: "sk" },
  { name: "Slovenia", code: "386", iso: "si" },
  { name: "Solomon Islands", code: "677", iso: "sb" },
  { name: "Somalia", code: "252", iso: "so" },
  { name: "South Africa", code: "27", iso: "za" },
  { name: "South Korea", code: "82", iso: "kr" },
  { name: "South Sudan", code: "211", iso: "ss" },
  { name: "Spain", code: "34", iso: "es" },
  { name: "Sri Lanka", code: "94", iso: "lk" },
  { name: "Sudan", code: "249", iso: "sd" },
  { name: "Suriname", code: "597", iso: "sr" },
  { name: "Sweden", code: "46", iso: "se" },
  { name: "Switzerland", code: "41", iso: "ch" },
  { name: "Syria", code: "963", iso: "sy" },
  { name: "Taiwan", code: "886", iso: "tw" },
  { name: "Tajikistan", code: "992", iso: "tj" },
  { name: "Tanzania", code: "255", iso: "tz" },
  { name: "Thailand", code: "66", iso: "th" },
  { name: "Timor-Leste", code: "670", iso: "tl" },
  { name: "Togo", code: "228", iso: "tg" },
  { name: "Tonga", code: "676", iso: "to" },
  { name: "Trinidad and Tobago", code: "1868", iso: "tt" },
  { name: "Tunisia", code: "216", iso: "tn" },
  { name: "Turkey", code: "90", iso: "tr" },
  { name: "Turkmenistan", code: "993", iso: "tm" },
  { name: "Tuvalu", code: "688", iso: "tv" },
  { name: "Uganda", code: "256", iso: "ug" },
  { name: "Ukraine", code: "380", iso: "ua" },
  { name: "United Arab Emirates", code: "971", iso: "ae" },
  { name: "United Kingdom", code: "44", iso: "gb" },
  { name: "United States", code: "1", iso: "us" },
  { name: "Uruguay", code: "598", iso: "uy" },
  { name: "Uzbekistan", code: "998", iso: "uz" },
  { name: "Vanuatu", code: "678", iso: "vu" },
  { name: "Vatican City", code: "379", iso: "va" },
  { name: "Venezuela", code: "58", iso: "ve" },
  { name: "Vietnam", code: "84", iso: "vn" },
  { name: "Yemen", code: "967", iso: "ye" },
  { name: "Zambia", code: "260", iso: "zm" },
  { name: "Zimbabwe", code: "263", iso: "zw" },
]);

export type PhoneCountry = {
  iso: string;
  // What to show on hover. Ambiguous codes name every candidate ("United
  // States / Canada") rather than pretending the number pins one of them.
  label: string;
};

// Dial code to the countries sharing it. Only +1 and +7 have more than one; the
// NANP islands carry their full prefix ("1268"), so longest-match separates
// them from bare +1 before the tie-break ever applies.
const BY_CODE = new Map<string, CountryOption[]>();
for (const c of COUNTRY_OPTIONS) {
  const list = BY_CODE.get(c.code);
  if (list) list.push(c);
  else BY_CODE.set(c.code, [c]);
}

// Which country's flag represents a shared code. Dial codes can't distinguish
// these without area-code tables, so we fly the larger one and let the label
// tell the truth.
const PRIMARY: Record<string, string> = { "1": "United States", "7": "Russia" };

const MAX_CODE_LEN = 4; // "1268" (Antigua) is the longest in the list.

export function findCountryByCode(code: string | null | undefined): CountryOption | null {
  const digits = String(code ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return COUNTRY_OPTIONS.find((c) => c.code === digits) ?? null;
}

// "Germany (+49)" for a known code, "(+999)" for one we don't carry, "" for
// nothing. Empty rather than a "Not set" string on purpose: the placeholder is
// the caller's to translate, and a lib file has no language context.
export function formatCountryLabel(code: string | null | undefined): string {
  const digits = String(code ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const matched = findCountryByCode(digits);
  return matched ? `${matched.name} (+${matched.code})` : `(+${digits})`;
}

// "+421908174875" to { iso: "sk", label: "Slovakia" }. Null for a blank, local,
// or unrecognised number, so the caller renders nothing rather than a wrong flag.
//
// The leading "+" is REQUIRED. That is what keeps a flag off a value that merely
// starts with a digit: a house number, an order reference, a custom field
// holding "90 minutes" all resolve to null here.
export function phoneCountry(phone: string | undefined | null): PhoneCountry | null {
  const s = String(phone ?? "").trim();
  if (!s.startsWith("+")) return null; // local/unnormalised: country unknowable
  const digits = s.slice(1).replace(/\D/g, "");
  if (!digits) return null;
  const code = longestCode(digits);
  if (!code) return null;
  const hit = BY_CODE.get(code)!;
  if (hit.length === 1) return { iso: hit[0].iso, label: hit[0].name };
  const primary = hit.find((c) => c.name === PRIMARY[code]) ?? hit[0];
  const others = hit.filter((c) => c !== primary).map((c) => c.name);
  return { iso: primary.iso, label: [primary.name, ...others].join(" / ") };
}

// Longest dial code that prefixes these digits, or "" if none matches. Longest
// wins so "1868…" reads as Trinidad and Tobago rather than the bare US "1".
function longestCode(digits: string): string {
  for (let len = MAX_CODE_LEN; len >= 1; len--) {
    const candidate = digits.slice(0, len);
    if (BY_CODE.has(candidate)) return candidate;
  }
  return "";
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
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return { code: "", national: "" };
  if (!String(phone ?? "").trim().startsWith("+")) return { code: "", national: digits };
  const code = longestCode(digits);
  return { code, national: code ? digits.slice(code.length) : digits };
}

// Dial codes whose national numbers legitimately KEEP a leading zero, so the
// trunk-strip below must not touch them. Italy is the standard example: Rome
// landlines really are +39 06…, and San Marino / Vatican share +39.
const KEEPS_LEADING_ZERO = new Set(["39"]);

// The inverse. Empty national gives "" (the number is being cleared, and a bare
// dial code is not a phone number).
//
// Strips the national TRUNK PREFIX, the 0 you dial domestically and never keep
// in E.164. Typing a country and then the number as you'd say it out loud
// ("0532 123 45 67") is the normal way to enter a Turkish number, and without
// this it stores +905321234567 as +9005321234567, which no gateway delivers.
export function joinPhone(code: string, national: string): string {
  let n = String(national ?? "").replace(/\D/g, "");
  const c = String(code ?? "").replace(/\D/g, "");
  if (!n) return "";
  if (c && !KEEPS_LEADING_ZERO.has(c)) n = n.replace(/^0+/, "");
  if (!n) return ""; // the whole thing was trunk zeros, not a number
  return c ? `+${c}${n}` : n;
}
