"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { ActionTip } from "./InfoTip";
import { useConfirm } from "./ConfirmDialog";
import { LANGUAGES, type TranslationKey } from "@/lib/i18n";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  currencySymbol,
  moneyInputValue,
  parseMoney,
} from "@/lib/money";
import { Card } from "./Card";
import { BusinessHoursCard } from "./RemindersView";
import { useHeaderSearch } from "@/lib/HeaderSearch";
import { Sheet } from "./Sheet";
import { Toggle } from "./Toggle";
import { ROW_GRID, RowLabel } from "./RowLabel";
import { InlineEditValue, OptionsEditor } from "./RecordField";
import { keyFromLabel, normaliseKey } from "../../convex/lib/keys";
import { slugifyInboundAddress } from "../../convex/lib/inboundAddress";

// Business: how this business is SHAPED. Its identity, who works here, what it
// sells, and what a customer record holds. Settings next door is the other
// half, the connections and the sending rules.
//
// Named Business, not "Workspace setup", because that is what every product a
// salon owner has already used calls it: Fresha, Booksy, Square and Treatwell
// all say Business. Nobody thinks of their salon as a workspace. (This file
// replaces WorkspaceSetupView.tsx.)
//
// It is also the surface that makes ONE deployment fit a salon, a dentist and
// a garage: services and contact fields are org data, so the vertical's own
// vocabulary (plate number, last cleaning, insurance) never needs a schema
// change or a second deployment.
// Details, services and contact fields are all "set the salon up once" —
// splitting them across three tabs turns setup into a scavenger hunt, and each
// card already carries its own heading, so one scroll reads fine. They share
// the first chip.
//
// The other two earn their own because neither is setup. People is what you
// come back to when somebody is hired or leaves. Activity is what you open
// when something looks wrong and you need to know who did it — a question, not
// a configuration, and burying it under a setup scroll would mean nobody ever
// finds it at the moment they need it.
// One chip, one job. They used to be three, with the first holding identity,
// the service catalogue and the contact fields — three things an owner opens
// on completely different schedules, stacked into one scroll, which is how
// Services ended up below the fold on the screen it is most edited from.

// Which card each row lives on. Business is ONE page now: General, Hours and
// Team stacked, no chip strip. The strip went away because it had shrunk to
// three entries whose contents all answer "what is this business", and because
// hours and capacity are two halves of one calculation (getAvailableSlots
// reads the business hours AND orgCapacity, the count of active staff) that a
// chip boundary kept apart.
//
// Services and contact fields left for their own sidebar destination the same
// day: a price list is a body of content you maintain, not a setting, and the
// voice agent and booking page both read it at call time.
//
// The old objection to stacking these (recorded twice: General carried nine
// rows across three unrelated jobs, so an open/close grid appended to it landed
// under the fold) is answered rather than ignored. General shed Timezone to
// Hours, and the header search now SCROLLS to a card instead of switching
// sections, so "where do I change opening times" is one query rather than a
// scroll hunt.
//
// Hand-maintained, same as Account's: the rows live in card bodies with no
// runtime register to enumerate, so add a line when you add a row. Forgetting
// costs one unfindable name. Never index a key that is not in i18n.ts.
const SEARCH_INDEX: { card: BusinessCard; key: TranslationKey }[] = [
  { card: "general", key: "settings.general" },
  { card: "general", key: "settings.businessName" },
  { card: "general", key: "settings.revenueEnabled" },
  { card: "general", key: "settings.formEnabled" },
  { card: "general", key: "settings.formEmbed" },
  { card: "general", key: "settings.inboundAddress" },
  { card: "general", key: "settings.emailFrom" },
  { card: "general", key: "settings.language" },
  { card: "general", key: "settings.publicPhone" },
  { card: "booking", key: "settings.bookingPage" },
  { card: "booking", key: "settings.bookingMode" },
  { card: "general", key: "settings.currency" },
  { card: "hours", key: "settings.hours" },
  { card: "hours", key: "settings.timezone" },
  { card: "hours", key: "settings.businessHours" },
  { card: "team", key: "staff.title" },
  { card: "team", key: "roster.bookable" },
];

type BusinessCard = "general" | "booking" | "hours" | "team";

const CARD_LABEL: Record<BusinessCard, TranslationKey> = {
  general: "settings.general",
  booking: "settings.bookingPage",
  hours: "settings.hours",
  team: "staff.title",
};


// Thin wrapper owning the mutation, so the shared card stays a dumb form.
function HoursCard({
  isOwner,
  org,
}: {
  isOwner: boolean;
  org: Parameters<typeof BusinessHoursCard>[0]["org"];
}) {
  const update = useMutation(api.orgs.update);
  return (
    <BusinessHoursCard isOwner={isOwner} org={org} update={(args) => void update(args)} />
  );
}

export function BusinessView() {
  const { t } = useLanguage();
  // Claims the header's box, same component and same corner as Customers and
  // Inbox. The shell owns the input; a view only says what it should say.
  const search = useHeaderSearch(t("common.search"));
  const cardRefs = useRef<Record<BusinessCard, HTMLDivElement | null>>({
    general: null,
    booking: null,
    hours: null,
    team: null,
  });
  // Held in state and consumed by an effect rather than scrolled on the click.
  // Clearing the query remounts the cards, so at click time every ref is null,
  // and one requestAnimationFrame does not cover React's re-render plus the ref
  // callbacks. Same mechanism AccountView uses, and the same reason.
  const [pendingScroll, setPendingScroll] = useState<BusinessCard | null>(null);
  useEffect(() => {
    if (!pendingScroll) return;
    // No behavior: "smooth". It silently does nothing on this shell's `main`,
    // measured, so asking for it costs the scroll it was meant to prettify.
    cardRefs.current[pendingScroll]?.scrollIntoView({ block: "start" });
    setPendingScroll(null);
  }, [pendingScroll]);

  // The Calendar's "Edit hours" button still deep-links here with
  // ?section=hours. There are no sections left to switch to, so the param now
  // means "scroll to that card" — the destination it always meant, expressed
  // against a page instead of a chip strip. Read once on mount.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("section");
    if (wanted === "hours" || wanted === "team" || wanted === "general") {
      setPendingScroll(wanted);
    }
  }, []);

  const hits = search.active
    ? SEARCH_INDEX.filter((entry) => search.matches(t(entry.key)))
    : [];

  const settings = useQuery(api.orgs.current, {});
  if (!settings) return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  // The backend enforces this too (requireOwner); the fieldsets are honest UI.
  const isOwner = settings.me.role !== "staff";

  // Searching replaces the page body with a list of places to go, and picking
  // one clears the query, because the search is done the moment it has taken
  // you somewhere. It scrolls rather than switches now that this is one page.
  if (search.active) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 page-stack">
        {hits.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("table.noMatches")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            {hits.map((entry, i) => (
              <button
                key={`${entry.card}:${entry.key}`}
                type="button"
                onClick={() => {
                  search.setQuery("");
                  setPendingScroll(entry.card);
                }}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--muted-bg)] ${
                  i > 0 ? "border-t border-[var(--border)]" : ""
                }`}
              >
                <span className="text-sm">{t(entry.key)}</span>
                <span className="shrink-0 text-xs text-[var(--muted)]">
                  {t(CARD_LABEL[entry.card])}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 page-stack">
      {!isOwner && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-xs text-[var(--muted)]">
          {t("settings.ownerOnly")}
        </p>
      )}
      <div ref={(node) => void (cardRefs.current.general = node)}>
        <DetailsCard isOwner={isOwner} />
      </div>
      {/* Beside the request form conceptually — both are public doors into the
          business — and above Hours, which is what a booking page reads. */}
      <div ref={(node) => void (cardRefs.current.booking = node)}>
        <BookingCard isOwner={isOwner} />
      </div>
      {/* Hours and Team are adjacent because they are the two inputs to one
          calculation: getAvailableSlots reads the business hours AND
          orgCapacity, the count of active staff. A chip boundary between them
          meant changing capacity took you off the screen showing when you are
          open. */}
      <div ref={(node) => void (cardRefs.current.hours = node)}>
        <HoursCard isOwner={isOwner} org={settings.org} />
      </div>
      <div ref={(node) => void (cardRefs.current.team = node)}>
        <PeopleCard isOwner={isOwner} />
      </div>
    </div>
  );
}

// Rows use the shared ROW_GRID from RowLabel, the same string SettingsView and
// AccountView import: the three surfaces must line up when you flip between
// them, which they stop doing the moment the string exists in three places.

// The paste-into-your-website snippet. Self-contained on purpose: no hosted
// script to keep alive, nothing to version, and nothing that breaks a salon's
// homepage the day we redeploy. The listener matches the iframe by its own
// contentWindow rather than by URL, so a page carrying two of these sizes each
// one correctly.
function EmbedSnippet({ src }: { src: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  // The snippet is never shown. A salon owner does not read HTML, and a box
  // of angle brackets in their settings is something to be afraid of breaking
  // rather than something to use. Self-contained on purpose: no hosted script
  // to keep alive, and
  // the listener matches the iframe by its own contentWindow, so a page
  // carrying two of these sizes each one correctly.
  const snippet = [
    `<iframe src="${src}" style="width:100%;border:0" height="620" title="Resepta"></iframe>`,
    `<script>addEventListener("message",function(e){if(!e.data||e.data.type!=="randevu:height")return;document.querySelectorAll("iframe").forEach(function(f){if(f.contentWindow===e.source)f.style.height=e.data.height+"px"})})</script>`,
  ].join("\n");
  return (
    <span className="flex items-center">
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(snippet);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }}
        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--muted-bg)]"
      >
        {copied ? t("common.copied") : t("settings.formEmbedCopy")}
      </button>
    </span>
  );
}

// Name, language, sender address. This used to be Settings' first
// chip, which put the business's own identity behind a page about
// connections. It is not a connection, so it leads here instead.
// The agents' lines as chips, plus a box for a number we do not host. Lifted
// verbatim out of Reminders' old MessageVariablesCard: the behaviour was
// right, only its address was wrong.
function PublicPhoneField({
  phone,
  voiceNumbers,
  onSave,
}: {
  phone: string;
  voiceNumbers: { number: string; agentName?: string | null }[];
  onSave: (next: string) => void;
}) {
  const { t } = useLanguage();
  const isAgentNumber = voiceNumbers.some((line) => line.number === phone);
  return (
    <div className="space-y-1.5">
      {voiceNumbers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {voiceNumbers.map((line) => {
            const active = phone === line.number;
            return (
              <button
                key={line.number}
                type="button"
                onClick={() => onSave(active ? "" : line.number)}
                className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                  active
                    ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {line.number}
                <span className="ml-1 opacity-70">
                  · {line.agentName ?? t("settings.voiceAgentNumber")}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <input
        // Keyed so picking a chip refreshes the uncontrolled input.
        key={phone}
        defaultValue={isAgentNumber ? "" : phone}
        placeholder={isAgentNumber ? t("settings.publicPhoneCustom") : "+90…"}
        onBlur={(e) => {
          const next = e.target.value.trim();
          // An empty custom field while a chip is picked is not a clear — the
          // chip is the value; clearing means unpicking the chip.
          if (!next && isAgentNumber) return;
          onSave(next);
        }}
      />
    </div>
  );
}

// Online booking, as its own card rather than a row inside "Message
// variables". It is a CHANNEL — a public page customers land on — which is
// what every appointment product treats it as, and it belongs beside the
// request form for the same reason.
//
// ── ONE CHOICE, NOT A TOGGLE PLUS AN OVERRIDE ──────────────────────────────
//
// The old shape put the switch and a free-text URL side by side as equals, so
// the box read as an override of the page you had just switched on, and there
// was no way to tell which one a message would actually use. It is one
// question with two answers now: our page, or a link of your own. The URL box
// exists only under the second, and [booking_link] resolves to whichever is
// selected — which is the whole point of the field and was previously
// something you had to infer.
function BookingCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const update = useMutation(api.orgs.update);
  const enableBooking = useMutation(api.booking.enable);
  const [copied, setCopied] = useState(false);
  if (!settings) return null;
  const { bookingUrl, bookingEnabled, publicSlug } = settings.org;
  const nativeBookingUrl =
    publicSlug && typeof window !== "undefined"
      ? `${window.location.origin}/book/${publicSlug}`
      : null;
  const usingOwnLink = !bookingEnabled && !!bookingUrl;
  // "Off" is a real third state and has to stay reachable: a salon that takes
  // no online bookings at all should not be forced to host a page or paste a
  // link, and [booking_link] then resolves to nothing, cleanly.
  const mode: "off" | "native" | "own" = bookingEnabled
    ? "native"
    : usingOwnLink
      ? "own"
      : "off";

  const choose = (next: "off" | "native" | "own") =>
    void (async () => {
      if (next === "native") {
        const slug = await enableBooking({ enabled: true });
        if (slug) {
          await update({ bookingUrl: `${window.location.origin}/book/${slug}` });
        }
        return;
      }
      // Leaving our page behind clears the link only if the link WAS ours: a
      // URL the salon pasted is not ours to delete.
      if (bookingEnabled) {
        await enableBooking({ enabled: false });
        if (nativeBookingUrl && bookingUrl === nativeBookingUrl) {
          await update({ bookingUrl: "" });
        }
      }
      if (next === "off" && !bookingEnabled) await update({ bookingUrl: "" });
    })();

  return (
    <Card
      title={t("settings.bookingPage")}
      tip={t("settings.bookingPageHint")}
      disabled={!isOwner}
    >
      <div className={ROW_GRID}>
        <RowLabel label={t("settings.bookingMode")} />
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["native", t("settings.bookingModeNative")],
                ["own", t("settings.bookingModeOwn")],
                ["off", t("settings.bookingModeOff")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={mode === key}
                onClick={() => choose(key)}
                className={`rounded-full px-2.5 py-1 text-sm transition-colors ${
                  mode === key
                    ? "bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
                    : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Ours: the link is derived, so it is shown as a fact to copy
              rather than a box to edit. Editing it was never meaningful — the
              page lives at that address whatever the field says. */}
          {mode === "native" && nativeBookingUrl && (
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={nativeBookingUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
              >
                {nativeBookingUrl}
              </a>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(nativeBookingUrl).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  });
                }}
                className="rounded-md px-1.5 py-0.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              >
                {copied ? t("common.copied") : t("common.copy")}
              </button>
            </div>
          )}

          {mode === "own" && (
            <input
              key={bookingUrl ?? ""}
              defaultValue={bookingUrl ?? ""}
              placeholder="https://…"
              onBlur={(e) => void update({ bookingUrl: e.target.value.trim() })}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

function DetailsCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const update = useMutation(api.orgs.update);
  const enableForm = useMutation(api.forms.enable);
  const voiceNumbers = useQuery(api.orgs.voiceNumbers, {}) ?? [];
  // Read at render rather than baked in: the same deployment serves localhost
  // and the real domain, and a hardcoded host would hand the salon a link that
  // works for nobody but whoever built it.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  // The incoming address is the one field here a server can REFUSE — it is a
  // routing key, so another org may already answer to it. Without this the
  // rejection landed in an unhandled promise: nothing on screen, the typed
  // text still sitting in the box, and the salon believing they own an
  // address that was never saved. Services and Fields below already work this
  // way; General did not.
  const [addressError, setAddressError] = useState<string | null>(null);
  // Bumped on a refusal to remount the input, so it snaps back to the value
  // that is actually stored instead of showing the rejected one.
  const [addressTick, setAddressTick] = useState(0);

  return (
    <Card title={t("settings.general")} disabled={!isOwner}>
      {settings === undefined ? (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      ) : (
        <div className={ROW_GRID}>
          <RowLabel label={t("settings.businessName")} />
          <input
            defaultValue={settings.org.name}
            onBlur={(e) => void update({ name: e.target.value })}
          />
          {/* The number customers are told to ring, beside the business name
              because that is what it is: a fact about the business, not a
              setting for one feature. It spent its first life in a card called
              "Message variables" over in Reminders, which is where a salon
              owner would never look for their own phone number — and which
              named an implementation detail (the [phone] token) rather than
              the thing itself. The token still reads this value; it just is
              not what the field is FOR.

              The agents' own lines are offered first and cost one tap: a
              number an agent answers around the clock is the one worth
              printing in an automated message. SINGLE number by design — one
              clear call to action, not a switchboard. */}
          <RowLabel
            label={t("settings.publicPhone")}
            hint={t("settings.publicPhoneHint")}
          />
          <PublicPhoneField
            phone={settings.org.publicPhone ?? ""}
            voiceNumbers={voiceNumbers}
            onSave={(next) => void update({ publicPhone: next })}
          />
          {/* Timezone moved to Hours (2026-08-12). It is the clock the open and
              close times are read in, so it belongs on that screen; here it was
              a lone qualifier for a setting one chip away. */}
          {/* The address customers write TO. One verified domain serves every
              business; this left-hand part is what routes an incoming email to
              THIS org, so it has to be unique and the save rejects a clash. */}
          {/* Off by default: an org that never fills in prices would get a nav
              item leading to three zeroes, which reads as broken not unused. */}
          <RowLabel label={t("settings.revenueEnabled")} hint={t("settings.revenueEnabledHint")} />
          <span className="flex items-center">
            <Toggle
              checked={settings.org.revenueEnabled ?? false}
              onChange={(next) => void update({ revenueEnabled: next })}
            />
          </span>
          {/* The public request form. Off by default: a live URL that answers
              before anyone has looked at what it asks is worse than a 404. */}
          <RowLabel label={t("settings.formEnabled")} hint={t("settings.formEnabledHint")} />
          <span className="flex flex-wrap items-center gap-2">
            <Toggle
              checked={settings.org.formEnabled ?? false}
              onChange={(next) => void enableForm({ enabled: next })}
            />
            {settings.org.formEnabled && settings.org.publicSlug && (
              // Shown as the whole URL, not a slug: what the salon needs is
              // something to paste into an Instagram bio, and a fragment they
              // have to assemble themselves is a step where people give up.
              <a
                href={`/r/${settings.org.publicSlug}`}
                target="_blank"
                rel="noreferrer"
                className="truncate text-sm text-[var(--accent)] hover:underline"
              >
                {`${origin}/r/${settings.org.publicSlug}`}
              </a>
            )}
          </span>
          {settings.org.formEnabled && settings.org.publicSlug && (
            <>
              {/* The link is for a bio; this is for a website. Two different
                  jobs, so both are offered rather than making the salon work
                  out that one can be turned into the other. */}
              <RowLabel label={t("settings.formEmbed")} hint={t("settings.formEmbedHint")} />
              <EmbedSnippet
                src={`${origin}/r/${settings.org.publicSlug}?embed=1`}
              />
            </>
          )}
          <RowLabel label={t("settings.inboundAddress")} hint={t("settings.inboundAddressHint")} />
          <span className="flex items-center gap-1">
            {/* The salon's OWN name, slugged the way the server will slug it
                (lib/inboundAddress) — so the placeholder is both an example
                and a preview of what typing their name would give them. A
                fixed "guzellik" was one specific salon's name shown to every
                other salon, which reads as someone else's data. */}
            <input
              key={`inbound-${addressTick}`}
              defaultValue={settings.org.inboundAddress ?? ""}
              placeholder={slugifyInboundAddress(settings.org.name) || "randevu"}
              onBlur={(e) => {
                const next = e.target.value;
                if (next === (settings.org.inboundAddress ?? "")) return;
                setAddressError(null);
                void update({ inboundAddress: next }).catch((err) => {
                  setAddressError(
                    String(err).includes("address-taken")
                      ? t("settings.inboundAddressTaken")
                      : t("settings.inboundAddressRejected"),
                  );
                  setAddressTick((tick) => tick + 1);
                });
              }}
            />
            <span className="shrink-0 text-sm text-[var(--muted)]">
              {settings.org.inboundDomain
                ? `@${settings.org.inboundDomain}`
                : t("settings.inboundNoDomain")}
            </span>
          </span>
          {addressError && (
            <>
              <span />
              <p className="text-sm text-red-600 dark:text-red-400">{addressError}</p>
            </>
          )}
          {/* Operator plumbing, same call as the WhatsApp credentials: sending
              from your own domain means verifying it with the mail provider,
              which the salon cannot do from in here. So the row is absent
              until an operator has set one, and read-only once they have —
              a salon typing an unverified domain in would get every send
              refused with a 403 and no way to see why. Everyone else sends
              from the incoming address above, which needs no setup at all. */}
          {settings.org.emailFrom && (
            <>
              <RowLabel
                label={t("settings.emailFrom")}
                hint={t("settings.emailFromHint")}
              />
              <span className="text-sm text-[var(--muted)]">
                {settings.org.emailFrom}
              </span>
            </>
          )}
          <RowLabel
            label={t("settings.language")}
            hint={t("settings.languageHint")}
          />
          <select
            defaultValue={settings.org.language}
            onChange={(e) => void update({ language: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          {/* Sits under language because the two answer together: language
              picks the separators and digit grouping, currency picks the
              symbol. Changing this does NOT convert anything — a price stored
              as 40000 is ₺400,00 today and €400.00 tomorrow. That is the
              honest behaviour: we don't know an exchange rate and inventing
              one would silently rewrite what customers were charged. */}
          <RowLabel label={t("settings.currency")} hint={t("settings.currencyHint")} />
          <select
            defaultValue={settings.org.currency}
            onChange={(e) => void update({ currency: e.target.value })}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {`${code} · ${currencySymbol(code, settings.org.language)}`}
              </option>
            ))}
          </select>
        </div>
      )}
    </Card>
  );
}

// Header and rows share one template. Five columns at sm; on a phone the same
// cells fold to two lines — name across the top, then duration / price /
// switch — because the fixed sm columns add up to more than a 390px phone can
// give them next to a name.
//
// NO KEY COLUMN. The list's reader is a salon owner deciding what they sell
// and for how much; the key is the agent's address for a service, and it now
// lives with the rest of the agent's vocabulary on the Contact fields tab
// (ServiceKeysCard). It spent a while here as a monospace chip and read as
// exactly what it was: a developer's column in an owner's price list.
//
// The phone line is a GRID with fixed tracks, not a wrapping flex line. Each
// row is its own grid container, so nothing lines up across rows by agreement
// — only by both rows asking for the same widths. Intrinsic sizing gave every
// row its own idea of where the duration started.
//
// Each track holds a number AND its unit — "90" plus "min", "5600.00" plus the
// currency symbol — because the unit sits inside the cell rather than in a
// column of its own. The cells carry whitespace-nowrap: a track that is ever
// too narrow should overflow where you can see it, not quietly stack.
//
// The price track is the wide one because it is sized for EDITING, not for
// reading: below sm a focused field renders at 16px (globals.css, the iOS
// zoom rule), so a five-figure price needs ~6.5rem where the resting text
// needs 4. The third track is the phone line's spacer — it takes whatever the
// fixed tracks leave, so the switch keeps to the right edge.
// At sm the duration and price tracks are 8/9rem, not the 7 they inherited
// from the six-column days: the key column's departure handed its 8rem to the
// name, which was already the widest thing on the line, while a five-figure
// price still edited inside a clipped box. The extra rem each is spent where
// the numbers actually live.
const SERVICE_ROW_GRID =
  "grid grid-cols-[5rem_6.5rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[1fr_8rem_9rem_4rem_4rem] sm:gap-2";

function serviceErrorText(err: unknown, t: (key: TranslationKey) => string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("key-exists")) return t("services.keyExists");
  return message;
}

// Click-to-edit, the same shape the fields table uses for its key. Its own
// component because the services list is a map() and this needs a piece of
// state per row.
function ServiceKeyCell({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (key: string) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  return (
    <span className={`flex min-w-0 items-center ${className ?? ""}`}>
      {editing ? (
        <input
          autoFocus
          defaultValue={value}
          onBlur={(e) => {
            const next = e.target.value.trim();
            setEditing(false);
            if (next && next !== value) onSave(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-full min-w-0 rounded border border-[var(--border)] bg-[var(--card)] px-1.5 py-0.5 font-mono text-xs"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={t("services.keyEditHint")}
          className="min-w-0 truncate rounded bg-[var(--muted-bg)] px-1.5 py-0.5 text-left font-mono text-xs text-[var(--muted)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
        >
          {value}
        </button>
      )}
    </span>
  );
}

// Adding a service, as a sheet. It used to be an inline row that unfolded at
// the foot of the list — fine when the card was the only thing on a settings
// page, wrong now that Services is its own tab whose primary action should sit
// where every other tab's does. The stacked layout also gives the price its
// currency and the duration its unit room to be labelled properly, which the
// three-inputs-on-one-line version could not afford.
function NewServiceSheet({ onClose }: { onClose: () => void }) {
  const { t, language } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const currency = settings?.org.currency ?? DEFAULT_CURRENCY;
  const create = useMutation(api.services.create);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Controlled, because emptying it changes what the form IS: no duration
  // means a good (a cake, a delivery), and a good gets a lead-time field
  // where a service gets none.
  const [duration, setDuration] = useState("30");
  const isGood = duration.trim() === "";

  return (
    <Sheet title={t("services.add")} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const name = String(form.get("name") ?? "").trim();
          if (!name) return;
          const price = parseMoney(String(form.get("price") ?? ""), currency, language);
          const leadDays = Number(form.get("leadDays"));
          setPending(true);
          setError(null);
          try {
            await create({
              name,
              // Empty means a good, and the absence IS the fact — the server
              // stores no duration rather than a placeholder.
              ...(isGood ? {} : { durationMinutes: Number(duration) || 30 }),
              ...(isGood && leadDays > 0
                ? { leadMinutes: Math.round(leadDays * 1440) }
                : {}),
              ...(price !== undefined ? { price } : {}),
            });
            onClose();
          } catch (err) {
            // The inline form swallowed this: a duplicate key rejected the
            // mutation and the row just sat there having apparently done
            // nothing.
            setError(serviceErrorText(err, t));
            setPending(false);
          }
        }}
      >
        <label className="block text-sm">
          {t("services.name")}
          <input name="name" required data-sheet-autofocus className="mt-1 block w-full" />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="block text-sm">
            {t("services.duration")}
            <span className="mt-1 flex items-center gap-2">
              <input
                name="durationMinutes"
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder={t("common.optional")}
                className="w-24"
              />
              <span className="text-xs text-[var(--muted)]">{t("services.minutes")}</span>
            </span>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              {t("services.durationGoodHint")}
            </span>
          </label>
          {/* Only a good needs warning time — a haircut's notice is the slot
              itself. Appears when the duration is emptied, beside the fact it
              belongs to. */}
          {isGood && (
            <label className="block text-sm">
              {t("services.leadTime")}
              <span className="mt-1 flex items-center gap-2">
                <input
                  name="leadDays"
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder={t("common.optional")}
                  className="w-24"
                />
                <span className="text-xs text-[var(--muted)]">{t("services.leadDays")}</span>
              </span>
            </label>
          )}
          <label className="block text-sm">
            {t("services.price")}
            <span className="mt-1 flex items-center gap-2">
              <input
                name="price"
                type="number"
                min={0}
                step="0.01"
                placeholder={t("common.optional")}
                className="w-28"
              />
              <span className="text-xs text-[var(--muted)]">
                {currencySymbol(currency, language)}
              </span>
            </span>
          </label>
        </div>

        {/* Reserved whether or not it holds anything, so a rejected save does
            not shove the buttons out from under the pointer. */}
        <p className="min-h-[1.25rem] text-sm text-red-600 dark:text-red-400">{error}</p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-60"
          >
            {t("common.add")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

// Services are what the salon sells, and the duration is what sizes the block
// on the calendar, so an empty list is not a cosmetic gap: bookings have
// nothing to pick and every appointment falls back to 30 minutes.
export function ServicesCard({ isOwner }: { isOwner: boolean }) {
  const { t, language } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const currency = settings?.org.currency ?? DEFAULT_CURRENCY;
  const services = useQuery(api.services.list, {});
  const update = useMutation(api.services.update);
  const remove = useMutation(api.services.remove);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const rows = [...(services ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  // Staff cannot add a service, so an empty list for them is a heading, an (i)
  // and an empty fieldset. Nothing to read and nothing to do: render nothing.
  if (!isOwner && services !== undefined && rows.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Above the card and hard right, the same solid button Customers and
          Reminders use. It was a quiet "+ Add service" at the foot of the
          list, which put the page's primary action below however many rows
          the salon happens to sell. */}
      {isOwner && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="h-9 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-[var(--accent-fg)]"
          >
            {t("services.add")}
          </button>
        </div>
      )}
      <Card title={t("services.title")} tip={t("services.hint")} disabled={!isOwner}>
        {services === undefined ? (
          <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
        ) : (
          <div className="space-y-2">
            {rows.length > 0 && (
              // Column headers label their columns. They only exist at sm,
              // where the six columns sit in one line and a header can sit over
              // each; the phone layout is two lines of four and its values
              // speak for themselves.
              //
              // max-sm:hidden, not hidden: SERVICE_ROW_GRID sets `grid` at every
              // width now, and two unprefixed display utilities on one element
              // are decided by Tailwind's own order rather than by this file.
              // Scoping the hide to the phone leaves nothing to arbitrate.
              <div className={`px-1 text-xs text-[var(--muted)] max-sm:hidden ${SERVICE_ROW_GRID}`}>
                <span>{t("services.name")}</span>
                <span>{t("services.duration")}</span>
                <span>{t("services.price")}</span>
                <span>{t("services.active")}</span>
                <span />
              </div>
            )}
            <ul className="divide-y divide-[var(--border)]">
              {rows.map((service) => (
                <li
                  key={service._id}
                  className={`group relative py-1.5 text-sm ${SERVICE_ROW_GRID}`}
                >
                  {/* The whole top line on a phone, so the name is not fighting
                      264px of fixed columns for the 60px that is left. Reserves
                      the right end for the delete ×, parked there below sm —
                      pr-8 clears its w-7, where the old "Delete" word needed
                      twice that. */}
                  <span className="min-w-0 max-sm:col-span-4 max-sm:row-start-1 max-sm:pr-8">
                    <InlineEditValue
                      value={service.name}
                      onSave={(next) =>
                        next && update({ serviceId: service._id, name: next })
                      }
                    />
                  </span>
                  {/* For a GOOD (no duration) this track holds the lead time
                      instead, in days: the column's question is "what does
                      time mean for this row", and for a cake the answer is
                      how much warning the baker needs, not minutes in a
                      chair. Clearing a duration turns the row into a good;
                      there is deliberately no inline way back, because a
                      good's row no longer edits minutes — recreate it. */}
                  <span className="flex items-center gap-0.5 whitespace-nowrap max-sm:col-start-1 max-sm:row-start-2">
                    {service.durationMinutes !== undefined ? (
                      <>
                        <InlineEditValue
                          value={String(service.durationMinutes)}
                          type="number"
                          compact
                          onSave={(next) => {
                            if (next.trim() === "") {
                              return update({ serviceId: service._id, durationMinutes: null });
                            }
                            if (Number(next) > 0) {
                              return update({
                                serviceId: service._id,
                                durationMinutes: Number(next),
                              });
                            }
                          }}
                        />
                        <span className="shrink-0 text-xs text-[var(--muted)]">
                          {t("services.minutes")}
                        </span>
                      </>
                    ) : (
                      <>
                        <InlineEditValue
                          value={
                            service.leadMinutes !== undefined
                              ? String(service.leadMinutes / 1440)
                              : ""
                          }
                          type="number"
                          compact
                          placeholder="—"
                          onSave={(next) => {
                            const days = Number(next);
                            return update({
                              serviceId: service._id,
                              leadMinutes:
                                next.trim() === "" || !(days > 0)
                                  ? null
                                  : Math.round(days * 1440),
                            });
                          }}
                        />
                        <span className="shrink-0 text-xs text-[var(--muted)]">
                          {t("services.leadDays")}
                        </span>
                      </>
                    )}
                  </span>
                  {/* Same shape as duration — a number with its unit trailing.
                      Blank means unpriced, and clearing the box says so rather
                      than writing a zero, because zero is a real price a salon
                      might charge and "I haven't decided" is not it. */}
                  <span className="flex items-center gap-0.5 whitespace-nowrap max-sm:col-start-2 max-sm:row-start-2">
                    <InlineEditValue
                      value={moneyInputValue(service.price, currency, language)}
                      type="number"
                      compact
                      onSave={(next) =>
                        update({
                          serviceId: service._id,
                          price: parseMoney(next, currency, language) ?? null,
                        })
                      }
                    />
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {currencySymbol(currency, language)}
                    </span>
                  </span>
                  {/* Last track of the phone line, pinned to its right edge.
                      This used to be an auto margin fighting the flex line for
                      the same result; a named grid column just says it. */}
                  <span className="flex items-center gap-1.5 max-sm:col-start-4 max-sm:row-start-2 max-sm:justify-self-end">
                    {/* No visible "Active" beside it. The phone row used to
                        repeat each column's header as a word, which is right
                        for a value that cannot speak for itself — a bare "60"
                        needs "min" — and wrong for a switch, which is the one
                        control whose whole job is showing its own state. The
                        Toggle carries the word as aria-label, so the name is
                        still there for anyone not reading the colour. */}
                    <Toggle
                      checked={service.active}
                      label={t("services.active")}
                      onChange={(next) =>
                        void update({ serviceId: service._id, active: next })
                      }
                    />
                  </span>
                  {/* Hover reveal is a desktop idea. A phone has no hover, so the
                      button stays visible there rather than being unreachable.

                      Out of flow below sm, up on the name's line. In flow it was
                      the reason the toggles still did not line up: on a row with
                      a long key or a four-figure price it wrapped to a third
                      line and the toggle took the right edge, on a short row it
                      fitted and pushed the toggle ~68px in. Whether a row's
                      switch aligns is not allowed to depend on how much that
                      service costs. */}
                  <button
                    onClick={() => {
                      void (async () => {
                        const ok = await confirm({
                          title: t("services.deleteConfirm").replace("{name}", service.name),
                        });
                        if (!ok) return;
                        setError(null);
                        await remove({ serviceId: service._id }).catch((err) =>
                          setError(serviceErrorText(err, t)),
                        );
                      })();
                    }}
                    aria-label={`${service.name} — ${t("common.delete")}`}
                    title={t("common.delete")}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-[var(--muted)] opacity-0 transition-colors transition-opacity hover:bg-[var(--muted-bg)] hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:text-red-400 max-sm:absolute max-sm:right-0 max-sm:top-0.5 sm:justify-self-end [@media(hover:none)]:opacity-100"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            {confirmDialog}
          </div>
        )}
      </Card>
      {adding && <NewServiceSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

// The agent's addresses for what the business sells, shown beside the contact
// fields because that page is already the agent's vocabulary — the things it
// knows BY KEY. The Services list dropped its key column (see
// SERVICE_ROW_GRID): its reader is an owner deciding what they sell and for
// how much, and a monospace chip in that list was a developer's column in an
// owner's price list. The key still has to live somewhere, because renaming a
// service must not move the address automations point at — and the reader who
// cares about that is on this tab already.
//
// Names are read-only here on purpose. The price list is where a service is
// edited; this card answers one question — "what does the agent call it" —
// and a second editing surface for the name would just be drift waiting.
export function ServiceKeysCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const services = useQuery(api.services.list, {});
  const update = useMutation(api.services.update);
  const [error, setError] = useState<string | null>(null);

  const rows = [...(services ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  // No services yet: nothing to address, so no card. The Services tab is
  // where the first one gets made.
  if (services !== undefined && rows.length === 0) return null;

  return (
    <Card
      title={t("fields.serviceKeys")}
      tip={t("fields.serviceKeysHint")}
      disabled={!isOwner}
    >
      {services === undefined ? (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      ) : (
        <div className="space-y-2">
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((service) => (
              <li
                key={service._id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate">{service.name}</span>
                <ServiceKeyCell
                  value={service.key}
                  onSave={(key) =>
                    void update({ serviceId: service._id, key }).catch((err) =>
                      setError(serviceErrorText(err, t)),
                    )
                  }
                />
              </li>
            ))}
          </ul>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
      )}
    </Card>
  );
}

type ContactField = FunctionReturnType<typeof api.contactFields.list>[number];
type FieldSource = "manual" | "voice";

// Two named states, so a segmented control rather than a toggle: "off" is not
// a way to say "voice agent".
const FIELD_SOURCES: { id: FieldSource; key: TranslationKey }[] = [
  { id: "manual", key: "fields.source.manual" },
  { id: "voice", key: "fields.source.voice" },
];

// The identity columns every customer has — real keys, shown for the same
// reason field keys are: they are the vocabulary agents and exports use.
//
// Name and email are voice-writable like any unlocked field; a receptionist
// who cannot correct a misspelt name is not much of a receptionist. Phone is
// the exception and the cell says why on hover: the caller is MATCHED by
// that number, and a call that could rewrite its own match key would detach
// the record from the line it arrived on.
const SYSTEM_FIELDS = [
  { labelKey: "customers.firstName", typeKey: "fields.type.text", key: "firstname" as const, voice: true },
  { labelKey: "customers.lastName", typeKey: "fields.type.text", key: "lastname" as const, voice: true },
  { labelKey: "customers.phone", typeKey: "fields.type.phone", key: "phone", voice: false },
  { labelKey: "customers.email", typeKey: "fields.type.email", key: "email" as const, voice: true },
] as const;

// Backend refusals said as sentences. Anything unmapped falls back to the
// raw code, which at least names the problem.
function fieldErrorText(err: unknown, t: (key: TranslationKey) => string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("field-exists")) return t("voiceVariables.fieldExists");
  if (message.includes("key-reserved")) return t("fields.keyReserved");
  if (message.includes("field-in-use")) return t("fields.keyInUse");
  return message;
}

// One org field as a table row, ported from Nudge's FieldRow (native mode).
// Label renames inline (label-only: the key is the identity, so the rename
// ripples everywhere without a republish). A select's type cell reads
// "Select (n)" and expands the options editor. Filled by toggles staff/voice;
// a field an agent references can be neither deleted nor handed back to
// staff, and the row says who uses it instead of offering the ✕.
function FieldTableRow({
  field,
  agents,
  expanded,
  dragging,
  onToggleExpand,
  onDragStart,
  onDragEnd,
  onDrop,
  onRename,
  onRenameKey,
  onToggleSource,
  onSetOptions,
  onRemove,
}: {
  field: ContactField;
  agents: string[];
  expanded: boolean;
  dragging: boolean;
  onToggleExpand: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onRename: (label: string) => void;
  onRenameKey: (key: string) => void;
  onToggleSource: () => void;
  onSetOptions: (options: string[]) => void;
  onRemove: () => void;
}) {
  const { t } = useLanguage();
  const [editingKey, setEditingKey] = useState(false);
  const inUse = agents.length > 0;
  const voice = field.source === "voice";
  const usedByText = t("fields.usedByAgents").replace("{agents}", agents.join(", "));
  return (
    <>
      <tr
        className={`group border-t border-[var(--border)] transition-colors hover:bg-[var(--muted-bg)] ${dragging ? "opacity-40" : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <td className="pl-0.5 text-[var(--muted-strong)]">
          <span
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            title={t("fields.reorder")}
            aria-label={t("fields.reorder")}
            className="inline-flex cursor-grab select-none active:cursor-grabbing hover:text-[var(--foreground)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="15" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" />
              <circle cx="15" cy="18" r="1.5" />
            </svg>
          </span>
        </td>
        <td className="py-1.5 pr-3">
          <InlineEditValue value={field.label} onSave={(next) => next && onRename(next)} />
        </td>
        <td className="py-1.5 pr-3">
          {/* The key moves only while nothing addresses it. In use, it is a
              fact; unused, it is a click-to-edit like the label (Nudge's
              variable-key pattern). */}
          {inUse ? (
            <code
              className="block truncate font-mono text-xs text-[var(--muted)]"
              title={`${field.key} · ${usedByText}`}
            >
              {field.key}
            </code>
          ) : editingKey ? (
            <input
              autoFocus
              defaultValue={field.key}
              onBlur={(e) => {
                const next = e.target.value.trim();
                setEditingKey(false);
                if (next && next !== field.key) onRenameKey(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditingKey(false);
              }}
              className="w-full rounded border border-[var(--border)] bg-[var(--card)] px-1.5 py-0.5 font-mono text-xs"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingKey(true)}
              title={t("fields.keyEditHint")}
              className="block max-w-full truncate text-left font-mono text-xs text-[var(--muted)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
            >
              {field.key}
            </button>
          )}
        </td>
        <td className="py-1.5 pr-3">
          {field.type === "select" ? (
            <button
              type="button"
              onClick={onToggleExpand}
              title={t("fields.showOptions")}
              className="text-xs text-[var(--muted)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
            >
              {t("fields.type.select")} ({field.options?.length ?? 0})
            </button>
          ) : (
            <span className="text-xs text-[var(--muted)]">
              {t(`fields.type.${field.type}` as "fields.type.text")}
            </span>
          )}
        </td>
        <td className="py-1.5 pr-3">
          {inUse ? (
            // Referenced by an agent: the state isn't a choice anymore, and
            // the chip says who holds it.
            <span
              title={usedByText}
              className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
            >
              {t("fields.source.voice")}
            </span>
          ) : (
            <button
              type="button"
              onClick={onToggleSource}
              title={t(voice ? "fields.unlockHint" : "fields.lockHint")}
              className={
                voice
                  ? "rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100"
                  : "rounded px-1.5 py-0.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              }
            >
              {t(voice ? "fields.source.voice" : "fields.source.manual")}
            </button>
          )}
        </td>
        <td className="py-1.5 text-right">
          {/* Always rendered, and revealed on hover in BOTH states. A control
              that vanishes when a field is in use reads as "this row cannot be
              deleted, and I will not tell you why" — it stays, greys, and the
              tooltip names the agent holding it. The reason belongs on the
              control the reader is pointing at, not in a message at the foot
              of the card where it is a paragraph away from the ✕ that caused
              it. Hover reveal is a desktop idea, so it stays visible where
              there is no hover. */}
          <ActionTip
            label={
              inUse
                ? t("fields.deleteInUse").replace("{agents}", agents.join(", "))
                : t("common.delete")
            }
            onClick={onRemove}
            disabled={inUse}
            multiline={inUse}
            className={`opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${
              inUse ? "" : "hover:text-red-600"
            }`}
          >
            ✕
          </ActionTip>
        </td>
      </tr>
      {expanded && field.type === "select" && (
        <tr className="bg-[var(--muted-bg)]">
          <td colSpan={6} className="px-3 py-3">
            <div className="space-y-2">
              <div className="text-xs text-[var(--muted)]">
                {t("fields.optionsFor").replace("{name}", field.label)}
              </div>
              <OptionsEditor options={field.options ?? []} onChange={onSetOptions} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function FieldsCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const fields = useQuery(api.contactFields.list, {});
  const identityLocks = useQuery(api.contactFields.identityLocks, {});
  const setIdentityLock = useMutation(api.contactFields.setIdentityLock);
  const usage = useQuery(api.retell.fieldUsage, {});
  const createField = useMutation(api.contactFields.create);
  const updateField = useMutation(api.contactFields.update);
  const removeField = useMutation(api.contactFields.remove);
  const [confirm, confirmDialog] = useConfirm();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<"text" | "select" | "number" | "date">("text");
  const [source, setSource] = useState<FieldSource>("manual");
  // The key is declared at creation: prefilled from the label as it is typed,
  // editable until the owner has touched it — after creation it only moves
  // through the unused-only path in the table.
  const [labelDraft, setLabelDraft] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceLabelId = useId();

  // Unset reads as "manual": fields defined before the voice agent existed are
  // staff-filled by definition.
  const rows = fields ?? [];

  // Drag-to-reorder across the org's own rows; system rows are pinned above.
  // Ported from Nudge's fields admin: persist the full order on drop.
  const reorderFields = useMutation(api.contactFields.reorder);
  const [dragId, setDragId] = useState<Id<"contactFields"> | null>(null);
  const [expandedId, setExpandedId] = useState<Id<"contactFields"> | null>(null);
  const moveField = (targetId: Id<"contactFields">) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const order = rows.map((field) => field._id);
    const from = order.indexOf(dragId);
    const to = order.indexOf(targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    order.splice(from, 1);
    order.splice(to, 0, dragId);
    void reorderFields({ orderedIds: order });
  };

  const agentsFor = (field: ContactField) => usage?.[String(field._id)] ?? [];

  // Staff cannot add a field, so an empty list for them is a heading, an (i)
  // and an empty fieldset. Don't render the frame.
  if (!isOwner && fields !== undefined && rows.length === 0) return null;

  return (
    // Titled again: it renders under the Voice agent's Fields chip, and the
    // strip names the SECTION while the card carries the (i) that explains what
    // a field is for. KnowledgeCard beside it works the same way.
    <Card title={t("fields.title")} tip={t("fields.hint")} disabled={!isOwner}>
      {/* One sortable table, ported from Nudge's fields admin: system rows
          are pinned and undeletable, org rows drag to reorder, a List type
          expands into its options editor, and Filled by is the column that
          replaced the old three-group split. */}
      {/* The min-width is what makes the overflow-x above it mean anything. The
          colgroup below spends 448px on five fixed columns and leaves the label
          the remainder; with w-full alone the table shrank to the container, so
          on a phone the remainder went NEGATIVE — the label column collapsed to
          nothing, its header printed on top of the key header, and values wrapped
          one character per line. Floor the table at the width its own columns
          ask for and the wrapper scrolls, which is what it was always for. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] table-fixed text-sm">
          <colgroup>
            <col className="w-6" />
            <col />
            <col className="w-40" />
            <col className="w-24" />
            <col className="w-32" />
            <col className="w-10" />
          </colgroup>
          <thead className="text-left text-xs">
            <tr>
              <th aria-label={t("fields.reorder")} />
              <th className="py-2 pr-3 font-medium">{t("fields.label")}</th>
              <th className="py-2 pr-3 font-medium">{t("fields.key")}</th>
              <th className="py-2 pr-3 font-medium">{t("fields.typeLabel")}</th>
              <th className="py-2 pr-3 font-medium">{t("fields.source")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {SYSTEM_FIELDS.map((field) => (
              <tr key={field.key} className="border-t border-[var(--border)] text-[var(--muted)]">
                <td />
                <td className="py-2 pr-3">{t(field.labelKey)}</td>
                <td className="py-2 pr-3">
                  <code className="block truncate font-mono text-xs">{field.key}</code>
                </td>
                <td className="py-2 pr-3 text-xs">{t(field.typeKey)}</td>
                <td className="py-2 pr-3 text-xs">
                  {field.voice ? (
                    <button
                      type="button"
                      onClick={() =>
                        void setIdentityLock({
                          key: field.key,
                          locked: !(identityLocks ?? []).includes(field.key),
                        })
                      }
                      title={t(
                        (identityLocks ?? []).includes(field.key)
                          ? "fields.unlockHint"
                          : "fields.lockHint",
                      )}
                      className={
                        (identityLocks ?? []).includes(field.key)
                          ? "rounded px-1.5 py-0.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                          : "rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100"
                      }
                    >
                      {t(
                        (identityLocks ?? []).includes(field.key)
                          ? "fields.source.manual"
                          : "fields.source.voice",
                      )}
                    </button>
                  ) : (
                    <span title={t("fields.phoneLockedHint")}>
                      {t("fields.source.manual")}
                    </span>
                  )}
                </td>
                <td />
              </tr>
            ))}
            {rows.map((field) => (
              <FieldTableRow
                key={field._id}
                field={field}
                agents={agentsFor(field)}
                expanded={expandedId === field._id}
                dragging={dragId === field._id}
                onToggleExpand={() =>
                  setExpandedId((current) => (current === field._id ? null : field._id))
                }
                onDragStart={() => setDragId(field._id)}
                onDragEnd={() => setDragId(null)}
                onDrop={() => moveField(field._id)}
                onRename={(label) => void updateField({ fieldId: field._id, label })}
                onRenameKey={(key) =>
                  void updateField({ fieldId: field._id, key }).catch((err) =>
                    setError(fieldErrorText(err, t)),
                  )
                }
                onToggleSource={() =>
                  void updateField({
                    fieldId: field._id,
                    source: (field.source ?? "manual") === "voice" ? "manual" : "voice",
                  })
                }
                onSetOptions={(options) => void updateField({ fieldId: field._id, options })}
                onRemove={() => {
                  // Only reached when the field is free — the row refuses an
                  // in-use one against the same usage list, and says why in
                  // its tooltip rather than routing it through here.
                  void (async () => {
                    const ok = await confirm({
                      title: t("fields.deleteConfirm").replace("{name}", field.label),
                    });
                    if (!ok) return;
                    setError(null);
                    await removeField({ fieldId: field._id }).catch((err) =>
                      setError(fieldErrorText(err, t)),
                    );
                  })();
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
      {error && !adding && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {confirmDialog}

      {/* Adding appears on demand, mirroring "+ Add service" above: a
          permanently open form charged this card a row of empty inputs on
          every visit for a task done a few times a year. */}
      {isOwner && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="rounded-md px-2 py-1 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
        >
          + {t("fields.add")}
        </button>
      )}
      {isOwner && adding && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const formEl = event.currentTarget;
            const form = new FormData(formEl);
            setError(null);
            try {
              await createField({
                label: labelDraft,
                key: keyDraft.trim() || undefined,
                type,
                source,
                options:
                  type === "select"
                    ? String(form.get("options") ?? "")
                        .split(",")
                        .map((o) => o.trim())
                        .filter(Boolean)
                    : undefined,
              });
              formEl.reset();
              setType("text");
              setSource("manual");
              setLabelDraft("");
              setKeyDraft("");
              setKeyTouched(false);
              setAdding(false);
            } catch (err) {
              setError(fieldErrorText(err, t));
            }
          }}
        >
          <label className="block text-sm">
            {t("fields.label")}
            <input
              required
              value={labelDraft}
              onChange={(e) => {
                setLabelDraft(e.target.value);
                if (!keyTouched) setKeyDraft(keyFromLabel(e.target.value));
              }}
              className="mt-1 block w-44"
            />
          </label>
          {/* The key, declared at creation: follows the label until touched,
              normalised on blur so what is shown is what will be stored. */}
          <label className="block text-sm">
            {t("fields.key")}
            <input
              value={keyDraft}
              onChange={(e) => {
                setKeyTouched(true);
                setKeyDraft(e.target.value);
              }}
              onBlur={() => setKeyDraft((current) => normaliseKey(current))}
              className="mt-1 block w-44 font-mono text-xs"
            />
          </label>
          <label className="block text-sm">
            {t("fields.typeLabel")}
            <select
              className="mt-1 block w-auto"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="text">{t("fields.type.text")}</option>
              <option value="select">{t("fields.type.select")}</option>
              <option value="number">{t("fields.type.number")}</option>
              <option value="date">{t("fields.type.date")}</option>
            </select>
          </label>
          <div className="text-sm">
            <span id={sourceLabelId} className="block">
              {t("fields.source")}
            </span>
            {/* Segmented control, same track as the Day/Week/List one: rounded
                --muted-bg track, selected segment on --background so it stays
                visible in dark mode. No border on a segment. */}
            <div
              role="group"
              aria-labelledby={sourceLabelId}
              className="mt-1 inline-flex rounded-lg bg-[var(--muted-bg)] p-0.5"
            >
              {FIELD_SOURCES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={source === option.id}
                  onClick={() => setSource(option.id)}
                  className={`rounded-md px-3 py-1 transition-colors ${
                    source === option.id
                      ? "bg-[var(--background)] font-medium text-[var(--foreground)]"
                      : "text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {t(option.key)}
                </button>
              ))}
            </div>
          </div>
          {type === "select" && (
            <label className="block text-sm">
              {t("fields.options")}
              <input name="options" className="mt-1 block w-56" />
            </label>
          )}
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
          >
            {t("fields.add")}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setError(null);
            }}
            className="rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          >
            {t("common.cancel")}
          </button>
          {error && <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>}
        </form>
      )}
    </Card>
  );
}

// Who delivers the appointment. A row per person rather than a name typed onto
// each booking: the day view builds a column per person, so free text made one
// stylist into two columns whenever a space crept in, and renaming somebody
// meant editing their whole history.
//
// The LABEL is the org's own word. A Friseur has stylists, a Kfz-Werkstatt has
// Techniker, a Zahnarztpraxis has Hekim. Blank falls back to the dictionary's
// generic word, which is right for most verticals and merely bland for the
// rest — the point is that a new vertical needs no schema change.

// One line per person. It was three — name, "(you)", email stacked — which
// spent a paragraph of height on a row carrying two facts. Everything that
// identifies somebody now reads across, and the two controls sit in their
// columns beside it.
const ROSTER_ROW =
  "sm:grid sm:grid-cols-[1rem_minmax(0,1fr)_5rem_minmax(0,9rem)_1.75rem] sm:items-center sm:gap-3";

const ACCESS_REMOVE = "remove";

// ONE list of people, the way Fresha, Booksy and Square all show it. Two cards
// used to split this: who can log in, and who can be booked. They describe the
// same humans from two angles, so they are two COLUMNS here, not two lists.
//
// Both controls are inline edits, not parked form controls. A row of bordered
// selects reads as a form you have to fill in; a value you click to change
// reads as a fact you can correct. Same reason the name is an inline edit.
function PeopleCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const roster = useQuery(api.team.roster, {});
  const team = useQuery(api.team.overview, {});
  const revokeInvite = useMutation(api.team.revokeInvite);
  const setRole = useMutation(api.team.setRole);
  const removeMember = useMutation(api.team.removeMember);
  const linkStaff = useMutation(api.team.linkStaff);
  const renameMember = useMutation(api.team.renameMember);
  const addStaff = useMutation(api.staff.add);
  const removeStaff = useMutation(api.staff.remove);
  const reorderStaff = useMutation(api.staff.reorder);
  const renameStaff = useMutation(api.staff.rename);
  const setActive = useMutation(api.staff.setActive);
  const [adding, setAdding] = useState(false);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [dragId, setDragId] = useState<Id<"staff"> | null>(null);
  const [inviteFor, setInviteFor] = useState<{ staffId: Id<"staff">; name: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  // The backend refuses to strip the last admin; this turns that into a
  // sentence instead of a raw error string.
  const guard = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
    } catch (err) {
      const reason = err instanceof Error ? err.message : "error";
      setError(
        reason.includes("last-admin")
          ? t("roster.lastAdmin")
          : reason.includes("staff-still-active")
            ? t("roster.deactivateFirst")
            : reason,
      );
    }
  };

  if (roster === undefined || team === undefined) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }

  // Logins nobody has claimed as a bookable person yet, offered on the rows
  // that have no login so the two halves of one human can be joined up.
  //
  // Emailless logins are excluded, and that is the whole fix for a menu that
  // read "No login" twice. Anonymous demo visitors get a users row with no
  // email, so every one of them fell through labelFor's fallback and rendered
  // as the placeholder string. Two visitors, two identical options, neither
  // meaning anything. They should never have been offered regardless: a
  // walk-in with no email is not a person you staff the salon with.
  const unclaimed = roster.filter((row) => row.userId && !row.staffId && row.email);
  // Deactivated members leave the main list rather than sitting in it greyed
  // out: the Team card answers "who works here", and somebody who doesn't is
  // noise in that answer.
  //
  // Only if they have NO login, though. Somebody who can sign in is on the
  // team whether or not they take bookings — an owner who never stands behind
  // a chair still runs the place, and filing them under Deactivated took the
  // account holder out of their own team list.
  const isRetired = (row: (typeof roster)[number]) =>
    Boolean(row.staffId) && row.active === false && !row.userId;
  const activeRows = roster.filter((row) => !isRetired(row));
  const deactivated = roster.filter(isRetired);

  // Reordering rewrites the whole draggable sequence rather than one row's
  // index: the list is short, and a single patch would leave two people
  // sharing a position the next drag then resolves arbitrarily.
  const draggable = activeRows.flatMap((row) =>
    row.staffId && !row.userId ? [row.staffId] : [],
  );
  const moveMember = (target: (typeof roster)[number]) => {
    if (!dragId || !target.staffId || target.staffId === dragId) return;
    const from = draggable.indexOf(dragId);
    const to = draggable.indexOf(target.staffId);
    if (from < 0 || to < 0) return;
    const next = [...draggable];
    next.splice(to, 0, ...next.splice(from, 1));
    setDragId(null);
    void guard(() => reorderStaff({ orderedIds: next }));
  };
  const accessLabel = (value: string) =>
    value === "owner"
      ? t("role.owner")
      : value === "staff"
        ? t("role.staff")
        : t("roster.removeAccess");

  return (
    <>
    <Card title={t("staff.title")} tip={t("roster.hint")} disabled={!isOwner}>
      <div className="space-y-3">
        {/* No "what do you call these people?" input. It was the most
            prominent control in the card and it set ONE string — the field
            label in the booking sheet. Everyone says team member; a salon
            that wanted "Kuaför" got a form field on a page it visits to
            manage people, not vocabulary. */}
        <div className={`hidden pb-1 text-xs text-[var(--muted)] sm:block ${ROSTER_ROW}`}>
          <span />
          <span>{t("roster.person")}</span>
          <span>{t("roster.bookable")}</span>
          <span>{t("roster.access")}</span>
        </div>

        <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {activeRows.map((row) => (
            <li
              key={row.key}
              className={`group py-1 text-sm ${ROSTER_ROW} ${
                dragId === row.staffId ? "opacity-40" : ""
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => moveMember(row)}
            >
              {/* Only the members below the pinned logins can be dragged. This
                  order is the calendar's column order, and somebody floated to
                  the top by having an account is not standing in a different
                  place on the rota — letting them be dragged would write an
                  order the list then refuses to show. */}
              {isOwner && row.staffId && !row.userId ? (
                <span
                  draggable
                  onDragStart={() => setDragId(row.staffId ?? null)}
                  onDragEnd={() => setDragId(null)}
                  title={t("fields.reorder")}
                  aria-label={t("fields.reorder")}
                  className="hidden cursor-grab select-none text-[var(--muted)] hover:text-[var(--foreground)] active:cursor-grabbing sm:inline-flex"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.5" />
                    <circle cx="15" cy="6" r="1.5" />
                    <circle cx="9" cy="12" r="1.5" />
                    <circle cx="15" cy="12" r="1.5" />
                    <circle cx="9" cy="18" r="1.5" />
                    <circle cx="15" cy="18" r="1.5" />
                  </svg>
                </span>
              ) : (
                <span className="hidden sm:block" />
              )}

              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                {/* Every row is renameable, whichever half of a person it is.
                    A staff row's name is the org's own; a login-only member
                    has no staff row to hold one, so the rename lands on the
                    account — see team.renameMember. Without this branch the
                    only unfixable name in the card was the one a sign-in
                    provider chose for you. */}
                {row.staffId ? (
                  <InlineEditValue
                    compact
                    value={row.name}
                    onSave={(next) =>
                      next && renameStaff({ staffId: row.staffId!, name: next })
                    }
                  />
                ) : row.userId && (isOwner || row.isMe) ? (
                  <InlineEditValue
                    compact
                    value={row.name}
                    onSave={(next) =>
                      next && renameMember({ userId: row.userId!, name: next })
                    }
                  />
                ) : (
                  <span className="truncate font-medium">{row.name}</span>
                )}
                {row.email && (
                  <span className="truncate text-xs text-[var(--muted)]">{row.email}</span>
                )}
                {row.isMe && (
                  <span className="text-xs text-[var(--muted)]">({t("team.you")})</span>
                )}
              </span>

              {/* Deactivated, never deleted: whoever left still did last
                  month's work and those appointments must keep a name. */}
              <Toggle
                checked={Boolean(row.staffId && row.active)}
                label={t("roster.bookable")}
                onChange={(next) =>
                  void guard(async () => {
                    if (row.staffId) {
                      await setActive({ staffId: row.staffId, active: next });
                      return;
                    }
                    // A login-only person becoming bookable gets a staff row
                    // created and linked in one gesture, so they stay ONE row.
                    const staffId = await addStaff({ name: row.name });
                    if (staffId && row.userId) {
                      await linkStaff({ staffId, userId: row.userId });
                    }
                  })
                }
              />

              {row.userId ? (
                <InlineEditValue
                  compact
                  value={row.role ?? "staff"}
                  options={["owner", "staff", ACCESS_REMOVE]}
                  labelFor={accessLabel}
                  onSave={(next) =>
                    guard(() =>
                      next === ACCESS_REMOVE
                        ? removeMember({ userId: row.userId! })
                        : setRole({
                            userId: row.userId!,
                            role: next === "owner" ? "owner" : "staff",
                          }),
                    )
                  }
                />
              ) : (
                // "No login" is a state you can change, so it is a control and
                // not a label. It used to be a picklist of unlinked accounts,
                // which meant the commonest case — nobody has signed in yet —
                // opened an empty menu and there was no way at all to invite
                // somebody already on the list.
                <button
                  type="button"
                  disabled={!isOwner || !row.staffId}
                  onClick={() =>
                    row.staffId && setInviteFor({ staffId: row.staffId, name: row.name })
                  }
                  className="justify-self-start rounded-md px-2 py-1 text-left text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] disabled:pointer-events-none"
                >
                  {t("roster.noAccess")}
                </button>
              )}

              {/* Deactivate, not delete. The list above is who works here now;
                  removing somebody for good happens in the Deactivated card
                  below, once they are already out of the booking flow. One
                  destructive control per surface, and this is not the
                  destructive surface. */}
              {isOwner && row.staffId ? (
                <ActionTip
                  label={t("roster.deactivate").replace("{name}", row.name)}
                  onClick={() =>
                    void guard(() => setActive({ staffId: row.staffId!, active: false }))
                  }
                  className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  {/* An archive tray, not a ⊘. The circle-slash is the "no
                      entry" glyph — it reads as this action is forbidden,
                      which is the opposite of what the control does. Filing
                      somebody away is the idea, and it is the same picture
                      Gmail, Linear and Notion use for it. */}
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="4" width="18" height="4" rx="1" />
                    <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
                    <path d="M10 13h4" />
                  </svg>
                </ActionTip>
              ) : (
                <span />
              )}
            </li>
          ))}

          {team.pending.map((pendingInvite) => (
            <li key={pendingInvite._id} className={`py-1 text-sm ${ROSTER_ROW}`}>
              {/* Leading cell for the drag column. An invite has no row to
                  order — it is not a member yet. */}
              <span className="hidden sm:block" />
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="truncate text-[var(--muted)]">{pendingInvite.email}</span>
                <span className="text-xs text-[var(--muted)]">
                  {t("team.pending")} ·{" "}
                  {pendingInvite.role === "staff" ? t("role.staff") : t("role.owner")}
                </span>
              </span>
              <span />
              {isOwner && (
                <button
                  className="justify-self-start rounded-md px-2 py-1 text-xs text-red-600 transition-colors hover:bg-[var(--muted-bg)] dark:text-red-400"
                  onClick={() => void revokeInvite({ inviteId: pendingInvite._id })}
                >
                  {t("team.revoke")}
                </button>
              )}
              <span />
            </li>
          ))}
        </ul>

        {roster.length === 0 && (
          <p className="text-sm text-[var(--muted)]">{t("staff.none")}</p>
        )}

        {/* A button, not a pair of empty inputs living at the foot of the list
            forever. Adding somebody is a twice-a-year job and it should not
            charge rent on every visit. */}
        {isOwner && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          >
            + {t("roster.add")}
          </button>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {adding && (
        <AddPersonSheet onClose={() => setAdding(false)} />
      )}
      {inviteFor && (
        <GrantLoginSheet
          staffId={inviteFor.staffId}
          name={inviteFor.name}
          unclaimed={unclaimed}
          onLink={(userId) =>
            guard(() => linkStaff({ staffId: inviteFor.staffId, userId }))
          }
          onClose={() => setInviteFor(null)}
        />
      )}
    </Card>

    {/* Only when there is somebody in it. An always-present "Deactivated (0)"
        is a permanent reminder of a state most salons never use. */}
    {deactivated.length > 0 && (
      <Card
        title={`${t("roster.deactivatedTitle")} (${deactivated.length})`}
        tip={t("roster.deactivatedHint")}
        disabled={!isOwner}
      >
        <button
          type="button"
          onClick={() => setShowDeactivated((open) => !open)}
          aria-expanded={showDeactivated}
          className="rounded-lg px-2 py-1 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
        >
          {/* The count is already in the card title and the names are in the
              list; a summary that repeats both says nothing twice. */}
          {showDeactivated ? "▾" : "▸"} {t(showDeactivated ? "common.hide" : "common.show")}
        </button>

        {showDeactivated && (
          <ul className="mt-2 divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {deactivated.map((row) => (
              <li key={row.key} className="group flex items-center gap-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{row.name}</span>

                <ActionTip
                  label={t("roster.restore").replace("{name}", row.name)}
                  onClick={() =>
                    void guard(() => setActive({ staffId: row.staffId!, active: true }))
                  }
                  className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  ↺
                </ActionTip>

                {/* The one place a member is destroyed, and only after they
                    are already out of the booking flow. The confirmation says
                    what history it costs, because that is the part that
                    cannot be taken back. */}
                <ActionTip
                  label={(row.hasAppointments
                    ? t("roster.removeWithHistory")
                    : t("roster.remove")
                  ).replace("{name}", row.name)}
                  multiline
                  onClick={() => {
                    void (async () => {
                      const ok = await confirm({
                        title: t("roster.remove").replace("{name}", row.name),
                        body: row.hasAppointments
                          ? t("roster.removeWithHistory").replace("{name}", row.name)
                          : undefined,
                      });
                      if (!ok) return;
                      await guard(() => removeStaff({ staffId: row.staffId! }));
                    })();
                  }}
                  className="opacity-0 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  ✕
                </ActionTip>
              </li>
            ))}
          </ul>
        )}
      </Card>
    )}
    {confirmDialog}
    </>
  );
}

// Two ways to add somebody and they produce different things, so the sheet
// Giving an existing member a login, which is the half "Add member" cannot do:
// somebody added months ago with no address still needs a way in.
//
// Two routes, and they are genuinely different situations rather than a mode
// switch. Usually nobody has signed in yet, so you send an invite and the
// staffId rides along to be joined up on acceptance. Occasionally they already
// signed in on their own and are sitting in the list as a second row — then
// there is nothing to invite and the job is to join the two. That case only
// appears when there IS such a row, which is why it is not always on screen.
function GrantLoginSheet({
  staffId,
  name,
  unclaimed,
  onLink,
  onClose,
}: {
  staffId: Id<"staff">;
  name: string;
  unclaimed: { userId?: Id<"users">; email?: string }[];
  onLink: (userId: Id<"users">) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const invite = useMutation(api.team.invite);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet
      title={t("roster.grantLogin").replace("{name}", name)}
      hint={t("roster.grantLoginHint")}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError(null);
          try {
            await invite({
              email: String(form.get("email") ?? ""),
              role: form.get("role") === "owner" ? "owner" : "staff",
              staffId,
            });
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "error");
          }
        }}
      >
        <div className="flex gap-2">
          <input
            name="email"
            type="email"
            required
            data-sheet-autofocus
            placeholder="ornek@gmail.com"
            className="min-w-0 flex-1"
          />
          <select name="role" defaultValue="staff" className="w-auto shrink-0">
            <option value="staff">{t("role.staff")}</option>
            <option value="owner">{t("role.owner")}</option>
          </select>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
          >
            {t("team.invite")}
          </button>
        </div>
      </form>

      {unclaimed.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <p className="text-xs text-[var(--muted)]">{t("roster.linkExisting")}</p>
          <ul className="mt-1 space-y-1">
            {unclaimed.map((candidate) => (
              <li key={candidate.userId}>
                <button
                  type="button"
                  onClick={() =>
                    void onLink(candidate.userId as Id<"users">).then(onClose)
                  }
                  className="w-full rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-[var(--muted-bg)]"
                >
                  {candidate.email}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

// ONE form, because there was never really a question to ask.
//
// It used to open on a choice — "takes bookings" or "signs in" — which made
// the reader decide, before typing anything, which KIND of person they were
// adding. But a member who cuts hair and a member who logs in are the same
// member; whether they can sign in is a property, not a species. Somebody
// hired today with no email is not a different thing from the same person
// after they get one.
//
// So: a name, and an address if you have one. The address is what grants a
// login, and it can be added later from the member's own row, which is what
// the choice was really standing in for.
function AddPersonSheet({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const addStaff = useMutation(api.staff.add);
  const invite = useMutation(api.team.invite);
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet title={t("roster.add")} hint={t("roster.addHint")} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError(null);
          const name = String(form.get("name") ?? "").trim();
          const email = String(form.get("email") ?? "").trim();
          if (!name) return;
          try {
            // The member first, always — that is the row this list is about.
            // The invite is an extra the member may or may not have, and if it
            // fails (an address already invited, say) the member still exists
            // and the error names the part that did not land.
            await addStaff({ name });
            if (email) {
              await invite({
                email,
                role: form.get("role") === "owner" ? "owner" : "staff",
              });
            }
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "error");
          }
        }}
      >
        <input
          name="name"
          required
          data-sheet-autofocus
          placeholder={t("staff.namePlaceholder")}
        />

        {/* Optional, and labelled as such rather than left to be guessed at:
            an empty box under a required one reads as a field you forgot. */}
        <label className="block text-xs font-medium">
          {t("roster.emailOptional")}
          <div className="mt-1 flex gap-2">
            <input
              name="email"
              type="email"
              placeholder="ornek@gmail.com"
              className="min-w-0 flex-1"
            />
            <select name="role" defaultValue="staff" className="w-auto shrink-0">
              <option value="staff">{t("role.staff")}</option>
              <option value="owner">{t("role.owner")}</option>
            </select>
          </div>
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
          >
            {t("staff.add")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
