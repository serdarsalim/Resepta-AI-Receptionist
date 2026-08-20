"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { useHeaderSearch } from "@/lib/HeaderSearch";
import type { TranslationKey } from "@/lib/i18n";
import {
  addLocalDays,
  formatDayHeading,
  formatTime,
  localeFor,
  startOfLocalDay,
  startOfLocalWeek,
} from "@/lib/datetime";
import {
  DEFAULT_DURATION,
  advanceDrag,
  columnIndexAt,
  dragResult,
  minuteAt,
  type DragGeometry,
} from "@/lib/calendarDrag";
import {
  getLocalPartsSafe,
  localWallTimeToUtcMs,
} from "../../convex/lib/businessHours";
import { MonthGrid, addMonths, startOfMonth } from "./MonthGrid";
import { YearGrid, addYears, startOfYear } from "./YearGrid";
import { useBookingSheet } from "./useBookingSheet";
import type { Rect } from "@/lib/anchoredSheet";

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

type ViewMode = "day" | "week" | "month" | "year" | "list";

// A slot the sheet is currently open against: which day, and the minutes it
// spans. Kept in calendar terms rather than pixels so it survives a scroll or
// a resize, and the band is redrawn from it rather than frozen where it was.
type SlotBand = { day: number; startMinute: number; endMinute: number };

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

const VIEW_MODES: { id: ViewMode; key: TranslationKey }[] = [
  { id: "day", key: "appointments.day" },
  { id: "week", key: "appointments.week" },
  { id: "month", key: "appointments.month" },
  { id: "year", key: "appointments.year" },
  { id: "list", key: "appointments.list" },
];

// The letter that switches to each view, shown in the menu and bound on the
// document. Shown BECAUSE it is bound: a hint next to a shortcut that does
// nothing is worse than no hint.
const VIEW_KEY: Record<ViewMode, string> = {
  day: "D",
  week: "W",
  month: "M",
  year: "Y",
  list: "L",
};

export function AppointmentsView({
  onOpenContact,
}: {
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t, language } = useLanguage();
  const [view, setView] = useState<ViewMode>("week");
  // The day the calendar is looking at. Day view steps it by one, week view
  // by seven, so one piece of state serves both.
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
  // Search is offered on every view, but only the LIST can answer it: filtering
  // a week grid by name would punch holes in a layout whose whole job is
  // showing the shape of the week. So typing switches you to the view that can
  // show results, rather than the box going missing on two views out of three
  // and leaving you to work out why.
  const search = useHeaderSearch(t("common.search"));
  useEffect(() => {
    if (search.active && view !== "list") setView("list");
  }, [search.active, view]);

  // The window follows what you are LOOKING at, not what time it is now.
  //
  // It used to be a fixed two-weeks-back to six-weeks-forward around page load,
  // which meant paging the week view past six weeks out showed an empty grid:
  // not "no bookings that week", but a query that never asked. A salon taking
  // bookings two months ahead hits that on an ordinary Tuesday.
  //
  // Padded a fortnight either side of the visible period so stepping one page
  // usually lands inside what is already subscribed, and the grid does not
  // blank between pages.
  const range = useMemo(() => {
    const pad = 14 * DAY_MS;
    // The month grid draws six weeks starting from the Monday on or before the
    // first, so the window is that, not the calendar month.
    const from =
      view === "month"
        ? startOfWeek(startOfMonth(anchor))
        : view === "week"
          ? startOfWeek(anchor)
          : startOfDay(anchor);
    const span =
      view === "month" ? 42 * DAY_MS : view === "week" ? 7 * DAY_MS : DAY_MS;
    // The list is a rolling read of what is coming, so it stays keyed to now
    // rather than to a day nobody navigated to.
    if (view === "list") {
      const now = Date.now();
      return { fromMs: now - pad, toMs: now + 42 * DAY_MS };
    }
    return { fromMs: from - pad, toMs: from + span + pad };
  }, [anchor, view]);
  const appointments = useQuery(api.appointments.listRange, range);
  // Start times for the whole year, only while the year is being looked at.
  const yearStarts = useQuery(
    api.appointments.startsInRange,
    view === "year"
      ? { fromMs: startOfYear(anchor), toMs: addYears(startOfYear(anchor), 1) }
      : "skip",
  );
  // Bucketed to local midnight here rather than on the server, because "which
  // day" is a question about the reader's clock.
  const bookedDays = useMemo(
    () => new Set((yearStarts ?? []).map((ms) => startOfDay(ms))),
    [yearStarts],
  );
  const settings = useQuery(api.orgs.current, {});
  const setStatus = useMutation(api.appointments.setStatus);
  // An action, not a mutation: a move has to hear back from cal.com before our
  // own row moves. See convex/schedule.ts. Held here as well as in the booking
  // sheet because a DRAG moves a block without ever opening the sheet.
  const moveBooking = useAction(api.schedule.move);

  // The sheet owns its own state and every call behind Save; this view only
  // says when it opens and with what.
  const booking = useBookingSheet({ onOpenContact });

  // Optimistic positions, keyed by appointment. A drag paints here first and
  // the entry is dropped the moment the server agrees (the query row catches
  // up) or refuses (the block snaps back to where it was).
  const [optimistic, setOptimistic] = useState<
    Map<string, { startAt: number; durationMinutes: number }>
  >(new Map());
  const [moveError, setMoveError] = useState<string | undefined>();
  // The slot the open sheet was drawn against. Cleared the moment the sheet
  // goes, so a dismissed booking leaves no ghost band behind on the grid.
  const [provisional, setProvisional] = useState<SlotBand | null>(null);
  useEffect(() => {
    if (!booking.isOpen) setProvisional(null);
  }, [booking.isOpen]);

  // D / W / M / Y / L switch views, T jumps to today. Bound because the menu
  // PRINTS these letters: a hint beside a shortcut that does nothing is worse
  // than no hint at all.
  //
  // Skipped while typing, and while the booking sheet is open. Otherwise
  // entering "Wednesday" in a note would walk the calendar through four views,
  // and a customer named Deniz would jump you to the day grid on the D.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (booking.isOpen) return;
      const el = event.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
      ) {
        return;
      }
      const key = event.key.toUpperCase();
      if (key === "T") {
        setAnchor(startOfDay(Date.now()));
        return;
      }
      const mode = VIEW_MODES.find((entry) => VIEW_KEY[entry.id] === key);
      if (mode) setView(mode.id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [booking.isOpen]);

  const heading = useMemo(() => {
    const locale = localeFor(language);
    const day = (ms: number) =>
      new Intl.DateTimeFormat(locale, { day: "numeric" }).format(new Date(ms));
    switch (view) {
      case "day":
        return formatDayHeading(anchor, language);
      case "week": {
        const from = startOfWeek(anchor);
        const to = from + 6 * DAY_MS;
        // Only the closing date carries the month: "27-2 August" reads as one
        // span, where naming both months twice would read as two.
        return `${day(from)}-${new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "long",
        }).format(new Date(to))}`;
      }
      case "month":
        return new Intl.DateTimeFormat(locale, {
          month: "long",
          year: "numeric",
        }).format(new Date(anchor));
      case "year":
        return String(new Date(anchor).getFullYear());
      case "list":
        return "";
    }
  }, [view, anchor, language]);

  // A step is a different distance in every view, and in two of them it is not
  // a fixed number of days at all: months and years have to be walked by the
  // calendar, not by arithmetic.
  const stepPeriod = (direction: 1 | -1) => {
    if (view === "month") return setAnchor(addMonths(anchor, direction));
    if (view === "year") return setAnchor(addYears(anchor, direction));
    setAnchor(anchor + direction * (view === "day" ? 1 : 7) * DAY_MS);
  };

  const clearOptimistic = (id: string) =>
    setOptimistic((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });

  type Appointment = NonNullable<typeof appointments>[number];

  // One place where the pending drag is layered over the server's answer, so
  // the grid and the list can never disagree about where a block is.
  const withOptimistic = useMemo(
    () =>
      (appointments ?? []).map((appointment) => {
        const pendingMove = optimistic.get(appointment._id);
        return pendingMove ? { ...appointment, ...pendingMove } : appointment;
      }),
    [appointments, optimistic],
  );
  const byDay = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    for (const appointment of appointments ?? []) {
      const customer = appointment.customer;
      const matches = search.matches(
        customer ? `${customer.firstName} ${customer.lastName ?? ""}` : "",
        customer?.phone,
        appointment.serviceName,
        appointment.staffName,
      );
      if (!matches) continue;
      const day = new Date(appointment.startAt).toDateString();
      const bucket = groups.get(day) ?? [];
      bucket.push(appointment);
      groups.set(day, bucket);
    }
    return [...groups.entries()].sort(
      (a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime(),
    );
  }, [appointments, search]);

  return (
    // data-fills-pane only in the grid views. The list PAGE-scrolls and its
    // content ends, so it keeps the shell's bottom padding; the grids scroll
    // inside themselves and take the phone's bottom edge. See AppShell's main.
    <div
      data-fills-pane={view === "list" ? undefined : ""}
      className={
        view === "list" ? "space-y-4" : "flex h-full min-h-0 flex-col gap-4"
      }
    >
      {/* One row: which view, where in it, and the way out. The period nav
          used to sit on its own line inside each view, which cost a whole row
          of grid to show two arrows and a date — on the screen where vertical
          space IS the product, since every pixel here is a bookable minute.
          Lifted out, it also stops each view carrying its own copy. */}
      {/* Google's header order: Today pill on the left, then the arrows and
          the period, and the view picker as a matching pill on the right.
          Today is always offered — an outlined pill that sometimes vanished
          made the row twitch, and pressing it while already on today costs
          nothing.

          No "new appointment" button: the grid is the button. Click or drag
          any slot, or any month cell, exactly where the booking goes — a
          toolbar button that opened on "the next round hour" was a worse
          version of every click the calendar already takes, and the owner
          never used Google's either.

          "Edit hours" used to sit here too; it read as misfiled next to the
          controls that act on this view. Hours live in Business → Hours. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {view !== "list" && (
          <>
            <button
              className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--muted-bg)]"
              onClick={() => setAnchor(startOfDay(Date.now()))}
            >
              {t("appointments.today")}
            </button>
            <button
              aria-label={t("appointments.previous")}
              className="rounded-md px-1.5 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              onClick={() => stepPeriod(-1)}
            >
              <ChevronLeft />
            </button>
            <button
              aria-label={t("appointments.next")}
              className="rounded-md px-1.5 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              onClick={() => stepPeriod(1)}
            >
              <ChevronRight />
            </button>
            <h3 className="ml-1 text-sm font-medium">{heading}</h3>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ViewMenu view={view} onView={setView} />
        </div>
      </div>

      {appointments?.length === 0 && view === "list" && (
        <p className="text-sm text-[var(--muted)]">{t("appointments.none")}</p>
      )}

      {view === "month" && appointments !== undefined && (
        <MonthGrid
          anchor={anchor}
          rows={withOptimistic}
          businessHours={settings?.org.businessHours}
          onOpenDay={(dayMs) => {
            setAnchor(dayMs);
            setView("day");
          }}
          onDraftDay={(dayMs) => {
            // A month cell has no minute in it. Opening on the next round hour
            // would be today's clock applied to a day in November; the working
            // morning is the honest default for a day nobody has named a time
            // in yet.
            booking.open({
              startAt: dayMs + DEFAULT_DAY_START * 3_600_000,
              durationMinutes: DEFAULT_DURATION,
            });
          }}
          onOpenBlock={(id, anchorRect) => {
            const row = withOptimistic.find((r) => r._id === id);
            if (!row) return;
            booking.open(
              {
                appointmentId: row._id,
                startAt: row.startAt,
                durationMinutes: row.durationMinutes ?? DEFAULT_DURATION,
                customerId: row.customerId,
                customerName: row.customer
                  ? `${row.customer.firstName} ${row.customer.lastName ?? ""}`.trim()
                  : undefined,
                lines: (row.items ?? []).flatMap((item) =>
                  item.serviceId
                    ? [{ serviceId: item.serviceId, price: item.price, quantity: item.quantity }]
                    : [],
                ),
                staffId: row.staffId ?? null,
                notes: row.notes,
                status: row.status,
              },
              anchorRect,
            );
          }}
        />
      )}

      {view === "year" && (
        <YearGrid
          anchor={anchor}
          bookedDays={bookedDays}
          onOpenDay={(dayMs) => {
            setAnchor(dayMs);
            setView("day");
          }}
          onOpenMonth={(monthMs) => {
            setAnchor(monthMs);
            setView("month");
          }}
        />
      )}

      {view !== "list" && view !== "month" && view !== "year" && appointments !== undefined && (
        <Calendar
          appointments={withOptimistic}
          view={view}
          anchor={anchor}
          businessHours={settings?.org.businessHours}
          timezone={settings?.org.timezone}
          provisional={provisional}
          onOpenBlock={(row, anchor) => {
            booking.open({
              appointmentId: row._id,
              startAt: row.startAt,
              durationMinutes: row.durationMinutes ?? 30,
              customerId: row.customerId,
              customerName: row.customer
                ? `${row.customer.firstName} ${row.customer.lastName ?? ""}`.trim()
                : undefined,
              // Snapshotted lines, not ids resolved fresh: the sheet has to
              // show what this visit recorded, not what the service costs now.
              lines: (row.items ?? []).flatMap((item) =>
                item.serviceId
                  ? [{ serviceId: item.serviceId, price: item.price, quantity: item.quantity }]
                  : [],
              ),
              staffId: row.staffId ?? null,
              notes: row.notes,
              status: row.status,
            }, anchor);
          }}
          onDraft={(startAt, durationMinutes, band, anchor) => {
            setProvisional(band);
            booking.open({ startAt, durationMinutes }, anchor);
          }}
          onMove={async (row, startAt, durationMinutes) => {
            // Paint first, ask second. A drag that waits for a cal.com round
            // trip before moving reads as broken on any real connection.
            setOptimistic((current) =>
              new Map(current).set(row._id, { startAt, durationMinutes }),
            );
            setMoveError(undefined);
            const result = await moveBooking({
              appointmentId: row._id,
              startAt,
              durationMinutes,
            });
            if (!result.ok) {
              // Snap back. The server never moved, so dropping the optimistic
              // entry is the whole rollback.
              clearOptimistic(row._id);
              setMoveError(result.reason ?? t("appointments.moveFailed"));
            }
          }}
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

      {/* A failed drag already snapped back; this says why, once, without a
          modal in the way of the calendar the owner is looking at. */}
      {moveError && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 shadow-lg dark:bg-amber-900/80 dark:text-amber-100">
          <span>{moveError}</span>
          <button
            className="ml-3 underline underline-offset-2"
            onClick={() => setMoveError(undefined)}
          >
            {t("common.close")}
          </button>
        </div>
      )}

      {booking.render()}
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
    // Fixed coords go stale when the PAGE scrolls — but the menu's own
    // scrollbar is the exception: scrolling the list is using it.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setPos(null);
    };
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
// Not the grid's bounds any more — the grid is a full 24 hours. This is where
// the view SCROLLS to when a period holds no bookings, so an empty week opens
// on the working morning instead of on midnight.
const DEFAULT_DAY_START = 8;
const DAY_MS = 86_400_000;

type CalendarAppointment = {
  _id: Id<"appointments">;
  customerId: Id<"customers">;
  startAt: number;
  durationMinutes?: number;
  status: string;
  staffId?: Id<"staff">;
  staffName?: string;
  notes?: string;
  customer: { firstName: string; lastName?: string } | null;
  serviceName?: string;
  items?: {
    serviceId?: Id<"services">;
    name: string;
    price?: number;
    durationMinutes: number;
    quantity?: number;
  }[];
  total?: number;
};

// Fill per status AND per tense, the way Google Calendar paints it: an
// upcoming booking is a solid lavender chip with white text, a past one the
// pale wash of the same hue. The tense split outranks the status split —
// whether it already happened is the first thing a glance wants — so past
// scheduled and past confirmed both fade the same way.
function blockStyle(status: string, isPast: boolean): string {
  // A no-show stays red in both tenses: it is the one state worth spotting
  // weeks later.
  if (status === "no_show") return "bg-red-500/10 text-red-700 dark:text-red-400";
  if (status === "completed" || isPast)
    return "bg-[var(--event-past)] text-[var(--event-past-fg)]";
  // Booked but unconfirmed reads a shade lighter than confirmed, so a glance
  // down the week still shows who has answered — but both are unmistakably
  // "still to come" next to the washed-out past.
  if (status === "confirmed") return "bg-[var(--event)] text-white";
  return "bg-[color-mix(in_srgb,var(--event)_72%,var(--card))] text-white";
}

// Body in lib/datetime, alongside addLocalDays — the two have to agree about
// what a day is, and they were in different files.
const startOfDay = startOfLocalDay;

// The view picker. A dropdown rather than five segments, because five segments
// is a row of buttons four of which are wrong, and the set will keep growing.
// The shortcut letter rides each row: it teaches the keyboard without a help
// screen, which is the only reason anybody learns these.
function ViewMenu({
  view,
  onView,
}: {
  view: ViewMode;
  onView: (next: ViewMode) => void;
}) {
  const { t } = useLanguage();
  // Portal + fixed, measured at open time, closed on outside-mousedown AND on
  // scroll. Not `absolute`: the shell's main pane scrolls, so an absolute child
  // clips there — the rule in AGENTS.md that this repo keeps re-learning.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!btnRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setPos(null);
      }
    };
    // Fixed coords go stale when the PAGE scrolls — but the menu's own
    // scrollbar is the exception: scrolling the list is using it.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setPos(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPos(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const MENU_W = 176;
  const toggle = () => {
    if (open) return setPos(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8)),
    });
  };

  const current = VIEW_MODES.find((mode) => mode.id === view);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        // An outlined pill, twin to the Today button across the row — the
        // two ends of the header carry the same weight, Google's balance.
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-4 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--muted-bg)]"
      >
        {current ? t(current.key) : ""}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_W }}
            className="z-[100] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
          >
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="menuitemradio"
                aria-checked={view === mode.id}
                onClick={() => {
                  onView(mode.id);
                  setPos(null);
                }}
                className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)] ${
                  view === mode.id ? "font-medium" : ""
                }`}
              >
                <span>{t(mode.key)}</span>
                <span className="text-xs text-[var(--muted)]">{VIEW_KEY[mode.id]}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

// Body in lib/datetime — this was the third copy.
const startOfWeek = startOfLocalWeek;

function minutesInto(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

// Wall-clock label for a minute-of-day, for the slot being drawn — the band
// works in grid minutes, not timestamps, so formatTime can't serve it.
function formatMinutes(minute: number): string {
  const clamped = Math.max(0, Math.min(minute, 24 * 60));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(
    clamped % 60,
  ).padStart(2, "0")}`;
}

// The gutter-corner offset chip. Ink, not the timestamp grey — it is a grid
// coordinate like the hour labels beside it. Hovering (or focusing) it names
// the zone in full, instantly: "GMT+03" is ambiguous the two weeks a year
// when DST makes Istanbul and Vienna disagree about it. Portal + fixed for
// the tip, the InfoTip rule — the header sits over a scroll container.
function GmtBadge({ timezone, at }: { timezone?: string; at: number }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const zoneName = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 6, left: Math.max(8, r.left) });
  };
  const hide = () => setPos(null);
  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="cursor-default text-[10px] text-[var(--foreground)]"
      >
        {gmtLabel(timezone, at)}
      </span>
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="pointer-events-none z-[100] whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--foreground)] shadow-lg"
          >
            {zoneName}
          </span>,
          document.body,
        )}
    </>
  );
}

// "GMT+03" for the gutter corner, computed from the BUSINESS's zone — the
// same zone the closed shading uses, so the two can never disagree. Google
// prints the viewer's offset there; ours is a business tool, and the offset
// that explains the grid is the salon's.
function gmtLabel(timezone: string | undefined, at: number): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date(at));
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    // "GMT+3" → "GMT+03"; "GMT+5:30" and plain "GMT" pass through untouched.
    return name.replace(/^GMT([+-])(\d)$/, "GMT$10$2");
  } catch {
    return "GMT";
  }
}

type Cluster = { key: string; startAt: number; endAt: number; size: number };
type Placed = {
  row: CalendarAppointment;
  lane: number;
  lanes: number;
  cluster: Cluster;
};

// What a row occupies for LANE PACKING, which is not what it occupies in
// time: a goods order (duration 0) borrows a small footprint here so five
// cakes due at 15:00 sit side by side instead of stacking into one
// unclickable pixel column. Only the packer sees this; the drawn height and
// every piece of booking math still treat the order as zero-length.
const PIN_LANE_MINUTES = 15;
function laneMinutes(row: CalendarAppointment): number {
  const minutes = row.durationMinutes ?? DEFAULT_DURATION;
  return minutes === 0 ? PIN_LANE_MINUTES : minutes;
}

// Side-by-side placement for bookings that overlap in time. Rows are grouped
// into clusters of mutually overlapping appointments, and each cluster is
// split into as many lanes as it needs. Every placement carries its cluster
// back out so a caller can decide the cluster is too crowded to draw.
function laneOut(rows: CalendarAppointment[]): Placed[] {
  const sorted = [...rows].sort((a, b) => a.startAt - b.startAt);
  const placed: Placed[] = [];
  let cluster: { row: CalendarAppointment; lane: number }[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length > 0) {
      const lanes = cluster.reduce((max, item) => Math.max(max, item.lane + 1), 0);
      const info: Cluster = {
        key: cluster[0].row._id, // sorted, so the first row is the earliest
        startAt: cluster[0].row.startAt,
        endAt: clusterEnd,
        size: cluster.length,
      };
      for (const item of cluster) placed.push({ ...item, lanes, cluster: info });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const row of sorted) {
    const end = row.startAt + laneMinutes(row) * 60_000;
    if (row.startAt >= clusterEnd) flush();
    // First lane whose last booking has already finished.
    const laneEnds: number[] = [];
    for (const item of cluster) {
      const itemEnd = item.row.startAt + laneMinutes(item.row) * 60_000;
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

// Every overlapping booking draws, side by side, in every view — the Google
// behaviour, chosen over the count-chip this replaced. Week view used to fold
// three-deep clusters into "3 bookings" once lanes fell under a readable
// width; the owner asked for what Google does instead: always split the
// column, let the narrow blocks truncate, and keep every booking clickable.
// A merged block was never on the table — it hides which customer it is and
// gives you nothing to click.

// One column of the grid. In week view that is a day; in day view it is a
// person, so a salon can read its chairs side by side.
type CalendarColumn = {
  key: string;
  day: number;
  label?: string;
  rows: CalendarAppointment[];
};

// The grid is roughly this wide on a laptop once the hour gutter is gone.
// Estimated rather than measured: knowing whether a block can hold a name
// isn't worth a layout pass on every render.
const APPROX_GRID_PX = 1050;
// How close to the bottom edge counts as "resize" rather than "move". Sized for
// a fingertip, not a mouse pointer.
const RESIZE_HANDLE_PX = 10;
// The bare strip every chip leaves at the column's right edge, so a full slot
// still has grid to press for another booking. Google's proportions: chips
// hug the left, the breathing room is all on the right.
const BLOCK_RIGHT_GUTTER_PX = 14;

// Geometry lives in lib/calendarDrag.ts so the arithmetic can be tested without
// a browser; this only adds what the grid needs on top of it.
type DragState = DragGeometry & {
  day: number;
  row?: CalendarAppointment;
};

const NARROW_BLOCK_PX = 80;

function Calendar({
  appointments,
  view,
  anchor,
  onOpenBlock,
  provisional,
  onDraft,
  onMove,
  businessHours,
  timezone,
}: {
  appointments: CalendarAppointment[];
  view: "day" | "week";
  anchor: number;
  onOpenBlock: (row: CalendarAppointment, anchor?: Rect) => void;
  // Click or drag on empty grid: hand the parent a start and a length and let
  // it open the sheet. The grid never creates anything itself.
  onDraft: (
    startAt: number,
    durationMinutes: number,
    band: SlotBand,
    anchor?: Rect,
  ) => void;
  // The slot an open sheet belongs to, drawn as a band so the sheet reads as
  // attached to it.
  provisional?: SlotBand | null;
  // Committed drag of an existing block. The parent owns the optimistic state
  // and the snap-back, because it also owns the mutation.
  onMove: (row: CalendarAppointment, startAt: number, durationMinutes: number) => void;
  businessHours?: {
    activeDays?: number[];
    startMinute?: number;
    endMinute?: number;
  };
  // The BUSINESS's IANA zone — what the closed shading is computed in.
  timezone?: string;
}) {
  const { t, language } = useLanguage();
  const locale = localeFor(language);
  const scrollRef = useRef<HTMLDivElement>(null);

  const days = useMemo(
    () =>
      view === "day"
        ? [startOfDay(anchor)]
        : [...Array(7)].map((_, i) => addLocalDays(startOfWeek(anchor), i)),
    [view, anchor],
  );

  const visible = useMemo(() => {
    const from = days[0];
    // The next local midnight, not +86,400,000ms. On the fall-back week that
    // fixed step landed at 23:00 Sunday, so a booking at 23:30 was excluded
    // here AND fell before the next week's `from` — invisible in week view on
    // both pages, and in day view on both days. On the spring-forward week it
    // over-reached to 01:00 Monday and drew a Monday booking in Sunday's column.
    const to = addLocalDays(days[days.length - 1], 1);
    return appointments.filter(
      (a) => a.startAt >= from && a.startAt < to && a.status !== "cancelled",
    );
  }, [appointments, days]);

  // Day view splits the day by person: the question at the desk is "who is
  // free at three", and that only reads if each person owns a column. Week
  // view stays seven days, because seven days times four staff is a wall.
  //
  // Staff is free text and plenty of salons never fill it in, so the columns
  // are derived from whatever is actually on the day. Nothing filled in means
  // one plain column, exactly as before.
  const columns = useMemo<CalendarColumn[]>(() => {
    if (view !== "day") {
      return days.map((day) => ({
        key: String(day),
        day,
        rows: visible.filter(
          (a) => a.startAt >= day && a.startAt < addLocalDays(day, 1),
        ),
      }));
    }
    const day = days[0];
    const rows = visible.filter(
          (a) => a.startAt >= day && a.startAt < addLocalDays(day, 1),
        );
    // Grouped by staff id, not by the printed name: two people can share a
    // first name, and the old string grouping made one column out of both — and
    // two columns out of one person whose name had a trailing space.
    const named = new Map<string, string>();
    let anyUnassigned = false;
    for (const row of rows) {
      if (row.staffId) named.set(row.staffId, row.staffName?.trim() || row.staffId);
      else anyUnassigned = true;
    }
    if (named.size === 0) return [{ key: String(day), day, rows }];

    const byStaff: CalendarColumn[] = [...named.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], locale))
      .map(([staffId, label]) => ({
        key: `${day}:${staffId}`,
        day,
        label,
        rows: rows.filter((row) => row.staffId === staffId),
      }));
    // Trailing, and only when someone is actually unassigned: an empty column
    // for a state nobody is in is just noise.
    if (anyUnassigned) {
      byStaff.push({
        key: `${day}:unassigned`,
        day,
        label: t("appointments.unassigned"),
        rows: rows.filter((row) => !row.staffId),
      });
    }
    return byStaff;
  }, [view, days, visible, locale, t]);

  // A full 24-hour day, like every calendar a salon owner already uses. It used
  // to open on the working day and stretch only for bookings outside it, which
  // meant the grid silently changed height as the week changed — 08:00 one
  // week, 06:00 the next, and a booking dragged to 07:00 moved every row on
  // screen. A fixed day is worth the scroll.
  //
  // The scroll position is what makes this liveable: see the effect below,
  // which lands on the first booking rather than on midnight.
  const [dayStart, dayEnd] = [0, 24];

  const hours = [...Array(dayEnd - dayStart)].map((_, i) => dayStart + i);
  const gridHeight = hours.length * HOUR_PX;

  // Now-line, re-read every minute. Absolutely positioned, so nothing shifts.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Land on the first booking of the period (or the top of the working day)
  // instead of wherever the scroll happened to sit. Computed here rather than
  // inside the effect so the dependency is a plain number the linter can
  // check, and so the scroll only moves when the period actually changes.
  const firstBookingMinute = useMemo(
    () =>
      visible.reduce(
        (min, a) => Math.min(min, minutesInto(a.startAt)),
        DEFAULT_DAY_START * 60,
      ),
    [visible],
  );
  const periodStart = days[0];
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = Math.max(
      0,
      ((firstBookingMinute - dayStart * 60) / 60) * HOUR_PX - HOUR_PX / 2,
    );
  }, [periodStart, dayStart, firstBookingMinute]);

  const staffColumns = columns.some((column) => column.label !== undefined);
  const columnPx = APPROX_GRID_PX / columns.length;

  // ---- Direct manipulation ----
  //
  // One pointer handler set for three gestures, because they share all the
  // maths and differ only in what moves: drag empty grid to draw a new slot,
  // drag a block's body to move it, drag its bottom edge to resize. Pointer
  // events rather than mouse events so a finger works without a second path;
  // setPointerCapture keeps the gesture alive when the finger leaves the column.
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // A pointerup after a real drag is still followed by a click on the block's
  // button. Without this the sheet would open every time you moved something.
  const suppressClick = useRef(false);

  const gutterRef = useRef<HTMLDivElement>(null);

  const minuteAtClientY = (clientY: number): number => {
    const body = gridRef.current;
    if (!body) return dayStart * 60;
    return minuteAt(clientY, body.getBoundingClientRect().top, dayStart, HOUR_PX);
  };

  // Measured, not assumed: the gutter's width is a Tailwind class today and a
  // wrong constant here would land every drag one column off.
  const dayAtClientX = (clientX: number, fallback: number): number => {
    const body = gridRef.current;
    if (!body || columns.length === 0) return fallback;
    const rect = body.getBoundingClientRect();
    const index = columnIndexAt(
      clientX,
      rect.left,
      gutterRef.current?.offsetWidth ?? 0,
      rect.width,
      columns.length,
    );
    return columns[index].day;
  };

  const startDrag = (next: DragState, event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    setDrag(next);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag) return;
    const minute = minuteAtClientY(event.clientY);
    // Only a MOVE crosses days. Drawing a new slot and resizing an existing
    // one both stay in the column they started in — an appointment that runs
    // from Tuesday to Thursday is not something this calendar can draw, let
    // alone something a salon means to book.
    //
    // `day` goes AFTER the spread: advanceDrag carries the whole object
    // through, so putting it first would let the old day overwrite the new one
    // on every single move.
    const day =
      drag.kind === "move" ? dayAtClientX(event.clientX, drag.day) : drag.day;
    setDrag((current) =>
      current ? { ...current, ...advanceDrag(current, minute), day } : current,
    );
  };

  // The drawn slot's rect, read while it is still on screen. setDrag(null)
  // below schedules its removal, and a rect measured after that is a rect of
  // nothing.
  const rectOfDrawnSlot = (): Rect | undefined => {
    const el = document.querySelector("[data-slot-band]");
    if (!el) return undefined;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  };

  const endDrag = () => {
    if (!drag) return;
    const current = drag;
    const { startAt, durationMinutes } = dragResult(current, current.day, DEFAULT_DURATION);
    if (current.kind === "create" || !current.row) {
      const anchorRect = rectOfDrawnSlot();
      setDrag(null);
      // The band shows the BOOKING, not the gesture. A click is a gesture with
      // no height at all, and dragResult turns it into a default-length
      // appointment; drawing the gesture left a hairline on the grid next to a
      // sheet offering to book half an hour.
      const startedAt = new Date(startAt);
      const startMinute = startedAt.getHours() * 60 + startedAt.getMinutes();
      onDraft(startAt, durationMinutes, {
        day: current.day,
        startMinute,
        endMinute: startMinute + durationMinutes,
      }, anchorRect);
      return;
    }
    setDrag(null);
    // A gesture that changed nothing is a click, and the block's own onClick
    // handles that — including for anyone arriving by keyboard.
    if (
      !current.moved ||
      (startAt === current.row.startAt &&
        durationMinutes === (current.row.durationMinutes ?? DEFAULT_DURATION))
    ) {
      return;
    }
    suppressClick.current = true;
    onMove(current.row, startAt, durationMinutes);
  };

  // Closed days and off-hours read as dead space rather than bookable grid.
  // Unset business hours mean nobody has said when this business is open, so
  // nothing is shaded — a guessed default would grey out a barber's Saturday.
  //
  // Computed in the BUSINESS's timezone, then projected onto this viewer-local
  // day column. The old version compared the org's minutes against the
  // viewer's wall clock, so an owner checking from Austria saw an Istanbul
  // salon's whole day shifted by an hour — open hours shaded, closed ones not.
  // The column can straddle two business-local dates (that shifted hour), so
  // both civil dates contribute their open window and the bands are the
  // complement of whatever overlaps.
  const closedBands = (day: number): { top: number; height: number }[] => {
    if (!businessHours) return [];
    const { activeDays, startMinute, endMinute } = businessHours;
    const dayEndMs = day + DAY_MS;
    const open: { from: number; to: number }[] = [];
    const seen = new Set<string>();
    for (const instant of [day, dayEndMs - 1]) {
      const p = getLocalPartsSafe(instant, timezone);
      const key = `${p.y}-${p.m0}-${p.d}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (activeDays && activeDays.length > 0 && !activeDays.includes(p.weekday)) {
        continue;
      }
      const from = startMinute ?? 0;
      const to = endMinute ?? 24 * 60;
      try {
        open.push({
          from: localWallTimeToUtcMs(
            p.y,
            p.m0,
            p.d,
            Math.floor(from / 60),
            from % 60,
            timezone ?? "UTC",
          ),
          to: localWallTimeToUtcMs(
            p.y,
            p.m0,
            p.d,
            Math.floor(to / 60),
            to % 60,
            timezone ?? "UTC",
          ),
        });
      } catch {
        // A malformed org timezone must not paint a confidently wrong grid.
        return [];
      }
    }
    const px = (ms: number) => ((ms - day) / 3_600_000) * HOUR_PX;
    const bands: { top: number; height: number }[] = [];
    let cursor = day;
    for (const range of [...open].sort((a, b) => a.from - b.from)) {
      // BOTH ends clamped to the column. The second civil date's open window
      // usually starts after this column ends, and an unclamped `from` drew
      // the evening band straight through midnight into a phantom second
      // grid below the real one.
      const from = Math.min(Math.max(range.from, day), dayEndMs);
      const to = Math.min(Math.max(range.to, day), dayEndMs);
      if (to <= cursor) continue;
      if (from > cursor) {
        bands.push({ top: px(cursor), height: px(from) - px(cursor) });
      }
      cursor = Math.max(cursor, to);
    }
    if (cursor < dayEndMs) {
      bands.push({ top: px(cursor), height: px(dayEndMs) - px(cursor) });
    }
    return bands;
  };

  return (
    // The grid is a card, the plane around it is the page gradient. Everything
    // INSIDE stays exactly as it was — white paper with the closed hours
    // shaded on it and every hour line drawn on top. The alternative (letting
    // the gradient show through closed hours and painting only open time
    // white) was tried and reverted: the white band is an overlay, so it
    // buried the hour lines it was laid over, and the grid lost its ruler.
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-[var(--card)] shadow-[var(--card-shadow)]">

      {/* Column headers stay put while the hours scroll under them. With staff
          columns the names take this row over: the date is already in the
          heading above, and a date row on top of a name row is two headers
          stacked for one thing. */}
      {/* pt-3: the row sits inside a card now, and a weekday name flush
          against the card's top edge reads as clipped. border-b: the rule
          under the header runs the FULL card width, gutter included — the
          hour lines start after the gutter, so without this the divider
          looked like it stopped short of the GMT corner. */}
      <div className="flex border-b border-[var(--grid-line)] pr-[10px] pt-3">
        {/* The gutter's slice of the header carries the UTC offset, exactly
            where Google puts it: it labels the hour column under it. */}
        <div className="flex w-12 shrink-0 items-end justify-end pb-2 pr-2">
          <GmtBadge timezone={timezone} at={days[0]} />
        </div>
        {staffColumns
          ? columns.map((column) => (
              <div
                key={column.key}
                className="min-w-0 flex-1 pb-2 text-center text-sm font-medium"
              >
                <span className="block truncate px-1">{column.label}</span>
              </div>
            ))
          : days.map((day) => {
              const isToday = startOfDay(now) === day;
              return (
                <div key={day} className="min-w-0 flex-1 pb-2 text-center">
                  {/* Full-strength ink, not the timestamp grey: the dates and
                      hours are the grid's coordinates, and coordinates you
                      squint at defeat the grid. */}
                  <div className="text-xs font-medium text-[var(--foreground)]">
                    {new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(day))}
                  </div>
                  <div
                    className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-sm tabular-nums ${
                      isToday
                        ? "bg-[var(--accent)] font-semibold text-white"
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
        <div
          ref={gridRef}
          className="flex"
          style={{ height: gridHeight, touchAction: drag ? "none" : undefined }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={() => setDrag(null)}
        >
          {/* Hour gutter. Labels sit ON their line, so they read as the moment
              the line marks rather than as a band. */}
          <div ref={gutterRef} className="relative w-12 shrink-0">
            {hours.map((hour, i) => (
              <span
                key={hour}
                // The first label would be half cut by the top edge, so it
                // hangs below its line instead of centring on it.
                className={`absolute right-2 text-[11px] tabular-nums text-[var(--foreground)] ${
                  i === 0 ? "" : "-translate-y-1/2"
                }`}
                style={{ top: i * HOUR_PX }}
              >
                {`${String(hour).padStart(2, "0")}:00`}
              </span>
            ))}
            {/* The clock, level with the now-line. In the GUTTER rather than in
                today's column, because the gutter is the one strip on the grid
                with nothing to cover: over the column it would sit on whatever
                is booked at this minute, which on a busy afternoon is exactly
                when you are looking. It hides the hour label it lands on, which
                is correct — the current time is the more useful of the two. */}
            {columns.some((column) => startOfDay(now) === column.day) && (
              <span
                className="absolute right-1 z-30 -translate-y-1/2 rounded bg-[var(--now-line)] px-1 text-[10px] font-medium tabular-nums leading-4 text-white"
                style={{ top: ((minutesInto(now) - dayStart * 60) / 60) * HOUR_PX }}
              >
                {formatTime(now, language)}
              </span>
            )}
          </div>

          {columns.map((column, columnIndex) => {
            const showNow = startOfDay(now) === column.day;
            return (
              <div
                key={column.key}
                // Closed on all four edges, like Google Calendar: a rule down
                // the left of the first day, the right of the last, and along
                // the bottom, so the week reads as a bounded grid instead of
                // columns trailing off.
                //
                // The bottom rule lives on the COLUMNS, not on the row that
                // holds them — the row also contains the hour gutter, and a
                // border there hangs a stray line under the last time label
                // where no column exists.
                className={`relative min-w-0 flex-1 border-b border-l border-[var(--grid-line)] ${
                  columnIndex === columns.length - 1
                    ? "border-r border-[var(--grid-line)]"
                    : ""
                }`}
                // Hour and half-hour rules as background gradients: two
                // hairlines per hour without a div per row.
                //
                // The half-hour line is the one that makes a 30-minute booking
                // readable. Without it, judging whether a block starts at the
                // hour or halfway through it means measuring by eye against a
                // 56px gap, on a screen where almost every appointment is
                // exactly half of one. It is drawn much fainter than the hour
                // so the hour still reads as the structure.
                //
                // The half-hour gradient carries its own full-hour period with
                // the line placed midway, rather than a half-hour period, which
                // would redraw over every hour line at the wrong weight.
                style={{
                  backgroundImage: [
                    "repeating-linear-gradient(to bottom, var(--grid-line) 0 1px, transparent 1px var(--hour))",
                    "repeating-linear-gradient(to bottom, transparent 0 calc(var(--hour) / 2), var(--grid-line-soft) calc(var(--hour) / 2) calc(var(--hour) / 2 + 1px), transparent calc(var(--hour) / 2 + 1px) var(--hour))",
                  ].join(", "),
                  ["--hour" as string]: `${HOUR_PX}px`,
                }}
                // Pointer down on the column ITSELF (never on a block, which
                // stops propagation) starts drawing a new slot.
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  const minute = minuteAtClientY(event.clientY);
                  startDrag(
                    {
                      kind: "create",
                      day: column.day,
                      anchorMinute: minute,
                      grabOffset: 0,
                      startMinute: minute,
                      // Opens at the length a click actually books, not at one
                      // snap step. dragResult gives an unmoved create
                      // DEFAULT_DURATION, so starting at SNAP_MINUTES drew a
                      // 15-minute band and then booked 30: the grid contradicted
                      // the sheet before you had even let go. Dragging still
                      // sizes it freely, down to one snap step.
                      endMinute: minute + DEFAULT_DURATION,
                      moved: false,
                    },
                    event,
                  );
                }}
              >
                {/* Closed hours, behind everything. Pointer-events off so the
                    grid stays draggable: a salon does book outside its posted
                    hours, it just should not look like ordinary space. */}
                {closedBands(column.day).map((band, index) => (
                  <div
                    key={index}
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bg-[var(--closed-bg)]"
                    style={{ top: band.top, height: band.height }}
                  />
                ))}
                {/* The slot being drawn, the block being dragged, or the slot
                    the open sheet belongs to. The third case is what makes an
                    anchored sheet read as attached to the calendar instead of
                    floating over it: Google keeps the block it just drew lit
                    for exactly as long as its popover is up. */}
                {(() => {
                  const band = drag ?? provisional;
                  if (!band || band.day !== column.day) return null;
                  const bandHeight = Math.max(
                    ((band.endMinute - band.startMinute) / 60) * HOUR_PX - 2,
                    14,
                  );
                  // A solid chip, not a dashed outline: Google draws the slot
                  // you are creating as the event it is about to become, and
                  // that is what makes the gesture feel like placing a booking
                  // rather than selecting a range. The live time range rides
                  // inside as soon as there is room for a line of text.
                  // The band already wears the tense the booking will get:
                  // draw a slot on this afternoon and it is solid, draw one
                  // over yesterday and it is the same faded wash the saved
                  // block will be. Anything else has the chip changing colour
                  // the moment Save lands. Same rule as blockStyle — past is
                  // decided by the slot's END against the live clock.
                  return (
                    <div
                      aria-hidden
                      data-slot-band
                      className={`pointer-events-none absolute z-20 overflow-hidden rounded-md px-1.5 py-0.5 text-[11px] leading-tight opacity-90 shadow-md ${
                        band.day + band.endMinute * 60_000 < now
                          ? "bg-[var(--event-past)] text-[var(--event-past-fg)]"
                          : "bg-[var(--event)] text-white"
                      }`}
                      style={{
                        top: ((band.startMinute - dayStart * 60) / 60) * HOUR_PX,
                        height: bandHeight,
                        // Same asymmetry as the saved chips, so the draft sits
                        // exactly where the booking will land.
                        left: 1,
                        right: BLOCK_RIGHT_GUTTER_PX,
                      }}
                    >
                      {bandHeight >= 18 && (
                        <span className="block truncate font-medium tabular-nums">
                          {formatMinutes(band.startMinute)} – {formatMinutes(band.endMinute)}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {laneOut(column.rows).map(({ row, lane, lanes }) => {
                  // An explicit 0 is a goods order: drawn as a pin, moved but
                  // never resized, dashed so a handover reads differently
                  // from twenty minutes of somebody's chair.
                  const isGood = row.durationMinutes === 0;
                  const top =
                    ((minutesInto(row.startAt) - dayStart * 60) / 60) * HOUR_PX;
                  const height = Math.max(
                    ((row.durationMinutes ?? DEFAULT_DURATION) / 60) * HOUR_PX - 2,
                    20,
                  );
                  const name = row.customer
                    ? `${row.customer.firstName} ${row.customer.lastName ?? ""}`.trim()
                    : "";
                  // Two lanes in a week column is about 75px each, and a name
                  // in 75px minus padding is three letters and an ellipsis.
                  // The time is the part you scan for, so it keeps the block.
                  const narrow = columnPx / lanes < NARROW_BLOCK_PX;
                  return (
                    <button
                      key={row._id}
                      onClick={(event) => {
                        // Swallow the click that trails a real drag; a genuine
                        // click (including from the keyboard) opens the sheet.
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        // The block itself is the anchor: an existing booking
                        // is already drawn on the grid, so the sheet has
                        // something real to sit beside without a band.
                        onOpenBlock(row, rectOf(event.currentTarget));
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        // Never let this reach the column, or every grab would
                        // also start drawing a new slot underneath.
                        event.stopPropagation();
                        const minute = minuteAtClientY(event.clientY);
                        const startMinute = minutesInto(row.startAt);
                        const endMinute =
                          startMinute + (row.durationMinutes ?? DEFAULT_DURATION);
                        const nearBottom =
                          event.clientY >=
                          event.currentTarget.getBoundingClientRect().bottom -
                            RESIZE_HANDLE_PX;
                        startDrag(
                          {
                            // A pin has no bottom edge to drag — a good's
                            // length is not a thing, so grabbing anywhere
                            // moves it.
                            kind: nearBottom && !isGood ? "resize" : "move",
                            day: column.day,
                            row,
                            anchorMinute: startMinute,
                            grabOffset: minute - startMinute,
                            startMinute,
                            endMinute,
                            moved: false,
                          },
                          event,
                        );
                      }}
                      title={[name, row.serviceName, row.staffName]
                        .filter(Boolean)
                        .join(" · ")}
                      // Chips sit nearly flush left and stop short of the
                      // column's right edge — Google's asymmetry. The bare
                      // strip is the point: a fully booked slot still leaves
                      // grid to press for the NEXT booking, instead of every
                      // pixel of a busy hour opening something already there.
                      style={{
                        top,
                        height,
                        left: `calc((100% - ${BLOCK_RIGHT_GUTTER_PX}px) * ${lane / lanes} + 1px)`,
                        width: `calc((100% - ${BLOCK_RIGHT_GUTTER_PX}px) / ${lanes} - 2px)`,
                        touchAction: "none",
                      }}
                      // ring-1 in the card colour: the hairline that keeps two
                      // same-coloured chips sharing a slot readable as two —
                      // Google's white seam. Invisible against the card when a
                      // block stands alone.
                      className={`absolute cursor-grab overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight ring-1 ring-[var(--card)] transition-opacity hover:opacity-80 active:cursor-grabbing ${blockStyle(
                        row.status,
                        row.startAt +
                          (row.durationMinutes ?? DEFAULT_DURATION) * 60_000 <
                          now,
                      )} ${isGood ? "border border-dashed border-current/40" : ""} ${
                        drag?.row?._id === row._id
                          ? "opacity-30"
                          : ""
                      }`}
                    >
                      {/* Resize grip. Its own element so the cursor changes
                          before you press, rather than after. A pin has no
                          edge, so it gets none. */}
                      {!isGood && (
                        <span
                          aria-hidden
                          className="absolute inset-x-0 bottom-0 cursor-ns-resize"
                          style={{ height: RESIZE_HANDLE_PX }}
                        />
                      )}
                      {/* A half-hour block is one line tall, so the time and
                          the name share it rather than clipping.

                          Too narrow for both: the NAME wins, not the time. The
                          block's position on the grid already says when it is,
                          which makes the clock the redundant half here. Two
                          15:30 blocks both reading "15:30" told you nothing. */}
                      {narrow && height < 40 ? (
                        <span className="block truncate font-medium">
                          {name || formatTime(row.startAt, language)}
                        </span>
                      ) : narrow ? (
                        <>
                          <span className="block truncate font-medium tabular-nums">
                            {formatTime(row.startAt, language)}
                          </span>
                          <span className="block truncate">{name}</span>
                        </>
                      ) : height < 40 ? (
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
                    className="pointer-events-none absolute inset-x-0 z-30 border-t-2 border-[var(--now-line)]"
                    style={{ top: ((minutesInto(now) - dayStart * 60) / 60) * HOUR_PX }}
                  >
                    <span className="absolute -left-[5px] -top-[7px] h-3 w-3 rounded-full bg-[var(--now-line)]" />
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
