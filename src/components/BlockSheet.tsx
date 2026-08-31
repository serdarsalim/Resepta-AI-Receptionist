"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import {
  localeFor,
  minutesToTimeValue,
  timeValueToMinutes,
  weekdayNames,
} from "@/lib/datetime";
import { placeBeside, type Placement, type Rect } from "@/lib/anchoredSheet";
import { FIELD } from "./RowLabel";
import { useConfirm } from "./ConfirmDialog";

// The calendar's OTHER kind of thing to draw: time the business is shut inside
// its own hours. A lunch break, a holiday, a morning off — drawn on the grid
// exactly where an appointment would be, because that is where the owner
// thinks about it. This replaced a "Closures" card in Business settings whose
// Add button nobody found: settings are read twice a year, the calendar forty
// times a day.
//
// Backed by the closures table unchanged. A block IS a closure row — recurring
// (weekdays + window) or one-off (date + window) — so the booking page, the
// phone agent and WhatsApp all keep refusing these times without learning
// anything new. The label typed here is the closure's `reason`, which the
// agents can already say out loud ("we're closed for the holiday that day").
//
// Same popover chrome as AppointmentModal: anchored beside the drawn slot when
// there is room, full-width bottom sheet on a phone. The two sheets swap into
// the same spot when the kind tabs switch, so choosing "blocked time" reads as
// the form changing, not a new window opening.

const PANEL_W = 448;

// What the sheet opens against. Everything here is in the BUSINESS's own
// civil terms — a closure is "13:00 in the salon", never a UTC instant — so
// the caller does the one projection (getLocalPartsSafe on the drawn slot)
// and this sheet never touches a timezone again.
export type BlockDraft = {
  closureId?: Id<"closures">;
  // The civil date the sheet was opened from. A dated closure stores it; a
  // recurring one keeps it only as the fallback for switching repeat off.
  date: string;
  // Last blocked day of a one-off, inclusive — the ten-day holiday as one
  // row. Absent means the single day `date` names.
  endDate?: string;
  weekdays?: number[];
  // Both absent = all day (the closures convention: unset bounds survive an
  // hours change, 00:00-24:00 would freeze a clock into the row).
  startMinute?: number;
  endMinute?: number;
  reason?: string;
};

// Weekday of a civil date, zone-free: the calendar fact "2026-09-01 is a
// Tuesday" does not depend on who is asking.
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

// The tab row both create-sheets wear, in the app's chip grammar. Google
// Calendar's quick-create tabs (Event | Task): one gesture on the grid, and
// the first row of the popup asks what you meant.
export function SheetKindTabs({
  kind,
  onKind,
}: {
  kind: "appointment" | "block";
  onKind: (kind: "appointment" | "block") => void;
}) {
  const { t } = useLanguage();
  return (
    <div role="tablist" className="flex flex-wrap gap-1.5">
      {(["appointment", "block"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          aria-selected={kind === option}
          onClick={() => {
            if (option !== kind) onKind(option);
          }}
          className={`rounded-full px-3 py-1 text-sm transition-colors ${
            kind === option
              ? "bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
              : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          }`}
        >
          {t(option === "appointment" ? "calendar.tabAppointment" : "calendar.tabBlock")}
        </button>
      ))}
    </div>
  );
}

export function BlockSheet({
  draft,
  anchor,
  tabs,
  onClose,
}: {
  draft: BlockDraft;
  // The drawn slot (or the chip) this sheet belongs to, in viewport
  // coordinates. Same contract as AppointmentModal's anchor.
  anchor?: Rect;
  // The kind tabs, when this sheet was reached by drawing on the grid. Absent
  // when editing an existing block — a saved closure is not half of a choice.
  tabs?: React.ReactNode;
  onClose: () => void;
}) {
  const { t, language } = useLanguage();
  const dayNames = weekdayNames(language, "long");
  const add = useMutation(api.closures.add);
  const update = useMutation(api.closures.update);
  const remove = useMutation(api.closures.remove);
  const [confirm, confirmDialog] = useConfirm();

  const panelRef = useRef<HTMLDivElement>(null);

  const [reason, setReason] = useState(draft.reason ?? "");
  const [allDay, setAllDay] = useState(
    draft.startMinute == null && draft.endMinute == null && draft.closureId !== undefined,
  );
  const [startMinute, setStartMinute] = useState<number | null>(
    draft.startMinute ?? 13 * 60,
  );
  const [endMinute, setEndMinute] = useState<number | null>(
    draft.endMinute ?? 14 * 60,
  );
  // Once, weekly on chosen days, or daily. Daily is not a third row shape —
  // it is weekdays [0..6], so a row saved as "every day" reopens as exactly
  // that and the engine never learns a new word. A closure on a closed day
  // blocks nothing, so "every day" is safe for a salon shut on Sundays.
  const [cadence, setCadence] = useState<"once" | "weekly" | "daily">(
    (draft.weekdays?.length ?? 0) === 7
      ? "daily"
      : draft.weekdays?.length
        ? "weekly"
        : "once",
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    draft.weekdays?.length ? draft.weekdays : [weekdayOf(draft.date)],
  );
  // "" = the single drawn day. The input's min already refuses earlier dates;
  // `ready` repeats the check because min is advice to a date picker, not a
  // rule against a typed value.
  const [endDate, setEndDate] = useState(draft.endDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const values = {
    weekdays:
      cadence === "daily"
        ? [0, 1, 2, 3, 4, 5, 6]
        : cadence === "weekly"
          ? weekdays
          : undefined,
    date: cadence === "once" ? draft.date : undefined,
    endDate: cadence === "once" && endDate ? endDate : undefined,
    startMinute: allDay ? undefined : startMinute ?? undefined,
    endMinute: allDay ? undefined : endMinute ?? undefined,
    reason: reason.trim() || undefined,
  };

  const ready =
    (cadence !== "weekly" || weekdays.length > 0) &&
    (cadence !== "once" || !endDate || endDate >= draft.date) &&
    (allDay ||
      (startMinute != null && endMinute != null && startMinute < endMinute));

  // How many bookings already sit inside this block — said before Save, never
  // acted on. WITHOUT `reason`: the count never reads it, and convex/react
  // keys the subscription on serialised args, so including it re-collected
  // ninety days of appointments once per typed character.
  const inside = useQuery(
    api.closures.appointmentsInside,
    ready
      ? {
          weekdays: values.weekdays,
          date: values.date,
          endDate: values.endDate,
          startMinute: values.startMinute,
          endMinute: values.endMinute,
        }
      : "skip",
  );

  // Same placement dance as AppointmentModal: measured after layout so the
  // panel's REAL height decides whether it slides up, re-run on everything
  // that changes that height. Below MIN_ANCHORED_WIDTH placeBeside answers
  // null and the sheet falls back to the centred card.
  const [placement, setPlacement] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    if (!anchor) {
      setPlacement(null);
      return;
    }
    const measure = () => {
      const el = panelRef.current;
      if (!el) return;
      const next = placeBeside(
        anchor,
        { width: PANEL_W, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setPlacement((current) =>
        current &&
        next &&
        current.top === next.top &&
        current.left === next.left &&
        current.side === next.side
          ? current
          : next,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // cadence swaps a prose line for a row of day chips, error and the count
    // line appear mid-edit: each one moves Save, so each re-measures.
  }, [anchor, cadence, error, inside]);

  // Escape closes this sheet only — capture phase, stopped, so the calendar's
  // own key handling never sees it. Same pattern as AppointmentModal.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      if (draft.closureId) await update({ closureId: draft.closureId, ...values });
      else await add(values);
      onClose();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      setError(
        raw.includes("closure-empty-window") || raw.includes("closure-partial-window")
          ? t("closures.errWindow")
          : raw.includes("closure-bad-range")
            ? t("closures.errRange")
            : raw.includes("closure-covered")
              ? t("closures.errCovered")
              : t("closures.errKind"),
      );
    } finally {
      setSaving(false);
    }
  };

  const dateProse = new Intl.DateTimeFormat(localeFor(language), {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${draft.date}T00:00:00`));

  return createPortal(
    <div
      className={
        placement
          ? "fixed inset-0 z-50"
          : "fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      }
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={placement ? undefined : true}
        aria-label={t(draft.closureId ? "closures.edit" : "closures.add")}
        style={
          placement
            ? { position: "fixed", top: placement.top, left: placement.left, width: PANEL_W }
            : undefined
        }
        className={
          placement
            ? "max-h-[90vh] overflow-y-auto rounded-3xl border border-transparent bg-[var(--card)] p-5 shadow-2xl dark:border-[var(--border)]"
            : "max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-transparent bg-[var(--card)] p-5 shadow-xl dark:border-[var(--border)] sm:rounded-3xl"
        }
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          {tabs ?? <span />}
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          >
            <XIcon />
          </button>
        </div>

        <div className="space-y-4">
          {/* The label leads, like Google's title field. It is the closure's
              `reason`, so whatever is typed here is what the phone and
              WhatsApp agents can give as the why. */}
          <input
            type="text"
            autoFocus
            aria-label={t("closures.reason")}
            className={`${FIELD} w-full`}
            placeholder={t("closures.reasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={allDay}
              onClick={() => setAllDay(!allDay)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors ${
                allDay
                  ? "bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              }`}
            >
              {t("closures.allDay")}
            </button>
            {/* Disabled rather than removed when all-day is on: the row keeps
                its height and the typed times survive the round trip. */}
            <input
              type="time"
              aria-label={t("settings.openFrom")}
              disabled={allDay}
              className={`${FIELD} min-w-0 flex-1 disabled:opacity-40`}
              value={startMinute == null ? "" : minutesToTimeValue(startMinute)}
              onChange={(e) => setStartMinute(timeValueToMinutes(e.target.value) ?? null)}
            />
            <span className="shrink-0 text-sm text-[var(--muted)]">
              {t("settings.openUntil")}
            </span>
            <input
              type="time"
              aria-label={t("settings.openTo")}
              disabled={allDay}
              className={`${FIELD} min-w-0 flex-1 disabled:opacity-40`}
              value={endMinute == null ? "" : minutesToTimeValue(endMinute)}
              onChange={(e) => setEndMinute(timeValueToMinutes(e.target.value) ?? null)}
            />
          </div>

          {/* Google's recurrence choices as one chip row: once on the drawn
              date, weekly on chosen days, or daily. Weekly unfolds its day
              chips below; once keeps the date as prose beside the chips. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex gap-1.5">
              {(["once", "weekly", "daily"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="switch"
                  aria-checked={cadence === option}
                  onClick={() => setCadence(option)}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors ${
                    cadence === option
                      ? "bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {t(
                    option === "once"
                      ? "closures.once"
                      : option === "weekly"
                        ? "closures.everyWeek"
                        : "closures.everyDay",
                  )}
                </button>
              ))}
            </span>
            {/* The drawn date as prose — the calendar is the picker for where
                a block STARTS — plus an optional last day, so a ten-day
                holiday is one block instead of ten. Left empty, the block is
                the single day. */}
            {cadence === "once" && (
              <span className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                {dateProse}
                <span>{t("settings.openUntil")}</span>
                <input
                  type="date"
                  aria-label={t("closures.lastDay")}
                  className={FIELD}
                  min={draft.date}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </span>
            )}
          </div>
          {cadence === "weekly" && (
            <div className="flex flex-wrap items-center gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                const on = weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() =>
                      setWeekdays(
                        on
                          ? weekdays.filter((d) => d !== day)
                          : [...weekdays, day].sort((a, b) => a - b),
                      )
                    }
                    className={`rounded-full px-3 py-1 text-sm transition-colors ${
                      on
                        ? "bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                        : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {dayNames[day]}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* A state to act on, so visible prose rather than a tip. Reserved
            either way, so the footer does not jump when the count lands. */}
        <p className="mt-3 min-h-5 text-sm text-[var(--muted)]">
          {error
            ? error
            : inside !== undefined && inside > 0
              ? t("closures.appointmentsInside").replace("{count}", String(inside))
              : ""}
        </p>

        <div className="mt-3 flex items-center justify-between gap-2">
          {draft.closureId ? (
            <button
              type="button"
              onClick={async () => {
                if (!(await confirm({ title: t("closures.removeConfirm") }))) return;
                const id = draft.closureId;
                if (!id) return;
                await remove({ closureId: id });
                onClose();
              }}
              className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
            >
              {t("common.delete")}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={!ready || saving}
            onClick={() => void save()}
            className="btn-primary"
          >
            {t("common.save")}
          </button>
        </div>
        {confirmDialog}
      </div>
    </div>,
    document.body,
  );
}

// AppointmentModal's X, verbatim: the two sheets swap into one spot, so their
// chrome has to be indistinguishable.
function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
