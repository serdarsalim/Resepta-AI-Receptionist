"use client";

// One message to a group of customers.
//
// The surface exists to answer two questions before anything is sent: who is
// this going to, and can it go at all. Both are shown before the Send button
// is reachable, because a campaign cannot be recalled and "how many people is
// this?" is the question that stops one going to the wrong list.
//
// Why the template gate is so loud: WhatsApp refuses free text to anyone who
// has not written to you first, so a campaign MUST ride a Meta-approved
// template. An owner who does not understand that will read a failed run as
// the product being broken. See convex/campaigns.ts for the shape that makes
// one approval cover every campaign.

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { Card } from "./Card";
import { RowLabel } from "./RowLabel";
import { Sheet } from "./Sheet";

type Segment = {
  notSeenForDays?: number;
  neverBooked?: boolean;
  serviceId?: Id<"services">;
};

export function CampaignsView() {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  const campaigns = useQuery(api.campaigns.list, {});
  const ensureTemplate = useMutation(api.orgs.ensureCampaignTemplate);
  const [composing, setComposing] = useState(false);

  if (!settings || campaigns === undefined) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }
  const isOwner = settings.me.role !== "staff";
  const template = settings.templates.find(
    (row) => row.kind === "campaign" && row.status === "approved",
  );
  const draftExists = settings.templates.some((row) => row.kind === "campaign");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* The gate, not a warning to skim past: without this nothing sends. */}
      {!template && (
        <Card title={t("campaign.title")} tip={t("campaign.whyTemplate")}>
          <p className="text-sm text-[var(--muted)]">{t("campaign.needsTemplate")}</p>
          {!draftExists && isOwner && (
            <button
              type="button"
              onClick={() => void ensureTemplate()}
              className="mt-3 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
            >
              {t("campaign.createTemplate")}
            </button>
          )}
        </Card>
      )}

      <Card title={t("campaign.title")} disabled={!isOwner}>
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setComposing(true)}
            disabled={!template}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {t("campaign.new")}
          </button>
        </div>

        {campaigns.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("campaign.empty")}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {campaigns.map((campaign) => (
              // One line per run. The counts only appear once they mean
              // something — a draft showing "0 sent, 0 failed" is three zeroes
              // saying nothing has happened yet, which the word Draft says
              // better.
              <li key={campaign._id} className="py-2">
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {campaign.name}
                  </span>
                  {campaign.status === "draft" ? (
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {t("campaign.draft")}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                      {campaign.sent} {t("campaign.sent")}
                      {campaign.pending > 0 &&
                        ` · ${campaign.pending} ${t("campaign.pending")}`}
                      {campaign.failed > 0 && (
                        <span className="text-red-600 dark:text-red-400">
                          {" "}
                          · {campaign.failed} {t("campaign.failed")}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-[var(--muted)]">{campaign.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {composing && <ComposeSheet onClose={() => setComposing(false)} />}
    </div>
  );
}

// Adding opens a sheet — never a permanent empty form at the foot of the list.
// A campaign is written a few times a year and the list is what the page is
// for the rest of the time.
function ComposeSheet({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const services = useQuery(api.services.list, {});
  const create = useMutation(api.campaigns.create);
  const send = useAction(api.campaigns.send);

  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [notSeenForDays, setNotSeenForDays] = useState<number | "">(90);
  const [neverBooked, setNeverBooked] = useState(false);
  const [serviceId, setServiceId] = useState<Id<"services"> | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const segment: Segment = {
    ...(notSeenForDays !== "" && !neverBooked ? { notSeenForDays } : {}),
    ...(neverBooked ? { neverBooked: true } : {}),
    ...(serviceId ? { serviceId: serviceId as Id<"services"> } : {}),
  };
  // Live, so the number moves as the filters do. This is the whole safety
  // mechanism of the screen.
  const preview = useQuery(api.campaigns.previewCount, { segment });

  const submit = async () => {
    if (!body.trim() || !preview?.count) return;
    if (!window.confirm(t("campaign.sendConfirm"))) return;
    setBusy(true);
    setError(null);
    try {
      const campaignId = await create({ name, body, segment });
      const result = await send({ campaignId });
      if (result.ok) onClose();
      else setError(result.reason ?? "error");
    } catch {
      setError("error");
    }
    setBusy(false);
  };

  return (
    <Sheet title={t("campaign.new")} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <RowLabel label={t("campaign.name")} hint={t("campaign.nameHint")} />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full"
          />
        </div>

        <div>
          <RowLabel label={t("campaign.body")} hint={t("campaign.bodyHint")} />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            className="w-full resize-none"
          />
        </div>

        <div>
          <RowLabel label={t("campaign.segment")} hint={t("campaign.consentNote")} />
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={neverBooked}
                onChange={(event) => setNeverBooked(event.target.checked)}
              />
              {t("campaign.neverBooked")}
            </label>
            {/* Disabled rather than hidden when "never came" is on: the two
                filters contradict each other, and a control that vanishes
                leaves the reader wondering what they did. */}
            <label
              className={`flex items-center gap-2 text-sm ${
                neverBooked ? "opacity-40" : ""
              }`}
            >
              <input
                type="number"
                min={1}
                max={3650}
                disabled={neverBooked}
                value={notSeenForDays}
                onChange={(event) =>
                  setNotSeenForDays(
                    event.target.value === "" ? "" : Number(event.target.value),
                  )
                }
                className="w-20"
              />
              {t("campaign.notSeenFor")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <select
                value={serviceId}
                onChange={(event) =>
                  setServiceId(event.target.value as Id<"services"> | "")
                }
                className="max-w-[16rem]"
              >
                <option value="">—</option>
                {services?.map((service) => (
                  <option key={service._id} value={service._id}>
                    {service.name}
                  </option>
                ))}
              </select>
              {t("campaign.hadService")}
            </label>
          </div>
          <p className="pt-2 text-xs text-[var(--muted)]">
            {t("campaign.notSeenHint")}
          </p>
        </div>

        {/* The count sits directly above the button that acts on it. */}
        <p className="text-sm">
          {preview === undefined ? (
            <span className="text-[var(--muted)]">{t("common.loading")}</span>
          ) : preview.count === 0 ? (
            <span className="text-[var(--muted)]">{t("campaign.noRecipients")}</span>
          ) : (
            <span>
              <span className="font-medium tabular-nums">
                {preview.count}
                {preview.capped ? "+" : ""}
              </span>{" "}
              {t("campaign.recipients")}
            </span>
          )}
        </p>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !body.trim() || !preview?.count}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {t("campaign.send")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
