"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
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

function VoiceCard({ isOwner, siteUrl }: { isOwner: boolean; siteUrl: string }) {
  const { t } = useLanguage();
  const config = useQuery(api.retell.config, {});
  const setConfig = useMutation(api.retell.setConfig);
  if (config === undefined) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }
  const commit = (patch: Partial<{ retellAgentId: string; inboundNumber: string; transferNumber: string; enabled: boolean }>) => {
    void setConfig({
      retellAgentId: patch.retellAgentId ?? config?.retellAgentId ?? "",
      inboundNumber: patch.inboundNumber ?? config?.inboundNumber,
      transferNumber: patch.transferNumber ?? config?.transferNumber,
      enabled: patch.enabled ?? config?.enabled ?? false,
    });
  };
  return (
    <Card disabled={!isOwner}>
      <div className={ROW_GRID}>
        <RowLabel label={t("settings.retellAgentId")} />
        <input
          defaultValue={config?.retellAgentId ?? ""}
          onBlur={(e) => e.target.value.trim() && commit({ retellAgentId: e.target.value })}
        />
        <RowLabel label={t("settings.inboundNumber")} />
        <input
          defaultValue={config?.inboundNumber ?? ""}
          placeholder="+902121234567"
          onBlur={(e) => config && commit({ inboundNumber: e.target.value })}
        />
        <RowLabel label={t("settings.transferNumber")} />
        <input
          defaultValue={config?.transferNumber ?? ""}
          placeholder="+905321234567"
          onBlur={(e) => config && commit({ transferNumber: e.target.value })}
        />
        <RowLabel label={t("settings.voiceEnabled")} />
        <Toggle
          checked={config?.enabled ?? false}
          onChange={(next) => config && commit({ enabled: next })}
          disabled={!config}
        />
        {config && (
          <>
            <RowLabel label={t("settings.voiceEndpoints")} hint={t("settings.voiceHint")} />
            <div className="min-w-0 space-y-1 text-xs text-[var(--muted)]">
              <code className="block overflow-x-auto rounded-lg bg-[var(--muted-bg)] px-2 py-1.5">
                {siteUrl}/retell/functions
              </code>
              <code className="block overflow-x-auto rounded-lg bg-[var(--muted-bg)] px-2 py-1.5">
                {siteUrl}/retell/call-ended
              </code>
            </div>
          </>
        )}
      </div>
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
type Section = "reminders" | "whatsapp" | "bookings" | "voice";

const SECTIONS: { id: Section; key: TranslationKey }[] = [
  { id: "reminders", key: "settings.reminders" },
  { id: "whatsapp", key: "settings.whatsapp" },
  { id: "bookings", key: "settings.bookings" },
  { id: "voice", key: "settings.voice" },
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

export function SettingsView() {
  const { t } = useLanguage();
  const [section, setSection] = useState<Section>("reminders");
  const settings = useQuery(api.orgs.current, {});
  const update = useMutation(api.orgs.update);
  const connectWhatsapp = useMutation(api.orgs.connectWhatsapp);
  const disconnectWhatsapp = useMutation(api.orgs.disconnectWhatsapp);
  const updateTemplate = useMutation(api.orgs.updateTemplate);
  const rotateToken = useMutation(api.calcom.rotateWebhookToken);
  const setCalcomApi = useMutation(api.calcom.setApi);
  const [calcomUrl, setCalcomUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!settings) return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;

  const siteUrl = (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(
    ".convex.cloud",
    ".convex.site",
  );
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

      {section === "voice" && <VoiceCard isOwner={isOwner} siteUrl={siteUrl} />}

      {section === "whatsapp" && (
        <AwayReplyCard
          isOwner={isOwner}
          org={settings.org}
          update={(args) => void update(args)}
        />
      )}

      {section === "bookings" && (
        <Card disabled={!isOwner}>
          <div className={ROW_GRID}>
            <RowLabel label={t("settings.calcomApiKey")} />
            <input
              type="password"
              placeholder={
                settings.org.calcomApiKeyTail
                  ? `••••${settings.org.calcomApiKeyTail}`
                  : "cal_live_…"
              }
              onBlur={(e) => e.target.value.trim() && void setCalcomApi({ apiKey: e.target.value })}
            />
            <RowLabel label={t("settings.calcomEventType")} />
            <input
              defaultValue={settings.org.calcomEventTypeId ?? ""}
              onBlur={(e) => void setCalcomApi({ eventTypeId: e.target.value })}
            />
            <RowLabel label={t("settings.calcomWebhook")} hint={t("settings.calcomHint")} />
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                onClick={async () => {
                  const token = await rotateToken({});
                  setCalcomUrl(`${siteUrl}/calcom/webhook?token=${token}`);
                  setCopied(false);
                }}
              >
                {calcomUrl ? t("settings.calcomRotate") : t("settings.calcomGenerate")}
              </button>
              {calcomUrl && (
                <>
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-2 py-1.5 text-xs">
                    {calcomUrl}
                  </code>
                  <button
                    className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                    onClick={() => {
                      void navigator.clipboard.writeText(calcomUrl);
                      setCopied(true);
                    }}
                  >
                    {copied ? t("common.copied") : t("common.copy")}
                  </button>
                </>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
