"use client";

import { useLanguage } from "@/lib/LanguageProvider";
import { BrandMark } from "@/components/BrandMark";
import { SignInCard } from "@/components/SignInDialog";

// Sign-in normally happens in the dialog the landing's CTAs open
// (SignInDialog.tsx) — this route is the standalone fallback: a middle-click,
// a shared link, an auth redirect. Same card, wearing the brand instead of a
// backdrop.
//
// No language picker here. LanguageProvider already resolves the language
// from localStorage, then navigator.language, so a Turkish browser lands on
// Turkish without being asked.
export default function SignInPage() {
  const { t } = useLanguage();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--pane)] p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark />
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            {t("app.name")}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("app.tagline")}</p>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
          <SignInCard />
        </div>
      </div>
    </div>
  );
}
