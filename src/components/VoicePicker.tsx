"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
// The table's search folding, not a second copy: it handles the dotted/dotless
// i BEFORE lowercasing, so "sarkici" typed on a Turkish keyboard still matches.
import { foldSearch } from "@/lib/useTableState";
import { HoverTip } from "./HoverTip";

// The one voice picker, used by the create sheet and the agent editor
// (Serdar, 2026-08-21). Both were a native <select> plus one play button
// beside it, which meant hearing a voice cost three gestures — open, pick,
// close, press play — and doing it again for the next candidate. Choosing a
// voice is choosing what the BUSINESS sounds like on the phone; it is the one
// control in the product you cannot evaluate by reading.
//
// So: TimezoneSelect's shape (portalled panel, search field, filtered rows —
// see useAnchoredPanel for why every panel here is fixed and portalled) with
// a play button ON each row. Pressing play never changes the selection, and
// only one preview plays at a time — a list you can audition down is the
// whole point, and four voices talking over each other is not.
//
// The catalogue it lists is minimax-only (convex/lib/voiceCatalogue): one
// engine family, multilingual, the one Bella was tuned on. Retell's "platform"
// voices are the same voices rebadged — 20 of their 21 names are minimax
// names and their previews serve minimax-*.mp3 — so offering both would add
// one voice and twenty duplicate rows.

export type PickerVoice = {
  id: string;
  name: string;
  gender: string;
  accent: string;
  previewUrl: string | null;
};

const PANEL_MAX_H = 300;

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="2.5" y="2" width="2.5" height="8" rx="0.5" fill="currentColor" />
      <rect x="7" y="2" width="2.5" height="8" rx="0.5" fill="currentColor" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M3.5 2.2l6 3.8-6 3.8z" fill="currentColor" />
    </svg>
  );
}

export function VoicePicker({
  value,
  voices,
  onChange,
  disabled,
  // The create sheet's field is a 40px form control; the editor's row is a
  // compact 30px one. Same panel either way.
  size = "md",
}: {
  value: string;
  voices: PickerVoice[];
  onChange: (id: string) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const { t } = useLanguage();
  const { triggerRef, panelRef, pos, open, toggle, close } = useAnchoredPanel(
    "trigger",
    PANEL_MAX_H,
  );
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  };

  // Nothing keeps playing once the panel is gone or the component unmounts —
  // a voice still talking after the sheet closed has no visible source and no
  // way to stop it.
  useEffect(() => {
    if (open) {
      setQuery("");
      // After paint: the portal's input does not exist until the panel renders.
      const raf = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
    stop();
    return undefined;
  }, [open]);
  useEffect(() => stop, []);

  const preview = (voice: PickerVoice) => {
    if (!voice.previewUrl) return;
    if (playing === voice.id) {
      stop();
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(voice.previewUrl);
    audioRef.current = audio;
    setPlaying(voice.id);
    // Clearing on end matters as much as starting: a ■ left behind on a
    // finished clip says something is playing when nothing is.
    audio.onended = () => setPlaying((current) => (current === voice.id ? null : current));
    void audio.play().catch(() => setPlaying(null));
  };

  const filtered = useMemo(() => {
    const q = foldSearch(query.trim());
    if (!q) return voices;
    // Name, accent and gender all match: "german" and "female" are how
    // somebody actually narrows a voice list, not just the given name.
    return voices.filter((voice) =>
      foldSearch(`${voice.name} ${voice.accent} ${voice.gender}`).includes(q),
    );
  }, [query, voices]);

  const selected = voices.find((voice) => voice.id === value) ?? null;
  const label = selected
    ? [selected.name, selected.accent, selected.gender].filter(Boolean).join(" · ")
    : // An agent on a voice outside the catalogue shows the raw id rather
      // than silently reading as somebody else's voice.
      value || t("voiceDetail.voicePick");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={`inline-flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] transition-colors hover:bg-[var(--muted-bg)] disabled:cursor-not-allowed disabled:opacity-60 ${
          size === "sm" ? "px-2 py-1.5 text-xs" : "h-10 px-3 text-base sm:text-sm"
        }`}
      >
        <span className="truncate">{label}</span>
        <span
          aria-hidden
          className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", ...pos }}
            className="menu-surface z-[100] overflow-hidden rounded-lg text-sm text-[var(--foreground)]"
          >
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("voicePicker.search")}
              className="block w-full border-0 border-b border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
            />
            <div
              className="thin-scroll overflow-y-auto p-1"
              style={{ maxHeight: PANEL_MAX_H }}
            >
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[var(--muted)]">
                  {t("voicePicker.none")}
                </div>
              ) : (
                filtered.map((voice) => (
                  // A row, not a button: the play control is a second action
                  // inside it and a button cannot contain a button.
                  <div
                    key={voice.id}
                    className={`flex items-center gap-1 rounded-md transition-colors hover:bg-[var(--muted-bg)] ${
                      voice.id === value ? "bg-[var(--muted-bg)]" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onChange(voice.id);
                        close();
                      }}
                      className="flex min-w-0 flex-1 items-baseline justify-between gap-3 px-2.5 py-1.5 text-left"
                    >
                      <span
                        className={`truncate ${voice.id === value ? "font-medium" : ""}`}
                      >
                        {voice.name}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {[voice.accent, voice.gender].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                    {/* Auditioning must not choose. The row selects; this
                        only makes a noise, so it stops the click here. */}
                    <HoverTip text={
                        playing === voice.id
                          ? t("voiceCreate.stopPreview")
                          : t("voiceCreate.preview")
                      }>
                    <button
                      type="button"
                      disabled={!voice.previewUrl}
                      onClick={(event) => {
                        event.stopPropagation();
                        preview(voice);
                      }}
                      aria-label={
                        playing === voice.id
                          ? t("voiceCreate.stopPreview")
                          : t("voiceCreate.preview")
                      }
                      className={`mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${
                        playing === voice.id
                          ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                          : "text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      <PlayIcon playing={playing === voice.id} />
                    </button>
                    </HoverTip>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
