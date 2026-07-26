"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { LANGUAGES, isLanguage } from "@/lib/i18n";

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const { t, language, setLanguage } = useLanguage();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  // False on any deployment without a demo org configured, which is most of
  // them — see convex/demo.ts.
  const walkIn = useQuery(api.demo.walkInEnabled, {});

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t("app.name")}</h1>
            <p className="text-sm text-[var(--muted)]">{t("app.tagline")}</p>
          </div>
          <select
            aria-label={t("settings.language")}
            className="w-auto text-sm"
            value={language}
            // Narrow through the type guard rather than casting: the option
            // list and the Language union come from the same LANGUAGES array,
            // and a cast would quietly survive them drifting apart.
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
      </div>
    </div>
  );
}
