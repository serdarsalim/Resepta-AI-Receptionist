"use client";

// The public booking page: the fifth intake, and the first where a stranger
// leaves with an APPOINTMENT rather than a request (see convex/booking.ts for
// the doctrine). Same shell rules as the request form at /r/<slug>: no auth,
// no app chrome, renders on a phone.
//
// One page, three questions in order — what, when, who. Each answer reveals
// the next question instead of a wizard with steps to lose your place in.

import { useMutation, useQuery } from "convex/react";
import { use, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { PhoneInput } from "@/components/PhoneField";

// Today's civil date in a timezone, as YYYY-MM-DD — the org's, not the
// viewer's: a Vienna customer at 23:30 books an Istanbul salon whose day has
// already turned.
function todayIn(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ token?: string; startMs: number } | null>(null);

  const dateValue = date ?? (page ? todayIn(page.timezone) : "");
  const slots = useQuery(
    api.booking.slots,
    page && serviceId
      ? { slug, date: dateValue, serviceId }
      : "skip",
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
      <Shell title={page.orgName}>
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
      <Shell title={page.orgName}>
        <p className="text-sm text-[var(--muted)]">{t("booking.callInstead")}</p>
      </Shell>
    );
  }

  const service = page.services.find((s) => s._id === serviceId) ?? null;

  return (
    <Shell title={page.orgName}>
      <div className="space-y-5">
        <section>
          <h2 className="mb-1.5 text-sm font-medium">{t("booking.pickService")}</h2>
          <div className="flex flex-wrap gap-1.5">
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
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    picked
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {row.name}
                  <span className="ml-1.5 text-xs opacity-70">{row.durationMinutes}′</span>
                </button>
              );
            })}
          </div>
        </section>

        {service && (
          <section>
            <h2 className="mb-1.5 text-sm font-medium">{t("booking.pickTime")}</h2>
            <input
              type="date"
              value={dateValue}
              min={todayIn(page.timezone)}
              onChange={(event) => {
                setDate(event.target.value);
                setStartMs(null);
              }}
              className="mb-2"
            />
            {slots === undefined ? (
              <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("booking.noSlots")}</p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {slots.map((ms) => {
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
            )}
          </section>
        )}

        {service && startMs !== null && (
          <form
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
            <p className="text-sm text-[var(--muted)]">
              {service.name} · {dateTimeLabel(startMs)}
            </p>
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
                    : error === "too-many"
                      ? t("booking.tooMany")
                      : t("forms.failed")}
              </p>
            )}
            <button
              type="submit"
              disabled={sending || !name.trim()}
              className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {sending ? t("common.saving") : t("booking.book")}
            </button>
          </form>
        )}
      </div>
    </Shell>
  );
}

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="card-raised p-5">
        {title && <h1 className="mb-4 text-lg font-semibold">{title}</h1>}
        {children}
      </div>
    </main>
  );
}
