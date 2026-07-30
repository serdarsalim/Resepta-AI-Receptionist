"use client";

import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { LANGUAGES, isLanguage } from "@/lib/i18n";
import { LANDING, type Channel, type LandingCopy } from "@/lib/landing";

// The public face of the product, shown at / to anyone not signed in.
//
// Structure ported from the Nudge landing page (autonudge/landing/index.html):
// sticky glass nav, two-column hero carrying a product card rather than a stock
// photo, channel-coloured markers, one tinted band between plain sections.
// Palette is randevu's own, not Nudge's: --brand is the emerald in the app's
// logo, --accent is the blue the app already uses for actions. Same craft, own
// brand.
//
// The hero card is what does the selling. A salon owner reads one booking going
// out, being confirmed with a tap, and a reminder queued behind it, and has the
// product without reading a word of the feature list.
//
// The language picker lives HERE rather than on /signin. On the sign-in card it
// was noise, because by then the visitor has decided and LanguageProvider had
// already read navigator.language. On a marketing page it earns its place, and
// it is the only way a signed-out visitor can correct a wrong guess: Settings
// sits behind a login they have not done yet.
export function Landing() {
  const { signIn } = useAuthActions();
  const { t, language, setLanguage } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const copy = LANDING[language];
  // Same gate as the sign-in card: the demo button appears only where a demo
  // org is actually configured, so it can never be a door that errors on click.
  const walkIn = useQuery(api.demo.walkInEnabled, {});

  const start = async (provider: "google" | "anonymous") => {
    setBusy(true);
    setError(false);
    try {
      await signIn(provider);
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <nav className="sticky top-3 z-50 mx-auto w-[min(100%-1.5rem,68rem)] rounded-2xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_72%,transparent)] backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between px-5">
          <span className="flex items-center gap-2.5">
            <Mark />
            <span className="text-xl font-bold tracking-tight">Randevu</span>
          </span>
          <div className="flex items-center gap-3">
            <select
              aria-label="Language"
              className="w-auto text-sm"
              value={language}
              // Narrowed through the type guard rather than cast: the option
              // list and the Language union come from the same LANGUAGES
              // array, and a cast would survive them drifting apart.
              onChange={(e) => {
                if (isLanguage(e.target.value)) setLanguage(e.target.value);
              }}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <button
              disabled={busy}
              onClick={() => start("google")}
              className="hidden rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent-fg)] transition-opacity duration-[120ms] hover:opacity-90 disabled:opacity-60 sm:block"
            >
              {copy.navCta}
            </button>
          </div>
        </div>
      </nav>

      <main>
        <section className="mx-auto max-w-[68rem] px-6 pb-16 pt-16 sm:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
            <div>
              <h1 className="text-[clamp(2.1rem,4.6vw,3.25rem)] font-bold leading-[1.07] tracking-[-0.03em]">
                {copy.headlineLead}
                <span className="text-[var(--brand)]">{copy.headlineAccent}</span>
              </h1>
              <p className="mt-5 max-w-[50ch] text-lg leading-relaxed text-[var(--muted)]">
                {copy.subhead}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  disabled={busy}
                  onClick={() => start("google")}
                  className="rounded-lg bg-[var(--accent)] px-6 py-3.5 text-base font-semibold text-[var(--accent-fg)] transition-opacity duration-[120ms] hover:opacity-90 disabled:opacity-60"
                >
                  {copy.ctaPrimary}
                </button>
                {walkIn && (
                  <button
                    disabled={busy}
                    onClick={() => start("anonymous")}
                    className="rounded-lg px-6 py-3.5 text-base text-[var(--muted)] transition-colors duration-[120ms] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] disabled:opacity-60"
                  >
                    {copy.ctaDemo}
                  </button>
                )}
              </div>
              <p className="mt-4 text-sm text-[var(--muted)]">{copy.ctaNote}</p>
              {error && (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400">
                  {t("auth.failed")}
                </p>
              )}
            </div>

            <HeroCard copy={copy} />
          </div>
        </section>

        <section className="border-y border-[var(--border)] bg-[var(--muted-bg)]">
          <div className="mx-auto max-w-[68rem] px-6 py-16 sm:py-20">
            <h2 className="text-sm font-medium text-[var(--muted)]">
              {copy.featuresTitle}
            </h2>
            <div className="mt-10 grid gap-x-12 gap-y-10 sm:grid-cols-2">
              {copy.features.map((f) => (
                <div key={f.title} className="flex gap-4">
                  <ChannelDot channel={f.channel} />
                  <div>
                    <h3 className="text-lg font-semibold leading-snug">{f.title}</h3>
                    <p className="mt-2 leading-relaxed text-[var(--muted)]">
                      {f.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[68rem] px-6 py-16 sm:py-20">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {copy.closingTitle}
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-[var(--muted)]">
            {copy.closingBody}
          </p>
          <button
            disabled={busy}
            onClick={() => start("google")}
            className="mt-7 rounded-lg bg-[var(--accent)] px-6 py-3.5 text-base font-semibold text-[var(--accent-fg)] transition-opacity duration-[120ms] hover:opacity-90 disabled:opacity-60"
          >
            {copy.ctaPrimary}
          </button>
        </section>
      </main>

      <footer className="border-t border-[var(--border)]">
        <nav className="mx-auto flex max-w-[68rem] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-sm text-[var(--muted)]">
          <span>Randevu</span>
          <Link
            href="/privacy"
            className="transition-colors duration-[120ms] hover:text-[var(--foreground)]"
          >
            {copy.privacy}
          </Link>
          <Link
            href="/terms"
            className="transition-colors duration-[120ms] hover:text-[var(--foreground)]"
          >
            {copy.terms}
          </Link>
        </nav>
      </footer>
    </div>
  );
}

// The app's logo tile, rebuilt here rather than imported from AppShell. AppShell
// is loaded only for signed-in users, and importing it would drag the app's
// module graph back into this route. See src/app/page.tsx for why that matters.
function Mark() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--logo)]">
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
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

const CHANNEL_COLOR: Record<Channel, string> = {
  whatsapp: "var(--brand)",
  call: "var(--accent)",
  calendar: "var(--brand)",
};

function ChannelDot({ channel }: { channel: Channel }) {
  return (
    <span
      aria-hidden="true"
      className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: CHANNEL_COLOR[channel] }}
    />
  );
}

// A booking, its confirmation, the customer's tap, and the reminder waiting
// behind it. Static markup on purpose: it is an illustration, and animating it
// would break the rule that nothing moves without being asked to.
function HeroCard({ copy }: { copy: LandingCopy }) {
  const d = copy.demo;
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--border)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--border)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--border)]" />
        <span className="ml-2 text-xs text-[var(--muted)]">{d.label}</span>
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-3">
          <span className="font-semibold">{d.customer}</span>
          <span className="text-xs text-[var(--muted)]">{d.service}</span>
        </div>

        <div className="mt-4 space-y-4">
          <Event color="var(--brand)" what={d.sentMeta} detail={d.sent} bubble="out" />
          <Event color="var(--brand)" what={d.replyMeta} detail={d.reply} bubble="in" />
          <Event color="var(--muted)" what={d.reminderMeta} detail={d.reminder} />
        </div>
      </div>
    </div>
  );
}

function Event({
  color,
  what,
  detail,
  bubble,
}: {
  color: string;
  what: string;
  detail: string;
  bubble?: "in" | "out";
}) {
  return (
    <div className="grid grid-cols-[0.625rem_1fr] gap-3">
      <span
        aria-hidden="true"
        className="mt-1.5 h-2.5 w-2.5 rounded-full"
        style={{ background: color }}
      />
      <div>
        <p className="text-xs text-[var(--muted)]">{what}</p>
        {bubble ? (
          <p
            className={`mt-1.5 inline-block rounded-xl px-3 py-2 text-sm leading-snug ${
              bubble === "in"
                ? "bg-[color-mix(in_srgb,var(--brand)_16%,var(--card))] font-medium"
                : "bg-[var(--muted-bg)]"
            }`}
          >
            {detail}
          </p>
        ) : (
          <p className="mt-1 text-sm leading-snug">{detail}</p>
        )}
      </div>
    </div>
  );
}
