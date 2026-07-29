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
  formatDayHeading,
  formatTime,
  localeFor,
} from "@/lib/datetime";
import {
  DEFAULT_DURATION,
  advanceDrag,
  columnIndexAt,
  dragResult,
  minuteAt,
  type DragGeometry,
} from "@/lib/calendarDrag";
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

type ViewMode = "day" | "week" | "list";

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
  { id: "list", key: "appointments.list" },
];

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

  // Two weeks back → six weeks forward covers the list AND every reachable
  // week-view page from one subscription.
  const range = useMemo(() => {
    const now = Date.now();
    return { fromMs: now - 14 * 86_400_000, toMs: now + 42 * 86_400_000 };
  }, []);
  const appointments = useQuery(api.appointments.listRange, range);
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
    <div
      className={
        view === "list" ? "space-y-4" : "flex h-full min-h-0 flex-col gap-4"
      }
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {/* View switch left, the one create action right. The switch is a
            property of what you are looking at; the button makes something
            new, and those are not the same kind of control to be stacked in
            one cluster. */}
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
          className="ml-auto rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)]"
          onClick={() => {
            // No slot was clicked, so open on the next round hour — which is
            // what "new appointment" from a toolbar means.
            const next = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
            booking.open({ startAt: next, durationMinutes: DEFAULT_DURATION });
          }}
        >
          {t("appointments.new")}
        </button>
      </div>

      {appointments?.length === 0 && view === "list" && (
        <p className="text-sm text-[var(--muted)]">{t("appointments.none")}</p>
      )}

      {view !== "list" && appointments !== undefined && (
        <Calendar
          appointments={withOptimistic}
          view={view}
          anchor={anchor}
          onAnchor={setAnchor}
          businessHours={settings?.org.businessHours}
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
                  ? [{ serviceId: item.serviceId, price: item.price }]
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
          onOpenDay={(dayMs) => {
            setAnchor(dayMs);
            setView("day");
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
  }[];
  total?: number;
};

// Fill per status. No left accent bars: the fill carries the state, and a
// cancelled or missed booking should read quieter than a live one.
// A cluster stands for several bookings that may hold several DIFFERENT
// statuses, so it cannot wear one of them. What it can wear is the one fact
// true of all of them at once: whether the day has been and gone. Past reads
// grey like every other finished block on the row; upcoming keeps the live
// tint. An outlined white chip was tried and read as a hole in the grid.
const CLUSTER_STYLE = {
  past: "bg-[var(--muted-bg)] text-[var(--muted)]",
  upcoming: "bg-[var(--brand-soft)] text-[var(--foreground)]",
};

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

type Cluster = { key: string; startAt: number; endAt: number; size: number };
type Placed = {
  row: CalendarAppointment;
  lane: number;
  lanes: number;
  cluster: Cluster;
};

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

// Three bookings sharing a 160px week column leave ~50px each, which is a
// sliver with no readable content. Past this many, the cluster stops trying
// to be a schedule and becomes a count you can click into.
// Was a flat count: three overlapping bookings collapsed, two split the column
// and took their chances. In a seven-day week two lanes is ~73px each, which
// renders "Fatma …" and "Emre Çe…" — a name truncated to nothing and no time
// at all. The threshold is a WIDTH now, measured against the same
// NARROW_BLOCK_PX the blocks already use to decide whether they can carry
// their own content.
//
// Never merge overlapping bookings into one block, which is what this looks
// like it should do — Google, Apple and Outlook all keep them side by side,
// because a merged block hides which customer it is and gives you nothing to
// click. Collapsing to a COUNT is different: it admits there is no room and
// hands you the day view, where a salon gets one column per person the way
// Fresha and Booksy do.
const MIN_LANE_PX = 80;

type PlacedItem =
  | { kind: "one"; key: string; row: CalendarAppointment; lane: number; lanes: number }
  | { kind: "cluster"; key: string; startAt: number; endAt: number; count: number };

// Day view always draws every booking: its columns are wide, and two bookings
// in one person's column is a real double-booking worth seeing. Week view
// folds the crowded clusters, and leaves clusters of one or two alone.
// `columnPx` is the width one column gets, or 0 to never collapse — day view
// passes 0 because its clusters would open the day you are already looking at.
function placeColumn(rows: CalendarAppointment[], columnPx: number): PlacedItem[] {
  const items: PlacedItem[] = [];
  const folded = new Set<string>();
  for (const { row, lane, lanes, cluster } of laneOut(rows)) {
    if (columnPx <= 0 || columnPx / lanes >= MIN_LANE_PX) {
      items.push({ kind: "one", key: row._id, row, lane, lanes });
      continue;
    }
    if (folded.has(cluster.key)) continue;
    folded.add(cluster.key);
    items.push({
      kind: "cluster",
      key: cluster.key,
      startAt: cluster.startAt,
      endAt: cluster.endAt,
      count: cluster.size,
    });
  }
  return items;
}

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
  onAnchor,
  onOpenBlock,
  provisional,
  onOpenDay,
  onDraft,
  onMove,
  businessHours,
}: {
  appointments: CalendarAppointment[];
  view: "day" | "week";
  anchor: number;
  onAnchor: (next: number) => void;
  onOpenBlock: (row: CalendarAppointment, anchor?: Rect) => void;
  onOpenDay: (dayMs: number) => void;
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
}) {
  const { t, language } = useLanguage();
  const locale = localeFor(language);
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
        rows: visible.filter((a) => a.startAt >= day && a.startAt < day + DAY_MS),
      }));
    }
    const day = days[0];
    const rows = visible.filter((a) => a.startAt >= day && a.startAt < day + DAY_MS);
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

  const step = view === "day" ? 1 : 7;
  const heading =
    view === "day"
      ? formatDayHeading(days[0], language)
      : `${new Intl.DateTimeFormat(locale, { day: "numeric" }).format(new Date(days[0]))}-${new Intl.DateTimeFormat(
          locale,
          { day: "numeric", month: "long" },
        ).format(new Date(days[6]))}`;

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
  const closedBands = (day: number): { top: number; height: number }[] => {
    if (!businessHours) return [];
    const { activeDays, startMinute, endMinute } = businessHours;
    const weekday = new Date(day).getDay();
    const gridTop = dayStart * 60;
    const gridBottom = dayEnd * 60;
    const band = (fromMinute: number, toMinute: number) => ({
      top: ((fromMinute - gridTop) / 60) * HOUR_PX,
      height: ((toMinute - fromMinute) / 60) * HOUR_PX,
    });
    if (activeDays && activeDays.length > 0 && !activeDays.includes(weekday)) {
      return [band(gridTop, gridBottom)];
    }
    const bands: { top: number; height: number }[] = [];
    if (startMinute != null && startMinute > gridTop) bands.push(band(gridTop, startMinute));
    if (endMinute != null && endMinute < gridBottom) bands.push(band(endMinute, gridBottom));
    return bands;
  };

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

      {/* Column headers stay put while the hours scroll under them. With staff
          columns the names take this row over: the date is already in the
          heading above, and a date row on top of a name row is two headers
          stacked for one thing. */}
      <div className="flex pr-[10px]">
        <div className="w-12 shrink-0" />
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
                className={`absolute right-2 text-[11px] tabular-nums text-[var(--muted)] ${
                  i === 0 ? "" : "-translate-y-1/2"
                }`}
                style={{ top: i * HOUR_PX }}
              >
                {`${String(hour).padStart(2, "0")}:00`}
              </span>
            ))}
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
                className={`relative min-w-0 flex-1 border-b border-l border-[var(--border)] ${
                  columnIndex === columns.length - 1
                    ? "border-r border-[var(--border)]"
                    : ""
                }`}
                // Hour rules as a background gradient: one hairline per hour
                // without a div per row.
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px var(--hour))",
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
                    className="pointer-events-none absolute inset-x-0 bg-[var(--muted-bg)] opacity-60"
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
                  return (
                    <div
                      aria-hidden
                      data-slot-band
                      className="pointer-events-none absolute z-20 rounded-md border-2 border-dashed border-[var(--brand)] bg-[var(--brand-soft)] opacity-80"
                      style={{
                        top: ((band.startMinute - dayStart * 60) / 60) * HOUR_PX,
                        height: Math.max(
                          ((band.endMinute - band.startMinute) / 60) * HOUR_PX - 2,
                          14,
                        ),
                        left: 2,
                        right: 2,
                      }}
                    />
                  );
                })()}
                {placeColumn(
                  column.rows,
                  view === "week" ? APPROX_GRID_PX / columns.length : 0,
                ).map((item) => {
                  if (item.kind === "cluster") {
                    const dayIsPast = column.day < startOfDay(now);
                    const top =
                      ((minutesInto(item.startAt) - dayStart * 60) / 60) * HOUR_PX;
                    const height = Math.max(
                      ((item.endAt - item.startAt) / 3_600_000) * HOUR_PX - 2,
                      20,
                    );
                    const count = `${item.count} ${t("appointments.bookings")}`;
                    return (
                      <button
                        key={item.key}
                        // Same guard the single blocks carry. Without it the
                        // press reached the column, started drawing a new slot,
                        // and the release opened the booking sheet before this
                        // click could run: the one place already too full to
                        // read was the one place that offered to add to it.
                        //
                        // No drag of its own. A cluster is several bookings at
                        // once and there is nothing coherent to move; it is a
                        // door into the day, not a block.
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => onOpenDay(column.day)}
                        title={count}
                        style={{ top, height, left: 2, right: 2 }}
                        className={`absolute overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight transition-opacity hover:opacity-80 ${
                          dayIsPast ? CLUSTER_STYLE.past : CLUSTER_STYLE.upcoming
                        }`}
                      >
                        {height < 40 ? (
                          <span className="block truncate">
                            <span className="font-medium tabular-nums">
                              {formatTime(item.startAt, language)}
                            </span>{" "}
                            {count}
                          </span>
                        ) : (
                          <>
                            <span className="block truncate font-medium tabular-nums">
                              {formatTime(item.startAt, language)}
                            </span>
                            <span className="block truncate">{count}</span>
                          </>
                        )}
                      </button>
                    );
                  }

                  const { row, lane, lanes } = item;
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
                      key={item.key}
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
                            kind: nearBottom ? "resize" : "move",
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
                      style={{
                        top,
                        height,
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                        touchAction: "none",
                      }}
                      className={`absolute cursor-grab overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight transition-opacity hover:opacity-80 active:cursor-grabbing ${
                        BLOCK_STYLE[row.status] ?? BLOCK_STYLE.scheduled
                      } ${
                        drag?.row?._id === row._id
                          ? "opacity-30"
                          : ""
                      }`}
                    >
                      {/* Resize grip. Its own element so the cursor changes
                          before you press, rather than after. */}
                      <span
                        aria-hidden
                        className="absolute inset-x-0 bottom-0 cursor-ns-resize"
                        style={{ height: RESIZE_HANDLE_PX }}
                      />
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
