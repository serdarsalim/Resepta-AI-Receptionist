"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
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
  metaName?: string;
  body?: string;
  bodyPreview?: string;
};

// What a rule can actually reach today, mirroring wa.sendAppointmentMessage:
// email needs a From on the org and template text; WhatsApp depends on which
// lane would carry the send. A Cloud number wins whenever it exists
// (lib/waLane rule 2), so with one connected the send stands or falls on
// Meta's approval — the shop phone carries rules only when it is the only
// WhatsApp the org has, and then all it needs is the words.
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
  evolutionEnabled: boolean,
  emailFrom: string | undefined,
  emailLabel: string,
  channelPref: "whatsapp" | "email" | "both",
): string[] {
  const template = templates.find((t) => t.kind === kind && t.language === language);
  const hasText = Boolean(template?.body || template?.bodyPreview);
  const channels: string[] = [];
  const waOk = waConnected
    ? template?.status === "approved" && Boolean(template?.metaName)
    : evolutionEnabled && hasText;
  if (channelPref !== "email" && waOk) channels.push("WhatsApp");
  if (channelPref !== "whatsapp" && emailFrom && hasText) channels.push(emailLabel);
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
  evolutionEnabled,
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
    messageChannel: "whatsapp" | "email" | "both";
  };
  templates: TemplateRow[];
  waConnected: boolean;
  evolutionEnabled: boolean;
  update: (args: Record<string, unknown>) => void;
}) {
  const { t, language } = useLanguage();
  const offsets = org.reminderOffsetsHours;
  const unused = OFFSET_PRESETS.filter((h) => !offsets.includes(h));
  const orgHasChannel = waConnected || evolutionEnabled || Boolean(org.emailFrom);

  const channelsFor = (kind: RuleKind) =>
    ruleChannels(
      kind,
      templates,
      org.language,
      waConnected,
      evolutionEnabled,
      org.emailFrom,
      t("settings.ruleEmail"),
      org.messageChannel,
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
      {/* The channel decision, org-wide rather than per rule: per-rule
          channels would need the rules to become documents (see the storage
          note above), and one salon sending its confirmation by WhatsApp but
          its reminder by email is a configuration nobody has asked for. */}
      <div className="flex flex-wrap items-center gap-1.5 pb-3">
        <span className="mr-1.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
          {t("settings.sendChannel")}
          <InfoTip text={t("settings.sendChannelHint")} />
        </span>
        {(["whatsapp", "email", "both"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => update({ messageChannel: option })}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              org.messageChannel === option
                ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            }`}
          >
            {option === "whatsapp"
              ? t("channel.whatsapp")
              : option === "email"
                ? t("settings.ruleEmail")
                : t("settings.channelBoth")}
          </button>
        ))}
      </div>

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
//
// Exported and rendered under Business → Hours, not here. The hours stopped
// being a WhatsApp detail the day the voice agent started scheduling by them;
// finding "when are we open" behind a WhatsApp tab was a scavenger hunt. The
// component keeps living in this file because the away-reply half of it is
// still wired to everything else here.
export function AwayReplyCard({
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
          {/* Shown Monday-first — the week as this market reads it — while
              the STORED indices stay 0=Sunday, because that is what
              Date.getDay() speaks and what the away-reply check compares. */}
          {[1, 2, 3, 4, 5, 6, 0].map((index) => {
            const label = days[index];
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
// What used to be Settings, whittled down until the name stopped being true:
// voice became its own tab, bookings went to the operator's admin console, AI
// connectors joined Business next to People, credentials moved behind /admin
// and the hours card to Business → Hours. What remained no longer justified
// tabs, so there are none.

// One flat page, no tabs. Reminders/WhatsApp was a two-tab split where the
// second tab held credentials (now /admin's job) and the hours card (now
// Business → Hours); what is left — the rules, the templates the rules send,
// and the shop phone — is one story read top to bottom.
export function RemindersView() {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const update = useMutation(api.orgs.update);
  const updateTemplate = useMutation(api.orgs.updateTemplate);

  if (!settings) return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;

  // Backend enforces this too (requireOwner); the fieldsets are just honest UI.
  const isOwner = settings.me.role !== "staff";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {!isOwner && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-xs text-[var(--muted)]">
          {t("settings.ownerOnly")}
        </p>
      )}

      <NotificationRulesCard
          isOwner={isOwner}
          org={settings.org}
          templates={settings.templates}
          waConnected={settings.whatsapp.connected}
          evolutionEnabled={settings.evolutionEnabled}
          update={(args) => void update(args)}
        />

      <>
          {/* No connect form here. The Meta credentials — phone number id,
              access token — are operator plumbing, entered from /admin like
              the Retell key. A salon owner was being shown a password field
              for an account they do not have; all they need to know is
              whether the number works, and the templates card already goes
              amber when it does not. */}
          {settings.whatsapp.connected && (
            <Card disabled={!isOwner}>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  {t("settings.waConnected")}
                </span>
                <span className="text-[var(--muted)]">
                  {settings.whatsapp.displayNumber ?? settings.whatsapp.phoneNumberId}
                </span>
              </div>
            </Card>
          )}

          {/* The templates the rules send, one editor per kind. The body is
              the salon's own words in named tokens; where a send actually
              leaves from is a single status line, and the Meta registration
              (name + approval) is a technical detail row that only exists
              while a Business number is connected — the shop phone and email
              need no approval from anybody. */}
          <Card
            title={t("settings.templates")}
            tip={t("settings.templatesHint")}
            disabled={!isOwner}
          >
            <div className="divide-y divide-[var(--border)]">
              {settings.templates
                // The campaign row has no body of its own — each campaign
                // carries its line — but it does own the email subject, so it
                // renders whenever either half has something to edit: the
                // Meta registration (Cloud connected) or the subject (email
                // From set). With neither, it is an editor for nothing.
                .filter(
                  (template) =>
                    template.kind !== "campaign" ||
                    settings.whatsapp.connected ||
                    Boolean(settings.org.emailFrom),
                )
                .map((template) => (
                  <div key={template._id} className="space-y-2 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {template.kind === "confirmation"
                          ? t("settings.ruleConfirmation")
                          : template.kind === "reminder"
                            ? t("settings.ruleReminder")
                            : template.kind === "winback"
                              ? t("settings.ruleWinback")
                              : t("settings.templateKindCampaign")}
                      </span>
                      {/* Which number this leaves from, in the salon's words.
                          Cloud wins whenever it exists (lib/waLane rule 2),
                          so the shop-phone line only shows when the shop
                          phone is the org's only WhatsApp. Neither lane: the
                          rules card already says so once, in amber. */}
                      {(settings.whatsapp.connected || settings.evolutionEnabled) && (
                        <span className="text-xs text-[var(--muted)]">
                          {settings.whatsapp.connected
                            ? t("settings.templateLaneCloud")
                            : t("settings.templateLaneShopPhone")}
                        </span>
                      )}
                    </div>
                    {template.kind !== "campaign" && (
                      <>
                        <textarea
                          rows={3}
                          className="w-full"
                          defaultValue={template.body ?? ""}
                          placeholder={t("settings.templateBodyPlaceholder")}
                          aria-label={t("settings.templateBody")}
                          onBlur={(e) =>
                            void updateTemplate({
                              templateId: template._id,
                              body: e.target.value,
                            })
                          }
                        />
                        <p className="text-xs text-[var(--muted)]">
                          {t("settings.templateTokens")}:{" "}
                          {t("settings.templateTokensList")}
                        </p>
                        {/* Win-back mail is the one kind that tracks opens —
                            a rate over the template, never a per-customer
                            fact, because mail relays prefetch pixels and a
                            personal "opened" badge would launder that guess
                            into a record. */}
                        {template.kind === "winback" &&
                          (template.emailSentCount ?? 0) > 0 && (
                            <p className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                              {t("settings.templateEmailOpens")}:{" "}
                              {template.emailOpenCount ?? 0} / {template.emailSentCount}
                              <InfoTip text={t("settings.templateEmailOpensHint")} />
                            </p>
                          )}
                      </>
                    )}
                    {/* Outside the campaign guard: a campaign has no body
                        here, but its emails need a subject like everyone
                        else's (campaigns.fanOut renders it per customer). */}
                    {settings.org.emailFrom && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-36 shrink-0 text-xs text-[var(--muted)]">
                          {t("settings.templateSubject")}
                        </span>
                        <input
                          className="min-w-0 flex-1"
                          defaultValue={template.subject ?? ""}
                          onBlur={(e) =>
                            void updateTemplate({
                              templateId: template._id,
                              subject: e.target.value,
                            })
                          }
                        />
                      </div>
                    )}
                    {settings.whatsapp.connected && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex w-36 shrink-0 items-center gap-1 text-xs text-[var(--muted)]">
                          {t("settings.templateName")}
                          {/* The exact string Meta approved, for checking the
                              authored body against it. */}
                          {template.bodyPreview && <InfoTip text={template.bodyPreview} />}
                        </span>
                        <input
                          className="min-w-0 flex-1"
                          defaultValue={template.metaName ?? ""}
                          onBlur={(e) =>
                            void updateTemplate({
                              templateId: template._id,
                              metaName: e.target.value,
                            })
                          }
                        />
                        <select
                          defaultValue={template.status}
                          aria-label={t("settings.templateStatus")}
                          onChange={(e) =>
                            void updateTemplate({
                              templateId: template._id,
                              status: e.target.value as
                                | "draft"
                                | "pending"
                                | "approved"
                                | "rejected",
                            })
                          }
                        >
                          <option value="draft">{t("template.draft")}</option>
                          <option value="pending">{t("template.pending")}</option>
                          <option value="approved">{t("template.approved")}</option>
                          <option value="rejected">{t("template.rejected")}</option>
                        </select>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </Card>
        </>

      <ShopPhoneCard isOwner={isOwner} />

    </div>
  );
}
