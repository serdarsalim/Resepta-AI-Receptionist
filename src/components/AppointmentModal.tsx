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

  // The one customer field: what has been typed, and which record it resolved
  // to, if any. Picking a match books that customer; picking nothing means
  // the typed text IS the new customer's name. There used to be an
  // Existing/New toggle deciding between two stacked panels — a question to
  // answer before you could type a letter, about a distinction the backend
  // never needed stated (schedule.prepareCreate takes customerId OR
  // newCustomer, and dedupes the latter by phone).
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
  // height with a customer picked than without, and different again in three
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
    // picked swaps the phone fields for the readback card; adding a service
    // line grew the sheet without re-placing it once, so the bottom ran off
    // the screen — lines.length is the fix for that one; error and canForce
    // are here because a conflict banner is the other thing that appears
    // mid-edit and pushes Save down.
    //
    // A ResizeObserver on the panel would cover all of these and anything added
    // later, and is the better design. It is not used because its callbacks are
    // never delivered in this app: a fresh observer on this panel does not fire
    // even the initial notification observe() guarantees, while offsetHeight
    // demonstrably changes. That is worth understanding before relying on it.
    // Until then this list must grow when anything new changes the height.
  }, [anchor, picked, lines.length, error, canForce]);

  // Only fetched once there is something to match. A booking whose customer
  // is already fixed, or where nothing has been typed yet, never loads the
  // org's contact list at all.
  const customerOptions = useQuery(
    api.customers.options,
    customerFixed || customerQuery.trim() === "" ? "skip" : {},
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

  // Save is off until there is a customer at all — a picked record or at
  // least a typed name. The finer checks (a phone for a new customer) surface
  // as native validation on Save instead of a button that silently refuses.
  const customerIncomplete =
    !customerFixed && !picked && customerQuery.trim() === "";

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
    searchRef.current?.focus();
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
    else if (picked) values.customerId = picked;
    else {
      const form = formRef.current;
      if (!form) return;
      // Save is a plain button, so native validation never fires on its own;
      // this surfaces "phone is required" as a browser bubble instead of a
      // click that silently does nothing.
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      // One title box, two columns in the record: first word is the first
      // name, everything after it the last. "Ayşe Nur Yılmaz" files under
      // Ayşe — the same split a receptionist makes.
      const [firstName, ...rest] = customerQuery.trim().split(/\s+/);
      values.newCustomer = {
        firstName: firstName ?? "",
        lastName: rest.join(" ") || undefined,
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
        // Google's popover chrome: big radius, deep shadow, no drawn border —
        // the shadow IS the edge. Dark mode keeps a hairline because a shadow
        // is invisible on near-black (same rule as --card-shadow).
        className={
          placement
            ? "max-h-[90vh] overflow-y-auto rounded-3xl border border-transparent bg-[var(--card)] p-5 shadow-2xl dark:border-[var(--border)]"
            : "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-transparent bg-[var(--card)] p-5 shadow-xl dark:border-[var(--border)] sm:rounded-3xl"
        }
      >
        {/* No printed heading — Google's popup leads with the title field and
            lets the X carry "this is dismissible". The dialog still announces
            itself through aria-label above. */}
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          >
            <XIcon />
          </button>
        </div>

        <form ref={formRef} className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {draft.customerId ? (
            // The customer IS this booking's title, so it wears the title
            // slot: big type over the underline, exactly where Google puts
            // "Add title". The name is still the way to the record.
            <div className="border-b-2 border-[var(--border)] pb-1.5">
              {onOpenCustomer ? (
                <button
                  type="button"
                  onClick={() => onOpenCustomer(draft.customerId!)}
                  className="text-xl font-normal text-[var(--foreground)] transition-colors hover:text-[var(--accent)]"
                >
                  {draft.customerName}
                </button>
              ) : (
                <span className="text-xl font-normal">{draft.customerName}</span>
              )}
            </div>
          ) : (
            <>
              {/* ONE field, searching as you type — the Google move. A match
                  picked from the list books that customer; no pick means the
                  typed text IS the new customer's name, and the phone field
                  below is already waiting. This replaces an Existing/New
                  toggle over two stacked panels: a filing question the owner
                  had to answer before they could type a letter, about a
                  distinction the backend never needed stated. */}
              <div className="space-y-3">
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
                  <label className="block" htmlFor="modal-customer">
                    {/* The label lives on for screen readers; sighted users get
                        what Google gives them — a big placeholder where the
                        title goes. */}
                    <span className="sr-only">{t("appointments.findCustomer")}</span>
                    <input
                      id="modal-customer"
                      type="search"
                      autoComplete="off"
                      role="combobox"
                      aria-expanded={listOpen}
                      aria-controls="modal-customer-list"
                      required
                      // Google's title field: no box, just a baseline that
                      // thickens to accent on focus. rounded-none because the
                      // base layer rounds every input, and a rounded underline
                      // curls at the ends.
                      className="rounded-none border-0 border-b-2 border-[var(--border)] bg-transparent px-0 py-1.5 text-xl placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
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
                        ) : (
                          <>
                            {customerMatches.map((customer) => (
                              <li key={customer._id}>
                                <button
                                  type="button"
                                  // Keeps focus in the input so onBlur does
                                  // not tear the list down before the click
                                  // lands.
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
                            ))}
                            {/* The way out of the list without a match — and
                                the teaching row: it says out loud what plain
                                typing was already going to do. Landing focus
                                on the phone field, because that is the one
                                fact still missing. */}
                            <li>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setListOpen(false);
                                  document.getElementById("modal-phone")?.focus();
                                }}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--row-hover-bg)] ${
                                  customerMatches.length > 0
                                    ? "border-t border-[var(--border)]"
                                    : ""
                                }`}
                              >
                                <span className="truncate">
                                  {`+ ${t("appointments.createCustomer").replace(
                                    "{name}",
                                    customerQuery.trim(),
                                  )}`}
                                </span>
                              </button>
                            </li>
                          </>
                        )}
                      </ul>,
                      document.body,
                    )}
                  </label>

                {/* Phone and consent exist only while a customer is being
                    CREATED. A picked customer already has both on their
                    record — repeating them here was answering a question
                    nobody asked, so a resolved pick leaves nothing but the
                    name, the way Google's popup carries just a title. */}
                {!picked && (
                  <>
                    <label className="block text-xs font-medium" htmlFor="modal-phone">
                      {t("customers.phone")}
                      <PhoneInput
                        id="modal-phone"
                        name="phone"
                        // Only rendered while the customer is being created,
                        // so required is unconditional; reportValidity in
                        // submit() is what surfaces it.
                        required
                        className="mt-1"
                      />
                    </label>
                    <label className="flex items-start gap-2 text-xs font-medium">
                      <input name="consent" type="checkbox" defaultChecked className="mt-1 w-auto" />
                      <span>{t("customers.consent")}</span>
                    </label>
                  </>
                )}
              </div>
            </>
          )}

          {/* From here down, every row leads with a small grey glyph the way
              Google's popup does — the icon column is what makes a stack of
              unrelated fields read as one event card. */}
          <div className="flex gap-3">
            <span className="mt-6 shrink-0 text-[var(--muted)]" aria-hidden>
              <ClockIcon />
            </span>
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
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
          </div>

          {/* One row per service delivered. A cut plus a beard trim is one
              visit with two lines, not two bookings on top of each other. */}
          <div className="flex gap-3">
            <span className="mt-0.5 shrink-0 text-[var(--muted)]" aria-hidden>
              <TagIcon />
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
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
          </div>

          {/* Paired, the way When and Duration are. Member was a half-width
              select sitting alone on a full-width row, so the sheet spent two
              rows and a whole textarea's worth of height on two fields that
              are each one line of answer. */}
          <div className="flex gap-3">
            <span className="mt-6 shrink-0 text-[var(--muted)]" aria-hidden>
              <PersonIcon />
            </span>
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
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
                {/* One row, and it grows as you type rather than reserving
                    space for words nobody has written. Most bookings carry no
                    note at all. */}
                <textarea
                  rows={1}
                  className="mt-1 resize-y"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>
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
              className="rounded-full px-4 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            >
              {t("common.cancel")}
            </button>
            {/* Google's Save: an accent pill, and the only filled control on
                the card. Accent, not brand — Save is an action, and actions
                are blue everywhere else in this app. */}
            <button
              type="button"
              onClick={submit}
              disabled={pending || customerIncomplete}
              className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
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

// The row glyphs, drawn in the same outline stroke as the app's chevrons.
// 20px, currentColor: the wrapping span decides the grey.
function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
