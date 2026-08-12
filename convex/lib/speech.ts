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
// NO TABLES IN HERE. A four-currency map would just relocate the bug to the
// fifth currency, and a minute/hour map would relocate it to the fourth
// language. Intl already knows the word for every unit and every ISO currency
// in every locale, including the plural rules — "1 ABD doları" against
// "3000 ABD doları", "1 hour" against "2 hours" — and it is right in languages
// nobody on this team reads. Convex ships the full ICU data; this was checked
// against the live runtime, not assumed.
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
      .map((part) => part.value)
      .join("")
      .replace(/\s+/g, " ")
      .trim()
  );
}
