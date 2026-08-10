"use client";

// Business → Knowledge: the prose the chat agent knows (docs/chat-agent.md).
// Blocks with titles, not one big textarea — the editor stays scannable and
// the agent's context can name its sections. Structured facts (services,
// prices, hours, team) deliberately do NOT live here; the agent reads those
// from their own tables, so nothing written in this card can contradict the
// calendar.

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { Card } from "./Card";
import { Sheet } from "./Sheet";
import { InlineEditValue } from "./RecordField";
import { useConfirm } from "./ConfirmDialog";

export function KnowledgeCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const rows = useQuery(api.knowledge.list, {});
  const create = useMutation(api.knowledge.create);
  const update = useMutation(api.knowledge.update);
  const remove = useMutation(api.knowledge.remove);
  const [confirm, confirmDialog] = useConfirm();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Staff cannot edit, and an empty read-only card is a frame around nothing.
  if (!isOwner && rows !== undefined && rows.length === 0) return null;

  return (
    <Card title={t("knowledge.title")} tip={t("knowledge.hint")} disabled={!isOwner}>
      {confirmDialog}
      <div className="space-y-4">
        {rows !== undefined && rows.length === 0 && (
          <p className="text-xs text-[var(--muted)]">{t("knowledge.empty")}</p>
        )}
        {(rows ?? []).map((row) => (
          <div key={row._id} className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 text-sm font-medium">
                <InlineEditValue
                  value={row.title}
                  placeholder={t("knowledge.titlePlaceholder")}
                  onSave={(value) => update({ id: row._id, title: value })}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const ok = await confirm({
                      title: t("knowledge.deleteConfirm").replace("{name}", row.title),
                    });
                    if (!ok) return;
                    setError(null);
                    await remove({ id: row._id }).catch(() => setError("error"));
                  })();
                }}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
              >
                {t("common.delete")}
              </button>
            </div>
            {/* Uncontrolled with autosave on blur — the app's no-Save-button
                rule. key on the row id so a reordered list re-seeds cleanly. */}
            <textarea
              key={`${row._id}-body`}
              defaultValue={row.body}
              placeholder={t("knowledge.bodyPlaceholder")}
              rows={Math.min(8, Math.max(2, row.body.split("\n").length + 1))}
              onBlur={(event) => {
                const next = event.currentTarget.value;
                if (next !== row.body) void update({ id: row._id, body: next });
              }}
              className="w-full resize-y text-sm"
            />
          </div>
        ))}
        {error && <p className="text-xs text-red-600">{t("common.error")}</p>}
        <div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)]"
          >
            {t("knowledge.add")}
          </button>
        </div>
      </div>
      {adding && <AddKnowledgeSheet onClose={() => setAdding(false)} onCreate={create} />}
    </Card>
  );
}

function AddKnowledgeSheet({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (args: { title: string; body: string }) => Promise<unknown>;
}) {
  const { t } = useLanguage();
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={t("knowledge.add")} hint={t("knowledge.addHint")} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const title = String(form.get("title") ?? "").trim();
          const body = String(form.get("body") ?? "").trim();
          if (!title) return;
          setError(null);
          try {
            await onCreate({ title, body });
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "error");
          }
        }}
      >
        <input
          name="title"
          required
          data-sheet-autofocus
          placeholder={t("knowledge.titlePlaceholder")}
        />
        <textarea
          name="body"
          rows={5}
          placeholder={t("knowledge.bodyPlaceholder")}
          className="w-full resize-y text-sm"
        />
        {error && <p className="text-xs text-red-600">{t("common.error")}</p>}
        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)]"
          >
            {t("common.add")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
