// The WhatsApp price book. Meta bills per DELIVERED template message —
// per recipient country, per category (marketing / utility / authentication)
// — since July 2025; free-form replies inside the 24h service window cost
// nothing, and the Evolution lane never touches Meta at all. So the only
// billable send in this product is a Cloud-lane template send, and this file
// answers what ONE of those costs.
//
// Two numbers per send: what Meta charges us (cost) and what the org pays
// (cost plus the operator's markup percent) — the voice lane's billed/Retell
// split, applied to messaging. Both are stamped onto the message row where
// the send is confirmed (messages.applySendResult), so a rate edit never
// rewrites history.

export type WaCategory = "marketing" | "utility" | "authentication";

// Micro-USD per delivered message.
export type WaRates = Record<WaCategory, number>;

// Meta's rate card (April 2026), USD, for the markets this deployment
// actually serves plus the bucket everything else falls into. Checked in as a
// DEFAULT, not a truth: Meta adjusts the card roughly twice a year, and the
// operator overrides any row from /admin → Platform → Billing (the
// waRateTable platform key, JSON of this same shape) without a deploy.
export const DEFAULT_WA_RATES: Record<string, WaRates> = {
  TR: { marketing: 10_900, utility: 900, authentication: 900 },
  DE: { marketing: 136_500, utility: 55_000, authentication: 55_000 },
  AT: { marketing: 59_200, utility: 17_100, authentication: 17_100 },
  NL: { marketing: 159_700, utility: 50_000, authentication: 50_000 },
  GB: { marketing: 52_900, utility: 22_000, authentication: 22_000 },
  // Meta prices ~240 markets; carrying all of them here would be a page of
  // numbers nobody audits. Everything without a row bills at this bucket —
  // roughly the card's mid-band — and a market that grows real volume earns
  // its own row in the admin table.
  other: { marketing: 60_400, utility: 7_700, authentication: 7_700 },
};

// Dial code → ISO country, longest prefix wins. Meta prices by the
// RECIPIENT's country code, so this is read off the customer's phone number
// at stamp time. Only codes that could plausibly ring this deployment's
// customers; an unmatched number bills at "other", which is the honest
// default rather than a mistake.
const DIAL_CODES: Array<[string, string]> = [
  ["90", "TR"],
  ["49", "DE"],
  ["43", "AT"],
  ["31", "NL"],
  ["44", "GB"],
  ["32", "BE"],
  ["33", "FR"],
  ["34", "ES"],
  ["39", "IT"],
  ["41", "CH"],
  ["351", "PT"],
  ["1", "US"],
].sort((a, b) => b[0].length - a[0].length) as Array<[string, string]>;

export function countryForPhone(phone: string | undefined): string | null {
  if (!phone) return null;
  // "+90…", "0090…" and bare "90…" all reach WhatsApp as the same number.
  const digits = phone.replace(/[^\d]/g, "").replace(/^00/, "");
  for (const [code, country] of DIAL_CODES) {
    if (digits.startsWith(code)) return country;
  }
  return null;
}

// Meta's status pull writes the LANDED category ("UTILITY", "marketing"…,
// waTemplates.metaCategory) and review recategorises what it disagrees with,
// so this normalises whatever landed. A template we cannot resolve bills as
// utility: every template this product authors is an appointment
// confirmation, reminder or winback, and utility is what those honestly are —
// guessing marketing would overcharge the org on the platform's own
// bookkeeping gap.
export function normalizeWaCategory(raw: string | undefined): WaCategory {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("market")) return "marketing";
  if (value.includes("auth")) return "authentication";
  return "utility";
}

// The stored override merged OVER the defaults, row by row: the operator
// edits only the markets they care about and the rest keep tracking the
// checked-in card. A row that does not parse is ignored rather than thrown —
// a typo in the admin JSON must not take every send's meter down with it.
export function resolveWaRateTable(raw: string | null): Record<string, WaRates> {
  const table: Record<string, WaRates> = { ...DEFAULT_WA_RATES };
  if (!raw) return table;
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<Record<WaCategory, unknown>>>;
    for (const [country, rates] of Object.entries(parsed)) {
      if (!rates || typeof rates !== "object") continue;
      const base = table[country] ?? table.other;
      const num = (value: unknown, fallback: number) => {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
      };
      table[country] = {
        marketing: num(rates.marketing, base.marketing),
        utility: num(rates.utility, base.utility),
        authentication: num(rates.authentication, base.authentication),
      };
    }
  } catch {
    // fall through with defaults
  }
  return table;
}

export function waRateFor(
  table: Record<string, WaRates>,
  country: string | null,
  category: WaCategory,
): number {
  return (country ? (table[country] ?? table.other) : table.other)[category];
}

// Integer micro-USD, rounded up — the costMicroUsd rule (lib/llm.ts): a
// fraction owed is a micro-dollar owed.
export function withMarkup(costMicroUsd: number, percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return costMicroUsd;
  return Math.ceil(costMicroUsd * (1 + percent / 100));
}
