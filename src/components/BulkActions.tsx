"use client";

// Bulk actions on the contacts ticked in the Customers table: the composer
// that launches one, and the history that reads them back.
//
// The composer is a SHEET over the list, not a screen of its own, because it
// closes back to the selection it was launched from — and the tick set has to
// survive it. The history is the third sub-tab beside List and Fields, and it
// is read-only on purpose: composing there would mean picking recipients from
// a screen that has no contact list on it.
//
// Every gate this file draws is a disabled control with a hint, never a thrown
// error. A run cannot be recalled, so the moment to learn that WhatsApp has no
// approved template, or that eleven of the forty people ticked never gave
// consent, is before the button — not in the run detail afterwards.

import { useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useLanguage, useT } from "@/lib/LanguageProvider";
import { formatAge } from "@/lib/datetime";
import { useConfirm } from "./ConfirmDialog";
import { EmojiPicker } from "./EmojiPicker";
import { RowLabel } from "./RowLabel";
import { Sheet } from "./Sheet";
import { VariableInsertDropdown } from "./VariableInsertDropdown";

export type BulkChannel = "email" | "whatsapp" | "call";

// Mirrors convex/bulkRuns.skipReason, and it has to: the composer promises a
// number before anything is written and the fan-out decides the real one, so
// the two answering differently is the feature lying to the person using it.
// The server re-checks anyway — consent can be withdrawn between the two —
// and anybody it drops that this did not shows up as a skipped row.
function canReach(customer: Doc<"customers">, channel: BulkChannel): boolean {
  if (customer.consentAt === undefined) return false;
  if (channel === "email") return Boolean(customer.email);
  return /^\+[1-9]\d{6,14}$/.test(customer.phone);
}

// The launch action answers with a machine reason; this turns it into the one
// sentence the person should read. A map rather than a dynamic key, because
// the dictionary is typed and a reason string that drifted would otherwise
// render as the raw token in front of a customer-facing screen.
//
// Everything unmapped collapses to the generic line on purpose. These are all
// pre-flight refusals the composer already gates for, so reaching one means a
// state changed between the sheet opening and the button — rare, and not worth
// a dedicated sentence each.
function errorKey(reason: string) {
  switch (reason) {
    case "wallet-empty":
      return "bulk.walletEmpty" as const;
    case "org-suspended":
      return "bulk.errorSuspended" as const;
    case "demo-org":
      return "bulk.errorDemo" as const;
    case "none-eligible":
    case "no-recipients":
      return "bulk.noneEligible" as const;
    case "no-campaign-template":
      return "bulk.waTemplatePending" as const;
    case "email-not-configured":
      return "bulk.emailNotReady" as const;
    case "wa-not-configured":
      return "bulk.waNotReady" as const;
    case "agent-not-found":
    case "agent-disabled":
    case "no-outbound-line":
    case "no-agent":
      return "bulk.noDialableAgent" as const;
    default:
      return "bulk.errorGeneric" as const;
  }
}

// ── Composer ────────────────────────────────────────────────────────────────

export function BulkComposer({
  channel,
  customers,
  onClose,
  onSent,
}: {
  channel: BulkChannel;
  customers: Doc<"customers">[];
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useLanguage();
  const options = useQuery(api.bulkRuns.launchOptions, {});
  const launch = useAction(api.bulkRuns.launch);
  const [confirm, confirmDialog] = useConfirm();

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Inserts land at the cursor, not the end — the rule editor's pattern, and
  // the campaign composer's.
  const insertAtCursor = (token: string) => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const cursor = start + token.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  const reachable = useMemo(
    () => customers.filter((customer) => canReach(customer, channel)),
    [customers, channel],
  );
  const skipped = customers.length - reachable.length;

  // Why this run cannot start, if it cannot. One reason at a time and the
  // most fundamental first, so the hint under the button names the thing to
  // go and fix rather than the last check that happened to fail.
  const blocker: string | null = (() => {
    if (!options) return null;
    if (!options.isOwner) return t("bulk.ownerOnly");
    if (options.walletEmpty) return t("bulk.walletEmpty");
    if (reachable.length === 0) return t("bulk.noneEligible");
    if (customers.length > options.maxRecipients) {
      return t("bulk.tooMany").replace("{n}", String(options.maxRecipients));
    }
    if (channel === "email" && !options.emailReady) return t("bulk.emailNotReady");
    if (channel === "whatsapp") {
      if (!options.waReady) return t("bulk.waNotReady");
      // The one gate that is about Meta rather than about this app, and the
      // reason the WhatsApp lane ships dark. Approved booking templates are
      // UTILITY-category and worded for a confirmation; blasting one to
      // people with no appointment is both untrue and the exact behaviour
      // Meta pauses templates and downgrades number quality for. The lane
      // lights up on its own the moment a campaign-kind template is approved
      // — no code change, no deploy.
      if (!options.waTemplateReady) return t("bulk.waTemplatePending");
      if (reachable.length > options.maxWaRecipients) {
        return t("bulk.waTooMany").replace("{n}", String(options.maxWaRecipients));
      }
    }
    if (channel === "call" && !options.agents.some((agent) => agent.canDial)) {
      return t("bulk.noDialableAgent");
    }
    return null;
  })();

  const dialable = options?.agents.filter((agent) => agent.canDial) ?? [];
  // options undefined means the gates have not loaded, and blocker answers
  // null for a reason it has not checked yet. Sending then would reach the
  // server's own refusal ladder and come back as an error toast — correct, but
  // a button that looks live before anything has been verified is a button
  // that invites the click.
  const ready =
    Boolean(options) &&
    !blocker &&
    (channel === "call"
      ? Boolean(agentId)
      : Boolean(body.trim()) && (channel !== "email" || Boolean(subject.trim())));

  const submit = async () => {
    if (!ready || busy) return;
    // Not destructive — this is a send, so the button keeps the accent colour
    // and says the verb. The count is in the title because it is the fact
    // somebody is actually confirming.
    const ok = await confirm({
      title: t(
        channel === "call" ? "bulk.confirmCall" : "bulk.confirmSend",
      ).replace("{n}", String(reachable.length)),
      confirmLabel: t(`bulk.${channel}`),
      destructive: false,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const result = await launch({
        channel,
        customerIds: customers.map((customer) => customer._id),
        ...(channel === "call"
          ? { retellAgentId: agentId }
          : {
              body,
              ...(channel === "email"
                ? { emailSubject: subject }
                : {}),
            }),
      });
      if (result.ok) onSent();
      else setError(result.reason ?? "error");
    } catch {
      setError("error");
    }
    setBusy(false);
  };

  return (
    <Sheet title={t(`bulk.compose.${channel}`)} onClose={onClose}>
      {confirmDialog}
      <div className="space-y-3">
        {/* The count, before anything else on the sheet. "How many people is
            this" is the question that stops a run going to the wrong list,
            and the skipped line is the half nobody expects: under KVKK
            consent gates everything, so a selection of forty can be a run of
            twenty-nine and the difference should never be a surprise found
            afterwards in the history. */}
        <p className="text-sm">
          {t("bulk.willReach").replace("{n}", String(reachable.length))}
          {skipped > 0 && (
            <span className="text-[var(--muted)]">
              {" "}
              {t("bulk.willSkip").replace("{n}", String(skipped))}
            </span>
          )}
        </p>

        {channel === "email" && (
          <div>
            <RowLabel label={t("bulk.subject")} />
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="w-full"
              data-sheet-autofocus
            />
          </div>
        )}

        {channel !== "call" && (
          <div>
            <RowLabel
              label={t("bulk.body")}
              hint={
                channel === "whatsapp"
                  ? t("bulk.bodyHintWa")
                  : t("bulk.bodyHintEmail")
              }
            />
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              // One row for WhatsApp, and the hint says why: Meta refuses a
              // template body parameter containing a newline (error 132000),
              // and it refuses it PER RECIPIENT — so a message written with
              // line breaks fails the whole run one row at a time. The
              // fan-out flattens whitespace as a second belt, but a composer
              // that invites four paragraphs and then silently reflows them
              // is worse than one that never offered the room.
              rows={channel === "whatsapp" ? 2 : 5}
              className="w-full resize-none"
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <VariableInsertDropdown onInsert={insertAtCursor} />
              <EmojiPicker onPick={insertAtCursor} title={t("editor.insertEmoji")} />
            </div>
            {/* What the first person in the selection actually receives.
                Tokens are the whole reason a bulk message is not just a
                broadcast, and an unrendered [first_name] in a hundred inboxes
                is the mistake this line exists to catch. */}
            {body.trim() && reachable[0] && (
              <p className="mt-2 rounded-lg bg-[var(--row-hover-bg)] px-3 py-2 text-xs text-[var(--muted-strong)]">
                {t("bulk.previewFor").replace("{name}", reachable[0].firstName)}{" "}
                {body.replace(/\[first_name\]/g, reachable[0].firstName)}
              </p>
            )}
          </div>
        )}

        {channel === "call" && (
          <div>
            <RowLabel label={t("bulk.agent")} hint={t("bulk.callHint")} />
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="w-full"
              data-sheet-autofocus
            >
              <option value="">{t("bulk.pickAgent")}</option>
              {dialable.map((agent) => (
                <option key={agent.retellAgentId} value={agent.retellAgentId}>
                  {agent.name ?? agent.retellAgentId}
                </option>
              ))}
            </select>
          </div>
        )}

        {blocker && <p className="text-sm text-amber-600 dark:text-amber-500">{blocker}</p>}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{t(errorKey(error))}</p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-3 text-sm text-[var(--muted-strong)]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!ready || busy}
            className="h-9 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-40"
          >
            {busy ? t("common.loading") : t(`bulk.${channel}`)}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ── History ─────────────────────────────────────────────────────────────────

// The runs an org has fired, newest first, and one of them opened.
//
// Read-only by design. Composing here would mean choosing recipients on a
// screen with no contact list, which is how nudge ended up with two screens
// wearing one tab. The verbs live on the selection in the list one tab over;
// what lives here is pause, resume, stop, and the answer to "what actually
// happened to these people".
export function BulkRunsCard({
  onOpenContact,
}: {
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t, language } = useLanguage();
  const runs = useQuery(api.bulkRuns.list, {});
  const [openRun, setOpenRun] = useState<Id<"bulkRuns"> | null>(null);

  if (runs === undefined) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }
  if (openRun) {
    return (
      <RunDetail
        runId={openRun}
        onBack={() => setOpenRun(null)}
        onOpenContact={onOpenContact}
      />
    );
  }
  if (runs.length === 0) {
    return (
      <div className="rounded-lg bg-[var(--card)] p-4 shadow-[var(--card-shadow)]">
        <p className="text-sm text-[var(--muted)]">{t("bulk.noRuns")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg bg-[var(--card)] shadow-[var(--card-shadow)]">
      <ul className="divide-y divide-[var(--table-divider)]">
        {runs.map((run) => (
          <li key={run._id}>
            <button
              type="button"
              onClick={() => setOpenRun(run._id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{run.label}</span>
                  <StatusPill status={run.status} />
                </span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">
                  {t(`bulk.${run.channel}`)} · {formatAge(run.startedAt, language)}
                </span>
              </span>
              {/* Counts, not a bar. A bar reads as progress toward a finish
                  line and half of these runs finish with rows deliberately
                  never attempted, which a bar has no way to show. */}
              <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                {run.doneCount}/{run.totalCount}
                {run.failedCount > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    {" "}
                    · {run.failedCount}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const t = useT();
  const tone =
    status === "running"
      ? "text-emerald-600 dark:text-emerald-400"
      : status === "paused"
        ? "text-amber-600 dark:text-amber-500"
        : status === "cancelled"
          ? "text-red-600 dark:text-red-400"
          : "text-[var(--muted)]";
  return (
    <span className={`shrink-0 text-xs ${tone}`}>
      {t(
        status === "running"
          ? "bulk.statusRunning"
          : status === "paused"
            ? "bulk.statusPaused"
            : status === "cancelled"
              ? "bulk.statusCancelled"
              : "bulk.statusDone",
      )}
    </span>
  );
}

function RunDetail({
  runId,
  onBack,
  onOpenContact,
}: {
  runId: Id<"bulkRuns">;
  onBack: () => void;
  onOpenContact: (id: Id<"customers">) => void;
}) {
  const { t, language } = useLanguage();
  const detail = useQuery(api.bulkRuns.detail, { runId });
  const setStatus = useMutation(api.bulkRuns.setStatus);
  const [confirm, confirmDialog] = useConfirm();

  if (detail === undefined) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }
  if (detail === null) {
    return <p className="text-sm text-[var(--muted)]">{t("bulk.noRuns")}</p>;
  }

  const { run, items } = detail;
  const live = run.status === "running" || run.status === "paused";

  const stop = async () => {
    // Destructive, and said plainly: what is already ringing or already with
    // the provider is gone. A stop button that implied otherwise would be
    // making a promise the phone network does not keep.
    const ok = await confirm({
      title: t("bulk.stopConfirm"),
      confirmLabel: t("bulk.stop"),
      destructive: true,
    });
    if (ok) await setStatus({ runId, status: "cancelled" });
  };

  const pill =
    "h-8 rounded-lg border border-[var(--border)] px-2.5 text-xs font-medium transition-colors hover:bg-[var(--row-hover-bg)]";

  return (
    <div className="space-y-3">
      {confirmDialog}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="h-8 px-1 text-sm text-[var(--muted-strong)] transition-colors hover:text-[var(--foreground)]"
        >
          ← {t("bulk.backToRuns")}
        </button>
        <StatusPill status={run.status} />
        {live && (
          <span className="ml-auto flex items-center gap-2">
            {run.status === "running" ? (
              <button
                type="button"
                className={pill}
                onClick={() => void setStatus({ runId, status: "paused" })}
              >
                {t("bulk.pause")}
              </button>
            ) : (
              <button
                type="button"
                className={pill}
                onClick={() => void setStatus({ runId, status: "running" })}
              >
                {t("bulk.resume")}
              </button>
            )}
            <button
              type="button"
              className={`${pill} hover:text-red-600 dark:hover:text-red-400`}
              onClick={() => void stop()}
            >
              {t("bulk.stop")}
            </button>
          </span>
        )}
      </div>

      <div className="rounded-lg bg-[var(--card)] p-4 shadow-[var(--card-shadow)]">
        <p className="text-sm font-medium">{run.label}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {t(`bulk.${run.channel}`)} · {formatAge(run.startedAt, language)} ·{" "}
          {t("bulk.counts")
            .replace("{done}", String(run.doneCount))
            .replace("{total}", String(run.totalCount))
            .replace("{failed}", String(run.failedCount))
            .replace("{skipped}", String(run.skippedCount))}
        </p>
        {/* What was actually written, kept because a run is looked at weeks
            later and "which one was this" is answered by the words, not by
            the timestamp. */}
        {run.body && (
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--row-hover-bg)] px-3 py-2 text-xs text-[var(--muted-strong)]">
            {run.body}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-lg bg-[var(--card)] shadow-[var(--card-shadow)]">
        <ul className="divide-y divide-[var(--table-divider)]">
          {items.map((item: RunItem) => (
            <li
              key={item._id}
              className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-[var(--row-hover-bg)]"
              onClick={() => onOpenContact(item.customerId)}
            >
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <ItemOutcome item={item} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type RunItem = {
  _id: string;
  customerId: Id<"customers">;
  name: string;
  status: string;
  reason?: string;
  durationSec?: number;
  disconnectionReason?: string;
  messageStatus?: string;
  messageError?: string;
  openedAt?: number;
  repliedAt?: number;
};

// One line per recipient, and the ladder is deliberate: the most meaningful
// thing that happened wins. A reply beats an open beats a delivery, because
// by the time somebody answered, "it was delivered" is not the news.
//
// A skipped row says WHY, verbatim. That is the whole point of skipping rather
// than dropping: a run that quietly lost eleven people is how "I sent it to
// everyone" becomes false.
function ItemOutcome({ item }: { item: RunItem }) {
  const t = useT();
  const muted = "shrink-0 text-xs text-[var(--muted)]";

  if (item.status === "skipped") {
    return (
      <span className="shrink-0 text-xs text-amber-600 dark:text-amber-500">
        {t(
          item.reason === "no-consent"
            ? "bulk.skipNoConsent"
            : item.reason === "no-email"
              ? "bulk.skipNoEmail"
              : item.reason === "bad-phone"
                ? "bulk.skipBadPhone"
                : "bulk.skipOther",
        )}
      </span>
    );
  }
  if (item.status === "cancelled") return <span className={muted}>{t("bulk.itemCancelled")}</span>;
  if (item.status === "failed") {
    return (
      <span
        className="shrink-0 truncate text-xs text-red-600 dark:text-red-400"
        title={item.reason ?? item.messageError}
      >
        {t("bulk.itemFailed")}
      </span>
    );
  }
  if (item.status === "dialing") {
    return (
      <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">
        {t("bulk.itemRinging")}
      </span>
    );
  }
  if (item.status === "pending") return <span className={muted}>{t("bulk.itemPending")}</span>;

  // Done, or a message row still working its way through the delivery queue.
  if (item.repliedAt) {
    return (
      <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">
        {t("bulk.itemReplied")}
      </span>
    );
  }
  if (item.openedAt) return <span className={muted}>{t("bulk.itemOpened")}</span>;
  if (item.durationSec !== undefined) {
    // A call that connected reports how long; one that did not reports why,
    // and Retell's own disconnect code is the only thing that explains a call
    // with no summary.
    return (
      <span className={muted}>
        {item.durationSec > 0
          ? t("bulk.itemAnswered").replace("{s}", String(item.durationSec))
          : t("bulk.itemNoAnswer")}
      </span>
    );
  }
  if (item.status === "queued" && item.messageStatus === "queued") {
    return <span className={muted}>{t("bulk.itemQueued")}</span>;
  }
  return <span className={muted}>{t("bulk.itemSent")}</span>;
}
