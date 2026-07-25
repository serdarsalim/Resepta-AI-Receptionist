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

function Card({ title, tip, children }: {
  title: string;
  tip?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {tip && <InfoTip text={tip} />}
      </div>
      {children}
    </section>
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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card title={t("settings.business")}>
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

      <Card title={t("settings.reminders")}>
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

      <Card title={t("settings.whatsapp")}>
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

      <Card title={t("settings.templates")} tip={t("settings.templatesHint")}>
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

      <Card title={t("settings.bookings")} tip={t("settings.calcomHint")}>
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
