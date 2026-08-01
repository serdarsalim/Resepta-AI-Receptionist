"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { formatAge, formatDateTime, formatDay } from "@/lib/datetime";
import { Toggle } from "./Toggle";
import { ConversationPanel, type FeedFilter } from "./ConversationPanel";
import { FeedFilterPills } from "./FeedFilterPills";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";
import { FieldGroup, FieldRow, InlineEditValue } from "./RecordField";
import { InfoTip } from "./InfoTip";
import { PhoneField } from "./PhoneField";
import { DEFAULT_DURATION } from "@/lib/calendarDrag";
import { useBookingSheet } from "./useBookingSheet";

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

// A label in the record footer. Its whole job is to stay on one line: it sits
// in an `auto` grid column, so a label that wraps does not just look wrong, it
// sets the column width for the pair beside it too.
function MetaLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {label}
      {hint && <InfoTip text={hint} />}
    </span>
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
  const settings = useQuery(api.orgs.current, {});
  const currency = settings?.org.currency ?? DEFAULT_CURRENCY;
  const updateCustomer = useMutation(api.customers.update);
  const setCustomValue = useMutation(api.customers.setCustomValue);
  const setAttention = useMutation(api.messages.setAttention);
  const setMuted = useMutation(api.customers.setMuted);
  // Same sheet the calendar opens, same conflict handling. No onOpenContact:
  // the record it would navigate to is the one you are reading.
  const booking = useBookingSheet({});
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
        {/* The drawn arrow, same one the inbox uses. A "←" glyph is whatever
            the reader's font decides it is, and next to a row of crisp SVG
            channel icons it read as a stray character. */}
        <button
          onClick={onClose}
          aria-label={t("common.back")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </button>
        {/* Name only. The number is a field on the record card directly below,
            where it is editable — repeating it here read as a second, stale
            copy of the same fact. */}
        <h2 className="min-w-0 truncate text-base font-semibold">
          {`${customer.firstName} ${customer.lastName ?? ""}`.trim()}
        </h2>
        {/* The same dot the table and the inbox draw, and here it is a
            CONTROL. Opening the record clears it, which is right almost
            always and wrong the once — you look, you cannot deal with it now,
            and you want it to still be waiting later. Every mail client on
            earth calls that mark as unread; this is the same button.

            Not in the table: there, clicking a row already means read, so a
            second affordance would be two ways to do one thing. Here the row
            is already open and the click has nowhere else to go. */}
        <button
          type="button"
          aria-pressed={customer.needsAttention}
          aria-label={t("customers.needsLook")}
          title={t("customers.needsLook")}
          onClick={() =>
            void setAttention({
              customerId,
              cleared: customer.needsAttention,
            })
          }
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--muted-bg)]"
        >
          <span
            className={`h-2.5 w-2.5 rounded-full transition-colors ${
              customer.needsAttention
                ? "bg-[var(--brand)]"
                : "border border-[var(--border)] bg-transparent"
            }`}
          />
        </button>
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
          className={`${mobilePane === "record" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col lg:flex`}
        >
          {/* One record, not two forms: the built-in fields and the org's own
              fields read the same way and sit in the same card. Adding a field
              in Workspace setup adds a row here, no code.

              The card fills the column and the field list scrolls INSIDE it, so
              the scrollbar hugs the card border the way the conversation card's
              does, instead of a short card floating in an empty column. */}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden card-raised">
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

              {/* Appointments close the record, under the same kind of ruled
                  heading the field groups use — Nudge's Deals section on its
                  contact card, which is the same idea: related records living
                  INSIDE the record rather than in a card of their own.

                  They were a second card below this one, and that was wrong in
                  two ways. This card is flex-1, so a customer with four fields
                  left a column of dead white above an appointments card that
                  had been pushed half off the bottom of the screen. And the
                  split implied the two were separate things to read, when
                  "who they are" and "when they came" is one answer.

                  Editable rows first, read-only history after: everything you
                  can type into is above this rule, nothing below it is. */}
              {/* Booking from the record, with this customer already decided.
                  The calendar was the only way in, which meant the one screen
                  that knows who you are talking about could not act on it: you
                  read their history here, then went to the grid and named them
                  again. Same sheet, same conflict handling, customer prefilled
                  so the picker never appears. */}
              <FieldGroup
                label={t("appointments.title")}
                action={
                  <button
                    type="button"
                    onClick={() =>
                      booking.open({
                        // Next round hour, the same default the calendar's own
                        // toolbar button uses when no slot was clicked.
                        startAt: Math.ceil(Date.now() / 3_600_000) * 3_600_000,
                        durationMinutes: DEFAULT_DURATION,
                        customerId,
                        customerName: `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
                      })
                    }
                    className="rounded-md px-2 py-0.5 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--muted-bg)]"
                  >
                    {t("appointments.addForCustomer")}
                  </button>
                }
              />
              {appointments === undefined && (
                <p className="py-1 text-sm text-[var(--muted)]">{t("common.loading")}</p>
              )}
              {appointments?.length === 0 && (
                <p className="py-1 text-sm text-[var(--muted)]">{t("appointments.none")}</p>
              )}
              {!!appointments?.length && (
                // Bled out to the card's edges (-mx-4) so the hover wash and
                // the hairlines run the full width the way a list should,
                // instead of floating inside the field inset. No nested scroll
                // any more: this list is part of the record's one scroll now,
                // and two scrollbars in one card is a trap.
                <ul className="-mx-4 divide-y divide-[var(--border)] border-b border-[var(--border)]">
                  {appointments.map((appointment) => (
                    <li key={appointment._id}>
                      {/* Flat row, hairline divider, wash on hover. No border
                          per row, and nothing moves.
                          
                          A button, because the booking is editable from here.
                          It used to be a div: you could read that Ebru has
                          Giovanni at 15:15 on the one screen with Giovanni in
                          front of you, and to move it by ten minutes you went
                          to the calendar and found the block. Same sheet the
                          grid opens, anchored to the row. */}
                      <button
                        type="button"
                        onClick={(event) => {
                          const r = event.currentTarget.getBoundingClientRect();
                          booking.open(
                            {
                              appointmentId: appointment._id,
                              startAt: appointment.startAt,
                              durationMinutes:
                                appointment.durationMinutes ?? DEFAULT_DURATION,
                              customerId,
                              customerName: `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
                              // Snapshotted lines, not ids resolved fresh: the
                              // sheet shows what this visit recorded, not what
                              // the service costs now.
                              lines: (appointment.items ?? []).flatMap((item) =>
                                item.serviceId
                                  ? [{ serviceId: item.serviceId, price: item.price }]
                                  : [],
                              ),
                              staffId: appointment.staffId ?? null,
                              notes: appointment.notes,
                              status: appointment.status,
                            },
                            { top: r.top, left: r.left, width: r.width, height: r.height },
                          );
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)]">
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
                        {/* The money reads as the row's fact and the status as
                            its footnote, so the total takes the ink and the
                            word sits under it. A visit nobody priced shows no
                            amount rather than a dash — an empty slot is easier
                            to skim past than a placeholder. */}
                        <span className="shrink-0 text-right">
                          {appointment.total !== undefined && (
                            <span className="block text-sm tabular-nums">
                              {formatMoney(appointment.total, currency, language)}
                            </span>
                          )}
                          <span className="block text-xs text-[var(--muted)]">
                            {t(STATUS_KEY[appointment.status])}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Record meta, the way Nudge's contact footer works: when this
                customer arrived, when they last wrote, their consent, and
                whether they are muted.

                Two by two, and directly under the last field rather than
                pinned to the bottom of the panel. Pinned, it floated away from
                the fields on a tall screen and read as a separate thing the
                panel happened to be carrying. Sitting where the fields end, it
                reads as what it is: the last four facts on the record.

                Consent sits HERE rather than up among the identity fields on
                purpose. It is not a detail somebody types, it is a legal fact
                about this one customer, and a stray tap next to the email box
                marks them as having agreed to something they never agreed to.
                Down here it reads as the record it is, dated, and it cannot
                move to Settings: one org-wide switch standing in for every
                customer's consent is the thing KVKK exists to forbid.

                Mute sits beside it because they look alike and are not, which
                is exactly why they belong where the difference is visible: one
                governs what the salon may send, the other what this person may
                put in front of the salon.

                NOT built from FieldRow, which is the identity form's row and
                reserves a 7.5rem label track so every field above lines up. At
                half width that track is most of the cell, and the values it
                left behind wrapped: a date broke across three lines to say "26
                Jul 2026". These four pairs FLOW through one 4-column grid with
                `auto` label columns instead, so each label column sizes to its
                own widest label and the two halves still line up with each
                other.

                The fallback to one pair per row is a CONTAINER query, not a
                viewport one. This panel is 2fr of a 2fr/3fr split, so it is
                narrow on exactly the wide screens a `sm:` breakpoint calls
                roomy: asking the viewport how much space this grid has is the
                same mistake that made the values wrap in the first place.
                20rem is measured, not guessed. German is the widest of the
                three languages and needs 315px for four columns; below that it
                stacks rather than overflow. */}
            <div className="@container shrink-0 border-t border-[var(--border)] px-4 py-3">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs text-[var(--muted)] @min-[20rem]:grid-cols-[auto_1fr_auto_1fr]">
              {/* Added keeps a date and Last reply takes an age, the same split
                  the Contacts table already makes. When somebody joined is a
                  fact you look up; when they last wrote is a fact you feel, and
                  it stops being interesting long before the date does. */}
              <MetaLabel label={t("customers.added")} />
              <span className="whitespace-nowrap" title={formatDateTime(customer._creationTime, language)}>
                {formatDay(customer._creationTime, language)}
              </span>
              {/* An age, not a timestamp. "27 Jul, 22:25" is a precision nobody
                  reads at a glance and it will not fit half a column anyway;
                  "2d" answers the question actually being asked. The exact
                  moment is still one hover away.

                  Blank over zero, never a dash: the cell keeps its place in the
                  grid, it just has nothing to report yet. */}
              <MetaLabel label={t("customers.lastReply")} />
              <span
                className="whitespace-nowrap"
                title={
                  customer.lastInboundAt !== undefined
                    ? formatDateTime(customer.lastInboundAt, language)
                    : undefined
                }
              >
                {customer.lastInboundAt !== undefined
                  ? formatAge(customer.lastInboundAt, language)
                  : ""}
              </span>
              {/* "Consent" here, not the table's "Messaging consent". Two words
                  set an `auto` label column wide enough to squeeze the date out
                  of the cell beside it, and down here, next to Mute, there is
                  nothing else it could be consent TO. */}
              {/* Both switches render bare, the way Nudge's footer does. The
                  consent date used to sit beside its toggle, and it was the
                  single widest thing in the grid: carrying it cost 87px, which
                  is the difference between this footer fitting the panel in
                  German and not. It is still on the toggle's title, still a
                  column in Contacts, and still exported in the CSV, so nothing
                  about the record got quieter, it just stopped being the reason
                  the other three cells had nowhere to go. */}
              <MetaLabel label={t("customers.consentShort")} hint={t("customers.consentHint")} />
              <span
                className="flex items-center"
                title={
                  customer.consentAt !== undefined
                    ? formatDateTime(customer.consentAt, language)
                    : undefined
                }
              >
                <Toggle
                  size="sm"
                  checked={customer.consentAt !== undefined}
                  onChange={(next) => void updateCustomer({ customerId, consent: next })}
                />
              </span>
              <MetaLabel label={t("customers.mute")} hint={t("customers.muteHint")} />
              <span className="flex items-center">
                <Toggle
                  size="sm"
                  checked={customer.mutedAt !== undefined}
                  onChange={(next) => void setMuted({ customerId, muted: next })}
                />
              </span>
            </div>
            </div>
          </section>
        </div>

        {/* Right: conversation, the shared component, never a page variant.
            The card leads the column with nothing above it, so its top edge
            lines up with the record card's. */}
        <section
          className={`${mobilePane === "conversation" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col overflow-hidden card-raised lg:flex`}
        >
          <ConversationPanel
            customerId={customerId}
            contactName={`${customer.firstName} ${customer.lastName ?? ""}`.trim()}
            lastInboundAt={customer.lastInboundAt}
            filter={filter}
            onFilterChange={setFilter}
            className="flex-1"
          />
        </section>
      </div>

      {booking.render()}
    </div>
  );
}
