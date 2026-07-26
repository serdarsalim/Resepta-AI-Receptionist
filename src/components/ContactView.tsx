"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/datetime";
import { Toggle } from "./Toggle";
import { ConversationPanel, type FeedFilter } from "./ConversationPanel";
import { FeedFilterPills } from "./FeedFilterPills";
import { FieldGroup, FieldRow, InlineEditValue } from "./RecordField";
import { PhoneField } from "./PhoneField";

const STATUS_KEY: Record<string, TranslationKey> = {
  scheduled: "status.scheduled",
  confirmed: "status.confirmed",
  cancelled: "status.cancelled",
  completed: "status.completed",
  no_show: "status.no_show",
};

// The org field's declared type picks the editor; a select hands its options to
// the same control instead of a second one.
const FIELD_INPUT: Record<Doc<"contactFields">["type"], "text" | "number" | "date"> = {
  text: "text",
  select: "text",
  number: "number",
  date: "date",
};

// One org-defined field, whichever group it sits in. Voice-collected rows are
// this same editable row on purpose: an agent mishearing a plate number is
// exactly the moment someone needs to correct it by hand.
function CustomFieldRow({
  field,
  value,
  onSave,
}: {
  field: Doc<"contactFields">;
  value: string;
  onSave: (value: string) => unknown;
}) {
  return (
    <FieldRow label={field.label}>
      <InlineEditValue
        value={value}
        options={field.type === "select" ? (field.options ?? []) : null}
        type={FIELD_INPUT[field.type]}
        onSave={onSave}
      />
    </FieldRow>
  );
}

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
  const [filter, setFilter] = useState<FeedFilter>("all");

  // Two groups, in the order a reader works through the record: what staff
  // typed, then what the calls collected and will keep collecting on their own.
  // Source is unset on every field created before voice existed, so anything
  // that isn't explicitly "voice" is staff-filled.
  const orgFields: Doc<"contactFields">[] = fields ?? [];
  const staffFields = orgFields.filter((field) => field.source !== "voice");
  const voiceFields = orgFields.filter((field) => field.source === "voice");

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
        {/* Name only. The number is a field on the record card directly below,
            where it is editable — repeating it here read as a second, stale
            copy of the same fact. */}
        <h2 className="min-w-0 truncate text-base font-semibold">
          {`${customer.firstName} ${customer.lastName ?? ""}`.trim()}
        </h2>
        {/* Pills ride the header line so the record card and the conversation
            card start on the same line below it. On phones they only appear
            while the conversation pane is showing — filtering a feed you
            aren't looking at is a control with nothing to control. */}
        <FeedFilterPills
          customerId={customerId}
          value={filter}
          onChange={setFilter}
          className={`ml-auto ${mobilePane === "conversation" ? "flex" : "hidden"} lg:flex`}
        />
        <div
          className={`flex shrink-0 items-center gap-1 lg:hidden ${
            mobilePane === "conversation" ? "" : "ml-auto"
          }`}
        >
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
                <PhoneField
                  value={customer.phone}
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
              {/* An empty group renders nothing, heading included: a lone
                  divider over blank space is a frame around no content. */}
              {staffFields.length > 0 && <FieldGroup label={t("fields.title")} />}
              {staffFields.map((field) => (
                <CustomFieldRow
                  key={field._id}
                  field={field}
                  value={customer.custom?.[field.key] ?? ""}
                  onSave={(next) =>
                    setCustomValue({ customerId, key: field.key, value: next })
                  }
                />
              ))}

              {/* Where these values came from is the (i)'s job, not a
                  paragraph's, and not a badge repeated on every row. */}
              {voiceFields.length > 0 && (
                <FieldGroup label={t("fields.voiceGroup")} hint={t("fields.voiceRecordHint")} />
              )}
              {voiceFields.map((field) => (
                <CustomFieldRow
                  key={field._id}
                  field={field}
                  value={customer.custom?.[field.key] ?? ""}
                  onSave={(next) =>
                    setCustomValue({ customerId, key: field.key, value: next })
                  }
                />
              ))}
            </div>

            {/* Record meta, pinned under the fields the way Nudge's contact
                footer works: when this customer arrived, when they last got in
                touch, and their consent.

                Consent sits HERE rather than up among the identity fields on
                purpose. It is not a detail somebody types, it is a legal fact
                about this one customer, and a stray tap next to the email box
                either mutes them or marks them as having agreed to something
                they never agreed to. Down here it reads as the record it is,
                dated, and it cannot move to Settings: one org-wide switch
                standing in for every customer's consent is the thing KVKK
                exists to forbid. */}
            <div className="shrink-0 space-y-1.5 border-t border-[var(--border)] px-4 py-3">
              <FieldRow label={t("customers.added")}>
                <span className="block py-1 text-sm text-[var(--muted)]">
                  {formatDateTime(customer._creationTime, language)}
                </span>
              </FieldRow>
              {/* Blank over zero: a customer who has never written gets no row
                  rather than a dash. */}
              {customer.lastInboundAt !== undefined && (
                <FieldRow label={t("customers.lastActivity")}>
                  <span className="block py-1 text-sm text-[var(--muted)]">
                    {formatDateTime(customer.lastInboundAt, language)}
                  </span>
                </FieldRow>
              )}
              <FieldRow label={t("customers.consent")} hint={t("customers.consentHint")}>
                <span className="flex h-7 items-center gap-2">
                  <Toggle
                    checked={customer.consentAt !== undefined}
                    onChange={(next) => void updateCustomer({ customerId, consent: next })}
                  />
                  {/* The date is what makes this a record instead of a switch:
                      "consented" with no when is not worth much if anyone ever
                      asks. */}
                  {customer.consentAt !== undefined && (
                    <span className="text-xs text-[var(--muted)]">
                      {formatDateTime(customer.consentAt, language)}
                    </span>
                  )}
                </span>
              </FieldRow>
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
            The card leads the column with nothing above it, so its top edge
            lines up with the record card's. */}
        <section
          className={`${mobilePane === "conversation" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] lg:flex`}
        >
          <ConversationPanel
            customerId={customerId}
            lastInboundAt={customer.lastInboundAt}
            filter={filter}
            className="flex-1"
          />
        </section>
      </div>
    </div>
  );
}
