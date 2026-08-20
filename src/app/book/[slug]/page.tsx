"use client";

// The public booking page: the fifth intake, and the first where a stranger
// leaves with an APPOINTMENT rather than a request (see convex/booking.ts for
// the doctrine). Same shell rules as the request form at /r/<slug>: no auth,
// no app chrome, renders on a phone.
//
// One page, three questions in order — what, when, who. Each answer reveals
// the next question instead of a wizard with steps to lose your place in.
// What keeps the growing page legible is the sticky bar (Serdar, 2026-08-20):
// the running choice and the one button live pinned at the bottom, so the
// customer always sees what they have picked and what happens next, however
// far the page has grown. The bar IS the submit — the form has no second
// button to race it.

import { useMutation, useQuery } from "convex/react";
import { use, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { PhoneInput } from "@/components/PhoneField";
import { formatMoney } from "@/lib/money";

// Today's civil date in a timezone, as YYYY-MM-DD — the org's, not the
// viewer's: a Vienna customer at 23:30 books an Istanbul salon whose day has
// already turned.
function dayIn(timezone: string, atMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(atMs));
}

// The next 14 offerable days from a floor, as {date, ms}. Steps in 24h
// increments and dedupes, because a DST fall-back would otherwise mint the
// same civil date twice (Austria has DST even though Turkey no longer does).
function dayStrip(timezone: string, fromMs: number): { date: string; ms: number }[] {
  const out: { date: string; ms: number }[] = [];
  for (let i = 0; out.length < 14 && i < 16; i++) {
    const ms = fromMs + i * 86_400_000;
    const date = dayIn(timezone, ms);
    if (out.length === 0 || out[out.length - 1].date !== date) out.push({ date, ms });
  }
  return out;
}

export default function BookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { t } = useLanguage();
  const page = useQuery(api.booking.page, { slug });
  const book = useMutation(api.booking.book);

  const [serviceId, setServiceId] = useState<Id<"services"> | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [startMs, setStartMs] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ token?: string; startMs: number } | null>(null);

  const service = page ? (page.services.find((s) => s._id === serviceId) ?? null) : null;
  // A good with a lead time cannot be had tomorrow morning; the day strip
  // starts at the floor instead of letting every too-soon day answer "no
  // times".
  const isGood = service !== null && service.durationMinutes === undefined;
  const minMs =
    service?.leadMinutes !== undefined
      ? Date.now() + service.leadMinutes * 60_000
      : Date.now();
  const minDate = page ? dayIn(page.timezone, minMs) : "";
  // A date picked for the previous service may sit before this one's lead
  // floor; string-compare works because both are ISO.
  const dateValue = date && date >= minDate ? date : minDate;
  const slots = useQuery(
    api.booking.slots,
    page && serviceId ? { slug, date: dateValue, serviceId } : "skip",
  );

  // The salon's wall clock, whatever the viewer's — the label must say what
  // the clock on the salon's wall will say. Formatter built per call: a page
  // renders a few dozen labels, and the React Compiler owns the memo now.
  const timeLabel = (ms: number) =>
    page
      ? new Intl.DateTimeFormat(page.language, {
          timeZone: page.timezone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(ms))
      : "";
  const dateTimeLabel = (ms: number) =>
    page
      ? new Intl.DateTimeFormat(page.language, {
          timeZone: page.timezone,
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(ms))
      : "";
  const hourIn = (ms: number) =>
    page
      ? Number(
          new Intl.DateTimeFormat("en-GB", {
            timeZone: page.timezone,
            hour: "2-digit",
            hourCycle: "h23",
          }).format(new Date(ms)),
        )
      : 0;

  if (page === undefined) {
    return (
      <Shell>
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      </Shell>
    );
  }
  if (page === null) {
    return (
      <Shell>
        <p className="text-sm text-[var(--muted)]">{t("forms.notFound")}</p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title={page.orgName} logoUrl={page.logoUrl}>
        <p className="text-sm font-medium">{t("booking.booked")}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">{dateTimeLabel(done.startMs)}</p>
        {done.token && (
          <p className="mt-4 text-sm">
            <a
              href={`/appt/${done.token}`}
              className="text-[var(--accent)] underline underline-offset-2"
            >
              {t("booking.manageThis")}
            </a>
          </p>
        )}
        <p className="mt-2 text-xs text-[var(--muted)]">{t("booking.confirmationHint")}</p>
      </Shell>
    );
  }

  // An org with no posted hours cannot honestly draw a slot grid.
  if (!page.hasHours || page.services.length === 0) {
    return (
      <Shell title={page.orgName} logoUrl={page.logoUrl}>
        <p className="text-sm text-[var(--muted)]">{t("booking.callInstead")}</p>
      </Shell>
    );
  }

  const priceLabel = (minor: number) => formatMoney(minor, page.currency, page.language);
  const days = dayStrip(page.timezone, minMs);
  // Coarse shelves, cut at 12:00 and 17:00. Labels group; hours define.
  const shelves: { key: "booking.morning" | "booking.afternoon" | "booking.evening"; slots: number[] }[] =
    slots === undefined
      ? []
      : [
          {
            key: "booking.morning" as const,
            slots: slots.filter((ms) => hourIn(ms) < 12),
          },
          {
            key: "booking.afternoon" as const,
            slots: slots.filter((ms) => hourIn(ms) >= 12 && hourIn(ms) < 17),
          },
          {
            key: "booking.evening" as const,
            slots: slots.filter((ms) => hourIn(ms) >= 17),
          },
        ].filter((shelf) => shelf.slots.length > 0);
  const summaryName =
    service === null
      ? ""
      : isGood && quantity > 1
        ? `${quantity} × ${service.name}`
        : service.name;

  return (
    <Shell title={page.orgName} logoUrl={page.logoUrl} padForBar={service !== null}>
      <div className="space-y-6">
        <section>
          <h2 className="mb-2 text-sm font-medium">{t("booking.pickService")}</h2>
          {/* Rows, not a pill cloud (Serdar, 2026-08-20): the price is often
              the deciding fact and a pill has no room for it, and long
              Turkish service names wrapped the cloud into confetti. */}
          <div className="overflow-hidden rounded-xl border border-[var(--border)]">
            {page.services.map((row) => {
              const picked = row._id === serviceId;
              return (
                <button
                  key={row._id}
                  type="button"
                  aria-pressed={picked}
                  onClick={() => {
                    setServiceId(row._id);
                    setStartMs(null);
                  }}
                  className={`flex w-full items-baseline justify-between gap-3 border-b border-[var(--border)] px-3.5 py-2.5 text-left text-sm transition-colors last:border-b-0 ${
                    picked
                      ? "bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
                      : "hover:bg-[var(--muted-bg)]"
                  }`}
                >
                  <span className="min-w-0">{row.name}</span>
                  <span
                    className={`shrink-0 text-xs tabular-nums ${picked ? "" : "text-[var(--muted)]"}`}
                  >
                    {/* A good has no minutes to advertise — the name and the
                        price are the whole fact. */}
                    {row.durationMinutes !== undefined && <span>{row.durationMinutes}′</span>}
                    {row.price !== undefined && (
                      <span className="ml-2 font-medium">{priceLabel(row.price)}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {service && (
          <section>
            <h2 className="mb-2 text-sm font-medium">{t("booking.pickTime")}</h2>
            {/* Fourteen days as a strip instead of a native date input, which
                rendered mm/dd/yyyy at a Turkish customer and hid how near the
                next free day was. */}
            <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {days.map((day) => {
                const picked = day.date === dateValue;
                const parts = new Intl.DateTimeFormat(page.language, {
                  timeZone: page.timezone,
                  weekday: "short",
                  day: "numeric",
                }).formatToParts(new Date(day.ms));
                const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
                const dayNum = parts.find((p) => p.type === "day")?.value ?? "";
                return (
                  <button
                    key={day.date}
                    type="button"
                    aria-pressed={picked}
                    onClick={() => {
                      setDate(day.date);
                      setStartMs(null);
                    }}
                    className={`flex shrink-0 flex-col items-center rounded-xl border px-3 py-1.5 transition-colors ${
                      picked
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    <span className="text-[11px] uppercase tracking-wide">{weekday}</span>
                    <span className="text-sm font-medium tabular-nums">{dayNum}</span>
                  </button>
                );
              })}
            </div>
            {slots === undefined ? (
              <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("booking.noSlots")}</p>
            ) : (
              <div className="space-y-3">
                {shelves.map((shelf) => (
                  <div key={shelf.key}>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      {t(shelf.key)}
                    </p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {shelf.slots.map((ms) => {
                        const picked = ms === startMs;
                        return (
                          <button
                            key={ms}
                            type="button"
                            aria-pressed={picked}
                            onClick={() => setStartMs(ms)}
                            className={`rounded-lg border px-2 py-1.5 text-sm tabular-nums transition-colors ${
                              picked
                                ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
                                : "border-[var(--border)] text-[var(--foreground)]"
                            }`}
                          >
                            {timeLabel(ms)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {service && startMs !== null && (
          <form
            id="booking-form"
            className="space-y-4 border-t border-[var(--border)] pt-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (sending) return;
              const phone = String(new FormData(event.currentTarget).get("phone") ?? "");
              if (!phone.trim()) {
                setError("bad-phone");
                return;
              }
              setSending(true);
              setError(null);
              const result = await book({
                slug,
                serviceId: service._id,
                startMs,
                name,
                phone,
                ...(email.trim() ? { email } : {}),
                ...(isGood && quantity > 1 ? { quantity } : {}),
              });
              setSending(false);
              if (result.ok) setDone({ token: result.token, startMs });
              else if (result.reason === "slot-taken") {
                // Someone got there first. Clear the pick so the grid — which
                // is live — asks again.
                setStartMs(null);
                setError("slot-taken");
              } else setError(result.reason ?? "error");
            }}
          >
            {/* How many, goods only: ordering three cakes is one order for a
                moment, not three bookings. */}
            {isGood && (
              <label className="block text-sm">
                {t("appointments.quantity")}
                <input
                  type="number"
                  min={1}
                  max={99}
                  step={1}
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(Math.min(99, Math.max(1, Math.round(Number(e.target.value) || 1))))
                  }
                  className="mt-1 w-24"
                />
              </label>
            )}
            <label className="block text-sm">
              {t("forms.name")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mt-1"
              />
            </label>
            <div className="text-sm">
              {t("forms.phone")}
              <PhoneInput required className="mt-1" />
            </div>
            <label className="block text-sm">
              {`${t("forms.email")} (${t("common.optional")})`}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1"
              />
            </label>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {error === "bad-phone"
                  ? t("forms.badPhone")
                  : error === "slot-taken"
                    ? t("booking.slotTaken")
                    : error === "customer-busy"
                      ? t("booking.customerBusy")
                      : error === "too-many"
                        ? t("booking.tooMany")
                        : error === "lead-time"
                          ? t("booking.leadTime")
                          : t("forms.failed")}
              </p>
            )}
          </form>
        )}
      </div>

      {/* The running choice, always in view. Submits the form above via the
          form attribute — one button, however long the page grows. */}
      {service && (
        <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">
                {summaryName}
                {service.price !== undefined && (
                  <span className="ml-2 text-[var(--muted)]">
                    {priceLabel(service.price * (isGood ? quantity : 1))}
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-[var(--muted)]">
                {startMs !== null ? dateTimeLabel(startMs) : t("booking.pickTime")}
              </p>
            </div>
            <button
              type="submit"
              form="booking-form"
              disabled={sending || startMs === null || !name.trim()}
              className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {sending ? t("common.saving") : t("booking.book")}
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({
  title,
  logoUrl,
  padForBar,
  children,
}: {
  title?: string;
  logoUrl?: string | null;
  padForBar?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main
      className={`mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10 ${
        padForBar ? "pb-28" : ""
      }`}
    >
      <div className="card-raised p-5">
        {title && (
          <div className="mb-5 flex items-center gap-3">
            {logoUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- a
                 Convex storage URL, not an asset next/image can optimize */
              <img
                src={logoUrl}
                alt=""
                className="h-12 w-12 rounded-xl border border-[var(--border)] object-cover"
              />
            )}
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
        )}
        {children}
      </div>
    </main>
  );
}
