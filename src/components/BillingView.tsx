"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatDateTime, localeFor } from "@/lib/datetime";
import type { Language } from "@/lib/i18n";
import { Card } from "./Card";
import { InfoTip } from "./InfoTip";
import { ROW_GRID, RowLabel } from "./RowLabel";

// Billing, every owner's sidebar destination above the profile (schema:
// orgs.billingMode). Owners only — staff never see the tab (AppShell) and
// both queries resolve null for them anyway. The view branches on the org's
// billing mode: prepaid owners get the wallet, top-ups and usage; invoice
// owners get the meter and the soft budget, with the settling happening
// outside the product. Everything renders in USD for the same reason the
// meter runs in USD: the org's display currency is a booking-revenue concern.
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

// "2026-08" is the sort key the usage rows are stored under, not something to
// show a salon owner. Built from the parts rather than handed to Date("2026-08"),
// which parses as UTC midnight and therefore renders as the PREVIOUS month
// everywhere west of London.
function monthLabel(month: string, language: Language): string {
  const [year, index] = month.split("-").map(Number);
  if (!year || !index) return month;
  return new Intl.DateTimeFormat(localeFor(language), {
    year: "numeric",
    month: "long",
  }).format(new Date(year, index - 1, 1));
}

export function BillingView() {
  const { t, language } = useLanguage();
  const data = useQuery(api.wallet.overview, {});
  const meter = useQuery(api.billing.voiceOverview, {});
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

  if (data === undefined || meter === undefined) {
    return (
      <p className="animate-pulse text-sm text-[var(--muted)]">
        {t("common.loading")}
      </p>
    );
  }
  // No wallet means the invoice lane: the meter and the soft budget, no
  // money controls, because settling happens outside the product.
  if (data === null) return <InvoiceBilling meter={meter} />;

  const usd = (m: number) => `$${(m / 1_000_000).toFixed(2)}`;
  const empty = data.balanceMicroUsd <= 0;
  const low = !empty && data.balanceMicroUsd <= data.lowWaterMicroUsd;

  const topUp = async (amountUsd: number) => {
    setStarting(amountUsd);
    setFailed(false);
    try {
      // assign(), not `location.href =`. Identical behaviour — navigate, add a
      // history entry — but it reads as the action it is instead of as a
      // property write, which is also what stops react-hooks/immutability
      // flagging it as mutating something defined outside the component.
      // DemoEntry navigates the same way.
      window.location.assign(await createSession({ amountUsd }));
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
        {/* The rate line and the Stripe paragraph both moved into this (i).
            They were explanation sitting permanently on the one card an owner
            opens to read a number, and explanation belongs one hover away. */}
        <div className="flex items-center gap-2">
          <p className="text-sm text-[var(--muted-strong)]">{t("wallet.balance")}</p>
          <InfoTip
            text={t("wallet.balanceHint", { rate: usd(data.rateMicroUsdPerMinute) })}
          />
        </div>
        <p
          className={`mt-1 text-3xl font-semibold tabular-nums ${
            empty ? "text-red-600 dark:text-red-400" : ""
          }`}
        >
          {usd(data.balanceMicroUsd)}
        </p>
        {/* What the balance BUYS. The dollars were standing in for this and
            answering it badly: nobody holds $0.11 a minute in their head while
            reading $6.45. Absent rather than zeroed when there is no rate or
            no money, since a runway of "0 minutes" is the paused banner's job
            and this would only repeat it. */}
        {!empty && data.rateMicroUsdPerMinute > 0 && (
          <p className="mt-1 text-sm text-[var(--muted)] tabular-nums">
            {t.plural(
              "wallet.runway",
              Math.floor(data.balanceMicroUsd / data.rateMicroUsdPerMinute),
            )}
          </p>
        )}

        <div className="mt-4 border-t border-[var(--table-divider)] pt-4">
          <div className="flex flex-wrap items-center gap-2">
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
                  : t("wallet.topUpWith", { amount: `$${amount}` })}
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

      {/* Usage sits ABOVE top-ups, which is the order the questions arrive
          in. An owner opens this tab to ask what the agent is costing them
          this month and how that compares with what is left upstairs; the
          receipts for money they already paid are a trail they consult when
          something looks wrong, not a thing they read. Directly under the
          balance, so "left" and "spent" are one glance apart. */}
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
                    <td className="px-3 py-2">{monthLabel(m.month, language)}</td>
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
      <MessagingUsage />
      {/* The receipt trail. Demoted, not dropped: when a payment does not
          land this is the only place an owner can see whether it ever did. */}
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
                        : topup.source === "trial"
                          ? t("wallet.sourceTrial")
                          : t("wallet.sourceManual")}
                    </td>
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

// The invoice lane's half of the tab: the meter, the soft budget, and a line
// saying where the money actually moves. Ported from the voice page's old
// Usage section — the bill belongs to the business, not to one channel, so
// it lives here now and the voice strip lost its billing chip.
function InvoiceBilling({
  meter,
}: {
  meter: {
    rateMicroUsdPerMinute: number;
    mode: "invoice" | "prepaid";
    budgetMicroUsd: number | null;
    months: {
      month: string;
      calls: number;
      seconds: number;
      billedMicroUsd: number;
    }[];
  } | null;
}) {
  const { t, language } = useLanguage();
  const setBudget = useMutation(api.billing.setVoiceBudget);
  if (meter === null) return null;

  const usd = (m: number) => `$${(m / 1_000_000).toFixed(2)}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4 page-stack">
      <Card>
        <p className="text-sm text-[var(--muted-strong)]">
          {t("voiceBilling.rateLine", { rate: usd(meter.rateMicroUsdPerMinute) })}
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {t("wallet.invoiceLine")}
        </p>

        <div className={`mt-4 ${ROW_GRID}`}>
          <RowLabel
            label={t("voiceBilling.budget")}
            hint={t("voiceBilling.budgetHint")}
          />
          <input
            inputMode="decimal"
            defaultValue={
              meter.budgetMicroUsd === null
                ? ""
                : String(meter.budgetMicroUsd / 1_000_000)
            }
            placeholder="50"
            onBlur={(e) => {
              const parsed = Number(e.target.value.replace(",", "."));
              void setBudget({
                budgetMicroUsd:
                  !e.target.value.trim() || Number.isNaN(parsed)
                    ? null
                    : Math.round(parsed * 1_000_000),
              });
            }}
          />
        </div>
      </Card>

      <Card>
        <p className="text-sm font-medium">{t("voiceBilling.title")}</p>
        {meter.months.length === 0 ? (
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
                {meter.months.map((m) => (
                  <tr
                    key={m.month}
                    className="border-t border-[var(--table-divider)] tabular-nums"
                  >
                    <td className="px-3 py-2">{monthLabel(m.month, language)}</td>
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

      <MessagingUsage />
    </div>
  );
}

// The other two lanes on the same bill, own query so both billing modes can
// mount it as-is. Absent entirely until there is either a rate to explain or
// a month with billed activity: a salon whose agent is not priced and whose
// sends are all free session replies has nothing to read here, and an empty
// card would only ask a question the voice table already answered.
function MessagingUsage() {
  const { t, language } = useLanguage();
  const data = useQuery(api.billing.messagingOverview, {});
  if (!data) return null;
  if (data.months.length === 0 && data.chatRateMicroUsdPerTurn <= 0) {
    return null;
  }
  const usd = (m: number) => `$${(m / 1_000_000).toFixed(2)}`;
  // Per-reply rates live below a cent ($0.05, $0.025); two forced decimals
  // would round the price the org is actually paying.
  const usdRate = (m: number) => `$${Number((m / 1_000_000).toFixed(4))}`;
  return (
    <Card>
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">{t("aiBilling.title")}</p>
        <InfoTip text={t("aiBilling.hint")} />
      </div>
      {data.chatRateMicroUsdPerTurn > 0 && (
        <p className="mt-1 text-sm text-[var(--muted)]">
          {t("aiBilling.rateLine", { rate: usdRate(data.chatRateMicroUsdPerTurn) })}
        </p>
      )}
      {data.months.length > 0 && (
        <div className="thin-scroll mt-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-semibold">
                  {t("voiceBilling.month")}
                </th>
                <th className="px-3 py-2 font-semibold">
                  {t("aiBilling.replies")}
                </th>
                <th className="px-3 py-2 font-semibold">
                  {t("aiBilling.waMessages")}
                </th>
                <th className="px-3 py-2 font-semibold">
                  {t("aiBilling.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr
                  key={m.month}
                  className="border-t border-[var(--table-divider)] tabular-nums"
                >
                  <td className="px-3 py-2">{monthLabel(m.month, language)}</td>
                  {/* count · amount in one cell: the count explains the
                      amount, and four money columns would push Total off a
                      phone screen. */}
                  <td className="px-3 py-2">
                    {m.chatReplies} · {usd(m.chatBilledMicroUsd)}
                  </td>
                  <td className="px-3 py-2">
                    {m.waMessages} · {usd(m.waBilledMicroUsd)}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {usd(m.chatBilledMicroUsd + m.waBilledMicroUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
