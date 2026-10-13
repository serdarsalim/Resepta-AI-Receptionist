"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { LEGAL_UI } from "@/lib/legal";

// The sign-in card: the one decision, rendered by /signin (src/app/signin).
// It used to float as a dialog over the landing page too (Serdar,
// 2026-08-21). The landing moved to the marketing site's own repo on
// 2026-08-24 and its leftover component here was deleted on 2026-10-13 with
// the dialog only it opened, so /signin is the one place sign-in starts.
//
// The Google button wears Google's own G, on a plain bordered button rather
// than an anonymous blue block: the badge is the thing a visitor recognises,
// and it is also what Google's consent-screen review expects the entry point
// to look like. The privacy/terms links live INSIDE the card for the same
// review: they must be present wherever the OAuth flow starts.

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

// The card's inside: the one decision, the demo side door when it exists,
// and the legal links the OAuth review requires at the flow's entry point.
export function SignInCard() {
  const { signIn } = useAuthActions();
  const { t, language } = useLanguage();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  // False on any deployment without a demo org configured — convex/demo.ts.
  const walkIn = useQuery(api.demo.walkInEnabled, {});

  return (
    <div className="space-y-3">
      <button
        disabled={busy}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 font-medium transition-colors hover:bg-[var(--muted-bg)] disabled:opacity-60"
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
        <GoogleG />
        {t("auth.continueWithGoogle")}
      </button>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {t("auth.failed")}
        </p>
      )}
      <p className="text-center text-xs text-[var(--muted)]">
        {t("auth.googleHint")}
      </p>

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

      <nav className="flex justify-center gap-x-5 pt-1 text-xs text-[var(--muted)]">
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
  );
}
