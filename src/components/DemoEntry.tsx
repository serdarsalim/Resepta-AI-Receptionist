"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { LEGAL_UI } from "@/lib/legal";

export function DemoEntry() {
  const { signIn } = useAuthActions();
  const { t, language } = useLanguage();
  const walkIn = useQuery(api.demo.walkInEnabled, {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const enter = async () => {
    setBusy(true);
    setError(false);
    try {
      await signIn("anonymous");
      window.location.assign("/");
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh items-center overflow-hidden bg-[var(--background)] px-6 py-12">
      <div className="pointer-events-none absolute -left-48 top-0 h-96 w-96 rounded-full bg-[color-mix(in_srgb,var(--brand)_14%,transparent)] blur-3xl" />
      <div className="pointer-events-none absolute -right-48 bottom-0 h-96 w-96 rounded-full bg-[color-mix(in_srgb,var(--accent)_13%,transparent)] blur-3xl" />

      <div className="landing-rise relative mx-auto w-full max-w-2xl">
        <div className="flex items-center gap-3">
          <Mark />
          <span className="text-xl font-bold tracking-tight">Mahlas</span>
        </div>

        <p className="mt-14 text-sm font-semibold text-[var(--brand)]">
          {t("demo.entryEyebrow")}
        </p>
        <h1 className="mt-4 max-w-xl text-[clamp(2.6rem,7vw,4.8rem)] font-bold leading-[0.98] tracking-[-0.055em]">
          {t("demo.entryTitle")}
        </h1>
        <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-[var(--muted)] sm:text-xl">
          {t("demo.entryBody")}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            disabled={busy || walkIn !== true}
            onClick={enter}
            className="rounded-lg bg-[var(--accent)] px-6 py-3.5 text-base font-semibold text-[var(--accent-fg)] shadow-[0_10px_24px_color-mix(in_srgb,var(--accent)_24%,transparent)] transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
          >
            {busy ? t("common.loading") : t("demo.entryCta")}
          </button>
          <a
            href="https://docs.mahlas.xyz"
            className="rounded-lg px-5 py-3.5 font-medium transition-colors hover:bg-[var(--muted-bg)]"
          >
            {t("menu.helpCenter")}
          </a>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{t("auth.failed")}</p>
        )}

        <div className="mt-14 grid gap-3 border-t border-[var(--border)] pt-6 text-sm text-[var(--muted)] sm:grid-cols-3">
          <Fact text={t("demo.entryNoSignup")} />
          <Fact text={t("demo.entrySimulated")} />
          <Fact text={t("demo.entryReset")} />
        </div>

        <nav className="mt-8 flex flex-wrap gap-5 text-sm text-[var(--muted)]">
          <Link href="https://mahlas.xyz" className="transition-colors hover:text-[var(--foreground)]">
            {t("demo.entryProduct")}
          </Link>
          <Link href="https://mahlas.xyz/privacy" className="transition-colors hover:text-[var(--foreground)]">
            {LEGAL_UI[language].privacy}
          </Link>
          <Link href="https://mahlas.xyz/terms" className="transition-colors hover:text-[var(--foreground)]">
            {LEGAL_UI[language].terms}
          </Link>
        </nav>
      </div>
    </main>
  );
}

function Fact({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
          <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>{text}</span>
    </div>
  );
}

function Mark() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--logo)]">
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" aria-hidden="true">
        <path d="M4 6l6 6-6 6M13 6l6 6-6 6" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
