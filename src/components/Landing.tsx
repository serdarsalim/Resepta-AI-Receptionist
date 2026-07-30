"use client";

import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { LANGUAGES, isLanguage } from "@/lib/i18n";
import { LANDING } from "@/lib/landing";

// The public face of the product, shown at / to anyone not signed in.
//
// The language picker lives HERE rather than on /signin, which is where it used
// to be. On the sign-in card it was noise: by then the visitor has decided, and
// LanguageProvider had already picked their language off navigator.language
// anyway. On a marketing page it earns its place, because this is the one
// surface a stranger reads before deciding anything, and it is also the only
// place a signed-out visitor can correct a wrong guess. Settings is behind a
// login they have not done yet.
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
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold">Randevu</span>
        <select
          aria-label="Language"
          className="w-auto text-sm"
          value={language}
          // Narrowed through the type guard rather than cast: the option list
          // and the Language union come from the same LANGUAGES array, and a
          // cast would quietly survive them drifting apart.
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
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="py-16 sm:py-24">
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
            {copy.headline}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">
            {copy.subhead}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              disabled={busy}
              onClick={() => start("google")}
              className="rounded-lg bg-[var(--accent)] px-6 py-3 text-base font-medium text-[var(--accent-fg)] transition-opacity duration-[120ms] hover:opacity-90 disabled:opacity-60"
            >
              {copy.ctaPrimary}
            </button>
            {walkIn && (
              <button
                disabled={busy}
                onClick={() => start("anonymous")}
                className="rounded-lg px-6 py-3 text-base text-[var(--muted)] transition-colors duration-[120ms] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] disabled:opacity-60"
              >
                {copy.ctaDemo}
              </button>
            )}
          </div>
          {walkIn && (
            <p className="mt-3 text-sm text-[var(--muted)]">{copy.ctaDemoHint}</p>
          )}
          {error && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">
              {t("auth.failed")}
            </p>
          )}
        </section>

        <section className="border-t border-[var(--border)] py-16">
          <h2 className="text-sm font-medium text-[var(--muted)]">
            {copy.featuresTitle}
          </h2>
          <div className="mt-8 grid gap-x-10 gap-y-10 sm:grid-cols-2">
            {copy.features.map((f) => (
              <div key={f.title}>
                <h3 className="text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 leading-relaxed text-[var(--muted)]">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-[var(--border)] py-16">
          <h2 className="text-2xl font-semibold">{copy.closingTitle}</h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-[var(--muted)]">
            {copy.closingBody}
          </p>
          <button
            disabled={busy}
            onClick={() => start("google")}
            className="mt-6 rounded-lg bg-[var(--accent)] px-6 py-3 text-base font-medium text-[var(--accent-fg)] transition-opacity duration-[120ms] hover:opacity-90 disabled:opacity-60"
          >
            {copy.ctaPrimary}
          </button>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl border-t border-[var(--border)] px-6 py-8">
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--muted)]">
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
