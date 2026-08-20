"use client";

// The public booking page: the fifth intake, and the first where a stranger
// leaves with an APPOINTMENT rather than a request (see convex/booking.ts for
// the doctrine). Same shell rules as the request form at /r/<slug>: no auth,
// no app chrome, renders on a phone.
//
// A STEP WIZARD, the way every salon-booking product does it (Serdar,
// 2026-08-20, reversing this file's original one-growing-page doctrine): one
// question per screen — service, then time, then who — tapping an answer
// advances, the header's back chevron returns. The screen SWAPS and never
// grows, which is the whole point: the previous design revealed sections
// downward and every selection reflowed the page. The sticky bottom bar
// carries the running choice across steps and, on the last one, is the
// submit.

import { useMutation, useQuery } from "convex/react";
import { use, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { isLanguage, translate, type Language, type TranslationKey } from "@/lib/i18n";
import { PhoneInput } from "@/components/PhoneField";
import { formatMoney } from "@/lib/money";

// A civil date in a timezone, as YYYY-MM-DD — the org's, not the viewer's: a
// Vienna customer at 23:30 books an Istanbul salon whose day has already
// turned.
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

type Step = "service" | "time" | "details";

export default function BookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { language: viewerLanguage } = useLanguage();
  const page = useQuery(api.booking.page, { slug });
  // The page speaks the SALON'S customer language, not the visitor's. Every
  // other language decision on this page already works that way — the times
  // and the prices format through page.language — and only the chrome was
  // reading the viewer's app setting, so a Türkiye salon's page greeted its
  // Turkish customers in whatever the owner last picked in their own account
  // menu. That is the same setting that decides the WhatsApp a customer gets;
  // a booking page that answers a Turkish reminder in English is one product
  // speaking two languages to one person.
  //
  // The viewer's language survives as the fallback for the two states that
  // render before the org is known: loading, and a slug that answers nothing.
  const pageLanguage: Language =
    page && isLanguage(page.language) ? page.language : viewerLanguage;
  const t = (key: TranslationKey) => translate(pageLanguage, key);
  const book = useMutation(api.booking.book);

  const [step, setStep] = useState<Step>("service");
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
    page && serviceId && step !== "service" ? { slug, date: dateValue, serviceId } : "skip",
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
      <Shell language={pageLanguage}>
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      </Shell>
    );
  }
  if (page === null) {
    return (
      <Shell language={pageLanguage}>
        <p className="text-sm text-[var(--muted)]">{t("forms.notFound")}</p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title={page.orgName} logoUrl={page.logoUrl} language={pageLanguage}>
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
      <Shell title={page.orgName} logoUrl={page.logoUrl} language={pageLanguage}>
        <p className="text-sm text-[var(--muted)]">{t("booking.callInstead")}</p>
      </Shell>
    );
  }

  const priceLabel = (minor: number) => formatMoney(minor, page.currency, page.language);
  const days = dayStrip(page.timezone, minMs);
  // Coarse shelves, cut at 12:00 and 17:00. Labels group; hours define.
  const shelves =
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
  const back =
    step === "time"
      ? () => {
          setStep("service");
          setStartMs(null);
          setError(null);
        }
      : step === "details"
        ? () => {
            setStep("time");
            setError(null);
          }
        : undefined;

  return (
    <Shell
      title={page.orgName}
      logoUrl={page.logoUrl}
      onBack={back}
      backLabel={t("common.back")}
      language={pageLanguage}
    >
      {step === "service" && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">{t("booking.pickService")}</h2>
          {/* Rows with duration and price — the price is often the deciding
              fact. Tapping IS the answer: it advances, no Continue button to
              find.

              A DIVIDED LIST, not a bordered box. An outlined rounded-xl panel
              inside a shadowed card is two edges for one surface, and xl is
              the frame tier — the app draws its own lists this way
              (`divide-y divide-[var(--border)]`, BusinessView).

              FULL-BLEED, and the negative margin sits on this wrapper rather
              than on the rows. A w-full flex child keeps its parent's width,
              so -mx on the row only shifted it left and left every divider
              short of the card's right edge. Bleeding the block is also what
              the content wants: this card IS the list, and a menu whose rules
              stop before the edge reads as an unfinished table.

              border-t, not border-y. A closing rule under the last row leaves
              the card's bottom padding stranded beneath it, which reads as a
              seventh, empty service. The card's own edge is the closure. */}
          <div className="-mx-4 divide-y divide-[var(--border)] border-t border-[var(--border)] sm:-mx-5">
            {page.services.map((row) => (
              <button
                key={row._id}
                type="button"
                onClick={() => {
                  if (row._id !== serviceId) setStartMs(null);
                  setServiceId(row._id);
                  setStep("time");
                }}
                className="flex w-full items-baseline justify-between gap-3 px-4 py-3.5 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)] sm:px-5"
              >
                <span className="min-w-0">{row.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                  {/* A good has no minutes to advertise — the name and the
                      price are the whole fact. */}
                  {row.durationMinutes !== undefined && <span>{row.durationMinutes}′</span>}
                  {row.price !== undefined && (
                    <span className="ml-2 font-medium text-[var(--foreground)]">
                      {priceLabel(row.price)}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "time" && service && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">{t("booking.pickTime")}</h2>
          <div className="no-scrollbar -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
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
          {/* slot-taken lands the customer back on this step; the note says
              why their pick is gone. */}
          {error === "slot-taken" && (
            <p className="mb-2 text-sm text-red-600 dark:text-red-400">
              {t("booking.slotTaken")}
            </p>
          )}
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
                    {shelf.slots.map((ms) => (
                      <button
                        key={ms}
                        type="button"
                        onClick={() => {
                          setStartMs(ms);
                          setError(null);
                          setStep("details");
                        }}
                        className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm tabular-nums text-[var(--foreground)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        {timeLabel(ms)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {step === "details" && service && startMs !== null && (
        <form
          id="booking-form"
          className="space-y-4"
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
              // Someone got there first. Back to the grid — which is live —
              // to ask again.
              setStartMs(null);
              setError("slot-taken");
              setStep("time");
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
              autoFocus
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
          {error && error !== "slot-taken" && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {error === "bad-phone"
                ? t("forms.badPhone")
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

      {/* The running choice, pinned across steps. On the last step its
          button submits the form above (form attribute — one button, no
          in-form twin to race it).

          --card, not --background: over a plane the raw page colour is the one
          surface the wash never touches, so the bar read as a strip of a
          different page. A floating surface keeps its hard edge, so the top
          border stays. */}
      {service !== null && (
        <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[var(--card)]/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-4 py-3 sm:px-5">
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
            {step === "details" && (
              <button
                type="submit"
                form="booking-form"
                disabled={sending || !name.trim()}
                className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
              >
                {sending ? t("common.saving") : t("booking.book")}
              </button>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({
  title,
  logoUrl,
  onBack,
  backLabel,
  language,
  children,
}: {
  title?: string;
  logoUrl?: string | null;
  onBack?: () => void;
  backLabel?: string;
  language?: Language;
  children: React.ReactNode;
}) {
  return (
    // lang as an ATTRIBUTE, not an effect. LanguageProvider owns <html lang>
    // and sets it from the viewer's setting; its effect is a PARENT's, so it
    // runs after this page's and would win any race to write the same
    // property. A nested lang just overrides for its subtree, which is what
    // the attribute is for — screen readers and hyphenation read the nearest
    // one, and German is where a wrong lang starts to show.
    <main
      lang={language}
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-28 pt-8 sm:px-5"
    >
      {/* .card-raised is the app's card: rounded-lg, --card-shadow, NO border.
          Padding matches components/Card — p-4 here rather than its p-3 only
          because this card is the whole page rather than one of six stacked in
          a settings column. */}
      <div className="card-raised p-4 sm:p-5">
        {title && (
          <div className="mb-5 flex items-center gap-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label={backLabel}
                className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M10 3L5 8l5 5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
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
