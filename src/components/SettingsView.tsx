"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { LANGUAGES } from "@/lib/i18n";
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
const ROW_GRID =
  "grid grid-cols-1 gap-y-2 sm:grid-cols-[22rem_1fr] sm:items-center sm:gap-x-4 sm:gap-y-3";

function Card({ title, tip, disabled, children }: {
  title: string;
  tip?: string;
  // Staff see owner-only cards read-only; a native fieldset disables every
  // input/button inside without per-control wiring.
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {tip && <InfoTip text={tip} />}
      </div>
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
                    className="text-xs text-red-600 underline dark:text-red-400"
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
                className="w-64 flex-1"
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

export function SettingsView() {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const update = useMutation(api.orgs.update);
  const connectWhatsapp = useMutation(api.orgs.connectWhatsapp);
  const disconnectWhatsapp = useMutation(api.orgs.disconnectWhatsapp);
  const updateTemplate = useMutation(api.orgs.updateTemplate);
  const rotateToken = useMutation(api.calcom.rotateWebhookToken);
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
      {!isOwner && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-xs text-[var(--muted)]">
          {t("settings.ownerOnly")}
        </p>
      )}
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

      <Card title={t("settings.reminders")} disabled={!isOwner}>
        <div className={ROW_GRID}>
          <RowLabel label={t("settings.reminderOffsets")} hint="24, 2" />
          <input
            defaultValue={settings.org.reminderOffsetsHours.join(", ")}
            onBlur={(e) =>
              void update({
                reminderOffsetsHours: e.target.value
                  .split(",")
                  .map((part) => Number(part.trim()))
                  .filter((n) => Number.isFinite(n) && n > 0),
              })
            }
          />
          <RowLabel label={t("settings.sendConfirmation")} />
          <Toggle
            checked={settings.org.sendBookingConfirmation}
            onChange={(next) => void update({ sendBookingConfirmation: next })}
          />
        </div>
      </Card>

      <TeamCard isOwner={isOwner} />

      <Card title={t("settings.whatsapp")} disabled={!isOwner}>
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
              className="ml-auto rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-red-600 dark:text-red-400"
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

      <Card title={t("settings.templates")} tip={t("settings.templatesHint")} disabled={!isOwner}>
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
                <option value="draft">draft</option>
                <option value="pending">pending</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
              </select>
            </div>
          ))}
        </div>
      </Card>

      <Card title={t("settings.bookings")} tip={t("settings.calcomHint")} disabled={!isOwner}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
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
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
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
      </Card>
    </div>
  );
}
