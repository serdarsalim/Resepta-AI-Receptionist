"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { Rect } from "@/lib/anchoredSheet";
import type { ModalDraft } from "./AppointmentModal";
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
import { useHeaderSearch } from "@/lib/HeaderSearch";
import { rememberCustomer } from "@/lib/recentCustomers";

const STATUS_KEY: Record<string, TranslationKey> = {
  scheduled: "status.scheduled",
  confirmed: "status.confirmed",
  cancelled: "status.cancelled",
  completed: "status.completed",
  no_show: "status.no_show",
};

// The life of a booking, in the order it lives it — not the order the record
// happens to declare them in. A picker is read top to bottom, so the two
// endings sit at the bottom where somebody closing a visit out will look.
const STATUS_ORDER = [
  "scheduled",
  "confirmed",
  "completed",
  "no_show",
  "cancelled",
] as const;

type CustomerAppointment = FunctionReturnType<
  typeof api.appointments.listForCustomer
>[number];

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
        dense
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
  onOpenContact,
}: {
  customerId: Id<"customers">;
  onClose: () => void;
  // The header jump list navigates to OTHER customers from here, so this page
  // needs the same door the list views hand around.
  onOpenContact: (customerId: Id<"customers">) => void;
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

  // The header box, claimed like every list tab claims it — and with the
  // customer-jump slot filled, which is this page's whole difference: the box
  // filters THIS customer's feed live, and matching customers appear in a
  // list you have to click (CustomerJump). Stable callback, per the hook's
  // contract.
  const jumpToCustomer = useCallback(
    (id: string) => onOpenContact(id as Id<"customers">),
    [onOpenContact],
  );
  const search = useHeaderSearch(t("common.search"), jumpToCustomer);

  // Feed the recents list at the point of OPENING, whatever route opened this
  // page — that's what makes recents useful on their very first use.
  const recentName = customer
    ? `${customer.firstName} ${customer.lastName ?? ""}`.trim()
    : null;
  const recentPhone = customer?.phone ?? null;
  useEffect(() => {
    if (recentName === null || recentPhone === null) return;
    rememberCustomer({ id: customerId, name: recentName, phone: recentPhone });
  }, [customerId, recentName, recentPhone]);

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

  // Built once. Four places wanted it and each carried its own copy of the
  // same `${first} ${last ?? ""}`.trim().
  const customerName = `${customer.firstName} ${customer.lastName ?? ""}`.trim();

  return (
    // Fills the pane and scrolls inside itself, so it takes the phone's bottom
    // edge — see AppShell's main. Declared here rather than by tab id because
    // the customers LIST behind it does not fill the pane, and both are the
    // same tab.
    <div data-fills-pane className="flex h-full min-h-0 min-w-0 flex-col">
      {/* One row on a desktop: back, who, the filter pills. Two on a phone with
          the conversation open, because that is the one combination that does
          not fit — back, name, dot, pills and the pane swap together ask for
          ~560px of a 454px row. Everything but the name is shrink-0, so the
          name paid the whole difference and rendered at zero width: the header
          of a customer record with no customer in it.

          flex-wrap alone would not have moved anything. The name is min-w-0, so
          the browser shrinks it to nothing before it considers a second line —
          the overflow reads as "fits" right up until it doesn't. The pills take
          w-full below lg to claim a line outright, and order-last so the break
          lands before them rather than before the pane swap. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
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
          className={`order-last w-full ${
            mobilePane === "conversation" ? "flex" : "hidden"
          } lg:order-none lg:ml-auto lg:w-auto lg:flex`}
        />
        {/* Always ml-auto now. It used to give the margin up whenever the pills
            were showing, because the two were sharing one line and fighting for
            it; the pills have their own line below lg, so there is nothing left
            to yield to. */}
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
                  : "text-[var(--muted-strong)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
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
              {/* What they bought leads the card; who they are follows. See the
                  component. Booking from the record, with this customer already
                  decided: the calendar was the only way in, which meant the one
                  screen that knows who you are talking about could not act on
                  it. */}
              <CustomerAppointments
                appointments={appointments}
                currency={currency}
                priceDecimals={settings?.org.priceDecimals}
                onAdd={() =>
                  booking.open({
                    // Next round hour, the same default the calendar's own
                    // toolbar button uses when no slot was clicked.
                    startAt: Math.ceil(Date.now() / 3_600_000) * 3_600_000,
                    durationMinutes: DEFAULT_DURATION,
                    customerId,
                    customerName: customerName,
                  })
                }
                onOpen={(draft, anchor) =>
                  booking.open({ ...draft, customerId, customerName }, anchor)
                }
              />
              <FieldRow label={t("customers.firstName")}>
                <InlineEditValue
                  dense
                  value={customer.firstName}
                  onSave={(next) => updateCustomer({ customerId, firstName: next })}
                />
              </FieldRow>
              <FieldRow label={t("customers.lastName")}>
                <InlineEditValue
                  dense
                  value={customer.lastName ?? ""}
                  onSave={(next) => updateCustomer({ customerId, lastName: next })}
                />
              </FieldRow>
              <FieldRow label={t("customers.phone")}>
                <PhoneField
                  dense
                  value={customer.phone}
                  onSave={(next) => updateCustomer({ customerId, phone: next })}
                />
              </FieldRow>
              <FieldRow label={t("customers.email")}>
                <InlineEditValue
                  dense
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
            search={search}
            className="flex-1"
          />
        </section>
      </div>

      {booking.render()}
    </div>
  );
}

// What this customer bought, and it LEADS the record card — Nudge's deal block,
// in a salon's terms (Serdar's call, 2026-08-17).
//
// It used to close the card, under the field rows, and that was the wrong way
// round for the same reason Nudge moved its own: the visits are why anybody
// opens a customer at all, and the identity fields are reference material you
// consult once. Sitting last they were also the first thing pushed off the
// bottom of a scroll region a phone had already halved.
//
// The cost is real and worth naming: First name no longer starts at a fixed
// position. Where the record begins now depends on how many bookings this
// customer has.
//
// Bottom rule only. The block sits against the card's own top edge, so a rule
// above it would be a line drawn on a line; the single rule below is what stops
// First name / Phone / Email reading as though they belonged to the last visit.
function CustomerAppointments({
  appointments,
  currency,
  priceDecimals,
  onAdd,
  onOpen,
}: {
  appointments: CustomerAppointment[] | undefined;
  currency: string;
  priceDecimals?: boolean;
  onAdd: () => void;
  onOpen: (draft: ModalDraft, anchor: Rect) => void;
}) {
  const { t, language } = useLanguage();
  const setStatus = useMutation(api.appointments.setStatus);
  const [showPast, setShowPast] = useState(false);

  // Upcoming is a visit still ahead that nobody has closed out — the same line
  // Nudge draws between an open deal and a closed one. A cancelled booking next
  // Tuesday is history: it is not going to happen, and leaving it up top means
  // the count in the heading promises work that isn't there.
  const now = Date.now();
  const isUpcoming = (a: CustomerAppointment) =>
    a.startAt >= now && (a.status === "scheduled" || a.status === "confirmed");
  // The query hands these back newest-first, which is right for history and
  // backwards for plans: what you need off the top of an upcoming list is the
  // next thing happening, not the furthest away.
  const upcoming = (appointments ?? []).filter(isUpcoming).sort((a, b) => a.startAt - b.startAt);
  const past = (appointments ?? []).filter((a) => !isUpcoming(a));

  // Same draft the calendar builds, so an edit opened from here and an edit
  // opened from the grid are the same sheet with the same handles. Snapshotted
  // lines, not ids resolved fresh: it shows what this visit recorded, not what
  // the service costs now.
  const draftFor = (a: CustomerAppointment): ModalDraft => ({
    appointmentId: a._id,
    startAt: a.startAt,
    durationMinutes: a.durationMinutes ?? DEFAULT_DURATION,
    lines: (a.items ?? []).flatMap((item) =>
      item.serviceId
        ? [{ serviceId: item.serviceId, price: item.price, quantity: item.quantity }]
        : [],
    ),
    staffId: a.staffId ?? null,
    notes: a.notes,
    status: a.status,
  });

  const card = (a: CustomerAppointment) => (
    <div key={a._id} className="rounded-md border border-[var(--border)] bg-[var(--card)] p-2">
      <div className="flex items-center gap-2">
        {/* The heading is what they BOUGHT — the section's whole subject, and
            the one line that differs between two visits a week apart. Clicking
            it opens the booking sheet: this is the screen with the customer in
            front of you, so it is where a booking gets moved. */}
        <button
          type="button"
          onClick={(event) =>
            onOpen(draftFor(a), event.currentTarget.getBoundingClientRect())
          }
          className="min-w-0 flex-1 truncate rounded text-left text-sm font-medium transition-colors hover:text-[var(--accent)]"
        >
          {a.serviceName || t("appointments.title")}
        </button>
        <span className="shrink-0 text-xs text-[var(--muted)]">
          {formatDateTime(a.startAt, language)}
        </span>
      </div>
      {/* Labelled, because "Confirmed" on its own is a word with no question
          attached — on the calendar the column supplies that and this card has
          no column. Same tier the record rows below use, and no colon, because
          they have none either. The service name needs no label (it is the
          card's heading) and neither does the amount, which carries its
          currency. Nudge's Stage row, exactly. */}
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[11px] text-[var(--muted-strong)]">
            {t("appointments.status")}
          </span>
          <InlineEditValue
            compact
            clearable={false}
            value={a.status}
            options={[...STATUS_ORDER]}
            labelFor={(value) => t(STATUS_KEY[value] ?? "status.scheduled")}
            onSave={(next) =>
              setStatus({
                appointmentId: a._id,
                status: next as CustomerAppointment["status"],
              })
            }
          />
          {a.staffName && (
            <span className="min-w-0 truncate text-xs text-[var(--muted)]">
              · {a.staffName}
            </span>
          )}
        </span>
        {/* A visit nobody priced shows no amount rather than a dash — an empty
            slot is easier to skim past than a placeholder. */}
        {a.total !== undefined && (
          <span className="shrink-0 text-sm tabular-nums">
            {formatMoney(a.total, currency, language, priceDecimals)}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className="mb-1 border-b border-[var(--border)] pb-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--muted)]">
          {t("appointments.title")}
          {upcoming.length > 0 &&
            ` · ${upcoming.length} ${t("appointments.upcomingCount")}`}
        </span>
        {/* Outlined, not filled and not a bare link. A fill would make this
            history block compete with the page's real primary, and a blue link
            is indistinguishable from the "show history" toggle directly below
            it — which is a disclosure, not an action. Blue belongs to the
            toggles here; a box belongs to the actions. Nudge's + Add deal. */}
        <button
          type="button"
          onClick={onAdd}
          className="shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--row-hover-bg)]"
        >
          + {t("appointments.addForCustomer")}
        </button>
      </div>

      <div className="mt-2 space-y-2">
        {appointments === undefined && (
          <p className="text-xs text-[var(--muted)]">{t("common.loading")}</p>
        )}
        {upcoming.map(card)}
        {appointments !== undefined && upcoming.length === 0 && (
          <p className="text-xs text-[var(--muted)]">{t("appointments.noUpcoming")}</p>
        )}
      </div>

      {past.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowPast((prev) => !prev)}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            {showPast
              ? t("appointments.hidePast")
              : t("appointments.showPast").replace("{n}", String(past.length))}
          </button>
          {showPast && <div className="mt-1.5 space-y-2">{past.map(card)}</div>}
        </div>
      )}
    </div>
  );
}
