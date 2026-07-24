"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { LANGUAGES } from "@/lib/i18n";

const TIMEZONES = [
  "Europe/Istanbul",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/London",
  "UTC",
];

// Autosave everywhere (no Save buttons) — the field commits on blur/change.
function Row({ label, hint, children }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[16rem_1fr] sm:items-center">
      <div>
        <span className="text-sm">{label}</span>
        {hint && <span className="block text-xs text-[var(--muted)]">{hint}</span>}
      </div>
      <div>{children}</div>
    </div>
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
    <div className="space-y-6">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-2 text-base font-medium">{t("settings.business")}</h2>
        <div className="divide-y divide-[var(--border)]">
          <Row label={t("settings.businessName")}>
            <input
              defaultValue={settings.org.name}
              onBlur={(e) => void update({ name: e.target.value })}
            />
          </Row>
          <Row label={t("settings.timezone")}>
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
          </Row>
          <Row label={t("settings.language")}>
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
          </Row>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-2 text-base font-medium">{t("settings.reminders")}</h2>
        <div className="divide-y divide-[var(--border)]">
          <Row label={t("settings.reminderOffsets")} hint="24, 2">
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
          </Row>
          <Row label={t("settings.sendConfirmation")}>
            <input
              type="checkbox"
              className="w-auto"
              defaultChecked={settings.org.sendBookingConfirmation}
              onChange={(e) => void update({ sendBookingConfirmation: e.target.checked })}
            />
          </Row>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-2 text-base font-medium">{t("settings.whatsapp")}</h2>
        {settings.whatsapp.connected ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs text-[var(--accent)]">
                {t("settings.waConnected")}
              </span>{" "}
              <span className="text-[var(--muted)]">
                {settings.whatsapp.displayNumber ?? settings.whatsapp.phoneNumberId} · ••••
                {settings.whatsapp.tokenTail}
              </span>
            </p>
            <button
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--danger)]"
              onClick={() => void disconnectWhatsapp({})}
            >
              {t("settings.waDisconnect")}
            </button>
          </div>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-2"
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
            <label className="text-sm">
              {t("settings.waPhoneNumberId")}
              <input name="phoneNumberId" required className="mt-1" />
            </label>
            <label className="text-sm">
              {t("customers.phone")}
              <input name="displayNumber" placeholder="+905321234567" className="mt-1" />
            </label>
            <label className="text-sm sm:col-span-2">
              {t("settings.waToken")}
              <input name="accessToken" type="password" required className="mt-1" />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
              >
                {t("settings.waConnect")}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-base font-medium">{t("settings.templates")}</h2>
        <p className="mb-2 text-xs text-[var(--muted)]">{t("settings.templatesHint")}</p>
        <ul className="divide-y divide-[var(--border)]">
          {settings.templates.map((template) => (
            <li key={template._id} className="grid gap-2 py-3 sm:grid-cols-3 sm:items-center">
              <span className="text-sm">
                {template.kind === "confirmation"
                  ? t("settings.sendConfirmation")
                  : t("settings.reminders")}
                <span className="block text-xs text-[var(--muted)]">{template.bodyPreview}</span>
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
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-base font-medium">{t("settings.bookings")}</h2>
        <p className="mb-2 text-xs text-[var(--muted)]">{t("settings.calcomHint")}</p>
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
              <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs">
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
      </section>
    </div>
  );
}
