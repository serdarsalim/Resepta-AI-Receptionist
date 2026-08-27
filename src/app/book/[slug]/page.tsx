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
import { MAX_LINES_PER_BOOKING } from "../../../../convex/lib/bookingLimits";
import { slugify } from "../../../../convex/lib/publicSlug";
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

// The device remembers its owner. Written after a successful booking, read
// back on the next visit, so a repeat customer meets their own name and
// number already filled in instead of a blank form. One key for the whole
// product rather than per salon — these are the customer's own details, the
// same at every salon they book.
//
// Deliberately NOT a server lookup: a page that answers a typed phone number
// with the matching name would hand anyone's identity to whoever types their
// number. The server still matches by phone on submit; it just never echoes.
const CONTACT_KEY = "resepta.bookingContact";
type StoredContact = { name?: string; phone?: string; email?: string };
function storedContact(): StoredContact {
  // Guarded: this also runs during prerender, where there is no storage.
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CONTACT_KEY) ?? "null");
    if (parsed && typeof parsed === "object") return parsed as StoredContact;
  } catch {
    // A blocked or corrupted store reads as a first visit.
  }
  return {};
}

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
  // The whole selection, in the order it was tapped — one visit with several
  // lines, which is what appointments.items has modelled since long before
  // this page could express it. quantity is carried for every line and only
  // ever read for goods; two haircuts is two visits, not a 2 on one line.
  const [lines, setLines] = useState<{ serviceId: Id<"services">; quantity: number }[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [startMs, setStartMs] = useState<number | null>(null);
  // Read once at mount; the details step mounts and unmounts as the wizard
  // swaps screens, so the prefill has to live up here with the other fields.
  const [prefill] = useState(storedContact);
  const [name, setName] = useState(prefill.name ?? "");
  const [email, setEmail] = useState(prefill.email ?? "");
  const [note, setNote] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ token?: string; startMs: number } | null>(null);

  // Resolved against the published list every render rather than stored, so a
  // service the salon retires while someone has the page open drops out of the
  // selection instead of being booked from a stale copy.
  const picked = (page?.services ?? []).flatMap((service) => {
    const line = lines.find((row) => row.serviceId === service._id);
    return line ? [{ ...service, quantity: line.quantity }] : [];
  });
  const totalMinutes = picked.reduce((sum, row) => sum + (row.durationMinutes ?? 0), 0);
  // Goods multiply, time-bound services do not — the schema's rule, and the
  // reason quantity is not simply applied to every line.
  const totalPrice = picked.reduce(
    (sum, row) =>
      sum + (row.price ?? 0) * (row.durationMinutes === undefined ? row.quantity : 1),
    0,
  );
  const anyPriced = picked.some((row) => row.price !== undefined);
  // The MAX lead across the selection, matching resolveLines on the server: a
  // colour needing a day's notice needs it whatever else rides along. Anything
  // else and the day strip would offer days the write refuses.
  const leadMinutes = picked.reduce((max, row) => Math.max(max, row.leadMinutes ?? 0), 0);
  const minMs = Date.now() + leadMinutes * 60_000;
  const minDate = page ? dayIn(page.timezone, minMs) : "";
  // A date picked for a previous selection may sit before this one's lead
  // floor; string-compare works because both are ISO.
  const dateValue = date && date >= minDate ? date : minDate;
  const slots = useQuery(
    api.booking.slots,
    page && lines.length > 0 && step !== "service"
      ? { slug, date: dateValue, serviceIds: lines.map((row) => row.serviceId) }
      : "skip",
  );

  // Any change to WHAT is being booked invalidates WHEN: the grid was drawn
  // for a different total duration, so a time still held from before is a time
  // the write will refuse.
  const toggleLine = (serviceId: Id<"services">) => {
    setStartMs(null);
    setError(null);
    setLines((prev) =>
      prev.some((row) => row.serviceId === serviceId)
        ? prev.filter((row) => row.serviceId !== serviceId)
        : [...prev, { serviceId, quantity: 1 }],
    );
  };
  // Goods only. Down from 1 removes the line, which is what the − button
  // reads as when there is one left.
  const setQuantity = (serviceId: Id<"services">, next: number) => {
    if (next < 1) return toggleLine(serviceId);
    setLines((prev) =>
      prev.map((row) =>
        row.serviceId === serviceId ? { ...row, quantity: Math.min(99, next) } : row,
      ),
    );
  };

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

  const priceLabel = (minor: number) =>
    formatMoney(minor, page.currency, page.language, page.priceDecimals);
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
  // Two purchases, not one list. A product is handed over and adds no minutes;
  // a service books a chair for a length of time. The split is only DRAWN when
  // the salon actually sells both — a header over the whole list names nothing.
  // Matched through lib/publicSlug's slugger on BOTH sides, which is doing
  // real work rather than saving a toLowerCase: it folds Turkish to ASCII, so
  // "sac" finds "Saç kesimi" and "boyama" finds "Saç boyama" without the
  // customer reaching for a Turkish keyboard. Hyphenation is harmless here —
  // both sides get it, so "sac k" slugs to "sac-k" and still matches.
  const needle = slugify(query);
  const matches = (name: string) => !needle || slugify(name).includes(needle);
  const groups = [
    {
      key: "booking.services" as const,
      rows: page.services.filter(
        (row) => row.durationMinutes !== undefined && matches(row.name),
      ),
    },
    {
      key: "booking.products" as const,
      rows: page.services.filter(
        (row) => row.durationMinutes === undefined && matches(row.name),
      ),
    },
  ].filter((group) => group.rows.length > 0);

  // A good's quantity rides in front of its name, the same shape wa.ts prints
  // in the confirmation they get afterwards.
  const lineName = (row: (typeof picked)[number]) =>
    row.durationMinutes === undefined && row.quantity > 1
      ? `${row.quantity} × ${row.name}`
      : row.name;
  // Goods multiply, services do not — the same asymmetry totalPrice applies.
  const lineWorth = (row: (typeof picked)[number]) =>
    (row.price ?? 0) * (row.durationMinutes === undefined ? row.quantity : 1);

  // "1 sa 30 dk" in Turkish, "1 hr 30 min" in English — Intl decides the unit
  // word and the order, which differ by locale and are not ours to guess. A
  // selection of goods alone has no minutes to announce.
  const minutesLabel = (minutes: number) => {
    if (minutes <= 0) return "";
    const unit = (value: number, name: "hour" | "minute") =>
      new Intl.NumberFormat(pageLanguage, {
        style: "unit",
        unit: name,
        unitDisplay: "short",
      }).format(value);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (!hours) return unit(rest, "minute");
    return rest ? `${unit(hours, "hour")} ${unit(rest, "minute")}` : unit(hours, "hour");
  };

  // ONE line names itself; two or more count. Joining them with " + " read as
  // a formula and truncated anyway — "Saç kesimi + Sakal tıraşı + Saç boya…"
  // told the customer neither what the third thing was nor that there were
  // only three.
  const summaryName =
    picked.length === 0
      ? // Blank, not "0 items". The bar is present from the first paint so the
        // button never moves, and a bar that opens by announcing it holds
        // nothing is the third thing on that screen asking for a selection.
        ""
      : picked.length === 1
        ? lineName(picked[0])
        : t("booking.itemCount").replace("{n}", String(picked.length));
  // Before a time is picked the duration is the whole answer; after, the time
  // leads and the duration stays, because "how long will I be there" does not
  // stop mattering once you know when you are arriving.
  const barMeta =
    startMs !== null
      ? `${dateTimeLabel(startMs)} · ${minutesLabel(totalMinutes)}`
      : minutesLabel(totalMinutes);
  // The lines are listed ONLY where they are not already on screen. On the
  // service step the ticked rows sit six inches above the bar, so a panel
  // repeating them is a copy of the thing it is summarising — and the chevron
  // that used to hide it was a control whose whole job was to spare the reader
  // that copy. Delete the copy and the control goes with it.
  const showLines = step !== "service" && picked.length > 1;
  // The SERVER's cap, imported rather than restated. Without it the page let a
  // customer tick a twelfth line and said nothing: resolveLines then refused
  // the whole booking, so the slot grid answered "no free times" — a lie — and
  // the real refusal arrived as a generic failure after they had typed their
  // phone number.
  const basketFull = lines.length >= MAX_LINES_PER_BOOKING;
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
      language={pageLanguage}
      footer={
        /* The basket bar. TWO ROWS, with the action alone on the second: at
           the end of one line the button sat wedged against the total, so the
           two loudest things on the card — what it costs and what happens
           next — were fighting for the same corner. Given its own row it has
           the width to be pressed and the total has the width to be read.

           ONE button, always in that corner, greyed until it can do something.
           It used to appear on the service step, vanish on the time step and
           come back on the details step, so the bar's right edge was a
           different shape on each of three screens and the reader had to find
           the next move again every time. Always there and sometimes disabled
           says "there is a next step, not yet" — which is true — where an
           absent one says nothing at all. The time step's is a formality by
           design: tapping a slot still advances, so it is only ever seen
           disabled. That is the point; it holds the corner.

           The card's last flex row at every width — no fixed, no sticky, no
           backdrop blur. All three existed to fake this attachment while the
           bar was pinned to the viewport instead of to the card; once the card
           is a fixed-height column the bar simply IS its bottom. It keeps the
           top border, which is now a rule between two rows of one card rather
           than the edge of a floating surface. */
        <div className="-mx-4 -mb-4 mt-3 rounded-b-lg border-t border-[var(--border)] sm:-mx-5 sm:-mb-5 sm:mt-4">
          {/* The lines, ONLY on the steps where they are not already on
              screen. On the service step the ticked rows sit above this bar,
              so a panel repeating them is a copy of the thing it summarises;
              from the time step on that list is gone and the customer has
              nothing else to check a selection against. No chevron either way:
              it shipped behind one, which was a control whose whole job was to
              spare the reader a duplicate. Delete the duplicate and the
              control goes with it. Capped and scrollable only so the largest
              basket the server takes (ten lines) cannot swallow a phone. */}
          {showLines && (
            <ul className="mx-auto max-h-[30vh] w-full max-w-md space-y-1.5 overflow-y-auto border-b border-[var(--border)] px-4 py-2.5 sm:px-5">
              {picked.map((row) => (
                <li key={row._id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{lineName(row)}</span>
                  <span className="flex shrink-0 items-baseline gap-3">
                    {row.durationMinutes !== undefined && (
                      <span className="text-xs text-[var(--muted)]">
                        {minutesLabel(row.durationMinutes)}
                      </span>
                    )}
                    {row.price !== undefined && (
                      <span className="tabular-nums">{priceLabel(lineWorth(row))}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mx-auto w-full max-w-md space-y-2 px-4 py-3 sm:px-5">
            {/* Blank until something is picked. The heading above already asks
                the question, and a bar repeating it would be the third place
                on one screen saying "choose a service". */}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-medium">{summaryName}</p>
                <p className="truncate text-xs text-[var(--muted)]">{barMeta}</p>
              </div>
              {anyPriced && (
                <p className="shrink-0 text-sm font-semibold tabular-nums">
                  {priceLabel(totalPrice)}
                </p>
              )}
            </div>
            {/* Back sits HERE, not in the header. As a chevron beside the logo
                it pushed the logo and the salon's name to the right on every
                step that had somewhere to go back to, so the card's identity
                moved while its content changed. Reserving an empty slot fixed
                the shift and left a hole; putting it in the action row fixes
                both, and it belongs here anyway — back and forward are the
                same kind of thing, and this is the row that holds them. */}
            <div className="flex items-center justify-between gap-3">
              {back ? (
                <button
                  type="button"
                  onClick={back}
                  className="flex items-center gap-1 rounded-lg px-1.5 py-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M10 3L5 8l5 5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {t("common.back")}
                </button>
              ) : (
                // Holds the left end so the primary stays pinned right whether
                // or not there is a way back.
                <span />
              )}
              {step === "details" ? (
                <button
                  type="submit"
                  form="booking-form"
                  disabled={sending || !name.trim()}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-45"
                >
                  {sending ? t("common.saving") : t("booking.book")}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={step === "service" ? picked.length === 0 : startMs === null}
                  onClick={() => setStep(step === "service" ? "time" : "details")}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-45"
                >
                  {t("booking.continue")}
                </button>
              )}
            </div>
          </div>
        </div>
      }
    >
      {step === "service" && (
        <section>
          {/* The heading row IS the search row. Collapsed it is a heading and
              a magnifier; open, the field takes the line the heading was
              using. A search box sitting open on every visit would be the
              first thing a customer meets on a page whose whole job is a list
              they can usually just read. */}
          <div className="mb-3 flex h-8 items-center gap-2">
            {searchOpen ? (
              <>
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("common.search")}
                  // Closes on blur only when it found nothing to keep — a
                  // filter still narrowing the list has to survive the tap
                  // that picks a row out of it.
                  onBlur={() => !query.trim() && setSearchOpen(false)}
                  className="h-8 min-w-0 flex-1 px-2.5 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setSearchOpen(false);
                  }}
                  aria-label={t("common.cancel")}
                  className="shrink-0 rounded-lg px-1.5 py-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  ×
                </button>
              </>
            ) : (
              <>
                <h2 className="min-w-0 flex-1 text-sm font-semibold">
                  {t("booking.pickService")}
                </h2>
                {/* Always offered, no row-count threshold. Collapsing to a
                    magnifier IS the answer to a short list: it costs one quiet
                    glyph, where a box open on arrival would be the first thing
                    a customer meets on a page whose job is a list they can
                    usually just read. */}
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  aria-label={t("common.search")}
                  className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
                    <path
                      d="M10.5 10.5L14 14"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </>
            )}
          </div>
          {basketFull && (
            <p className="mb-3 text-xs text-[var(--muted)]">
              {t("booking.maxLines").replace("{n}", String(MAX_LINES_PER_BOOKING))}
            </p>
          )}
          {/* MULTI-SELECT since 2026-08-20, reversing this page's own
              "tapping an answer IS the advance" rule for this step only. A
              haircut plus a beard trim is one visit — appointments.items has
              said so since before this page existed — and a page that books
              one thing sent a customer who wanted both back round to book
              twice. A choice you can add to cannot also be the advance, so
              this step alone ends on the sticky bar's Continue. Steps 2 and 3
              still advance on the tap: they ask for one answer each.

              SERVICES AND PRODUCTS are separated, because they are not the
              same purchase. One books a chair for a length of time, the other
              is handed over and adds no minutes — and with the duration line
              being the only tell, a product read as a service someone forgot
              to time. The headings appear only when both kinds exist; a salon
              that sells nothing would otherwise get a section header over its
              entire list.

              A DIVIDED LIST, not a bordered box: an outlined panel inside a
              shadowed card is two edges for one surface, and xl is the frame
              tier — the app draws its own lists this way. Full-bleed with the
              negative margin on the WRAPPER, since a w-full flex child keeps
              its parent's width and would leave every divider short of the
              card's right edge. border-t, not border-y, or the card's bottom
              padding is stranded under a closing rule and reads as one more,
              empty row. */}
          {groups.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--muted)]">
              {t("booking.noMatches")}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.key} className="mt-4 first:mt-0">
              {groups.length > 1 && (
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  {t(group.key)}
                </p>
              )}
              <div className="-mx-4 divide-y divide-[var(--border)] border-t border-[var(--border)] sm:-mx-5">
                {group.rows.map((row) => {
                  const line = lines.find((l) => l.serviceId === row._id);
                  const isGood = row.durationMinutes === undefined;
                  // A selected good trades its tick for the stepper: the count
                  // IS the state readout, and two of them would disagree the
                  // moment one changed.
                  const stepping = isGood && Boolean(line);
                  return (
                    <div
                      key={row._id}
                      className={`flex items-center transition-colors ${
                        line ? "bg-[var(--muted-bg)]" : "hover:bg-[var(--row-hover-bg)]"
                      }`}
                    >
                      {/* The TICK LIVES INSIDE THE BUTTON. It shipped as a
                          sibling of it, swept out alongside the stepper, which
                          made the one thing on the row that looks like the
                          control the one place a tap did nothing — the row
                          only answered where the words were. It is a readout,
                          not a control, so it belongs in the target rather
                          than beside it.

                          The stepper genuinely cannot: a button inside a
                          button is invalid markup, and on a phone it is also a
                          target inside a target. So it stays a sibling, and
                          the row's padding moves onto the button so everything
                          that is not the stepper is tappable. */}
                      <button
                        type="button"
                        aria-pressed={Boolean(line)}
                        // Full basket disables what is NOT already in it —
                        // removing a line has to stay possible, or the only
                        // way out of a full basket is reloading the page.
                        disabled={basketFull && !line}
                        onClick={() => toggleLine(row._id)}
                        className={`flex min-w-0 flex-1 items-center justify-between gap-3 py-3.5 pl-4 text-left text-sm disabled:opacity-45 sm:pl-5 ${
                          stepping ? "pr-2" : "pr-4 sm:pr-5"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{row.name}</span>
                          {/* Its OWN line, in words. "30′" was a prime symbol
                              the width of a comma, greyed out and pushed
                              against the price — the one fact a customer
                              needs to know whether they have time today. */}
                          {!isGood && (
                            <span className="mt-0.5 block text-xs text-[var(--muted)]">
                              {minutesLabel(row.durationMinutes ?? 0)}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          {row.price !== undefined && (
                            <span className="text-sm font-medium tabular-nums">
                              {priceLabel(row.price)}
                            </span>
                          )}
                          {!stepping && <Tick on={Boolean(line)} />}
                        </span>
                      </button>
                      {stepping && line && (
                        <span className="flex shrink-0 items-center gap-1 pr-4 sm:pr-5">
                          <StepperButton
                            label="−"
                            onClick={() => setQuantity(row._id, line.quantity - 1)}
                          />
                          <span className="w-5 text-center text-sm tabular-nums">
                            {line.quantity}
                          </span>
                          <StepperButton
                            label="+"
                            onClick={() => setQuantity(row._id, line.quantity + 1)}
                          />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      {step === "time" && picked.length > 0 && (
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
          {/* The grid RESERVES its room. All three states live in one box with
              a floor under it — loading, no-times, and a full morning — so the
              card is the size it is going to be before the query lands and
              stays that size as the customer taps down the day strip. Without
              it the card grew when the slots arrived and resized again on every
              day with a different number of them, which is the reflow this
              wizard exists to avoid: the whole reason it swaps screens rather
              than revealing sections is that nothing should move under a
              thumb already on its way down.

              14rem is two shelves — a morning and an afternoon — which is what
              a working day actually returns. A third shelf still grows the
              card, but an evening's worth of slots appearing is a fact about
              that day rather than a jump between two of them. */}
          <div className="min-h-[14rem]">
            {slots === undefined ? (
              // Centred in the reserved box rather than sitting on top of it.
              // The room is held either way; a single line pinned to the top
              // of 14rem of white reads as a gap where something failed.
              <p className="flex h-56 items-center justify-center text-sm text-[var(--muted)]">
                {t("common.loading")}
              </p>
            ) : slots.length === 0 ? (
              <p className="flex h-56 items-center justify-center text-center text-sm text-[var(--muted)]">
                {t("booking.noSlots")}
              </p>
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
          </div>
        </section>
      )}

      {step === "details" && picked.length > 0 && startMs !== null && (
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
              lines: picked.map((row) => ({
                serviceId: row._id,
                // Sent for goods only, matching the server: a quantity on a
                // time-bound line is a booking the calendar cannot hold.
                ...(row.durationMinutes === undefined && row.quantity > 1
                  ? { quantity: row.quantity }
                  : {}),
              })),
              startMs,
              name,
              phone,
              ...(email.trim() ? { email } : {}),
              ...(note.trim() ? { note } : {}),
            });
            setSending(false);
            if (result.ok) {
              try {
                localStorage.setItem(
                  CONTACT_KEY,
                  JSON.stringify({
                    name: name.trim(),
                    phone,
                    ...(email.trim() ? { email: email.trim() } : {}),
                  }),
                );
              } catch {
                // A full or blocked store costs the prefill, not the booking.
              }
              setDone({ token: result.token, startMs });
            }
            else if (result.reason === "slot-taken") {
              // Someone got there first. Back to the grid — which is live —
              // to ask again.
              setStartMs(null);
              setError("slot-taken");
              setStep("time");
            } else setError(result.reason ?? "error");
          }}
        >
          {/* Label left, control right from sm — the shape every settings row
              in the app already has, and here it also buys back the height
              three stacked labels were spending. Below sm it stacks, which is
              what ROW_GRID does too.

              6rem, measured rather than picked. The card's grid is 359px; at
              7rem the control column came to 231 and the phone row needs 235
              (an 85px country chip, a 6px gap, and the number field's 144px
              floor), so the chip wrapped onto its own line by four pixels. A
              narrower label column is the honest fix — these are two words
              each — and it leaves the phone row twelve pixels of slack rather
              than none. */}
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center">
            {/* PHONE FIRST. It is how the salon knows who this is — the key
                every other lane (WhatsApp, voice, the CRM) already runs on —
                and the one field the device memory cannot spare a stranger.
                A span, not a label: PhoneInput is a country select plus a
                text field, and a label pointing at one of two controls would
                send a click to whichever it named. */}
            <span className="text-sm">{t("forms.phone")}</span>
            <PhoneInput required autoFocus defaultValue={prefill.phone} />
            <label htmlFor="booking-name" className="text-sm">
              {t("forms.name")}
            </label>
            <input
              id="booking-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            {/* "Optional" moved into the box, the way Business settings marks
                an optional price. As part of the LABEL it was the longest
                string in the column and set its width on its own — a
                parenthesis deciding how much room the phone field gets. */}
            <label htmlFor="booking-email" className="text-sm">
              {t("forms.email")}
            </label>
            <input
              id="booking-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("common.optional")}
            />
            {/* Last, and the only row whose control is taller than its label —
                so it sits items-start against it rather than floating in the
                middle of three lines of box. It lands as a note on the
                customer's record (convex/booking.book), which is where the
                salon already reads everything else about them. */}
            <label htmlFor="booking-note" className="text-sm sm:self-start sm:pt-2">
              {t("booking.note")}
            </label>
            <textarea
              id="booking-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("booking.notePlaceholder")}
              className="resize-none"
            />
          </div>
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

    </Shell>
  );
}

// The selection mark. A ring rather than a checkbox: the whole row is the
// target, so this is a state readout, not a second control to aim at.
function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
        on
          ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
          : "border-[var(--border)]"
      }`}
    >
      {on && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.5L5 9l4.5-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

// Goods only. Three shampoos is one handover, so it is a quantity — where
// three haircuts is three visits and cannot be one line at all (the schema's
// rule, kept because the calendar is what disagrees otherwise).
function StepperButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-sm leading-none text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
    >
      {label}
    </button>
  );
}

function Shell({
  title,
  logoUrl,
  language,
  footer,
  children,
}: {
  title?: string;
  logoUrl?: string | null;
  language?: Language;
  // The basket bar. A separate slot rather than the last child of `children`
  // because from sm the card is a fixed-height flex column and this is the row
  // that must NOT scroll — it has to be a sibling of the scrolling middle, not
  // inside it.
  footer?: React.ReactNode;
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
      // h-dvh, not min-h: the card below is a fixed-height column that fills
      // it, so this is the frame rather than a floor to grow past.
      className="mx-auto flex h-dvh w-full max-w-md flex-col px-4 py-8 sm:px-5"
    >
      {/* .card-raised is the app's card: rounded-lg, --card-shadow, NO border.

          FIXED HEIGHT at every width, with the middle scrolling and the basket
          as the last row. Every step holds a different amount — six services, a
          slot grid, three fields — so the card resized under the reader at
          every tap, and fixing it per step meant another reserved height
          guessing at content the page does not control. One height for the
          whole wizard costs one guess instead of three.

          Desktop-only at first, with the phone keeping page scroll and a bar
          fixed to the viewport. That was wrong in the way only a phone shows:
          the card ended halfway up the screen and the bar sat at the bottom
          with a hand's width of plane between them, reading as two unrelated
          surfaces rather than one card with a footer. The dynamic-viewport
          unit is what makes the single version safe — 100dvh tracks the
          address bar instead of fighting it.

          The whole fixed/sticky/static split goes with it: the bar is simply
          the card's last flex row now, at every width. */}
      <div className="card-raised flex min-h-0 flex-1 flex-col p-4 sm:max-h-[46rem] sm:p-5">
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
        {/* The scrolling middle. min-h-0 is load-bearing: a flex child's
            default min-height is its content, so without it flex-1 never
            shrinks and the box just grows past the card again.

            It spans card edge to card edge and restores the gutter with its
            own padding, so the full-bleed service list still reaches the
            card's sides — an overflow container clips at its PADDING box, and
            a narrower one would have cut the bleed off.

            thin-scroll + stable-gutter, the pair every in-card scroller in the
            app already wears (ConversationPanel, the shell's main pane). The
            first replaces the browser's own bar — a 9px track with the rail
            carved out of it by a transparent border, so there is no line down
            the card's edge — and the second reserves that track up front, so
            the list does not jump sideways the moment it grows past the fold.
            Both are gated to sm+ in globals.css, which is also where this card
            stops being a fixed-height box. */}
        <div className="thin-scroll stable-gutter -mx-4 min-h-0 flex-1 overflow-y-auto px-4 sm:-mx-5 sm:px-5">
          {children}
        </div>
        {footer}
      </div>
    </main>
  );
}
