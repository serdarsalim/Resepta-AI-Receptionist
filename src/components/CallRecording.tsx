"use client";

import { useRef, useState } from "react";
import { useLanguage } from "@/lib/LanguageProvider";
import { buttonClass, iconButtonClass } from "./Control";

// The recording player (P11 of the Nudge port; Nudge's CallRecording without
// its demo branch).
//
// It exists because the native <audio controls> cannot do the one thing that
// matters here: its readout comes from the file's metadata, and the players
// run preload="none" so a call history does not pull a header for every row,
// so every native player printed "0:00 / 0:00" until pressed. We already know
// the length (the provider reports it and the call row stores it), so the
// readout is ours, seeded from that number and handed to the file's own once
// it loads. Nothing is fetched until play.
//
// The shape every voice-memo player shares: play, elapsed left, a track that
// thickens and grows a knob under the pointer, the length right, and a speed
// toggle, because a person going through a day of calls listens at 1.5×.
// The track is a slider to the keyboard: arrows step five seconds.

const SPEEDS = [1, 1.25, 1.5, 2] as const;
const STEP_MS = 5_000;

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function CallRecording({
  url,
  durationMs,
  className = "",
}: {
  url: string;
  // What the call row recorded. Absent on a row that predates it; the
  // readout then waits for the file, as the native control did.
  durationMs?: number;
  className?: string;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [loadedMs, setLoadedMs] = useState<number | null>(null);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const totalMs = loadedMs ?? durationMs ?? 0;
  const pct = totalMs > 0 ? Math.min(100, (current / totalMs) * 100) : 0;

  const toggle = () => {
    const audio = ref.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  };

  const seekTo = (ms: number, play: boolean) => {
    const audio = ref.current;
    if (!audio || totalMs <= 0) return;
    const clamped = Math.min(totalMs, Math.max(0, ms));
    audio.currentTime = clamped / 1000;
    setCurrent(clamped);
    if (play && audio.paused) void audio.play().catch(() => undefined);
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (ref.current) ref.current.playbackRate = next;
  };

  return (
    <div className={`flex h-8 items-center gap-3 ${className}`}>
      <audio
        ref={ref}
        src={url}
        preload="none"
        onPlay={(event) => {
          event.currentTarget.playbackRate = speed;
        }}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration;
          if (Number.isFinite(seconds) && seconds > 0) setLoadedMs(seconds * 1000);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t("calls.pauseRecording") : t("calls.playRecording")}
        // Nudge's raised square (its `secondary`, Resepta's `outline` since
        // the controls took Nudge's depth): a ring and a soft drop, not a
        // border, so the one control on the player reads as one.
        className={iconButtonClass("outline", "xs")}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
            <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z" />
          </svg>
        )}
      </button>
      {/* Fixed widths so the track does not breathe as the digits change. */}
      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-[var(--muted-strong)]">
        {clock(current)}
      </span>
      <div
        role="slider"
        tabIndex={0}
        aria-label={t("calls.recordingPosition")}
        aria-valuemin={0}
        aria-valuemax={Math.round(totalMs)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={clock(current)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          seekTo(totalMs * Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            seekTo(current + STEP_MS, false);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            seekTo(current - STEP_MS, false);
          } else if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            toggle();
          }
        }}
        className="group relative min-w-0 flex-1 cursor-pointer py-3 outline-none focus-visible:[&>div]:ring-2 focus-visible:[&>div]:ring-[var(--accent)]/40"
      >
        {/* The track is mixed from the ink, not --border: the player sits on
            the call card (--chat-field), and in dark --border (#262626) is
            that card's own colour (#242424), which left the track invisible. */}
        <div className="h-1 w-full rounded-full bg-[color-mix(in_srgb,var(--foreground)_14%,transparent)] transition-[height] duration-150 group-hover:h-1.5">
          <div
            className="relative h-full rounded-full bg-[var(--foreground)]"
            style={{ width: `${pct}%` }}
          >
            <span
              aria-hidden
              className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[var(--foreground)] opacity-0 ring-2 ring-[var(--card)] transition-opacity duration-150 group-hover:opacity-100"
            />
          </div>
        </div>
      </div>
      <span className="w-9 shrink-0 text-[11px] tabular-nums text-[var(--muted)]">
        {totalMs > 0 ? clock(totalMs) : "--:--"}
      </span>
      <button
        type="button"
        onClick={cycleSpeed}
        aria-label={t("calls.playbackSpeed")}
        className={`${buttonClass("quiet", "xs")} w-12 tabular-nums`}
      >
        {speed}×
      </button>
    </div>
  );
}
