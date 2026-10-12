"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/LanguageProvider";
import { CONTACT_TOKEN, LEGAL_UI, PRIVACY, TERMS } from "@/lib/legal";

const LINK =
  "text-[var(--accent)] transition-opacity duration-[120ms] hover:opacity-80";

// One renderer for both legal documents. They have identical shape and differ
// only in content, so a second component would be a copy waiting to drift.
//
// Follows the app's language rather than the URL: LanguageProvider has already
// resolved a language from storage or the browser by the time this renders, so a
// Turkish visitor gets Turkish without a picker and without /tr/ routes to
// maintain. Google and Meta reviewers read whatever their browser reports,
// which is the behaviour we want for a policy page.
//
// `contactEmail` is the operator's setting, read per request by the page
// (src/lib/legalContact.ts). A sentence in the documents may name it as
// {contact}: with an address it becomes a mailto link in place, and without one
// the whole sentence's paragraph is left out. Every such sentence asks the
// reader to write to us, and a page must never ask for mail it gives no
// address for.
export function LegalDocument({
  kind,
  contactEmail,
}: {
  kind: "privacy" | "terms";
  contactEmail: string | null;
}) {
  const { language } = useLanguage();
  const doc = (kind === "privacy" ? PRIVACY : TERMS)[language];
  const ui = LEGAL_UI[language];
  const otherHref = kind === "privacy" ? "/terms" : "/privacy";
  const otherLabel = kind === "privacy" ? ui.terms : ui.privacy;
  const shown = (texts: string[] | undefined) =>
    (texts ?? []).filter((text) => contactEmail || !text.includes(CONTACT_TOKEN));

  return (
    <div className="min-h-dvh px-6 py-12">
      <article className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-semibold">{doc.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {ui.updated}: {doc.updated}
        </p>

        {shown(doc.intro).map((paragraph) => (
          <p key={paragraph} className="mt-4 leading-relaxed">
            <LegalText text={paragraph} contactEmail={contactEmail} />
          </p>
        ))}

        {doc.sections.map((section) => {
          const body = shown(section.body);
          const bullets = shown(section.bullets);
          // A section whose every line needed the address says nothing
          // without it, so its heading goes too.
          if (body.length === 0 && bullets.length === 0) return null;
          return (
            <section key={section.heading} className="mt-8">
              <h2 className="text-lg font-semibold">{section.heading}</h2>
              {body.map((paragraph) => (
                <p key={paragraph} className="mt-3 leading-relaxed">
                  <LegalText text={paragraph} contactEmail={contactEmail} />
                </p>
              ))}
              {bullets.length > 0 && (
                <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed">
                  {bullets.map((bullet) => (
                    <li key={bullet}>
                      <LegalText text={bullet} contactEmail={contactEmail} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {/* Omitted rather than rendered empty when no address is configured, so
            the page never shows a mailto that goes nowhere. */}
        {contactEmail && (
          <p className="mt-8 leading-relaxed">
            {ui.contact}{" "}
            <a href={`mailto:${contactEmail}`} className={LINK}>
              {contactEmail}
            </a>
          </p>
        )}

        <nav className="mt-12 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href={otherHref} className={LINK}>
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

// One paragraph, with {contact} made a link. Only ever handed a contact-bearing
// text when an address exists (the `shown` filter above), so the fallback
// branch is plain text.
function LegalText({
  text,
  contactEmail,
}: {
  text: string;
  contactEmail: string | null;
}) {
  if (!contactEmail || !text.includes(CONTACT_TOKEN)) return <>{text}</>;
  const parts = text.split(CONTACT_TOKEN);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <a href={`mailto:${contactEmail}`} className={LINK}>
              {contactEmail}
            </a>
          )}
        </Fragment>
      ))}
    </>
  );
}
