"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";

export function CustomersView() {
  const { t } = useLanguage();
  const customers = useQuery(api.customers.list, {});
  const create = useMutation(api.customers.create);
  const update = useMutation(api.customers.update);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">{t("customers.title")}</h2>
        <button
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)]"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? t("common.cancel") : t("customers.new")}
        </button>
      </div>

      {adding && (
        <form
          className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setError(null);
            try {
              await create({
                firstName: String(form.get("firstName") ?? ""),
                lastName: String(form.get("lastName") ?? "") || undefined,
                phone: String(form.get("phone") ?? ""),
                consent: form.get("consent") === "on",
              });
              setAdding(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "error");
            }
          }}
        >
          <label className="text-sm">
            {t("customers.firstName")}
            <input name="firstName" required className="mt-1" />
          </label>
          <label className="text-sm">
            {t("customers.lastName")}
            <input name="lastName" className="mt-1" />
          </label>
          <label className="text-sm">
            {t("customers.phone")}
            <input name="phone" required placeholder="+905321234567" className="mt-1" />
          </label>
          <label className="flex items-start gap-2 text-sm sm:col-span-3">
            <input name="consent" type="checkbox" defaultChecked className="mt-1 w-auto" />
            <span>
              {t("customers.consent")}
              <span className="block text-xs text-[var(--muted)]">
                {t("customers.consentHint")}
              </span>
            </span>
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-3">{error}</p>}
          <div className="sm:col-span-3">
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
            >
              {t("common.add")}
            </button>
          </div>
        </form>
      )}

      {customers === undefined && (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      )}
      {customers?.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{t("customers.none")}</p>
      )}

      {customers && customers.length > 0 && (
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
          {customers.map((customer) => (
            <li key={customer._id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {`${customer.firstName} ${customer.lastName ?? ""}`.trim()}
                </span>
                <span className="block text-xs text-[var(--muted)]">{customer.phone}</span>
              </span>
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input
                  type="checkbox"
                  className="w-auto"
                  checked={customer.consentAt !== undefined}
                  onChange={(e) =>
                    void update({ customerId: customer._id, consent: e.target.checked })
                  }
                />
                {t("customers.consent")}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
