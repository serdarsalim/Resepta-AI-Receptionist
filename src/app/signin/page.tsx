"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { LEGAL_UI } from "@/lib/legal";

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const { t, language } = useLanguage();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  // False on any deployment without a demo org configured, which is most of
  // them — see convex/demo.ts.
  const walkIn = useQuery(api.demo.walkInEnabled, {});

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* No language picker here. LanguageProvider already resolves the
            language from localStorage, then navigator.language, so a Turkish
            browser lands on Turkish without being asked. The control belongs in
            Settings, where a choice is what the page is for. */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">{t("app.name")}</h1>
          <p className="text-sm text-[var(--muted)]">{t("app.tagline")}</p>
        </div>

        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <button
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-[var(--accent-fg)] disabled:opacity-60"
            onClick={async () => {
              setBusy(true);
              setError(false);
              try {
                await signIn("google");
              } catch {
                setError(true);
                setBusy(false);
              }
            }}
          >
            {t("auth.continueWithGoogle")}
          </button>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{t("auth.failed")}</p>}
          <p className="text-xs text-[var(--muted)]">{t("auth.googleHint")}</p>

          {/* Shown only when a demo org is actually configured, so the button
              can never be a door that errors on click. Secondary to Google by
              design: the person who came here to sign in should not have to
              read past an invitation to look at somebody else's salon. */}
          {walkIn && (
            <div className="border-t border-[var(--border)] pt-3">
              <button
                disabled={busy}
                className="w-full rounded-lg px-4 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] disabled:opacity-60"
                onClick={async () => {
                  setBusy(true);
                  setError(false);
                  try {
                    await signIn("anonymous");
                  } catch {
                    setError(true);
                    setBusy(false);
                  }
                }}
              >
                {t("auth.tryDemo")}
              </button>
              <p className="pt-1 text-center text-xs text-[var(--muted)]">
                {t("auth.tryDemoHint")}
              </p>
            </div>
          )}
        </div>

        {/* Google's consent screen review looks for these two links on the page
            that starts the OAuth flow, and Meta's app review does the same. */}
        <nav className="mt-4 flex justify-center gap-x-5 text-xs text-[var(--muted)]">
          <Link
            href="/privacy"
            className="transition-colors duration-[120ms] hover:text-[var(--foreground)]"
          >
            {LEGAL_UI[language].privacy}
          </Link>
          <Link
            href="/terms"
            className="transition-colors duration-[120ms] hover:text-[var(--foreground)]"
          >
            {LEGAL_UI[language].terms}
          </Link>
        </nav>
      </div>
    </div>
  );
}
