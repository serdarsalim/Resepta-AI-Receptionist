"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/LanguageProvider";
import { LEGAL_CONTACT_EMAIL, LEGAL_UI, PRIVACY, TERMS } from "@/lib/legal";

// One renderer for both legal documents. They have identical shape and differ
// only in content, so a second component would be a copy waiting to drift.
//
// Follows the app's language rather than the URL: LanguageProvider has already
// resolved a language from storage or the browser by the time this renders, so a
// Turkish visitor gets Turkish without a picker and without /tr/ routes to
// maintain. Google and Meta reviewers read whatever their browser reports,
// which is the behaviour we want for a policy page.
export function LegalDocument({ kind }: { kind: "privacy" | "terms" }) {
  const { language } = useLanguage();
  const doc = (kind === "privacy" ? PRIVACY : TERMS)[language];
  const ui = LEGAL_UI[language];
  const otherHref = kind === "privacy" ? "/terms" : "/privacy";
  const otherLabel = kind === "privacy" ? ui.terms : ui.privacy;

  return (
    <div className="min-h-dvh px-6 py-12">
      <article className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-semibold">{doc.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {ui.updated}: {doc.updated}
        </p>

        {doc.intro.map((paragraph) => (
          <p key={paragraph} className="mt-4 leading-relaxed">
            {paragraph}
          </p>
        ))}

        {doc.sections.map((section) => (
          <section key={section.heading} className="mt-8">
            <h2 className="text-lg font-semibold">{section.heading}</h2>
            {section.body?.map((paragraph) => (
              <p key={paragraph} className="mt-3 leading-relaxed">
                {paragraph}
              </p>
            ))}
            {section.bullets && (
              <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed">
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {/* Omitted rather than rendered empty when no address is configured, so
            the page never shows a mailto that goes nowhere. See legal.ts. */}
        {LEGAL_CONTACT_EMAIL && (
          <p className="mt-8 leading-relaxed">
            {ui.contact}{" "}
            <a
              href={`mailto:${LEGAL_CONTACT_EMAIL}`}
              className="text-[var(--accent)] transition-opacity duration-[120ms] hover:opacity-80"
            >
              {LEGAL_CONTACT_EMAIL}
            </a>
          </p>
        )}

        <nav className="mt-12 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link
            href={otherHref}
            className="text-[var(--accent)] transition-opacity duration-[120ms] hover:opacity-80"
          >
            {otherLabel}
          </Link>
          <Link
            href="/signin"
            className="text-[var(--muted)] transition-colors duration-[120ms] hover:text-[var(--foreground)]"
          >
            {ui.back}
          </Link>
        </nav>
      </article>
    </div>
  );
}
