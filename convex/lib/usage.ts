// The ledger's clock. Every counter on usageMonthly — LLM turns and voice
// calls alike — buckets by this key, so the two lanes always reconcile on the
// same month boundary.

// "2026-08" in the org's zone. UTC when the zone is broken — a wrong bucket
// at a month boundary beats a thrown turn.
export function monthKey(at: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
    }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 7);
  }
}
