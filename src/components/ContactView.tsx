"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { Rect } from "@/lib/anchoredSheet";
import type { ModalDraft } from "./AppointmentModal";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatAge, formatDateTime, formatDay } from "@/lib/datetime";
import { CheckSwitch } from "./CheckSwitch";
import { useConfirm } from "./ConfirmDialog";
import { buttonClass } from "./Control";
import { ConversationPanel, type FeedFilter } from "./ConversationPanel";
import { FeedFilterPills } from "./FeedFilterPills";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";
import { FieldRow, InlineEditValue } from "./RecordField";
import { InfoTip } from "./InfoTip";
import { PhoneField } from "./PhoneField";
import { RowMenu } from "./RowMenu";
import { CustomerDeleteSheet } from "./CustomerDeleteSheet";
import { DEFAULT_DURATION } from "@/lib/calendarDrag";
import { useBookingSheet } from "./useBookingSheet";
import { useHeaderSearch } from "@/lib/HeaderSearch";
import { useHeaderPanes, type HeaderPaneTarget } from "@/lib/HeaderPanes";
import { rememberCustomer } from "@/lib/recentCustomers";

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
  initialFilter,
  initialItemId,
  onTitle,
  onOpenContact,
  onDeleted,
}: {
  customerId: Id<"customers">;
  // Reported up so the SHELL header can carry this person's name; the tab
  // underneath is no longer what the page is about.
  onTitle?: (name: string) => void;
  // The header jump list navigates to OTHER customers from here, so this page
  // needs the same door the list views hand around.
  onOpenContact: (
    customerId: Id<"customers">,
    channel?: FeedFilter,
    itemId?: string,
  ) => void;
  // Which channel to open on. See the state below.
  initialFilter?: FeedFilter;
  // WHICH mail or call on that channel, when the caller was looking at one.
  // Passed straight through to the feed — see ConversationPanel, which is
  // where a channel that lists before it reads gets opened on a row.
  initialItemId?: string;
  // Where to go once this customer has been deleted from the ⋯ menu. The
  // record has nothing left to show, so the page it sat on decides.
  onDeleted?: () => void;
}) {
  const { t, language } = useLanguage();
  const customer = useQuery(api.customers.get, { customerId });
  const fields = useQuery(api.contactFields.list, {});
  const appointments = useQuery(api.appointments.listForCustomer, { customerId });
  const settings = useQuery(api.orgs.current, {});
  const currency = settings?.org.currency ?? DEFAULT_CURRENCY;
  const updateCustomer = useMutation(api.customers.update);
  const setCustomValue = useMutation(api.customers.setCustomValue);
  const setMuted = useMutation(api.customers.setMuted);
  const setNoAiCalls = useMutation(api.customers.setNoAiCalls);
  const setMarketingEmailOptOut = useMutation(api.customers.setMarketingEmailOptOut);
  const [confirmResubscribe, confirmResubscribeDialog] = useConfirm();
  // Switching Unsubscribed off sends this person marketing email again, which
  // is theirs to ask for: the switch asks before doing it. On is immediate.
  const changeUnsubscribed = async (next: boolean) => {
    if (!next) {
      const ok = await confirmResubscribe({
        title: t("customers.resubscribeTitle"),
        body: t("customers.resubscribeBody"),
        confirmLabel: t("customers.resubscribe"),
        destructive: false,
        focusCancel: true,
      });
      if (!ok) return;
    }
    await setMarketingEmailOptOut({ customerId, on: next });
  };
  const removeCustomer = useMutation(api.customers.remove);
  const markConversationRead = useMutation(api.messages.markConversationRead);
  // Deleting is an owner's call, server-side too (customers.remove); the menu
  // is simply not drawn for staff rather than offered and refused.
  const isOwner = settings?.me.role === "owner";
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Set the moment a delete starts. The record's own query answers null as
  // soon as the deletion commits, a beat before the page moves on, and
  // without this that beat reads "No customers" on the person just deleted.
  const [leaving, setLeaving] = useState(false);
  const confirmDelete = async () => {
    setLeaving(true);
    try {
      await removeCustomer({ customerId });
    } catch (error) {
      setLeaving(false);
      throw error;
    }
    onDeleted?.();
  };

  // Reading a conversation happens HERE now, so this is where it gets marked
  // read. Since 2026-08-22 an inbox row navigates to this page instead of
  // filling the pane beside it, and the stamp went with the click — which
  // covered exactly one of the doors into this page. Every other way in
  // (Customers, the header jump list, an appointment, a name in someone
  // else's feed) opened the same conversation and left the dot burning.
  //
  // On mount rather than on scroll or on a timer, and that IS the "person
  // chose to read this" signal the mutation's own comment asks for: nothing
  // auto-restores a contact page. AppHome starts with contactId null and only
  // ever sets it from a click, so this component existing means somebody
  // opened it. The view is keyed on customerId there, so this runs once per
  // contact rather than once per render.
  useEffect(() => {
    void markConversationRead({ customerId }).catch(() => {});
  }, [customerId, markConversationRead]);
  // Same sheet the calendar opens, same conflict handling. No onOpenContact:
  // the record it would navigate to is the one you are reading.
  const booking = useBookingSheet({});
  // Below lg the two panes swap instead of sharing the row (InboxView does the
  // same). The record opens first: you came here to read the customer, not to
  // land mid-thread.
  // Which pane a PHONE opens on. The record, unless whoever sent us here was
  // pointing at a conversation — and initialFilter is exactly that signal, set
  // only by an inbox row naming the channel its newest message arrived on.
  // Tapping a conversation and landing on First name / Last name makes the
  // reader tap again to reach the thing they tapped.
  //
  // Deliberately reading initialFilter rather than taking a second prop: a
  // caller that knows which channel you meant knows you meant the
  // conversation, and two flags that can only ever agree are one flag with a
  // way to be wrong.
  const [mobilePane, setMobilePane] = useState<"record" | "conversation">(
    initialFilter ? "conversation" : "record",
  );
  // Opens on whatever channel sent us here, "all" when nobody said. The view
  // is keyed on customerId in AppHome, so this re-initialises per contact
  // rather than carrying the last one's channel into the next one.
  const [filter, setFilter] = useState<FeedFilter>(initialFilter ?? "all");

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

  // The phone header's pane switcher (see HeaderPanes): a person glyph for
  // the record, the channel glyphs for the conversation. Selecting a channel
  // swaps the pane AND filters to it; re-selecting the open one clears back
  // to the merged feed, the same gesture the card's own pills use. Stable
  // callback, per the hook's contract.
  const selectPane = useCallback((target: HeaderPaneTarget) => {
    if (target === "record") {
      setMobilePane("record");
      return;
    }
    setMobilePane("conversation");
    setFilter((prev) => (prev === target ? "all" : target));
  }, []);
  useHeaderPanes(
    mobilePane === "record"
      ? "record"
      : filter === "call" || filter === "whatsapp" || filter === "email" || filter === "note"
        ? filter
        : null,
    selectPane,
  );

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

  // The shell header carries this person's name, so it has to travel up. Up
  // here with recentName rather than beside customerName below, because that
  // one is computed AFTER the loading early-returns and a hook cannot be.
  useEffect(() => {
    if (recentName === null) return;
    onTitle?.(recentName);
  }, [onTitle, recentName]);

  // Two groups, in the order a reader works through the record: what staff
  // typed, then what the calls collected and will keep collecting on their own.
  // Source is unset on every field created before voice existed, so anything
  // that isn't explicitly "voice" is staff-filled.
  const orgFields: Doc<"contactFields">[] = fields ?? [];

  if (customer === null) {
    if (leaving) return null;
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
    <div data-fills-pane data-bleeds-right className="flex h-full min-h-0 min-w-0 flex-col">
      {/* No switcher row of its own any more (Serdar, 2026-08-31): the
          record/conversation swap rides the SHELL header's title line as
          glyphs — a person for the record, the channel icons for the
          conversation — via the HeaderPanes slot claimed above. The words
          ("Contact fields | Inbox") spent a band under the title to say less
          than the icons say, in a language the pills already taught. */}

      {/* 40/60 split, each column its own scroll region (WhatsApp Web / HubSpot
          dual-scroll): the record scrolls left, the conversation scrolls right,
          the page itself never does. */}
      {/* gap-2, matching the inbox (Serdar, 2026-08-28): record and
          conversation are one working surface. */}
      <div className="grid min-h-0 min-w-0 flex-1 gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
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
                // The record's own verbs, hard right on the card's first
                // line: the card IS the customer, and an action belongs to
                // the card it acts on. Delete is the only one today.
                menu={
                  isOwner ? (
                    <RowMenu
                      label={t("customers.actions")}
                      items={[
                        {
                          key: "delete",
                          label: t("customers.delete"),
                          danger: true,
                          onSelect: () => setDeleteOpen(true),
                        },
                      ]}
                    />
                  ) : undefined
                }
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
              {/* NO HEADINGS. The record is one continuous list of fields, in
                  the org's own display order, and it ends here rather than
                  starting a new section.

                  It carried two headings within an hour of each other and both
                  came out. "From calls" split the same fields by field.source,
                  which is a fact about which door a value came in through —
                  true of Resepta, irrelevant to the person on the card, and
                  loud enough to break the record in half ("that's totally
                  irrelevant"). Then "Contact fields" itself: First name, Phone
                  and Email are contact fields too, and the Contact fields
                  table lists them alongside these ones, so a heading here drew
                  a line the surface that DEFINES them does not draw
                  ("everything here is a contact field anyway").

                  The source still matters where it is a DECISION — that
                  table's Locked / Can edit column, where you choose what the
                  agent may write. Nowhere else.

                  Same `fields` query the Contact fields table reads, so the two
                  are one list, and its drag-reorder is the single answer to
                  what sits where on both. */}
              {orgFields.map((field) => (
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
                customer arrived, when they last wrote, their consent, whether
                they are muted, and the two requests a customer makes about
                how they are contacted (No AI calls, Unsubscribed; 2026-10-13).

                Two by two, and directly under the last field rather than
                pinned to the bottom of the panel. Pinned, it floated away from
                the fields on a tall screen and read as a separate thing the
                panel happened to be carrying. Sitting where the fields end, it
                reads as what it is: the last facts on the record.

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
                Jul 2026". These pairs FLOW through one 4-column grid with
                `auto` label columns instead, so each label column sizes to its
                own widest label and the two halves still line up with each
                other.

                The fallback to one pair per row is a CONTAINER query, not a
                viewport one. This panel is 2fr of a 2fr/3fr split, so it is
                narrow on exactly the wide screens a `sm:` breakpoint calls
                roomy: asking the viewport how much space this grid has is the
                same mistake that made the values wrap in the first place.
                20rem is measured, not guessed. Re-measured 2026-10-13 with all
                six pairs, in the container's content box, Geist at text-xs,
                the (i) included: German is the widest and needs 19.45rem,
                English 19.1rem, Turkish 18.4rem (German alone was 19.0rem
                before the last two pairs). Below 20rem it stacks rather than
                overflow, and a 375px phone (20.3rem) keeps four columns. The
                new labels are short for exactly this reason, with their detail
                in the (i), Nudge's trade for the same footer ("fit in one row
                rather than be super accurate in wording we can explain in
                (i)"): "Keine KI-Anrufe" and "Abgemeldet" took German past
                20rem. A longer label here moves this number; measure first. */}
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
                {/* CheckSwitch, not the iOS Toggle (Serdar, 2026-08-31):
                    the check circle is this app's yes/no control everywhere
                    else, and CheckSwitch's own note listed this footer among
                    "the parts that have not been converted yet". Converted. */}
                <CheckSwitch
                  label={t("customers.consentShort")}
                  on={customer.consentAt !== undefined}
                  onChange={(next) => void updateCustomer({ customerId, consent: next })}
                />
              </span>
              <MetaLabel label={t("customers.mute")} hint={t("customers.muteHint")} />
              <span className="flex items-center">
                <CheckSwitch
                  label={t("customers.mute")}
                  on={customer.mutedAt !== undefined}
                  onChange={(next) => void setMuted({ customerId, muted: next })}
                />
              </span>
              {/* No AI calls (2026-10-13, Nudge's do-not-call): a decision
                  about contacting this person, so it sits with consent and
                  mute, and like them it saves on the tap. Its own switch, not
                  consent: a customer who refuses robot calls still gets their
                  reminders. On by a person here, or by the phone agent when
                  the caller asks on a call; off only by a person. The date it
                  was asked rides the title, as consent's does. */}
              <MetaLabel label={t("customers.noAiCalls")} hint={t("customers.noAiCallsHint")} />
              <span
                className="flex items-center"
                title={
                  customer.noAiCallsAt !== undefined
                    ? formatDateTime(customer.noAiCallsAt, language)
                    : undefined
                }
              >
                <CheckSwitch
                  label={t("customers.noAiCalls")}
                  on={customer.noAiCallsAt !== undefined}
                  onChange={(next) => void setNoAiCalls({ customerId, on: next })}
                />
              </span>
              {/* Unsubscribed from marketing email (2026-10-13). The
                  customer's own link turns it on; so can whoever hears "stop
                  sending me offers" at the counter, the do-not-call reasoning.
                  Turning it OFF puts somebody back on the marketing list, so
                  that direction asks first, with Cancel holding focus, and
                  both directions land in the activity feed. A switch rather
                  than a word: "Unsubscribed" as a value overflowed the column
                  in every language (see the 20rem note above). */}
              <MetaLabel
                label={t("customers.unsubscribed")}
                hint={t("customers.unsubscribedHint")}
              />
              <span
                className="flex items-center"
                title={
                  customer.marketingEmailOptOutAt !== undefined
                    ? formatDateTime(customer.marketingEmailOptOutAt, language)
                    : undefined
                }
              >
                <CheckSwitch
                  label={t("customers.unsubscribed")}
                  on={customer.marketingEmailOptOutAt !== undefined}
                  onChange={(next) => void changeUnsubscribed(next)}
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
            initialItemId={initialItemId}
            onFilterChange={setFilter}
            search={search}
            className="flex-1"
            // Pills left, the open tab's action right, one line — the Inbox's
            // header. They used to ride the page's title line, which put a
            // control that belongs to this card on the row naming the PERSON,
            // and left the card's own action alone in a band below with the
            // width of the card empty beside it.
            //
            // No name here, unlike the Inbox: the page title already says who
            // this is, and you are already on their record so there is nowhere
            // for it to link.
            //
            // The phone conditional went with it. The pills used to carry
            // `mobilePane === "conversation" ? "flex" : "hidden"` to stop a
            // filter showing over a feed nobody was looking at; inside the
            // pane, the pane's own visibility already says that.
            // max-lg:hidden: below lg the header's glyph switcher IS the
            // filter row (HeaderPanes), and two rows of the same pills one
            // above the other answered the same question twice. The Inbox
            // keeps its pills at every width — it claims no header slot.
            header={
              <FeedFilterPills
                customerId={customerId}
                value={filter}
                onChange={setFilter}
                className="max-lg:hidden"
              />
            }
          />
        </section>
      </div>

      {booking.render()}
      {confirmResubscribeDialog}
      {deleteOpen && (
        <CustomerDeleteSheet
          customerId={customerId}
          onClose={() => setDeleteOpen(false)}
          onConfirm={confirmDelete}
        />
      )}
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
  menu,
}: {
  appointments: CustomerAppointment[] | undefined;
  currency: string;
  priceDecimals?: boolean;
  onAdd: () => void;
  onOpen: (draft: ModalDraft, anchor: Rect) => void;
  // The record's ⋯, sharing this first line rather than spending one of its
  // own. Absent for staff.
  menu?: React.ReactNode;
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
      {/* Status is two different facts wearing one word, so it is two kinds
          of pill. WHERE the visit sits in time (upcoming / past — or a product
          sale, which has no "later") is the machine's to say and is not
          clickable. What the human knows that the calendar can't — the money
          was taken, or the visit is off — is the pair of pills they CAN tap.
          The five stored statuses are unchanged underneath; the tap picks the
          right one for the moment: İptal on a past visit records a no_show
          (arming the win-back) rather than firing the cancel machinery at a
          customer who simply never came. Tapping an active pill undoes it. */}
      <div className="mt-1 flex items-center justify-between gap-3">
        {/* No "Status" label: three pills reading Upcoming/Paid/Cancelled are
            their own caption, and the label was the widest thing on the row. */}
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {(() => {
            const isPast = a.startAt < now;
            const productOnly =
              (a.items?.length ?? 0) > 0 &&
              (a.items ?? []).every((item) => item.durationMinutes === 0);
            const paid = a.status === "completed";
            const off = a.status === "cancelled" || a.status === "no_show";
            const pill = "rounded-full px-2 py-0.5 text-[11px] transition-colors";
            return (
              <>
                <span
                  className={`${pill} bg-[var(--border)] text-[var(--muted)]`}
                  title={a.status === "confirmed" ? t("status.confirmed") : undefined}
                >
                  {productOnly
                    ? t("statusPill.product")
                    : isPast
                      ? t("statusPill.past")
                      : t("statusPill.upcoming")}
                  {a.status === "confirmed" && " ✓"}
                </span>
                <button
                  type="button"
                  className={`${pill} ${
                    paid
                      ? "bg-[var(--brand-soft)] text-emerald-700 dark:text-emerald-400"
                      : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                  onClick={() =>
                    setStatus({
                      appointmentId: a._id,
                      status: paid ? "scheduled" : "completed",
                    })
                  }
                >
                  {t("statusPill.paid")}
                </button>
                <button
                  type="button"
                  className={`${pill} ${
                    off
                      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                      : "border border-[var(--border)] text-[var(--muted)] hover:text-red-600 dark:hover:text-red-400"
                  }`}
                  onClick={() =>
                    setStatus({
                      appointmentId: a._id,
                      status: off
                        ? "scheduled"
                        : isPast && !productOnly
                          ? "no_show"
                          : "cancelled",
                    })
                  }
                >
                  {/* Always İptal, even when the stored status is no_show:
                      one word for "didn't happen" in every scenario, here and
                      on the revenue ledger alike. */}
                  {t("status.cancelled")}
                </button>
              </>
            );
          })()}
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
      {/* No "Appointments · 1 upcoming" heading. The cards under it are
          appointments and only the upcoming ones are drawn, so the line spent
          a row restating what was already on screen — and it was the only
          section label in this card, since First name / Phone / Contact fields
          below it get by on the fields themselves. */}
      <div className="flex items-center justify-end gap-2">
        {/* Outlined, not filled and not a bare link. A fill would make this
            history block compete with the page's real primary, and a blue link
            is indistinguishable from the "show history" toggle directly below
            it — which is a disclosure, not an action. Blue belongs to the
            toggles here; a box belongs to the actions. Nudge's + Add deal. */}
        {/* xs, the 28px the ⋯ beside it already is (RowMenu). It was 26px,
            a height its padding happened to add up to. */}
        <button
          type="button"
          onClick={onAdd}
          className={buttonClass("outline", "xs")}
        >
          + {t("appointments.addForCustomer")}
        </button>
        {menu}
      </div>

      {/* Nothing upcoming says nothing (Serdar, 2026-08-31): the empty state
          sentence restated what the absence of cards already shows, in the
          one card that had no other prose. Gated so an empty section spends
          no height either. */}
      {(appointments === undefined || upcoming.length > 0) && (
        <div className="mt-2 space-y-2">
          {appointments === undefined && (
            <p className="text-xs text-[var(--muted)]">{t("common.loading")}</p>
          )}
          {upcoming.map(card)}
        </div>
      )}

      {past.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowPast((prev) => !prev)}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            {showPast
              ? t("appointments.hidePast")
              : t("appointments.showPast", { n: past.length })}
          </button>
          {showPast && <div className="mt-1.5 space-y-2">{past.map(card)}</div>}
        </div>
      )}
    </div>
  );
}
