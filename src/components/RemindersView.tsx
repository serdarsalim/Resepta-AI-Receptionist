"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
// Pure TS shared with the backend on purpose: the preview must be the SAME
// renderer the send path uses, or the preview becomes a second opinion.
import { renderTokens } from "../../convex/lib/renderTokens";
// Same reason: the preview prints the date in the shape the send path prints
// it, timezone and all, rather than a second date formatter's opinion.
import { formatAppointmentTime } from "../../convex/lib/format";
import { useLanguage } from "@/lib/LanguageProvider";
import { sanitizeEmailHtml } from "@/lib/sanitizeHtml";
import { useConfirm } from "./ConfirmDialog";
import { EmailBodyEditor } from "./EmailBodyEditor";
import { EmojiPicker } from "./EmojiPicker";
import { VariableInsertDropdown } from "./VariableInsertDropdown";
import {
  formatReminderOffset,
  minutesToTimeValue,
  timeValueToMinutes,
  weekdayNames,
} from "@/lib/datetime";
import { ROW_GRID, RowLabel } from "./RowLabel";
import { TimezoneSelect } from "./TimezoneSelect";
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

type RuleTrigger =
  | "booking"
  | "before_start"
  | "after_end"
  | "cancellation"
  | "no_show"
  | "out_of_hours";

type RuleRowData = {
  _id: Id<"messageRules">;
  trigger: RuleTrigger;
  offsetHours: number;
  channel: "whatsapp" | "email" | "both";
  paused: boolean;
};

type TemplateRow = {
  _id: Id<"waTemplates">;
  ruleId?: Id<"messageRules">;
  kind: string;
  language: string;
  status: string;
  metaName?: string;
  body?: string;
  bodyHtml?: string;
  subject?: string;
  bodyPreview?: string;
  emailSentCount?: number;
  emailOpenCount?: number;
  emailReplyCount?: number;
  emailLastSentAt?: number;
};

// Same map as messageRules.kindForTrigger — which template bucket words a
// trigger, for the fallback lookup and the row labels.
const KIND_FOR_TRIGGER: Record<RuleTrigger, string> = {
  booking: "confirmation",
  before_start: "reminder",
  after_end: "followup",
  cancellation: "cancellation",
  no_show: "winback",
  out_of_hours: "out_of_hours",
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
  emailEnabled: boolean,
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
  if (channelPref !== "whatsapp" && emailEnabled && hasText) channels.push(emailLabel);
  return channels;
}

function RuleRow({
  when,
  what,
  channels,
  orgHasChannel,
  enabled,
  onToggle,
  onRemove,
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
  onRemove: () => void;
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
      {/* Two controls, two meanings, and now every row has both: the switch
          pauses without losing anything, the × takes the row off the table.
          They used to be the same control, which is why switching a reminder
          off silently deleted the schedule behind it. */}
      <span className="flex w-11 shrink-0 justify-center">
        <Toggle checked={enabled} onChange={onToggle} label={what} />
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${what} — ${t("common.delete")}`}
        title={t("common.delete")}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg leading-none text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-red-600 dark:hover:text-red-400"
      >
        ×
      </button>
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
  emailEnabled,
  update,
}: {
  isOwner: boolean;
  org: {
    language: string;
    reminderOffsetsHours: number[];
    pausedReminderHours: number[];
    removedRules: string[];
    sendBookingConfirmation: boolean;
    winbackEnabled: boolean;
    winbackDaysAfter: number;
    quietHoursStart: number;
    quietHoursEnd: number;
    messageChannel: "whatsapp" | "email" | "both";
  };
  templates: TemplateRow[];
  waConnected: boolean;
  evolutionEnabled: boolean;
  emailEnabled: boolean;
  update: (args: Record<string, unknown>) => void;
}) {
  const { t, language } = useLanguage();
  const offsets = org.reminderOffsetsHours;
  const unused = OFFSET_PRESETS.filter((h) => !offsets.includes(h));
  const orgHasChannel = waConnected || evolutionEnabled || emailEnabled;

  const channelsFor = (kind: RuleKind) =>
    ruleChannels(
      kind,
      templates,
      org.language,
      waConnected,
      evolutionEnabled,
      emailEnabled,
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
          its reminder by email is a configuration nobody has asked for.

          Only WIRED channels are offered — the operator does the wiring, so a
          pill for an unconfigured channel is a menu of things the salon
          cannot order. One channel wired shows one pill (it says how messages
          travel); "Both" exists only when there is actually a pair; nothing
          wired hides the row, and the amber line below the table says whose
          move it is. */}
      {orgHasChannel && (
        <div className="flex flex-wrap items-center gap-1.5 pb-3">
          <span className="mr-1.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
            {t("settings.sendChannel")}
            <InfoTip text={t("settings.sendChannelHint")} />
          </span>
          {([
            ...(waConnected || evolutionEnabled ? (["whatsapp"] as const) : []),
            ...(emailEnabled ? (["email"] as const) : []),
            ...((waConnected || evolutionEnabled) && emailEnabled
              ? (["both"] as const)
              : []),
          ]).map((option) => (
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
      )}

      <div className="hidden items-center gap-3 pb-2 sm:flex">
        <div className={RULE_COLUMNS}>
          <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            {t("settings.rulesWhen")}
            <InfoTip text={t("settings.rulesHint")} />
          </span>
          <span className="text-xs text-[var(--muted)]">{t("settings.rulesWhat")}</span>
          <span className="text-xs text-[var(--muted)]">{t("settings.rulesWhere")}</span>
        </div>
        <span className="flex w-11 shrink-0 justify-center text-xs text-[var(--muted)]">
          {t("settings.ruleActive")}
        </span>
        {/* Spacer over the × column; a header on it would just repeat what the
            glyph already says. */}
        <span className="w-9 shrink-0" aria-hidden />
      </div>

      <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
        {!org.removedRules.includes("confirmation") && (
        <RuleRow
          when={t("settings.ruleWhenBooked")}
          what={t("settings.ruleConfirmation")}
          channels={channelsFor("confirmation")}
          orgHasChannel={orgHasChannel}
          enabled={org.sendBookingConfirmation}
          onToggle={(next) => update({ sendBookingConfirmation: next })}
          onRemove={() =>
            update({ removedRules: [...org.removedRules, "confirmation"] })
          }
        />
        )}

        {offsets.map((hours) => (
          <RuleRow
            key={hours}
            when={formatReminderOffset(hours, language)}
            what={t("settings.ruleReminder")}
            channels={channelsFor("reminder")}
            orgHasChannel={orgHasChannel}
            enabled={!org.pausedReminderHours.includes(hours)}
            onToggle={(next) =>
              update({
                pausedReminderHours: next
                  ? org.pausedReminderHours.filter((h) => h !== hours)
                  : [...org.pausedReminderHours, hours],
              })
            }
            onRemove={() => setOffsets(offsets.filter((h) => h !== hours))}
          />
        ))}

        {!org.removedRules.includes("winback") && (
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
          onRemove={() => update({ removedRules: [...org.removedRules, "winback"] })}
          hint={winbackHint}
        />
        )}
      </div>

      {(unused.length > 0 || org.removedRules.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 pt-3">
          <span className="text-xs text-[var(--muted)]">{t("settings.ruleAdd")}</span>
          {/* A removed singleton comes back the same way a reminder does, from
              the same row of chips — so "add a rule" is one place, not two. */}
          {org.removedRules.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                update({ removedRules: org.removedRules.filter((r) => r !== key) })
              }
              className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--muted)] transition-colors hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
            >
              <span aria-hidden className="text-[var(--muted)]">+</span>
              {key === "confirmation"
                ? t("settings.ruleConfirmation")
                : t("settings.ruleWinback")}
            </button>
          ))}
          {unused.map((hours) => (
            // Bordered, with a +, because these used to be bare text that
            // only looked clickable once the pointer was already on them —
            // and the one control on this card that ADDS a row read exactly
            // like the labels beside it.
            <button
              key={hours}
              type="button"
              onClick={() => setOffsets([...offsets, hours])}
              className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--muted)] transition-colors hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
            >
              <span aria-hidden className="text-[var(--muted)]">+</span>
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

// ── The rules-model card ────────────────────────────────────────────────────
//
// One row per messageRules document, in customer-journey order, each owning
// its timing, its channel and — behind the chevron — its own wording with a
// live preview. The legacy card above renders only for orgs the migration has
// not reached and dies with the legacy fields.

// The two projections of one authored email. plainToHtml lifts a legacy
// plain-text body into the WYSIWYG editor; htmlToText derives the WhatsApp
// text the send path uses from whatever the editor holds. Deriving on SAVE —
// not at send time — keeps the backend blind to HTML parsing.
function plainToHtml(text: string): string {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function htmlToText(html: string): string {
  const prepared = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ");
  // SSR guard: this only runs for real in the browser; the server render just
  // needs to not crash before hydration.
  if (typeof window === "undefined") {
    return prepared.replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  }
  const doc = new DOMParser().parseFromString(prepared, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

// A number that reads as part of the sentence until it is touched: no border,
// no spinners, just an underline on hover saying "this is yours to change".
// The row copy is "24 hours before" — a boxed input in the middle of that
// made every row look like a form, and a rules list is a list, not a form.
function InlineNumber({
  value,
  min,
  max,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onCommit: (next: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      defaultValue={value}
      aria-label={label}
      onBlur={(e) => {
        const next = Number(e.target.value);
        if (Number.isFinite(next) && next > 0 && next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-10 border-0 bg-transparent p-0 text-center text-sm underline decoration-[var(--border)] decoration-dotted underline-offset-4 [appearance:textfield] hover:decoration-[var(--foreground)] focus:decoration-solid focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

// The message editor behind a rule's chevron. Controlled state rather than
// defaultValue+blur alone, because the variable insert and the preview both
// need the text as it is being written, not as it was last saved.
function RuleEditor({
  rule,
  template,
  contactFields,
  orgName,
  orgLanguage,
  orgCurrency,
  orgTimezone,
  orgBookingUrl,
  orgPublicPhone,
  emailEnabled,
  waConnected,
  onSaveTemplate,
}: {
  rule: RuleRowData;
  template: TemplateRow | undefined;
  contactFields: { key: string; label: string }[];
  orgName: string;
  orgLanguage: string;
  orgCurrency: string;
  orgTimezone: string;
  orgBookingUrl?: string;
  orgPublicPhone?: string;
  emailEnabled: boolean;
  waConnected: boolean;
  onSaveTemplate: (
    templateId: Id<"waTemplates">,
    patch: { body?: string; bodyHtml?: string; subject?: string },
  ) => void;
}) {
  const { t } = useLanguage();
  const [body, setBody] = useState(template?.body ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  // What the WYSIWYG editor currently holds, saved or not — the previews
  // track it live. Seeded from the stored HTML, or the plain body lifted into
  // HTML for rows that predate the editor.
  const [liveHtml, setLiveHtml] = useState(
    template?.bodyHtml ?? plainToHtml(template?.body ?? ""),
  );
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  // The row is created by ensureTemplate when the panel opens; until the
  // query catches up there is nothing to bind to.
  const templateId = template?._id;
  useEffect(() => {
    setBody(template?.body ?? "");
    setSubject(template?.subject ?? "");
    setLiveHtml(template?.bodyHtml ?? plainToHtml(template?.body ?? ""));
    // Re-seed exactly when the editor starts talking about a different row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // ── Preview data: a real booking, or no preview at all ──────────────────
  //
  // This used to fall back to samples — "Emma", a €350 haircut, tomorrow at
  // 14:00 — and that made the pane a liar in the exact place it is trusted.
  // An owner checking whether [pricelist] reads right cannot tell a broken
  // template from an invented number, and a €350.00 sample in a shop that
  // charges €35 reads as a pricing bug in the product. So: the preview renders
  // ONE customer's ONE real appointment, or it renders a line telling you to
  // pick one. Nothing in this pane is ever made up.
  const contacts = useQuery(api.customers.options, {}) ?? [];
  const [contactQuery, setContactQuery] = useState("");
  const [contactId, setContactId] = useState<Id<"customers"> | null>(null);
  // Which lane the preview is showing. One message goes out two ways, so this
  // is a view of the same thing rather than two things — stacking both cards
  // made the pane look like the rule sends twice.
  const [lanePref, setLanePref] = useState<"email" | "whatsapp">("email");
  const picked = useQuery(
    api.customers.get,
    contactId ? { customerId: contactId } : "skip",
  );
  const matches =
    contactQuery.trim() && !contactId
      ? contacts
          .filter((c) =>
            `${c.firstName} ${c.lastName ?? ""} ${c.phone}`
              .toLocaleLowerCase(orgLanguage)
              .includes(contactQuery.trim().toLocaleLowerCase(orgLanguage)),
          )
          .slice(0, 6)
      : [];

  // The booking the preview speaks about: the soonest one still ahead, and
  // failing that the most recent past one. Rows arrive newest-first.
  const appointments = useQuery(
    api.appointments.listForCustomer,
    contactId ? { customerId: contactId } : "skip",
  );
  const appointment = useMemo(() => {
    if (!appointments?.length) return null;
    const now = Date.now();
    const upcoming = [...appointments].reverse().find((a) => a.startAt >= now);
    return upcoming ?? appointments[0];
  }, [appointments]);

  // Null until there is a real customer AND a real booking to render — the
  // pane reads that as "nothing to show yet" rather than filling the gap.
  //
  // Every value below is built the way convex/wa.ts builds it at send time,
  // including prices being MINOR units (the old sample divided by nothing and
  // printed €350.00 for a 350-kuruş line).
  const previewValues = useMemo(() => {
    if (!picked) return null;
    // The away reply speaks to a person, not a booking — everyone else still
    // needs the real appointment their tokens describe.
    if (!appointment && rule.trigger !== "out_of_hours") return null;
    const formatMoney = (minor: number) =>
      new Intl.NumberFormat(orgLanguage, {
        style: "currency",
        currency: orgCurrency,
      }).format(minor / 100);
    // Every org field key present, empty when valueless — mirrors the send
    // path exactly, so a real field renders to nothing rather than staying a
    // literal token in the preview.
    const custom: Record<string, string> = {};
    for (const field of contactFields) {
      custom[field.key] = picked.custom?.[field.key] ?? "";
    }
    const items = appointment?.items ?? [];
    const totalMinor = items.reduce((sum, item) => sum + (item.price ?? 0), 0);
    // A real send collapses a token with nothing behind it, along with the
    // whitespace it leaves — renderTokens does that on purpose, so a message
    // never goes out saying "Merhaba ," or carrying an empty bracket. In a
    // PREVIEW that same kindness is a lie: the line simply vanishes, and the
    // writer cannot tell a token that will fill on a real send from one they
    // misspelled. So a built-in with no sample data behind it previews as its
    // own label in guillemets instead of as nothing.
    //
    // Contact fields are deliberately NOT given this treatment. The preview
    // speaks about a real customer, and a field that person never answered is
    // honestly blank for them — that is information, not a gap.
    const sample = (value: string | undefined, label: string) =>
      value && value.trim() ? value : `⟨${label}⟩`;
    return {
      firstName: picked.firstName,
      lastName: picked.lastName,
      // The BUSINESS's number and link — what [phone] and [booking_link]
      // resolve to at send time (see convex/lib/renderTokens).
      phone: sample(orgPublicPhone, t("vars.phone")),
      email: picked.email,
      bookingLink: sample(orgBookingUrl, t("vars.bookingLink")),
      businessName: orgName,
      appointmentAt: appointment
        ? formatAppointmentTime(appointment.startAt, orgTimezone, orgLanguage)
        : `⟨${t("vars.date")}⟩`,
      staffName: sample(appointment?.staffName, t("vars.staff")),
      serviceName: sample(
        items.map((item) => `• ${item.name}`).join("\n"),
        t("vars.service"),
      ),
      servicePriceList: sample(
        items
          .map(
            (item) =>
              `• ${item.name}${item.price ? ` — ${formatMoney(item.price)}` : ""}`,
          )
          .join("\n"),
        t("vars.priceList"),
      ),
      price: totalMinor > 0 ? formatMoney(totalMinor) : `⟨${t("vars.price")}⟩`,
      // Never resolvable outside an appointment-lifecycle send, so it is a
      // placeholder in every preview rather than sometimes-blank.
      manageLink: `⟨${t("vars.manageLink")}⟩`,
      custom,
    };
  }, [
    orgName,
    orgLanguage,
    orgCurrency,
    orgTimezone,
    orgPublicPhone,
    orgBookingUrl,
    contactFields,
    picked,
    appointment,
    rule.trigger,
    t,
  ]);

  if (!template) {
    return <p className="py-3 text-xs text-[var(--muted)]">{t("common.loading")}</p>;
  }

  // Inserts land at the CURSOR, not the end — Nudge's VariableChips pattern.
  // Plain-textarea mode only; the WYSIWYG editor's own toolbar handles both
  // inserts against the tiptap caret.
  const insertAtCursor = (token: string) => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    onSaveTemplate(template._id, { body: next });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const cursor = start + token.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  // The lanes this rule could ACTUALLY travel — the rule's own channel
  // narrowed by what the org has wired. WhatsApp used to preview whether or
  // not a number existed, so a salon with email only was shown a green bubble
  // for a message WhatsApp will never carry.
  const lanes: ("email" | "whatsapp")[] = [];
  if (rule.channel !== "whatsapp" && emailEnabled) lanes.push("email");
  if (rule.channel !== "email" && waConnected) lanes.push("whatsapp");
  // Nothing wired yet: still show the words, in whichever shape the editor is
  // writing. The owner is authoring for a channel the operator will connect.
  const lane = lanes.includes(lanePref)
    ? lanePref
    : (lanes[0] ?? (emailEnabled ? "email" : "whatsapp"));
  // What each lane would actually send: WhatsApp the derived plain text,
  // email the authored HTML — both through the same token renderer.
  const previewPlain = emailEnabled ? htmlToText(liveHtml) : body;
  const rendered = previewValues ? renderTokens(previewPlain, previewValues) : "";
  // Same swap the send path makes: inside HTML a bare \n is a space, so the
  // service list rides <br/>.
  const renderedEmailHtml = previewValues
    ? sanitizeEmailHtml(
        renderTokens(liveHtml, {
          ...previewValues,
          serviceName: previewValues.serviceName?.replace(/\n/g, "<br/>"),
          servicePriceList: previewValues.servicePriceList?.replace(/\n/g, "<br/>"),
        }),
      )
    : "";
  // Whether what the reader is looking at right now contains a placeholder.
  // Checked against the RENDERED text of whichever lane is showing, subject
  // included — the raw template always holds tokens, which would light this
  // permanently and teach everyone to ignore it.
  const showsPlaceholder =
    /⟨[^⟩]+⟩/.test(lane === "email" ? renderedEmailHtml : rendered) ||
    (previewValues ? /⟨[^⟩]+⟩/.test(renderTokens(subject, previewValues)) : false);
  const pickedLabel = picked
    ? `${picked.firstName} ${picked.lastName ?? ""}`.trim()
    : "";

  return (
    <div className="grid gap-4 pb-4 sm:grid-cols-2">
      <div className="space-y-2">
        {/* Subject first — that is the order an email reads in. Placeholder
            instead of a label so the input gets the full row width. */}
        {emailEnabled && (
          // h-10 matches the preview header row beside it, so the editor box
          // and the preview paper start on the same line.
          <input
            className="h-10 w-full"
            value={subject}
            placeholder={t("settings.templateSubject")}
            aria-label={t("settings.templateSubject")}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={() => onSaveTemplate(template._id, { subject })}
          />
        )}
        {emailEnabled ? (
          // The real email editor — Visual/HTML tabs, toolbar with variables
          // and emoji built in. Every save writes BOTH projections: the HTML
          // the email sends and the plain text the WhatsApp lane sends.
          <EmailBodyEditor
            value={template.bodyHtml ?? plainToHtml(template.body ?? "")}
            placeholder={t("settings.templateBodyPlaceholder")}
            onLiveChange={setLiveHtml}
            onSave={(html) => {
              setLiveHtml(html);
              onSaveTemplate(template._id, {
                bodyHtml: html,
                body: htmlToText(html),
              });
            }}
          />
        ) : (
          <>
            <textarea
              ref={bodyRef}
              rows={5}
              className="w-full"
              value={body}
              placeholder={t("settings.templateBodyPlaceholder")}
              aria-label={t("settings.templateBody")}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => onSaveTemplate(template._id, { body })}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <VariableInsertDropdown onInsert={insertAtCursor} />
              <EmojiPicker onPick={insertAtCursor} title={t("editor.insertEmoji")} />
            </div>
          </>
        )}
        {/* Session text needs no Meta approval, so the Cloud note would
            mislead on the away reply. */}
        {waConnected && rule.trigger !== "out_of_hours" && (
          <p className="text-xs text-[var(--muted)]">{t("settings.ruleCloudNote")}</p>
        )}
        {/* Email engagement, once this message has actually sent one. Rates
            over the template, never per-customer facts — the opens hint
            explains why the number is a trend, not a truth. */}
        {(template.emailSentCount ?? 0) > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
            <span>
              {t("settings.statSent")}: {template.emailSentCount}×
              {template.emailLastSentAt
                ? ` · ${new Intl.DateTimeFormat(orgLanguage, {
                    day: "numeric",
                    month: "short",
                  }).format(template.emailLastSentAt)}`
                : ""}
            </span>
            <span className="flex items-center gap-1">
              {t("settings.statOpens")}:{" "}
              {Math.round(
                ((template.emailOpenCount ?? 0) / (template.emailSentCount ?? 1)) * 100,
              )}
              %
              <InfoTip text={t("settings.templateEmailOpensHint")} />
            </span>
            <span>
              {t("settings.statReplies")}:{" "}
              {Math.round(
                ((template.emailReplyCount ?? 0) / (template.emailSentCount ?? 1)) * 100,
              )}
              %
            </span>
          </p>
        )}
      </div>

      {/* A flex column so the preview surface stretches to the editor's
          height — the two panes read as one aligned unit, not a tall form
          beside a floating card. */}
      <div className="flex flex-col gap-2">
        <div className="flex h-10 items-center justify-between gap-2">
          {/* Two lanes, one message: a toggle, not two cards. Only rendered
              when the rule really can travel both ways — otherwise the label
              alone says which lane you are looking at. */}
          {lanes.length > 1 ? (
            <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--muted-bg)] p-0.5 text-xs">
              {lanes.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setLanePref(option)}
                  className={`rounded-full px-2.5 py-1 transition-colors ${
                    lane === option
                      ? "bg-[var(--card)] font-medium text-[var(--foreground)] shadow-sm"
                      : "text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {option === "email" ? t("settings.ruleEmail") : t("channel.whatsapp")}
                </button>
              ))}
            </span>
          ) : (
            <span className="text-xs text-[var(--muted)]">
              {t("settings.rulePreview")}
            </span>
          )}
          {/* Typeahead over real contacts — the preview's only data source.
              Picking one fills every token from their record and their next
              booking; the × empties the pane again. */}
          <span className="relative min-w-0 flex-1 max-w-56">
            <input
              className="w-full text-xs"
              value={contactId ? pickedLabel : contactQuery}
              placeholder={t("settings.previewPickContact")}
              onChange={(e) => {
                setContactId(null);
                setContactQuery(e.target.value);
              }}
            />
            {(contactId || contactQuery) && (
              <button
                type="button"
                aria-label={t("common.delete")}
                onClick={() => {
                  setContactId(null);
                  setContactQuery("");
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                ×
              </button>
            )}
            {matches.length > 0 && (
              <ul className="absolute right-0 top-full z-30 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
                {matches.map((c) => (
                  <li key={c._id}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setContactId(c._id);
                      }}
                      className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--muted-bg)]"
                    >
                      <span className="truncate">
                        {c.firstName} {c.lastName ?? ""}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--muted)]">
                        {c.phone}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </span>
        </div>
        {/* No framing surface around the previews — the paper's top edge sits
            exactly where the editor box's does, which is what makes the two
            columns read as one aligned pair. */}
        <div className="flex flex-1 flex-col gap-3">
          {/* No contact, or a contact with nothing booked: say which, and say
              nothing else. An empty pane with a reason beats a filled pane
              with invented facts. */}
          {!previewValues ? (
            <p className="flex flex-1 items-center rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-xs leading-relaxed text-[var(--muted)]">
              {!contactId
                ? t("settings.previewNeedsContact")
                : picked && !appointment
                  ? t("settings.previewNoBooking")
                  : t("common.loading")}
            </p>
          ) : lane === "email" ? (
            /* The email as the customer's mail client shows it: white paper no
               matter the app theme, subject on top, the authored HTML below.
               flex-1 so the paper runs the full height beside the editor. */
            <div className="email-paper flex flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)]">
              <p className="border-b border-black/10 px-3 py-2 text-xs font-semibold">
                {renderTokens(subject, previewValues) ||
                  [orgName || "—", previewValues.appointmentAt]
                    .filter(Boolean)
                    .join(", ")}
              </p>
              <div
                className="email-body-editor flex-1 px-3 py-2 text-sm"
                dangerouslySetInnerHTML={{
                  __html:
                    renderedEmailHtml ||
                    `<p style="color:#9ca3af">${t("settings.templateBodyPlaceholder")}</p>`,
                }}
              />
            </div>
          ) : (
            <div className="max-w-[90%] whitespace-pre-wrap rounded-xl rounded-bl-sm bg-emerald-100 px-3 py-2 text-sm text-emerald-950 dark:bg-emerald-900/40 dark:text-emerald-100">
              {rendered || (
                <span className="text-[var(--muted)]">
                  {t("settings.templateBodyPlaceholder")}
                </span>
              )}
            </div>
          )}
          {/* Only when a placeholder is actually on screen. A standing note
              about brackets under a preview that has none is the sort of
              caption people learn to stop reading. */}
          {showsPlaceholder && (
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              {t("editor.previewPlaceholder")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function RulesCard({
  isOwner,
  org,
  templates,
  rules,
  waConnected,
  evolutionEnabled,
  emailEnabled,
}: {
  isOwner: boolean;
  org: {
    name: string;
    language: string;
    currency: string;
    timezone: string;
    quietHoursStart: number;
    quietHoursEnd: number;
    messageChannel: "whatsapp" | "email" | "both";
    bookingUrl?: string;
    publicPhone?: string;
  };
  templates: TemplateRow[];
  rules: RuleRowData[];
  waConnected: boolean;
  evolutionEnabled: boolean;
  emailEnabled: boolean;
}) {
  const { t, language } = useLanguage();
  const addRule = useMutation(api.messageRules.add);
  const updateRule = useMutation(api.messageRules.update);
  const removeRule = useMutation(api.messageRules.remove);
  const resetRules = useMutation(api.messageRules.resetToDefaults);
  const ensureTemplate = useMutation(api.messageRules.ensureTemplate);
  const updateTemplate = useMutation(api.orgs.updateTemplate);
  // For the preview's custom-token map — the same registry the variable
  // dropdown reads, so preview and menu can never disagree.
  const contactFieldRows = useQuery(api.contactFields.list, {}) ?? [];
  const [expandedId, setExpandedId] = useState<Id<"messageRules"> | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const deleteRule = async (rule: RuleRowData) => {
    const ok = await confirm({
      title: t("settings.deleteRule"),
      body: t("settings.deleteRuleConfirm"),
    });
    if (!ok) return;
    setExpandedId(null);
    void removeRule({ ruleId: rule._id });
  };

  const orgHasChannel = waConnected || evolutionEnabled || emailEnabled;
  // One chip per channel that could ACTUALLY carry this rule — the chip list
  // is the truth, so there is nothing to warn about beside it. WhatsApp
  // qualifies through an Evolution outbound number, or through a Cloud number
  // WITH a Meta-approved template for this message (an unapproved Cloud
  // template cannot send, so its chip would be a lie). Approval is per
  // message, which is why this is computed per rule.
  //
  // The chips are also the on/off control: a rule with every chip off is
  // paused, which is why there is no separate Active column — "sends nowhere"
  // and "off" are the same fact, and two controls for one fact is how the old
  // card confused people.
  const wiredFor = (rule: RuleRowData): ("whatsapp" | "email")[] => {
    // The away reply is session text — an answer to a customer who just
    // wrote, which Meta allows without any approved template. All WhatsApp
    // needs here is the Cloud number itself (wa.sendAwayReply's lane).
    if (rule.trigger === "out_of_hours") {
      return [
        ...(waConnected ? (["whatsapp"] as const) : []),
        ...(emailEnabled ? (["email"] as const) : []),
      ];
    }
    const own = templates.find(
      (tpl) => tpl.ruleId === rule._id && tpl.language === org.language,
    );
    const fallback = templates.find(
      (tpl) =>
        tpl.ruleId === undefined &&
        tpl.kind === KIND_FOR_TRIGGER[rule.trigger] &&
        tpl.language === org.language,
    );
    const metaSource =
      own && own.status === "approved" && own.metaName ? own : fallback;
    const cloudApproved =
      waConnected && metaSource?.status === "approved" && Boolean(metaSource?.metaName);
    const waOk = evolutionEnabled || cloudApproved;
    return [
      ...(waOk ? (["whatsapp"] as const) : []),
      ...(emailEnabled ? (["email"] as const) : []),
    ];
  };
  const activeChannels = (rule: RuleRowData): Set<"whatsapp" | "email"> => {
    if (rule.paused) return new Set();
    const active = new Set<"whatsapp" | "email">();
    if (rule.channel !== "email") active.add("whatsapp");
    if (rule.channel !== "whatsapp") active.add("email");
    return active;
  };
  const toggleChannel = (rule: RuleRowData, channel: "whatsapp" | "email") => {
    const active = activeChannels(rule);
    if (active.has(channel)) active.delete(channel);
    else active.add(channel);
    const on = wiredFor(rule).filter((w) => active.has(w));
    if (on.length === 0) {
      // Last chip off: the rule keeps its channel and pauses, so switching a
      // chip back on restores exactly what was there.
      void updateRule({ ruleId: rule._id, paused: true });
      return;
    }
    void updateRule({
      ruleId: rule._id,
      paused: false,
      channel: on.length === 2 ? "both" : on[0],
    });
  };

  const ruleName = (trigger: RuleTrigger) =>
    trigger === "booking"
      ? t("settings.ruleConfirmation")
      : trigger === "before_start"
        ? t("settings.ruleReminder")
        : trigger === "after_end"
          ? t("settings.ruleFollowup")
          : trigger === "cancellation"
            ? t("settings.ruleCancellation")
            : trigger === "out_of_hours"
              ? t("settings.ruleOutOfHours")
              : t("settings.ruleWinback");

  const channelLabel = (channel: "whatsapp" | "email" | "both") =>
    channel === "whatsapp"
      ? t("channel.whatsapp")
      : channel === "email"
        ? t("settings.ruleEmail")
        : t("settings.channelBoth");

  const toggleExpand = (rule: RuleRowData) => {
    if (expandedId === rule._id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(rule._id);
    // Creates the rule's own wording row (copied from the kind fallback) the
    // first time the panel opens; a no-op after that.
    if (isOwner) void ensureTemplate({ ruleId: rule._id, language: org.language });
  };

  const pad = (h: number) => String(h).padStart(2, "0");
  const winbackHint = `${t("settings.ruleWinbackHint")}\n${t("settings.ruleSendWindow")}: ${pad(
    org.quietHoursStart,
  )}:00–${pad(org.quietHoursEnd)}:00`;

  const ruleWhen = (rule: RuleRowData) => {
    switch (rule.trigger) {
      case "booking":
        return <>{t("settings.ruleWhenBooked")}</>;
      case "cancellation":
        return <>{t("settings.ruleWhenCancelled")}</>;
      case "before_start":
        return (
          <span className="flex items-center gap-1.5">
            <InlineNumber
              value={rule.offsetHours}
              min={1}
              max={168}
              label={t("settings.ruleHoursBefore")}
              onCommit={(hours) =>
                void updateRule({ ruleId: rule._id, offsetHours: hours })
              }
            />
            {t("settings.ruleHoursBefore")}
          </span>
        );
      case "after_end":
        return (
          <span className="flex items-center gap-1.5">
            <InlineNumber
              value={rule.offsetHours}
              min={1}
              max={720}
              label={t("settings.ruleHoursAfterEnd")}
              onCommit={(hours) =>
                void updateRule({ ruleId: rule._id, offsetHours: hours })
              }
            />
            {t("settings.ruleHoursAfterEnd")}
          </span>
        );
      case "no_show":
        return (
          <span className="flex items-center gap-1.5">
            <InlineNumber
              value={Math.round(rule.offsetHours / 24)}
              min={1}
              max={90}
              label={t("settings.ruleDaysAfterNoShow")}
              onCommit={(days) =>
                void updateRule({ ruleId: rule._id, offsetHours: days * 24 })
              }
            />
            {t("settings.ruleDaysAfterNoShow")}
          </span>
        );
      case "out_of_hours":
        return <>{t("settings.ruleWhenClosed")}</>;
    }
  };

  // The add chips: reminder presets not yet on the table, the singletons when
  // absent, and the follow-up ALWAYS — a 2h review ask and a three-week
  // rebooking nudge are two rows, and the chip is how the second one gets in.
  const reminderOffsets = rules
    .filter((r) => r.trigger === "before_start")
    .map((r) => r.offsetHours);
  const unusedPresets = OFFSET_PRESETS.filter((h) => !reminderOffsets.includes(h));
  const missingSingles = (
    [
      ["booking", "settings.ruleConfirmation"],
      ["cancellation", "settings.ruleCancellation"],
      ["no_show", "settings.ruleWinback"],
      ["out_of_hours", "settings.ruleOutOfHours"],
    ] as const
  ).filter(([trigger]) => !rules.some((r) => r.trigger === trigger));

  const addDefaults: Partial<Record<RuleTrigger, number>> = {
    after_end: 24,
    no_show: 14 * 24,
  };
  const doAdd = (trigger: RuleTrigger, offsetHours?: number) =>
    void addRule({ trigger, offsetHours: offsetHours ?? addDefaults[trigger] ?? 0 });

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
        <span className="w-9 shrink-0" aria-hidden />
      </div>

      <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
        {rules.map((rule) => {
          const expanded = expandedId === rule._id;
          const rowChannels = wiredFor(rule);
          const ownTemplate = templates.find(
            (tpl) => tpl.ruleId === rule._id && tpl.language === org.language,
          );
          return (
            <div key={rule._id}>
              <div className="flex items-center gap-3 py-3">
                <div className={RULE_COLUMNS}>
                  <span className="flex items-center gap-1.5 text-sm">
                    {ruleWhen(rule)}
                    {rule.trigger === "no_show" && <InfoTip text={winbackHint} />}
                    {rule.trigger === "after_end" && (
                      <InfoTip text={t("settings.ruleFollowupHint")} />
                    )}
                    {rule.trigger === "out_of_hours" && (
                      <InfoTip text={t("settings.ruleOutOfHoursHint")} />
                    )}
                  </span>
                  <span className="text-sm text-[var(--muted)]">
                    {ruleName(rule.trigger)}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs">
                    {rowChannels.map((channel) => {
                      const on = activeChannels(rule).has(channel);
                      return (
                        <button
                          key={channel}
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`${ruleName(rule.trigger)} — ${channelLabel(channel)}`}
                          onClick={() => toggleChannel(rule, channel)}
                          className={`rounded-full px-2.5 py-0.5 transition-colors ${
                            on
                              ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                              : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                          }`}
                        >
                          {channelLabel(channel)}
                        </button>
                      );
                    })}
                    {rowChannels.length === 0 && (
                      <span className="hidden sm:inline text-[var(--muted)]">—</span>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleExpand(rule)}
                  aria-expanded={expanded}
                  aria-label={`${ruleName(rule.trigger)} — ${t("settings.ruleEditMessage")}`}
                  title={t("settings.ruleEditMessage")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                >
                  <span
                    aria-hidden
                    className={`inline-block transition-transform ${expanded ? "rotate-180" : ""}`}
                  >
                    ⌄
                  </span>
                </button>
              </div>
              {expanded && (
                <>
                  <RuleEditor
                    rule={rule}
                    template={ownTemplate}
                    contactFields={contactFieldRows}
                    orgName={org.name}
                    orgLanguage={org.language}
                    orgCurrency={org.currency}
                    orgTimezone={org.timezone}
                    orgBookingUrl={org.bookingUrl}
                    orgPublicPhone={org.publicPhone}
                    emailEnabled={emailEnabled}
                    waConnected={waConnected}
                    onSaveTemplate={(templateId, patch) =>
                      void updateTemplate({ templateId, ...patch })
                    }
                  />
                  {/* Deleting lives with the thing being deleted — the open
                      panel — not as a glyph on every collapsed row. */}
                  <div className="flex justify-end pb-4">
                    <button
                      type="button"
                      onClick={() => void deleteRule(rule)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      {t("settings.deleteRule")}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-3">
        <span className="text-xs text-[var(--muted)]">{t("settings.ruleAdd")}</span>
        {missingSingles.map(([trigger, key]) => (
          <button
            key={trigger}
            type="button"
            onClick={() => doAdd(trigger)}
            className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--muted)] transition-colors hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
          >
            <span aria-hidden className="text-[var(--muted)]">+</span>
            {t(key)}
          </button>
        ))}
        {unusedPresets.map((hours) => (
          <button
            key={hours}
            type="button"
            onClick={() => doAdd("before_start", hours)}
            className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--muted)] transition-colors hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
          >
            <span aria-hidden className="text-[var(--muted)]">+</span>
            {formatReminderOffset(hours, language)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => doAdd("after_end")}
          className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--muted)] transition-colors hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
        >
          <span aria-hidden className="text-[var(--muted)]">+</span>
          {t("settings.ruleFollowup")}
        </button>
      </div>

      {!orgHasChannel && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          {t("settings.rulesNoChannel")}
        </p>
      )}

      {/* The escape hatch, deliberately quiet and in the corner: back to the
          stock rules and stock wording. */}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={async () => {
            const ok = await confirm({
              title: t("settings.resetRules"),
              body: t("settings.resetRulesConfirm"),
              confirmLabel: t("settings.resetRules"),
            });
            if (!ok) return;
            setExpandedId(null);
            void resetRules({});
          }}
          className="text-xs text-[var(--muted)] transition-colors hover:text-red-600 dark:hover:text-red-400"
        >
          {t("settings.resetRules")}
        </button>
      </div>
      {confirmDialog}
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
// Pure schedule — days and open/close, nothing else. The away-reply that used
// to live here is the out_of_hours rule in Reminders now, and the booking link
// + public phone are facts about the business, edited in Business settings
// (BusinessView's BookingCard and DetailsCard). They spent a while here as a
// "Message variables" card, which named the [booking_link] / [phone] tokens
// rather than the things themselves and put a salon's own phone number
// somewhere nobody would look for it.
export function BusinessHoursCard({
  isOwner,
  org,
  update,
}: {
  isOwner: boolean;
  org: {
    timezone: string;
    businessHours?: {
      activeDays?: number[];
      startMinute?: number;
      endMinute?: number;
    };
  };
  update: (args: Record<string, unknown>) => void;
}) {
  const { t, language } = useLanguage();
  const days = weekdayNames(language);
  const hours = org.businessHours ?? {};
  const activeDays = hours.activeDays ?? [];

  const patchHours = (next: Partial<NonNullable<typeof org.businessHours>>) =>
    update({ businessHours: { ...hours, ...next } });

  return (
    // Titled since Business became one page: the chip strip used to name this
    // card, and a middle card in a stack has nothing to name it.
    <Card title={t("settings.hours")} disabled={!isOwner}>
      <div className={ROW_GRID}>
        {/* The clock the rows below are read in, and it leads them because
            "09:00 to 18:00" means nothing until you know whose 09:00. It used
            to sit in General, one chip away, which split a single thought
            across two screens: the calendar shades closed bands by projecting
            these hours from the business timezone onto the viewer's, so the
            two settings are one setting wearing two labels.

            Folding Hours INTO General was the other way to close that gap and
            was rejected twice, most recently 2026-08-12. General already
            carries nine rows across three unrelated jobs, and a chip strip
            where one chip scrolls while five swap the pane is two grammars in
            one control. Moving the single coupled row is the smaller fix. */}
        <RowLabel label={t("settings.timezone")} hint={t("settings.timezoneHint")} />
        <TimezoneSelect
          value={org.timezone}
          onChange={(zone) => update({ timezone: zone })}
        />
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

        {/* ONE row, not two. Opening and closing are not two settings, they
            are the two ends of one range, and giving each its own labelled row
            made the reader parse a relationship the word "to" states outright.
            It also cost the card a third of its height to say one thing.

            Still two inputs, which is the rule ("split compound values into
            two labelled inputs"): what that forbids is one box parsing two
            syntaxes, not two boxes sharing a row. Each keeps its own accessible
            name, since the visible label now covers the pair.

            Phrased to match "Days you're open" directly above it. */}
        <RowLabel label={t("settings.openHours")} />
        <div className="flex items-center gap-2">
          <input
            type="time"
            aria-label={t("settings.openFrom")}
            className="min-w-0 flex-1"
            defaultValue={
              hours.startMinute == null ? "" : minutesToTimeValue(hours.startMinute)
            }
            onChange={(e) => patchHours({ startMinute: timeValueToMinutes(e.target.value) })}
          />
          <span className="shrink-0 text-sm text-[var(--muted)]">
            {t("settings.openUntil")}
          </span>
          <input
            type="time"
            aria-label={t("settings.openTo")}
            className="min-w-0 flex-1"
            defaultValue={hours.endMinute == null ? "" : minutesToTimeValue(hours.endMinute)}
            onChange={(e) => patchHours({ endMinute: timeValueToMinutes(e.target.value) })}
          />
        </div>
      </div>
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
  const rulesData = useQuery(api.messageRules.list, {});
  const update = useMutation(api.orgs.update);
  const updateTemplate = useMutation(api.orgs.updateTemplate);

  if (!settings || !rulesData)
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;

  // Backend enforces this too (requireOwner); the fieldsets are just honest UI.
  const isOwner = settings.me.role !== "staff";
  // Which model this org runs on. Legacy renders the old card untouched; it
  // exists only for the window between the deploy and messageRules:migrateAll.
  const migrated = rulesData.migrated;

  // What the lower templates card still owns. Rule-bound wording moved into
  // each rule's own panel, so on the rules model this card is the Meta
  // registration desk (plus the campaign row, which was always its own thing):
  // rows only exist to be edited when a Cloud number makes approval a real
  // concept. Legacy orgs keep the full editor they had.
  const metaTemplates = settings.templates.filter((template) => {
    if (template.ruleId !== undefined) return false;
    if (template.kind === "campaign")
      // The campaign's email subject moved into the campaign composer, where
      // campaigns are actually written. What is left of this row is its Meta
      // registration, which only exists as a concept on a Cloud number —
      // legacy orgs keep the old behaviour.
      return migrated
        ? settings.whatsapp.connected
        : settings.whatsapp.connected || settings.emailEnabled;
    return migrated ? settings.whatsapp.connected : true;
  });

  return (
    // Wider than the settings default: the expanded rule panel is a real
    // split-pane (editor beside a rendered email) and 3xl squeezed both.
    <div className="mx-auto max-w-5xl space-y-4 page-stack">
      {!isOwner && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-xs text-[var(--muted)]">
          {t("settings.ownerOnly")}
        </p>
      )}

      {migrated ? (
        <>
          <RulesCard
            isOwner={isOwner}
            org={settings.org}
            templates={settings.templates}
            rules={rulesData.rules}
            waConnected={settings.whatsapp.connected}
            evolutionEnabled={settings.evolutionEnabled}
            emailEnabled={settings.emailEnabled}
          />
        </>
      ) : (
        <>
          <p className="rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            {t("settings.rulesMigrationPending")}
          </p>
          <NotificationRulesCard
            isOwner={isOwner}
            org={settings.org}
            templates={settings.templates}
            waConnected={settings.whatsapp.connected}
            evolutionEnabled={settings.evolutionEnabled}
            emailEnabled={settings.emailEnabled}
            update={(args) => void update(args)}
          />
        </>
      )}

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
          {metaTemplates.length > 0 && (
          <Card
            title={t("settings.templates")}
            tip={t("settings.templatesHint")}
            disabled={!isOwner}
          >
            <div className="divide-y divide-[var(--border)]">
              {metaTemplates
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
                              : template.kind === "followup"
                                ? t("settings.ruleFollowup")
                                : template.kind === "cancellation"
                                  ? t("settings.ruleCancellation")
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
                    {!migrated && template.kind !== "campaign" && (
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
                        else's (campaigns.fanOut renders it per customer). On
                        the rules model every other subject lives in its
                        rule's panel. */}
                    {(!migrated || template.kind === "campaign") && settings.emailEnabled && (
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
          )}
        </>

      <ShopPhoneCard isOwner={isOwner} />

    </div>
  );
}
