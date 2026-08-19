"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLanguage } from "@/lib/LanguageProvider";
import { DEMO_ORIGIN, DOCS_ORIGIN } from "@/lib/hosts";
import { LANGUAGES, isLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { LANDING, type LandingCopy } from "@/lib/landing";

// The page is three beats read top to bottom: the promise, the price of doing
// nothing, the machine. Auth lives on /signin — the landing never names a
// sign-in method, it only says "start".
export function Landing() {
  const { language, setLanguage } = useLanguage();
  const { resolvedTheme, setTheme, mounted } = useTheme();
  const copy = LANDING[language];

  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <div className="mx-auto max-w-3xl px-6">
        <nav className="flex h-16 items-center gap-6">
          <a href="#top" className="flex shrink-0 items-center gap-2.5">
            <Mark />
            <span className="text-lg font-semibold tracking-tight">Resepta</span>
          </a>
          <div className="hidden items-center gap-5 text-sm text-[var(--muted-strong)] md:flex">
            <a className="transition-colors hover:text-[var(--foreground)]" href="#cost">
              {copy.nav.cost}
            </a>
            <a className="transition-colors hover:text-[var(--foreground)]" href="#how">
              {copy.nav.how}
            </a>
            <a
              className="transition-colors hover:text-[var(--foreground)]"
              href={DOCS_ORIGIN}
              target="_blank"
              rel="noreferrer"
            >
              {copy.help}
            </a>
          </div>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <select
              aria-label="Language"
              className="w-auto bg-transparent text-sm"
              value={language}
              onChange={(event) => {
                if (isLanguage(event.target.value)) setLanguage(event.target.value);
              }}
            >
              {LANGUAGES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            <Link
              href="/signin"
              className="rounded-lg px-3 py-2 text-sm text-[var(--muted-strong)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            >
              {copy.signIn}
            </Link>
            <Link
              href="/signin"
              className="hidden rounded-lg bg-[var(--accent)] px-3.5 py-2 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 sm:block"
            >
              {copy.cta}
            </Link>
          </div>
        </nav>

        <main id="top">
          <section className="landing-rise pb-24 pt-20 sm:pb-28 sm:pt-28">
            <h1 className="max-w-[16ch] text-[clamp(2.4rem,6vw,3.6rem)] font-semibold leading-[1.04] tracking-[-0.03em]">
              {copy.headline}
            </h1>
            <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-[var(--muted-strong)]">
              {copy.subhead}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/signin"
                className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
              >
                {copy.cta}
              </Link>
              <a
                href="#how"
                className="rounded-lg px-4 py-2.5 text-[var(--muted-strong)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              >
                {copy.seeHow} <span aria-hidden>↓</span>
              </a>
            </div>
            <p className="mt-4 text-sm text-[var(--muted)]">{copy.ctaNote}</p>
          </section>

          <section id="cost" className="scroll-mt-24 border-t border-[var(--border)] py-20 sm:py-24">
            <h2 className="max-w-[26ch] text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
              {copy.cost.title}
            </h2>
            <p className="mt-4 max-w-[58ch] leading-relaxed text-[var(--muted-strong)]">
              {copy.cost.body}
            </p>
            {/* Keyed by language: defaults are per-currency, so a language
                switch remounts the calculator instead of carrying, say, a
                ₺500 default into a USD result. */}
            <CostCalculator key={language} cost={copy.cost} />
            <p className="mt-4 text-sm text-[var(--muted)]">{copy.cost.statLine}</p>
          </section>

          <section id="how" className="scroll-mt-24 border-t border-[var(--border)] py-20 sm:py-24">
            <h2 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
              {copy.how.title}
            </h2>
            <p className="mt-4 max-w-[58ch] leading-relaxed text-[var(--muted-strong)]">
              {copy.how.body}
            </p>

            <ol className="mt-12">
              {copy.how.steps.map((step, index) => {
                const last = index === copy.how.steps.length - 1;
                return (
                  <li key={step.title} className="relative pl-12">
                    {!last && (
                      <span
                        aria-hidden
                        className="absolute bottom-0 left-[0.9375rem] top-8 w-px bg-[var(--border)]"
                      />
                    )}
                    <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--muted-bg)] text-xs font-medium tabular-nums text-[var(--muted-strong)]">
                      {index + 1}
                    </span>
                    <div className={last ? "pt-1" : "pb-10 pt-1"}>
                      <h3 className="font-semibold">{step.title}</h3>
                      <p className="mt-1.5 max-w-[56ch] leading-relaxed text-[var(--muted)]">
                        {step.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>

            <p className="mt-12 max-w-[58ch] text-sm leading-relaxed text-[var(--muted)]">
              {copy.how.channelsNote}
            </p>

            <div className="mt-16">
              <p className="text-xl font-semibold tracking-[-0.01em]">{copy.how.closing}</p>
              <Link
                href="/signin"
                className="mt-5 inline-block rounded-lg bg-[var(--accent)] px-5 py-2.5 font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
              >
                {copy.cta}
              </Link>
            </div>
          </section>
        </main>

        <footer className="border-t border-[var(--border)] py-12 text-sm text-[var(--muted)]">
          <div className="flex items-center gap-2.5 text-[var(--foreground)]">
            <Mark small />
            <span className="font-semibold">Resepta</span>
          </div>
          <p className="mt-3 max-w-[30rem] leading-relaxed">{copy.footerLine}</p>

          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            <FooterNav title={copy.footerProduct}>
              <a href="#cost">{copy.nav.cost}</a>
              <a href="#how">{copy.nav.how}</a>
              {/* The demo shows the workspace UI with sample data — a footer
                  resource, not a call to action promising interactivity. */}
              <a href={DEMO_ORIGIN} target="_blank" rel="noreferrer">
                {copy.demoLink}
              </a>
            </FooterNav>
            <FooterNav title={copy.footerResources}>
              <a href={DOCS_ORIGIN} target="_blank" rel="noreferrer">
                {copy.help}
              </a>
              <Link href="/privacy">{copy.privacy}</Link>
              <Link href="/terms">{copy.terms}</Link>
            </FooterNav>
            <div>
              <p className="font-semibold text-[var(--foreground)]">{copy.footerCompany}</p>
              <a
                href="https://autotakt.dev"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 font-semibold text-[var(--foreground)] transition-opacity hover:opacity-70"
              >
                autotakt.dev <span aria-hidden>↗</span>
              </a>
              <p className="mt-2 leading-relaxed">{copy.footerAutotaktLine}</p>
            </div>
          </div>

          <div className="mt-10 flex items-center justify-between border-t border-[var(--border)] pt-5 text-xs">
            <span>© {new Date().getFullYear()} Resepta · Autotakt</span>
            <button
              type="button"
              aria-label={resolvedTheme === "dark" ? copy.themeToLight : copy.themeToDark}
              title={resolvedTheme === "dark" ? copy.themeToLight : copy.themeToDark}
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] ${
                mounted ? "opacity-100" : "opacity-0"
              }`}
            >
              {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// The visitor's own numbers make the argument; the page only does the
// arithmetic. The one external statistic stays outside this card, cited.
function CostCalculator({ cost }: { cost: LandingCopy["cost"] }) {
  const [missedInput, setMissedInput] = useState(String(cost.defaultMissed));
  const [valueInput, setValueInput] = useState(String(cost.defaultValue));

  const missed = clampNumber(missedInput);
  const value = clampNumber(valueInput);
  const yearly = Math.round(missed * value * 52);

  const currencyFormat = useMemo(
    () =>
      new Intl.NumberFormat(cost.locale, {
        style: "currency",
        currency: cost.currency,
        maximumFractionDigits: 0,
      }),
    [cost.locale, cost.currency],
  );
  const monthNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(cost.locale, { month: "long" });
    return Array.from({ length: 12 }, (_, i) => format.format(new Date(2000, i, 1)));
  }, [cost.locale]);

  return (
    <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm text-[var(--muted-strong)]">{cost.missedLabel}</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={missedInput}
            onChange={(event) => setMissedInput(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 tabular-nums"
          />
        </label>
        <label className="block">
          <span className="text-sm text-[var(--muted-strong)]">{cost.valueLabel}</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={valueInput}
            onChange={(event) => setValueInput(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 tabular-nums"
          />
        </label>
      </div>

      <p className="mt-7">
        <span className="block text-4xl font-semibold tabular-nums tracking-[-0.02em] sm:text-5xl">
          {currencyFormat.format(yearly)}
        </span>
        <span className="mt-1.5 block text-[var(--muted-strong)]">{cost.resultSuffix}</span>
      </p>

      <CostChart yearly={yearly} monthNames={monthNames} format={currencyFormat} />
      <p className="mt-2 text-xs text-[var(--muted)]">{cost.chartCaption}</p>
    </div>
  );
}

const CHART_W = 480;
const CHART_H = 110;
const BAR_GAP = 3;
const BAR_RADIUS = 3;

// Cumulative loss by month: one series, one hue, bars anchored to the
// baseline with only the data end rounded (the clip swallows the bottom
// corners). Values live in the hero number above; bars carry native tooltips.
function CostChart({
  yearly,
  monthNames,
  format,
}: {
  yearly: number;
  monthNames: string[];
  format: Intl.NumberFormat;
}) {
  const barWidth = (CHART_W - BAR_GAP * 11) / 12;
  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="mt-6 h-auto w-full"
      role="img"
      aria-label={monthNames
        .map((name, i) => `${name}: ${format.format(Math.round((yearly * (i + 1)) / 12))}`)
        .join(", ")}
    >
      <defs>
        <clipPath id="cost-baseline">
          <rect x="0" y="0" width={CHART_W} height={CHART_H} />
        </clipPath>
      </defs>
      <line
        x1="0"
        y1={CHART_H - 0.5}
        x2={CHART_W}
        y2={CHART_H - 0.5}
        stroke="var(--border)"
        strokeWidth="1"
      />
      <g clipPath="url(#cost-baseline)">
        {monthNames.map((name, i) => {
          const cumulative = Math.round((yearly * (i + 1)) / 12);
          const height = yearly === 0 ? 0 : ((i + 1) / 12) * (CHART_H - 8);
          return (
            <rect
              key={name}
              x={i * (barWidth + BAR_GAP)}
              y={CHART_H - height}
              width={barWidth}
              // Extends past the baseline so the clip leaves the bottom square.
              height={height + BAR_RADIUS}
              rx={BAR_RADIUS}
              fill="var(--accent)"
            >
              <title>{`${name} · ${format.format(cumulative)}`}</title>
            </rect>
          );
        })}
      </g>
    </svg>
  );
}

function clampNumber(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 1_000_000);
}

function FooterNav({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <nav className="flex flex-col items-start gap-3">
      <p className="mb-1 font-semibold text-[var(--foreground)]">{title}</p>
      <div className="flex flex-col items-start gap-3 [&_a]:transition-colors [&_a]:hover:text-[var(--foreground)]">
        {children}
      </div>
    </nav>
  );
}

function Mark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg bg-[var(--logo)] ${
        small ? "h-7 w-7" : "h-8 w-8"
      }`}
    >
      <svg viewBox="0 0 24 24" className={small ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true">
        <path
          d="M4 6l6 6-6 6M13 6l6 6-6 6"
          fill="none"
          stroke="#fff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function SunIcon() {
  return (
    <svg className="h-[1.125rem] w-[1.125rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="h-[1.125rem] w-[1.125rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5a8.5 8.5 0 1 0 11.7 11.7Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
