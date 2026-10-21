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
import { buttonClass } from "./Control";
import { InfoTip } from "./InfoTip";
import { Sheet } from "./Sheet";
import { InlineEditValue } from "./RecordField";
import { useConfirm } from "./ConfirmDialog";
import { EmailBodyEditor } from "./EmailBodyEditor";
import { bodyIsHtml, hasNoteText, plainToHtml } from "../../convex/lib/noteBody";
import { sanitizeEmailHtml } from "@/lib/sanitizeHtml";

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
    <section className="space-y-2">
      {/* The title and its add sit ABOVE the card, and the card holds the
          blocks and nothing else (Nudge 13bcfad1; Serdar, 2026-10-21: "we
          don't put a button inside a list"). The row keeps its height for a
          member, who gets no add, so the card's edge sits where it does for
          an owner. */}
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {t("knowledge.title")}
          <InfoTip text={t("knowledge.hint")} />
        </h2>
        {isOwner && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={buttonClass("outline", "sm")}
          >
            {t("knowledge.add")}
          </button>
        )}
      </div>
    <Card disabled={!isOwner}>
      {confirmDialog}
      <div className="space-y-4">
        {rows !== undefined && rows.length === 0 && (
          <p className="text-xs text-[var(--muted)]">{t("knowledge.empty")}</p>
        )}
        {(rows ?? []).map((row) => (
          <KnowledgeBlock
            key={row._id}
            row={row}
            isOwner={isOwner}
            onSaveTitle={(title) => update({ id: row._id, title })}
            onSaveBody={(body) => {
              if (body !== row.body) void update({ id: row._id, body });
            }}
            onDelete={() => {
              void (async () => {
                const ok = await confirm({
                  title: t("knowledge.deleteConfirm", { name: row.title }),
                });
                if (!ok) return;
                setError(null);
                await remove({ id: row._id }).catch(() => setError("error"));
              })();
            }}
          />
        ))}
        {error && <p className="text-xs text-red-600">{t("common.error")}</p>}
      </div>
      {adding && <AddKnowledgeSheet onClose={() => setAdding(false)} onCreate={create} />}
    </Card>
    </section>
  );
}

// One knowledge block: a title you click to correct, and a body that READS as
// prose and only becomes an editor when you go to write in it.
//
// It used to mount a live EmailBodyEditor per block, permanently. Two blocks
// meant two full rich-text toolbars parked on a card nobody visits to format
// text — the exact "row of bordered inputs reads as a form somebody has to
// fill in" this codebase argues against everywhere else. Knowledge is prose
// about the business, written once and read by the agent for months.
//
// Ported from the notes bubble in ConversationPanel, which Serdar named as the
// reference. Two things came with it and both are load-bearing:
//
// The whole bubble is the edit affordance — no pencil that only appears once
// you have found the block by hovering it.
//
// Cancel/Save rather than collapsing on an outside click, and that is NOT a
// departure from the no-Save-button rule for its own sake. The editor's colour
// swatch and emoji picker both portal to document.body, so every "did the
// click land outside" test says yes to picking an emoji and would close the
// editor out from under the thing you just reached for. Notes hit this first
// and answered it with an explicit close; a second answer here would be a
// second pattern for one problem. The body still autosaves on blur underneath
// — Save exists to leave the editor, not to persist.
function KnowledgeBlock({
  row,
  isOwner,
  onSaveTitle,
  onSaveBody,
  onDelete,
}: {
  row: { _id: string; title: string; body: string };
  isOwner: boolean;
  onSaveTitle: (title: string) => Promise<unknown>;
  onSaveBody: (body: string) => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  // Plain blocks predate the editor. Converted on the way IN rather than
  // migrated in storage, so the line breaks somebody typed survive and a block
  // nobody ever edits is never rewritten.
  const [draft, setDraft] = useState("");
  const filled = hasNoteText(row.body);

  return (
    <div className="group/block space-y-1">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-sm font-medium">
          <InlineEditValue
            value={row.title}
            placeholder={t("knowledge.titlePlaceholder")}
            onSave={onSaveTitle}
          />
        </div>
        {/* Hover-revealed like the note's, opacity rather than hidden so the
            row never shifts when it appears. It was a permanent grey button on
            every block, which is the same clutter as the parked toolbar. */}
        {isOwner && (
          <button
            type="button"
            onClick={onDelete}
            className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--muted-bg)] focus-visible:opacity-100 group-hover/block:opacity-100 [@media(hover:none)]:opacity-100"
          >
            {t("common.delete")}
          </button>
        )}
      </div>

      {editing ? (
        // The editor wears the bubble, so a block reads and edits in the same
        // box and in the same format, rather than turning into plain text the
        // moment you touch it.
        <div className="rounded-xl bg-[var(--note-bubble-bg)] px-3 py-2">
          <EmailBodyEditor
            value={draft}
            compact
            showVariables={false}
            placeholder={t("knowledge.bodyPlaceholder")}
            onSave={setDraft}
            onLiveChange={setDraft}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md px-2.5 py-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                // Empty collapses to "", not to an empty paragraph: tiptap
                // serialises a blank document as <p></p>, and the agent would
                // read that as a block with content.
                onSaveBody(hasNoteText(draft) ? draft : "");
                setEditing(false);
              }}
              className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
            >
              {t("common.save")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={!isOwner}
          onClick={() => {
            setDraft(bodyIsHtml(row.body) ? row.body : plainToHtml(row.body));
            setEditing(true);
          }}
          title={isOwner ? t("notes.edit") : undefined}
          className="block w-full rounded-xl bg-[var(--note-bubble-bg)] px-3 py-2 text-left text-sm transition-colors enabled:hover:bg-[var(--note-bubble-hover-bg)]"
        >
          {/* Sanitised even though this markup is ours: anyone in the org can
              write it, and "we wrote it" is not a security boundary. */}
          {!filled ? (
            // An empty block still has to be a target you can hit, or the only
            // way to fill one in is to delete it and add it again.
            <span className="text-[var(--muted)]">
              {t("knowledge.bodyPlaceholder")}
            </span>
          ) : bodyIsHtml(row.body) ? (
            <div
              className="break-words [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4"
              dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(row.body) }}
            />
          ) : (
            // whitespace-pre-wrap, not <br> injection: a legacy plain block
            // keeps its line breaks without being rewritten into markup it was
            // never stored as.
            <span className="block whitespace-pre-wrap break-words">
              {row.body}
            </span>
          )}
        </button>
      )}
    </div>
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
  // The body is the same EmailBodyEditor a block edits in, not the plain
  // textarea this used to be. A block was WRITTEN in a bare box and then
  // EDITED as rich prose one click later, so the surface changed shape between
  // creating a thing and correcting it, and anyone who typed a list here
  // watched their formatting appear only after saving and reopening.
  //
  // Held in state rather than read off FormData on submit: the editor is a
  // contenteditable, so there is no form field for FormData to find.
  const [body, setBody] = useState("");
  return (
    <Sheet title={t("knowledge.add")} hint={t("knowledge.addHint")} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const title = String(form.get("title") ?? "").trim();
          if (!title) return;
          setError(null);
          try {
            // hasNoteText, not body.trim(): an untouched editor serialises to
            // "<p></p>" and a paragraph of non-breaking spaces is emptier
            // still, so a non-empty string is not the question. Empty stays
            // empty, since a block with a title and no body is legal and
            // previews its placeholder.
            await onCreate({ title, body: hasNoteText(body) ? body : "" });
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
        {/* Wearing the note bubble, the same box the block reads and edits in,
            so the thing you are writing already looks like the thing you will
            have written. */}
        <div className="rounded-xl bg-[var(--note-bubble-bg)] px-3 py-2">
          <EmailBodyEditor
            value={body}
            compact
            showVariables={false}
            placeholder={t("knowledge.bodyPlaceholder")}
            onSave={setBody}
            onLiveChange={setBody}
          />
        </div>
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
