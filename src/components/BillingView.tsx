"use client";

import { useAction, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatDateTime } from "@/lib/datetime";
import { Card } from "./Card";

// The prepaid wallet's own sidebar destination (schema: orgs.billingMode).
// Owners of prepaid orgs only — everyone else never sees the tab (AppShell
// footTabs) and the query resolves null anyway. Everything renders in USD
// for the same reason the voice Usage section does: the meter runs in USD,
// and the org's display currency is a booking-revenue concern.
//
// Top-up is a redirect into Stripe Checkout, not an in-app card form: the
// card number never touches this product, which is the whole point of
// Checkout. The credit lands when Stripe's webhook confirms payment, and the
// balance here updates by itself — Convex reactivity is the "refresh".

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function BillingView() {
  const { t, language } = useLanguage();
  const data = useQuery(api.wallet.overview, {});
  const createSession = useAction(api.wallet.createTopupSession);
  const [starting, setStarting] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // The ride back from a paid Checkout lands on ?topup=success. Shown once
  // and scrubbed from the URL, so a reload or a shared link does not claim a
  // second payment.
  const [justPaid, setJustPaid] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("topup") === "success") {
      setJustPaid(true);
      url.searchParams.delete("topup");
      window.history.replaceState(null, "", url);
    }
  }, []);

  if (data === undefined) {
    return (
      <p className="animate-pulse text-sm text-[var(--muted)]">
        {t("common.loading")}
      </p>
    );
  }
  if (data === null) return null;

  const usd = (m: number) => `$${(m / 1_000_000).toFixed(2)}`;
  const empty = data.balanceMicroUsd <= 0;
  const low = !empty && data.balanceMicroUsd <= data.lowWaterMicroUsd;

  const topUp = async (amountUsd: number) => {
    setStarting(amountUsd);
    setFailed(false);
    try {
      window.location.href = await createSession({ amountUsd });
    } catch {
      setFailed(true);
      setStarting(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 page-stack">
      {justPaid && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
          {t("wallet.paid")}
        </div>
      )}
      {/* The same in-band honesty as the alert mails: the page says what is
          stopped, never lets a customer be the messenger. */}
      {empty && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {t("wallet.paused")}
        </div>
      )}
      {low && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          {t("wallet.low")}
        </div>
      )}

      <Card>
        <p className="text-sm text-[var(--muted-strong)]">{t("wallet.balance")}</p>
        <p
          className={`mt-1 text-3xl font-semibold tabular-nums ${
            empty ? "text-red-600 dark:text-red-400" : ""
          }`}
        >
          {usd(data.balanceMicroUsd)}
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {t("voiceBilling.rateLine").replace(
            "{rate}",
            usd(data.rateMicroUsdPerMinute),
          )}
        </p>

        <div className="mt-4 border-t border-[var(--table-divider)] pt-4">
          <p className="text-sm text-[var(--muted)]">{t("wallet.topUpLine")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {data.topupAmountsUsd.map((amount) => (
              <button
                key={amount}
                type="button"
                disabled={starting !== null}
                onClick={() => void topUp(amount)}
                className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {starting === amount
                  ? t("wallet.starting")
                  : t("wallet.topUpWith").replace("{amount}", `$${amount}`)}
              </button>
            ))}
          </div>
          {failed && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              {t("wallet.error")}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <p className="text-sm font-medium">{t("wallet.topups")}</p>
        {data.topups.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">{t("wallet.noTopups")}</p>
        ) : (
          <div className="thin-scroll mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs">
                <tr>
                  <th className="px-3 py-2 font-semibold">{t("calls.when")}</th>
                  <th className="px-3 py-2 font-semibold">
                    {t("voiceBilling.amount")}
                  </th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {data.topups.map((topup) => (
                  <tr
                    key={`${topup.at}-${topup.amountMicroUsd}`}
                    className="border-t border-[var(--table-divider)] tabular-nums"
                  >
                    <td className="px-3 py-2">
                      {formatDateTime(topup.at, language)}
                    </td>
                    <td className="px-3 py-2">{usd(topup.amountMicroUsd)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--muted)]">
                      {topup.source === "stripe"
                        ? t("wallet.sourceStripe")
                        : t("wallet.sourceManual")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <p className="text-sm font-medium">{t("voiceBilling.title")}</p>
        {data.months.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            {t("voiceBilling.empty")}
          </p>
        ) : (
          <div className="thin-scroll mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs">
                <tr>
                  <th className="px-3 py-2 font-semibold">
                    {t("voiceBilling.month")}
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    {t("voiceBilling.calls")}
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    {t("voiceBilling.talkTime")}
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    {t("voiceBilling.amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((m) => (
                  <tr
                    key={m.month}
                    className="border-t border-[var(--table-divider)] tabular-nums"
                  >
                    <td className="px-3 py-2">{m.month}</td>
                    <td className="px-3 py-2">{m.calls}</td>
                    <td className="px-3 py-2">{fmtDuration(m.seconds)}</td>
                    <td className="px-3 py-2">{usd(m.billedMicroUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
