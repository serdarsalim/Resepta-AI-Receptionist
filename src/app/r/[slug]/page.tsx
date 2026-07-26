"use client";

// The public request form. The fourth intake, next to WhatsApp, email and a
// phone call — and the only one a stranger can start.
//
// No auth, no app shell, no sidebar: whoever opens this is not a user of the
// product and never will be. It renders on a phone, in a language they read,
// and asks the fewest questions that still let the salon call them back.

import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { PhoneInput } from "@/components/PhoneField";

export default function RequestFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { t } = useLanguage();
  // ?embed=1 strips the page down to the form itself: no centring, no min
  // height, no card. Inside somebody's website the surrounding page IS the
  // chrome, and a second card floating in a card is the tell that something
  // was pasted in.
  const embedded = useSearchParams().get("embed") === "1";
  const form = useQuery(api.forms.publicForm, { slug });
  const submit = useMutation(api.forms.submit);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [serviceIds, setServiceIds] = useState<Id<"services">[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (form === undefined) {
    return (
      <Shell embedded={embedded}>
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      </Shell>
    );
  }
  // A disabled form and a wrong slug look identical, deliberately — see
  // forms.publicForm.
  if (form === null) {
    return (
      <Shell embedded={embedded}>
        <p className="text-sm text-[var(--muted)]">{t("forms.notFound")}</p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title={form.orgName} embedded={embedded}>
        {/* No "we'll call you within X" — that is a promise the app cannot
            keep on the salon's behalf. */}
        <p className="text-sm">{t("forms.thanks")}</p>
      </Shell>
    );
  }

  return (
    <Shell title={form.orgName} embedded={embedded}>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (sending) return;
          // PhoneInput is uncontrolled — it composes the dial code and the
          // number into one hidden field — so the value is read here, the same
          // contract the appointment sheet uses.
          const phone = String(new FormData(event.currentTarget).get("phone") ?? "");
          if (!phone.trim()) {
            setError("bad-phone");
            return;
          }
          setSending(true);
          setError(null);
          const result = await submit({
            slug,
            name,
            phone,
            ...(email.trim() ? { email } : {}),
            ...(serviceIds.length ? { serviceIds } : {}),
            ...(note.trim() ? { note } : {}),
          });
          setSending(false);
          if (result.ok) setDone(true);
          else setError(result.reason ?? "error");
        }}
      >
        <label className="block text-sm">
          {t("forms.name")}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            className="mt-1"
          />
        </label>
        <div className="text-sm">
          {t("forms.phone")}
          {/* The same component the app uses, so a Turkish number entered here
              is the same E.164 string the salon's staff would have typed. */}
          <PhoneInput required className="mt-1" />
        </div>
        <label className="block text-sm">
          {`${t("forms.email")} (${t("common.optional")})`}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1"
          />
        </label>

        {form.services.length > 0 && (
          <fieldset className="text-sm">
            <legend>{`${t("forms.services")} (${t("common.optional")})`}</legend>
            {/* Checkboxes, not a select: one visit can be a cut AND a beard
                trim, which is the same truth the appointment sheet models. */}
            <div className="mt-1 flex flex-wrap gap-1.5">
              {form.services.map((service) => {
                const picked = serviceIds.includes(service._id);
                return (
                  <button
                    key={service._id}
                    type="button"
                    aria-pressed={picked}
                    onClick={() =>
                      setServiceIds((prev) =>
                        picked
                          ? prev.filter((id) => id !== service._id)
                          : [...prev, service._id],
                      )
                    }
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      picked
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {service.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <label className="block text-sm">
          {`${t("forms.note")} (${t("common.optional")})`}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 resize-none"
          />
        </label>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {error === "bad-phone" ? t("forms.badPhone") : t("forms.failed")}
          </p>
        )}
        <button
          type="submit"
          disabled={sending || !name.trim()}
          className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
        >
          {sending ? t("common.saving") : t("forms.send")}
        </button>
      </form>
    </Shell>
  );
}

// Standalone: one narrow column, centred, nothing else on the page — whoever
// opens the link came from a bio and is holding a phone.
//
// Embedded: no centring, no card, no page height. The host page supplies all
// of that, and the iframe reports its own height upward so the frame can be
// sized to the content instead of guessing and leaving a scrollbar or a gap.
function Shell({
  title,
  embedded,
  children,
}: {
  title?: string;
  embedded?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!embedded) return;
    const el = ref.current;
    if (!el || window.parent === window) return;
    const post = () =>
      // Height only, so the wildcard target origin carries nothing worth
      // protecting — and the host page cannot be made to prove who it is
      // before it is allowed to size its own iframe.
      window.parent.postMessage(
        { type: "randevu:height", height: Math.ceil(el.getBoundingClientRect().height) },
        "*",
      );
    post();
    const observer = new ResizeObserver(post);
    observer.observe(el);
    return () => observer.disconnect();
  }, [embedded]);

  return (
    <main
      ref={ref}
      className={
        embedded
          ? "w-full"
          : "mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10"
      }
    >
      <div className={embedded ? "" : "card-raised p-5"}>
        {title && <h1 className="mb-4 text-lg font-semibold">{title}</h1>}
        {children}
      </div>
    </main>
  );
}
