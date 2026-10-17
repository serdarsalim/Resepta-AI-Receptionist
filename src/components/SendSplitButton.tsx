"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { buttonClass, fieldClass } from "./Control";

// Gmail's Send: a pill split in two, Send on the left and ▾ on the right,
// which opens Schedule send (P28, Nudge d2f22780). The presets are Gmail's
// three, on the sender's own clock; anything else is a date and time picked
// under them. A pill, not the app's boxed button: here the shape is the
// point, it is the one control the window is for.

const at = (base: Date, days: number, hour: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
};

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const MENU_W = 288;

export function SendSplitButton({
  label,
  disabled,
  onSend,
  onSchedule,
}: {
  label: string;
  disabled: boolean;
  onSend: () => void;
  onSchedule: (whenMs: number) => void;
}) {
  const { t, language } = useLanguage();
  // Opens upward: the button sits at the foot of the window.
  const { triggerRef, panelRef, pos, open, toggle, close } = useAnchoredPanel(
    MENU_W,
    260,
    "left",
    { prefer: "above" },
  );
  const [custom, setCustom] = useState("");

  const now = new Date();
  // Monday morning only when tomorrow is not already Monday (Gmail drops it
  // the same way); days until the next Monday, 1..7.
  const toMonday = (8 - now.getDay()) % 7 || 7;
  const presets = [
    { key: "compose.tomorrowMorning" as const, when: at(now, 1, 8) },
    { key: "compose.tomorrowAfternoon" as const, when: at(now, 1, 13) },
    ...(toMonday > 1 ? [{ key: "compose.mondayMorning" as const, when: at(now, toMonday, 8) }] : []),
  ];
  const fmt = (d: Date) =>
    d.toLocaleString(language, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  const customMs = custom ? new Date(custom).getTime() : NaN;
  const customOk = Number.isFinite(customMs) && customMs > Date.now();

  const pick = (ms: number) => {
    close();
    setCustom("");
    onSchedule(ms);
  };

  return (
    <div className="inline-flex h-9 shrink-0 items-stretch">
      <button
        type="button"
        onClick={onSend}
        disabled={disabled}
        className={`${buttonClass("primary", "md")} rounded-l-full rounded-r-none pl-5 pr-4`}
      >
        {label}
      </button>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={t("compose.moreSendOptions")}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${buttonClass("primary", "md")} rounded-l-none rounded-r-full border-l border-l-[color-mix(in_srgb,var(--accent-fg)_35%,transparent)] px-2.5`}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5">
          <path d="M7 10l5 5 5-5z" fill="currentColor" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width }}
            className="menu-surface z-[100] rounded-lg py-1"
          >
            <div className="px-3 pb-1 pt-1.5 text-xs font-medium text-[var(--muted-strong)]">
              {t("compose.scheduleSend")}
            </div>
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                role="menuitem"
                onClick={() => pick(preset.when.getTime())}
                className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-[var(--row-hover-bg)]"
              >
                <span>{t(preset.key)}</span>
                <span className="text-xs text-[var(--muted)]">{fmt(preset.when)}</span>
              </button>
            ))}
            <div className="mt-1 border-t border-[var(--border)] px-3 pb-2 pt-2.5">
              <div className="mb-1.5 text-xs text-[var(--muted-strong)]">{t("compose.pickDateTime")}</div>
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={custom}
                  min={localInput(now)}
                  onChange={(event) => setCustom(event.target.value)}
                  aria-label={t("compose.pickDateTime")}
                  className={`${fieldClass("sm")} min-w-0 flex-1`}
                />
                <button
                  type="button"
                  disabled={!customOk}
                  onClick={() => pick(customMs)}
                  className={buttonClass("primary", "sm")}
                >
                  {t("compose.schedule")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
