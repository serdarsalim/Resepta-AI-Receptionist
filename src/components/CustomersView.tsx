"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { PhoneInput } from "./PhoneField";

export function CustomersView({
  onOpenContact,
}: {
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t } = useLanguage();
  const customers = useQuery(api.customers.list, {});
  const create = useMutation(api.customers.create);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
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
                email: String(form.get("email") ?? "") || undefined,
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
          <label className="text-sm" htmlFor="new-customer-phone">
            {t("customers.phone")}
            <PhoneInput id="new-customer-phone" name="phone" required className="mt-1" />
          </label>
          <label className="text-sm">
            {t("customers.email")}
            <input name="email" type="email" className="mt-1" />
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
            <li
              key={customer._id}
              className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--row-hover-bg)]"
              onClick={() => onOpenContact(customer._id)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {`${customer.firstName} ${customer.lastName ?? ""}`.trim()}
                </span>
                <span className="block text-xs text-[var(--muted)]">{customer.phone}</span>
              </span>
              {customer.consentAt === undefined && (
                <span className="rounded-full px-2 py-0.5 text-xs text-red-600 dark:text-red-400">
                  {t("customers.noConsent")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
