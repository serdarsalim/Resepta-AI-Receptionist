"use client";

import Image from "next/image";
import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { useLanguage } from "@/lib/LanguageProvider";
import { DEMO_ORIGIN, DOCS_ORIGIN } from "@/lib/hosts";
import { LANGUAGES, isLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import {
  LANDING,
  type LandingCopy,
  type LandingFeature,
  type LandingUseCase,
} from "@/lib/landing";

export function Landing() {
  const { signIn } = useAuthActions();
  const { t, language, setLanguage } = useLanguage();
  const { resolvedTheme, setTheme, mounted } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [activeUseCase, setActiveUseCase] =
    useState<LandingUseCase["id"]>("beauty");
  const copy = LANDING[language];
  const useCase =
    copy.useCases.find((item) => item.id === activeUseCase) ?? copy.useCases[0];

  const start = async () => {
    setBusy(true);
    setError(false);
    try {
      await signIn("google");
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <div id="top" className="min-h-dvh overflow-hidden bg-[var(--background)]">
      <nav className="sticky top-3 z-50 mx-auto w-[min(100%-1.5rem,76rem)] rounded-2xl bg-[color-mix(in_srgb,var(--card)_82%,transparent)] shadow-[0_8px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-5">
          <a href="#top" className="flex shrink-0 items-center gap-2.5">
            <Mark />
            <span className="text-xl font-bold tracking-tight">Resepta</span>
          </a>

          <div className="hidden items-center gap-6 text-sm text-[var(--muted)] md:flex">
            <a className="transition-colors hover:text-[var(--foreground)]" href="#product">
              {copy.nav.product}
            </a>
            <a className="transition-colors hover:text-[var(--foreground)]" href="#workflow">
              {copy.nav.workflow}
            </a>
            <a className="transition-colors hover:text-[var(--foreground)]" href="#use-cases">
              {copy.nav.useCases}
            </a>
            <a className="transition-colors hover:text-[var(--foreground)]" href="#setup">
              {copy.nav.setup}
            </a>
            {/* The only nav entry that leaves the page, so it opens in its own
                tab: the help centre lives on the docs origin and a visitor
                reading a guide has not finished with the landing page. */}
            <a
              className="transition-colors hover:text-[var(--foreground)]"
              href={DOCS_ORIGIN}
              target="_blank"
              rel="noreferrer"
            >
              {copy.help}
            </a>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              aria-label={resolvedTheme === "dark" ? copy.themeToLight : copy.themeToDark}
              title={resolvedTheme === "dark" ? copy.themeToLight : copy.themeToDark}
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] ${
                mounted ? "opacity-100" : "opacity-0"
              }`}
            >
              {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
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
            <button
              disabled={busy}
              onClick={start}
              className="hidden rounded-lg bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#1d4ed8] disabled:opacity-60 sm:block"
            >
              {copy.navCta}
            </button>
          </div>
        </div>
      </nav>

      <main>
        <section className="relative mx-auto max-w-[76rem] px-6 pb-16 pt-14 sm:pb-24 sm:pt-20">
          <div
            aria-hidden
            className="pointer-events-none absolute -left-48 -top-40 h-[32rem] w-[32rem] rounded-full bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-52 top-10 h-[30rem] w-[30rem] rounded-full bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] blur-3xl"
          />
          <div className="relative grid items-center gap-12 lg:grid-cols-[1.08fr_0.92fr] lg:gap-12">
            <div className="landing-rise">
              <h1 className="max-w-[13ch] text-[clamp(2.8rem,5.2vw,4.65rem)] font-bold leading-[0.96] tracking-[-0.06em]">
                {copy.headlineLead}
                <span className="bg-[linear-gradient(105deg,var(--brand),var(--accent))] bg-clip-text text-transparent">
                  {copy.headlineAccent}
                </span>
              </h1>
              <p className="mt-7 max-w-[56ch] text-lg leading-relaxed text-[var(--muted-strong)] sm:text-xl">
                {copy.subhead}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  disabled={busy}
                  onClick={start}
                  className="inline-flex items-center gap-2.5 rounded-lg bg-[#2563eb] px-6 py-3.5 text-base font-semibold text-white shadow-[0_10px_24px_color-mix(in_srgb,var(--accent)_24%,transparent)] transition-colors duration-150 hover:bg-[#1d4ed8] disabled:opacity-60"
                >
                  <GoogleIcon />
                  {copy.ctaPrimary}
                </button>
                {/* The demo stays on its own origin so an owner's real session
                    is never replaced by the anonymous showroom session. */}
                <a
                  href={DEMO_ORIGIN}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg px-5 py-3.5 text-base font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted-bg)]"
                >
                  {copy.ctaDemo} <ArrowIcon />
                </a>
              </div>
              <p className="mt-3 text-sm text-[var(--muted)]">{copy.ctaNote}</p>
              {error && (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400">
                  {t("auth.failed")}
                </p>
              )}
              <div className="mt-8 flex max-w-[38rem] flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted-strong)]">
                {copy.proof.map((item) => (
                  <span key={item} className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <HeroProduct copy={copy} />
          </div>

        </section>

        <section id="workflow" className="scroll-mt-24 bg-[var(--pane)]">
          <div className="mx-auto max-w-[76rem] px-6 py-20 sm:py-28">
            <SectionIntro title={copy.workflowTitle} body={copy.workflowBody} wide />
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {copy.workflow.map((step, index) => (
                <div
                  key={step.number}
                  className="relative overflow-hidden rounded-2xl bg-[var(--card)] p-6 shadow-[var(--card-shadow)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand)]">
                      {step.number}
                    </span>
                    {index < copy.workflow.length - 1 && (
                      <span className="hidden text-[var(--muted)] md:block">
                        <ArrowIcon />
                      </span>
                    )}
                  </div>
                  <h3 className="mt-10 text-xl font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-3 leading-relaxed text-[var(--muted)]">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="product" className="scroll-mt-24">
          <div className="mx-auto grid max-w-[76rem] items-center gap-14 px-6 py-20 sm:py-28 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div>
              <SectionIntro
                title={copy.productTitle}
                body={copy.productBody}
              />
              <div className="mt-7 space-y-3">
                {copy.productPoints.map((point) => (
                  <div key={point} className="flex items-start gap-3">
                    <CheckIcon />
                    <span className="leading-relaxed">{point}</span>
                  </div>
                ))}
              </div>
            </div>
            <ProductPreview copy={copy} />
          </div>
        </section>

        <section id="use-cases" className="scroll-mt-24 bg-[var(--pane)]">
          <div className="mx-auto max-w-[76rem] px-6 py-20 sm:py-28">
            <SectionIntro
              title={copy.useCasesTitle}
              body={copy.useCasesBody}
              wide
            />

            <div
              role="tablist"
              aria-label={copy.useCasesTitle}
              className="mt-10 flex max-w-full gap-6 overflow-x-auto border-b border-[var(--border)] no-scrollbar sm:w-fit"
            >
              {copy.useCases.map((item) => {
                const active = item.id === useCase.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveUseCase(item.id)}
                    className={`relative shrink-0 px-0.5 pb-3 text-sm font-medium transition-colors duration-200 ${
                      active
                        ? "text-[var(--foreground)] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-[var(--foreground)]"
                        : "text-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {item.tab}
                  </button>
                );
              })}
            </div>

            <div
              key={useCase.id}
              role="tabpanel"
              className="landing-tab-enter mt-8 grid min-h-[30rem] overflow-hidden rounded-[2rem] bg-[var(--card)] shadow-[0_18px_48px_rgba(15,23,42,0.08)] lg:grid-cols-[1.05fr_0.95fr]"
            >
              <div className="relative min-h-[20rem] overflow-hidden lg:min-h-[30rem]">
                <Image
                  src={useCase.image}
                  alt={useCase.imageAlt}
                  fill
                  sizes="(max-width: 1024px) 100vw, 52vw"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_60%,rgba(0,0,0,0.18))]" />
              </div>
              <div className="flex min-h-[20rem] flex-col justify-center p-7 sm:p-10 lg:p-12">
                <h3 className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
                  {useCase.title}
                </h3>
                <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-[var(--muted)]">
                  {useCase.body}
                </p>
                <p className="mt-7 flex items-center gap-2 font-semibold">
                  <CheckIcon />
                  {useCase.outcome}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-24">
          <div className="mx-auto max-w-[76rem] px-6 py-20 sm:py-28">
            <SectionIntro title={copy.featuresTitle} body={copy.featuresBody} wide />
            <div className="mt-12 grid gap-5 sm:grid-cols-2">
              {copy.features.map((feature) => (
                <Feature key={feature.title} feature={feature} />
              ))}
            </div>
          </div>
        </section>

        <section id="setup" className="scroll-mt-24 bg-[var(--pane)]">
          <div className="mx-auto max-w-[76rem] px-6 py-20 sm:py-28">
            <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
              <SectionIntro title={copy.setupTitle} body={copy.setupBody} />
              <div className="grid gap-4">
                {copy.setup.map((step) => (
                  <div
                    key={step.number}
                    className="grid grid-cols-[2.75rem_1fr] gap-4 rounded-2xl bg-[var(--card)] p-5 shadow-[var(--card-shadow)] sm:p-6"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand)]">
                      {step.number}
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold">{step.title}</h3>
                      <p className="mt-1.5 leading-relaxed text-[var(--muted)]">{step.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="relative mx-auto max-w-[76rem] overflow-hidden rounded-[2rem] bg-[linear-gradient(120deg,color-mix(in_srgb,var(--brand)_18%,var(--card)),color-mix(in_srgb,var(--accent)_16%,var(--card)))] px-6 py-16 text-center sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute -left-12 -top-24 h-64 w-64 rounded-full bg-[color-mix(in_srgb,var(--brand)_22%,transparent)] blur-3xl" />
            <div className="pointer-events-none absolute -bottom-32 -right-16 h-72 w-72 rounded-full bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] blur-3xl" />
            <div className="relative mx-auto max-w-3xl">
              <h2 className="text-3xl font-bold tracking-[-0.035em] sm:text-5xl">
                {copy.closingTitle}
              </h2>
              <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">
                {copy.closingBody}
              </p>
              <button
                disabled={busy}
                onClick={start}
                className="mt-8 inline-flex items-center gap-2.5 rounded-lg bg-[#2563eb] px-7 py-3.5 text-base font-semibold text-white shadow-[0_10px_26px_color-mix(in_srgb,var(--accent)_24%,transparent)] transition-colors duration-150 hover:bg-[#1d4ed8] disabled:opacity-60"
              >
                <GoogleIcon />
                {copy.ctaPrimary}
              </button>
              <p className="mt-3 text-sm text-[var(--muted)]">{copy.ctaNote}</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto max-w-[76rem] px-6 py-12 text-sm text-[var(--muted)] sm:py-14">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.35fr_0.7fr_0.8fr_1.15fr] lg:gap-14">
            <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2.5 text-[var(--foreground)]">
              <Mark />
              <span className="text-base font-semibold">Resepta</span>
            </div>
              <p className="mt-3 max-w-[30rem] leading-relaxed">{copy.footerLine}</p>
            </div>

            <FooterNav title={copy.footerProduct}>
              <a href="#product">{copy.nav.product}</a>
              <a href="#workflow">{copy.nav.workflow}</a>
              <a href="#use-cases">{copy.nav.useCases}</a>
              <a href="#setup">{copy.nav.setup}</a>
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
                className="mt-4 inline-flex items-center gap-1.5 font-semibold text-[var(--foreground)] transition-opacity hover:opacity-70"
              >
                autotakt.dev <span aria-hidden>↗</span>
              </a>
              <p className="mt-2 max-w-[28rem] leading-relaxed">{copy.footerAutotaktLine}</p>
            </div>
          </div>

          <div className="mt-10 border-t border-[var(--border)] pt-5 text-xs">
            © {new Date().getFullYear()} Resepta · Autotakt
          </div>
        </div>
      </footer>
    </div>
  );
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

function SectionIntro({
  title,
  body,
  wide = false,
}: {
  title: string;
  body?: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "max-w-4xl" : "max-w-2xl"}>
      <h2 className="text-3xl font-bold tracking-[-0.035em] sm:text-4xl lg:text-[2.75rem] lg:leading-[1.08]">
        {title}
      </h2>
      {body && <p className="mt-4 text-lg leading-relaxed text-[var(--muted)]">{body}</p>}
    </div>
  );
}

function HeroProduct({ copy }: { copy: LandingCopy }) {
  const hero = copy.hero;
  return (
    <div className="landing-rise landing-rise-delay w-full max-w-[34rem] justify-self-end overflow-hidden rounded-[1.75rem] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--brand)_12%,var(--pane)),color-mix(in_srgb,var(--accent)_8%,var(--pane)))] p-2.5 shadow-[0_24px_60px_rgba(15,23,42,0.12)] sm:p-3">
      <div className="overflow-hidden rounded-2xl bg-[var(--card)] shadow-[var(--card-shadow)]">
        <div className="flex items-center justify-between px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2.5">
            <Mark small />
            <span className="text-sm font-semibold">{hero.workspace}</span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--brand)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
            {hero.live}
          </span>
        </div>

        <div className="grid gap-3 bg-[var(--pane)] p-3 sm:grid-cols-[0.92fr_1.08fr] sm:p-4">
          <div className="space-y-3">
            <div className="rounded-xl bg-[var(--card)] p-4 shadow-[var(--card-shadow)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-medium text-[var(--muted-strong)]">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent)_12%,var(--card))] text-[var(--accent)]">
                    <PhoneIcon />
                  </span>
                  {hero.incoming}
                </span>
                <span className="text-[11px] font-medium text-[var(--brand)]">{hero.answered}</span>
              </div>
              <p className="mt-5 text-base font-semibold">{hero.caller}</p>
              <p className="mt-1 text-sm leading-snug text-[var(--muted-strong)]">{hero.request}</p>
              <p className="mt-4 rounded-lg bg-[var(--muted-bg)] p-3 text-xs leading-relaxed text-[var(--muted)]">
                {hero.callNote}
              </p>
            </div>

            <div className="rounded-xl bg-[var(--card)] p-4 shadow-[var(--card-shadow)]">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                <PersonIcon />
              </span>
              <p className="mt-3 text-sm font-semibold">{hero.customer}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{hero.customerDetail}</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl bg-[var(--card)] p-4 shadow-[var(--card-shadow)]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">{hero.calendar}</span>
                <CalendarIcon />
              </div>
              <div className="mt-4 space-y-2.5">
                {hero.calendarEntries.map((entry, index) => (
                  <div
                    key={`${entry.time}-${entry.name}`}
                    className={`grid grid-cols-[2.75rem_1fr] items-center gap-2 rounded-lg px-2.5 py-2 text-xs ${
                      index === hero.calendarEntries.length - 1
                        ? "bg-[var(--brand-soft)] text-[var(--foreground)]"
                        : "bg-[var(--muted-bg)] text-[var(--muted-strong)]"
                    }`}
                  >
                    <span className="text-[var(--muted)]">{entry.time}</span>
                    <span className="font-medium">{entry.name}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--accent)_8%,var(--card))] p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-[var(--accent)]">
                  <CheckIcon />
                  {hero.booked}
                </div>
                <p className="mt-2 text-sm font-semibold">{hero.appointment}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{hero.service}</p>
              </div>
            </div>

            <div className="rounded-xl bg-[var(--card)] p-4 shadow-[var(--card-shadow)]">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--brand)]">
                <MessageIcon />
                {hero.confirmation}
              </div>
              <p className="mt-2 text-sm font-semibold">{hero.confirmed}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-[var(--muted)] sm:px-5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          {hero.incoming}
          <span aria-hidden>→</span>
          {hero.booked}
          <span aria-hidden>→</span>
          {hero.confirmed}
        </div>
      </div>
    </div>
  );
}

function ProductPreview({ copy }: { copy: LandingCopy }) {
  const preview = copy.productPreview;
  return (
    <div className="overflow-hidden rounded-[1.75rem] bg-[color-mix(in_srgb,var(--accent)_10%,var(--pane))] p-3 shadow-[0_20px_55px_rgba(15,23,42,0.10)] sm:p-4">
      <div className="overflow-hidden rounded-2xl bg-[color-mix(in_srgb,var(--accent)_5%,var(--card))]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div>
            <p className="font-semibold">{preview.title}</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{preview.day}</p>
          </div>
          <div className="flex gap-2 text-xs text-[var(--muted)]">
            <span className="rounded-full bg-[var(--muted-bg)] px-2.5 py-1">{preview.calls}</span>
            <span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[var(--brand)]">
              {preview.customers}
            </span>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1.08fr_0.92fr]">
          <div className="bg-[color-mix(in_srgb,var(--accent)_4%,var(--pane))] p-3 sm:p-4">
            <div className="space-y-2">
              {preview.appointments.map((appointment) => (
                <div
                  key={`${appointment.time}-${appointment.name}`}
                  className="grid grid-cols-[3rem_1fr] items-center gap-3 rounded-xl bg-[var(--card)] p-3 sm:grid-cols-[3.5rem_1fr_auto]"
                >
                  <span className="text-xs font-medium text-[var(--muted)]">{appointment.time}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{appointment.name}</span>
                    <span className="block truncate text-xs text-[var(--muted)]">{appointment.service}</span>
                  </span>
                  <span className="col-start-2 w-fit rounded-full bg-[var(--muted-bg)] px-2 py-1 text-[11px] text-[var(--muted)] sm:col-start-auto">
                    {appointment.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 p-4 sm:p-5">
            <ActivityCard icon={<PhoneIcon />} title={preview.callTitle} body={preview.callSummary} accent="accent" />
            <ActivityCard icon={<PersonIcon />} title={preview.customerTitle} body={preview.customerDetail} accent="brand" />
            <ActivityCard icon={<MessageIcon />} title={preview.reminderTitle} body={preview.reminderDetail} accent="accent" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityCard({
  icon,
  title,
  body,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  accent: "accent" | "brand";
}) {
  return (
    <div className="rounded-xl bg-[var(--muted-bg)] p-4">
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg ${
          accent === "accent"
            ? "bg-[color-mix(in_srgb,var(--accent)_13%,var(--card))] text-[var(--accent)]"
            : "bg-[var(--brand-soft)] text-[var(--brand)]"
        }`}
      >
        {icon}
      </span>
      <p className="mt-4 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{body}</p>
    </div>
  );
}

function Feature({ feature }: { feature: LandingFeature }) {
  return (
    <div className="rounded-2xl bg-[var(--card)] p-6 shadow-[var(--card-shadow)] sm:p-7">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--muted-bg)] text-[var(--foreground)]">
        <FeatureIcon channel={feature.channel} />
      </span>
      <h3 className="mt-8 text-xl font-semibold tracking-tight">{feature.title}</h3>
      <p className="mt-3 max-w-[54ch] leading-relaxed text-[var(--muted)]">{feature.body}</p>
    </div>
  );
}

function FeatureIcon({ channel }: { channel: LandingFeature["channel"] }) {
  if (channel === "call") return <PhoneIcon />;
  if (channel === "message") return <MessageIcon />;
  if (channel === "customer") return <PersonIcon />;
  return <CalendarIcon />;
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

function ArrowIcon() {
  return (
    <svg className="ml-1 inline h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5">
        <path
          fill="#4285F4"
          d="M21.6 12.23c0-.71-.06-1.23-.2-1.78H12v3.41h5.52a4.74 4.74 0 0 1-2.05 3.02v2.2h3.32c1.94-1.79 2.81-4.42 2.81-6.85Z"
        />
        <path
          fill="#34A853"
          d="M12 22c2.7 0 4.98-.89 6.64-2.42l-3.32-2.57c-.89.6-2.04.95-3.32.95-2.61 0-4.82-1.77-5.61-4.14H2.97v2.64A10.02 10.02 0 0 0 12 22Z"
        />
        <path
          fill="#FBBC05"
          d="M6.39 13.82A6.02 6.02 0 0 1 6.08 12c0-.63.11-1.25.3-1.82V7.54H2.98A10 10 0 0 0 2 12c0 1.61.38 3.13.97 4.46l3.42-2.64Z"
        />
        <path
          fill="#EA4335"
          d="M12 6.04c1.48 0 2.8.51 3.85 1.5l2.87-2.88A9.65 9.65 0 0 0 12 2a10.02 10.02 0 0 0-9.03 5.54l3.42 2.64C7.18 7.81 9.39 6.04 12 6.04Z"
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

function CheckIcon() {
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function PhoneIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.62a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.84.29 1.72.5 2.62.62A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20v-.5a7 7 0 0 1 14 0v.5" />
    </svg>
  );
}
