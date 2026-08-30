"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Card } from "./Card";
import { Sheet } from "./Sheet";
import { FIELD, RowLabel } from "./RowLabel";
import { useConfirm } from "./ConfirmDialog";
import { useLanguage } from "@/lib/LanguageProvider";
import {
  minutesToTimeValue,
  timeValueToMinutes,
  weekdayNames,
} from "@/lib/datetime";

// The time a business is shut INSIDE its opening hours: the recurring lunch
// break and the one-off holiday, which are one row shape because they are one
// question asked at two cadences (see the `closures` table comment).
//
// Sits directly under Hours, because it only means anything against them —
// closing 13:00-14:00 says nothing until you know the shop opens at nine.

type Closure = {
  _id: Id<"closures">;
  weekdays?: number[];
  date?: string;
  startMinute?: number;
  endMinute?: number;
  reason?: string;
};

type Kind = "weekly" | "date";

// "13:00-14:00", or the all-day word. All day is BOTH bounds unset, never
// 00:00-24:00, so it is a state to name rather than a range to print.
function whenLabel(
  closure: { startMinute?: number; endMinute?: number },
  allDayWord: string,
): string {
  if (closure.startMinute == null || closure.endMinute == null) return allDayWord;
  return `${minutesToTimeValue(closure.startMinute)}–${minutesToTimeValue(closure.endMinute)}`;
}

export function ClosuresCard({ isOwner }: { isOwner: boolean }) {
  const { t, language } = useLanguage();
  // Long names: "Every Monday, Tuesday" is prose, and prose does not
  // abbreviate. A row closing five days is rare enough to be allowed to wrap.
  const dayNames = weekdayNames(language, "long");
  const closures = useQuery(api.closures.list, {});
  const add = useMutation(api.closures.add);
  const update = useMutation(api.closures.update);
  const remove = useMutation(api.closures.remove);
  const [confirm, confirmDialog] = useConfirm();
  // null = closed. "new" = the sheet is adding. A row = the sheet is editing.
  const [editing, setEditing] = useState<Closure | "new" | null>(null);

  const describe = (closure: Closure) => {
    const when = whenLabel(closure, t("closures.allDay"));
    if (closure.date) return `${closure.date} · ${when}`;
    const days = (closure.weekdays ?? [])
      .slice()
      // Monday-first for reading, while the stored index stays 0=Sunday.
      .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      .map((day) => dayNames[day])
      .join(", ");
    // t() cannot interpolate, so the token is replaced here — the convention
    // every other parameterised string in this app follows.
    return `${t("closures.everyWeekOn").replace("{days}", days)} · ${when}`;
  };

  return (
    <>
      <Card
        title={t("closures.title")}
        tip={t("closures.hint")}
        disabled={!isOwner}
        // Renders OUTSIDE the fieldset, so `disabled` never reaches it and the
        // gate has to be here (Card's own note says so).
        action={
          isOwner ? (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="card-action"
            >
              {t("closures.add")}
            </button>
          ) : undefined
        }
      >
        {closures === undefined ? null : closures.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("closures.empty")}</p>
        ) : (
          <div className="flex flex-col">
            {closures.map((closure) => (
              <div
                key={closure._id}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--row-hover-bg)]"
              >
                {/* One line, not three: the when reads across and the reason
                    sits beside it, muted, because it is a note on the fact
                    rather than the fact. */}
                <button
                  type="button"
                  onClick={() => setEditing(closure)}
                  className="min-w-0 flex-1 text-left text-sm"
                >
                  <span className="text-[var(--foreground)]">
                    {describe(closure)}
                  </span>
                  {closure.reason ? (
                    <span className="ml-2 text-[var(--muted)]">
                      {closure.reason}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!(await confirm({ title: t("closures.removeConfirm") }))) return;
                    await remove({ closureId: closure._id });
                  }}
                  className="shrink-0 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                >
                  {t("common.delete")}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
      {editing !== null && (
        <ClosureSheet
          closure={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            if (editing === "new") await add(values);
            else await update({ closureId: editing._id, ...values });
            setEditing(null);
          }}
        />
      )}
      {confirmDialog}
    </>
  );
}

type SaveValues = {
  weekdays?: number[];
  date?: string;
  startMinute?: number;
  endMinute?: number;
  reason?: string;
};

function ClosureSheet({
  closure,
  onClose,
  onSave,
}: {
  closure: Closure | null;
  onClose: () => void;
  onSave: (values: SaveValues) => Promise<void>;
}) {
  const { t, language } = useLanguage();
  // Long names, like the hours card's rows: these chips are the only text on
  // their line, and "Pzt" saves space the stacked sheet no longer needs.
  const dayNames = weekdayNames(language, "long");
  const [kind, setKind] = useState<Kind>(closure?.date ? "date" : "weekly");
  const [weekdays, setWeekdays] = useState<number[]>(closure?.weekdays ?? []);
  const [date, setDate] = useState(closure?.date ?? "");
  const [allDay, setAllDay] = useState(
    closure ? closure.startMinute == null : false,
  );
  const [startMinute, setStartMinute] = useState<number | null>(
    closure?.startMinute ?? 13 * 60,
  );
  const [endMinute, setEndMinute] = useState<number | null>(
    closure?.endMinute ?? 14 * 60,
  );
  const [reason, setReason] = useState(closure?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const values: SaveValues = {
    weekdays: kind === "weekly" ? weekdays : undefined,
    date: kind === "date" ? date : undefined,
    startMinute: allDay ? undefined : startMinute ?? undefined,
    endMinute: allDay ? undefined : endMinute ?? undefined,
    reason: reason.trim() || undefined,
  };

  const kindReady =
    kind === "weekly" ? weekdays.length > 0 : /^\d{4}-\d{2}-\d{2}$/.test(date);
  const windowReady =
    allDay || (startMinute != null && endMinute != null && startMinute < endMinute);
  const ready = kindReady && windowReady;

  // The count of appointments already sitting inside this closure. Skipped
  // until the shape is valid, because the query normalises and would answer 0
  // for a half-typed row — a reassuring number that means nothing.
  //
  // WITHOUT `reason`, which the count never reads. convex/react keys a
  // subscription on the serialised args, so leaving it in tore down the
  // subscription and reopened it — collecting every appointment in the next
  // ninety days — once per character typed into a free-text box.
  const countArgs = {
    weekdays: values.weekdays,
    date: values.date,
    startMinute: values.startMinute,
    endMinute: values.endMinute,
  };
  const inside = useQuery(
    api.closures.appointmentsInside,
    ready ? countArgs : "skip",
  );

  return (
    <Sheet
      title={t(closure ? "closures.edit" : "closures.add")}
      hint={t("closures.hint")}
      onClose={onClose}
    >
      {/* Labels ABOVE their controls, not the settings pages' ROW_GRID. That
          grid's 220-260px label column is sized for a 48rem card; inside this
          max-w-md sheet it left ~170px for every control, which wrapped the
          day chips into a ragged third of the sheet and squeezed the time
          inputs into unreadable stubs. Stacked is also exactly what ROW_GRID
          itself renders below sm, so the sheet reads the same on a phone and
          a desktop. */}
      <div className="flex flex-col gap-4">
        {/* The sheet ASKS which kind rather than stacking both forms — one
            gesture that could create two different things has to. The two
            options are one row of buttons, so switching does not change the
            sheet's height. */}
        <div className="flex flex-col gap-1.5">
          <RowLabel label={t("closures.kind")} />
          <div className="flex flex-wrap gap-1.5">
            {(["weekly", "date"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="switch"
                aria-checked={kind === option}
                onClick={() => setKind(option)}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${
                  kind === option
                    ? "bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                }`}
              >
                {t(option === "weekly" ? "closures.kindWeekly" : "closures.kindDate")}
              </button>
            ))}
          </div>
        </div>

        {/* Both variants occupy ONE row in the same position, so the sheet does
            not resize under the pointer when the kind changes. */}
        <div className="flex flex-col gap-1.5">
          <RowLabel
            label={t(kind === "weekly" ? "closures.days" : "closures.date")}
            hint={t(
              kind === "weekly" ? "closures.kindWeeklyHint" : "closures.kindDateHint",
            )}
          />
          {/* min-h matches the date input's box — FIELD's py-1.5 plus the 1px
              border every input carries — so switching kind does not resize the
              sheet under the pointer. The chips are borderless buttons at py-1
              and come up six pixels short on their own. */}
          {kind === "weekly" ? (
            <div className="flex min-h-[34px] flex-wrap items-center gap-1.5">
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
          ) : (
            <input
              type="date"
              className={`${FIELD} w-full sm:max-w-56`}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </div>

        {/* Labelled "Hours", not "All day": the chip inside already says
            "All day", and a row label repeating its own control read as a
            stutter. */}
        <div className="flex flex-col gap-1.5">
          <RowLabel label={t("closures.window")} />
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
                its height, and the times you typed are still there when you
                turn it back off. */}
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
        </div>

        <div className="flex flex-col gap-1.5">
          <RowLabel label={t("closures.reason")} hint={t("closures.reasonHint")} />
          <input
            type="text"
            className={`${FIELD} w-full`}
            placeholder={t("closures.reasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>

      {/* A STATE the reader has to act on, so it stays visible prose rather
          than going behind a tip. The line is reserved whether or not there is
          a count, so the footer does not jump when the query lands. */}
      <p className="mt-3 min-h-5 text-sm text-[var(--muted)]">
        {error
          ? error
          : inside !== undefined && inside > 0
            ? t("closures.appointmentsInside").replace("{count}", String(inside))
            : ""}
      </p>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={!ready || saving}
          onClick={async () => {
            setError(null);
            setSaving(true);
            try {
              await onSave(values);
            } catch (err) {
              // The backend's reason codes, turned back into the sentence the
              // owner needs. Anything unrecognised falls through to the kind
              // error, which is the one a malformed row almost always is.
              const raw = err instanceof Error ? err.message : "";
              setError(
                raw.includes("closure-empty-window") ||
                  raw.includes("closure-partial-window")
                  ? t("closures.errWindow")
                  : t("closures.errKind"),
              );
            } finally {
              setSaving(false);
            }
          }}
          className="btn-primary"
        >
          {t("common.save")}
        </button>
      </div>
    </Sheet>
  );
}
