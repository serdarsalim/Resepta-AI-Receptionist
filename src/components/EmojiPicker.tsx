"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Picker, { Theme, EmojiStyle, type EmojiClickData } from "emoji-picker-react";

const PANEL_W = 320;
const PANEL_H = 400;

// Emoji picker, ported from Nudge: a button that opens the full
// emoji-picker-react panel (every emoji, built-in search, categories, skin
// tones). onPick inserts the chosen emoji at the caller's cursor. The panel
// renders in a PORTAL with fixed positioning — composers live inside
// overflow-hidden cards, and an absolute panel gets clipped by them no matter
// the z-index. Prefers opening below the button, flips up when the viewport
// runs out. Closes on outside click, Escape, and scroll (a fixed panel would
// detach from its button otherwise).
export function EmojiPicker({
  onPick,
  title,
}: {
  onPick: (emoji: string) => void;
  title: string;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const openPanel = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const down = r.bottom + PANEL_H + 8 <= window.innerHeight || r.top - PANEL_H - 8 < 0;
    setPos({
      top: down ? r.bottom + 4 : r.top - PANEL_H - 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8)),
    });
  };

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !btnRef.current?.contains(t)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    const onScroll = () => setPos(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [pos]);

  const dark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        aria-label={title}
        onClick={() => (pos ? setPos(null) : openPanel())}
        className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-0.5 text-sm leading-none transition-colors hover:bg-[var(--muted-bg)]"
      >
        🙂
      </button>
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 60 }}
          >
            <Picker
              onEmojiClick={(d: EmojiClickData) => {
                onPick(d.emoji);
                setPos(null);
              }}
              theme={dark ? Theme.DARK : Theme.LIGHT}
              emojiStyle={EmojiStyle.NATIVE}
              lazyLoadEmojis
              width={PANEL_W}
              height={PANEL_H}
              previewConfig={{ showPreview: false }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
