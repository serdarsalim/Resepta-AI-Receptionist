"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  formatWeekHeading,
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
  closureAppliesToDay,
  closuresOnDay,
  getLocalPartsSafe,
  isoDateOf,
  localWallTimeToUtcMs,
  windowForWeekday,
  type Closure,
} from "../../convex/lib/businessHours";
import { MonthGrid, addMonths, startOfMonth } from "./MonthGrid";
import { YearGrid, addYears, startOfYear } from "./YearGrid";
import { BlockSheet, SheetKindTabs, type BlockDraft } from "./BlockSheet";
import { RowMenu } from "./RowMenu";
import { buttonClass, iconButtonClass } from "./Control";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { STAFF_TINT, staffSwatch, staffSwatchInk, staffTint } from "@/lib/staffTint";
import { CalendarPanel, FilterPicker, UNASSIGNED, shownIds } from "./CalendarPanel";
import { useBookingSheet } from "./useBookingSheet";
import { useConfirm } from "./ConfirmDialog";
import { conflictText } from "@/lib/slotVerdict";
import type { Rect } from "@/lib/anchoredSheet";
import { HoverTip } from "./HoverTip";
import { gmtLabel } from "@/lib/gmtLabel";
import { customerName } from "@/lib/customerName";

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
// `staffId`: whose booking the open sheet says it is, so the band wears their
// colour before Save does (and, in day view, sits in their column).
// `columnKey`: the column it was drawn in, where it stays when nobody's
// column matches.
type SlotBand = {
  day: number;
  startMinute: number;
  endMinute: number;
  staffId?: string;
  columnKey?: string;
};

// A closure as the CALENDAR needs it: the businessHours shape plus the row id,
// because the grid pins an editable label chip on every closure band and
// editing has to name the row. Exactly what api.closures.list returns.
type ClosureRow = Closure & { _id: Id<"closures"> };

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

// Per viewer, in this browser: whether the side panel is open (open unless
// closed), and per business what its lists filter. Not on the server: a
// filter is a working context of one person at one desk, and two owners of
// one salon looking at different chairs is the point of it.
const PANEL_STORAGE_KEY = "resepta.calendar.panel";
const FILTER_STORAGE_PREFIX = "resepta.calendar.filters.";

// Team only (Serdar, 2026-10-21): a services filter answered no question
// anybody brings to a calendar, where what you look for is who is booked.
// A services list stored by an earlier build is ignored on read, so it can
// never hide a booking from a filter that is no longer on screen.
type CalendarFilters = { staff: string[] };
const NO_FILTERS: CalendarFilters = { staff: [] };

// Anything can be in localStorage: a half-written entry, a shape from another
// build. Whatever does not read as a list of strings reads as no filter.
function readFilters(raw: string | null): CalendarFilters {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    const list = (value: unknown) =>
      Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      return { staff: list(record.staff) };
    }
  } catch {
    // Unreadable: no filter.
  }
  return NO_FILTERS;
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
  // The header box also finds any customer (P13), so a booking can start from
  // the person as well as from the time.
  const jumpToCustomer = useCallback(
    (customerId: string) => onOpenContact(customerId as Id<"customers">),
    [onOpenContact],
  );
  const search = useHeaderSearch(t("common.search"), jumpToCustomer);
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
  // The days the day and week grids show, banded on the side panel's month.
  const visiblePeriod = useMemo(() => {
    const from = view === "week" ? startOfWeek(anchor) : startOfDay(anchor);
    return { from, to: addLocalDays(from, view === "week" ? 7 : 1) };
  }, [anchor, view]);
  const settings = useQuery(api.orgs.current, {});
  // Closure writes are owner-only end to end (convex/closures.ts requires it),
  // so for staff the chips are facts rather than doors and the kind tabs never
  // appear — the same line the old settings card drew with isOwner.
  const isOwner = settings !== undefined && settings.me.role !== "staff";
  // Shading only — the grid never refuses a drop on a closure. A closure says
  // what customers may be OFFERED; the owner putting somebody in the lunch
  // hour on purpose is the whole reason the shading is a wash rather than a
  // wall (docs/wwsd.md: the rule governs the offer, not the owner).
  const closures = useQuery(api.closures.list, {});
  // Every team member with their RESOLVED colour (lib/staffColors.ts): what
  // their bookings wear on every view. The booking sheet subscribes to the
  // same query, so this costs no second read.
  const staffRows = useQuery(api.staff.list, {});
  const colorOf = useMemo(() => {
    const byId = new Map((staffRows ?? []).map((row) => [row._id as string, row.color]));
    return (staffId?: string) => (staffId ? byId.get(staffId) : undefined);
  }, [staffRows]);

  // ── The side panel and its filters (CalendarPanel) ─────────────────────
  //
  // Read on mount, not during render: the server has no localStorage, and a
  // render-time read is a hydration mismatch (AppShell's sidebar does the
  // same). One frame with the panel open is cheaper than that error.
  const [panelOpen, setPanelOpen] = useState(true);
  useEffect(() => {
    try {
      setPanelOpen(window.localStorage.getItem(PANEL_STORAGE_KEY) !== "0");
    } catch {
      // Storage disabled: the panel stays open, it just is not remembered.
    }
  }, []);
  const togglePanel = () =>
    setPanelOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(PANEL_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Not remembered, still toggled.
      }
      return next;
    });

  // Per business: staff ids mean nothing in the next one.
  const orgId = settings?.org._id;
  const [filters, setFilters] = useState<CalendarFilters>(NO_FILTERS);
  useEffect(() => {
    if (!orgId) return;
    try {
      setFilters(readFilters(window.localStorage.getItem(FILTER_STORAGE_PREFIX + orgId)));
    } catch {
      setFilters(NO_FILTERS);
    }
  }, [orgId]);
  const changeFilters = (patch: Partial<CalendarFilters>) =>
    setFilters((current) => {
      const next = { ...current, ...patch };
      try {
        if (orgId) window.localStorage.setItem(FILTER_STORAGE_PREFIX + orgId, JSON.stringify(next));
      } catch {
        // Not remembered, still applied.
      }
      return next;
    });

  // Who the team list offers: everyone on the team, then anyone deactivated
  // whom a booking in the loaded range still names (so their bookings can be
  // picked out too), then Unassigned whenever there is a team at all.
  const panelStaff = useMemo(() => {
    const named = new Set((appointments ?? []).flatMap((row) => (row.staffId ? [row.staffId] : [])));
    const rows = staffRows ?? [];
    return [
      ...rows.filter((row) => row.active),
      ...rows.filter((row) => !row.active && named.has(row._id)),
    ];
  }, [staffRows, appointments]);
  const withUnassigned = (staffRows ?? []).length > 0;

  const staffKeys = useMemo(
    () => [...panelStaff.map((row) => row._id as string), ...(withUnassigned ? [UNASSIGNED] : [])],
    [panelStaff, withUnassigned],
  );
  const shownStaff = useMemo(() => shownIds(filters.staff, staffKeys), [filters.staff, staffKeys]);
  const staffFiltered = shownStaff.length < staffKeys.length;
  // Whether a booking survives the team list's ticks: its person (or
  // Unassigned) is ticked.
  const passesFilters = useCallback(
    (row: { staffId?: string }) =>
      !staffFiltered || shownStaff.includes(row.staffId ?? UNASSIGNED),
    [staffFiltered, shownStaff],
  );

  // Start times for the whole year, only while the year is being looked at,
  // filtered on the server by the same ticks (appointments.startsInRange).
  const yearStarts = useQuery(
    api.appointments.startsInRange,
    view === "year"
      ? {
          fromMs: startOfYear(anchor),
          toMs: addYears(startOfYear(anchor), 1),
          ...(staffFiltered ? { staffIds: shownStaff } : {}),
        }
      : "skip",
  );
  // Bucketed to local midnight here rather than on the server, because "which
  // day" is a question about the reader's clock.
  const bookedDays = useMemo(
    () => new Set((yearStarts ?? []).map((ms) => startOfDay(ms))),
    [yearStarts],
  );

  const setStatus = useMutation(api.appointments.setStatus);
  // An action, not a mutation: a move has to hear back from cal.com before our
  // own row moves. See convex/schedule.ts. Held here as well as in the booking
  // sheet because a DRAG moves a block without ever opening the sheet.
  const moveBooking = useAction(api.schedule.move);
  // A drag the calendar's verdict refused asks "Move it anyway?" here, the
  // sheet's question in the app's own dialog (P6, Nudge's drag confirm).
  const [confirm, confirmDialog] = useConfirm();

  // The slot last drawn on the grid, kept so the kind tabs can hand the SAME
  // slot to whichever sheet is chosen: switching to "blocked time" must not
  // lose the time you drew.
  const [lastDraft, setLastDraft] = useState<{
    startAt: number;
    durationMinutes: number;
    anchor?: Rect;
    // The person picked for it, from a day-view column or the sheet.
    staffId?: string;
  } | null>(null);
  // The block sheet's subject — a fresh draft from the grid, or a chip's row.
  const [blockSheet, setBlockSheet] = useState<{
    draft: BlockDraft;
    anchor?: Rect;
  } | null>(null);

  // The sheet owns its own state and every call behind Save; this view only
  // says when it opens and with what.
  const booking = useBookingSheet({ onOpenContact });

  // The appointment tab's other half: the same drawn slot, projected ONCE into
  // the business's civil terms — a closure is "13:00 in the salon", never a
  // UTC instant — so the block sheet never touches a timezone.
  const switchToBlock = () => {
    if (!lastDraft || !settings) return;
    const p = getLocalPartsSafe(lastDraft.startAt, settings.org.timezone);
    booking.close();
    setBlockSheet({
      draft: {
        date: isoDateOf(p),
        startMinute: p.minutesOfDay,
        // A goods order has no length, and a block needs one: an empty window
        // would open the sheet on its own "end before start" error.
        endMinute: Math.min(
          24 * 60,
          p.minutesOfDay + (lastDraft.durationMinutes || DEFAULT_DURATION),
        ),
      },
      anchor: lastDraft.anchor,
    });
  };


  // Optimistic positions, keyed by appointment. A drag paints here first and
  // the entry is dropped the moment the server agrees (the query row catches
  // up) or refuses (the block snaps back to where it was).
  const [optimistic, setOptimistic] = useState<
    Map<string, { startAt: number; durationMinutes: number }>
  >(new Map());
  const [moveError, setMoveError] = useState<string | undefined>();
  // The slot the open sheet was drawn against. Cleared the moment the sheet
  // goes, so a dismissed booking leaves no ghost band behind on the grid —
  // but only when NEITHER sheet has it: the kind tabs close one sheet to open
  // the other, and the band has to stay lit across that swap.
  const [provisional, setProvisional] = useState<SlotBand | null>(null);

  // ONE height for the two kinds of thing a drawn slot can become. Each sheet
  // reports the height its own content wants, the floor keeps the larger, and
  // both sheets are drawn at least that tall with the space opening above
  // their foot. So switching Appointment | Blocked time never moves Save:
  // the booking sheet is the taller of the two (six rows to four), and the
  // block sheet pads up to it. It moved by about 70px on every switch (found
  // in P3). Reset whenever a fresh slot opens a sheet, and when both close,
  // so one booking's height never leaks into the next.
  const [sheetFloor, setSheetFloor] = useState(0);
  const growSheetFloor = useCallback(
    (px: number) => setSheetFloor((current) => Math.max(current, Math.ceil(px))),
    [],
  );

  // The band follows the booking sheet's time: pick another day, start or
  // end in the sheet and the lit slot on the grid moves with it, instead of
  // staying where the click landed while the sheet said something else
  // (Nudge's onTimeChange). The kind switch reads lastDraft, so it carries
  // the new time across to the block sheet too.
  const followBand = useCallback((startAt: number, durationMinutes: number, staffId?: string) => {
    const startMinute = minutesInto(startAt);
    setProvisional((current) =>
      current
        ? {
            ...current,
            day: startOfDay(startAt),
            startMinute,
            endMinute: startMinute + durationMinutes,
            staffId,
          }
        : current,
    );
    setLastDraft((current) =>
      current ? { ...current, startAt, durationMinutes, staffId } : current,
    );
  }, []);
  useEffect(() => {
    if (!booking.isOpen && !blockSheet) {
      setProvisional(null);
      setSheetFloor(0);
    }
  }, [booking.isOpen, blockSheet]);

  // D / W / M / Y / L switch views, T jumps to today. Bound because the menu
  // PRINTS these letters: a hint beside a shortcut that does nothing is worse
  // than no hint at all.
  //
  // Skipped while typing, and while EITHER sheet is open. Otherwise entering
  // "Wednesday" in a note would walk the calendar through four views, a
  // customer named Deniz would jump you to the day grid on the D — and the L
  // in a block labelled "Lunch" flipped the whole calendar to the list view
  // under the sheet being typed into.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (booking.isOpen || blockSheet) return;
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
  }, [booking.isOpen, blockSheet]);

  const heading = useMemo(() => {
    const locale = localeFor(language);
    switch (view) {
      case "day":
        return formatDayHeading(anchor, language);
      case "week":
        return formatWeekHeading(startOfWeek(anchor), language);
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
  // ...and the side panel's ticks applied after it, so every view (the grids,
  // the month, the list) draws the same filtered set.
  const withOptimistic = useMemo(
    () =>
      (appointments ?? [])
        .filter(passesFilters)
        .map((appointment) => {
          const pendingMove = optimistic.get(appointment._id);
          return pendingMove ? { ...appointment, ...pendingMove } : appointment;
        }),
    [appointments, optimistic, passesFilters],
  );
  const byDay = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    for (const appointment of appointments ?? []) {
      if (!passesFilters(appointment)) continue;
      const customer = appointment.customer;
      const matches = search.matches(
        customer ? customerName(customer) : "",
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
  }, [appointments, search, passesFilters]);

  return (
    // data-fills-pane only in the grid views. The list PAGE-scrolls and its
    // content ends, so it keeps the shell's bottom padding; the grids scroll
    // inside themselves and take the phone's bottom edge. See AppShell's main.
    // data-calendar-ground: AppShell's main paints itself the plain --pane
    // under this view, without the content wash, and draws a narrower frame
    // (Nudge 5904ddbc: the controls and the side panel share one quiet
    // ground, and only the grid sits on paper).
    <div
      data-fills-pane={view === "list" ? undefined : ""}
      data-calendar-ground=""
      className={
        view === "list" ? "space-y-3" : "flex h-full min-h-0 flex-col gap-3"
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
        {/* Google's menu button: shows and hides the side panel, remembered
            per viewer. While the panel is open the button sits over it, as
            wide as it is, so Today and the period start where the grid does
            (Nudge, Serdar 2026-10-12: "that's how it is in Google Calendar").
            mr-2 makes up the panel's 16px margin against this row's gap-2.
            Its width slides with the panel's, so Today travels with the
            grid's edge instead of jumping ahead of it. Not on a phone, where
            the toolbar's pickers do the panel's job. */}
        <span
          className={`hidden shrink-0 transition-[width,margin-right] duration-200 ease-out motion-reduce:transition-none md:inline-flex ${
            panelOpen ? "md:mr-2 md:w-48" : "md:mr-0 md:w-8"
          }`}
        >
          <HoverTip text={panelOpen ? t("calendar.panelHide") : t("calendar.panelShow")}>
          <button
            type="button"
            aria-label={panelOpen ? t("calendar.panelHide") : t("calendar.panelShow")}
            aria-expanded={panelOpen}
            aria-controls="calendar-panel"
            onClick={togglePanel}
            className={iconButtonClass("quiet", "sm")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          </HoverTip>
        </span>
        {view !== "list" && (
          <>
            {/* h-8, the control scale's 32px declared rather than padded into
                being, like the view menu across the row. */}
            <button
              className={buttonClass("pill", "sm")}
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
            {/* Google's size for the period, 22px at regular weight: the
                one line on the page that says WHEN you are looking at
                (Nudge 80837ddd, Serdar 2026-10-12). It was 14px medium, the
                same voice as a button label beside it. */}
            <h3 className="ml-1 text-[22px] font-normal leading-7">{heading}</h3>
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* The panel's two lists as pickers, on a phone and while the panel
              is closed: a filter is never applied out of sight. */}
          <div className={`flex flex-wrap items-center gap-2 ${panelOpen ? "md:hidden" : ""}`}>
            {staffKeys.length > 1 && (
              <FilterPicker
                allLabel={t("calendar.allTeam")}
                countLabel={(n) => t("calendar.nSelected", { n })}
                options={[
                  ...panelStaff.map((row) => ({
                    id: row._id as string,
                    label: row.name,
                    color: staffSwatch(row.color),
                    ink: staffSwatchInk(row.color),
                  })),
                  ...(withUnassigned
                    ? [
                        {
                          id: UNASSIGNED,
                          label: t("appointments.unassigned"),
                          color: staffSwatch(undefined),
                          ink: staffSwatchInk(undefined),
                        },
                      ]
                    : []),
                ]}
                value={filters.staff}
                onChange={(next) => changeFilters({ staff: next })}
              />
            )}
          </div>
          <ViewMenu view={view} onView={setView} />
        </div>
      </div>

      {/* The side panel beside the views. In the list it is sticky, since the
          page scrolls there; beside a grid it scrolls on its own.

          192px, Google's (Nudge 14e9ee88), and always mounted so it can
          SLIDE (dda32be5): the outer column animates its width and its gap
          (a margin) to zero while the panel inside keeps its 192px, so
          nothing reflows mid-slide. `inert` while closed keeps its controls
          out of the tab order. */}
      <div className={view === "list" ? "flex items-start" : "flex min-h-0 flex-1"}>
      <div
        inert={!panelOpen}
        className={`hidden shrink-0 overflow-hidden transition-[width,margin-right,opacity] duration-200 ease-out motion-reduce:transition-none md:flex ${
          panelOpen ? "mr-4 w-48 opacity-100" : "mr-0 w-0 opacity-0"
        } ${view === "list" ? "sticky top-0 self-start" : "min-h-0"}`}
      >
        <CalendarPanel
          className={
            view === "list"
              ? "flex w-48"
              : "thin-scroll flex w-48 min-h-0 overflow-y-auto"
          }
          anchor={anchor}
          highlight={view === "week" || view === "day" ? visiblePeriod : null}
          onPickDay={(day) => {
            setAnchor(day);
            // The list always reads from today, and the year shows no day;
            // a picked day needs a grid to land on.
            if (view === "list" || view === "year") setView("week");
          }}
          staff={panelStaff}
          withUnassigned={withUnassigned}
          staffFilter={filters.staff}
          onStaffFilter={(next) => changeFilters({ staff: next })}
          isOwner={isOwner}
        />
      </div>
      <div className={view === "list" ? "min-w-0 flex-1 space-y-4" : "flex min-h-0 min-w-0 flex-1 flex-col gap-4"}>

      {appointments !== undefined && byDay.length === 0 && view === "list" && (
        <p className="text-sm text-[var(--muted)]">{t("appointments.none")}</p>
      )}

      {view === "month" && appointments !== undefined && (
        <MonthGrid
          anchor={anchor}
          rows={withOptimistic}
          colorOf={colorOf}
          businessHours={settings?.org.businessHours}
          closures={closures}
          onOpenDay={(dayMs) => {
            setAnchor(dayMs);
            setView("day");
          }}
          onDraftDay={(dayMs) => {
            // A month cell has no minute in it. Opening on the next round hour
            // would be today's clock applied to a day in November; the working
            // morning is the honest default for a day nobody has named a time
            // in yet.
            const startAt = dayMs + DEFAULT_DAY_START * 3_600_000;
            setSheetFloor(0);
            setLastDraft({ startAt, durationMinutes: DEFAULT_DURATION });
            booking.open({ startAt, durationMinutes: DEFAULT_DURATION });
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
                  ? customerName(row.customer)
                  : undefined,
                lines: (row.items ?? []).flatMap((item) =>
                  item.serviceId
                    ? [{ serviceId: item.serviceId, price: item.price, quantity: item.quantity }]
                    : [],
                ),
                staffId: row.staffId ?? null,
                notes: row.notes,
                status: row.status,
                fulfillment: row.fulfillment,
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
          colorOf={colorOf}
          team={panelStaff}
          shownTeam={shownStaff}
          panelOpen={panelOpen}
          view={view}
          anchor={anchor}
          businessHours={settings?.org.businessHours}
          closures={closures}
          timezone={settings?.org.timezone}
          provisional={provisional}
          onOpenBlock={(row, anchor) => {
            booking.open({
              appointmentId: row._id,
              startAt: row.startAt,
              durationMinutes: row.durationMinutes ?? 30,
              customerId: row.customerId,
              customerName: row.customer
                ? customerName(row.customer)
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
              fulfillment: row.fulfillment,
            }, anchor);
          }}
          onDraft={(startAt, durationMinutes, band, anchor, staffId) => {
            setProvisional({ ...band, staffId });
            setSheetFloor(0);
            setLastDraft({ startAt, durationMinutes, anchor, staffId });
            booking.open(
              {
                startAt,
                durationMinutes,
                ...(staffId ? { staffId: staffId as Id<"staff"> } : {}),
              },
              anchor,
            );
          }}
          onOpenClosure={
            isOwner
              ? (row, date, anchorRect) => {
                  setBlockSheet({
                    draft: {
                      closureId: row._id,
                      // A dated row edits its own date; a recurring one takes
                      // the chip's day as the fallback for repeat-off.
                      date: row.date ?? date,
                      endDate: row.endDate,
                      weekdays: row.weekdays,
                      startMinute: row.startMinute,
                      endMinute: row.endMinute,
                      reason: row.reason,
                    },
                    anchor: anchorRect,
                  });
                }
              : undefined
          }
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
              if (!result.canForce) {
                setMoveError(result.reason ?? t("appointments.moveFailed"));
                return;
              }
              // A conflict a person may overrule (the calendar's verdict, or
              // cal.com): ask, then move it with force.
              const ok = await confirm({
                title: t("appointments.anywayMoveTitle"),
                body:
                  conflictText(t, result.verdict, {
                    customer: row.customer
                      ? customerName(row.customer)
                      : undefined,
                    staff: row.staffName,
                  }) ??
                  result.reason ??
                  undefined,
                confirmLabel: t("appointments.moveAnyway"),
                destructive: false,
              });
              if (!ok) return;
              setOptimistic((current) =>
                new Map(current).set(row._id, { startAt, durationMinutes }),
              );
              const forced = await moveBooking({
                appointmentId: row._id,
                startAt,
                durationMinutes,
                force: true,
              });
              if (!forced.ok) {
                clearOptimistic(row._id);
                setMoveError(forced.reason ?? t("appointments.moveFailed"));
              }
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
                {/* The team member's colour, as on the grid: who has it, at a
                    glance (Nudge's list does the same). */}
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    appointment.status === "cancelled" ? "opacity-40" : ""
                  }`}
                  style={{ backgroundColor: staffSwatch(colorOf(appointment.staffId)) }}
                />
                <span className="w-12 font-medium tabular-nums">
                  {formatTime(appointment.startAt, language)}
                </span>
                <span className="min-w-0 flex-1">
                  <button
                    className="block max-w-full truncate text-left font-medium hover:underline"
                    onClick={() => onOpenContact(appointment.customerId)}
                  >
                    {appointment.customer
                      ? customerName(appointment.customer)
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
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[appointment.status]}`}
                >
                  {t(STATUS_KEY[appointment.status])}
                </span>
                <AppointmentRowMenu
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
      </div>

      {confirmDialog}
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

      {booking.render(
        isOwner ? (
          <SheetKindTabs
            kind="appointment"
            onKind={(kind) => {
              if (kind === "block") switchToBlock();
            }}
          />
        ) : undefined,
        {
          // Only while the kind tabs are up: a floor exists to keep two
          // sheets in one spot, and a member never sees the second one.
          heightFloor: isOwner && sheetFloor > 0 ? sheetFloor : undefined,
          onNaturalHeight: isOwner ? growSheetFloor : undefined,
          onSlotChange: followBand,
        },
      )}
      {blockSheet && (
        <BlockSheet
          draft={blockSheet.draft}
          anchor={blockSheet.anchor}
          // The same floor, on the sheet a grid gesture opened; an existing
          // block is not half of a choice and keeps its own height.
          heightFloor={
            blockSheet.draft.closureId === undefined && sheetFloor > 0 ? sheetFloor : undefined
          }
          onNaturalHeight={
            blockSheet.draft.closureId === undefined ? growSheetFloor : undefined
          }
          tabs={
            // Tabs only on the sheet a grid gesture opened: an existing block
            // is not half of a choice, so a chip's sheet has none.
            blockSheet.draft.closureId === undefined && lastDraft ? (
              <SheetKindTabs
                kind="block"
                onKind={(kind) => {
                  if (kind !== "appointment" || !lastDraft) return;
                  setBlockSheet(null);
                  booking.open(
                    {
                      startAt: lastDraft.startAt,
                      durationMinutes: lastDraft.durationMinutes,
                      ...(lastDraft.staffId
                        ? { staffId: lastDraft.staffId as Id<"staff"> }
                        : {}),
                    },
                    lastDraft.anchor,
                  );
                }}
              />
            ) : undefined
          }
          onClose={() => setBlockSheet(null)}
        />
      )}
    </div>
  );
}

type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show";

// Row actions live behind a hover-revealed ⋯ menu (Nudge convention: row
// actions show on hover only). Items are contextual verbs, never a repeat of
// the status pill's label. The shared RowMenu since 2026-10-13: this copy
// positioned itself and closed whenever anything scrolled.
function AppointmentRowMenu({
  status,
  onSetStatus,
}: {
  status: AppointmentStatus;
  onSetStatus: (status: AppointmentStatus) => void;
}) {
  const { t } = useLanguage();
  const items: { key: string; label: string; status: AppointmentStatus; danger?: boolean }[] =
    status === "scheduled" || status === "confirmed"
      ? [
          { key: "complete", label: t("appointments.complete"), status: "completed" },
          { key: "noshow", label: t("appointments.noShow"), status: "no_show" },
          { key: "cancel", label: t("appointments.cancel"), status: "cancelled", danger: true },
        ]
      : [{ key: "reopen", label: t("appointments.reopen"), status: "scheduled" }];

  return (
    <RowMenu
      reveal
      label={t("appointments.actions")}
      items={items.map((item) => ({
        key: item.key,
        label: item.label,
        danger: item.danger,
        onSelect: () => onSetStatus(item.status),
      }))}
    />
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

// The side panel's slide (Tailwind's duration-200 on its column); the grid
// re-measures its columns once it has finished.
const PANEL_SLIDE_MS = 200;
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
  fulfillment?: { kind: "pickup" | "delivery"; asap?: boolean; address?: string };
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
  if (status === "confirmed") return "bg-[var(--event)] text-[var(--event-fg)]";
  return "bg-[color-mix(in_srgb,var(--event)_72%,var(--card))] text-[var(--event-fg)]";
}

// Body in lib/datetime, alongside addLocalDays — the two have to agree about
// what a day is, and they were in different files.
const startOfDay = startOfLocalDay;

const VIEW_MENU_W = 176;

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
  // Portal + fixed through the shared hook, which follows the button when the
  // page scrolls. It closed on scroll before, like every hand-rolled menu
  // here. Not `absolute`: the shell's main pane scrolls, so an absolute child
  // clips there — the rule in AGENTS.md that this repo keeps re-learning.
  const { triggerRef, panelRef, pos, open, toggle, close } = useAnchoredPanel(
    VIEW_MENU_W,
    VIEW_MODES.length * 32 + 8,
  );

  const current = VIEW_MODES.find((mode) => mode.id === view);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        // A raised pill, twin to the Today button across the row: the two
        // ends of the header carry the same weight, Google's balance.
        className={buttonClass("pill", "sm")}
      >
        {current ? t(current.key) : ""}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
            }}
            className="menu-surface z-[100] overflow-hidden rounded-lg py-1"
          >
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="menuitemradio"
                aria-checked={view === mode.id}
                onClick={() => {
                  onView(mode.id);
                  close();
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

// The gutter-corner offset chip, in the viewer's zone (the one the grid is
// drawn in). Ink, not the timestamp grey — it is a grid coordinate like the
// hour labels beside it. Hovering (or focusing) it names the zone in full,
// instantly: "GMT+03" is ambiguous the two weeks a year when DST makes
// Istanbul and Vienna disagree about it. Portal + fixed for the tip, the
// InfoTip rule — the header sits over a scroll container.
function GmtBadge({ at }: { at: number }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const zoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
        {gmtLabel(zoneName, at)}
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
  // Day view: whose column this is, a staff id or UNASSIGNED. A click here
  // books that person, and the open sheet's band lands in its person's
  // column.
  staffId?: string;
  // Their resolved colour, for the dot before the name in the header.
  color?: string;
  rows: CalendarAppointment[];
};

// The grid's width before it has been measured (a laptop, no side panel). It
// is measured from then on (see gridWidth in Calendar): an estimate was fine
// while the grid had the pane to itself, and wrong by a quarter once the side
// panel could take 15rem of it, so chips kept a time they had no room for.
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
  // The column the gesture is in. A day is not enough once day view has a
  // column per person: every column shares the day, and a drawn band keyed on
  // the day alone lit up in all of them.
  columnKey: string;
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
  closures,
  timezone,
  onOpenClosure,
  colorOf,
  team,
  shownTeam,
  panelOpen,
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
    // The person whose day-view column it was drawn in, so the sheet opens
    // with them picked.
    staffId?: string,
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
    days?: ({ startMinute: number; endMinute: number } | null)[];
  };
  // Shut time INSIDE the hours above, cut out of the open bands so the lunch
  // break greys exactly like the evening does.
  closures?: ClosureRow[];
  // The BUSINESS's IANA zone — what the closed shading is computed in.
  timezone?: string;
  // Click on a closure's label chip: hand the row up (plus the chip's civil
  // date, for recurring rows that need a repeat-off fallback) and let the
  // parent open the block sheet. Absent for staff — closure writes are
  // owner-only, and a chip that opens a sheet whose Save throws is a door
  // painted on a wall.
  onOpenClosure?: (row: ClosureRow, date: string, anchor: Rect) => void;
  // A team member's resolved colour key, so a booking wears it
  // (lib/staffTint.ts). Undefined means the default lavender.
  colorOf: (staffId?: string) => string | undefined;
  // The team as the side panel lists it, in the Team card's order, and which
  // of them (or UNASSIGNED) the panel shows: day view's columns.
  team: { _id: string; name: string; color: string; active: boolean }[];
  shownTeam: string[];
  // The side panel takes width from the grid beside it.
  panelOpen: boolean;
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
  // The columns are the TEAM, in the Team card's order (dragging someone up
  // there moves their column here, as staff.reorder always promised; the
  // columns used to sort by name), filtered by the side panel: everyone on
  // the team who is shown, with or without a booking that day, because an
  // empty column is the answer to "who is free". A deactivated person gets a
  // column only on a day they still have a booking. Unassigned trails, and
  // only when something that day is unassigned. A business with no team is
  // one plain column, as before. They used to be derived from whoever had a
  // booking that day, from when staff was free text: a person with a free
  // day had no column to book them into.
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
    if (team.length === 0) return [{ key: String(day), day, rows }];
    const known = new Set(team.map((person) => person._id));
    const byStaff: CalendarColumn[] = team
      .filter(
        (person) =>
          shownTeam.includes(person._id) &&
          (person.active || rows.some((row) => row.staffId === person._id)),
      )
      .map((person) => ({
        key: `${day}:${person._id}`,
        day,
        label: person.name,
        staffId: person._id,
        color: person.color,
        rows: rows.filter((row) => row.staffId === person._id),
      }));
    // A booking whose person is no longer on the team at all reads as
    // unassigned here: there is nobody left to give it a column.
    const unassigned = rows.filter((row) => !row.staffId || !known.has(row.staffId));
    if (shownTeam.includes(UNASSIGNED) && unassigned.length > 0) {
      byStaff.push({
        key: `${day}:${UNASSIGNED}`,
        day,
        label: t("appointments.unassigned"),
        staffId: UNASSIGNED,
        rows: unassigned,
      });
    }
    // Everyone filtered out who has nothing that day: still a grid to book on.
    return byStaff.length > 0 ? byStaff : [{ key: String(day), day, rows }];
  }, [view, days, visible, team, shownTeam, t]);

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
  // Only a MOVE crosses columns, and only in week view: there a column is a
  // day, in day view it is a person, and a drag must not quietly hand a
  // booking to somebody else.
  const canMoveAcrossColumns = view === "week";

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

  // The day columns' width, measured: after layout, on a window resize, and
  // whenever the side panel opens or closes or the columns change. A layout
  // effect and a resize listener, not a ResizeObserver, whose callbacks never
  // arrived in this app (AnchoredSheet's note). The panel SLIDES (200ms), so
  // the width at the toggle is the old one; a second measure lands after the
  // slide, or a drag right after closing it would snap to narrow columns.
  const [gridWidth, setGridWidth] = useState(APPROX_GRID_PX);
  useLayoutEffect(() => {
    const measure = () => {
      const body = gridRef.current;
      if (!body) return;
      const width = body.offsetWidth - (gutterRef.current?.offsetWidth ?? 0);
      if (width > 0) setGridWidth(width);
    };
    measure();
    const afterSlide = window.setTimeout(measure, PANEL_SLIDE_MS + 50);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(afterSlide);
      window.removeEventListener("resize", measure);
    };
  }, [panelOpen, columns.length]);
  const columnPx = gridWidth / columns.length;

  const minuteAtClientY = (clientY: number): number => {
    const body = gridRef.current;
    if (!body) return dayStart * 60;
    return minuteAt(clientY, body.getBoundingClientRect().top, dayStart, HOUR_PX);
  };

  // Measured, not assumed: the gutter's width is a Tailwind class today and a
  // wrong constant here would land every drag one column off.
  const columnAtClientX = (clientX: number): CalendarColumn | undefined => {
    const body = gridRef.current;
    if (!body || columns.length === 0) return undefined;
    const rect = body.getBoundingClientRect();
    const index = columnIndexAt(
      clientX,
      rect.left,
      gutterRef.current?.offsetWidth ?? 0,
      rect.width,
      columns.length,
    );
    return columns[index];
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
    // `day` and the column go AFTER the spread: advanceDrag carries the whole
    // object through, so putting them first would let the old day overwrite
    // the new one on every single move. Only week view crosses columns (see
    // canMoveAcrossColumns).
    const target =
      drag.kind === "move" && canMoveAcrossColumns ? columnAtClientX(event.clientX) : undefined;
    const day = target?.day ?? drag.day;
    const columnKey = target?.key ?? drag.columnKey;
    setDrag((current) =>
      current ? { ...current, ...advanceDrag(current, minute), day, columnKey } : current,
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
      // A plain click on a blocked band means "this block", not "book here":
      // the label chip was the only way to reopen a block, and at ten pixels
      // tall nobody found it — owners kept drawing fresh blocks on top of the
      // one they could not select. DRAGGING over a block still draws a slot,
      // so booking into the lunch hour on purpose keeps working (the wash-not-
      // wall rule governs the offer, not the owner).
      if (
        current.kind === "create" &&
        !current.moved &&
        onOpenClosure &&
        closures &&
        anchorRect
      ) {
        const p = getLocalPartsSafe(startAt, timezone);
        const hit = closures.find(
          (row) =>
            closureAppliesToDay(row, p) &&
            p.minutesOfDay >= (row.startMinute ?? 0) &&
            p.minutesOfDay < (row.endMinute ?? 24 * 60),
        );
        if (hit) {
          setDrag(null);
          onOpenClosure(hit, isoDateOf(p), anchorRect);
          return;
        }
      }
      setDrag(null);
      // The band shows the BOOKING, not the gesture. A click is a gesture with
      // no height at all, and dragResult turns it into a default-length
      // appointment; drawing the gesture left a hairline on the grid next to a
      // sheet offering to book half an hour.
      const startedAt = new Date(startAt);
      const startMinute = startedAt.getHours() * 60 + startedAt.getMinutes();
      const column = columns.find((c) => c.key === current.columnKey);
      onDraft(
        startAt,
        durationMinutes,
        {
          day: current.day,
          startMinute,
          endMinute: startMinute + durationMinutes,
          columnKey: current.columnKey,
        },
        anchorRect,
        // A person's column books that person; Unassigned books nobody.
        column?.staffId && column.staffId !== UNASSIGNED ? column.staffId : undefined,
      );
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
    const dayEndMs = day + DAY_MS;
    const open: { from: number; to: number }[] = [];
    const seen = new Set<string>();
    for (const instant of [day, dayEndMs - 1]) {
      const p = getLocalPartsSafe(instant, timezone);
      const key = `${p.y}-${p.m0}-${p.d}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // THIS weekday's window, through the same normaliser the booking page
      // reads — a second client-side interpretation of the legacy fields is
      // how the grid ends up shading a day the page will happily book.
      const win = windowForWeekday(businessHours, p.weekday);
      if (!win) continue;
      // The day's open window, cut by every closure that lands on it. A lunch
      // break therefore shades exactly like the evening does: the grid says
      // "shut" in one visual language, and a second one for closures would
      // make the reader learn which grey means what.
      let segments: { from: number; to: number }[] = [
        { from: win.startMinute, to: win.endMinute },
      ];
      for (const cut of closuresOnDay(closures, p)) {
        segments = segments.flatMap((seg) => {
          if (cut.to <= seg.from || cut.from >= seg.to) return [seg];
          const kept: { from: number; to: number }[] = [];
          if (seg.from < cut.from) kept.push({ from: seg.from, to: cut.from });
          if (cut.to < seg.to) kept.push({ from: cut.to, to: seg.to });
          return kept;
        });
      }
      try {
        for (const seg of segments) {
          open.push({
            from: localWallTimeToUtcMs(
              p.y,
              p.m0,
              p.d,
              Math.floor(seg.from / 60),
              seg.from % 60,
              timezone ?? "UTC",
            ),
            to: localWallTimeToUtcMs(
              p.y,
              p.m0,
              p.d,
              Math.floor(seg.to / 60),
              seg.to % 60,
              timezone ?? "UTC",
            ),
          });
        }
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

  // Each closure's own band on this column, as a row to pin a label chip on.
  // The SHADING stays closedBands' job — one grey for every kind of shut —
  // this only adds the name tag that makes a block editable now that the
  // settings card is gone. Same civil-date walk and the same projection as
  // closedBands, so a chip can never sit beside a band it does not label.
  const closureChips = (
    day: number,
  ): { row: ClosureRow; date: string; top: number }[] => {
    if (!closures || closures.length === 0) return [];
    const dayEndMs = day + DAY_MS;
    const chips: { row: ClosureRow; date: string; top: number }[] = [];
    const seen = new Set<string>();
    for (const instant of [day, dayEndMs - 1]) {
      const p = getLocalPartsSafe(instant, timezone);
      const key = `${p.y}-${p.m0}-${p.d}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // The chip's minute is clamped INTO the day's open window: an all-day
      // holiday starts at midnight, and a label pinned there lives above the
      // scroll where nobody ever sees it. Pinned to opening time instead, it
      // sits exactly where the grid auto-scrolls to.
      const win = windowForWeekday(businessHours ?? {}, p.weekday);
      for (const row of closures) {
        if (!closureAppliesToDay(row, p)) continue;
        const to = row.endMinute ?? 24 * 60;
        const from = Math.min(
          win ? Math.max(row.startMinute ?? 0, win.startMinute) : row.startMinute ?? 0,
          to,
        );
        try {
          const fromMs = localWallTimeToUtcMs(
            p.y,
            p.m0,
            p.d,
            Math.floor(from / 60),
            from % 60,
            timezone ?? "UTC",
          );
          const toMs = localWallTimeToUtcMs(
            p.y,
            p.m0,
            p.d,
            Math.floor(to / 60),
            to % 60,
            timezone ?? "UTC",
          );
          const a = Math.max(fromMs, day);
          if (Math.min(toMs, dayEndMs) <= a) continue;
          chips.push({
            row,
            date: isoDateOf(p),
            top: ((a - day) / 3_600_000) * HOUR_PX,
          });
        } catch {
          // Same rule as closedBands: a malformed timezone paints nothing
          // rather than something confidently wrong.
          return [];
        }
      }
    }
    // Chips that land on the same hour stack instead of overprinting: an
    // all-day holiday and a lunch block both clamp to opening time, and two
    // labels drawn at one `top` smear into a single unreadable word.
    const CHIP_H = 22;
    chips.sort((a, b) => a.top - b.top);
    for (let i = 1; i < chips.length; i++) {
      if (chips[i].top < chips[i - 1].top + CHIP_H) {
        chips[i] = { ...chips[i], top: chips[i - 1].top + CHIP_H };
      }
    }
    return chips;
  };

  // Which column the band is drawn in. A gesture draws where it is. An open
  // sheet's band is on its day: in the column of the person the sheet has
  // picked when the day has one per person (so changing the Team member
  // select moves it across), else where it was drawn, else the day's first.
  // It used to match on the day alone, so in day view one click lit a band in
  // every person's column.
  const bandColumnKey = (() => {
    if (drag) return drag.columnKey;
    if (!provisional) return null;
    const sameDay = columns.filter((column) => column.day === provisional.day);
    if (sameDay.length === 0) return null;
    if (sameDay.length === 1) return sameDay[0].key;
    const byPerson = sameDay.find(
      (column) => column.staffId === (provisional.staffId ?? UNASSIGNED),
    );
    if (byPerson) return byPerson.key;
    return sameDay.some((column) => column.key === provisional.columnKey)
      ? (provisional.columnKey ?? null)
      : sameDay[0].key;
  })();

  return (
    // The grid is a card, the plane around it the calendar's plain --pane
    // ground (AppShell, data-calendar-ground). Everything
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
      <div className="flex border-b-[0.5px] border-[var(--grid-line)] pr-[10px] pt-3">
        {/* The gutter's slice of the header carries the UTC offset, exactly
            where Google puts it: it labels the hour column under it. The
            VIEWER's offset, because the hours under it are the viewer's clock
            (every column is a local day, every label a local hour). It printed
            the business's zone, so an owner checking an Istanbul salon from
            Kuala Lumpur read "GMT+03" over a column of Malaysian hours. Nudge
            caught this porting the grid. The closed shading still comes from
            the business's hours, projected onto these local hours. */}
        <div className="flex w-12 shrink-0 items-end justify-end pb-2 pr-2">
          <GmtBadge at={days[0]} />
        </div>
        {staffColumns
          ? columns.map((column) => (
              <div
                key={column.key}
                className="min-w-0 flex-1 pb-2 text-center text-sm font-medium"
              >
                {/* The person's colour before their name: the key to the
                    chips in their column, and the dot the side panel and the
                    Team card show. */}
                <span className="flex min-w-0 items-center justify-center gap-1.5 px-1">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: staffSwatch(column.color) }}
                  />
                  <span className="truncate">{column.label}</span>
                </span>
              </div>
            ))
          : days.map((day) => {
              const isToday = startOfDay(now) === day;
              return (
                // Google Calendar's day header (Nudge 8fee4481): a small
                // weekday over a BIG date, today's date in a filled circle
                // and its weekday in the same blue. The date is the
                // coordinate, so it carries the size; the weekday only
                // qualifies it. Sentence case, never Google's capitals: no
                // uppercase anywhere is Serdar's oldest standing rule.
                <div key={day} className="min-w-0 flex-1 pb-2 text-center">
                  <div
                    className={`text-[11px] font-medium ${
                      isToday ? "text-[var(--accent)]" : "text-[var(--muted-strong)]"
                    }`}
                  >
                    {new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(day))}
                  </div>
                  <div
                    className={`mx-auto mt-1 flex h-10 w-10 items-center justify-center rounded-full text-[22px] tabular-nums ${
                      isToday ? "bg-[var(--accent)] text-white" : "text-[var(--foreground)]"
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
              the line marks rather than as a band. 10px in the strong grey,
              Google's measure (Nudge 8fee4481): the hour is a coordinate the
              eye finds by position, and at the old 11px ink it out-shouted
              the bookings it was there to locate. */}
          <div ref={gutterRef} className="relative w-12 shrink-0">
            {hours.map((hour, i) => (
              <span
                key={hour}
                // The first label would be half cut by the top edge, so it
                // hangs below its line instead of centring on it.
                className={`absolute right-2 text-[10px] tabular-nums text-[var(--muted-strong)] ${
                  i === 0 ? "" : "-translate-y-1/2"
                }`}
                style={{ top: i * HOUR_PX }}
              >
                {`${String(hour).padStart(2, "0")}:00`}
              </span>
            ))}
            {/* No clock in the gutter beside the now-line (Nudge 50b514f1,
                Serdar 2026-10-12): Google draws the dot and the line only. The
                red badge sat on the hour labels for ten minutes either side of
                every hour, and the screen already has a clock. */}
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
                className={`relative min-w-0 flex-1 border-b-[0.5px] border-l-[0.5px] border-[var(--grid-line)] ${
                  columnIndex === columns.length - 1
                    ? "border-r-[0.5px] border-[var(--grid-line)]"
                    : ""
                }`}
                // Pointer down on the column ITSELF (never on a block, which
                // stops propagation) starts drawing a new slot.
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  const minute = minuteAtClientY(event.clientY);
                  startDrag(
                    {
                      kind: "create",
                      day: column.day,
                      columnKey: column.key,
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
                {/* Hour lines, Google Calendar's way (measured off it in
                    Nudge, 2026-10-12): one 1px BORDER per hour. They were a
                    repeating gradient, which has no pixel to snap to, so at
                    110% browser zoom a line smeared across two and read dark
                    and rough; a border lands on one. Hours only: the faint
                    half-hour line went as clutter (Nudge 8fee4481), and a drag
                    still snaps to 15 minutes. HALF a CSS pixel, every grid
                    line (Nudge f360cad5): Google declares 1px but is read at
                    90% zoom, where that is ONE device pixel on a 2x screen;
                    our 1px at 100% was two, the same colour at twice the
                    weight. 0.5px is one device pixel on a 2x screen at any
                    zoom, and a 1x screen still draws 1px. Compare zoom AND
                    devicePixelRatio before calling a line thicker. The first
                    hour's line is the header's own bottom border. Drawn AFTER
                    the closed bands,
                    so every hour line sits over the shading (the calendar
                    rule in design-language.md). */}
                {hours.slice(1).map((hour) => (
                  <div
                    key={`line-${hour}`}
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 border-t-[0.5px] border-[var(--grid-line)]"
                    style={{ top: (hour - dayStart) * HOUR_PX }}
                  />
                ))}
                {/* Each closure's name tag, pinned to the top of its band.
                    The band itself stays inert grid — a salon books into its
                    own lunch hour on purpose — so the chip and the band's
                    click both lead to the block. Foreground and medium, the
                    same voice as an appointment chip: this is the block's
                    NAME, and at ten muted pixels it whispered (Serdar,
                    2026-08-31: stop the defensive colours). */}
                {closureChips(column.day).map((chip, index) =>
                  onOpenClosure ? (
                    <button
                      key={`${chip.row._id}:${index}`}
                      type="button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) =>
                        onOpenClosure(chip.row, chip.date, rectOf(event.currentTarget))
                      }
                      className="absolute left-1 z-10 max-w-[calc(100%-8px)] truncate rounded px-1 py-0.5 text-left text-xs font-medium leading-tight text-[var(--foreground)] transition-colors hover:bg-[var(--muted-bg)]"
                      style={{ top: chip.top + 1 }}
                    >
                      {chip.row.reason || t("closures.blockLabel")}
                    </button>
                  ) : (
                    <span
                      key={`${chip.row._id}:${index}`}
                      className="pointer-events-none absolute left-1 z-10 max-w-[calc(100%-8px)] truncate rounded px-1 py-0.5 text-left text-xs font-medium leading-tight text-[var(--foreground)]"
                      style={{ top: chip.top + 1 }}
                    >
                      {chip.row.reason || t("closures.blockLabel")}
                    </span>
                  ),
                )}
                {/* The slot being drawn, the block being dragged, or the slot
                    the open sheet belongs to. The third case is what makes an
                    anchored sheet read as attached to the calendar instead of
                    floating over it: Google keeps the block it just drew lit
                    for exactly as long as its popover is up. */}
                {(() => {
                  const band = column.key === bandColumnKey ? (drag ?? provisional) : null;
                  if (!band) return null;
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
                      // A booking being moved keeps its person's colour; a
                      // fresh slot wears whoever the open sheet has picked,
                      // and the default until somebody is.
                      className={`${STAFF_TINT} pointer-events-none absolute z-20 overflow-hidden rounded-md px-1.5 py-0.5 text-[11px] leading-tight opacity-90 shadow-md ${
                        band.day + band.endMinute * 60_000 < now
                          ? "bg-[var(--event-past)] text-[var(--event-past-fg)]"
                          : "bg-[var(--event)] text-[var(--event-fg)]"
                      }`}
                      style={{
                        ...staffTint(
                          colorOf(drag ? drag.row?.staffId : provisional?.staffId),
                        ),
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
                    ? customerName(row.customer)
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
                            columnKey: column.key,
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
                        // The team member's colour (lib/staffTint.ts); the
                        // washes follow it through the class below.
                        ...staffTint(colorOf(row.staffId)),
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
                      className={`${STAFF_TINT} absolute cursor-grab overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight ring-1 ring-[var(--card)] transition-opacity hover:opacity-80 active:cursor-grabbing ${blockStyle(
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
                      {/* Google Calendar's order: WHO first, then when
                          (Nudge 8fee4481). The block's position on the grid
                          already says when it is, so the clock is the
                          redundant half and the name leads. A half-hour block
                          is one line tall: "Ayşe Yılmaz, 10:00", the time
                          dropped when the lane is too narrow for both (two
                          15:30 blocks both reading "15:30" told you nothing).
                          Taller blocks put the span under the name, and the
                          service under that when there is room. A goods order
                          has a moment, not a span, so it prints its start. */}
                      {height < 40 ? (
                        <span className="block truncate">
                          <span className="font-medium">
                            {name || formatTime(row.startAt, language)}
                          </span>
                          {!narrow && name && (
                            <span className="tabular-nums">
                              , {formatTime(row.startAt, language)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <>
                          <span className="block truncate font-medium">{name}</span>
                          <span className="block truncate tabular-nums">
                            {narrow || isGood
                              ? formatTime(row.startAt, language)
                              : `${formatTime(row.startAt, language)} – ${formatTime(
                                  row.startAt +
                                    (row.durationMinutes ?? DEFAULT_DURATION) * 60_000,
                                  language,
                                )}`}
                          </span>
                          {height > 60 && !narrow && row.serviceName && (
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
                    // A 1.5px line and a 10px dot, centred on it (Nudge
                    // ac76510e, Serdar 2026-10-13: "thinner, a bit subtler").
                    // At 2px and 12px it was the loudest mark on a dark grid.
                    className="pointer-events-none absolute inset-x-0 z-30 border-t-[1.5px] border-[var(--now-line)]"
                    style={{ top: ((minutesInto(now) - dayStart * 60) / 60) * HOUR_PX }}
                  >
                    <span className="absolute -left-[5px] -top-[5.75px] h-2.5 w-2.5 rounded-full bg-[var(--now-line)]" />
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
