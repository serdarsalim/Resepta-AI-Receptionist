"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { weekdayNames } from "@/lib/datetime";
import type { Rect } from "@/lib/anchoredSheet";
import { fieldClass } from "./Control";
import { CheckSwitch } from "./CheckSwitch";
import { useConfirm } from "./ConfirmDialog";
import { SegmentedControl } from "./SegmentedControl";
import { DateRangeField } from "./DateRangeField";
import { TimeSelect } from "./TimeSelect";
import {
  AnchoredSheet,
  SHEET_PILL_PRIMARY,
  SHEET_ROWS,
  SheetCloseButton,
  SheetRow,
} from "./AnchoredSheet";

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
// Same popover chrome as AppointmentModal, the one AnchoredSheet: anchored
// beside the drawn slot when there is room, full-width bottom sheet on a
// phone. The two sheets swap into the same spot when the kind tabs switch, so
// choosing "blocked time" reads as the form changing, not a new window
// opening.
//
// Laid out as Nudge's block sheet (2026-10-12 there), one question per row:
// what it is, how it repeats, which dates or days, and the times. Every
// repeat keeps ONE row for its dates or days, the same height, so switching
// Once / Every week / Every day moves nothing below it. Before, Every week
// unfolded a list of seven checks and pushed Save down seven rows.

// What the sheet opens against. Everything here is in the BUSINESS's own
// civil terms — a closure is "13:00 in the salon", never a UTC instant — so
// the caller does the one projection (getLocalPartsSafe on the drawn slot)
// and this sheet never touches a timezone again.
export type BlockDraft = {
  closureId?: Id<"closures">;
  // The civil date the sheet was opened from. A dated closure's first day; a
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

type Cadence = "once" | "weekly" | "daily";

// Weekday of a civil date, zone-free: the calendar fact "2026-09-01 is a
// Tuesday" does not depend on who is asking.
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

// The first row of a sheet opened on empty grid: an appointment, or time the
// business is shut? Google Calendar's Event | Task quick-create, which Nudge
// ported from here and then moved onto its segmented control; this was the
// last hand-rolled pair of pills doing a segmented control's job (emerald
// pills, with the picked one also the only bold one, so it changed width on
// every click). Tabs, to a screen reader: the choice swaps the form under it.
export function SheetKindTabs({
  kind,
  onKind,
}: {
  kind: "appointment" | "block";
  onKind: (kind: "appointment" | "block") => void;
}) {
  const { t } = useLanguage();
  return (
    <SegmentedControl<"appointment" | "block">
      semantics="tabs"
      ariaLabel={t("calendar.kindLabel")}
      value={kind}
      onChange={onKind}
      segments={[
        { id: "appointment", label: t("calendar.tabAppointment") },
        { id: "block", label: t("calendar.tabBlock") },
      ]}
    />
  );
}

// The week as seven toggles on ONE line, Monday first (Nudge's DayChips):
// which days a weekly block covers. It was a column of seven check rows, the
// mark the rest of the app answers yes/no with, and seven rows tall. One line
// is what lets every repeat keep the same height. Emerald is ON, the hue every
// switch here already wears; off is an empty well. The full day name rides
// aria-label and the hover title; the short one is printed.
function DayToggles({
  value,
  onToggle,
}: {
  value: readonly number[];
  onToggle: (day: number) => void;
}) {
  const { language } = useLanguage();
  const short = weekdayNames(language, "short");
  const long = weekdayNames(language, "long");
  return (
    <div className="flex w-full gap-1">
      {[1, 2, 3, 4, 5, 6, 0].map((day) => {
        const on = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={long[day]}
            title={long[day]}
            onClick={() => onToggle(day)}
            className={`h-8 min-w-0 flex-1 truncate rounded-md border px-0.5 text-xs font-medium transition-colors ${
              on
                ? "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "border-[var(--border)] bg-[var(--background)] text-[var(--muted-strong)] hover:text-[var(--foreground)]"
            }`}
          >
            {short[day]}
          </button>
        );
      })}
    </div>
  );
}

export function BlockSheet({
  draft,
  anchor,
  tabs,
  onClose,
  heightFloor,
  onNaturalHeight,
}: {
  draft: BlockDraft;
  // The drawn slot (or the chip) this sheet belongs to, in viewport
  // coordinates. Same contract as AppointmentModal's anchor.
  anchor?: Rect;
  // The kind tabs, when this sheet was reached by drawing on the grid. Absent
  // when editing an existing block — a saved closure is not half of a choice.
  tabs?: React.ReactNode;
  onClose: () => void;
  // The floor shared with the booking sheet while the kind tabs are up.
  heightFloor?: number;
  onNaturalHeight?: (px: number) => void;
}) {
  const { t } = useLanguage();
  const add = useMutation(api.closures.add);
  const update = useMutation(api.closures.update);
  const remove = useMutation(api.closures.remove);
  const [confirm, confirmDialog] = useConfirm();

  const [reason, setReason] = useState(draft.reason ?? "");
  const [allDay, setAllDay] = useState(
    draft.startMinute == null && draft.endMinute == null && draft.closureId !== undefined,
  );
  const [startMinute, setStartMinute] = useState<number>(draft.startMinute ?? 13 * 60);
  const [endMinute, setEndMinute] = useState<number>(draft.endMinute ?? 14 * 60);
  // Once, weekly on chosen days, or daily. Daily is not a third row shape —
  // it is weekdays [0..6], so a row saved as "every day" reopens as exactly
  // that and the engine never learns a new word. A closure on a closed day
  // blocks nothing, so "every day" is safe for a salon shut on Sundays.
  const [cadence, setCadence] = useState<Cadence>(
    (draft.weekdays?.length ?? 0) === 7 ? "daily" : draft.weekdays?.length ? "weekly" : "once",
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    draft.weekdays?.length ? draft.weekdays : [weekdayOf(draft.date)],
  );
  // The first and last day of a one-off. Both are fields now (the first was
  // prose, "the calendar is the picker"), and the last starts EQUAL to the
  // first rather than empty: "Wed 14 Oct – Wed 14 Oct" reads as one day,
  // where an empty dd/mm/yyyy box read as unfinished. The server drops an
  // end equal to the start.
  const [date, setDate] = useState(draft.date);
  const [endDate, setEndDate] = useState(draft.endDate ?? draft.date);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const values = {
    weekdays:
      cadence === "daily" ? [0, 1, 2, 3, 4, 5, 6] : cadence === "weekly" ? weekdays : undefined,
    date: cadence === "once" ? date : undefined,
    endDate: cadence === "once" && endDate !== date ? endDate : undefined,
    startMinute: allDay ? undefined : startMinute,
    endMinute: allDay ? undefined : endMinute,
    reason: reason.trim() || undefined,
  };

  // An inverted range disables Save, but disabling alone reads as a dead
  // button — the sheet says why, in the same line a server rejection would
  // use, before the click that can never happen.
  const timesInverted = !allDay && startMinute >= endMinute;
  const datesInverted = cadence === "once" && endDate < date;
  const rangeError = timesInverted
    ? t("closures.errWindow")
    : datesInverted
      ? t("closures.errRange")
      : null;

  const ready =
    (cadence !== "weekly" || weekdays.length > 0) && !datesInverted && !timesInverted;

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

  return (
    <AnchoredSheet
      anchor={anchor}
      label={t(draft.closureId ? "closures.edit" : "closures.add")}
      onClose={onClose}
      // Nothing in the form changes its height any more (every repeat keeps
      // one row, the times keep theirs under All day, the message line is
      // reserved). Kept for the error and the count, in case a long German
      // sentence wraps.
      measureKey={`${error ?? ""}:${rangeError ?? ""}:${inside ?? ""}`}
      heightFloor={heightFloor}
      onNaturalHeight={onNaturalHeight}
      footer={
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
              className="rounded-full px-4 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]"
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
            className={SHEET_PILL_PRIMARY}
          >
            {t("common.save")}
          </button>
        </div>
      }
    >
      <div className="mb-3 flex min-h-8 items-start justify-between gap-2">
        {tabs ?? <span />}
        <SheetCloseButton label={t("common.close")} onClick={onClose} />
      </div>

      <form
        className={SHEET_ROWS}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !saving) void save();
        }}
      >
        {/* What it is leads, like Google's title field. It is the closure's
            `reason`, so whatever is typed here is what the phone and WhatsApp
            agents can give as the why. */}
        <SheetRow label={t("closures.reason")} htmlFor="block-reason">
          <input
            id="block-reason"
            type="text"
            autoFocus
            className={`${fieldClass("sm")} w-full`}
            placeholder={t("closures.reasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </SheetRow>

        {/* Google's recurrence choices: once, weekly on chosen days, or
            daily. Exactly one is ever on, so the shared segmented control. */}
        <SheetRow label={t("closures.repeats")}>
          <SegmentedControl<Cadence>
            ariaLabel={t("closures.repeats")}
            value={cadence}
            onChange={setCadence}
            segments={[
              { id: "once", label: t("closures.once") },
              { id: "weekly", label: t("closures.everyWeek") },
              { id: "daily", label: t("closures.everyDay") },
            ]}
          />
        </SheetRow>

        {/* ONE row whichever repeat is picked, the same 32px, so switching
            moves nothing below (Nudge f06e67bd). A one-off is a run of dates,
            so a ten-day holiday is one block; a weekly block is its days.
            Every day is the week with all seven lit: taking a day out of it
            is Every week minus that day. */}
        {cadence === "once" ? (
          <SheetRow label={t("closures.dates")}>
            <DateRangeField
              fromLabel={t("closures.firstDay")}
              toLabel={t("closures.lastDay")}
              hint={t("closures.pickLastDay")}
              start={date}
              end={endDate}
              onChange={(from, to) => {
                setDate(from);
                setEndDate(to);
              }}
            />
          </SheetRow>
        ) : (
          <SheetRow label={t("closures.days")}>
            <DayToggles
              value={cadence === "daily" ? [0, 1, 2, 3, 4, 5, 6] : weekdays}
              onToggle={(day) => {
                if (cadence === "daily") {
                  setCadence("weekly");
                  setWeekdays([0, 1, 2, 3, 4, 5, 6].filter((d) => d !== day));
                  return;
                }
                setWeekdays((current) =>
                  current.includes(day)
                    ? current.filter((d) => d !== day)
                    : [...current, day].sort((a, b) => a - b),
                );
              }}
            />
          </SheetRow>
        )}

        {/* Times first, all day after — Google's order: the concrete case
            leads, the exception trails it. While All day is on the times GO
            rather than sit greyed beside it ("all day" and a dimmed
            13:00–14:00 in one row is the sheet claiming both at once), and a
            spacer holds the check where it was, so the control you just
            clicked never jumps out from under the cursor and the row keeps
            its height. The times are TimeSelects now: the browser's own time
            box printed "10:30 AM" from the browser's locale, in an app that
            prints every time on a 24-hour clock. */}
        <SheetRow label={t("closures.time")}>
          <div className="flex min-h-8 items-center gap-2">
            {allDay ? (
              <span className="min-w-0 flex-1" />
            ) : (
              <>
                <TimeSelect
                  minutes={startMinute}
                  ariaLabel={t("settings.openFrom")}
                  className="w-0 min-w-0 flex-1"
                  onChange={(m) => {
                    // A new start keeps the length when it can, Google's
                    // way: the end follows rather than inverting the range.
                    const length = endMinute - startMinute;
                    setStartMinute(m);
                    if (length > 0) setEndMinute(Math.min(24 * 60, m + length));
                  }}
                />
                <span className="shrink-0 text-[var(--muted)]">–</span>
                <TimeSelect
                  minutes={endMinute}
                  from={startMinute}
                  ariaLabel={t("settings.openTo")}
                  className="w-0 min-w-0 flex-1"
                  onChange={setEndMinute}
                />
              </>
            )}
            <span className="flex shrink-0 items-center gap-2">
              <CheckSwitch on={allDay} label={t("closures.allDay")} onChange={setAllDay} />
              <span className="whitespace-nowrap text-sm">{t("closures.allDay")}</span>
            </span>
          </div>
        </SheetRow>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>

      {/* A state to act on, so visible prose rather than a tip. Reserved
          either way, so the footer does not jump when the count lands. */}
      <p className="mt-3 min-h-5 text-sm text-[var(--muted-strong)]">
        {rangeError ??
          error ??
          (inside !== undefined && inside > 0
            ? t.plural("closures.appointmentsInside", inside)
            : "")}
      </p>
      {confirmDialog}
    </AnchoredSheet>
  );
}
