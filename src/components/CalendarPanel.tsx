"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import {
  addLocalDays,
  formatDayHeading,
  localeFor,
  startOfLocalDay,
  startOfLocalWeek,
} from "@/lib/datetime";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { staffSwatch, staffSwatchInk } from "@/lib/staffTint";
import { addMonths, startOfMonth } from "./MonthGrid";
import { StaffColorPicker } from "./StaffColorPicker";

// The calendar's side panel, Google Calendar's left column (Nudge's
// CalendarPanel, 2026-10-12 there): a small month to jump with, and the
// business's services and team as tick lists that filter the grid. The team
// list is also the colour key: every box wears the person's colour, and an
// owner recolours someone from the dot on their row, the same picker as the
// Team card's.
//
// The lists drive the same per-viewer filters as the toolbar's pickers, which
// stand in for the panel on a phone and while it is closed, so a filter is
// never hidden (InboxView's rule: a sticky filter you cannot see is the
// version of this that traps people). Empty means everything. The last
// ticked row of a list cannot be unticked, because a calendar showing nothing
// is never what anybody meant and "empty = all" could not say it.

// The team list's row for bookings with nobody on them.
export const UNASSIGNED = "unassigned";

const HOVER_ONLY =
  "opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100";

// The ids a filter shows, where empty (or nothing still known) means all.
export function shownIds(filter: readonly string[], all: readonly string[]): string[] {
  const known = filter.filter((id) => all.includes(id));
  return known.length === 0 ? [...all] : known;
}

// One tick on an inclusion filter. Ticking back to everything stores empty
// again, and the last ticked row of `listed` stays ticked.
export function toggled(
  filter: readonly string[],
  all: readonly string[],
  listed: readonly string[],
  id: string,
): string[] {
  const base = shownIds(filter, all);
  const on = base.includes(id);
  if (on && listed.filter((x) => base.includes(x)).length <= 1) return [...filter];
  const next = on ? base.filter((x) => x !== id) : [...base, id];
  return all.every((x) => next.includes(x)) ? [] : next;
}

export type PanelService = { _id: string; name: string };
export type PanelStaff = { _id: Id<"staff">; name: string; color: string; active: boolean };

export function CalendarPanel({
  anchor,
  highlight,
  onPickDay,
  services,
  serviceFilter,
  onServiceFilter,
  staff,
  withUnassigned,
  staffFilter,
  onStaffFilter,
  isOwner,
  className = "",
}: {
  anchor: number;
  // The days the main view shows, banded on the small month (day and week).
  highlight: { from: number; to: number } | null;
  onPickDay: (day: number) => void;
  // The services worth filtering by: every active one, plus an inactive one
  // a booking in view still carries.
  services: PanelService[];
  serviceFilter: string[];
  onServiceFilter: (next: string[]) => void;
  // The same for people: everyone on the team, plus a deactivated person a
  // booking in view still names.
  staff: PanelStaff[];
  // An "Unassigned" row, for bookings with nobody on them.
  withUnassigned: boolean;
  staffFilter: string[];
  onStaffFilter: (next: string[]) => void;
  // An owner recolours people from their row; a member reads the key.
  isOwner: boolean;
  className?: string;
}) {
  const { t } = useLanguage();

  const serviceIds = services.map((s) => s._id as string);
  const shownServices = shownIds(serviceFilter, serviceIds);
  const staffIds = [...staff.map((s) => s._id as string), ...(withUnassigned ? [UNASSIGNED] : [])];
  const shownStaff = shownIds(staffFilter, staffIds);

  // Who holds which colour among the ACTIVE team, for the picker's greyed
  // swatches (the Team card's rule, lib/staffColors.ts).
  const takenFor = (staffId: string) =>
    new Map(
      staff
        .filter((s) => s.active && s._id !== staffId)
        .map((s) => [s.color, s.name] as const),
    );

  return (
    <aside
      id="calendar-panel"
      aria-label={t("calendar.panelLabel")}
      className={`w-56 shrink-0 flex-col gap-6 ${className}`}
    >
      <MiniMonth anchor={anchor} highlight={highlight} onPick={onPickDay} />

      {staffIds.length > 1 && (
        <section aria-label={t("staff.title")}>
          <h3 className="mb-1 flex h-7 items-center pl-1 text-sm font-medium text-[var(--muted-strong)]">
            {t("staff.title")}
          </h3>
          <ul>
            {staff.map((person) => {
              const checked = shownStaff.includes(person._id);
              return (
                <li
                  key={person._id}
                  className="group flex items-center gap-1 rounded-md hover:bg-[var(--row-hover-bg)]"
                >
                  <TickRow
                    label={person.name}
                    checked={checked}
                    locked={checked && shownStaff.length === 1}
                    color={staffSwatch(person.color)}
                    ink={staffSwatchInk(person.color)}
                    onToggle={() => onStaffFilter(toggled(staffFilter, staffIds, staffIds, person._id))}
                  />
                  {isOwner && person.active && (
                    <StaffColorPicker
                      staffId={person._id}
                      name={person.name}
                      color={person.color}
                      taken={takenFor(person._id)}
                      className={HOVER_ONLY}
                    />
                  )}
                </li>
              );
            })}
            {withUnassigned && (
              <li className="group flex items-center gap-1 rounded-md hover:bg-[var(--row-hover-bg)]">
                <TickRow
                  label={t("appointments.unassigned")}
                  checked={shownStaff.includes(UNASSIGNED)}
                  locked={shownStaff.includes(UNASSIGNED) && shownStaff.length === 1}
                  color={staffSwatch(undefined)}
                  ink={staffSwatchInk(undefined)}
                  onToggle={() => onStaffFilter(toggled(staffFilter, staffIds, staffIds, UNASSIGNED))}
                />
              </li>
            )}
          </ul>
        </section>
      )}

      {services.length > 1 && (
        <section aria-label={t("services.title")}>
          <h3 className="mb-1 flex h-7 items-center pl-1 text-sm font-medium text-[var(--muted-strong)]">
            {t("services.title")}
          </h3>
          <ul>
            {services.map((service) => {
              const checked = shownServices.includes(service._id);
              return (
                <li key={service._id} className="flex items-center rounded-md hover:bg-[var(--row-hover-bg)]">
                  <TickRow
                    label={service.name}
                    checked={checked}
                    locked={checked && shownServices.length === 1}
                    // ON's own hue (--switch-on), the colour every switch in
                    // the app already wears: a service has no colour of its
                    // own, and only a person's colour may mean a person.
                    color="var(--switch-on)"
                    ink="#ffffff"
                    onToggle={() =>
                      onServiceFilter(toggled(serviceFilter, serviceIds, serviceIds, service._id))
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}

// A row that IS the tick box: Google's coloured square, the whole row the
// target. `locked`: the last ticked row, which cannot be unticked.
function TickRow({
  label,
  checked,
  locked,
  color,
  ink,
  onToggle,
}: {
  label: string;
  checked: boolean;
  locked: boolean;
  color: string;
  ink: string;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={locked || undefined}
      title={locked ? t("calendar.lastShown") : undefined}
      onClick={() => {
        if (!locked) onToggle();
      }}
      className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1.5 text-left text-sm ${
        locked ? "cursor-default" : ""
      }`}
    >
      <span
        aria-hidden
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border-2"
        style={{ borderColor: color, backgroundColor: checked ? color : "transparent" }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

// The small month. It follows the main view; its own arrows page it until the
// main view moves again. Today is the filled circle, the days on screen a band.
function MiniMonth({
  anchor,
  highlight,
  onPick,
}: {
  anchor: number;
  highlight: { from: number; to: number } | null;
  onPick: (day: number) => void;
}) {
  const { t, language } = useLanguage();
  const locale = localeFor(language);
  const [today] = useState(() => startOfLocalDay(Date.now()));
  // Paged from the main view's month; reset whenever the main view moves.
  const [nav, setNav] = useState({ base: anchor, offset: 0 });
  const offset = nav.base === anchor ? nav.offset : 0;
  const month = addMonths(startOfMonth(anchor), offset);
  const monthIndex = new Date(month).getMonth();
  const first = startOfLocalWeek(month);
  const days = Array.from({ length: 42 }, (_, i) => addLocalDays(first, i));
  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(month));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  const lit = (day: number | undefined) =>
    highlight !== null && day !== undefined && day >= highlight.from && day < highlight.to;
  const arrow =
    "rounded-md p-1 text-[var(--muted-strong)] transition-colors hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]";

  return (
    <div>
      <div className="mb-1 flex items-center justify-between pl-1">
        <span className="text-sm font-medium">{title}</span>
        <div className="flex items-center">
          <button
            type="button"
            aria-label={t("appointments.previous")}
            className={arrow}
            onClick={() => setNav({ base: anchor, offset: offset - 1 })}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={t("appointments.next")}
            className={arrow}
            onClick={() => setNav({ base: anchor, offset: offset + 1 })}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>
      <div aria-hidden className="grid grid-cols-7 text-center text-[11px] text-[var(--muted-strong)]">
        {days.slice(0, 7).map((d) => (
          <span key={d} className="py-1">
            {weekday.format(new Date(d))}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-xs">
        {days.map((d, i) => {
          const inBand = lit(d);
          const col = i % 7;
          const bandStart = inBand && (col === 0 || !lit(days[i - 1]));
          const bandEnd = inBand && (col === 6 || !lit(days[i + 1]));
          const isToday = d === today;
          const outside = new Date(d).getMonth() !== monthIndex;
          return (
            <div
              key={d}
              className={`flex h-7 items-center justify-center ${
                inBand ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]" : ""
              } ${bandStart ? "rounded-l-full" : ""} ${bandEnd ? "rounded-r-full" : ""}`}
            >
              <button
                type="button"
                onClick={() => onPick(d)}
                aria-label={formatDayHeading(d, language)}
                aria-current={isToday ? "date" : undefined}
                className={`flex h-6 w-6 items-center justify-center rounded-full tabular-nums transition-colors ${
                  isToday
                    ? "bg-[var(--accent)] font-medium text-white"
                    : `hover:bg-[var(--control-hover)] ${outside ? "text-[var(--muted)]" : ""}`
                }`}
              >
                {new Date(d).getDate()}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The toolbar's stand-in for one of the panel's lists, on a phone and while
// the panel is closed: an outlined pill naming what is shown ("All team",
// one name, "2 people"), opening the same tick list. Same pill as Today and
// the view menu across the row (Google's balance); no amber, a filter is not
// an unsaved state.
export function FilterPicker({
  allLabel,
  countLabel,
  options,
  value,
  onChange,
}: {
  allLabel: string;
  countLabel: (n: number) => string;
  // `color`: a person's swatch, so the picker is where you learn who is which.
  options: { id: string; label: string; color?: string; ink?: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useLanguage();
  const { triggerRef, panelRef, pos, open, toggle } = useAnchoredPanel(256, 320);
  const all = options.map((o) => o.id);
  const shown = shownIds(value, all);
  const label =
    shown.length === all.length
      ? allLabel
      : shown.length === 1
        ? (options.find((o) => o.id === shown[0])?.label ?? allLabel)
        : countLabel(shown.length);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] px-4 text-sm font-medium transition-colors hover:bg-[var(--control-hover)]"
      >
        <span className="max-w-[10rem] truncate">{label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width }}
            className="thin-scroll z-[100] max-h-80 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
          >
            {options.map((o) => {
              const checked = shown.includes(o.id);
              const locked = checked && shown.length === 1;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  aria-disabled={locked || undefined}
                  title={locked ? t("calendar.lastShown") : undefined}
                  onClick={() => {
                    if (!locked) onChange(toggled(value, all, all, o.id));
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
                >
                  <span
                    aria-hidden
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border-2"
                    style={{
                      borderColor: o.color ?? "var(--switch-on)",
                      backgroundColor: checked ? (o.color ?? "var(--switch-on)") : "transparent",
                    }}
                  >
                    {checked && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={o.ink ?? "#ffffff"} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
