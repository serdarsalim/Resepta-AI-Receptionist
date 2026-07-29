// Turning what a person typed into E.164.
//
// The house rule (schema.ts, orgAuth.assertE164) is that a phone number is
// E.164 with a dial code or it does not exist. That rule is right for anything
// STAFF type, because a form we own can demand the format and refuse the save.
//
// It is wrong as a gate on numbers that arrive from OUTSIDE — a cal.com booking
// question, a caller ID, an inbound webhook. Nobody writes their own number the
// way E.164 wants it. A customer of a Turkish salon types 0532 123 45 67,
// because that is what a phone number looks like to them, and rejecting that
// string means silently losing a booking the customer successfully made.
//
// So: strict on the way in from our own UI, forgiving on the way in from the
// world, and this file is the forgiving half.

const E164 = /^\+[1-9]\d{6,14}$/;

// Where the business is, as a dial code. Derived from the org's IANA timezone
// rather than stored as its own field: every org already has a timezone (it is
// required, and appointment times are meaningless without it), and one more
// question in setup is one more place a salon owner stops halfway through.
//
// Deliberately a closed list with no fallback. A zone that is not here returns
// undefined and the caller does not guess — the same instinct as template
// language having no cross-language fallback. Guessing a dial code turns a
// visible "we could not read this number" into an invisible message sent to a
// stranger in another country.
//
// Cyprus is left out on purpose: Europe/Nicosia covers both +357 and the
// +90 548 range, and there is no way to pick from the timezone alone.
const DIAL_CODE_BY_TIMEZONE: Record<string, string> = {
  "Europe/Istanbul": "+90",
  "Europe/Vienna": "+43",
  "Europe/Berlin": "+49",
  "Europe/Busingen": "+49",
  "Europe/Zurich": "+41",
  "Europe/Amsterdam": "+31",
  "Europe/Brussels": "+32",
  "Europe/Paris": "+33",
  "Europe/Madrid": "+34",
  "Europe/Rome": "+39",
  "Europe/London": "+44",
  "Europe/Dublin": "+353",
  "Europe/Lisbon": "+351",
  "Europe/Warsaw": "+48",
  "Europe/Prague": "+420",
  "Europe/Budapest": "+36",
  "Europe/Bucharest": "+40",
  "Europe/Sofia": "+359",
  "Europe/Athens": "+30",
  "Europe/Stockholm": "+46",
  "Europe/Copenhagen": "+45",
  "Europe/Oslo": "+47",
  "Asia/Kuala_Lumpur": "+60",
};

export function dialCodeForTimezone(timezone: string): string | undefined {
  return DIAL_CODE_BY_TIMEZONE[timezone];
}

// null means "this is not a phone number we can reach", and the caller owes
// somebody a visible record of that. It never throws and never guesses a
// country it was not given.
export function normalisePhone(raw: string, dialCode?: string): string | null {
  // Everything humans put between digits. The non-breaking space is in here
  // because pasting from a website is how half of these arrive.
  const trimmed = String(raw ?? "").replace(/[\s ().\-/]/g, "");
  if (!trimmed) return null;

  // Already international. Validate, never rewrite: a number that came in with
  // a dial code means its author told us the country, and the org's own
  // country has no business overriding that.
  if (trimmed.startsWith("+")) return E164.test(trimmed) ? trimmed : null;

  // 00 is how most of Europe writes + on a keypad.
  if (trimmed.startsWith("00")) {
    const phone = `+${trimmed.slice(2)}`;
    return E164.test(phone) ? phone : null;
  }

  if (!/^\d+$/.test(trimmed)) return null;

  // No country to attach it to: the only reading left is an international
  // number that lost its +.
  if (!dialCode) {
    const phone = `+${trimmed}`;
    return E164.test(phone) ? phone : null;
  }

  const cc = dialCode.replace(/\D/g, "");

  // A single leading zero is the national trunk prefix (0532... in Türkiye,
  // 0664... in Austria) and is dropped when the dial code goes on. One zero,
  // not a greedy strip: 00 was already handled above as international, and
  // nothing legitimate starts with three.
  if (trimmed.startsWith("0")) {
    const phone = `+${cc}${trimmed.slice(1)}`;
    return E164.test(phone) ? phone : null;
  }

  // Bare digits with no trunk prefix are genuinely ambiguous: 905321234567 is
  // a Turkish number missing its +, and 5321234567 is the same number written
  // nationally. Try the international reading first and only when it actually
  // validates, which is the convention every dialler uses. It can still be
  // read the wrong way in theory, but only for a national number that happens
  // to begin with its own country's dial code AND happens to be exactly the
  // right length, and the alternative is dropping the booking outright.
  if (trimmed.startsWith(cc)) {
    const asInternational = `+${trimmed}`;
    if (E164.test(asInternational)) return asInternational;
  }
  const phone = `+${cc}${trimmed}`;
  return E164.test(phone) ? phone : null;
}
