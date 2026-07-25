"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/LanguageProvider";
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
  serviceId?: Id<"services"> | null;
  staffId?: Id<"staff"> | null;
  notes?: string;
  status?: string;
};

export type ModalSubmit = {
  startAt: number;
  durationMinutes: number;
  customerId?: Id<"customers">;
  newCustomer?: { firstName: string; lastName?: string; phone: string; consent: boolean };
  serviceId?: Id<"services"> | null;
  staffId?: Id<"staff"> | null;
  notes?: string;
};

export function AppointmentModal({
  draft,
  services,
  staff,
  staffLabel,
  pending,
  error,
  canForce,
  onSubmit,
  onForce,
  onDelete,
  onClose,
}: {
  draft: ModalDraft;
  services: { _id: Id<"services">; name: string; durationMinutes: number }[];
  staff: { _id: Id<"staff">; name: string; active: boolean }[];
  staffLabel: string;
  pending: boolean;
  error?: string;
  canForce?: boolean;
  onSubmit: (values: ModalSubmit) => void;
  onForce: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [startAt, setStartAt] = useState(draft.startAt);
  const [durationMinutes, setDurationMinutes] = useState(draft.durationMinutes);
  const [serviceId, setServiceId] = useState<string>(draft.serviceId ?? "");
  const [staffId, setStaffId] = useState<string>(draft.staffId ?? "");
  const [notes, setNotes] = useState(draft.notes ?? "");

  const editing = draft.appointmentId !== undefined;

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
      serviceId: serviceId ? (serviceId as Id<"services">) : null,
      staffId: staffId ? (staffId as Id<"staff">) : null,
      notes,
    };
    if (draft.customerId) values.customerId = draft.customerId;
    else {
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
              <span className="font-medium">{draft.customerName}</span>
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

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-[var(--muted)]">
              {t("appointments.service")}
              <select
                className="mt-1"
                value={serviceId}
                onChange={(e) => {
                  setServiceId(e.target.value);
                  // Picking a service offers its length — it does not force it,
                  // because a block drawn by hand meant that length on purpose.
                  const picked = services.find((s) => s._id === e.target.value);
                  if (picked && !editing) setDurationMinutes(picked.durationMinutes);
                }}
              >
                <option value="">—</option>
                {services.map((service) => (
                  <option key={service._id} value={service._id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
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
              disabled={pending}
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
