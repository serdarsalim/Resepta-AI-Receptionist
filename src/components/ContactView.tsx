"use client";

import { useState } from "react";
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
  // Below lg the two panes swap instead of sharing the row (InboxView does the
  // same). The record opens first: you came here to read the customer, not to
  // land mid-thread.
  const [mobilePane, setMobilePane] = useState<"record" | "conversation">("record");

  if (customer === null) {
    return <p className="text-sm text-[var(--muted)]">{t("customers.none")}</p>;
  }
  if (!customer) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* One header row, never two: back, who, and the pane swap on phones. */}
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={onClose}
          aria-label={t("common.back")}
          className="rounded-md px-2.5 py-1 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
        >
          ←
        </button>
        <h2 className="min-w-0 truncate text-base font-semibold">
          {`${customer.firstName} ${customer.lastName ?? ""}`.trim()}
        </h2>
        <span className="truncate text-sm text-[var(--muted)]">{customer.phone}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1 lg:hidden">
          {(
            [
              ["record", "fields.title"],
              ["conversation", "nav.inbox"],
            ] as const
          ).map(([pane, key]) => (
            <button
              key={pane}
              type="button"
              onClick={() => setMobilePane(pane)}
              aria-pressed={mobilePane === pane}
              // Ghost, no border, and the same font weight in both states so
              // picking a pane never nudges its neighbour sideways.
              className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                mobilePane === pane
                  ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              }`}
            >
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      {/* 40/60 split, each column its own scroll region (WhatsApp Web / HubSpot
          dual-scroll): the record scrolls left, the conversation scrolls right,
          the page itself never does. */}
      <div className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Left: the record, everything ABOUT the customer. */}
        <div
          className={`${mobilePane === "record" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col gap-4 lg:flex`}
        >
          {/* One record, not two forms: the built-in fields and the org's own
              fields read the same way and sit in the same card. Adding a field
              in Workspace setup adds a row here, no code.

              The card fills the column and the field list scrolls INSIDE it, so
              the scrollbar hugs the card border the way the conversation card's
              does, instead of a short card floating in an empty column. */}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <div className="thin-scroll stable-gutter min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
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

          {/* Appointments sit below the record, pinned: they're history, not a
              property, and they must not ride along when the fields scroll. The
              list caps its own height so a heavy customer can't squeeze the
              record card out of the column. */}
          <section className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <h3 className="shrink-0 px-4 pt-4 pb-2 text-sm font-semibold">
              {t("appointments.title")}
            </h3>
            {appointments === undefined && (
              <p className="px-4 pb-4 text-sm text-[var(--muted)]">{t("common.loading")}</p>
            )}
            {appointments?.length === 0 && (
              <p className="px-4 pb-4 text-sm text-[var(--muted)]">
                {t("appointments.none")}
              </p>
            )}
            {!!appointments?.length && (
              <ul className="thin-scroll stable-gutter max-h-52 divide-y divide-[var(--border)] overflow-y-auto">
                {appointments.map((appointment) => (
                  <li key={appointment._id}>
                    {/* Flat row, hairline divider, wash on hover. No border per
                        row, and nothing moves. */}
                    <div className="flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-[var(--row-hover-bg)]">
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
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {t(STATUS_KEY[appointment.status])}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right: conversation, the shared component, never a page variant.
            The card fills the pane; the feed scrolls with the composer pinned. */}
        <section
          className={`${mobilePane === "conversation" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] lg:flex`}
        >
          <ConversationPanel
            customerId={customerId}
            lastInboundAt={customer.lastInboundAt}
            className="flex-1"
          />
        </section>
      </div>
    </div>
  );
}
