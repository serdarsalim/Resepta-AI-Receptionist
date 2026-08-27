"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ErrorState";

// The route's net, under the pane boundary inside the app
// (components/ErrorBoundary). This one catches what that one cannot: the shell
// around the views, and every route that is not the app.
//
// Without this file Next renders its own screen, which is a browser-coloured
// page with none of the product in it and no language but English. It is also
// a dead end: its Reload button repeats whatever failed.
//
// Not a global-error.tsx. That one replaces the root layout, which means
// replacing LanguageProvider too, and an error screen that can only speak
// English is worse than the narrower boundary. The root layout is providers
// and a font.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page failed to render:", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--pane)] p-6">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
        <ErrorState onRetry={reset} />
      </div>
    </div>
  );
}
