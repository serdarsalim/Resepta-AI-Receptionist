"use client";

// The self-serve appointment page — where [manage_link] points. The token in
// the URL is the whole capability: whoever holds it may look at, move or
// cancel exactly this one appointment (convex/booking.ts manage/reschedule/
// cancel). No auth, no chrome, phone-first, same as /book and /r.

import { useMutation, useQuery } from "convex/react";
import { use, useMemo, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import {
  CONFIRMATION_LINE,
  createTranslator,
  isLanguage,
  type Language,
} from "@/lib/i18n";
import {
  MonthGrid,
  TimeList,
  dayInMonth,
  monthQuery,
  shiftMonth,
  type DayKey,
} from "@/components/booking/MonthTimes";

function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function ManageAppointmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const { language: viewerLanguage } = useLanguage();
  const appointment = useQuery(api.booking.manage, { token });
  // The salon's customer language, same call as /book/<slug> — and it matters
  // more here. This page is only ever opened from a link inside a message we
  // sent, so its chrome answering in a different language than the message
  // that carried it is the product contradicting itself one tap apart. The
  // dates below already formatted through appointment.language; only the
  // words did not.
  const pageLanguage: Language =
    appointment && isLanguage(appointment.language) ? appointment.language : viewerLanguage;
  const t = useMemo(() => createTranslator(pageLanguage), [pageLanguage]);
  const reschedule = useMutation(api.booking.reschedule);
  const cancel = useMutation(api.booking.cancel);

  const [moving, setMoving] = useState(false);
  // The Reschedule picker's month and day (P29, the booking page's month and
  // list). Null month = this month in the business's zone.
  const [month, setMonth] = useState<string | null>(null);
  const [day, setDay] = useState<DayKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a move lands, carrying which channel its re-sent confirmation is
  // really coming by (booking.reschedule's confirmBy; absent = none is).
  const [moved, setMoved] = useState<{
    confirmBy?: keyof typeof CONFIRMATION_LINE;
  } | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // Only canModify. It used to also require the org's public booking slug and
  // a serviceId on the line, which is why a phone-booked appointment at a
  // salon with no public booking page showed Cancel alone — while the
  // confirmation message it arrived with promised the customer could change
  // it. slotsForToken asks with the token instead, and reads the length off
  // the appointment, so neither is needed.
  const canPickSlots = Boolean(appointment?.canModify);
  const minMonth = appointment ? todayIn(appointment.timezone).slice(0, 7) : "";
  const shownMonth = month && month >= minMonth ? month : minMonth;
  const offers = useQuery(
    api.booking.monthSlotsForToken,
    moving && appointment && canPickSlots ? { token, ...monthQuery(shownMonth) } : "skip",
  );
  const openDay = appointment ? dayInMonth(offers, appointment.timezone, shownMonth, day) : null;

  // Formatter per call — cheap at this scale, and the React Compiler owns
  // the memoization now.
  const dateTimeLabel = (ms: number) =>
    appointment
      ? new Intl.DateTimeFormat(appointment.language, {
          timeZone: appointment.timezone,
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(ms))
      : "";

  if (appointment === undefined) {
    return (
      <Shell language={pageLanguage}>
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      </Shell>
    );
  }
  if (appointment === null) {
    return (
      <Shell language={pageLanguage}>
        <p className="text-sm text-[var(--muted)]">{t("forms.notFound")}</p>
      </Shell>
    );
  }

  // A goods order wears order words end to end; presence of fulfillment is
  // the tell, and legacy goods rows without one keep appointment wording.
  const order = appointment.fulfillment;
  const upcoming =
    // An ASAP order's startAt is the minute it was PLACED — already in the
    // past by the time this page loads — so the clock cannot decide whether
    // it is still open; its status alone does.
    (appointment.startAt > Date.now() || Boolean(order?.asap)) &&
    (appointment.status === "scheduled" || appointment.status === "confirmed");

  return (
    <Shell title={appointment.orgName} language={pageLanguage}>
      <div className="space-y-4">
        <div>
          {appointment.services.length > 0 && (
            <p className="text-sm font-medium">{appointment.services.join(", ")}</p>
          )}
          <p className="text-sm text-[var(--muted)]">
            {order
              ? [
                  t(order.kind === "pickup" ? "booking.pickup" : "booking.delivery"),
                  // ASAP prints the promise, not the minute the order landed.
                  order.asap ? t("booking.asap") : dateTimeLabel(appointment.startAt),
                ].join(" · ")
              : dateTimeLabel(appointment.startAt)}
          </p>
          {order?.address && (
            <p className="text-sm text-[var(--muted)]">{order.address}</p>
          )}
          {/* Where to go (orgs.address, P16, shown here since P29). A
              delivery order is going to the customer, so it shows theirs
              above instead. */}
          {appointment.address && order?.kind !== "delivery" && (
            <p className="text-sm text-[var(--muted)]">{appointment.address}</p>
          )}
          {appointment.status === "cancelled" && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              {t(order ? "booking.orderCancelled" : "booking.cancelled")}
            </p>
          )}
          {moved && (
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
              {t("booking.moved")}
              {moved.confirmBy && ` ${t(CONFIRMATION_LINE[moved.confirmBy])}`}
            </p>
          )}
        </div>

        {/* Provider-owned bookings (cal.com holds the inventory) get honesty
            instead of buttons that half-work. */}
        {upcoming && !appointment.canModify && (
          <p className="text-sm text-[var(--muted)]">
            {t("booking.callToChange")}
            {appointment.phone ? ` ${appointment.phone}` : ""}
          </p>
        )}

        {upcoming && appointment.canModify && !moving && (
          <div className="flex flex-wrap gap-2">
            {canPickSlots && (
              <button
                type="button"
                onClick={() => setMoving(true)}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)]"
              >
                {t("booking.reschedule")}
              </button>
            )}
            {!confirmingCancel ? (
              <button
                type="button"
                onClick={() => setConfirmingCancel(true)}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 dark:border-red-900 dark:text-red-400"
              >
                {t(order ? "booking.cancelOrder" : "booking.cancel")}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const result = await cancel({ token });
                  setBusy(false);
                  setConfirmingCancel(false);
                  if (!result.ok) setError(result.reason ?? "error");
                }}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? t("common.saving") : t("booking.cancelConfirm")}
              </button>
            )}
          </div>
        )}

        {upcoming && moving && canPickSlots && (
          <section className="border-t border-[var(--border)] pt-3">
            <h2 className="mb-3 text-sm font-medium">{t("booking.pickTime")}</h2>
            <MonthGrid
              t={t}
              language={pageLanguage}
              zone={appointment.timezone}
              month={shownMonth}
              onMonth={(next) => {
                setMonth(next);
                setDay(null);
              }}
              minMonth={minMonth}
              maxMonth={shiftMonth(minMonth, 12)}
              offers={offers}
              day={openDay}
              onDay={setDay}
            />
            <TimeList
              t={t}
              language={pageLanguage}
              zone={appointment.timezone}
              offers={offers}
              day={openDay}
              busy={busy}
              className="mt-5"
              onPick={async (ms) => {
                setBusy(true);
                setError(null);
                const result = await reschedule({ token, startMs: ms });
                setBusy(false);
                if (result.ok) {
                  setMoving(false);
                  setMoved({ confirmBy: result.confirmBy });
                } else if (result.reason === "slot-taken") {
                  setError("slot-taken");
                } else setError(result.reason ?? "error");
              }}
            />
            <button
              type="button"
              onClick={() => setMoving(false)}
              className="mt-3 text-sm text-[var(--muted)] underline underline-offset-2"
            >
              {t("common.cancel")}
            </button>
          </section>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {error === "slot-taken"
              ? t("booking.slotTaken")
              : error === "customer-busy"
                ? t("booking.customerBusy")
                : error === "too-many-changes"
                  ? t("booking.tooManyChanges")
                  : t("forms.failed")}
          </p>
        )}
      </div>
    </Shell>
  );
}

function Shell({
  title,
  language,
  children,
}: {
  title?: string;
  language?: Language;
  children: React.ReactNode;
}) {
  return (
    // Nested lang overrides LanguageProvider's <html lang> for this subtree —
    // see the same note on the booking page's Shell.
    <main
      lang={language}
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10"
    >
      <div className="card-raised p-5">
        {title && <h1 className="mb-4 text-lg font-semibold">{title}</h1>}
        {children}
      </div>
    </main>
  );
}
