"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { buttonClass, fieldClass, iconButtonClass } from "./Control";
import { EmailBodyEditor } from "./EmailBodyEditor";
import { HoverTip } from "./HoverTip";
import { SegmentedControl } from "./SegmentedControl";
import { Sheet } from "./Sheet";
import { useConfirm } from "./ConfirmDialog";

// The compose window's signature button (P28, Nudge 366e1013): two groups.
// MINE is your own named signatures, each "Only me" or "Everyone", with a cog
// to edit and "+ New signature". SHARED is colleagues' Everyone signatures. A
// click puts one at the end of the email, replacing whichever known signature
// is there; the star makes one the signature your next email opens with.

export type SignatureView = { _id: Id<"emailSignatures">; name: string; html: string; shared: boolean };

const ROW = "flex items-center gap-1 rounded-md hover:bg-[var(--row-hover-bg)]";
const ICON = "shrink-0 rounded-md p-1 text-[var(--muted)] hover:text-[var(--foreground)]";
const MENU_W = 300;

function Star({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function Cog() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function SignatureMenu({ onApply }: { onApply: (html: string) => void }) {
  const { t } = useLanguage();
  const sigs = useQuery(api.emailSignatures.available, {});
  const setDefault = useMutation(api.emailSignatures.setDefault);
  // Opens upward: the button sits on the window's bottom bar.
  const { triggerRef, panelRef, pos, open, toggle, close } = useAnchoredPanel(
    MENU_W,
    384,
    "left",
    { prefer: "above" },
  );
  const [editing, setEditing] = useState<SignatureView | "new" | null>(null);

  const apply = (html: string) => {
    close();
    if (html.trim()) onApply(html);
  };
  const star = (id: Id<"emailSignatures">) => {
    const on = sigs?.defaultId === id;
    const label = on ? t("compose.sigDefaultOn") : t("compose.sigDefault");
    return (
      <HoverTip text={label}>
        <button
          type="button"
          aria-label={label}
          aria-pressed={on}
          onMouseDown={(event) => {
            event.preventDefault();
            void setDefault({ signatureId: on ? null : id });
          }}
          className={`${ICON} ${on ? "text-amber-500 hover:text-amber-500" : ""}`}
        >
          <Star on={on} />
        </button>
      </HoverTip>
    );
  };
  const heading = (text: string) => (
    <div className="px-2 pb-0.5 pt-1.5 text-xs font-medium text-[var(--muted-strong)]">{text}</div>
  );

  return (
    <>
      <HoverTip text={t("compose.signature")} side="top">
        <button
          ref={triggerRef}
          type="button"
          aria-label={t("compose.signature")}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
          className={iconButtonClass("quiet", "sm")}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      </HoverTip>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width }}
            className="menu-surface z-[100] max-h-96 overflow-y-auto rounded-lg px-1 py-1"
          >
            {heading(t("compose.sigMine"))}
            {(sigs?.mine ?? []).map((sig) => (
              <div key={sig._id} className={ROW}>
                <button
                  type="button"
                  role="menuitem"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    apply(sig.html);
                  }}
                  className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                >
                  {sig.name}
                  <span className="ml-1.5 text-xs text-[var(--muted)]">
                    {sig.shared ? t("compose.sigEveryone") : t("compose.sigOnlyMe")}
                  </span>
                </button>
                {star(sig._id)}
                <HoverTip text={t("compose.sigEdit")}>
                  <button
                    type="button"
                    aria-label={t("compose.sigEdit")}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setEditing(sig);
                      close();
                    }}
                    className={ICON}
                  >
                    <Cog />
                  </button>
                </HoverTip>
              </div>
            ))}
            <button
              type="button"
              role="menuitem"
              onMouseDown={(event) => {
                event.preventDefault();
                setEditing("new");
                close();
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--accent)] hover:bg-[var(--row-hover-bg)]"
            >
              + {t("compose.sigNew")}
            </button>
            {(sigs?.shared.length ?? 0) > 0 && (
              <>
                {heading(t("compose.sigShared"))}
                {sigs!.shared.map(({ signature, ownerName }) => (
                  <div key={signature._id} className={ROW}>
                    <button
                      type="button"
                      role="menuitem"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        apply(signature.html);
                      }}
                      className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                    >
                      {signature.name}
                      {ownerName && (
                        <span className="ml-1.5 text-xs text-[var(--muted)]">{ownerName}</span>
                      )}
                    </button>
                    {star(signature._id)}
                  </div>
                ))}
              </>
            )}
          </div>,
          document.body,
        )}
      {editing && (
        <SignatureSheet
          signature={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

// One of YOUR named signatures: its name, who sees it (only you or everyone in
// the business) and its words. An explicit Save, the one place the compose
// flow has one, and on purpose: a signature goes on every mail you send, so a
// stray keystroke must not land there by itself, and a shared one lands on
// your colleagues' mail too. Delete only when editing an existing one.
function SignatureSheet({
  signature,
  onClose,
}: {
  signature: SignatureView | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const create = useMutation(api.emailSignatures.create);
  const update = useMutation(api.emailSignatures.update);
  const remove = useMutation(api.emailSignatures.remove);
  const [confirm, confirmDialog] = useConfirm();
  const initial = signature?.html ?? "";
  // The editor saves on BLUR, and the Save click is what blurs it: by the
  // time this click handler runs, a state setter from that blur has not
  // re-rendered yet. The ref always reads current.
  const draftRef = useRef(initial);
  const [name, setName] = useState(signature?.name ?? "");
  const [shared, setShared] = useState(signature?.shared ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (work: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    work.then(onClose).catch((err: unknown) => {
      setBusy(false);
      const raw = err instanceof Error ? err.message : "";
      setError(
        raw.includes("signature-too-long")
          ? t("compose.sigTooLong")
          : raw.includes("too-many-signatures")
            ? t("compose.sigTooMany")
            : t("compose.sigSaveFailed"),
      );
    });
  };
  const save = () =>
    run(
      signature
        ? update({ id: signature._id, name, html: draftRef.current, shared })
        : create({ name, html: draftRef.current, shared }),
    );
  const dirty = name !== (signature?.name ?? "") || shared !== (signature?.shared ?? false);

  return (
    <Sheet
      title={signature ? t("compose.sigEdit") : t("compose.sigNew")}
      wide
      dirty={dirty}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            data-sheet-autofocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("compose.sigNamePlaceholder")}
            aria-label={t("compose.sigName")}
            className={`${fieldClass("sm")} min-w-0 flex-1`}
          />
          <SegmentedControl
            size="sm"
            ariaLabel={t("compose.sigWhoSees")}
            value={shared ? "everyone" : "me"}
            segments={[
              { id: "me", label: t("compose.sigOnlyMe") },
              { id: "everyone", label: t("compose.sigEveryone") },
            ]}
            onChange={(next) => setShared(next === "everyone")}
          />
        </div>
        <EmailBodyEditor
          value={initial}
          showVariables={false}
          insertPhoto
          placeholder={t("compose.sigPlaceholder")}
          onSave={(html) => {
            draftRef.current = html;
          }}
          onLiveChange={(html) => {
            draftRef.current = html;
          }}
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex items-center gap-2">
          {signature && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await confirm({
                  title: t("compose.sigDeleteTitle", { name: signature.name }),
                  confirmLabel: t("compose.sigDelete"),
                });
                if (ok) run(remove({ id: signature._id }));
              }}
              className={buttonClass("danger")}
            >
              {t("compose.sigDelete")}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className={buttonClass("quiet")}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={save}
              className={buttonClass("primary")}
            >
              {busy ? t("common.saving") : t("compose.sigSave")}
            </button>
          </div>
        </div>
      </div>
      {confirmDialog}
    </Sheet>
  );
}
