"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { LANGUAGES, isLanguage, type TranslationKey } from "@/lib/i18n";

// Google OAuth carries no business name, so a fresh org arrives unnamed —
// this one-question gate runs before anything else and is the whole
// onboarding.
function OnboardingGate() {
  const { t } = useLanguage();
  const update = useMutation(api.orgs.update);
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">{t("onboarding.title")}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{t("onboarding.prompt")}</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
          if (name) void update({ name });
        }}
      >
        <label className="block text-sm">
          {t("onboarding.businessName")}
          <input name="name" required autoFocus className="mt-1" />
        </label>
        <button
          type="submit"
          className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white"
        >
          {t("onboarding.start")}
        </button>
      </form>
    </div>
  );
}

export type TabId = "appointments" | "customers" | "messages" | "settings";

const TABS: { id: TabId; key: TranslationKey }[] = [
  { id: "appointments", key: "nav.appointments" },
  { id: "customers", key: "nav.customers" },
  { id: "messages", key: "nav.messages" },
  { id: "settings", key: "nav.settings" },
];

export function AppShell({
  tab,
  onTab,
  children,
}: {
  tab: TabId;
  onTab: (tab: TabId) => void;
  children: React.ReactNode;
}) {
  const { signOut } = useAuthActions();
  const { t, language, setLanguage } = useLanguage();
  const settings = useQuery(api.orgs.current, {});

  // The org's language is the app's language — one setting, not two. A manual
  // pick on the sign-in screen only governs until an org is known.
  const orgLanguage = settings?.org.language;
  useEffect(() => {
    if (isLanguage(orgLanguage) && orgLanguage !== language) setLanguage(orgLanguage);
  }, [orgLanguage, language, setLanguage]);

  if (settings && settings.org.name === "") return <OnboardingGate />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{settings?.org.name || t("app.name")}</h1>
          <p className="text-xs text-[var(--muted)]">{t("app.tagline")}</p>
        </div>
        <div className="flex items-center gap-2">
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
          <button
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
            onClick={() => void signOut()}
          >
            {t("nav.signOut")}
          </button>
        </div>
      </header>

      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--border)]">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => onTab(entry.id)}
            className={`whitespace-nowrap px-3 py-2 text-sm ${
              tab === entry.id
                ? "border-b-2 border-[var(--accent)] font-medium text-[var(--accent)]"
                : "text-[var(--muted)]"
            }`}
          >
            {t(entry.key)}
          </button>
        ))}
      </nav>

      <main className="flex-1">{children}</main>
    </div>
  );
}
