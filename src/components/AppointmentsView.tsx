"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [view, setView] = useState<"list" | "week">("list");
  const [weekOffset, setWeekOffset] = useState(0);

  // Two weeks back → six weeks forward covers the list AND every reachable
  // week-view page from one subscription.
  const range = useMemo(() => {
    const now = Date.now();
    return { fromMs: now - 14 * 86_400_000, toMs: now + 42 * 86_400_000 };
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
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-[var(--border)] text-sm">
            {(["list", "week"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setView(mode)}
                className={`px-3 py-1.5 ${
                  view === mode
                    ? "bg-[var(--muted-bg)] font-medium"
                    : "text-[var(--muted)]"
                }`}
              >
                {mode === "list" ? t("appointments.list") : t("appointments.week")}
              </button>
            ))}
          </div>
          <button
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)]"
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? t("common.cancel") : t("appointments.new")}
          </button>
        </div>
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

      {view === "week" && (
        <WeekGrid
          appointments={appointments ?? []}
          weekOffset={weekOffset}
          onWeekOffset={setWeekOffset}
          onOpenContact={onOpenContact}
        />
      )}

      {view === "list" &&
      byDay.map(([day, rows]) => (
        <section key={day} className="space-y-2">
          <h3 className="text-sm font-medium text-[var(--muted)]">
            {formatDayHeading(new Date(day).getTime(), language)}
          </h3>
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            {rows.map((appointment) => (
              <li
                key={appointment._id}
                className="group flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--row-hover-bg)]"
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
                <RowMenu
                  status={appointment.status}
                  onSetStatus={(status) =>
                    void setStatus({ appointmentId: appointment._id, status })
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show";

// Row actions live behind a hover-revealed ⋯ menu (Nudge convention: row
// actions show on hover only). Items are contextual verbs, never a repeat of
// the status pill's label.
function RowMenu({
  status,
  onSetStatus,
}: {
  status: AppointmentStatus;
  onSetStatus: (status: AppointmentStatus) => void;
}) {
  const { t } = useLanguage();
  // Portal + fixed positioning, measured at open time — an absolute child
  // would clip on the card's overflow-hidden (the InfoTip rule; see AGENTS.md).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!btnRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setPos(null);
      }
    };
    const onScroll = () => setPos(null); // fixed coords go stale on scroll
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = () => {
    if (open) return setPos(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const MENU_W = 224; // w-56
    setPos({
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
    });
  };

  const items: { key: string; label: string; status: AppointmentStatus; danger?: boolean }[] =
    status === "scheduled" || status === "confirmed"
      ? [
          { key: "complete", label: t("appointments.complete"), status: "completed" },
          { key: "noshow", label: t("appointments.noShow"), status: "no_show" },
          { key: "cancel", label: t("appointments.cancel"), status: "cancelled", danger: true },
        ]
      : [{ key: "reopen", label: t("appointments.reopen"), status: "scheduled" }];

  return (
    <>
      <button
        ref={btnRef}
        aria-label="Actions"
        onClick={toggle}
        className={`rounded-md px-1.5 py-0.5 text-[var(--muted)] transition-opacity hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] ${
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        ⋯
      </button>
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: 224 }}
            className="z-[100] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
          >
            {items.map((item) => (
              <button
                key={item.key}
                className={`flex w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted-bg)] ${
                  item.danger ? "text-red-600 dark:text-red-400" : ""
                }`}
                onClick={() => {
                  setPos(null);
                  onSetStatus(item.status);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

// Week view: 7 day columns, time-sorted chips. A VIEW of our data — cal.com
// stays the availability brain (spec §Phase D).
function WeekGrid({
  appointments,
  weekOffset,
  onWeekOffset,
  onOpenContact,
}: {
  appointments: {
    _id: string;
    customerId: Id<"customers">;
    startAt: number;
    status: string;
    customer: { firstName: string; lastName?: string } | null;
    serviceName?: string;
  }[];
  weekOffset: number;
  onWeekOffset: (next: number) => void;
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t, language } = useLanguage();
  const weekStart = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const day = (now.getDay() + 6) % 7; // Monday-start week
    return now.getTime() - day * 86_400_000 + weekOffset * 7 * 86_400_000;
  }, [weekOffset]);
  const days = [...Array(7)].map((_, i) => weekStart + i * 86_400_000);
  const todayKey = new Date().toDateString();

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          className="rounded-md border border-[var(--border)] px-2 py-1 text-sm"
          onClick={() => onWeekOffset(Math.max(-2, weekOffset - 1))}
        >
          ‹
        </button>
        <button
          className="rounded-md border border-[var(--border)] px-2 py-1 text-sm"
          onClick={() => onWeekOffset(0)}
        >
          {formatDayHeading(Date.now(), language)}
        </button>
        <button
          className="rounded-md border border-[var(--border)] px-2 py-1 text-sm"
          onClick={() => onWeekOffset(Math.min(5, weekOffset + 1))}
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
        {days.map((dayStart) => {
          const isToday = new Date(dayStart).toDateString() === todayKey;
          const dayRows = appointments
            .filter(
              (a) =>
                a.startAt >= dayStart &&
                a.startAt < dayStart + 86_400_000 &&
                a.status !== "cancelled",
            )
            .sort((a, b) => a.startAt - b.startAt);
          return (
            <div
              key={dayStart}
              className="min-h-40 border-r border-[var(--border)] p-1.5 last:border-r-0"
            >
              <p
                className={`mb-1 text-center text-xs ${
                  isToday ? "font-semibold" : "text-[var(--muted)]"
                }`}
              >
                {new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-GB", {
                  weekday: "short",
                  day: "numeric",
                }).format(new Date(dayStart))}
              </p>
              <div className="space-y-1">
                {dayRows.map((appointment) => (
                  <button
                    key={appointment._id}
                    onClick={() => onOpenContact(appointment.customerId)}
                    className="block w-full truncate rounded-md bg-[var(--brand-soft)] px-1.5 py-1 text-left text-[11px] leading-tight hover:opacity-80"
                    title={appointment.serviceName}
                  >
                    <span className="font-medium tabular-nums">
                      {formatTime(appointment.startAt, language)}
                    </span>{" "}
                    {appointment.customer?.firstName ?? "—"}
                  </button>
                ))}
                {dayRows.length === 0 && (
                  <p className="text-center text-[10px] text-[var(--muted)]">—</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
