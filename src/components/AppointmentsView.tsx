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

type ViewMode = "day" | "week" | "list";

const VIEW_MODES: { id: ViewMode; key: TranslationKey }[] = [
  { id: "day", key: "appointments.day" },
  { id: "week", key: "appointments.week" },
  { id: "list", key: "appointments.list" },
];

export function AppointmentsView({
  onOpenContact,
}: {
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t, language } = useLanguage();
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<ViewMode>("week");
  // The day the calendar is looking at. Day view steps it by one, week view
  // by seven, so one piece of state serves both.
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));

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
    <div
      className={
        view === "list" ? "space-y-4" : "flex h-full min-h-0 flex-col gap-4"
      }
    >
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {/* Segmented control, not loose pills: three views of one thing read
            as one control. Selected sits on --background so it stays visible
            against the track in dark mode. */}
        <div className="inline-flex rounded-lg bg-[var(--muted-bg)] p-0.5 text-sm">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setView(mode.id)}
              aria-current={view === mode.id ? "page" : undefined}
              className={`rounded-md px-3 py-1 transition-colors ${
                view === mode.id
                  ? "bg-[var(--background)] font-medium text-[var(--foreground)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {t(mode.key)}
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
      {appointments?.length === 0 && view === "list" && (
        <p className="text-sm text-[var(--muted)]">{t("appointments.none")}</p>
      )}

      {view !== "list" && appointments !== undefined && (
        <Calendar
          appointments={appointments}
          view={view}
          anchor={anchor}
          onAnchor={setAnchor}
          onOpenContact={onOpenContact}
        />
      )}

      {view === "list" &&
      byDay.map(([day, rows]) => (
        <section key={day} className="space-y-1">
          <h3 className="text-sm font-medium text-[var(--muted)]">
            {formatDayHeading(new Date(day).getTime(), language)}
          </h3>
          {/* Flat rows on hairlines. No card per day, no border per row. */}
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((appointment) => (
              <li
                key={appointment._id}
                className="group flex flex-wrap items-center gap-3 rounded-md px-2 py-3 text-sm hover:bg-[var(--row-hover-bg)]"
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
                      : ""}
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

// ---- Calendar (day + week) ----
//
// A real time grid, not a bucket list: hours run down the left, days across
// the top, and every appointment is placed by its start time and sized by its
// duration. Concurrent bookings (a salon runs several chairs at once) split
// the column between them rather than stacking, which is the whole reason the
// bucket version read as broken.
//
// It is a VIEW of our appointments table. cal.com stays the availability
// brain (spec, Phase D), so nothing here writes a slot.

const HOUR_PX = 56; // one hour of column height; a 30-min booking is 28px
const DEFAULT_DAY_START = 8;
const DEFAULT_DAY_END = 21;
const DEFAULT_DURATION = 30;
const DAY_MS = 86_400_000;

type CalendarAppointment = {
  _id: string;
  customerId: Id<"customers">;
  startAt: number;
  durationMinutes?: number;
  status: string;
  staffName?: string;
  customer: { firstName: string; lastName?: string } | null;
  serviceName?: string;
};

// Fill per status. No left accent bars: the fill carries the state, and a
// cancelled or missed booking should read quieter than a live one.
const BLOCK_STYLE: Record<string, string> = {
  // Booked but unconfirmed reads lighter than confirmed, so a glance down the
  // week shows who has answered.
  scheduled: "bg-[var(--brand-soft)] text-[var(--foreground)]",
  confirmed:
    "bg-[color-mix(in_srgb,var(--brand)_26%,var(--card))] text-[var(--foreground)]",
  completed: "bg-[var(--muted-bg)] text-[var(--muted)]",
  no_show: "bg-red-500/10 text-red-700 dark:text-red-400",
};

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  return d.getTime() - ((d.getDay() + 6) % 7) * DAY_MS; // Monday-start
}

function minutesInto(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

// Side-by-side placement for bookings that overlap in time. Rows are grouped
// into clusters of mutually overlapping appointments, and each cluster is
// split into as many lanes as it needs.
function laneOut(rows: CalendarAppointment[]) {
  const sorted = [...rows].sort((a, b) => a.startAt - b.startAt);
  const placed: { row: CalendarAppointment; lane: number; lanes: number }[] = [];
  let cluster: { row: CalendarAppointment; lane: number }[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const lanes = cluster.reduce((max, item) => Math.max(max, item.lane + 1), 0);
    for (const item of cluster) placed.push({ ...item, lanes });
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const row of sorted) {
    const end = row.startAt + (row.durationMinutes ?? DEFAULT_DURATION) * 60_000;
    if (row.startAt >= clusterEnd) flush();
    // First lane whose last booking has already finished.
    const laneEnds: number[] = [];
    for (const item of cluster) {
      const itemEnd =
        item.row.startAt + (item.row.durationMinutes ?? DEFAULT_DURATION) * 60_000;
      laneEnds[item.lane] = Math.max(laneEnds[item.lane] ?? 0, itemEnd);
    }
    let lane = 0;
    while ((laneEnds[lane] ?? 0) > row.startAt) lane++;
    cluster.push({ row, lane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return placed;
}

function Calendar({
  appointments,
  view,
  anchor,
  onAnchor,
  onOpenContact,
}: {
  appointments: CalendarAppointment[];
  view: "day" | "week";
  anchor: number;
  onAnchor: (next: number) => void;
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t, language } = useLanguage();
  const locale = language === "tr" ? "tr-TR" : "en-GB";
  const scrollRef = useRef<HTMLDivElement>(null);

  const days = useMemo(
    () =>
      view === "day"
        ? [startOfDay(anchor)]
        : [...Array(7)].map((_, i) => startOfWeek(anchor) + i * DAY_MS),
    [view, anchor],
  );

  const visible = useMemo(() => {
    const from = days[0];
    const to = days[days.length - 1] + DAY_MS;
    return appointments.filter(
      (a) => a.startAt >= from && a.startAt < to && a.status !== "cancelled",
    );
  }, [appointments, days]);

  // The grid opens on the working day and stretches only for bookings that
  // fall outside it, so an 08:00 salon never scrolls past six empty hours.
  const [dayStart, dayEnd] = useMemo(() => {
    let first = DEFAULT_DAY_START;
    let last = DEFAULT_DAY_END;
    for (const a of visible) {
      const start = Math.floor(minutesInto(a.startAt) / 60);
      const end = Math.ceil(
        (minutesInto(a.startAt) + (a.durationMinutes ?? DEFAULT_DURATION)) / 60,
      );
      first = Math.min(first, start);
      last = Math.max(last, end);
    }
    return [Math.max(0, first), Math.min(24, Math.max(last, first + 1))];
  }, [visible]);

  const hours = [...Array(dayEnd - dayStart)].map((_, i) => dayStart + i);
  const gridHeight = hours.length * HOUR_PX;

  // Now-line, re-read every minute. Absolutely positioned, so nothing shifts.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Land on the first booking of the period (or the top of the working day)
  // instead of wherever the scroll happened to sit.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const earliest = visible.reduce(
      (min, a) => Math.min(min, minutesInto(a.startAt)),
      DEFAULT_DAY_START * 60,
    );
    container.scrollTop = Math.max(0, ((earliest - dayStart * 60) / 60) * HOUR_PX - HOUR_PX / 2);
    // Only when the period or the range changes, never on every render.
  }, [days[0], dayStart, visible.length]);

  const step = view === "day" ? 1 : 7;
  const heading =
    view === "day"
      ? formatDayHeading(days[0], language)
      : `${new Intl.DateTimeFormat(locale, { day: "numeric" }).format(new Date(days[0]))}-${new Intl.DateTimeFormat(
          locale,
          { day: "numeric", month: "long" },
        ).format(new Date(days[6]))}`;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-1">
        <button
          aria-label={t("appointments.previous")}
          className="rounded-md px-2 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          onClick={() => onAnchor(anchor - step * DAY_MS)}
        >
          <ChevronLeft />
        </button>
        <button
          aria-label={t("appointments.next")}
          className="rounded-md px-2 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          onClick={() => onAnchor(anchor + step * DAY_MS)}
        >
          <ChevronRight />
        </button>
        <h3 className="ml-1 text-sm font-medium">{heading}</h3>
        <button
          className="ml-auto rounded-md px-2.5 py-1 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          onClick={() => onAnchor(startOfDay(Date.now()))}
        >
          {t("appointments.today")}
        </button>
      </div>

      {/* Day headers stay put while the hours scroll under them. */}
      <div className="flex pr-[10px]">
        <div className="w-12 shrink-0" />
        {days.map((day) => {
          const isToday = startOfDay(now) === day;
          return (
            <div key={day} className="min-w-0 flex-1 pb-2 text-center">
              <div className="text-xs text-[var(--muted)]">
                {new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(day))}
              </div>
              <div
                className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-sm tabular-nums ${
                  isToday
                    ? "bg-[var(--brand)] font-semibold text-white"
                    : "text-[var(--foreground)]"
                }`}
              >
                {new Date(day).getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: gridHeight }}>
          {/* Hour gutter. Labels sit ON their line, so they read as the moment
              the line marks rather than as a band. */}
          <div className="relative w-12 shrink-0">
            {hours.map((hour, i) => (
              <span
                key={hour}
                // The first label would be half cut by the top edge, so it
                // hangs below its line instead of centring on it.
                className={`absolute right-2 text-[11px] tabular-nums text-[var(--muted)] ${
                  i === 0 ? "" : "-translate-y-1/2"
                }`}
                style={{ top: i * HOUR_PX }}
              >
                {`${String(hour).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const rows = visible.filter(
              (a) => a.startAt >= day && a.startAt < day + DAY_MS,
            );
            const showNow = startOfDay(now) === day;
            return (
              <div
                key={day}
                className={`relative min-w-0 flex-1 ${
                  dayIndex > 0 ? "border-l border-[var(--border)]" : ""
                }`}
                // Hour rules as a background gradient: one hairline per hour
                // without a div per row.
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px var(--hour))",
                  ["--hour" as string]: `${HOUR_PX}px`,
                }}
              >
                {laneOut(rows).map(({ row, lane, lanes }) => {
                  const top =
                    ((minutesInto(row.startAt) - dayStart * 60) / 60) * HOUR_PX;
                  const height = Math.max(
                    ((row.durationMinutes ?? DEFAULT_DURATION) / 60) * HOUR_PX - 2,
                    20,
                  );
                  const name = row.customer
                    ? `${row.customer.firstName} ${row.customer.lastName ?? ""}`.trim()
                    : "";
                  return (
                    <button
                      key={row._id}
                      onClick={() => onOpenContact(row.customerId)}
                      title={[name, row.serviceName, row.staffName]
                        .filter(Boolean)
                        .join(" · ")}
                      style={{
                        top,
                        height,
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                      }}
                      className={`absolute overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight transition-opacity hover:opacity-80 ${
                        BLOCK_STYLE[row.status] ?? BLOCK_STYLE.scheduled
                      }`}
                    >
                      {/* A half-hour block is one line tall, so the time and
                          the name share it rather than clipping. */}
                      {height < 40 ? (
                        <span className="block truncate">
                          <span className="font-medium tabular-nums">
                            {formatTime(row.startAt, language)}
                          </span>{" "}
                          {name}
                        </span>
                      ) : (
                        <>
                          <span className="block truncate font-medium tabular-nums">
                            {formatTime(row.startAt, language)}
                          </span>
                          <span className="block truncate">{name}</span>
                          {height > 60 && row.serviceName && (
                            <span className="block truncate opacity-70">
                              {row.serviceName}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
                {showNow && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 border-t border-[var(--brand)]"
                    style={{ top: ((minutesInto(now) - dayStart * 60) / 60) * HOUR_PX }}
                  >
                    <span className="absolute -left-0.5 -top-[3px] h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
