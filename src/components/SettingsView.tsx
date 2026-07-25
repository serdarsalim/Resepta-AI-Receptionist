"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { LANGUAGES, type TranslationKey } from "@/lib/i18n";
import { RowLabel } from "./RowLabel";
import { Toggle } from "./Toggle";
import { InfoTip } from "./InfoTip";

const TIMEZONES = [
  "Europe/Istanbul",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/London",
  "UTC",
];

// Nudge settings conventions: label-left/input-right on the shared RowLabel
// grid, autosave on blur/change, explanations behind InfoTips.
// Settings row grid, per Serdar's documented spec (Mana 40_Patterns,
// 2026-05-08): label column 220-260px, label only (no helper text in it),
// control right, stacks on mobile. Helper text spans the section BELOW the
// row — not squeezed into the label column.
const ROW_GRID =
  "grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-[minmax(220px,260px)_1fr] sm:items-start";

function Card({ title, tip, disabled, children }: {
  // Omitted when the section chip above already names the card — a section
  // with one card would otherwise stack "Reminders" under "Reminders".
  title?: string;
  tip?: string;
  // Staff see owner-only cards read-only; a native fieldset disables every
  // input/button inside without per-control wiring.
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      {title && (
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {tip && <InfoTip text={tip} />}
        </div>
      )}
      <fieldset disabled={disabled} className={disabled ? "opacity-70" : undefined}>
        {children}
      </fieldset>
    </section>
  );
}

function TeamCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const team = useQuery(api.team.overview, {});
  const invite = useMutation(api.team.invite);
  const revokeInvite = useMutation(api.team.revokeInvite);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title={t("team.title")} tip={t("team.inviteHint")}>
      {team === undefined ? (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y divide-[var(--border)]">
            {team.members.map((member) => (
              <li key={member._id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="truncate font-medium">
                    {member.name || member.email}
                    {member.isMe && (
                      <span className="ml-1 text-xs text-[var(--muted)]">
                        ({t("team.you")})
                      </span>
                    )}
                  </span>
                  {member.name && member.email && (
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {member.email}
                    </span>
                  )}
                </span>
                <span className="rounded-full bg-[var(--muted-bg)] px-2 py-0.5 text-xs text-[var(--muted)]">
                  {member.role === "staff" ? t("role.staff") : t("role.owner")}
                </span>
              </li>
            ))}
            {team.pending.map((pendingInvite) => (
              <li key={pendingInvite._id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="truncate text-[var(--muted)]">{pendingInvite.email}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {t("team.pending")} ·{" "}
                    {pendingInvite.role === "staff" ? t("role.staff") : t("role.owner")}
                  </span>
                </span>
                {isOwner && (
                  <button
                    className="rounded-md px-2 py-1 text-xs text-red-600 transition-colors hover:bg-[var(--muted-bg)] dark:text-red-400"
                    onClick={() => void revokeInvite({ inviteId: pendingInvite._id })}
                  >
                    {t("team.revoke")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isOwner && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const formEl = event.currentTarget;
                const form = new FormData(formEl);
                setError(null);
                try {
                  await invite({
                    email: String(form.get("email") ?? ""),
                    role: form.get("role") === "owner" ? "owner" : "staff",
                  });
                  formEl.reset();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "error");
                }
              }}
            >
              <input
                name="email"
                type="email"
                required
                placeholder="ornek@gmail.com"
                className="w-56"
              />
              <select name="role" defaultValue="staff" className="w-auto">
                <option value="staff">{t("role.staff")}</option>
                <option value="owner">{t("role.owner")}</option>
              </select>
              <button
                type="submit"
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
              >
                {t("team.invite")}
              </button>
              {error && (
                <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

function FieldsCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const fields = useQuery(api.contactFields.list, {});
  const createField = useMutation(api.contactFields.create);
  const removeField = useMutation(api.contactFields.remove);
  const [type, setType] = useState<"text" | "select" | "number" | "date">("text");
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title={t("fields.title")} tip={t("fields.hint")} disabled={!isOwner}>
      <ul className="mb-3 divide-y divide-[var(--border)]">
        {(fields ?? []).map((field) => (
          <li key={field._id} className="flex items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{field.label}</span>
              <span className="ml-2 text-xs text-[var(--muted)]">
                {t(`fields.type.${field.type}` as "fields.type.text")}
                {field.options?.length ? ` · ${field.options.join(", ")}` : ""}
              </span>
            </span>
            {isOwner && (
              <button
                className="rounded-md px-2 py-1 text-xs text-red-600 transition-colors hover:bg-[var(--muted-bg)] dark:text-red-400"
                onClick={() => void removeField({ fieldId: field._id })}
              >
                {t("common.delete")}
              </button>
            )}
          </li>
        ))}
      </ul>
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
                options:
                  type === "select"
                    ? String(form.get("options") ?? "")
                        .split(",")
                        .map((o) => o.trim())
                        .filter(Boolean)
                    : undefined,
              });
              formEl.reset();
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

// Reminder timing as toggle chips — a salon owner taps "1 gün önce", never
// types "24, 2". Amber = selection (Nudge: amber selects, blue acts).
const OFFSET_PRESETS = [48, 24, 3, 2, 1];

function OffsetChips({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const { language } = useLanguage();
  const label = (h: number) =>
    language === "tr"
      ? h % 24 === 0
        ? `${h / 24} gün önce`
        : `${h} saat önce`
      : h % 24 === 0
        ? `${h / 24} day${h > 24 ? "s" : ""} before`
        : `${h} hour${h > 1 ? "s" : ""} before`;
  return (
    <div className="flex flex-wrap gap-1.5">
      {OFFSET_PRESETS.map((hours) => {
        const active = selected.includes(hours);
        return (
          <button
            key={hours}
            type="button"
            onClick={() =>
              onChange(
                active
                  ? selected.filter((h) => h !== hours)
                  : [...selected, hours].sort((a, b) => b - a),
              )
            }
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              active
                ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            }`}
          >
            {label(hours)}
          </button>
        );
      })}
    </div>
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

// Settings is one sidebar destination with sections inside it, rather than
// eight cards on one long scroll. Workspace setup leads: it is the business
// itself (name, who works here, what a customer record holds); the rest are
// the channels hanging off it.
type Section = "workspace" | "reminders" | "whatsapp" | "bookings" | "voice";

const SECTIONS: { id: Section; key: TranslationKey }[] = [
  { id: "workspace", key: "settings.section.workspace" },
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
  const [section, setSection] = useState<Section>("workspace");
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

      {section === "workspace" && (
        <>
          <Card title={t("settings.business")} disabled={!isOwner}>
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
            </div>
          </Card>

          <TeamCard isOwner={isOwner} />

          <FieldsCard isOwner={isOwner} />
        </>
      )}

      {section === "reminders" && (
        <Card disabled={!isOwner}>
          <div className={ROW_GRID}>
            <RowLabel
              label={t("settings.reminderOffsets")}
              hint={t("settings.reminderOffsetsHint")}
            />
            <OffsetChips
              selected={settings.org.reminderOffsetsHours}
              onChange={(next) => void update({ reminderOffsetsHours: next })}
            />
            <RowLabel label={t("settings.sendConfirmation")} />
            <Toggle
              checked={settings.org.sendBookingConfirmation}
              onChange={(next) => void update({ sendBookingConfirmation: next })}
            />
          </div>
        </Card>
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
