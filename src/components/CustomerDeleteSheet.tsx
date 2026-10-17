"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { TranslationKey } from "@/lib/i18n";
import { useT } from "@/lib/LanguageProvider";
import { Sheet } from "./Sheet";

// Deleting a customer from their record (2026-10-13). Before this the only
// door was the Claude connector's preview/delete pair, so a business that got
// a KVKK erasure request could not act on it alone.
//
// The counts are the connector's preview, read live from the same FOOTPRINT
// list the sweep empties (customers.deletionPreview → customerDeletion.ts), so
// what the owner is shown is what goes, and a message landing while the sheet
// is open changes the number in front of them. Kinds with nothing in them are
// left out: a list of zeros reads as a form, not as an answer.
//
// The destructive button does NOT take focus, unlike ConfirmDialog's. That
// dialog's reasoning (whoever opened it meant to do the thing) holds for a
// removed rule or service; this one erases a person and their history with no
// undo, so Enter must not be the way it happens.

type Preview = NonNullable<FunctionReturnType<typeof api.customers.deletionPreview>>;
type Kind = keyof Preview["footprint"]["counts"];

// What the owner reads, per kind, in the order the record shows them.
const DELETED_ROWS: { label: TranslationKey; kinds: Kind[] }[] = [
  { label: "appointments.title", kinds: ["appointments"] },
  { label: "customers.deleteKindMessages", kinds: ["messages"] },
  { label: "customers.deleteKindCalls", kinds: ["calls", "agentTests"] },
  { label: "notes.title", kinds: ["notes"] },
  { label: "customers.deleteKindChatTurns", kinds: ["chatTurns"] },
  { label: "customers.deleteKindBulk", kinds: ["bulkRunItems"] },
  { label: "customers.deleteKindInboxMarks", kinds: ["inboxPins", "inboxReads"] },
];

export function CustomerDeleteSheet({
  customerId,
  onClose,
  onConfirm,
}: {
  customerId: Id<"customers">;
  onClose: () => void;
  // Runs the delete. The record owns it, because what happens after (leaving
  // the page without first flashing "no customer") is the record's business.
  onConfirm: () => Promise<void>;
}) {
  const t = useT();
  const preview = useQuery(api.customers.deletionPreview, { customerId });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const footprint = preview?.footprint;
  const count = (kinds: Kind[]) =>
    kinds.reduce((sum, kind) => sum + (footprint?.counts[kind] ?? 0), 0);
  // A capped kind means "at least": the preview stops counting a long
  // history rather than read all of it.
  const atLeast = (kinds: Kind[]) =>
    kinds.some((kind) => footprint?.capped.includes(kind));
  const rows = DELETED_ROWS.map((row) => ({
    ...row,
    n: count(row.kinds),
    plus: atLeast(row.kinds),
  })).filter((row) => row.n > 0);
  const kept = count(["activity", "journal"]);

  const confirm = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  const title = preview?.name
    ? t("customers.deleteTitle", { name: preview.name })
    : t("customers.deleteTitleUnnamed");

  return (
    <Sheet title={title} hint={t("customers.deleteHint")} onClose={() => !busy && onClose()}>
      {preview === undefined ? (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      ) : preview === null ? (
        <p className="text-sm text-[var(--muted)]">{t("customers.none")}</p>
      ) : (
        <>
          {rows.length > 0 ? (
            <>
              <p className="text-sm text-[var(--muted)]">{t("customers.deleteLead")}</p>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
                {rows.map((row) => (
                  <div key={row.label} className="contents">
                    <dt>{t(row.label)}</dt>
                    <dd className="text-right tabular-nums">
                      {row.n}
                      {row.plus ? "+" : ""}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">{t("customers.deleteNothingElse")}</p>
          )}
          {kept > 0 && (
            <p className="mt-3 text-xs text-[var(--muted)]">
              {t("customers.deleteActivityKept", { n: kept })}
            </p>
          )}
          <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">
            {t("customers.deleteFinal")}
          </p>
        </>
      )}
      {/* Reserved whether or not anything failed, so the buttons never jump
          under the pointer that is about to press one. */}
      <p className="mt-2 min-h-5 text-xs text-red-600 dark:text-red-400" role="status">
        {failed ? t("customers.deleteFailed") : ""}
      </p>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          data-sheet-autofocus
          onClick={onClose}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] disabled:opacity-50"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy || !preview}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? t("customers.deleting") : t("customers.deleteConfirm")}
        </button>
      </div>
    </Sheet>
  );
}
