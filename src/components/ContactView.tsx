"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/datetime";
import { Toggle } from "./Toggle";
import { ConversationPanel } from "./ConversationPanel";
import { FieldGroup, FieldRow, InlineEditValue } from "./RecordField";

const STATUS_KEY: Record<string, TranslationKey> = {
  scheduled: "status.scheduled",
  confirmed: "status.confirmed",
  cancelled: "status.cancelled",
  completed: "status.completed",
  no_show: "status.no_show",
};

// Contact profile, Nudge's ContactView pattern: properties on the left,
// the conversation on the right.
export function ContactView({
  customerId,
  onClose,
}: {
  customerId: Id<"customers">;
  onClose: () => void;
}) {
  const { t, language } = useLanguage();
  const customer = useQuery(api.customers.get, { customerId });
  const fields = useQuery(api.contactFields.list, {});
  const appointments = useQuery(api.appointments.listForCustomer, { customerId });
  const updateCustomer = useMutation(api.customers.update);
  const setCustomValue = useMutation(api.customers.setCustomValue);

  if (customer === null) {
    return <p className="text-sm text-[var(--muted)]">{t("customers.none")}</p>;
  }
  if (!customer) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={onClose}
          className="rounded-md px-2.5 py-1 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
        >
          ←
        </button>
        <h2 className="min-w-0 truncate text-base font-semibold">
          {`${customer.firstName} ${customer.lastName ?? ""}`.trim()}
        </h2>
        <span className="text-sm text-[var(--muted)]">{customer.phone}</span>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[24rem_1fr]">
        {/* Left: properties */}
        <div className="thin-scroll stable-gutter min-h-0 space-y-4 overflow-y-auto pr-1">
          {/* One record, not two forms: the built-in fields and the org's own
              fields read the same way and sit in the same card. Adding a field
              in Workspace setup adds a row here, no code. */}
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="space-y-1.5">
              <FieldRow label={t("customers.firstName")}>
                <InlineEditValue
                  value={customer.firstName}
                  onSave={(next) => updateCustomer({ customerId, firstName: next })}
                />
              </FieldRow>
              <FieldRow label={t("customers.lastName")}>
                <InlineEditValue
                  value={customer.lastName ?? ""}
                  onSave={(next) => updateCustomer({ customerId, lastName: next })}
                />
              </FieldRow>
              <FieldRow label={t("customers.phone")}>
                <InlineEditValue
                  value={customer.phone}
                  type="tel"
                  onSave={(next) => updateCustomer({ customerId, phone: next })}
                />
              </FieldRow>
              <FieldRow label={t("customers.email")}>
                <InlineEditValue
                  value={customer.email ?? ""}
                  type="email"
                  onSave={(next) => updateCustomer({ customerId, email: next })}
                />
              </FieldRow>
              <FieldRow label={t("customers.consent")} hint={t("customers.consentHint")}>
                <span className="flex h-7 items-center">
                  <Toggle
                    checked={customer.consentAt !== undefined}
                    onChange={(next) => void updateCustomer({ customerId, consent: next })}
                  />
                </span>
              </FieldRow>

              {(fields ?? []).length > 0 && <FieldGroup label={t("fields.title")} />}
              {(fields ?? []).map((field) => (
                <FieldRow key={field._id} label={field.label}>
                  <InlineEditValue
                    value={customer.custom?.[field.key] ?? ""}
                    options={field.type === "select" ? (field.options ?? []) : null}
                    type={
                      field.type === "number"
                        ? "number"
                        : field.type === "date"
                          ? "date"
                          : "text"
                    }
                    onSave={(next) =>
                      setCustomValue({ customerId, key: field.key, value: next })
                    }
                  />
                </FieldRow>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="mb-2 text-sm font-semibold">{t("appointments.title")}</h3>
            {appointments === undefined && (
              <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
            )}
            {appointments?.length === 0 && (
              <p className="text-sm text-[var(--muted)]">{t("appointments.none")}</p>
            )}
            <ul className="divide-y divide-[var(--border)]">
              {(appointments ?? []).map((appointment) => (
                <li key={appointment._id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {formatDateTime(appointment.startAt, language)}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {[appointment.serviceName, appointment.staffName]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {t(STATUS_KEY[appointment.status])}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Right: conversation — shared component, never a page variant */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <ConversationPanel
            customerId={customerId}
            lastInboundAt={customer.lastInboundAt}
            className="flex-1"
          />
        </div>
      </div>
    </div>
  );
}
