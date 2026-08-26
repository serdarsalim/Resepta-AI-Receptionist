"use client";

// One attachment renderer for every surface that shows a message. A picture
// renders as a picture, a voice note as a player, a video as a video, and
// anything else as a chip you can open.
//
// It exists because an <img> pointed at a PDF fails its load, and the onError
// handler that hides a broken image then hides the whole thing — leaving a
// bubble that says nothing arrived at all. That was the old behaviour for
// every attachment a salon receives which is not a photo.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  isRenderableImage,
  mediaKindOf,
  mediaTypeLabel,
} from "../../convex/lib/mediaKind";
import { mediaKindKey } from "@/lib/mediaLabel";
import { useLanguage } from "@/lib/LanguageProvider";

export function MessageMedia({
  url,
  contentType,
  fileName,
  imgClassName,
}: {
  // Absent when the download failed or the file was over the ceiling. The row
  // still knows WHAT was sent, so it says so rather than rendering nothing.
  url?: string;
  contentType?: string;
  fileName?: string;
  // Each surface sizes its own image (a bubble caps width, a feed row caps
  // height); the player and the chip are identical everywhere.
  imgClassName?: string;
}) {
  // WhatsApp records voice notes as OGG/Opus. Chrome, Firefox and Edge decode
  // that natively; Safari is the one that may not, and an <audio> whose codec
  // the browser refuses still RENDERS — a dead player with a struck-through
  // button, which reads as "we lost your message". So a decode failure falls
  // back to the chip, where the recording can at least be downloaded and
  // played locally.
  const [audioFailed, setAudioFailed] = useState(false);
  // A photo in a bubble is capped at 208px so a portrait shot does not push
  // the conversation off the screen — which makes "this is the colour I want",
  // the single most common thing a salon is sent, unreadable at the size that
  // matters. Clicking opens it properly.
  const [zoomed, setZoomed] = useState(false);
  const { t } = useLanguage();

  const kind = mediaKindOf(url ?? "", fileName, contentType);
  const label = t(mediaKindKey(contentType, fileName, url));

  // Nothing to play or paint. Naming what it WAS is the whole value here: a
  // salon reading "voice message · could not be loaded" knows to open the
  // conversation on their phone, where the recording still is.
  if (!url) {
    return (
      <span className="mb-1 flex w-fit max-w-full items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted)]">
        {label} · {t("media.unavailable")}
      </span>
    );
  }

  if (isRenderableImage(contentType, fileName, url)) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={label}
          onClick={() => setZoomed(true)}
          className={`${imgClassName ?? ""} cursor-zoom-in`}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
        {zoomed && <Lightbox url={url} alt={label} onClose={() => setZoomed(false)} />}
      </>
    );
  }

  if (kind === "video") {
    return (
      <video
        src={url}
        controls
        // Enough to draw the poster frame and the duration without pulling a
        // whole clip nobody may play.
        preload="metadata"
        className="mb-1 max-h-52 w-auto max-w-[15rem] rounded-lg"
      />
    );
  }

  // mediaKindOf only answers "audio" on a positive signal — an audio/* mime or
  // an audio extension — so it never guesses its way in here.
  if (!audioFailed && kind === "audio") {
    return (
      <audio
        src={url}
        controls
        preload="metadata"
        // A player narrower than ~15rem loses its scrubber to the buttons.
        // Sized here rather than by the caller so it is the same object in a
        // bubble and in the contact feed, the same rule as the chip.
        className="mb-1 w-[15rem] max-w-full"
        onError={() => setAudioFailed(true)}
      />
    );
  }

  const badge = mediaTypeLabel(contentType, fileName);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      // Translucent neutral rather than --muted-bg: this chip lands on three
      // different grounds (a white bubble, an emerald one, the wallpaper) and
      // in dark --muted-bg IS --card, so a chip on a bubble would vanish.
      className="mb-1 flex max-w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-black/[0.045] px-2.5 py-2 transition-colors hover:bg-black/[0.075] dark:bg-white/[0.07] dark:hover:bg-white/[0.11]"
      onClick={(event) => event.stopPropagation()}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5 shrink-0 text-[var(--muted)]"
        aria-hidden="true"
      >
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
      </svg>
      <span className="min-w-0">
        <span className="block truncate text-sm text-[var(--foreground)]">
          {fileName || label}
        </span>
        <span className="block text-xs text-[var(--muted)]">
          {badge ? `${badge} · ` : ""}
          {t("media.openHint")}
        </span>
      </span>
    </a>
  );
}

// The opened photo. A portal because a bubble sits inside two overflow-hidden
// scrollers, and a fixed child of one is still clipped by it.
function Lightbox({
  url,
  alt,
  onClose,
}: {
  url: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      // Anywhere closes it, which is what every photo viewer trains people to
      // expect. The image itself stops the click so dragging to look at a
      // detail does not dismiss the thing being looked at.
      onClick={onClose}
      role="presentation"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full cursor-default rounded-lg object-contain shadow-2xl"
      />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        // Full resolution in its own tab, and the only route to saving it —
        // the overlay swallows the right-click menu people reach for first.
        className="absolute bottom-6 right-6 rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white backdrop-blur transition-colors hover:bg-white/25"
      >
        ↗
      </a>
    </div>,
    document.body,
  );
}
