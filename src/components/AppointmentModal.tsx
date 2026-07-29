"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import {
  currencySymbol,
  formatMoney,
  moneyInputValue,
  parseMoney,
} from "@/lib/money";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "@/lib/datetime";
import { PhoneInput } from "./PhoneField";
import type { Id } from "../../convex/_generated/dataModel";

// The appointment sheet, opened by clicking a slot or a block on the grid.
//
// Portalled to document.body with position:fixed, per the rule this codebase
// has broken most often: an absolutely positioned panel inside the calendar
// would be clipped by the grid's own scroll container the moment it opened.
// The modal also traps focus and closes on Escape, because the grid behind it
// is a field of buttons and tabbing into them would be a trap of its own.

export type ModalDraft = {
  appointmentId?: Id<"appointments">;
  startAt: number;
  durationMinutes: number;
  customerId?: Id<"customers">;
  customerName?: string;
  phone?: string;
  // The visit's line items. One entry per service delivered; prices are minor
  // units, absent when the line was never priced.
  lines?: { serviceId: Id<"services">; price?: number }[];
  staffId?: Id<"staff"> | null;
  notes?: string;
  status?: string;
};

export type ModalSubmit = {
  startAt: number;
  durationMinutes: number;
  customerId?: Id<"customers">;
  newCustomer?: { firstName: string; lastName?: string; phone: string; consent: boolean };
  lines: { serviceId: Id<"services">; price?: number }[];
  staffId?: Id<"staff"> | null;
  notes?: string;
};

export function AppointmentModal({
  draft,
  services,
  currency,
  staff,
  staffLabel,
  pending,
  error,
  canForce,
  onSubmit,
  onForce,
  onDelete,
  onClose,
  onOpenCustomer,
}: {
  draft: ModalDraft;
  services: {
    _id: Id<"services">;
    name: string;
    durationMinutes: number;
    price?: number;
  }[];
  currency: string;
  staff: { _id: Id<"staff">; name: string; active: boolean }[];
  staffLabel: string;
  pending: boolean;
  error?: string;
  canForce?: boolean;
  onSubmit: (values: ModalSubmit) => void;
  onForce: () => void;
  onDelete?: () => void;
  onClose: () => void;
  // Opening the record replaces this sheet rather than stacking on it: the
  // caller closes us first, so there is never a modal behind a modal.
  onOpenCustomer: (id: Id<"customers">) => void;
}) {
  const { t, language } = useLanguage();
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [startAt, setStartAt] = useState(draft.startAt);
  const [durationMinutes, setDurationMinutes] = useState(draft.durationMinutes);
  // Line rows, held as strings because that is what the inputs speak. An empty
  // list is a real state — a blocked-out hour with no service on it — so the
  // modal opens with no rows rather than one blank one begging to be filled.
  const [lines, setLines] = useState<{ serviceId: string; price: string }[]>(() =>
    (draft.lines ?? []).map((line) => ({
      serviceId: line.serviceId as string,
      price: moneyInputValue(line.price, currency, language),
    })),
  );
  const [staffId, setStaffId] = useState<string>(draft.staffId ?? "");
  const [notes, setNotes] = useState(draft.notes ?? "");

  const editing = draft.appointmentId !== undefined;

  // A booking whose customer is already decided: an edit, or the sheet opened
  // from somebody's contact record. The customer is a fact here, not a field,
  // so it renders as a link and the picker never appears.
  const customerFixed = draft.customerId !== undefined;

  // Existing or new, for the bookings where it is still open. "new" first
  // because the counter phone case is somebody standing there who has never
  // been here before; a regular is more often booked from their own record,
  // which takes the customerFixed path above and never sees this.
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [picked, setPicked] = useState<Id<"customers"> | undefined>();
  const [customerQuery, setCustomerQuery] = useState("");

  // Only fetched once the picker is actually on screen. A booking that creates
  // its customer never loads the org's contact list at all.
  const customerOptions = useQuery(
    api.customers.options,
    customerFixed || mode !== "existing" ? "skip" : {},
  );

  // Name first, then number, because somebody typing "534" is looking up a
  // phone and somebody typing "ker" is looking up a person. Capped at eight:
  // past that the list is a scrolling surface inside a modal, and the answer
  // is to type another letter.
  const customerMatches = useMemo(() => {
    const all = customerOptions ?? [];
    const needle = customerQuery.trim().toLocaleLowerCase();
    if (!needle) return all.slice(0, 8);
    return all
      .filter((c) => {
        const name = `${c.firstName} ${c.lastName ?? ""}`.toLocaleLowerCase();
        return name.includes(needle) || c.phone.includes(needle);
      })
      .slice(0, 8);
  }, [customerOptions, customerQuery]);

  // Save is off until the picker has an answer. The submit handler refuses
  // this case anyway, but a button that silently does nothing reads as broken.
  const customerIncomplete = !customerFixed && mode === "existing" && !picked;

  // Picking a service fills its list price and, on a NEW booking, restretches
  // the block to what the work adds up to. On an existing one it leaves the
  // length alone: a block drawn by hand meant that length on purpose, and
  // cal.com would have to agree to a new one anyway.
  const setLine = (index: number, serviceId: string) => {
    const picked = services.find((s) => s._id === serviceId);
    const next = lines.map((line, i) =>
      i === index
        ? {
            serviceId,
            price: moneyInputValue(picked?.price, currency, language),
          }
        : line,
    );
    setLines(next);
    if (editing) return;
    const minutes = next
      .map((line) => services.find((s) => s._id === line.serviceId)?.durationMinutes ?? 0)
      .reduce((sum, m) => sum + m, 0);
    if (minutes > 0) setDurationMinutes(minutes);
  };

  const priced = lines
    .map((line) => parseMoney(line.price, currency, language))
    .filter((p): p is number => p !== undefined);
  const total = priced.length ? priced.reduce((sum, p) => sum + p, 0) : undefined;

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  // Escape closes; Tab cycles inside the panel. Both on the panel rather than
  // the document so a second modal could never fight this one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // The new-customer fields are uncontrolled and read on submit, because
  // PhoneInput composes the dial code and the number itself — the same
  // component and the same contract the old inline form used.
  const submit = () => {
    const values: ModalSubmit = {
      startAt,
      durationMinutes,
      // Rows still on "—" are dropped rather than sent: an unfinished row is
      // someone mid-thought, not a line they meant to record.
      lines: lines
        .filter((line) => line.serviceId)
        .map((line) => {
          const price = parseMoney(line.price, currency, language);
          return {
            serviceId: line.serviceId as Id<"services">,
            ...(price !== undefined ? { price } : {}),
          };
        }),
      staffId: staffId ? (staffId as Id<"staff">) : null,
      notes,
    };
    if (draft.customerId) values.customerId = draft.customerId;
    else if (mode === "existing") {
      // No silent fallback to creating somebody: a picker with nothing picked
      // is an unfinished form, and guessing here is how you get a duplicate
      // contact named after a half-typed search.
      if (!picked) return;
      values.customerId = picked;
    } else {
      const form = formRef.current;
      if (!form) return;
      const data = new FormData(form);
      values.newCustomer = {
        firstName: String(data.get("firstName") ?? "").trim(),
        lastName: String(data.get("lastName") ?? "").trim() || undefined,
        phone: String(data.get("phone") ?? "").trim(),
        consent: data.get("consent") === "on",
      };
      if (!values.newCustomer.firstName || !values.newCustomer.phone) return;
    }
    onSubmit(values);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      // Backdrop click closes. mousedown, not click, so a drag that started
      // inside the panel and ended on the backdrop does not close it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? t("appointments.edit") : t("appointments.new")}
        // Full-width sheet on a phone, centred card above it. A salon owner
        // books from the counter phone more often than from a desk.
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl sm:rounded-2xl"
      >
        <h2 className="mb-3 text-sm font-semibold">
          {editing ? t("appointments.edit") : t("appointments.new")}
        </h2>

        <form ref={formRef} className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {draft.customerId ? (
            <div className="text-sm">
              <span className="text-[var(--muted)]">{t("appointments.customer")}: </span>
              {/* The name is the way to the record. Underlined because a link
                  that only reveals itself on hover is a link nobody finds —
                  and this is the one route from a booking to the person's
                  history, consent and contact details. */}
              <button
                type="button"
                onClick={() => onOpenCustomer(draft.customerId!)}
                className="font-medium underline underline-offset-2 transition-colors hover:text-[var(--accent)]"
              >
                {draft.customerName}
              </button>
            </div>
          ) : (
            <>
              {/* Existing or new, stated rather than inferred. The sheet used
                  to offer only the new-customer fields, so booking a regular
                  meant retyping somebody already on file and finding them
                  again by phone number afterwards. The backend always took
                  either (schedule.prepareCreate accepts customerId OR
                  newCustomer, and dedupes the latter by phone); this is the
                  half that was missing. */}
              <fieldset className="space-y-2">
                <legend className="text-xs text-[var(--muted)]">
                  {t("appointments.customer")}
                </legend>
                <div className="flex gap-4 text-sm">
                  {(["existing", "new"] as const).map((option) => (
                    <label key={option} className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="customerMode"
                        className="w-auto"
                        checked={mode === option}
                        onChange={() => setMode(option)}
                      />
                      <span>
                        {option === "existing"
                          ? t("appointments.existingCustomer")
                          : t("appointments.newCustomer")}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {mode === "existing" ? (
                <div className="space-y-2">
                  <label className="block text-xs text-[var(--muted)]" htmlFor="modal-customer">
                    {t("appointments.findCustomer")}
                    <input
                      id="modal-customer"
                      type="search"
                      autoComplete="off"
                      className="mt-1"
                      placeholder={t("appointments.findCustomerHint")}
                      value={customerQuery}
                      onChange={(e) => {
                        setCustomerQuery(e.target.value);
                        // Typing again abandons the previous pick. Leaving it
                        // set would let the sheet book a person whose name is
                        // no longer anywhere on screen.
                        if (picked) setPicked(undefined);
                      }}
                    />
                  </label>
                  {/* Radio rows, not a listbox: the choice is one of a handful
                      and it has to survive being read back before Save. */}
                  <ul className="max-h-44 overflow-y-auto rounded-lg border border-[var(--border)]">
                    {customerOptions === undefined ? (
                      <li className="px-3 py-2 text-xs text-[var(--muted)]">
                        {t("common.loading")}
                      </li>
                    ) : customerMatches.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-[var(--muted)]">
                        {t("customers.noMatches")}
                      </li>
                    ) : (
                      customerMatches.map((customer) => (
                        <li key={customer._id} className="border-b border-[var(--border)] last:border-b-0">
                          <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-[var(--row-hover-bg)]">
                            <input
                              type="radio"
                              name="existingCustomer"
                              className="w-auto"
                              checked={picked === customer._id}
                              onChange={() => setPicked(customer._id)}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {`${customer.firstName} ${customer.lastName ?? ""}`.trim()}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                              {customer.phone}
                            </span>
                          </label>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs text-[var(--muted)]">
                      {t("customers.firstName")}
                      <input ref={firstFieldRef} name="firstName" required className="mt-1" />
                    </label>
                    <label className="block text-xs text-[var(--muted)]">
                      {t("customers.lastName")}
                      <input name="lastName" className="mt-1" />
                    </label>
                  </div>
                  <label className="block text-xs text-[var(--muted)]" htmlFor="modal-phone">
                    {t("customers.phone")}
                    <PhoneInput id="modal-phone" name="phone" required className="mt-1" />
                  </label>
                  <label className="flex items-start gap-2 text-xs text-[var(--muted)]">
                    <input name="consent" type="checkbox" defaultChecked className="mt-1 w-auto" />
                    <span>{t("customers.consent")}</span>
                  </label>
                </>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-[var(--muted)]">
              {t("appointments.when")}
              <input
                type="datetime-local"
                className="mt-1"
                value={toDatetimeLocalValue(startAt)}
                onChange={(e) => {
                  const next = fromDatetimeLocalValue(e.target.value);
                  if (!Number.isNaN(next)) setStartAt(next);
                }}
              />
            </label>
            <label className="block text-xs text-[var(--muted)]">
              {t("appointments.duration")}
              <input
                type="number"
                min={5}
                step={5}
                className="mt-1"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value) || 5)}
              />
            </label>
          </div>

          {/* One row per service delivered. A cut plus a beard trim is one
              visit with two lines, not two bookings on top of each other. */}
          <div className="space-y-1.5">
            <span className="block text-xs text-[var(--muted)]">
              {t("appointments.service")}
            </span>
            {lines.map((line, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  className="min-w-0 flex-1"
                  value={line.serviceId}
                  onChange={(e) => setLine(index, e.target.value)}
                >
                  <option value="">—</option>
                  {services.map((service) => (
                    <option key={service._id} value={service._id}>
                      {service.name}
                    </option>
                  ))}
                </select>
                {/* Prefilled from the service, editable on the spot. Typing a
                    different number IS the discount — there is no override
                    toggle, because the field already permits the edit. */}
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-24 shrink-0"
                  value={line.price}
                  placeholder={currencySymbol(currency, language)}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, i) =>
                        i === index ? { ...l, price: e.target.value } : l,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={t("common.delete")}
                  onClick={() =>
                    setLines((prev) => prev.filter((_, i) => i !== index))
                  }
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-red-600 dark:hover:text-red-400"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, { serviceId: "", price: "" }])}
                className="rounded-md py-1 text-xs text-[var(--accent)] hover:underline"
              >
                {t("appointments.addService")}
              </button>
              {/* The total is the sum and only the sum, so it can never
                  disagree with the lines above it. */}
              {total !== undefined && (
                <span className="ml-auto text-sm font-medium tabular-nums">
                  {formatMoney(total, currency, language)}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-[var(--muted)]">
              {staffLabel}
              <select
                className="mt-1"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              >
                <option value="">—</option>
                {staff
                  .filter((person) => person.active || person._id === draft.staffId)
                  .map((person) => (
                    <option key={person._id} value={person._id}>
                      {person.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <label className="block text-xs text-[var(--muted)]">
            {t("appointments.notes")}
            <textarea
              rows={2}
              className="mt-1"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {/* Enter submits, which is what a booking form should do. */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>

        {error && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            <p>{error}</p>
            {/* cal.com refused for a reason the owner is entitled to overrule —
                the chair is double-booked, or it is outside the hours cal.com
                knows about. Offered only when that is what happened. */}
            {canForce && (
              <button
                type="button"
                onClick={onForce}
                disabled={pending}
                className="mt-2 rounded-lg px-2 py-1 font-medium text-amber-900 underline underline-offset-2 dark:text-amber-200"
              >
                {t("appointments.bookAnyway")}
              </button>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-red-600"
            >
              {t("appointments.cancelAppointment")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || customerIncomplete}
              className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
