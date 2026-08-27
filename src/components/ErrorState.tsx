"use client";

import { useLanguage } from "@/lib/LanguageProvider";

// What a caught render error looks like. One component, because the boundary
// inside the app (ErrorBoundary) and the one outside it (app/error.tsx) differ
// in how much of the page they replace, not in what they have to say.
//
// No sentence under the title: the two buttons already say what to do, and a
// paragraph restating them is the helper text that belongs behind an (i), or
// nowhere.
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-sm font-medium">{t("common.errorTitle")}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:opacity-90"
        >
          {t("common.retry")}
        </button>
        {/* The escape hatch when retrying lands on the same error: a reload
            drops every id this browser is holding in React state, which is
            what was wrong in the first place often enough to offer. */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
        >
          {t("common.reload")}
        </button>
      </div>
    </div>
  );
}
