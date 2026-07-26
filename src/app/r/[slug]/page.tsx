"use client";

// The public request form. The fourth intake, next to WhatsApp, email and a
// phone call — and the only one a stranger can start.
//
// No auth, no app shell, no sidebar: whoever opens this is not a user of the
// product and never will be. It renders on a phone, in a language they read,
// and asks the fewest questions that still let the salon call them back.

import { useMutation, useQuery } from "convex/react";
import { use, useState } from "react";
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
    return <Shell><p className="text-sm text-[var(--muted)]">{t("common.loading")}</p></Shell>;
  }
  // A disabled form and a wrong slug look identical, deliberately — see
  // forms.publicForm.
  if (form === null) {
    return <Shell><p className="text-sm text-[var(--muted)]">{t("forms.notFound")}</p></Shell>;
  }

  if (done) {
    return (
      <Shell title={form.orgName}>
        {/* No "we'll call you within X" — that is a promise the app cannot
            keep on the salon's behalf. */}
        <p className="text-sm">{t("forms.thanks")}</p>
      </Shell>
    );
  }

  return (
    <Shell title={form.orgName}>
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

// One narrow column, centred, nothing else on the page. Whoever opens this
// came from a link in a bio and is holding a phone.
function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="card-raised p-5">
        {title && <h1 className="mb-4 text-lg font-semibold">{title}</h1>}
        {children}
      </div>
    </main>
  );
}
