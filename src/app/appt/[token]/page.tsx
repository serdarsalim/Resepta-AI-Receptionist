"use client";

// The self-serve appointment page — where [manage_link] points. The token in
// the URL is the whole capability: whoever holds it may look at, move or
// cancel exactly this one appointment (convex/booking.ts manage/reschedule/
// cancel). No auth, no chrome, phone-first, same as /book and /r.

import { useMutation, useQuery } from "convex/react";
import { use, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { isLanguage, translate, type Language, type TranslationKey } from "@/lib/i18n";

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
  const t = (key: TranslationKey) => translate(pageLanguage, key);
  const reschedule = useMutation(api.booking.reschedule);
  const cancel = useMutation(api.booking.cancel);

  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // Only canModify. It used to also require the org's public booking slug and
  // a serviceId on the line, which is why a phone-booked appointment at a
  // salon with no public booking page showed Cancel alone — while the
  // confirmation message it arrived with promised the customer could change
  // it. slotsForToken asks with the token instead, and reads the length off
  // the appointment, so neither is needed.
  const canPickSlots = Boolean(appointment?.canModify);
  const dateValue =
    date ?? (appointment ? todayIn(appointment.timezone) : "");
  const slots = useQuery(
    api.booking.slotsForToken,
    moving && appointment && canPickSlots ? { token, date: dateValue } : "skip",
  );

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
  const timeLabel = (ms: number) =>
    appointment
      ? new Intl.DateTimeFormat(appointment.language, {
          timeZone: appointment.timezone,
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
          {appointment.status === "cancelled" && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              {t(order ? "booking.orderCancelled" : "booking.cancelled")}
            </p>
          )}
          {moved && (
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
              {t("booking.moved")}
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
            <h2 className="mb-1.5 text-sm font-medium">{t("booking.pickTime")}</h2>
            <input
              type="date"
              value={dateValue}
              min={todayIn(appointment.timezone)}
              onChange={(event) => setDate(event.target.value)}
              className="mb-2"
            />
            {slots === undefined ? (
              <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("booking.noSlots")}</p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {slots.map((ms) => (
                  <button
                    key={ms}
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      const result = await reschedule({ token, startMs: ms });
                      setBusy(false);
                      if (result.ok) {
                        setMoving(false);
                        setMoved(true);
                      } else if (result.reason === "slot-taken") {
                        setError("slot-taken");
                      } else setError(result.reason ?? "error");
                    }}
                    className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm tabular-nums transition-colors hover:border-[var(--accent)] disabled:opacity-50"
                  >
                    {timeLabel(ms)}
                  </button>
                ))}
              </div>
            )}
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
