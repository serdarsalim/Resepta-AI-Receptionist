"use client";

// One message to a group of customers.
//
// A SECTION of Automations since 2026-08-26, not a sidebar destination: a
// whole door for a thing written a few times a year read as clutter (Serdar),
// and the page that already holds every message the business sends — and the
// Meta registration desk the campaign template goes through — is where it
// belongs. Rendered at the foot of RemindersView's stack, so opening a rule
// editor hides it along with everything else, per that page's drill-in rule.
//
// The section exists to answer two questions before anything is sent: who is
// this going to, and can it go at all. Both are shown before the Send button
// is reachable, because a campaign cannot be recalled and "how many people is
// this?" is the question that stops one going to the wrong list.
//
// Why the template gate is so loud: WhatsApp refuses free text to anyone who
// has not written to you first, so a campaign MUST ride a Meta-approved
// template. An owner who does not understand that will read a failed run as
// the product being broken. See convex/campaigns.ts for the shape that makes
// one approval cover every campaign.

import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useConfirm } from "./ConfirmDialog";
import { useLanguage } from "@/lib/LanguageProvider";
import { Card } from "./Card";
import { EmojiPicker } from "./EmojiPicker";
import { RowLabel } from "./RowLabel";
import { Sheet } from "./Sheet";
import { useMessageVariables, VariableInsertDropdown } from "./VariableInsertDropdown";
import { TokenTextField, type TokenTextFieldHandle } from "./TokenTextField";

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
  // The old sidebar tab was earned by connecting a number, because until one
  // is connected this is a heading over a disabled button — which reads as
  // the product being broken rather than unconfigured. Same rule as a
  // section, and the same gate the Meta registration desk beside it uses.
  if (!settings.whatsapp.connected) return null;
  const isOwner = settings.me.role !== "staff";
  const template = settings.templates.find(
    (row) => row.kind === "campaign" && row.status === "approved",
  );
  const draftExists = settings.templates.some((row) => row.kind === "campaign");

  return (
    // No page wrapper: width, rhythm and the page-stack bottom padding belong
    // to the Automations stack this sits in.
    <div className="space-y-4">
      {/* ONE card (Serdar, 2026-08-27: "why do i have 2 cards for
          campaigns?"). The approval gate used to be its own card above this
          one, which put two identically-titled cards on the page — and in
          the waiting state the top one was a paragraph with nothing to do.
          The gate is a STATE of campaigns, not a sibling of them: while no
          approved template exists it is the card's own empty line, with the
          create-draft button when even the draft is missing. Yeni kampanya
          stays visible-but-grey through the wait, because it is the control
          this card exists for and it starts working the moment review lands. */}
      <Card title={t("campaign.title")} tip={t("campaign.whyTemplate")} disabled={!isOwner}>
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

        {!template && campaigns.length === 0 ? (
          // The gate text replaces "no campaigns yet" while the template is
          // not approved: both lines would say less than either alone, and
          // this one says what to do about it.
          <>
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
          </>
        ) : campaigns.length === 0 ? (
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
                      {/* Email opens only, and only once somebody has. A run
                          with no email half stays a clean "sent" count
                          instead of a permanent "0 opened". */}
                      {campaign.opened > 0 &&
                        ` · ${campaign.opened} ${t("campaign.opened")}`}
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
  // For the email subject: whether the lane exists at all, and the shared
  // campaign template row the subject lives on (campaigns.fanOut reads it).
  const settings = useQuery(api.orgs.current, {});
  const create = useMutation(api.campaigns.create);
  const send = useAction(api.campaigns.send);
  const ensureCampaignTemplate = useMutation(api.orgs.ensureCampaignTemplate);
  const updateTemplate = useMutation(api.orgs.updateTemplate);
  const [confirm, confirmDialog] = useConfirm();

  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const bodyRef = useRef<TokenTextFieldHandle | null>(null);
  const variables = useMessageVariables();
  // Inserts land at the cursor, not the end — same pattern as the rule editor.
  const insertAtCursor = (token: string) => {
    bodyRef.current?.insert(token);
  };
  // null = untouched, render the stored value. The subject is a property of
  // "campaign mail from this salon" rather than of one campaign — it lives on
  // the template row, and this input edits it in place.
  const [subject, setSubject] = useState<string | null>(null);
  const storedSubject =
    settings?.templates.find(
      (row) => row.kind === "campaign" && row.language === settings.org.language,
    )?.subject ?? "";
  const saveSubject = async () => {
    if (subject === null || subject === storedSubject) return;
    const templateId = await ensureCampaignTemplate({});
    await updateTemplate({ templateId, subject });
  };
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
    // Not destructive — this is a SEND, so the button says the verb and stays
    // the accent colour. window.confirm could say neither: it announces itself
    // as "localhost:3006 says" and its two buttons read OK and Cancel, which is
    // the wrong wording for the most irreversible action in the product.
    const ok = await confirm({
      title: t("campaign.sendConfirm"),
      confirmLabel: t("campaign.send"),
      destructive: false,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      // The blur handler saves this too, but a click straight onto Send races
      // it; the send must not leave with last week's subject.
      await saveSubject();
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
    // The subject saves on blur to the template row, so only the name and the
    // line are a draft that Escape could lose (see Sheet's `dirty`).
    <Sheet
      title={t("campaign.new")}
      dirty={Boolean(name.trim() || body.trim())}
      onClose={onClose}
    >
      {confirmDialog}
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
          <TokenTextField
            handleRef={bodyRef}
            value={body}
            variables={variables}
            onChange={setBody}
            rows={3}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <VariableInsertDropdown onInsert={insertAtCursor} />
            <EmojiPicker onPick={insertAtCursor} title={t("editor.insertEmoji")} />
          </div>
        </div>

        {settings?.emailEnabled && (
          <div>
            <RowLabel
              label={t("settings.templateSubject")}
              hint={t("campaign.subjectHint")}
            />
            <input
              value={subject ?? storedSubject}
              onChange={(event) => setSubject(event.target.value)}
              onBlur={() => void saveSubject()}
              className="w-full"
            />
          </div>
        )}

        <div>
          <RowLabel label={t("campaign.segment")} hint={t("campaign.unsubscribedNote")} />
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
