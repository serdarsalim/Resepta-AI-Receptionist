"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";

// The agent's own changelog, opened from the version number beside the
// prompt's heading (Nudge's AgentVersionHistory, P7 of the port). Every
// publish carries a note saying what changed, so this list answers "what did
// we change before calls got worse" without anybody keeping a ledger.
//
// Read on open, never stored: the provider holds the versions, and a copy here
// would be wrong the moment somebody published from the provider's console.
// Restore puts a version's words back in the EDITOR as unsaved edits; it never
// publishes, because a restore that went live on click is a publish nobody
// read.

export type AgentVersionEntry = {
  version: number;
  isPublished: boolean;
  title: string | null;
  description: string | null;
  modifiedAt: number | null;
};

const PANEL_W = 320;
const PANEL_H = 320;

export function AgentVersionHistory({
  version,
  liveVersion,
  draft,
  load,
  onRestore,
  disabled = false,
}: {
  // The latest version, which is the draft when `draft` is set.
  version: number;
  liveVersion: number | null;
  draft: boolean;
  load: () => Promise<AgentVersionEntry[]>;
  onRestore?: (version: number) => void;
  disabled?: boolean;
}) {
  const { t, language } = useLanguage();
  const { triggerRef, panelRef, pos, toggle, close } = useAnchoredPanel(PANEL_W, PANEL_H);
  const [rows, setRows] = useState<AgentVersionEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const open = pos !== null;

  // Read once per open: a publish made since the last open shows next time.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void load()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      setRows(null);
      setFailed(false);
    };
  }, [open, load]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("voiceDetail.versionHistory")}
        className="rounded px-1 text-xs text-[var(--muted)] hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]"
      >
        {draft ? `v${version} · ${t("voiceDetail.versionDraft")}` : `v${version}`}
      </button>
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={t("voiceDetail.versionHistory")}
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: PANEL_W,
              maxHeight: PANEL_H,
            }}
            className="menu-surface thin-scroll z-[100] overflow-y-auto rounded-lg p-1"
          >
            <p className="px-2 py-1.5 text-[11px] font-medium text-[var(--muted-strong)]">
              {t("voiceDetail.versionHistory")}
            </p>
            {failed && (
              <p className="px-2 py-1.5 text-xs text-[var(--muted)]">
                {t("voiceDetail.versionsFailed")}
              </p>
            )}
            {!failed && rows === null && (
              <p className="px-2 py-1.5 text-xs text-[var(--muted)]">{t("common.loading")}</p>
            )}
            {rows?.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-[var(--muted)]">
                {t("voiceDetail.versionsEmpty")}
              </p>
            )}
            {rows?.map((row) => (
              <div key={row.version} className="rounded-md px-2 py-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium tabular-nums">v{row.version}</span>
                  {/* Only the live one is marked. Every older published row
                      WAS live, and labelling each would bury the one fact
                      worth seeing. */}
                  {row.version === liveVersion && (
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-400">
                      {t("voiceDetail.versionLive")}
                    </span>
                  )}
                  {!row.isPublished && (
                    <span className="text-[10px] text-amber-700 dark:text-amber-400">
                      {t("voiceDetail.versionDraft")}
                    </span>
                  )}
                  {row.modifiedAt !== null && (
                    <span className="ml-auto shrink-0 text-[10px] text-[var(--muted)]">
                      {new Date(row.modifiedAt).toLocaleDateString(language, {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  )}
                </div>
                {/* An untitled version says so: every version from before
                    notes existed is one, and a blank line reads as a
                    rendering bug instead of as missing history. */}
                <p
                  className={`text-xs leading-snug ${
                    row.title ? "text-[var(--foreground)]" : "text-[var(--muted)]"
                  }`}
                >
                  {row.title ?? t("voiceDetail.versionUntitled")}
                </p>
                {row.description && (
                  <p className="text-[11px] leading-snug text-[var(--muted)]">
                    {row.description}
                  </p>
                )}
                {onRestore && row.version !== version && (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      onRestore(row.version);
                    }}
                    className="mt-0.5 text-xs text-[var(--accent)] hover:underline"
                  >
                    {t("voiceDetail.versionRestore")}
                  </button>
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
