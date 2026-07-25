"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { useLanguage } from "@/lib/LanguageProvider";
import { LANGUAGES } from "@/lib/i18n";

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const { t, language, setLanguage } = useLanguage();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

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
            onChange={(e) => setLanguage(e.target.value as typeof language)}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <button
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white disabled:opacity-60"
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
          {error && <p className="text-sm text-[var(--danger)]">{t("auth.failed")}</p>}
          <p className="text-xs text-[var(--muted)]">{t("auth.googleHint")}</p>
        </div>
      </div>
    </div>
  );
}
