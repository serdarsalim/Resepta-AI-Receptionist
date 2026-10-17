"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/LanguageProvider";
import { iconButtonClass } from "./Control";

// A quiet copy-to-clipboard glyph beside a value people paste elsewhere (the
// customer's phone, P12 of the Nudge port). The glyph turns into a check for a
// moment so the click visibly took; the word lives on aria-label and title.
// Revealed on hover by the row it sits in when the caller wants that.
export function CopyButton({ value, className = "" }: { value: string; className?: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
      aria-label={copied ? t("common.copied") : t("common.copy")}
      title={copied ? t("common.copied") : t("common.copy")}
      className={`${iconButtonClass("quiet", "xs")} shrink-0 ${className}`}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
    </button>
  );
}
