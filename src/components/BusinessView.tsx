"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { LANGUAGES, type TranslationKey } from "@/lib/i18n";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  currencySymbol,
  moneyInputValue,
  parseMoney,
} from "@/lib/money";
import { Card } from "./Card";
import { Sheet } from "./Sheet";
import { Toggle } from "./Toggle";
import { ROW_GRID, RowLabel } from "./RowLabel";
import { FieldGroup, InlineEditValue } from "./RecordField";

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
type Section = "business" | "people" | "activity";

const SECTIONS: { id: Section; key: TranslationKey }[] = [
  { id: "business", key: "settings.business" },
  { id: "people", key: "staff.title" },
  { id: "activity", key: "activity.title" },
];

function SectionChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1 text-sm transition-colors ${
        active
          ? "bg-[var(--accent)] font-medium text-[var(--accent-fg)]"
          : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
      }`}
    >
      {label}
    </button>
  );
}

export function BusinessView() {
  const { t } = useLanguage();
  const [section, setSection] = useState<Section>("business");
  const settings = useQuery(api.orgs.current, {});
  if (!settings) return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  // The backend enforces this too (requireOwner); the fieldsets are honest UI.
  const isOwner = settings.me.role !== "staff";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-1">
        {SECTIONS.map((entry) => (
          <SectionChip
            key={entry.id}
            active={section === entry.id}
            label={t(entry.key)}
            onClick={() => setSection(entry.id)}
          />
        ))}
      </div>

      {!isOwner && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-xs text-[var(--muted)]">
          {t("settings.ownerOnly")}
        </p>
      )}
      {section === "business" && (
        <>
          <DetailsCard isOwner={isOwner} />
          <ServicesCard isOwner={isOwner} />
          <FieldsCard isOwner={isOwner} />
        </>
      )}
      {section === "people" && <PeopleCard isOwner={isOwner} />}
      {section === "activity" && <ActivityCard />}
    </div>
  );
}

// Who did what, newest first. No owner gate: a stylist wondering who moved
// their 14:00 has the same right to the answer as the owner does, and every
// row here describes something that person could already see in the app.
function ActivityCard() {
  const { t, language } = useLanguage();
  const rows = useQuery(api.activity.recent, {});
  const when = new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Card title={t("activity.title")} tip={t("activity.hint")}>
      {rows === undefined ? (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("activity.empty")}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
            // One line per entry: what happened, who it was about, who did it.
            // Stacking these would make a morning's work three screens tall.
            <li key={row._id} className="flex items-baseline gap-3 py-1.5 text-sm">
              <span className="w-28 shrink-0 text-xs tabular-nums text-[var(--muted)]">
                {when.format(row.at)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {ACTIVITY_LABELS[row.kind] ? t(ACTIVITY_LABELS[row.kind]) : row.kind}
                {row.customerName && (
                  <span className="text-[var(--muted)]"> · {row.customerName}</span>
                )}
                {row.detail && (
                  <span className="text-[var(--muted)]"> · {row.detail}</span>
                )}
              </span>
              <span className="shrink-0 text-xs text-[var(--muted)]">
                {row.actor ?? t("activity.system")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Explicit rather than a template cast: translate() throws on a key it does
// not hold, so building the key from the kind string would turn one entry
// written by a newer deploy than this bundle into a blank card. Unknown kinds
// fall through to the raw value, which is ugly and readable and does not take
// the rest of the history down with it.
const ACTIVITY_LABELS: Record<string, TranslationKey> = {
  appointment_created: "activity.appointment_created",
  appointment_status: "activity.appointment_status",
  appointment_moved: "activity.appointment_moved",
  appointment_deleted: "activity.appointment_deleted",
  customer_created: "activity.customer_created",
  customer_deleted: "activity.customer_deleted",
  settings_changed: "activity.settings_changed",
  member_invited: "activity.member_invited",
  member_removed: "activity.member_removed",
  whatsapp_connected: "activity.whatsapp_connected",
};

// Rows use the shared ROW_GRID from RowLabel, the same string SettingsView and
// AccountView import: the three surfaces must line up when you flip between
// them, which they stop doing the moment the string exists in three places.

const TIMEZONES = [
  "Europe/Istanbul",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/London",
  "UTC",
];

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
    `<iframe src="${src}" style="width:100%;border:0" height="620" title="Randevu"></iframe>`,
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

// Name, timezone, language, sender address. This used to be Settings' first
// chip, which put the business's own identity behind a page about
// connections. It is not a connection, so it leads here instead.
function DetailsCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const update = useMutation(api.orgs.update);
  const enableForm = useMutation(api.forms.enable);
  // Read at render rather than baked in: the same deployment serves localhost
  // and the real domain, and a hardcoded host would hand the salon a link that
  // works for nobody but whoever built it.
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <Card title={t("settings.business")} disabled={!isOwner}>
      {settings === undefined ? (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      ) : (
        <div className={ROW_GRID}>
          <RowLabel label={t("settings.businessName")} />
          <input
            defaultValue={settings.org.name}
            onBlur={(e) => void update({ name: e.target.value })}
          />
          <RowLabel label={t("settings.timezone")} />
          <select
            defaultValue={settings.org.timezone}
            onChange={(e) => void update({ timezone: e.target.value })}
          >
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
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
            <input
              defaultValue={settings.org.inboundAddress ?? ""}
              placeholder="guzellik"
              onBlur={(e) => void update({ inboundAddress: e.target.value })}
            />
            <span className="shrink-0 text-sm text-[var(--muted)]">
              {settings.org.inboundDomain
                ? `@${settings.org.inboundDomain}`
                : t("settings.inboundNoDomain")}
            </span>
          </span>
          <RowLabel label={t("settings.emailFrom")} hint={t("settings.emailFromHint")} />
          <input
            defaultValue={settings.org.emailFrom ?? ""}
            placeholder="info@salonunuz.com"
            onBlur={(e) => void update({ emailFrom: e.target.value })}
          />
          <RowLabel label={t("settings.language")} />
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

// Header and rows share one template, and it only becomes a grid at sm. The
// four fixed columns add up to ~264px, which on a 390px phone left about 60px
// for the service name: the exact anti-pattern the design language names.
// Below sm the row is a wrapping flex line instead, name on its own row.
const SERVICE_ROW_GRID =
  "sm:grid sm:grid-cols-[1fr_7rem_7rem_4rem_4rem] sm:items-center sm:gap-2";

// Services are what the salon sells, and the duration is what sizes the block
// on the calendar, so an empty list is not a cosmetic gap: bookings have
// nothing to pick and every appointment falls back to 30 minutes.
function ServicesCard({ isOwner }: { isOwner: boolean }) {
  const { t, language } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const currency = settings?.org.currency ?? DEFAULT_CURRENCY;
  const services = useQuery(api.services.list, {});
  const create = useMutation(api.services.create);
  const update = useMutation(api.services.update);
  const remove = useMutation(api.services.remove);
  const [adding, setAdding] = useState(false);

  const rows = [...(services ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  // Staff cannot add a service, so an empty list for them is a heading, an (i)
  // and an empty fieldset. Nothing to read and nothing to do: render nothing.
  if (!isOwner && services !== undefined && rows.length === 0) return null;

  return (
    <Card title={t("services.title")} tip={t("services.hint")} disabled={!isOwner}>
      {services === undefined ? (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      ) : (
        <div className="space-y-2">
          {rows.length > 0 && (
            // Column headers label their columns, so a row of toggles is never
            // an unlabelled switch. They only exist where the columns actually
            // sit side by side; below sm the row stacks and each value carries
            // its own label instead.
            <div className={`hidden px-1 text-xs text-[var(--muted)] ${SERVICE_ROW_GRID}`}>
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
                className={`group flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm ${SERVICE_ROW_GRID}`}
              >
                {/* Full width on a phone, so the name is not fighting 264px of
                    fixed columns for the 60px that is left. */}
                <span className="w-full min-w-0 sm:w-auto">
                  <InlineEditValue
                    value={service.name}
                    onSave={(next) =>
                      next && update({ serviceId: service._id, name: next })
                    }
                  />
                </span>
                <span className="flex items-center gap-0.5">
                  <InlineEditValue
                    value={String(service.durationMinutes)}
                    type="number"
                    compact
                    onSave={(next) =>
                      Number(next) > 0 &&
                      update({ serviceId: service._id, durationMinutes: Number(next) })
                    }
                  />
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {t("services.minutes")}
                  </span>
                </span>
                {/* Same shape as duration — a number with its unit trailing.
                    Blank means unpriced, and clearing the box says so rather
                    than writing a zero, because zero is a real price a salon
                    might charge and "I haven't decided" is not it. */}
                <span className="flex items-center gap-0.5">
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
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-[var(--muted)] sm:hidden">
                    {t("services.active")}
                  </span>
                  <Toggle
                    checked={service.active}
                    label={t("services.active")}
                    onChange={(next) =>
                      void update({ serviceId: service._id, active: next })
                    }
                  />
                </span>
                {/* Hover reveal is a desktop idea. A phone has no hover, so the
                    button stays visible there rather than being unreachable. */}
                <button
                  onClick={() => void remove({ serviceId: service._id })}
                  className="ml-auto rounded-md px-2 py-1 text-xs text-red-600 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 dark:text-red-400 sm:ml-0 sm:justify-self-end [@media(hover:none)]:opacity-100"
                >
                  {t("common.delete")}
                </button>
              </li>
            ))}
          </ul>

          {/* Inline row, not a modal: click add, type, Enter saves. */}
          {adding ? (
            <form
              className="flex flex-wrap items-end gap-2 pt-1"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const name = String(form.get("name") ?? "").trim();
                if (!name) return setAdding(false);
                const price = parseMoney(
                  String(form.get("price") ?? ""),
                  currency,
                  language,
                );
                await create({
                  name,
                  durationMinutes: Number(form.get("durationMinutes")) || 30,
                  ...(price !== undefined ? { price } : {}),
                });
                setAdding(false);
              }}
            >
              <label className="block text-sm">
                {t("services.name")}
                <input name="name" required autoFocus className="mt-1 block w-56" />
              </label>
              <label className="block text-sm">
                {t("services.duration")}
                <input
                  name="durationMinutes"
                  type="number"
                  min={5}
                  step={5}
                  defaultValue={30}
                  className="mt-1 block w-24"
                />
              </label>
              <label className="block text-sm">
                {`${t("services.price")} (${currencySymbol(currency, language)})`}
                <input
                  name="price"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={t("common.optional")}
                  className="mt-1 block w-28"
                />
              </label>
              <button
                type="submit"
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
              >
                {t("common.add")}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              >
                {t("common.cancel")}
              </button>
            </form>
          ) : (
            isOwner && (
              <button
                onClick={() => setAdding(true)}
                className="rounded-md px-2 py-1 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              >
                + {t("services.add")}
              </button>
            )
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

// Voice rows carry a third column for the key, so header and rows share one
// template string. Narrower on phones, where 11rem of key would eat the label.
const VOICE_ROW_GRID =
  "grid grid-cols-[1fr_8rem_3.5rem] items-center gap-2 sm:grid-cols-[1fr_11rem_4rem]";

function FieldsCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const fields = useQuery(api.contactFields.list, {});
  const createField = useMutation(api.contactFields.create);
  const removeField = useMutation(api.contactFields.remove);
  const [type, setType] = useState<"text" | "select" | "number" | "date">("text");
  const [source, setSource] = useState<FieldSource>("manual");
  const [error, setError] = useState<string | null>(null);
  // What was copied, not whether something was: add a field after copying and
  // the button has to stop claiming the clipboard holds the current block.
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);
  const sourceLabelId = useId();

  // Unset reads as "manual": fields defined before the voice agent existed are
  // staff-filled by definition.
  const rows = fields ?? [];
  const manualFields = rows.filter((field) => (field.source ?? "manual") === "manual");
  const voiceFields = rows.filter((field) => field.source === "voice");

  const typeSummary = (field: ContactField) =>
    `${t(`fields.type.${field.type}` as "fields.type.text")}${
      field.options?.length ? ` · ${field.options.join(", ")}` : ""
    }`;

  // Marking a field "voice" only sets source: "voice" in this org's data. The
  // Retell agent has no idea the field exists, because Randevu does not write
  // the agent's prompt or its function schema. What Randevu CAN do is generate
  // the exact configuration the owner has to paste in, so the promise the UI
  // makes is one the owner can actually complete.
  //
  // The argument shape mirrors what /retell/functions parses today
  // (convex/http.ts): `phone` falls back to the call's from_number, and the
  // values live under `values` (it also accepts `properties` or `fields`, or
  // bare top-level args, but one documented shape is what the owner needs).
  // Keys that are not a contactFields row in this org are ignored by
  // retell.applyVoiceContactValues, so the key list IS the permission model.
  const voiceSetupBlock = [
    "update_contact",
    "",
    "{",
    '  "phone": "+905551112233",',
    '  "values": {',
    ...voiceFields.map(
      (field, index) =>
        `    "${field.key}": ""${index < voiceFields.length - 1 ? "," : ""}`,
    ),
    "  }",
    "}",
    "",
    t("fields.voiceSetupFields"),
    ...voiceFields.map((field) => `${field.key}: ${field.label} (${typeSummary(field)})`),
  ].join("\n");

  // Staff cannot add a field, so an empty list for them is a heading, an (i)
  // and an empty fieldset. Don't render the frame.
  if (!isOwner && fields !== undefined && rows.length === 0) return null;

  const deleteButton = (field: ContactField, className: string) =>
    isOwner && (
      <button
        className={`rounded-md px-2 py-1 text-xs text-red-600 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 dark:text-red-400 ${className}`}
        onClick={() => void removeField({ fieldId: field._id })}
      >
        {t("common.delete")}
      </button>
    );

  return (
    <Card title={t("fields.title")} tip={t("fields.hint")} disabled={!isOwner}>
      {/* Staff-filled first, then whatever the agent collects on a call. Each
          group is skipped whole when it is empty rather than left as a heading
          over nothing. */}
      {manualFields.length > 0 && (
        <ul className="mb-3 divide-y divide-[var(--border)]">
          {manualFields.map((field) => (
            <li key={field._id} className="group flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{field.label}</span>
                <span className="ml-2 text-xs text-[var(--muted)]">
                  {typeSummary(field)}
                </span>
              </span>
              {deleteButton(field, "")}
            </li>
          ))}
        </ul>
      )}

      {voiceFields.length > 0 && (
        <div className="mb-3">
          {/* One (i) for the group. It used to sit on every row, so six voice
              fields stacked six identical icons carrying the same two
              sentences down the column. */}
          <FieldGroup label={t("fields.voiceGroup")} hint={t("fields.voiceHint")} />
          {/* The key is what the owner pastes into Retell's update_contact
              config, so it is a real column with a real label, not a
              decoration on the end of the row. */}
          <div className={`${VOICE_ROW_GRID} pt-2 text-xs text-[var(--muted)]`}>
            <span>{t("fields.label")}</span>
            <span>{t("fields.key")}</span>
            <span />
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {voiceFields.map((field) => (
              <li key={field._id} className={`group py-2 text-sm ${VOICE_ROW_GRID}`}>
                <span className="min-w-0">
                  <span className="font-medium">{field.label}</span>
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {typeSummary(field)}
                  </span>
                </span>
                <span className="flex min-w-0 items-center">
                  <code className="min-w-0 overflow-x-auto rounded bg-[var(--muted-bg)] px-1.5 py-0.5 font-mono text-xs text-[var(--muted)]">
                    {field.key}
                  </code>
                </span>
                {deleteButton(field, "justify-self-end")}
              </li>
            ))}
          </ul>

          {/* The half of the setup Randevu cannot do for you, generated from
              your own fields so there is nothing left to translate by hand. */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm font-medium">{t("fields.voiceSetup")}</span>
            <span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(voiceSetupBlock);
                setCopiedBlock(voiceSetupBlock);
              }}
              className="rounded-md px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            >
              {copiedBlock === voiceSetupBlock ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--foreground)]">
            {voiceSetupBlock}
          </pre>
        </div>
      )}

      {isOwner && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const formEl = event.currentTarget;
            const form = new FormData(formEl);
            setError(null);
            try {
              await createField({
                label: String(form.get("label") ?? ""),
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
            } catch (err) {
              setError(err instanceof Error ? err.message : "error");
            }
          }}
        >
          <label className="block text-sm">
            {t("fields.label")}
            <input name="label" required className="mt-1 block w-44" />
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
  "sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_minmax(0,9rem)] sm:items-center sm:gap-3";

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
  const settings = useQuery(api.orgs.current, {});
  const revokeInvite = useMutation(api.team.revokeInvite);
  const setRole = useMutation(api.team.setRole);
  const removeMember = useMutation(api.team.removeMember);
  const linkStaff = useMutation(api.team.linkStaff);
  const addStaff = useMutation(api.staff.add);
  const renameStaff = useMutation(api.staff.rename);
  const setActive = useMutation(api.staff.setActive);
  const updateOrg = useMutation(api.orgs.update);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The backend refuses to strip the last admin; this turns that into a
  // sentence instead of a raw error string.
  const guard = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
    } catch (err) {
      const reason = err instanceof Error ? err.message : "error";
      setError(reason.includes("last-admin") ? t("roster.lastAdmin") : reason);
    }
  };

  if (roster === undefined || team === undefined) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }

  // Logins nobody has claimed as a bookable person yet, offered on the rows
  // that have no login so the two halves of one human can be joined up.
  const unclaimed = roster.filter((row) => row.userId && !row.staffId);
  const accessLabel = (value: string) =>
    value === "owner"
      ? t("role.owner")
      : value === "staff"
        ? t("role.staff")
        : t("roster.removeAccess");

  return (
    <Card title={t("staff.title")} tip={t("roster.hint")} disabled={!isOwner}>
      <div className="space-y-3">
        <label className="block text-xs text-[var(--muted)]">
          {t("staff.label")}
          <input
            className="mt-1"
            defaultValue={settings?.org.staffLabel ?? ""}
            placeholder={t("appointments.staff")}
            onBlur={(e) => void updateOrg({ staffLabel: e.target.value })}
          />
        </label>

        <div className={`hidden pb-1 text-xs text-[var(--muted)] sm:block ${ROSTER_ROW}`}>
          <span>{t("roster.person")}</span>
          <span>{t("roster.bookable")}</span>
          <span>{t("roster.access")}</span>
        </div>

        <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {roster.map((row) => (
            <li key={row.key} className={`py-1 text-sm ${ROSTER_ROW}`}>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                {row.staffId ? (
                  <InlineEditValue
                    compact
                    value={row.name}
                    onSave={(next) =>
                      next && renameStaff({ staffId: row.staffId!, name: next })
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
                <InlineEditValue
                  compact
                  value=""
                  placeholder={t("roster.noAccess")}
                  options={unclaimed.map((candidate) => candidate.userId as string)}
                  labelFor={(id) =>
                    unclaimed.find((candidate) => candidate.userId === id)?.email ??
                    t("roster.noAccess")
                  }
                  onSave={(next) =>
                    guard(() =>
                      linkStaff({
                        staffId: row.staffId!,
                        userId: next ? (next as Id<"users">) : null,
                      }),
                    )
                  }
                />
              )}
            </li>
          ))}

          {team.pending.map((pendingInvite) => (
            <li key={pendingInvite._id} className={`py-1 text-sm ${ROSTER_ROW}`}>
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
        <AddPersonSheet
          staffLabel={settings?.org.staffLabel?.trim() || t("appointments.staff")}
          onClose={() => setAdding(false)}
        />
      )}
    </Card>
  );
}

// Two ways to add somebody and they produce different things, so the sheet
// asks which rather than showing both forms at once: a bookable person is a
// staff row, an invite is a login. Offering both fields together would let one
// gesture create two rows for one human, which is the exact confusion the
// merged list exists to remove.
function AddPersonSheet({
  staffLabel,
  onClose,
}: {
  // The org's own word for the person who does the work — "Personel",
  // "Berber", "Stylist". The card above literally asks what they call these
  // people, so inventing a second term here ("bookable person") was jargon
  // sitting next to the answer.
  staffLabel: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const addStaff = useMutation(api.staff.add);
  const invite = useMutation(api.team.invite);
  const [mode, setMode] = useState<"bookable" | "login">("bookable");
  const [error, setError] = useState<string | null>(null);

  return (
    <Sheet title={t("roster.add")} onClose={onClose}>
      <div className="mb-3 inline-flex rounded-lg bg-[var(--muted-bg)] p-0.5 text-sm">
        {(["bookable", "login"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            className={`rounded-md px-3 py-1 transition-colors ${
              mode === option
                ? "bg-[var(--background)] font-medium text-[var(--foreground)]"
                : "text-[var(--muted)]"
            }`}
          >
            {option === "bookable" ? staffLabel : t("team.invite")}
          </button>
        ))}
      </div>

      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError(null);
          try {
            if (mode === "bookable") {
              const name = String(form.get("name") ?? "").trim();
              if (!name) return;
              await addStaff({ name });
            } else {
              await invite({
                email: String(form.get("email") ?? ""),
                role: form.get("role") === "owner" ? "owner" : "staff",
              });
            }
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "error");
          }
        }}
      >
        {/* Both modes are ONE row tall, which is why the role select sits
            beside the email instead of under it. Switching mode must not
            resize the sheet: the buttons you are reaching for would move out
            from under the pointer. */}
        <div className="flex gap-2">
          {mode === "bookable" ? (
            <input name="name" required placeholder={t("staff.namePlaceholder")} />
          ) : (
            <>
              <input
                name="email"
                type="email"
                required
                placeholder="ornek@gmail.com"
                className="min-w-0 flex-1"
              />
              <select name="role" defaultValue="staff" className="w-auto shrink-0">
                <option value="staff">{t("role.staff")}</option>
                <option value="owner">{t("role.owner")}</option>
              </select>
            </>
          )}
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
            {mode === "bookable" ? t("staff.add") : t("team.invite")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
