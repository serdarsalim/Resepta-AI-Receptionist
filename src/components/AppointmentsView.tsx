"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import {
  formatDayHeading,
  formatTime,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/lib/datetime";

const STATUS_KEY: Record<string, TranslationKey> = {
  scheduled: "status.scheduled",
  confirmed: "status.confirmed",
  cancelled: "status.cancelled",
  completed: "status.completed",
  no_show: "status.no_show",
};

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-[var(--border)] text-[var(--foreground)]",
  confirmed: "bg-[var(--brand-soft)] text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-transparent text-[var(--muted)] line-through",
  completed: "bg-[var(--border)] text-[var(--muted)]",
  no_show: "bg-transparent text-red-600 dark:text-red-400",
};

export function AppointmentsView({
  onOpenContact,
}: {
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t, language } = useLanguage();
  const [adding, setAdding] = useState(false);

  // Yesterday → +30 days: the window a salon actually looks at.
  const range = useMemo(() => {
    const now = Date.now();
    return { fromMs: now - 86_400_000, toMs: now + 30 * 86_400_000 };
  }, []);
  const appointments = useQuery(api.appointments.listRange, range);
  const services = useQuery(api.services.list, {});
  const create = useMutation(api.appointments.create);
  const setStatus = useMutation(api.appointments.setStatus);

  type Appointment = NonNullable<typeof appointments>[number];
  const byDay = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    for (const appointment of appointments ?? []) {
      const day = new Date(appointment.startAt).toDateString();
      const bucket = groups.get(day) ?? [];
      bucket.push(appointment);
      groups.set(day, bucket);
    }
    return [...groups.entries()].sort(
      (a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime(),
    );
  }, [appointments]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">{t("appointments.title")}</h2>
        <button
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)]"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? t("common.cancel") : t("appointments.new")}
        </button>
      </div>

      {adding && (
        <form
          className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const serviceId = String(form.get("serviceId") ?? "");
            await create({
              newCustomer: {
                firstName: String(form.get("firstName") ?? ""),
                lastName: String(form.get("lastName") ?? "") || undefined,
                phone: String(form.get("phone") ?? ""),
                consent: form.get("consent") === "on",
              },
              serviceId: serviceId ? (serviceId as Id<"services">) : undefined,
              startAt: fromDatetimeLocalValue(String(form.get("startAt") ?? "")),
              staffName: String(form.get("staffName") ?? "") || undefined,
            });
            setAdding(false);
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
          <label className="text-sm">
            {t("appointments.when")}
            <input
              name="startAt"
              type="datetime-local"
              required
              defaultValue={toDatetimeLocalValue(Date.now() + 3600_000)}
              className="mt-1"
            />
          </label>
          <label className="text-sm">
            {t("appointments.service")}
            <select name="serviceId" className="mt-1">
              <option value="">—</option>
              {(services ?? [])
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            {t("appointments.staff")}
            <input name="staffName" className="mt-1" />
          </label>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input name="consent" type="checkbox" defaultChecked className="mt-1 w-auto" />
            <span>
              {t("customers.consent")}
              <span className="block text-xs text-[var(--muted)]">
                {t("customers.consentHint")}
              </span>
            </span>
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
            >
              {t("common.add")}
            </button>
          </div>
        </form>
      )}

      {appointments === undefined && (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      )}
      {appointments?.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{t("appointments.none")}</p>
      )}

      {byDay.map(([day, rows]) => (
        <section key={day} className="space-y-2">
          <h3 className="text-sm font-medium text-[var(--muted)]">
            {formatDayHeading(new Date(day).getTime(), language)}
          </h3>
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            {rows.map((appointment) => (
              <li
                key={appointment._id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="w-12 font-medium tabular-nums">
                  {formatTime(appointment.startAt, language)}
                </span>
                <span className="min-w-0 flex-1">
                  <button
                    className="block max-w-full truncate text-left font-medium hover:underline"
                    onClick={() => onOpenContact(appointment.customerId)}
                  >
                    {appointment.customer
                      ? `${appointment.customer.firstName} ${appointment.customer.lastName ?? ""}`.trim()
                      : "—"}
                  </button>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {[
                      appointment.serviceName,
                      appointment.staffName,
                      appointment.customer?.phone,
                      appointment.source === "calcom" ? "cal.com" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {appointment.customer && !appointment.customer.consented && (
                  <span className="rounded-full px-2 py-0.5 text-xs text-red-600 dark:text-red-400">
                    {t("customers.noConsent")}
                  </span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[appointment.status]}`}
                >
                  {t(STATUS_KEY[appointment.status])}
                </span>
                {appointment.status !== "cancelled" && (
                  <span className="flex gap-2">
                    <button
                      className="text-xs text-[var(--muted)] underline"
                      onClick={() =>
                        void setStatus({
                          appointmentId: appointment._id,
                          status: "completed",
                        })
                      }
                    >
                      {t("appointments.complete")}
                    </button>
                    <button
                      className="text-xs text-red-600 dark:text-red-400 underline"
                      onClick={() =>
                        void setStatus({
                          appointmentId: appointment._id,
                          status: "cancelled",
                        })
                      }
                    >
                      {t("appointments.cancel")}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
