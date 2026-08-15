// Values shaped to be SAID, not displayed.
//
// A voice agent handed `{ durationMinutes: 90, price: 300000, currency: "TRY" }`
// has to invent the wording, and it invents the wording it has read most: the
// written one. Bella quoted a bridal service as "90 dk için ₺3.000" — correct
// on a price list, and out loud it is the letters d-k and a number the voice
// stumbles over, because "3.000" in a Turkish sentence is a decimal point.
//
// Retell's normalize_for_speech is already on and does not save this. It
// rewrites what it recognises, and a lira symbol against a dotted thousand is
// not it. The fix is upstream of the guess: send the words, and tell the agent
// to read them as given.
//
// Digits stay digits — TTS says "3000" as üç bin perfectly well. What it
// cannot do is symbols, abbreviations and thousands separators. So: no ₺, no
// grouping, and every unit spelled out.
//
// Intl does the arithmetic, the units and the plural rules — every ISO
// currency in every locale, right in languages nobody on this team reads.
// Convex ships the full ICU data; that was checked against the live runtime,
// not assumed. So there is no minute/hour table and no exponent table.
//
// There is exactly ONE table, below, and it is worth knowing why it has to
// exist. ICU currency names are built to DISAMBIGUATE — they answer "which of
// the world's dollars is this" in a list that might hold three. Out loud there
// is nothing to disambiguate: the salon has one currency and the caller
// already knows which money they are paying in. So ICU says "Türk lirası" and
// a person in Turkey says "lira"; it says "US dollar" and a person says
// "dollar". Nobody has ever said "İngiliz sterlini" to a hairdresser. What
// people actually say is not a thing ICU stores, so it is stored here.
//
// It degrades rather than breaks: a currency with no entry falls back to the
// ICU name, which is correct and merely formal. Adding one to CURRENCIES in
// money.ts still works on day one and can be made colloquial later.
//
// (convex/lib/money.ts says formatting lives on the client because "the server
// has no reader to format for". That stopped being true when the reader became
// a text-to-speech engine.)

// Whole hours become hours, because that is how people say them: a two-hour
// treatment is "2 saat", never "120 dakika". Everything else stays minutes —
// "1 saat 30 dakika" is no improvement on "90 dakika", and the salon durations
// that are not round hours are 30, 45 and 90.
export function spokenDuration(
  minutes: number | null | undefined,
  locale: string | null | undefined,
): string | null {
  if (minutes === null || minutes === undefined) return null;
  const total = Math.round(minutes);
  if (!Number.isFinite(total) || total <= 0) return null;
  const hours = total >= 60 && total % 60 === 0;
  return new Intl.NumberFormat(locale || "en", {
    style: "unit",
    unit: hours ? "hour" : "minute",
    unitDisplay: "long",
    useGrouping: false,
  }).format(hours ? total / 60 : total);
}

// How much warning an order needs, shaped to be said: "2 days", not "2880
// minutes". Same Intl machinery as spokenDuration, one unit up — lead times
// are set in days far more often than appointment lengths are.
export function spokenLead(
  minutes: number | null | undefined,
  locale: string | null | undefined,
): string | null {
  if (minutes === null || minutes === undefined) return null;
  const total = Math.round(minutes);
  if (!Number.isFinite(total) || total <= 0) return null;
  const unit =
    total >= 1440 && total % 1440 === 0
      ? "day"
      : total >= 60 && total % 60 === 0
        ? "hour"
        : "minute";
  const value = unit === "day" ? total / 1440 : unit === "hour" ? total / 60 : total;
  return new Intl.NumberFormat(locale || "en", {
    style: "unit",
    unit,
    unitDisplay: "long",
    useGrouping: false,
  }).format(value);
}

// The word a customer would use, by currency and then language, keyed by the
// Intl plural category so English can say one dollar and 3000 dollars. Turkish
// does not inflect a noun after a numeral, so its two forms are the same word
// and that is not a mistake.
//
// EUR is deliberately absent: ICU already returns Euro, Euro and euros/euro,
// which is what people say in all three languages. An entry would only be a
// place for it to drift.
const SPOKEN_CURRENCY: Record<
  string,
  Record<string, { one: string; other: string }>
> = {
  TRY: {
    tr: { one: "lira", other: "lira" },
    en: { one: "lira", other: "lira" },
    de: { one: "Lira", other: "Lira" },
  },
  USD: {
    tr: { one: "dolar", other: "dolar" },
    en: { one: "dollar", other: "dollars" },
    de: { one: "Dollar", other: "Dollar" },
  },
  GBP: {
    tr: { one: "sterlin", other: "sterlin" },
    en: { one: "pound", other: "pounds" },
    de: { one: "Pfund", other: "Pfund" },
  },
};

function spokenCurrencyWord(
  code: string,
  locale: string,
  amount: number,
): string | null {
  const forms = SPOKEN_CURRENCY[code]?.[locale.toLowerCase().slice(0, 2)];
  if (!forms) return null;
  const category = new Intl.PluralRules(locale).select(amount);
  return category === "one" ? forms.one : forms.other;
}

// Minor units in, a sayable amount out.
//
// The exponent comes from Intl for the same reason it does in money.ts: minor
// units are hundredths of a lira and whole yen, and a hardcoded /100 quietly
// multiplies a JPY price by a hundred.
export function spokenPrice(
  minorUnits: number | null | undefined,
  currency: string | null | undefined,
  locale: string | null | undefined,
): string | null {
  if (minorUnits === null || minorUnits === undefined) return null;
  if (!Number.isFinite(minorUnits) || minorUnits < 0) return null;
  const code = (currency ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;

  const tag = locale || "en";
  let digits: number;
  try {
    digits =
      new Intl.NumberFormat(tag, { style: "currency", currency: code }).resolvedOptions()
        .minimumFractionDigits ?? 2;
  } catch {
    return null;
  }
  const amount = minorUnits / 10 ** digits;

  // Trailing zeroes dropped: an appointment price is a whole number of lira
  // almost every time, and "3000 tam sıfır sıfır lira" is not what anyone says.
  const exact = Number.isInteger(amount) ? 0 : digits;
  const word = spokenCurrencyWord(code, tag, amount);

  return (
    new Intl.NumberFormat(tag, {
      style: "currency",
      currency: code,
      currencyDisplay: "name",
      useGrouping: false,
      minimumFractionDigits: exact,
      maximumFractionDigits: exact,
    })
      .formatToParts(amount)
      // Turkish asks for the currency NAME and gets "₺3000 Türk lirası" — ICU
      // prepends the symbol for the locale's own currency anyway. Any currency
      // part with no letter in it is that symbol, and it is the single
      // character this whole file exists to remove.
      .filter((part) => !(part.type === "currency" && !/\p{L}/u.test(part.value)))
      // The name is swapped in place rather than appended, so ICU keeps
      // deciding where the word goes and what separates it from the number.
      // Those differ by locale and are not ours to guess.
      .map((part) =>
        part.type === "currency" ? (word ?? part.value) : part.value,
      )
      .join("")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// ── Clock times ─────────────────────────────────────────────────────────────
//
// "15:00" is correct on a screen and wrong in a mouth. Deniz read it as "on
// beş sıfır sıfır" — fifteen zero zero — which is not a thing a Turkish
// person says. A receptionist says "öğleden sonra üç".
//
// Intl cannot do this one. Its 12-hour Turkish output is "ÖS 3:00", an
// abbreviation TTS mangles exactly like "dk", and its 24-hour output is the
// digits we are trying to get away from. So the clock half is assembled from
// the local hour and minute, while the DATE half stays with Intl, which knows
// "13 Ağustos Perşembe" in every locale and is already right.
//
// Each language gets what its own speakers say, which is not the same shape:
// Turkish and English go 12-hour with a part-of-day or AM/PM, German says the
// 24-hour number followed by Uhr, because "15 Uhr" IS how Germans say it.
//
// WRITTEN CHANNELS MUST NOT USE THIS. A WhatsApp confirmation says 15:00 —
// numerals are what a reader scans and what they compare against a calendar.
// lib/format.formatAppointmentTime stays the written one; this is its twin
// for the ear only.

import { getLocalPartsSafe } from "./businessHours";

// Noon is its own word. Lumping 12:00 into the afternoon bucket produced
// "öğleden sonra saat 12" — literally "twelve, after noon" — for noon itself.
const DAY_PART_TR = (hour: number): string =>
  hour < 6
    ? "gece"
    : hour < 12
      ? "sabah"
      : hour === 12
        ? "öğlen"
        : hour < 18
          ? "öğleden sonra"
          : "akşam";

// The clock alone: "öğleden sonra üç", "3:30 PM", "15 Uhr 30".
export function spokenClock(
  atMs: number,
  timezone: string | undefined,
  language: string | null | undefined,
): string {
  const parts = getLocalPartsSafe(atMs, timezone);
  const hour = parts.hour;
  const minute = parts.minutesOfDay % 60;
  const key = (language ?? "").toLowerCase().slice(0, 2);

  if (key === "de") {
    return minute === 0 ? `${hour} Uhr` : `${hour} Uhr ${minute}`;
  }

  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  if (key === "tr") {
    const part = DAY_PART_TR(hour);
    // "buçuk" for the half hour, because "üç otuz" is a train announcement.
    // No locative suffix anywhere ("üçte"): it has to agree with the vowels
    // of the number in front of it, and a template cannot inflect.
    if (minute === 0) return `${part} saat ${h12}`;
    if (minute === 30) return `${part} ${h12} buçuk`;
    return `${part} ${h12} ${minute}`;
  }

  const suffix = hour < 12 ? "AM" : "PM";
  return minute === 0 ? `${h12} ${suffix}` : `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

// Date and clock together, for the voice lane's "when is my appointment".
// The date comes from Intl in the org's language; only the clock is ours.
export function spokenDateTime(
  atMs: number,
  timezone: string | undefined,
  language: string | null | undefined,
): string {
  const key = (language ?? "").toLowerCase().slice(0, 2);
  const locale = key === "tr" ? "tr-TR" : key === "de" ? "de-DE" : "en-GB";
  let day: string;
  try {
    day = new Intl.DateTimeFormat(locale, {
      timeZone: timezone || "UTC",
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date(atMs));
  } catch {
    // Same fallback posture as formatAppointmentTime: a usable string beats a
    // thrown error on a live call.
    day = new Date(atMs).toISOString().slice(0, 10);
  }
  return `${day} ${spokenClock(atMs, timezone, language)}`;
}
