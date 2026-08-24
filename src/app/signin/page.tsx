"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
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
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();

  // Somebody already signed in does not get shown a sign-in card. Two ways to
  // arrive here that way: the anonymous demo sign-in, which sets a session in
  // place without leaving the page, and the server check on `/` reading a
  // cookie it could not verify and bouncing a signed-in person out here.
  // Without this the second case is a trap — the app is one URL away and the
  // screen offers no way to it.
  useEffect(() => {
    if (isAuthenticated) router.replace("/");
  }, [isAuthenticated, router]);

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
