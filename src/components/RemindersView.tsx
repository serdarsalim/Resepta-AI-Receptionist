"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { type TranslationKey } from "@/lib/i18n";
import {
  formatReminderOffset,
  minutesToTimeValue,
  timeValueToMinutes,
  weekdayNames,
} from "@/lib/datetime";
import { ROW_GRID, RowLabel } from "./RowLabel";
import { Toggle } from "./Toggle";
import { InfoTip } from "./InfoTip";
import { Card } from "./Card";
import { McpCard } from "./McpCard";
import { resolveSiteUrl } from "@/lib/siteUrl";

// Nudge settings conventions: label-left/input-right on the shared RowLabel
// grid (ROW_GRID, defined next to RowLabel itself), autosave on blur/change,
// explanations behind InfoTips.

// Reminder timing is picked from presets — a salon owner taps "1 gün önce",
// never types "24, 2".
const OFFSET_PRESETS = [48, 24, 3, 2, 1];

// The three columns left of the toggle. Stacked on mobile (the row reads as a
// sentence), a grid from sm up (it reads as a table). The header uses the same
// inner grid so the columns line up without a real <table>, which would need
// its own mobile story.
const RULE_COLUMNS =
  "min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-3";

type RuleKind = "confirmation" | "reminder" | "winback";

type TemplateRow = {
  kind: string;
  language: string;
  status: string;
  bodyPreview?: string;
};

// What a rule can actually reach today, mirroring wa.sendAppointmentMessage:
// WhatsApp needs a connected number AND an APPROVED template of this kind;
// email needs a From on the org and a template row carrying body text (Meta
// approval gates the WhatsApp send, not the email).
//
// Resolved against the ORG's language. A customer whose own language differs
// is resolved per send, so no settings table can promise what they'll get —
// this column answers "is this rule wired up at all", which is the question an
// owner staring at a silent reminder actually has.
function ruleChannels(
  kind: RuleKind,
  templates: TemplateRow[],
  language: string,
  waConnected: boolean,
  emailFrom: string | undefined,
  emailLabel: string,
): string[] {
  const template = templates.find((t) => t.kind === kind && t.language === language);
  const channels: string[] = [];
  if (waConnected && template?.status === "approved") channels.push("WhatsApp");
  if (emailFrom && template?.bodyPreview) channels.push(emailLabel);
  return channels;
}

function RuleRow({
  when,
  what,
  channels,
  orgHasChannel,
  enabled,
  onToggle,
  hint,
}: {
  when: React.ReactNode;
  what: string;
  channels: string[];
  // False when the org has connected nothing at all. Then every row would be
  // silent for the same reason, and four identical amber tags carry no more
  // information than one line under the table — so the cell goes quiet and
  // the card says it once. The tag only earns its colour when it tells this
  // row apart from the ones above it.
  orgHasChannel: boolean;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  hint?: string;
}) {
  const { t } = useLanguage();
  // Amber, not red: a rule with nowhere to send is a setup step the owner
  // hasn't finished, not a failure. Same treatment as autoReplyInactive.
  const silent = orgHasChannel && channels.length === 0;
  return (
    <div className="flex items-center gap-3 py-3">
      <div className={RULE_COLUMNS}>
        <span className="flex items-center gap-1.5 text-sm">
          {when}
          {hint && <InfoTip text={hint} />}
        </span>
        <span className="text-sm text-[var(--muted)]">{what}</span>
        <span
          className={`flex items-center gap-1.5 text-xs ${
            silent ? "text-amber-700 dark:text-amber-400" : "text-[var(--muted)]"
          }`}
        >
          {silent && (
            <>
              {t("settings.ruleNoChannel")}
              <InfoTip text={t("settings.ruleNoChannelHint")} />
            </>
          )}
          {!silent &&
            (channels.length > 0 ? (
              channels.join(" · ")
            ) : (
              // Desktop only. Under the Channel header a dash reads as "nothing
              // here"; stacked on mobile there is no header above it and a lone
              // dash is just a stray mark. The amber line below the table
              // already explains the silence, and it explains it once.
              <span className="hidden sm:inline">—</span>
            ))}
        </span>
      </div>
      <Toggle checked={enabled} onChange={onToggle} label={what} />
    </div>
  );
}

// The reminders section as a rules table: one row per automatic message, read
// top to bottom in the order a customer meets them — confirmation at booking,
// reminders counting down, win-back after a no-show. Because offsets are
// stored furthest-first, that ordering falls out of the array as it is.
//
// Storage is still the flat org fields (reminderOffsetsHours + two booleans),
// NOT a notificationRules table. The consequence to know before extending
// this: a number[] cannot express "rule exists but is off", so a reminder
// row's toggle IS add/remove — switching it off drops the offset and the row
// leaves with it. Confirmation and win-back sit on real booleans and toggle
// the way you'd expect. The day per-rule channels or a disabled-but-present
// reminder is wanted, that's when rows become documents — and the real cost of
// that migration isn't the table, it's re-keying appointments.
// reminderSentOffsets from offset-hours to ruleId without breaking the
// double-send guard in reminders.tick.
function NotificationRulesCard({
  isOwner,
  org,
  templates,
  waConnected,
  update,
}: {
  isOwner: boolean;
  org: {
    language: string;
    reminderOffsetsHours: number[];
    sendBookingConfirmation: boolean;
    winbackEnabled: boolean;
    winbackDaysAfter: number;
    quietHoursStart: number;
    quietHoursEnd: number;
    emailFrom?: string;
  };
  templates: TemplateRow[];
  waConnected: boolean;
  update: (args: Record<string, unknown>) => void;
}) {
  const { t, language } = useLanguage();
  const offsets = org.reminderOffsetsHours;
  const unused = OFFSET_PRESETS.filter((h) => !offsets.includes(h));
  const orgHasChannel = waConnected || Boolean(org.emailFrom);

  const channelsFor = (kind: RuleKind) =>
    ruleChannels(
      kind,
      templates,
      org.language,
      waConnected,
      org.emailFrom,
      t("settings.ruleEmail"),
    );

  const setOffsets = (next: number[]) =>
    update({ reminderOffsetsHours: next.sort((a, b) => b - a) });

  // Quiet hours have no UI of their own yet, and a win-back that looks stuck
  // is usually just waiting for the window to open. Say so where it's asked.
  const pad = (h: number) => String(h).padStart(2, "0");
  const winbackHint = `${t("settings.ruleWinbackHint")}\n${t("settings.ruleSendWindow")}: ${pad(
    org.quietHoursStart,
  )}:00–${pad(org.quietHoursEnd)}:00`;

  return (
    <Card disabled={!isOwner}>
      <div className="hidden items-center gap-3 pb-2 sm:flex">
        <div className={RULE_COLUMNS}>
          <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            {t("settings.rulesWhen")}
            <InfoTip text={t("settings.rulesHint")} />
          </span>
          <span className="text-xs text-[var(--muted)]">{t("settings.rulesWhat")}</span>
          <span className="text-xs text-[var(--muted)]">{t("settings.rulesWhere")}</span>
        </div>
        {/* Spacer matching the toggle so the headers sit over their columns. */}
        <span className="w-11" aria-hidden />
      </div>

      <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
        <RuleRow
          when={t("settings.ruleWhenBooked")}
          what={t("settings.ruleConfirmation")}
          channels={channelsFor("confirmation")}
          orgHasChannel={orgHasChannel}
          enabled={org.sendBookingConfirmation}
          onToggle={(next) => update({ sendBookingConfirmation: next })}
        />

        {offsets.map((hours) => (
          <RuleRow
            key={hours}
            when={formatReminderOffset(hours, language)}
            what={t("settings.ruleReminder")}
            channels={channelsFor("reminder")}
            orgHasChannel={orgHasChannel}
            enabled
            onToggle={() => setOffsets(offsets.filter((h) => h !== hours))}
          />
        ))}

        <RuleRow
          when={
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={90}
                className="w-16"
                defaultValue={org.winbackDaysAfter}
                onBlur={(e) => {
                  const days = Number(e.target.value);
                  if (Number.isFinite(days) && days > 0) update({ winbackDaysAfter: days });
                }}
              />
              {t("settings.ruleDaysAfterNoShow")}
            </span>
          }
          what={t("settings.ruleWinback")}
          channels={channelsFor("winback")}
          orgHasChannel={orgHasChannel}
          enabled={org.winbackEnabled}
          onToggle={(next) => update({ winbackEnabled: next })}
          hint={winbackHint}
        />
      </div>

      {unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-3">
          <span className="text-xs text-[var(--muted)]">{t("settings.ruleAdd")}</span>
          {unused.map((hours) => (
            <button
              key={hours}
              type="button"
              onClick={() => setOffsets([...offsets, hours])}
              className="rounded-full px-3 py-1 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            >
              {formatReminderOffset(hours, language)}
            </button>
          ))}
        </div>
      )}

      {!orgHasChannel && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          {t("settings.rulesNoChannel")}
        </p>
      )}
    </Card>
  );
}

// Business hours + the out-of-hours WhatsApp reply. Everything the reply says
// is org data, so this card is the whole configuration surface for it: which
// days, which hours, the link, the number, and an optional override of the
// wording. Weekday names come from Intl (see weekdayNames), not the dictionary.
function AwayReplyCard({
  isOwner,
  org,
  update,
}: {
  isOwner: boolean;
  org: {
    businessHours?: {
      activeDays?: number[];
      startMinute?: number;
      endMinute?: number;
    };
    autoReplyEnabled: boolean;
    autoReplyText?: string;
    bookingUrl?: string;
    publicPhone?: string;
  };
  update: (args: Record<string, unknown>) => void;
}) {
  const { t, language } = useLanguage();
  const days = weekdayNames(language);
  const hours = org.businessHours ?? {};
  const activeDays = hours.activeDays ?? [];

  // Mirrors hasBusinessHours + awayReplyText in the backend: hours must say
  // something, and there must be a link or a number worth sending. Enabled but
  // unconfigured sends nothing at all, and the owner should not have to find
  // that out by a customer not hearing back.
  const hasHours =
    activeDays.length > 0 || hours.startMinute != null || hours.endMinute != null;
  const hasSomethingToSay = Boolean(org.bookingUrl || org.publicPhone || org.autoReplyText);
  const inactive = org.autoReplyEnabled && !(hasHours && hasSomethingToSay);

  const patchHours = (next: Partial<NonNullable<typeof org.businessHours>>) =>
    update({ businessHours: { ...hours, ...next } });

  return (
    <Card disabled={!isOwner}>
      <div className={ROW_GRID}>
        <RowLabel
          label={t("settings.businessHours")}
          hint={t("settings.businessHoursHint")}
        />
        <div className="flex flex-wrap gap-1.5">
          {days.map((label, index) => {
            const active = activeDays.includes(index);
            return (
              <button
                key={index}
                type="button"
                onClick={() =>
                  patchHours({
                    activeDays: active
                      ? activeDays.filter((d) => d !== index)
                      : [...activeDays, index].sort((a, b) => a - b),
                  })
                }
                className={`rounded-full px-3 py-1 text-sm transition-colors ${
                  active
                    ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <RowLabel label={t("settings.openFrom")} />
        <input
          type="time"
          defaultValue={
            hours.startMinute == null ? "" : minutesToTimeValue(hours.startMinute)
          }
          onChange={(e) => patchHours({ startMinute: timeValueToMinutes(e.target.value) })}
        />
        <RowLabel label={t("settings.openTo")} />
        <input
          type="time"
          defaultValue={hours.endMinute == null ? "" : minutesToTimeValue(hours.endMinute)}
          onChange={(e) => patchHours({ endMinute: timeValueToMinutes(e.target.value) })}
        />

        <RowLabel label={t("settings.autoReply")} hint={t("settings.autoReplyHint")} />
        <Toggle
          checked={org.autoReplyEnabled}
          onChange={(next) => update({ autoReplyEnabled: next })}
        />

        <RowLabel label={t("settings.bookingUrl")} hint={t("settings.bookingUrlHint")} />
        <input
          defaultValue={org.bookingUrl ?? ""}
          placeholder="https://cal.com/…"
          onBlur={(e) => update({ bookingUrl: e.target.value })}
        />

        <RowLabel label={t("settings.publicPhone")} />
        <input
          defaultValue={org.publicPhone ?? ""}
          placeholder="+90…"
          onBlur={(e) => update({ publicPhone: e.target.value })}
        />

        <RowLabel
          label={t("settings.autoReplyText")}
          hint={t("settings.autoReplyTextHint")}
        />
        <textarea
          rows={3}
          defaultValue={org.autoReplyText ?? ""}
          onBlur={(e) => update({ autoReplyText: e.target.value })}
        />
      </div>

      {inactive && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          {t("settings.autoReplyInactive")}
        </p>
      )}
    </Card>
  );
}

// The salon's shop phone on the Evolution lane.
//
// Hidden entirely unless the operator has provisioned this org an instance:
// a salon on Cloud only should never meet a QR code for a product nobody sold
// them. The credentials that fetch all this are operator-installed and stay
// server-side; what reaches this component is a picture, a state and a number.
//
// This is the one setup step that CANNOT be done from the admin console,
// because it needs the handset in the salon's hand.
function ShopPhoneCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const statusAction = useAction(api.evolution.status);
  const qrAction = useAction(api.evolution.qr);
  const [status, setStatus] = useState<{
    enabled: boolean;
    connected: boolean;
    state: string;
    number: string | null;
    error: string | null;
  } | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await statusAction({});
    setStatus(next);
    // A completed scan retires the code it was scanned from.
    if (next.connected) setQr(null);
    return next;
  }, [statusAction]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Only while a code is on screen. Evolution's QRs expire in well under a
  // minute, so this is a short window by nature, and polling a salon's
  // settings page forever to watch a phone that is already linked is work
  // nobody asked for.
  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [qr, refresh]);

  if (!status?.enabled) return null;

  const showQr = async () => {
    const result = await qrAction({});
    if (result.connected) {
      void refresh();
      return;
    }
    setQr(result.qr);
  };

  return (
    <Card disabled={!isOwner}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{t("settings.waShopPhone")}</span>
        {status.connected ? (
          <>
            <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {t("settings.waConnected")}
            </span>
            {/* The number matters as much as the state: it is how somebody
                notices they linked their own phone instead of the shop's. */}
            <span className="text-[var(--muted)]">{status.number ?? "—"}</span>
          </>
        ) : (
          <>
            <span className="text-[var(--muted)]">{t("settings.waNotLinked")}</span>
            <button
              type="button"
              onClick={() => void showQr()}
              className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
            >
              {t("settings.waLinkPhone")}
            </button>
          </>
        )}
      </div>
      {qr && !status.connected && (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI
              from the Evolution server, not an asset next/image can optimise */}
          <img src={qr} alt="" width={192} height={192} className="rounded-lg bg-white p-2" />
          <div className="text-xs text-[var(--muted)]">
            <p>{t("settings.waScanHint")}</p>
            <p className="mt-1">{t("settings.waWaitingScan")}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

// Settings holds the connections and the sending rules, nothing else. What the
// business IS (its name, timezone, language, team, services, contact fields)
// lives next door in Business, its own sidebar destination. The business's own
// identity was the first chip here and it never belonged: a name and a
// timezone are not a connection.
//
// Sections rather than one long scroll of cards.
// Voice moved to its own sidebar tab (it is work, not configuration), and
// bookings moved to the operator's admin console — cal.com keys are installed
// for the client, not by them. What remains is genuinely the salon's to touch.
type Section = "reminders" | "whatsapp" | "ai";

const SECTIONS: { id: Section; key: TranslationKey }[] = [
  { id: "reminders", key: "settings.reminders" },
  { id: "whatsapp", key: "settings.whatsapp" },
  { id: "ai", key: "settings.ai" },
];

// Active section is a solid accent fill; the rest are text + hover wash. No
// border on either state — borders belong to containers, not buttons.
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

const SECTION_STORAGE_KEY = "randevu.settings-section";

export function SettingsView() {
  const { t } = useLanguage();
  const [section, setSectionState] = useState<Section>("reminders");

  // Same deal as the main tabs in AppHome: the section lives in the URL so a
  // refresh stays put, and the last-used one is the fallback for a bare URL.
  // Before this, every refresh dumped you back on Reminders.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("section");
    const stored = window.localStorage.getItem(SECTION_STORAGE_KEY);
    const next = [wanted, stored].find(
      (id): id is Section => id !== null && SECTIONS.some((s) => s.id === id),
    );
    if (next) setSectionState(next);
  }, []);

  const setSection = (next: Section) => {
    setSectionState(next);
    window.localStorage.setItem(SECTION_STORAGE_KEY, next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.replaceState(null, "", url);
  };
  const settings = useQuery(api.orgs.current, {});
  const update = useMutation(api.orgs.update);
  const connectWhatsapp = useMutation(api.orgs.connectWhatsapp);
  const disconnectWhatsapp = useMutation(api.orgs.disconnectWhatsapp);
  const updateTemplate = useMutation(api.orgs.updateTemplate);

  if (!settings) return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;

  // HTTP actions answer on the SITE url; the client talks to the cloud one.
  // Swapping the domain is right in the cloud and wrong on a local deployment,
  // where the two are PORTS — so the webhook URL this card hands you to paste
  // into cal.com pointed at 3212 instead of 3213 and would never have fired.
  // NEXT_PUBLIC_CONVEX_SITE_URL states it outright; prefer it, and keep the
  // swap as the fallback for deployments that do not set it.
  const site = resolveSiteUrl();
  // Backend enforces this too (requireOwner); the fieldsets are just honest UI.
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

      {section === "reminders" && (
        <NotificationRulesCard
          isOwner={isOwner}
          org={settings.org}
          templates={settings.templates}
          waConnected={settings.whatsapp.connected}
          update={(args) => void update(args)}
        />
      )}

      {section === "whatsapp" && (
        <>
          <Card disabled={!isOwner}>
            {settings.whatsapp.connected ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  {t("settings.waConnected")}
                </span>
                <span className="text-[var(--muted)]">
                  {settings.whatsapp.displayNumber ?? settings.whatsapp.phoneNumberId} · ••••
                  {settings.whatsapp.tokenTail}
                </span>
                <button
                  className="ml-auto rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-[var(--muted-bg)] dark:text-red-400"
                  onClick={() => void disconnectWhatsapp({})}
                >
                  {t("settings.waDisconnect")}
                </button>
              </div>
            ) : (
              <form
                className={ROW_GRID}
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  await connectWhatsapp({
                    phoneNumberId: String(form.get("phoneNumberId") ?? ""),
                    accessToken: String(form.get("accessToken") ?? ""),
                    displayNumber: String(form.get("displayNumber") ?? "") || undefined,
                  });
                }}
              >
                <RowLabel label={t("settings.waPhoneNumberId")} />
                <input name="phoneNumberId" required />
                <RowLabel label={t("customers.phone")} />
                <input name="displayNumber" placeholder="+905321234567" />
                <RowLabel label={t("settings.waToken")} />
                <input name="accessToken" type="password" required />
                <span />
                <div>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
                  >
                    {t("settings.waConnect")}
                  </button>
                </div>
              </form>
            )}
          </Card>

          <Card
            title={t("settings.templates")}
            tip={t("settings.templatesHint")}
            disabled={!isOwner}
          >
            <div className="divide-y divide-[var(--border)]">
              {settings.templates.map((template) => (
                <div key={template._id} className="grid gap-2 py-3 sm:grid-cols-3 sm:items-center">
                  <span className="flex items-center gap-2 text-sm">
                    {template.kind === "confirmation"
                      ? t("settings.sendConfirmation")
                      : t("settings.reminders")}
                    {template.bodyPreview && <InfoTip text={template.bodyPreview} />}
                  </span>
                  <input
                    defaultValue={template.metaName}
                    onBlur={(e) =>
                      void updateTemplate({ templateId: template._id, metaName: e.target.value })
                    }
                  />
                  <select
                    defaultValue={template.status}
                    onChange={(e) =>
                      void updateTemplate({
                        templateId: template._id,
                        status: e.target.value as "draft" | "pending" | "approved" | "rejected",
                      })
                    }
                  >
                    <option value="draft">{t("template.draft")}</option>
                    <option value="pending">{t("template.pending")}</option>
                    <option value="approved">{t("template.approved")}</option>
                    <option value="rejected">{t("template.rejected")}</option>
                  </select>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* Not behind isOwner: connector keys are per person, and the backend
          scopes create to self and revoke-others to owners. */}
      {section === "ai" && <McpCard site={site} />}

      {section === "whatsapp" && <ShopPhoneCard isOwner={isOwner} />}

      {section === "whatsapp" && (
        <AwayReplyCard
          isOwner={isOwner}
          org={settings.org}
          update={(args) => void update(args)}
        />
      )}

    </div>
  );
}
