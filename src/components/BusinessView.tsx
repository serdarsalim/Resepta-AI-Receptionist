"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type Ref } from "react";
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
import { SegmentedControl } from "./SegmentedControl";
import { ViewOnlyPill } from "./ViewOnlyPill";
import { CheckSwitch } from "./CheckSwitch";
import { StaffColorPicker } from "./StaffColorPicker";
import { FIELD, ROW_GRID, RowLabel } from "./RowLabel";
import { presetLanguage } from "../../convex/lib/industryPresets";
import { InlineEditValue } from "./RecordField";
import { TagPillsEditor } from "./TagPillsEditor";
import { keyFromLabel, normaliseKey } from "../../convex/lib/keys";
import { slugifyInboundAddress } from "../../convex/lib/inboundAddress";
import { MAX_MIN_NOTICE_HOURS, type NoticeUnit } from "../../convex/lib/minNotice";
import { HoverTip } from "./HoverTip";
import { embedSnippet } from "@/lib/embed";

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
// Three tabs, General · Hours · Team, the underlined strip Nudge's Settings
// page wears (Serdar, 2026-10-21). From 2026-08-12 to then this was ONE page
// with the three cards stacked, argued for because hours and capacity are two
// halves of one calculation (getAvailableSlots reads the business hours AND
// the count of active staff). Serdar overruled that: three long cards in one
// scroll read as one endless form, and a tab says what each part is before you
// read it. Your other businesses lives under Team, the same people seen from
// the other businesses they could work in.
//
// Services and contact fields have their own homes (Knowledge, and Customers'
// Contact fields tab): a price list is a body of content you maintain, not a
// setting, and the voice agent and booking page both read it at call time.
// Their cards still live in this file and are exported.
type BusinessSection = "general" | "hours" | "team";

const SECTIONS: BusinessSection[] = ["general", "hours", "team"];

const SECTION_LABEL: Record<BusinessSection, TranslationKey> = {
  general: "settings.general",
  hours: "settings.hours",
  team: "staff.title",
};

// The open tab lives in the URL as ?section=, so a refresh comes back to it and
// the address bar is a link to it. General is the default and leaves the
// parameter off. The name is the one the Calendar's old "Edit hours" button
// linked with, so a ?section=hours link still opens Hours.
const SECTION_PARAM = "section";

function isSection(value: string | null): value is BusinessSection {
  return SECTIONS.some((section) => section === value);
}

// Which card each searchable row lives on; a hit opens the card's tab.
//
// Hand-maintained, same as Account's: the rows live in card bodies with no
// runtime register to enumerate, so add a line when you add a row. Forgetting
// costs one unfindable name. Never index a key that is not in i18n.ts.
const SEARCH_INDEX: { card: BusinessCard; key: TranslationKey }[] = [
  { card: "general", key: "settings.general" },
  { card: "general", key: "settings.businessName" },
  { card: "general", key: "settings.address" },
  { card: "general", key: "settings.logo" },
  { card: "general", key: "settings.inboundAddress" },
  { card: "general", key: "settings.emailFrom" },
  { card: "general", key: "settings.language" },
  { card: "general", key: "settings.industry" },
  { card: "general", key: "settings.bookingPage" },
  { card: "general", key: "settings.termsUrl" },
  { card: "general", key: "settings.privacyUrl" },
  { card: "general", key: "settings.minNotice" },
  { card: "general", key: "settings.currency" },
  { card: "general", key: "settings.priceDecimals" },
  { card: "general", key: "settings.revenueEnabled" },
  { card: "general", key: "settings.fulfillment" },
  { card: "hours", key: "settings.hours" },
  { card: "hours", key: "settings.timezone" },
  { card: "hours", key: "settings.businessHours" },
  { card: "team", key: "staff.title" },
  { card: "team", key: "roster.bookable" },
  { card: "businesses", key: "share.title" },
];

type BusinessCard = "general" | "hours" | "team" | "businesses";

const CARD_SECTION: Record<BusinessCard, BusinessSection> = {
  general: "general",
  hours: "hours",
  team: "team",
  businesses: "team",
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
  const [section, setSection] = useState<BusinessSection>("general");

  // A layout effect, so a link to Hours never paints General for a frame
  // first. Read after mount like the shell's own ?tab=, never during render:
  // initialising state from window there is a hydration mismatch.
  useLayoutEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get(SECTION_PARAM);
    if (isSection(wanted)) setSection(wanted);
  }, []);

  // replaceState, not push, for the shell's reason: switching tabs is not
  // history, and Back should still mean "the page before this one".
  const openSection = (next: BusinessSection) => {
    setSection(next);
    const url = new URL(window.location.href);
    if (next === "general") url.searchParams.delete(SECTION_PARAM);
    else url.searchParams.set(SECTION_PARAM, next);
    window.history.replaceState(null, "", url);
  };

  // A hit on Your other businesses opens Team and then scrolls to that card,
  // the second one on the tab. Held in state and consumed by an effect rather
  // than scrolled on the click: clearing the query renders the tab, so at
  // click time the card is not on the page yet. Same mechanism AccountView
  // uses, and the same reason.
  const businessesRef = useRef<HTMLDivElement | null>(null);
  const [pendingScroll, setPendingScroll] = useState(false);
  useEffect(() => {
    if (!pendingScroll) return;
    // No behavior: "smooth". It silently does nothing on this shell's `main`,
    // measured, so asking for it costs the scroll it was meant to prettify.
    businessesRef.current?.scrollIntoView({ block: "start" });
    setPendingScroll(false);
  }, [pendingScroll]);

  const hits = search.active
    ? SEARCH_INDEX.filter((entry) => search.matches(t(entry.key)))
    : [];

  const settings = useQuery(api.orgs.current, {});
  if (!settings) return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  // The backend enforces this too (requireOwner); the fieldsets are honest UI.
  const isOwner = settings.me.role !== "staff";

  // Searching replaces the page body with a list of places to go, and picking
  // one clears the query, because the search is done the moment it has taken
  // you somewhere: to the tab that holds the row.
  if (search.active) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 page-stack">
        {hits.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("table.noMatches")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            {hits.map((entry, i) => {
              const target = CARD_SECTION[entry.card];
              const label = t(entry.key);
              const tabLabel = t(SECTION_LABEL[target]);
              return (
                <button
                  key={`${entry.card}:${entry.key}`}
                  type="button"
                  onClick={() => {
                    search.setQuery("");
                    openSection(target);
                    if (entry.card === "businesses") setPendingScroll(true);
                  }}
                  className={`flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--control-hover)] ${
                    i > 0 ? "border-t border-[var(--border)]" : ""
                  }`}
                >
                  <span className="text-sm">{label}</span>
                  {/* Where the hit lands. Left off when the hit IS the tab
                      ("Hours … Hours" said one thing twice). */}
                  {label !== tabLabel && (
                    <span className="shrink-0 text-xs text-[var(--muted)]">{tabLabel}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 page-stack">
      {/* Underline tabs, VoiceView's strip: the hairline belongs to the STRIP
          and each tab overlaps it with -mb-px, so the active underline
          replaces that segment of the rule, and the weight never changes
          between states. A member's View only pill rides the strip's right
          end rather than taking a row of its own above it. */}
      <div className="flex flex-wrap items-center gap-5 border-b border-[var(--border)]">
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => openSection(id)}
            aria-current={section === id ? "page" : undefined}
            className={`-mb-px border-b-2 px-0.5 py-2.5 text-sm transition-colors ${
              section === id
                ? "border-[var(--foreground)] text-[var(--foreground)]"
                : "border-transparent text-[var(--muted-strong)] hover:text-[var(--foreground)]"
            }`}
          >
            {t(SECTION_LABEL[id])}
          </button>
        ))}
        {!isOwner && (
          <span className="ml-auto">
            <ViewOnlyPill title={t("settings.ownerOnly")} />
          </span>
        )}
      </div>

      {section === "general" && <DetailsCard isOwner={isOwner} />}
      {/* No Closures card: blocked time is drawn on the calendar, where the
          owner already lives (BlockSheet). Hours keeps only the standing
          week. */}
      {section === "hours" && <HoursCard isOwner={isOwner} org={settings.org} />}
      {section === "team" && (
        <div className="space-y-8">
          <PeopleCard isOwner={isOwner} />
          {/* Renders only for an owner who has a second business. */}
          <OtherBusinessesCard isOwner={isOwner} ref={businessesRef} />
        </div>
      )}
    </div>
  );
}

// Rows use the shared ROW_GRID from RowLabel, the same string SettingsView and
// AccountView import: the three surfaces must line up when you flip between
// them, which they stop doing the moment the string exists in three places.

// Online booking: the VALUE half of a row in the General card, which is where
// this lives since 2026-08-25. It was a card of its own until then; the note on
// its RowLabel up there says why it stopped being one.
//
// A plain switch. It was three chips for a while (our page / your own link /
// off), but "my own link" meant switching OUR page off while still printing a
// URL in messages — a state that read as off here and as on in a customer's
// inbox. One page, on or off; [booking_link] resolves to the page when it is
// on and to nothing when it is not.
function BookingRow() {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const update = useMutation(api.orgs.update);
  const enableBooking = useMutation(api.booking.enable);
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  if (!settings) return null;
  const { bookingEnabled, publicSlug } = settings.org;
  const nativeBookingUrl =
    publicSlug && typeof window !== "undefined"
      ? `${window.location.origin}/book/${publicSlug}`
      : null;

  const toggle = (next: boolean) =>
    void (async () => {
      if (next) {
        const slug = await enableBooking({ enabled: true });
        if (slug) {
          await update({ bookingUrl: `${window.location.origin}/book/${slug}` });
        }
        return;
      }
      await enableBooking({ enabled: false });
      // Off means off everywhere: a cleared link is what makes the reminder
      // and the closed-hours reply stop offering a page that no longer answers.
      await update({ bookingUrl: "" });
    })();

  return (
    <>
        {/* One line: switch, address, Copy — the same shape the request-form
            row had. The toggle stays leftmost so it lines up with every other
            toggle in this column rather than floating behind a URL.

            The link TRUNCATES rather than wrapping. It is a fact to copy, not
            prose to read, and Copy is the affordance that matters; a URL
            allowed to wrap took two lines and pushed the button onto a
            third. */}
        <div className="flex items-center gap-2">
          <CheckSwitch
            on={bookingEnabled ?? false}
            label={t("settings.bookingPage")}
            onChange={toggle}
          />
          {/* Derived, and it STAYS derived — no field here. The address is
              the business name (lib/publicSlug); renaming the business is how
              you rename the page, and a second place to type it would be a
              second answer to one question. */}
          {bookingEnabled && nativeBookingUrl && (
            <>
              <a
                href={nativeBookingUrl}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
              >
                {nativeBookingUrl}
              </a>
              {/* The glyph says copy; the word only said it in one language
                  and took width from the URL, which is the thing on this line
                  worth reading. The name survives as the tooltip and the
                  accessible name, so nothing that could read the word before
                  has lost it.

                  Still a state, not a fire-and-forget: an icon that does not
                  change leaves you wondering whether the click landed, so the
                  sheet turns into a check for the same 1200ms the word used
                  to. */}
              <HoverTip text={copied ? t("common.copied") : t("common.copy")} className="inline-flex shrink-0">
              <button
                type="button"
                aria-label={copied ? t("common.copied") : t("common.copy")}
                onClick={() => {
                  void navigator.clipboard.writeText(nativeBookingUrl).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  });
                }}
                className={`shrink-0 rounded-md p-1.5 transition-colors ${
                  copied
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                }`}
              >
                {copied ? <CopiedIcon /> : <CopyIcon />}
              </button>
              </HoverTip>
              {/* The page on the business's own website (P29): the code to
                  paste, a div naming this page and our loader script
                  (public/embed.js, lib/embed). One glyph beside Copy, since
                  it copies too; the hover label says what. */}
              <HoverTip
                text={embedCopied ? t("common.copied") : t("settings.copyEmbed")}
                className="inline-flex shrink-0"
              >
              <button
                type="button"
                aria-label={embedCopied ? t("common.copied") : t("settings.copyEmbed")}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(embedSnippet(nativeBookingUrl))
                    .then(() => {
                      setEmbedCopied(true);
                      setTimeout(() => setEmbedCopied(false), 1200);
                    });
                }}
                className={`shrink-0 rounded-md p-1.5 transition-colors ${
                  embedCopied
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                }`}
              >
                {embedCopied ? <CopiedIcon /> : <EmbedIcon />}
              </button>
              </HoverTip>
            </>
          )}
        </div>
    </>
  );
}

// The business's own terms and privacy pages, named with links above the
// booking page's Book button (P29, Nudge 3afd3e60). Only while the page is on:
// it is a fact about that page and nothing else reads it. Two fields BESIDE
// each other on one row, since they answer one question; each saves on blur,
// and a refusal (not an http(s) address) says so on the line under them and
// puts the stored value back.
function LegalLinksRow() {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const update = useMutation(api.orgs.update);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  if (!settings?.org.bookingEnabled) return null;
  const save = (field: "termsUrl" | "privacyUrl", raw: string) => {
    const next = raw.trim();
    if (next === (settings.org[field] ?? "")) return;
    setError(false);
    void update({ [field]: next }).catch((err: unknown) => {
      if (String(err).includes("invalid-url")) setError(true);
      setTick((n) => n + 1);
    });
  };
  return (
    <>
      <RowLabel label={t("settings.legalLinks")} hint={t("settings.legalLinksHint")} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          key={`terms-${tick}-${settings.org.termsUrl ?? ""}`}
          type="url"
          inputMode="url"
          className={FIELD}
          defaultValue={settings.org.termsUrl ?? ""}
          placeholder={t("settings.termsUrl")}
          aria-label={t("settings.termsUrl")}
          onBlur={(e) => save("termsUrl", e.target.value)}
        />
        <input
          key={`privacy-${tick}-${settings.org.privacyUrl ?? ""}`}
          type="url"
          inputMode="url"
          className={FIELD}
          defaultValue={settings.org.privacyUrl ?? ""}
          placeholder={t("settings.privacyUrl")}
          aria-label={t("settings.privacyUrl")}
          onBlur={(e) => save("privacyUrl", e.target.value)}
        />
      </div>
      {error && (
        <>
          <span />
          <p className="text-sm text-red-600 dark:text-red-400">{t("settings.invalidUrl")}</p>
        </>
      )}
    </>
  );
}

// The minimum notice as a number and its unit, Nudge's pair (d76a2ad8). The
// rule is stored in hours; the unit is only how it reads. A day is 24 clock
// hours, and switching the unit keeps the number on screen ("2 hours" becomes
// "2 days"), which is what someone reaching for the other unit means. The
// value in force shows in the box even when nothing was ever saved: an unset
// business runs on one hour, and an empty field would say it runs on none.
function MinNoticeRow({
  hours,
  unit,
  onSave,
}: {
  hours: number;
  unit: NoticeUnit;
  onSave: (patch: { minNoticeHours: number; minNoticeUnit?: NoticeUnit }) => void;
}) {
  const { t } = useLanguage();
  const shown = unit === "days" ? Math.round(hours / 24) : hours;
  const max = unit === "days" ? MAX_MIN_NOTICE_HOURS / 24 : MAX_MIN_NOTICE_HOURS;
  return (
    <span className="flex items-center gap-2">
      <input
        // Remounted when the stored value moves, so a clamp on the server
        // (or the other unit) shows what was actually kept.
        key={`notice-${hours}-${unit}`}
        type="number"
        min={0}
        max={max}
        step={1}
        inputMode="numeric"
        aria-label={t("settings.minNotice")}
        className={`${FIELD} w-20`}
        defaultValue={shown}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const typed = Math.round(Number(raw));
          // An emptied box, or nonsense, is a slip, not "no notice": put the
          // number back. Zero has to be typed.
          if (raw === "" || !Number.isFinite(typed)) {
            e.target.value = String(shown);
            return;
          }
          const next = Math.max(0, Math.min(max, typed));
          if (next === shown) {
            e.target.value = String(shown);
            return;
          }
          onSave({ minNoticeHours: unit === "days" ? next * 24 : next });
        }}
      />
      <select
        aria-label={t("settings.minNoticeUnit")}
        className={`${FIELD} w-auto`}
        value={unit}
        onChange={(e) => {
          const next: NoticeUnit = e.target.value === "days" ? "days" : "hours";
          if (next === unit) return;
          onSave({
            minNoticeUnit: next,
            minNoticeHours: Math.min(
              MAX_MIN_NOTICE_HOURS,
              next === "days" ? shown * 24 : shown,
            ),
          });
        }}
      >
        <option value="hours">{t.plural("settings.noticeHours", shown)}</option>
        <option value="days">{t.plural("settings.noticeDays", shown)}</option>
      </select>
    </span>
  );
}

// Local, like every other icon in this app (SearchIcon in HelpCenter,
// PencilIcon in RecordField). There is no icon module to add to, and one
// caller does not make one.
function EmbedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// The check switch's path at the same size, so the app's "yes, that happened"
// mark is one shape.
function CopiedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function DetailsCard({ isOwner }: { isOwner: boolean }) {
  const { t, language } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const update = useMutation(api.orgs.update);
  const applyIndustry = useMutation(api.onboarding.applyIndustryPreset);
  const resetIndustry = useMutation(api.onboarding.resetToIndustryDefaults);
  // The verticals on offer, from the deployment (convex/industryPresets) —
  // `include` carries this org's own answer so a vertical the operator has
  // since retired still has a name here instead of an empty picker.
  const industries = useQuery(api.industryPresets.catalogue, {
    include: settings?.org.industry ?? undefined,
  });
  const [confirm, confirmDialog] = useConfirm();
  const generateUploadUrl = useMutation(api.media.generateUploadUrl);
  const setLogo = useMutation(api.orgs.setLogo);
  const [logoBusy, setLogoBusy] = useState(false);
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
  // The name can be refused too, since 2026-08-20: the booking page address is
  // derived from it, so two businesses sharing a name would be two businesses
  // sharing one public page.
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameTick, setNameTick] = useState(0);
  // Only to know whether this business sells GOODS at all. Pickup and delivery
  // are questions about handing an object over, so a salon that sells nothing
  // but hours should not be asked them — the rows below appear the day the
  // first product is added and stay gone otherwise.
  const services = useQuery(api.services.list, {});
  const sellsGoods = (services ?? []).some(
    (row) => row.durationMinutes === undefined,
  );

  return (
    // Untitled: the General tab right above it already names it.
    <Card disabled={!isOwner}>
      {confirmDialog}
      {settings === undefined ? (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      ) : (
        <div className={ROW_GRID}>
          {/* The hint is not decoration: this field now moves the public
              booking link, and an owner tidying up their spelling has no way
              to guess that from a box labelled "Business name". */}
          <RowLabel
            label={t("settings.businessName")}
            hint={t("settings.businessNameHint")}
          />
          {/* Capped per input rather than by narrowing ROW_GRID: the shared
              column has to stay 24rem for the rows that need it (seven day
              chips on one line, the open/close pickers). These values are a
              name, an email local part and two-word selects — a box wider
              than the text it will ever hold reads as an invitation to write
              an essay. One cap for every box in this card: the email input
              used to sit visibly shorter than the rest because its @domain
              suffix ate into the same 18rem, and a card of five widths reads
              as five decisions. */}
          <input
            key={`name-${nameTick}-${settings.org.name}`}
            className={`${FIELD} sm:max-w-56`}
            defaultValue={settings.org.name}
            onBlur={(e) => {
              const next = e.target.value;
              if (next.trim() === settings.org.name) return;
              setNameError(null);
              void update({ name: next }).catch((err) => {
                setNameError(
                  String(err).includes("name-taken")
                    ? t("settings.nameTaken")
                    : t("settings.nameRejected"),
                );
                setNameTick((tick) => tick + 1);
              });
            }}
          />
          {nameError && (
            <>
              <span />
              <p className="text-sm text-red-600 dark:text-red-400">{nameError}</p>
            </>
          )}

          <RowLabel label={t("settings.address")} hint={t("settings.addressHint")} />
          <input
            key={`address-${settings.org.address ?? ""}`}
            className={FIELD}
            defaultValue={settings.org.address ?? ""}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next === (settings.org.address ?? "")) return;
              void update({ address: next });
            }}
          />

          <RowLabel label={t("settings.logo")} hint={t("settings.logoHint")} />
          <div className="flex items-center gap-3">
            {settings.org.logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- a
                 Convex storage URL, not an asset next/image can optimize */
              <img
                src={settings.org.logoUrl}
                alt=""
                className="h-12 w-12 rounded-xl border border-[var(--border)] object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-lg font-semibold text-[var(--muted)]">
                {settings.org.name.trim().charAt(0).toUpperCase() || "·"}
              </div>
            )}
            <label className="cursor-pointer rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--muted-bg)]">
              {logoBusy ? t("common.saving") : t("settings.logoUpload")}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={logoBusy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setLogoBusy(true);
                  void (async () => {
                    try {
                      const url = await generateUploadUrl();
                      const res = await fetch(url, {
                        method: "POST",
                        headers: { "content-type": file.type },
                        body: file,
                      });
                      const { storageId } = (await res.json()) as {
                        storageId: Id<"_storage">;
                      };
                      await setLogo({ storageId });
                    } finally {
                      setLogoBusy(false);
                    }
                  })();
                }}
              />
            </label>
            {settings.org.logoUrl && (
              <button
                type="button"
                onClick={() => void setLogo({ storageId: null })}
                className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              >
                {t("settings.logoRemove")}
              </button>
            )}
          </div>
          {/* The "number for customers to call" row lived here until
              2026-08-19. It duplicated the voice agent's own inbound-number
              picker — the [phone] token now resolves to that line on the
              server, so there is nothing left for an owner to configure. */}
          {/* Timezone moved to Hours (2026-08-12). It is the clock the open and
              close times are read in, so it belongs on that screen; here it was
              a lone qualifier for a setting one chip away. */}
          {/* The address customers write TO. One verified domain serves every
              business; this left-hand part is what routes an incoming email to
              THIS org, so it has to be unique and the save rejects a clash. */}
          {/* The request-form toggle and embed snippet left on 2026-08-19:
              the /r page and the booking page were two public channels for
              the same job, and the booking card next door is the one that
              survived. */}
          <RowLabel label={t("settings.inboundAddress")} hint={t("settings.inboundAddressHint")} />
          <span className="flex items-center gap-1">
            {/* The salon's OWN name, slugged the way the server will slug it
                (lib/inboundAddress) — so the placeholder is both an example
                and a preview of what typing their name would give them. A
                fixed "guzellik" was one specific salon's name shown to every
                other salon, which reads as someone else's data. */}
            <input
              key={`inbound-${addressTick}`}
              className={`${FIELD} sm:max-w-56`}
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
          {/* Behind a confirmation since 2026-08-26 (Serdar): the value
              implicates the assistant's fallback language, the automated
              messages and the campaign template, and prod Bella sat on the
              wrong one for weeks without anyone noticing. Loud beats locked
              — the same wrong value under an immutable field would have
              needed operator surgery to fix. */}
          <select
            className={`${FIELD} sm:max-w-56`}
            defaultValue={settings.org.language}
            onChange={(e) => {
              const el = e.target;
              const next = el.value;
              const prev = settings.org.language;
              if (next === prev) return;
              void (async () => {
                const ok = await confirm({
                  title: t("settings.languageChange"),
                  body: t("settings.languageChangeBody"),
                  confirmLabel: t("settings.languageChangeConfirm"),
                });
                // Reverted by hand because the select is uncontrolled: the
                // stored value never moved, but the browser already painted
                // the new choice.
                if (!ok) {
                  el.value = prev;
                  return;
                }
                await update({ language: next });
              })();
            }}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          {/* The onboarding wizard's industry answer, revisitable. Picking a
              different industry only records the answer; the reset button is
              what re-seeds — it deletes the price list and re-applies the
              template (behind a confirmation that names exactly that), which
              is the "start blank, change your mind later" path the wizard
              promises. Fields a voice agent references survive the reset,
              because deleting them would wedge the agent's next publish. */}
          <RowLabel
            label={t("settings.industry")}
            hint={t("settings.industryHint")}
          />
          <div className="flex items-center gap-3">
            <select
              className={`${FIELD} w-full sm:max-w-56`}
              value={settings.org.industry ?? ""}
              onChange={(e) => {
                const industry = e.target.value;
                if (industry) void applyIndustry({ industry, prefill: false });
              }}
            >
              <option value="" disabled>
                {t("settings.industryNone")}
              </option>
              {(industries ?? []).map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.name[presetLanguage(language)]}
                </option>
              ))}
            </select>
            {settings.org.industry && settings.org.industry !== "other" && (
              <button
                type="button"
                onClick={() => {
                  const industry = settings.org.industry!;
                  void (async () => {
                    const ok = await confirm({
                      title: t("settings.industryResetConfirm", {
                        industry:
                          industries?.find((preset) => preset.key === industry)
                            ?.name[presetLanguage(language)] ?? industry,
                      }),
                      body: t("settings.industryResetBody"),
                      confirmLabel: t("settings.industryReset"),
                    });
                    if (!ok) return;
                    await resetIndustry({});
                  })();
                }}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              >
                {t("settings.industryReset")}
              </button>
            )}
          </div>
          {/* Sits under language because the two answer together: language
              picks the separators and digit grouping, currency picks the
              symbol. Changing this does NOT convert anything — a price stored
              as 40000 is ₺400,00 today and €400.00 tomorrow. That is the
              honest behaviour: we don't know an exchange rate and inventing
              one would silently rewrite what customers were charged. */}
          <RowLabel label={t("settings.currency")} hint={t("settings.currencyHint")} />
          {/* Currency and decimals stay on ONE line: they answer the same
              question together — currency picks the symbol, language picks
              the separators, this picks how much of the number to write. A
              plain checkbox with its words, after a ",00" pill proved too
              cryptic (Serdar, 2026-08-20) and an option INSIDE the select was
              rejected outright: a picked "option" that toggles a setting and
              snaps the select back is a control lying about its value, and a
              screen reader would offer it as a currency. */}
          <div className="flex items-center gap-3">
            <select
              className={`${FIELD} w-full sm:max-w-56`}
              defaultValue={settings.org.currency}
              onChange={(e) => void update({ currency: e.target.value })}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {`${code} · ${currencySymbol(code, settings.org.language)}`}
                </option>
              ))}
            </select>
            {/* Switch and inert words, the shape the pickup/delivery pair
                uses further down. It was a native checkbox until 2026-08-29,
                which made this card ask a yes/no question three different
                ways on one screen — a checkbox here, pills below, a check
                circle in the tables.

                The word stops being a click target in the trade: a <label>
                can adopt a native input, and cannot adopt a <button>. The
                switch is 24px with its own accessible name, and no other
                switch on this card ever had a clickable word. */}
            <span className="flex shrink-0 items-center gap-2">
              <CheckSwitch
                on={settings.org.priceDecimals ?? false}
                label={t("settings.priceDecimals")}
                onChange={(next) => void update({ priceDecimals: next })}
              />
              <span className="text-sm text-[var(--muted)]">
                {t("settings.priceDecimals")}
              </span>
            </span>
          </div>
          {/* Last on purpose: an opt-in extra, below the facts of the
              business. It follows currency because that is the unit the tab
              it unlocks counts in. Off by default: an org that never fills in
              prices would get a nav item leading to three zeroes, which reads
              as broken not unused. */}
          <RowLabel label={t("settings.revenueEnabled")} hint={t("settings.revenueEnabledHint")} />
          <span className="flex items-center">
            <CheckSwitch
              on={settings.org.revenueEnabled ?? false}
              label={t("settings.revenueEnabled")}
              onChange={(next) => void update({ revenueEnabled: next })}
            />
          </span>
          {/* Online booking, one row under Revenue tab, and it used to be a
              CARD of its own (Serdar: "shouldn't be a separate card just put
              it below the revenue tab header as a new row in general").

              The card's argument was that a public page customers land on is
              a CHANNEL and every appointment product treats it as one. True
              about the thing, wrong about the surface: the card held exactly
              one switch, so it was a title, a tip and a frame around a control
              that already had a label. Two more toggles sit directly above it
              in this column and neither needed a card to be found.

              It keeps its own (i) on the label, which is where the channel
              argument survives — the sentence explaining what the page IS was
              the only thing the card's header carried that the row does
              not. */}
          <RowLabel
            label={t("settings.bookingPage")}
            hint={t("settings.bookingPageHint")}
          />
          <BookingRow />
          <LegalLinksRow />
          {/* The minimum notice (lib/minNotice), under the booking page
              because that is the door most customers meet it at. Shown with
              the page off too: the phone agent and the WhatsApp assistant obey
              it as well. */}
          <RowLabel label={t("settings.minNotice")} hint={t("settings.minNoticeHint")} />
          <MinNoticeRow
            hours={settings.org.minNoticeHours}
            unit={settings.org.minNoticeUnit}
            onSave={(patch) => void update(patch)}
          />
          {/* Under the booking page, because that is the surface these two
              narrow — and only for a business that sells products, since
              pickup and delivery are questions about handing an object over.

              Two switches rather than a picker: the three real answers
              (counter only, both, delivery only) are not points on a scale,
              and a ghost kitchen that never opens its doors is as ordinary as
              a salon that never leaves them. The last one on cannot be
              switched off — a business offering neither has no way to sell a
              product — so it disables rather than refusing after the tap. */}
          {sellsGoods && (
            <>
              <RowLabel
                label={t("settings.fulfillment")}
                hint={t("settings.fulfillmentHint")}
              />
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {(
                  [
                    ["pickupEnabled", "booking.pickup", "deliveryEnabled"],
                    ["deliveryEnabled", "booking.delivery", "pickupEnabled"],
                  ] as const
                ).map(([field, label, other]) => {
                  const on = settings.org[field] ?? true;
                  return (
                    <span key={field} className="flex items-center gap-2">
                      <CheckSwitch
                        on={on}
                        label={t(label)}
                        // Off is only allowed while the other one is on.
                        disabled={on && !(settings.org[other] ?? true)}
                        onChange={(next) => void update({ [field]: next })}
                      />
                      <span className="text-sm">{t(label)}</span>
                    </span>
                  );
                })}
              </div>
            </>
          )}
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
// NO KEY COLUMN, and as of 2026-08-25 no key SURFACE anywhere. It spent a
// while here as a monospace chip and read as exactly what it was, a
// developer's column in an owner's price list, so it moved to a card of its
// own — which turned out to be the same mistake with more room (Serdar:
// "service keys are totally stupid... why do we need it anyway, these
// variables are auto generated from services").
//
// He is right, and the deciding fact is in PromptEditor's header: the owner
// thinks in labels, the provider speaks keys, and the editor translates so
// nobody has to remember or retype key syntax. A surface teaching keys undoes
// the thing that editor exists to do. The card also offered to RENAME one,
// which is the single edit nobody should ever make: the key is frozen
// precisely so renaming a service cannot move the address automations point
// at, so the only capability it exposed was a way to break references.
//
// The key still exists on the row and is still what the agent books by. It is
// generated from the name and read by machines. Don't build a screen for it.
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

// Adding a service, as a sheet. It used to be an inline row that unfolded at
// the foot of the list — fine when the card was the only thing on a settings
// page, wrong now that Services is its own tab whose primary action should sit
// where every other tab's does. The stacked layout also gives the price its
// currency and the duration its unit room to be labelled properly, which the
// three-inputs-on-one-line version could not afford.
function NewServiceSheet({
  initialKind,
  onClose,
}: {
  // Which button opened this. The Type switch stays — a product typed in by
  // mistake has to be fixable without closing and reopening — but it arrives
  // already answered, because the gesture that got here said which.
  initialKind: "service" | "good";
  onClose: () => void;
}) {
  const { t, language } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const currency = settings?.org.currency ?? DEFAULT_CURRENCY;
  const create = useMutation(api.services.create);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // An explicit choice, not empty-field semantics: "leave duration blank to
  // make a product" was a rule you had to be told, and a default of 30 meant
  // the form had already answered the question before the owner did. The
  // kind decides which time field the form even has.
  const [kind, setKind] = useState<"service" | "good">(initialKind);
  const isGood = kind === "good";
  const [duration, setDuration] = useState("30");

  return (
    <Sheet
      title={t(isGood ? "services.addProduct" : "services.add")}
      onClose={onClose}
    >
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
              // A product sends no duration at all — the absence IS the
              // fact, the server stores nothing rather than a placeholder.
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
        {/* A form grid: labels in the first column, every control starting
            at the same left edge in the second. Type comes FIRST because it
            decides what the rest of the form even asks — a service has a
            length, a product has a warning, and the name is just a name
            either way. The name box is wider (names need it), the numbers
            are number-sized (w-28), all flush left. */}
        <div className="grid grid-cols-[6.5rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
          <span id="service-kind-label">{t("services.kind")}</span>
          <div
            role="group"
            aria-labelledby="service-kind-label"
            className="flex w-56 gap-1.5"
          >
            {(["service", "good"] as const).map((option) => {
              const picked = kind === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={picked}
                  onClick={() => setKind(option)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 transition-colors ${
                    picked
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 font-medium text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {t(option === "service" ? "services.kindService" : "services.kindGood")}
                </button>
              );
            })}
          </div>
          {/* Reserved whether or not it holds anything — the same rule the
              error line below follows — so flipping the kind never resizes
              the sheet. Both branches also render exactly ONE time row
              (minutes or warning), for the same reason. */}
          <span aria-hidden />
          <p className="-mt-1.5 min-h-[1rem] text-xs text-[var(--muted)]">
            {isGood ? t("services.goodHint") : ""}
          </p>

          <label htmlFor="service-name">
            {t(isGood ? "services.productName" : "services.name")}
          </label>
          <input
            id="service-name"
            name="name"
            required
            data-sheet-autofocus
            className="w-56"
          />

          {!isGood ? (
            <>
              <label htmlFor="service-duration">{t("services.duration")}</label>
              <span className="flex items-center gap-2">
                {/* key, or React reuses this node for the lead input when the
                    kind flips and the old "30" rides along as its value. */}
                <input
                  key="duration"
                  id="service-duration"
                  name="durationMinutes"
                  type="number"
                  min={5}
                  step={5}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-28"
                />
                <span className="text-xs text-[var(--muted)]">{t("services.minutes")}</span>
              </span>
            </>
          ) : (
            <>
              <label htmlFor="service-lead">{t("services.leadTime")}</label>
              <span className="flex items-center gap-2">
                <input
                  key="lead"
                  id="service-lead"
                  name="leadDays"
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder={t("common.optional")}
                  className="w-28"
                />
                <span className="text-xs text-[var(--muted)]">{t("services.leadDays")}</span>
              </span>
            </>
          )}

          <label htmlFor="service-price">{t("services.price")}</label>
          <span className="flex items-center gap-2">
            <input
              id="service-price"
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
  const priceDecimals = settings?.org.priceDecimals ?? false;
  const services = useQuery(api.services.list, {});
  const update = useMutation(api.services.update);
  const remove = useMutation(api.services.remove);
  const reorder = useMutation(api.services.reorder);
  // Null when closed, otherwise the kind the button that opened it stands for.
  // It was a boolean while one shared button sat above both cards and the
  // sheet asked Type itself.
  const [adding, setAdding] = useState<"service" | "good" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  // The row being dragged by its six-dot handle (Serdar, 2026-08-28), the
  // contact-fields pattern. One id serves both lists; a drop checks the
  // dragged row actually lives in the list it lands on.
  const [dragId, setDragId] = useState<Id<"services"> | null>(null);

  // The same comparator the list query uses: the owner's drag order first,
  // name for rows that predate it.
  const sorted = [...(services ?? [])].sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) -
        (b.order ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name),
  );
  // Two cards, not one list with a quiet gap in its Duration column. A product
  // is not a short service: it books no time, holds no chair, and answers a
  // different question in every column this table has. Mixed together, the only
  // thing marking Shampoo out from a service someone forgot to time was an
  // empty cell. The booking page already splits them for the customer; this is
  // the same split for the owner.
  const timed = sorted.filter((row) => row.durationMinutes !== undefined);
  const goods = sorted.filter((row) => row.durationMinutes === undefined);

  // Staff cannot add a service, so an empty list for them is a heading, an (i)
  // and an empty fieldset. Nothing to read and nothing to do: render nothing.
  if (!isOwner && services !== undefined && sorted.length === 0) return null;

  // One list body, rendered by both cards. A closure rather than a component:
  // it reads a dozen things off this scope (the mutations, the currency, the
  // confirm dialog) and drilling them through props to say the same thing
  // twice is how the two copies start to differ.
  // `goods` names the column over "Hair gel" and "Shampoo". The two lists share
  // every other column, so this is one word, not a second renderer.
  // Reordering rewrites the dropped-on list's whole sequence, same reasoning
  // as the team roster: the lists are short, and a single patch would leave
  // two rows sharing a position the next drag resolves arbitrarily.
  const moveService = (rows: typeof sorted, target: (typeof sorted)[number]) => {
    if (!dragId || dragId === target._id) return;
    const ids = rows.map((row) => row._id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(target._id);
    setDragId(null);
    // A drag from the other list lands here with from === -1: ignored, the
    // two lists order independently.
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(to, 0, ...next.splice(from, 1));
    void reorder({ orderedIds: next });
  };

  const serviceList = (rows: typeof sorted, goodsList = false) => (
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
                <span>
                  {t(goodsList ? "services.productName" : "services.name")}
                </span>
                {/* "Duration" is a question a product cannot answer — it is
                    handed over, not performed — and the cell under it holds a
                    LEAD TIME when it holds anything (how much warning an order
                    needs, "order a day ahead"). So the header names that on the
                    goods list. It stays mostly empty, which is correct: most
                    goods need no warning, and the column is the only place an
                    existing one can be read or corrected. */}
                <span>
                  {t(goodsList ? "services.leadTime" : "services.duration")}
                </span>
                <span>{t("services.price")}</span>
                <span>{t("services.active")}</span>
                <span />
              </div>
            )}
            <ul className="divide-y divide-[var(--border)]">
              {rows.map((service) => (
                <li
                  key={service._id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => moveService(rows, service)}
                  className={`group relative py-1.5 text-sm ${SERVICE_ROW_GRID} ${
                    dragId === service._id ? "opacity-40" : ""
                  }`}
                >
                  {/* The whole top line on a phone, so the name is not fighting
                      264px of fixed columns for the 60px that is left. Reserves
                      the right end for the delete ×, parked there below sm —
                      pr-8 clears its w-7, where the old "Delete" word needed
                      twice that. */}
                  <span className="flex min-w-0 items-center gap-1 max-sm:col-span-4 max-sm:row-start-1 max-sm:pr-8">
                    {/* The six-dot handle, sm and up: touch drag on the phone
                        layout fights scrolling, and the fields table already
                        made this call. */}
                    {isOwner && (
                      <HoverTip text={t("fields.reorder")} className="contents">
                      <span
                        draggable
                        onDragStart={() => setDragId(service._id)}
                        onDragEnd={() => setDragId(null)}
                        aria-label={t("fields.reorder")}
                        className="hidden shrink-0 cursor-grab select-none text-[var(--muted-strong)] hover:text-[var(--foreground)] active:cursor-grabbing sm:inline-flex"
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
                      </HoverTip>
                    )}
                    <span className="min-w-0 flex-1">
                      <InlineEditValue
                        value={service.name}
                        onSave={(next) =>
                          next && update({ serviceId: service._id, name: next })
                        }
                      />
                    </span>
                  </span>
                  {/* EMPTY for a good, unless one has a lead time set. The
                      column asks "how long", and a product has no answer — it
                      is handed over. It used to fall back to a lead-time
                      editor for every good, so a shampoo advertised "— days
                      ahead" in the duration column: a unit qualifying nothing,
                      under a header naming something else, in a cell most
                      products will never fill.

                      A good that DOES need warning still shows and edits its
                      days here, because that is a real fact about the row and
                      hiding it would strand it. Setting one for the first time
                      belongs to the create form, which already asks.

                      Clearing a duration turns a service into a good; there is
                      deliberately no inline way back, because a good's row no
                      longer edits minutes — recreate it. */}
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
                    ) : service.leadMinutes !== undefined ? (
                      <>
                        <InlineEditValue
                          value={String(service.leadMinutes / 1440)}
                          type="number"
                          compact
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
                    ) : null}
                  </span>
                  {/* Same shape as duration — a number with its unit trailing.
                      Blank means unpriced, and clearing the box says so rather
                      than writing a zero, because zero is a real price a salon
                      might charge and "I haven't decided" is not it. */}
                  <span className="flex items-center gap-0.5 whitespace-nowrap max-sm:col-start-2 max-sm:row-start-2">
                    <InlineEditValue
                      value={moneyInputValue(service.price, currency, language, priceDecimals)}
                      type="number"
                      compact
                      onSave={(next) =>
                        update({
                          serviceId: service._id,
                          price: parseMoney(next, currency, language) ?? null,
                        })
                      }
                    />
                    {/* Same rule: a lone "₺" beside an empty box is a price
                        that failed rather than a price nobody set. */}
                    {service.price !== undefined && (
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {currencySymbol(currency, language)}
                      </span>
                    )}
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
                        switch carries the word as aria-label, so the name is
                        still there for anyone not reading the colour. */}
                    <CheckSwitch
                      on={service.active}
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
                  <HoverTip text={t("common.delete")} className="contents">
                  <button
                    onClick={() => {
                      void (async () => {
                        const ok = await confirm({
                          title: t("services.deleteConfirm", { name: service.name }),
                        });
                        if (!ok) return;
                        setError(null);
                        await remove({ serviceId: service._id }).catch((err) =>
                          setError(serviceErrorText(err, t)),
                        );
                      })();
                    }}
                    aria-label={`${service.name} — ${t("common.delete")}`}
                    data-edit-only
                    className="flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-[var(--muted)] opacity-0 transition-colors transition-opacity hover:bg-[var(--muted-bg)] hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:text-red-400 max-sm:absolute max-sm:right-0 max-sm:top-0.5 sm:justify-self-end [@media(hover:none)]:opacity-100"
                  >
                    ×
                  </button>
                  </HoverTip>
                </li>
              ))}
            </ul>

    </div>
  );

  return (
    <div className="space-y-2">
      <Card
        title={t("services.title")}
        tip={t("services.hint")}
        disabled={!isOwner}
        action={
          isOwner ? (
            <button
              type="button"
              onClick={() => setAdding("service")}
              className="card-action"
            >
              {t("services.add")}
            </button>
          ) : undefined
        }
      >
        {services === undefined ? (
          <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
        ) : (
          serviceList(timed)
        )}
      </Card>
      {/* Only when the salon actually sells something. An empty Products card
          is a heading over a sentence saying there is nothing under it, on a
          page most salons will never put a product on.

          It has its OWN Add product now (Serdar, 2026-08-21). The old note
          here argued a second button would be "a second door onto one form",
          which was right while the sheet asked Type as its first question and
          one shared button sat above both cards. Two buttons in two card
          headers is a different shape: the gesture answers Type, so the sheet
          opens already on the right kind instead of asking a question the
          click just answered. The switch stays for a mistake. */}
      {goods.length > 0 && (
        <Card
          title={t("services.products")}
          tip={t("services.productsHint")}
          disabled={!isOwner}
          action={
            isOwner ? (
              <button
                type="button"
                onClick={() => setAdding("good")}
                className="card-action"
              >
                {t("services.addProduct")}
              </button>
            ) : undefined
          }
        >
          {serviceList(goods, true)}
        </Card>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {confirmDialog}
      {adding && (
        <NewServiceSheet initialKind={adding} onClose={() => setAdding(null)} />
      )}
    </div>
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
  const usedByText = t("fields.usedByAgents", { agents: agents.join(", ") });
  return (
    <>
      <tr
        className={`group border-t border-[var(--border)] transition-colors hover:bg-[var(--muted-bg)] ${dragging ? "opacity-40" : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <td className="pl-0.5 text-[var(--muted-strong)]">
          <HoverTip text={t("fields.reorder")} className="contents">
          <span
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
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
          </HoverTip>
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
                ? t("fields.deleteInUse", { agents: agents.join(", ") })
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
                {t("fields.optionsFor", { name: field.label })}
              </div>
              <TagPillsEditor
                values={field.options ?? []}
                onChange={onSetOptions}
                copy={{
                  add: t("fields.addOption"),
                  placeholder: t("fields.optionPlaceholder"),
                  remove: (option) => t("fields.removeOption", { option }),
                }}
              />
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
    // Titled, under a tab of the same name — which is the one case the "a strip
    // naming a section means the page must not name it again" rule forbids, and
    // it is kept deliberately for the reason that rule itself names: deleting
    // the heading deletes the (i), and this (i) is the only place the product
    // explains what a contact field IS. That sentence is worth more to a salon
    // owner than the repetition costs. Moved from the Voice agent's strip to
    // the Customers strip on 2026-08-25; see CustomersView's header for why.
    <Card
      title={t("fields.title")}
      tip={t("fields.hint")}
      disabled={!isOwner}
      // Top right, filled, same as Team's Add member and Voice agent's Add
      // agent. It was a ghost button at the FOOT of the table — the card's one
      // primary action, wearing the treatment this design language reserves
      // for secondary controls, parked below however many fields the salon has
      // collected.
      //
      // Still hidden while the form is open, which is what it always did. The
      // Card header carries min-h-8, so it going away moves nothing.
      action={
        isOwner && !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="card-action"
          >
            {t("fields.add")}
          </button>
        ) : undefined
      }
    >
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
                    // Read once. It was recomputed four times inline, and the
                    // title branch was keyed the wrong way round against the
                    // other three: a locked field read "Locked", in muted
                    // styling, with the tooltip "The voice agent can write this
                    // field. Click to lock it." — contradicting its own label,
                    // its own colour, and what the click actually did. The
                    // org-field chip 150 lines above keys all three on `voice`,
                    // the inverse, and agrees with itself; this copy did not.
                    (() => {
                      const locked = (identityLocks ?? []).includes(field.key);
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            void setIdentityLock({ key: field.key, locked: !locked })
                          }
                          title={t(locked ? "fields.lockHint" : "fields.unlockHint")}
                          className={
                            locked
                              ? "rounded px-1.5 py-0.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                              : "rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100"
                          }
                        >
                          {t(locked ? "fields.source.manual" : "fields.source.voice")}
                        </button>
                      );
                    })()
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
                      title: t("fields.deleteConfirm", { name: field.label }),
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

      {/* Adding appears on demand: a permanently open form charged this card
          a row of empty inputs on every visit for a task done a few times a
          year. The trigger is the Card's header action above. */}
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
            {/* The shared segmented control (this picker is where it was
                first lifted from). */}
            <div className="mt-1">
              <SegmentedControl
                labelledBy={sourceLabelId}
                value={source}
                onChange={setSource}
                segments={FIELD_SOURCES.map((option) => ({
                  id: option.id,
                  label: t(option.key),
                }))}
              />
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
//
// Drag, name, available, email, access, menu. Email is its own COLUMN above
// sm (Serdar, 2026-08-31) rather than trailing the name: two facts sharing a
// cell gave every row a different name width and the eye nothing to scan
// down. Available sits second, right after the name, because open-or-not is
// the fact the owner checks most. Below sm the grid is off and email rides
// with the name again — a phone row has no columns to keep aligned.
const ROSTER_ROW =
  "sm:grid sm:grid-cols-[1rem_minmax(0,1fr)_5rem_minmax(0,1fr)_minmax(0,9rem)_1.75rem] sm:items-center sm:gap-3";

const ACCESS_REMOVE = "remove";

// The OTHER card's third value. ACCESS_REMOVE above is an ACTION on somebody
// who is here ("remove access"); this is a STATE somebody can be in ("no
// login"), because a person can sit in another business's list having never
// been given anything. Two words, two strings.
const ACCESS_NONE = "none";

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
  // Who holds which calendar colour, for the picker's greyed swatches: every
  // ACTIVE bookable person's resolved colour, so a colour nobody chose but
  // somebody was given still counts as taken. A deactivated person's does
  // not (lib/staffColors.ts).
  const colorHolders = new Map<string, { staffId: string; name: string }>();
  for (const row of roster) {
    if (row.staffId && row.color && row.active) {
      colorHolders.set(row.color, { staffId: row.staffId, name: row.name });
    }
  }
  const takenFor = (staffId: string) =>
    new Map(
      [...colorHolders.entries()]
        .filter(([, holder]) => holder.staffId !== staffId)
        .map(([key, holder]) => [key, holder.name]),
    );
  const accessLabel = (value: string) =>
    value === "owner"
      ? t("role.owner")
      : value === "staff"
        ? t("role.staff")
        : t("roster.removeAccess");

  return (
    <>
    <Card
      title={t("staff.title")}
      tip={t("roster.hint")}
      disabled={!isOwner}
      // A button, not a pair of empty inputs living at the foot of the list
      // forever. Adding somebody is a twice-a-year job and it should not
      // charge rent on every visit.
      //
      // Top right of the card, which is where Add agent, Add message and Add
      // customer all sit. This one sat at the FOOT of the roster, so on a
      // salon with a dozen chairs the page's primary action moved down the
      // screen as the team grew, and it was the only add button in the
      // product you had to scroll a list to reach.
      //
      // Gated on isOwner here rather than by the fieldset: a Card's action
      // renders outside it.
      action={
        isOwner ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="card-action"
          >
            {t("roster.add")}
          </button>
        ) : undefined
      }
    >
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
          <span>{t("roster.email")}</span>
          <span>{t("roster.access")}</span>
        </div>

        {/* One rule under the header, none between rows: three short rows
            don't need fences, and the aligned columns already carry the eye
            across. */}
        <ul className="border-t border-[var(--border)]">
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

              {/* The person's calendar colour before their name, the dot the
                  calendar's bookings wear (Nudge picks a host's colour from
                  the same spot; a colour COLUMN was tried there first and
                  squeezed the name onto two lines). Only a bookable person
                  has one: a login with no staff row never appears on the
                  calendar, and gets the dot's width blank so names align. */}
              <span className="flex min-w-0 items-center gap-1.5">
              {row.staffId && row.color ? (
                <StaffColorPicker
                  staffId={row.staffId}
                  name={row.name}
                  color={row.color}
                  taken={takenFor(row.staffId)}
                  readOnly={!isOwner}
                />
              ) : (
                <span aria-hidden className="h-6 w-6 shrink-0" />
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
                {/* Below sm only — above it the email has its own column. */}
                {row.email && (
                  <span className="truncate text-xs text-[var(--muted)] sm:hidden">
                    {row.email}
                  </span>
                )}
                {row.isMe && (
                  <span className="text-xs text-[var(--muted)]">({t("team.you")})</span>
                )}
              </span>
              </span>

              {/* Deactivated, never deleted: whoever left still did last
                  month's work and those appointments must keep a name.

                  CheckSwitch, not the iOS Toggle, because this is a boolean
                  CELL under a column header — the same case the Services
                  table's Active column solves the same way, twelve hundred
                  lines up. It was the last table in the app still using the
                  settings-row control, which put a stack of switches down a
                  page that already has four of them above it. */}
              <CheckSwitch
                on={Boolean(row.staffId && row.active)}
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

              {/* The email column's cell, rendered empty for a person without
                  one so the row keeps its shape. Hidden below sm, where the
                  email rides with the name instead. */}
              <span className="hidden truncate text-xs text-[var(--muted)] sm:block">
                {row.email}
              </span>

              {row.userId ? (
                <InlineEditValue
                  compact
                  // The picklist's blank row is for CLEARING a value, and
                  // access is never blank — everybody with a login holds one
                  // of these three. It shipped on by default, and the empty
                  // row read as a fourth choice whose meaning you could only
                  // learn by picking it: it fell through the ternary below and
                  // silently demoted an admin to member.
                  clearable={false}
                  value={row.role ?? "staff"}
                  options={["owner", "staff", ACCESS_REMOVE]}
                  labelFor={accessLabel}
                  // Explicit about all three rather than "owner or else
                  // staff". A value this control cannot produce should do
                  // NOTHING; the fallback turned every such value into a
                  // demotion, which is why the blank row was able to cost
                  // somebody their access.
                  onSave={(next) => {
                    if (next === ACCESS_REMOVE) {
                      return guard(() => removeMember({ userId: row.userId! }));
                    }
                    if (next !== "owner" && next !== "staff") return;
                    return guard(() => setRole({ userId: row.userId!, role: next }));
                  }}
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
                  label={t("roster.deactivate", { name: row.name })}
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
              {/* Indented by the colour dot's width and gap, so an invite's
                  address starts where the names above it do. */}
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 pl-[1.875rem]">
                <span className="truncate text-[var(--muted)]">{pendingInvite.email}</span>
                <span className="text-xs text-[var(--muted)]">
                  {t("team.pending")} ·{" "}
                  {pendingInvite.role === "staff" ? t("role.staff") : t("role.owner")}
                </span>
              </span>
              {/* Available and email cells, empty: the email above IS the
                  invite's identity, so the column would only repeat it. */}
              <span />
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

        {/* Former members, folded into the card that answers "who works
            here" — they are its history, not a second population deserving a
            card of their own. Only when there is somebody in it: an
            always-present "Deactivated (0)" is a permanent reminder of a state
            most salons never use.

            Alone on this line now that Add member has gone to the header. It
            keeps the foot of the card because it is history, and history reads
            under the list it belongs to. */}
        {deactivated.length > 0 && (
          <div className="flex">
            <button
              type="button"
              onClick={() => setShowDeactivated((open) => !open)}
              aria-expanded={showDeactivated}
              title={t("roster.deactivatedHint")}
              className="rounded-lg px-2 py-1 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            >
              {`${t("roster.deactivatedTitle")} (${deactivated.length})`}{" "}
              {showDeactivated ? "▾" : "▸"}
            </button>
          </div>
        )}

        {showDeactivated && deactivated.length > 0 && (
          // One name per line, its two actions right beside it. Former
          // members are history, not a roster — no columns, no fences, no
          // hover states (Serdar, 2026-08-31, after two rounds of trying to
          // make them a table).
          <div className="flex flex-col items-start gap-1 pt-1">
            {deactivated.map((row) => (
              <span key={row.key} className="flex items-center text-sm text-[var(--muted)]">
                <span className="truncate">{row.name}</span>
                <ActionTip
                  label={t("roster.restore", { name: row.name })}
                  onClick={() =>
                    void guard(() => setActive({ staffId: row.staffId!, active: true }))
                  }
                >
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
                    <path d="M12 19V5" />
                    <path d="m5 12 7-7 7 7" />
                  </svg>
                </ActionTip>
                {/* The one place a member is destroyed. The confirmation says
                    what history it costs, because that part can't be taken
                    back. */}
                <ActionTip
                  label={t(
                    row.hasAppointments ? "roster.removeWithHistory" : "roster.remove",
                    { name: row.name },
                  )}
                  multiline
                  onClick={() => {
                    void (async () => {
                      const ok = await confirm({
                        title: t("roster.remove", { name: row.name }),
                        body: row.hasAppointments
                          ? t("roster.removeWithHistory", { name: row.name })
                          : undefined,
                      });
                      if (!ok) return;
                      await guard(() => removeStaff({ staffId: row.staffId! }));
                    })();
                  }}
                  className="hover:text-red-600"
                >
                  ✕
                </ActionTip>
              </span>
            ))}
          </div>
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

    {confirmDialog}
    </>
  );
}

// The OTHER businesses this owner runs, and which of this team can get into
// them. The Team card above answers "who works here"; this one answers the
// question a two-shop owner asks straight after it — "and who can get into the
// other one" — which until now could only be answered by switching workspaces
// and reading a second Team card.
//
// It lists BUSINESSES and not people, because the change you come here to make
// is per business ("Merve now covers the second shop"), and because a card
// listing people would duplicate the one directly above it.
//
// Only for owners, and only when there IS another business: one salon has
// nothing to share with, and a card that renders empty for the majority of
// accounts is a permanent reminder of a feature they do not use. It sits at
// the foot of the page for the same reason — it is the rarest thing on it.
//
// People with no login are absent by construction. A bookable name with no
// account is a row on this org's rota; there is nothing to grant them
// elsewhere, and copying the rota into another business is a different feature
// (that one wants their hours and their services too).
function OtherBusinessesCard({
  isOwner,
  ref,
}: {
  isOwner: boolean;
  // The page scrolls here when a search hit names this card.
  ref?: Ref<HTMLDivElement>;
}) {
  const { t } = useLanguage();
  // Skipped rather than rendered-and-ignored for staff: both queries are
  // owner-only on the server, so a staff session would spend two failing
  // subscriptions to draw nothing.
  const others = useQuery(api.team.sharedAccess, isOwner ? {} : "skip");
  const team = useQuery(api.team.overview, isOwner ? {} : "skip");
  const setAccess = useMutation(api.team.setAccessElsewhere);
  const [open, setOpen] = useState<Id<"orgs"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOwner || others === undefined || team === undefined) return null;
  if (others.length === 0) return null;

  // Myself excluded: I am an owner of every business in this list — that is
  // what put it in the list — so my row would read "Yönetici" on every one of
  // them and its only working state would be resigning from a shop I run.
  // Leaving is a decision, not a checkbox in a sharing card.
  const people = team.members.filter((member) => !member.isMe);
  const nameOf = (member: (typeof team.members)[number]) =>
    member.name?.trim() || member.email || "";

  const accessLabel = (value: string) =>
    value === "owner"
      ? t("role.owner")
      : value === "staff"
        ? t("role.staff")
        : t("roster.noAccess");

  return (
    <div ref={ref}>
    <Card title={t("share.title")} tip={t("share.hint")} disabled={!isOwner}>
      <div className="space-y-1">
        {others.map((business) => {
          const roles = new Map(
            business.shared.map((row) => [row.userId as string, row.role]),
          );
          const shared = people.filter((member) => roles.has(member._id as string));
          const expanded = open === business.orgId;
          return (
            <div key={business.orgId}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : business.orgId)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--row-hover-bg)]"
              >
                <span className="min-w-0 shrink-0 truncate text-sm font-medium">
                  {business.name}
                </span>
                {/* Who is already in there, by NAME rather than as a count.
                    "2 kişi" sends you into the list to find out which two,
                    which is the click this line exists to save. */}
                <span className="min-w-0 flex-1 truncate text-right text-xs text-[var(--muted)]">
                  {shared.length > 0
                    ? shared.map(nameOf).join(", ")
                    : t("share.nobody")}
                </span>
                <span className="shrink-0 text-sm text-[var(--muted)]">
                  {expanded ? "▾" : "▸"}
                </span>
              </button>

              {expanded && (
                <div className="space-y-0.5 pb-2 pl-2">
                  {people.length === 0 ? (
                    <p className="px-2 text-xs text-[var(--muted)]">
                      {t("share.noTeam")}
                    </p>
                  ) : (
                    people.map((member) => (
                      <div
                        key={member._id}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] items-center gap-3"
                      >
                        <span className="min-w-0 truncate px-2 text-sm">
                          {nameOf(member)}
                        </span>
                        {/* The same inline picklist the Team card uses, with
                            the same three values, so one control means one
                            thing on both. clearable={false} because "no
                            access" is already one of the three — a blank row
                            here would be a fourth option meaning nothing. */}
                        <InlineEditValue
                          compact
                          clearable={false}
                          value={roles.get(member._id as string) ?? ACCESS_NONE}
                          options={["owner", "staff", ACCESS_NONE]}
                          labelFor={accessLabel}
                          onSave={async (next) => {
                            setError(null);
                            try {
                              await setAccess({
                                orgId: business.orgId,
                                userId: member._id,
                                role:
                                  next === "owner"
                                    ? "owner"
                                    : next === "staff"
                                      ? "staff"
                                      : null,
                              });
                            } catch (err) {
                              const reason =
                                err instanceof Error ? err.message : "error";
                              setError(
                                reason.includes("last-admin")
                                  ? t("roster.lastAdmin")
                                  : reason,
                              );
                            }
                          }}
                        />
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="pt-2 text-xs text-[var(--now-line)]">{error}</p>}
    </Card>
    </div>
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
      title={t("roster.grantLogin", { name })}
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
