"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { useLanguage } from "@/lib/LanguageProvider";
import { LANGUAGES } from "@/lib/i18n";

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const { t, language, setLanguage } = useLanguage();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
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

        <form
          className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(false);
            const formData = new FormData(event.currentTarget);
            formData.set("flow", flow);
            try {
              await signIn("password", formData);
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {flow === "signUp" && (
            <>
              <label className="block text-sm">
                {t("auth.businessName")}
                <input name="orgName" required className="mt-1" />
              </label>
              <label className="block text-sm">
                {t("auth.yourName")}
                <input name="name" className="mt-1" />
              </label>
            </>
          )}
          <label className="block text-sm">
            {t("auth.email")}
            <input name="email" type="email" autoComplete="email" required className="mt-1" />
          </label>
          <label className="block text-sm">
            {t("auth.password")}
            <input
              name="password"
              type="password"
              autoComplete={flow === "signUp" ? "new-password" : "current-password"}
              required
              className="mt-1"
            />
          </label>
          {error && <p className="text-sm text-[var(--danger)]">{t("auth.failed")}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {flow === "signIn" ? t("auth.signIn") : t("auth.signUp")}
          </button>
          <button
            type="button"
            className="w-full text-sm text-[var(--muted)] underline"
            onClick={() => {
              setFlow(flow === "signIn" ? "signUp" : "signIn");
              setError(false);
            }}
          >
            {flow === "signIn" ? t("auth.noAccount") : t("auth.haveAccount")}
          </button>
        </form>
      </div>
    </div>
  );
}
