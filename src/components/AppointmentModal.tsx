"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import {
  currencySymbol,
  formatMoney,
  moneyInputValue,
  parseMoney,
} from "@/lib/money";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "@/lib/datetime";
import { PhoneInput } from "./PhoneField";
import { placeBeside, type Placement, type Rect } from "@/lib/anchoredSheet";
import type { Id } from "../../convex/_generated/dataModel";

// The appointment sheet, opened by clicking a slot or a block on the grid.
//
// Portalled to document.body with position:fixed, per the rule this codebase
// has broken most often: an absolutely positioned panel inside the calendar
// would be clipped by the grid's own scroll container the moment it opened.
// The modal also traps focus and closes on Escape, because the grid behind it
// is a field of buttons and tabbing into them would be a trap of its own.

// The same 32rem the centred sheet has always been (max-w-lg). Anchoring moved
// the panel; it did not shrink the form. Google's popover is narrower because
// it is a QUICK create with "More options" behind it, and a salon that has to
// take a second step to name a service has not been helped.
const PANEL_W = 512;

export type ModalDraft = {
  appointmentId?: Id<"appointments">;
  startAt: number;
  durationMinutes: number;
  customerId?: Id<"customers">;
  customerName?: string;
  phone?: string;
  // The visit's line items. One entry per service delivered; prices are minor
  // units, absent when the line was never priced. quantity only ever rides on
  // a good ("3 chocolate cakes" is one line).
  lines?: { serviceId: Id<"services">; price?: number; quantity?: number }[];
  staffId?: Id<"staff"> | null;
  notes?: string;
  status?: string;
};

export type ModalSubmit = {
  startAt: number;
  durationMinutes: number;
  customerId?: Id<"customers">;
  newCustomer?: { firstName: string; lastName?: string; phone: string; consent: boolean };
  lines: { serviceId: Id<"services">; price?: number; quantity?: number }[];
  staffId?: Id<"staff"> | null;
  notes?: string;
};

export function AppointmentModal({
  draft,
  services,
  currency,
  staff,
  staffLabel,
  pending,
  error,
  canForce,
  onSubmit,
  onForce,
  onDelete,
  onClose,
  onOpenCustomer,
  anchor,
}: {
  draft: ModalDraft;
  services: {
    _id: Id<"services">;
    name: string;
    // Absent = a good: no length, no calendar footprint, quantity allowed.
    durationMinutes?: number;
    price?: number;
  }[];
  currency: string;
  staff: { _id: Id<"staff">; name: string; active: boolean }[];
  staffLabel: string;
  pending: boolean;
  error?: string;
  canForce?: boolean;
  onSubmit: (values: ModalSubmit) => void;
  onForce: () => void;
  onDelete?: () => void;
  onClose: () => void;
  // Opening the record replaces this sheet rather than stacking on it: the
  // caller closes us first, so there is never a modal behind a modal.
  //
  // Optional, because the sheet can be opened FROM a contact record, and a
  // link back to the page you are already on is a dead click. Absent, the name
  // renders as the plain fact it is.
  onOpenCustomer?: (id: Id<"customers">) => void;
  // The thing on screen this sheet belongs to, in viewport coordinates. Given
  // one, the sheet anchors beside it instead of taking the middle of the
  // window. Absent (or on a narrow window) it stays the sheet it was.
  anchor?: Rect;
}) {
  const { t, language } = useLanguage();
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [startAt, setStartAt] = useState(draft.startAt);
  const [durationMinutes, setDurationMinutes] = useState(draft.durationMinutes);
  // Line rows, held as strings because that is what the inputs speak. An empty
  // list is a real state — a blocked-out hour with no service on it — so the
  // modal opens with no rows rather than one blank one begging to be filled.
  const [lines, setLines] = useState<
    { serviceId: string; price: string; quantity: string }[]
  >(() =>
    (draft.lines ?? []).map((line) => ({
      serviceId: line.serviceId as string,
      price: moneyInputValue(line.price, currency, language),
      quantity: String(line.quantity ?? 1),
    })),
  );
  const [staffId, setStaffId] = useState<string>(draft.staffId ?? "");
  const [notes, setNotes] = useState(draft.notes ?? "");

  const editing = draft.appointmentId !== undefined;

  // A booking whose customer is already decided: an edit, or the sheet opened
  // from somebody's contact record. The customer is a fact here, not a field,
  // so it renders as a link and the picker never appears.
  const customerFixed = draft.customerId !== undefined;

  // Existing or new, for the bookings where it is still open. "new" first
  // because the counter phone case is somebody standing there who has never
  // been here before; a regular is more often booked from their own record,
  // which takes the customerFixed path above and never sees this.
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [picked, setPicked] = useState<Id<"customers"> | undefined>();
  const [customerQuery, setCustomerQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // The list is portalled, so it needs the search box's viewport rect. Measured
  // while open and re-measured on scroll and resize: fixed coordinates go stale
  // the moment anything underneath moves.
  const [listPos, setListPos] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    if (!listOpen) {
      setListPos(null);
      return;
    }
    const measure = () => {
      const r = searchRef.current?.getBoundingClientRect();
      if (!r) return;
      setListPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    measure();
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [listOpen]);

  // Where to sit, when the caller told us what we belong to. Measured after
  // layout so the panel's real height decides whether it has to slide up,
  // rather than a guess baked in at design time — the sheet is a different
  // height in Existing mode than in New, and different again in three
  // languages.
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
      // Compared before storing: the observer below fires on every size change
      // and a fresh object each time would re-render for nothing.
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
    // A window resize can turn a window that had room beside the block into one
    // that does not, and it does NOT re-render, so it needs its own listener.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // EVERY dependency here is something that changes the panel's HEIGHT, which
    // is what decides whether it has to slide up to stay on screen.
    //
    // This was [anchor, mode, picked] and adding a service line grew the sheet
    // without re-placing it, so the bottom ran off the screen — the taller it
    // got, the further past the edge. lines.length is the fix for that one;
    // error and canForce are here because a conflict banner is the other thing
    // that appears mid-edit and pushes Save down.
    //
    // A ResizeObserver on the panel would cover all of these and anything added
    // later, and is the better design. It is not used because its callbacks are
    // never delivered in this app: a fresh observer on this panel does not fire
    // even the initial notification observe() guarantees, while offsetHeight
    // demonstrably changes. That is worth understanding before relying on it.
    // Until then this list must grow when anything new changes the height.
  }, [anchor, mode, picked, lines.length, error, canForce]);

  // Only fetched once the picker is actually on screen. A booking that creates
  // its customer never loads the org's contact list at all.
  const customerOptions = useQuery(
    api.customers.options,
    customerFixed || mode !== "existing" ? "skip" : {},
  );

  // Name first, then number, because somebody typing "534" is looking up a
  // phone and somebody typing "ker" is looking up a person. Capped at eight:
  // past that the list is a scrolling surface inside a modal, and the answer
  // is to type another letter.
  const customerMatches = useMemo(() => {
    const all = customerOptions ?? [];
    const needle = customerQuery.trim().toLocaleLowerCase();
    // Nothing typed, nothing listed. A booking is for ONE person, so opening
    // on a scrolling roster of everybody is a list you have to dismiss rather
    // than an answer: the first eight by creation date are eight people you
    // had no reason to want. Type a letter and it becomes a search.
    if (!needle) return [];
    return all
      .filter((c) => {
        const name = `${c.firstName} ${c.lastName ?? ""}`.toLocaleLowerCase();
        return name.includes(needle) || c.phone.includes(needle);
      })
      .slice(0, 8);
  }, [customerOptions, customerQuery]);

  const pickedCustomer = customerOptions?.find((c) => c._id === picked);

  // Save is off until the picker has an answer. The submit handler refuses
  // this case anyway, but a button that silently does nothing reads as broken.
  const customerIncomplete = !customerFixed && mode === "existing" && !picked;

  // Picking a service fills its list price and, on a NEW booking, restretches
  // the block to what the work adds up to. On an existing one it leaves the
  // length alone: a block drawn by hand meant that length on purpose, and
  // cal.com would have to agree to a new one anyway.
  const setLine = (index: number, serviceId: string) => {
    const picked = services.find((s) => s._id === serviceId);
    const next = lines.map((line, i) =>
      i === index
        ? {
            serviceId,
            price: moneyInputValue(picked?.price, currency, language),
            quantity: "1",
          }
        : line,
    );
    setLines(next);
    if (editing) return;
    const minutes = next
      .map((line) => services.find((s) => s._id === line.serviceId)?.durationMinutes ?? 0)
      .reduce((sum, m) => sum + m, 0);
    if (minutes > 0) setDurationMinutes(minutes);
  };

  const isGoodLine = (line: { serviceId: string }) => {
    const service = services.find((s) => s._id === line.serviceId);
    return service !== undefined && service.durationMinutes === undefined;
  };
  // Goods through and through: every chosen line is a thing, not time. The
  // block then books as duration 0 — a handover moment that holds no chair —
  // so the duration field disappears rather than showing a number that means
  // nothing.
  const chosen = lines.filter((line) => line.serviceId);
  const goodsOnly = chosen.length > 0 && chosen.every(isGoodLine);

  const lineQuantity = (line: { quantity: string }) =>
    Math.min(99, Math.max(1, Math.round(Number(line.quantity) || 1)));
  const priced = lines
    .map((line) => {
      const price = parseMoney(line.price, currency, language);
      if (price === undefined) return undefined;
      return price * (isGoodLine(line) ? lineQuantity(line) : 1);
    })
    .filter((p): p is number => p !== undefined);
  const total = priced.length ? priced.reduce((sum, p) => sum + p, 0) : undefined;

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  // Escape closes; Tab cycles inside the panel. Both on the panel rather than
  // the document so a second modal could never fight this one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // The new-customer fields are uncontrolled and read on submit, because
  // PhoneInput composes the dial code and the number itself — the same
  // component and the same contract the old inline form used.
  const submit = () => {
    const values: ModalSubmit = {
      startAt,
      durationMinutes: goodsOnly ? 0 : durationMinutes,
      // Rows still on "—" are dropped rather than sent: an unfinished row is
      // someone mid-thought, not a line they meant to record.
      lines: lines
        .filter((line) => line.serviceId)
        .map((line) => {
          const price = parseMoney(line.price, currency, language);
          const quantity = isGoodLine(line) ? lineQuantity(line) : 1;
          return {
            serviceId: line.serviceId as Id<"services">,
            ...(price !== undefined ? { price } : {}),
            ...(quantity > 1 ? { quantity } : {}),
          };
        }),
      staffId: staffId ? (staffId as Id<"staff">) : null,
      notes,
    };
    if (draft.customerId) values.customerId = draft.customerId;
    else if (mode === "existing") {
      // No silent fallback to creating somebody: a picker with nothing picked
      // is an unfinished form, and guessing here is how you get a duplicate
      // contact named after a half-typed search.
      if (!picked) return;
      values.customerId = picked;
    } else {
      const form = formRef.current;
      if (!form) return;
      const data = new FormData(form);
      values.newCustomer = {
        firstName: String(data.get("firstName") ?? "").trim(),
        lastName: String(data.get("lastName") ?? "").trim() || undefined,
        phone: String(data.get("phone") ?? "").trim(),
        consent: data.get("consent") === "on",
      };
      if (!values.newCustomer.firstName || !values.newCustomer.phone) return;
    }
    onSubmit(values);
  };

  return createPortal(
    <div
      // Anchored, the backdrop stops being a scrim and becomes only a place to
      // click to dismiss. NO dim: the whole point of a popover on a calendar is
      // that the week stays readable behind it, so you can see the slot you are
      // booking against the ones around it. Dimming turns it back into a modal
      // that happens to sit off-centre.
      className={
        placement
          ? "fixed inset-0 z-50"
          : "fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      }
      // Backdrop click closes. mousedown, not click, so a drag that started
      // inside the panel and ended on the backdrop does not close it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        // Anchored it is NOT modal: the calendar behind stays legible and
        // meaningful, and claiming otherwise to a screen reader would be a lie
        // about what is on screen.
        aria-modal={placement ? undefined : true}
        aria-label={editing ? t("appointments.edit") : t("appointments.new")}
        style={
          placement
            ? { position: "fixed", top: placement.top, left: placement.left, width: PANEL_W }
            : undefined
        }
        // Full-width sheet on a phone, centred card above it. A salon owner
        // books from the counter phone more often than from a desk. Anchored,
        // it keeps the same width it always had: the form did not get smaller
        // just because it moved.
        className={
          placement
            ? "max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-2xl"
            : "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl sm:rounded-2xl"
        }
      >
        <h2 className="mb-3 text-sm font-semibold">
          {editing ? t("appointments.edit") : t("appointments.new")}
        </h2>

        <form ref={formRef} className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {draft.customerId ? (
            <div className="text-sm">
              <span className="text-[var(--muted)]">{t("appointments.customer")}: </span>
              {/* The name is the way to the record. Underlined because a link
                  that only reveals itself on hover is a link nobody finds —
                  and this is the one route from a booking to the person's
                  history, consent and contact details. */}
              {onOpenCustomer ? (
                <button
                  type="button"
                  onClick={() => onOpenCustomer(draft.customerId!)}
                  className="font-medium underline underline-offset-2 transition-colors hover:text-[var(--accent)]"
                >
                  {draft.customerName}
                </button>
              ) : (
                <span className="font-medium">{draft.customerName}</span>
              )}
            </div>
          ) : (
            <>
              {/* Existing or new, stated rather than inferred. The sheet used
                  to offer only the new-customer fields, so booking a regular
                  meant retyping somebody already on file and finding them
                  again by phone number afterwards. The backend always took
                  either (schedule.prepareCreate accepts customerId OR
                  newCustomer, and dedupes the latter by phone); this is the
                  half that was missing. */}
              <div className="space-y-1.5">
                <span className="block text-xs text-[var(--muted)]">
                  {t("appointments.customer")}
                </span>
                {/* The segmented control this app already uses, the same one
                    the calendar switches views with. Two radios in a modal
                    read as a question to answer before you may proceed; a
                    segment reads as which of two things you are looking at,
                    which is what this is. type="button" on both: inside a form
                    a bare button submits it. */}
                <div className="inline-flex rounded-lg bg-[var(--muted-bg)] p-0.5 text-sm">
                  {(["existing", "new"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={mode === option}
                      onClick={() => setMode(option)}
                      className={`rounded-md px-3 py-1 transition-colors ${
                        mode === option
                          ? "bg-[var(--background)] font-medium text-[var(--foreground)]"
                          : "text-[var(--muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {option === "existing"
                        ? t("appointments.existingCustomer")
                        : t("appointments.newCustomer")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Both panels occupy ONE grid cell, so the region is always as
                  tall as the taller of them and switching moves nothing below
                  it. The modal is vertically centred, so a panel that grew on
                  switch pushed every field down AND slid the whole dialog up:
                  two movements from one click, on the control you just aimed
                  at.

                  Stacked rather than given a measured min-height, because the
                  taller panel is not the same one in every language and a
                  number tuned against English would be wrong in German. The
                  grid measures whatever is actually there. */}
              <div className="grid">
                <div
                  className={`col-start-1 row-start-1 space-y-2 ${
                    mode === "existing" ? "" : "invisible"
                  }`}
                  // visibility:hidden already drops the inactive panel out of
                  // the tab order, so the only thing left to disarm is the
                  // required flags below.
                  aria-hidden={mode !== "existing"}
                >
                  {/* The matches OVERLAY the form instead of sitting in it. An
                      always-open list is a control that charges ~300px of
                      permanent modal height to show five names you are going
                      to scroll past anyway, and it pushed Save below the fold
                      on a laptop. As a dropdown it costs one field's height
                      until the moment you are actually reading it.

                      Portalled and fixed, not absolute. The panel is
                      overflow-y-auto, so an absolute child clips against it the
                      moment the sheet is tall enough to scroll — which it is on
                      a short window, or with a conflict banner showing. It
                      currently happens not to clip, and "happens not to" is
                      what this repo keeps shipping and regretting. */}
                  <label className="block text-xs font-medium" htmlFor="modal-customer">
                    {t("appointments.findCustomer")}
                    <input
                      id="modal-customer"
                      type="search"
                      autoComplete="off"
                      role="combobox"
                      aria-expanded={listOpen}
                      aria-controls="modal-customer-list"
                      className="mt-1"
                      placeholder={t("appointments.findCustomerHint")}
                      value={customerQuery}
                      ref={searchRef}
                      onFocus={() => setListOpen(true)}
                      // Closing on blur would fire before a click on an option
                      // lands, so the options refuse to take focus at all (see
                      // onMouseDown below) and this only ever runs on a real
                      // move away from the field.
                      onBlur={() => setListOpen(false)}
                      onKeyDown={(e) => {
                        // Escape shuts the list, not the whole sheet. The
                        // modal's own handler is on the document in the
                        // capture phase, so this has to say so explicitly.
                        if (e.key === "Escape" && listOpen) {
                          e.stopPropagation();
                          setListOpen(false);
                        }
                      }}
                      onChange={(e) => {
                        setCustomerQuery(e.target.value);
                        setListOpen(true);
                        // Typing again abandons the previous pick. Leaving it
                        // set would let the sheet book a person whose name is
                        // no longer anywhere on screen.
                        if (picked) setPicked(undefined);
                      }}
                    />
                    {listOpen && customerQuery.trim() !== "" && listPos && createPortal(
                      <ul
                        id="modal-customer-list"
                        style={{
                          position: "fixed",
                          top: listPos.top,
                          left: listPos.left,
                          width: listPos.width,
                        }}
                        className="z-[100] max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
                      >
                        {customerOptions === undefined ? (
                          <li className="px-3 py-2 text-xs text-[var(--muted)]">
                            {t("common.loading")}
                          </li>
                        ) : customerMatches.length === 0 ? (
                          <li className="px-3 py-2 text-xs text-[var(--muted)]">
                            {t("customers.noMatches")}
                          </li>
                        ) : (
                          customerMatches.map((customer) => (
                            <li key={customer._id}>
                              <button
                                type="button"
                                // Keeps focus in the input so onBlur does not
                                // tear the list down before the click lands.
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setPicked(customer._id);
                                  setCustomerQuery(
                                    `${customer.firstName} ${customer.lastName ?? ""}`.trim(),
                                  );
                                  setListOpen(false);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {`${customer.firstName} ${customer.lastName ?? ""}`.trim()}
                                </span>
                                <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                                  {customer.phone}
                                </span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>,
                      document.body,
                    )}
                  </label>

                  {/* Who you actually picked, read back. It is not decoration:
                      the search box shows a name you typed, which is not proof
                      the sheet resolved it to anybody, and two customers can
                      share one. It also answers the same three questions the
                      New panel asks — name, number, consent — so the two modes
                      are the same shape and switching moves nothing. */}
                  <dl className="space-y-1 rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-[var(--muted)]">{t("customers.phone")}</dt>
                      <dd className="tabular-nums">{pickedCustomer?.phone ?? "—"}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-[var(--muted)]">{t("customers.consentShort")}</dt>
                      <dd>
                        {picked === undefined
                          ? "—"
                          : pickedCustomer?.consented
                            ? t("customers.consentGiven")
                            : t("customers.noConsent")}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div
                  className={`col-start-1 row-start-1 space-y-3 ${
                    mode === "new" ? "" : "invisible"
                  }`}
                  aria-hidden={mode !== "new"}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      {t("customers.firstName")}
                      <input
                        ref={firstFieldRef}
                        name="firstName"
                        // Required only while this panel IS the panel. The
                        // hidden one is still in the DOM to hold the height
                        // open, and a required field nobody can see refuses
                        // the form with nothing on screen to fix.
                        required={mode === "new"}
                        className="mt-1"
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      {t("customers.lastName")}
                      <input name="lastName" className="mt-1" />
                    </label>
                  </div>
                  <label className="block text-xs font-medium" htmlFor="modal-phone">
                    {t("customers.phone")}
                    <PhoneInput
                      id="modal-phone"
                      name="phone"
                      required={mode === "new"}
                      className="mt-1"
                    />
                  </label>
                  <label className="flex items-start gap-2 text-xs font-medium">
                    <input name="consent" type="checkbox" defaultChecked className="mt-1 w-auto" />
                    <span>{t("customers.consent")}</span>
                  </label>
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className={`block text-xs font-medium${goodsOnly ? " col-span-2" : ""}`}>
              {t("appointments.when")}
              <input
                type="datetime-local"
                className="mt-1"
                value={toDatetimeLocalValue(startAt)}
                onChange={(e) => {
                  const next = fromDatetimeLocalValue(e.target.value);
                  if (!Number.isNaN(next)) setStartAt(next);
                }}
              />
            </label>
            {/* An order of goods has a moment, not a length — showing a
                minutes field for it would be a number that means nothing. */}
            {!goodsOnly && (
              <label className="block text-xs font-medium">
                {t("appointments.duration")}
                <input
                  type="number"
                  min={5}
                  step={5}
                  className="mt-1"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value) || 5)}
                />
              </label>
            )}
          </div>

          {/* One row per service delivered. A cut plus a beard trim is one
              visit with two lines, not two bookings on top of each other. */}
          <div className="space-y-1.5">
            <span className="block text-xs text-[var(--muted)]">
              {t("appointments.service")}
            </span>
            {lines.map((line, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  className="min-w-0 flex-1"
                  value={line.serviceId}
                  onChange={(e) => setLine(index, e.target.value)}
                >
                  <option value="">—</option>
                  {services.map((service) => (
                    <option key={service._id} value={service._id}>
                      {service.name}
                    </option>
                  ))}
                </select>
                {/* Quantity, goods only: "3× cake" is one line. Time-bound
                    lines never show it — two haircuts is two visits. */}
                {isGoodLine(line) && (
                  <input
                    type="number"
                    min={1}
                    max={99}
                    step={1}
                    aria-label={t("appointments.quantity")}
                    className="w-14 shrink-0"
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === index ? { ...l, quantity: e.target.value } : l,
                        ),
                      )
                    }
                  />
                )}
                {/* Prefilled from the service, editable on the spot. Typing a
                    different number IS the discount — there is no override
                    toggle, because the field already permits the edit. Unit
                    price on a goods line; the total below does the ×. */}
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-24 shrink-0"
                  value={line.price}
                  placeholder={currencySymbol(currency, language)}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, i) =>
                        i === index ? { ...l, price: e.target.value } : l,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={t("common.delete")}
                  onClick={() =>
                    setLines((prev) => prev.filter((_, i) => i !== index))
                  }
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-red-600 dark:hover:text-red-400"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setLines((prev) => [...prev, { serviceId: "", price: "", quantity: "1" }])
                }
                className="rounded-md py-1 text-xs text-[var(--accent)] hover:underline"
              >
                {t("appointments.addService")}
              </button>
              {/* The total is the sum and only the sum, so it can never
                  disagree with the lines above it. */}
              {total !== undefined && (
                <span className="ml-auto text-sm font-medium tabular-nums">
                  {formatMoney(total, currency, language)}
                </span>
              )}
            </div>
          </div>

          {/* Paired, the way When and Duration are. Member was a half-width
              select sitting alone on a full-width row, so the sheet spent two
              rows and a whole textarea's worth of height on two fields that
              are each one line of answer. */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium">
              {staffLabel}
              <select
                className="mt-1"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              >
                <option value="">—</option>
                {staff
                  .filter((person) => person.active || person._id === draft.staffId)
                  .map((person) => (
                    <option key={person._id} value={person._id}>
                      {person.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              {t("appointments.notes")}
              {/* One row, and it grows as you type rather than reserving space
                  for words nobody has written. Most bookings carry no note at
                  all. */}
              <textarea
                rows={1}
                className="mt-1 resize-y"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
          {/* Enter submits, which is what a booking form should do. */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>

        {error && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            <p>{error}</p>
            {/* cal.com refused for a reason the owner is entitled to overrule —
                the chair is double-booked, or it is outside the hours cal.com
                knows about. Offered only when that is what happened. */}
            {canForce && (
              <button
                type="button"
                onClick={onForce}
                disabled={pending}
                className="mt-2 rounded-lg px-2 py-1 font-medium text-amber-900 underline underline-offset-2 dark:text-amber-200"
              >
                {t("appointments.bookAnyway")}
              </button>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-red-600"
            >
              {t("appointments.cancelAppointment")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || customerIncomplete}
              className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
