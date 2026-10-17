"use client";

import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import Picker, { Theme, EmojiStyle, type EmojiClickData } from "emoji-picker-react";
import { iconButtonClass } from "./Control";
import { HoverTip } from "./HoverTip";

const PANEL_W = 320;
const PANEL_H = 400;

// Emoji picker, ported from Nudge: a button that opens the full
// emoji-picker-react panel (every emoji, built-in search, categories, skin
// tones). onPick inserts the chosen emoji at the caller's cursor. The panel
// renders in a PORTAL with fixed positioning — composers live inside
// overflow-hidden cards, and an absolute panel gets clipped by them no matter
// the z-index. Positioned by useAnchoredPanel: below the button, above when
// the viewport runs out, and it FOLLOWS the button when the page scrolls. It
// closed on scroll until 2026-10-13, so scrolling a sheet to see what you
// were reacting to took the picker away.
export function EmojiPicker({
  onPick,
  title,
  children,
  className,
  disabled,
}: {
  onPick: (emoji: string) => void;
  title: string;
  // The trigger's face. Defaults to the borderless square the composer
  // toolbars use (the scale's quiet xs, Nudge de116934: a border around a
  // control inside an editor is chrome drawn twice); a message bubble's react
  // button passes its own icon and classes, because a toolbar control floating
  // beside a bubble reads as a second message rather than as an affordance
  // belonging to the one below it.
  children?: React.ReactNode;
  className?: string;
  // Composers gate every other control on whether a message can be sent at
  // all; without this the emoji button stayed live over a disabled textarea.
  disabled?: boolean;
}) {
  const { triggerRef, panelRef, pos, toggle, close } = useAnchoredPanel(
    PANEL_W,
    PANEL_H,
  );

  return (
    <>
      <HoverTip text={title} disabled={disabled || Boolean(pos)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={title}
        disabled={disabled}
        onClick={toggle}
        className={className ?? iconButtonClass("quiet", "xs")}
      >
        {children ?? "🙂"}
      </button>
      </HoverTip>
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              zIndex: 60,
            }}
          >
            <EmojiPanel
              onPick={(emoji) => {
                onPick(emoji);
                close();
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

// The panel itself, inline (no button, no portal), for a caller that already
// owns a floating container: the WhatsApp bubble menu, which swaps it in for
// its items once React or the quick reactions' "+" is picked (P23, Nudge
// daddc71e). Its footprint is EMOJI_PANEL_W by EMOJI_PANEL_H.
export const EMOJI_PANEL_W = PANEL_W;
export const EMOJI_PANEL_H = PANEL_H;

export function EmojiPanel({ onPick }: { onPick: (emoji: string) => void }) {
  const dark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return (
    <Picker
      onEmojiClick={(d: EmojiClickData) => onPick(d.emoji)}
      theme={dark ? Theme.DARK : Theme.LIGHT}
      emojiStyle={EmojiStyle.NATIVE}
      lazyLoadEmojis
      width={PANEL_W}
      height={PANEL_H}
      previewConfig={{ showPreview: false }}
    />
  );
}
