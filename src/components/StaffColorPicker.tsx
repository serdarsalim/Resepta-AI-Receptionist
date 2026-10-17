"use client";

import { useMutation } from "convex/react";
import { createPortal } from "react-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { STAFF_COLORS, staffColor } from "../../convex/lib/staffColors";
import { useLanguage } from "@/lib/LanguageProvider";
import { useToast } from "@/lib/ToastProvider";
import type { TranslationKey } from "@/lib/i18n";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { staffSwatch } from "@/lib/staffTint";
import { HoverTip } from "./HoverTip";

// A team member's calendar colour, picked from the dot before their name: on
// the Team card and on the calendar's side panel, where the dot IS the colour
// key (Nudge's HostColorPicker, which lives on the person for the same
// reason). A colour somebody else here already has is shown but cannot be
// picked, and the server refuses it too: telling two people's bookings apart
// is the colour's only job.
//
// Swatches never grow on hover (nothing moves under the pointer, the first of
// the design rules); a ring around the swatch is the hover.

const PANEL_W = 196;

const NAME: Record<string, TranslationKey> = {
  lavender: "staffColor.lavender",
  peacock: "staffColor.peacock",
  sage: "staffColor.sage",
  tangerine: "staffColor.tangerine",
  grape: "staffColor.grape",
  banana: "staffColor.banana",
  blueberry: "staffColor.blueberry",
  flamingo: "staffColor.flamingo",
  basil: "staffColor.basil",
  graphite: "staffColor.graphite",
};

export function StaffColorPicker({
  staffId,
  name,
  color,
  taken,
  readOnly = false,
  className = "",
}: {
  staffId: Id<"staff">;
  name: string;
  // The RESOLVED key, chosen or not (staff.list, team.roster).
  color: string;
  // Who holds each other colour in this business, for the greyed swatches.
  taken: ReadonlyMap<string, string>;
  // A member's view: the dot still says who is which, it just opens nothing.
  readOnly?: boolean;
  // Extra classes on the trigger: the side panel shows it on the row's hover.
  className?: string;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const setColor = useMutation(api.staff.setColor);
  const { triggerRef, panelRef, pos, open, toggle, close } = useAnchoredPanel(PANEL_W, 120);
  const current = staffColor(color);
  const colorName = (key: string) => t(NAME[key] ?? "staffColor.lavender");

  if (readOnly) {
    return (
      <HoverTip text={colorName(current.key)} className="inline-flex shrink-0">
      <span
        aria-label={t("staffColor.of", { name, color: colorName(current.key) })}
        className="flex h-6 w-6 shrink-0 items-center justify-center"
      >
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: staffSwatch(current.key) }} />
      </span>
      </HoverTip>
    );
  }

  return (
    <>
      <HoverTip text={colorName(current.key)} className="inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("staffColor.change", { name, color: colorName(current.key) })}
        onClick={toggle}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--control-hover)] ${className}`}
      >
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: staffSwatch(current.key) }} />
      </button>
      </HoverTip>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={t("staffColor.title", { name })}
            style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width }}
            className="menu-surface z-[100] rounded-lg p-3"
          >
            <div className="grid grid-cols-5 gap-2.5">
              {STAFF_COLORS.map((c) => {
                const owner = taken.get(c.key);
                const selected = c.key === current.key;
                return (
                  // On a wrapper that fills the cell, and the disabled swatch
                  // lets the pointer through to it: a disabled button fires no
                  // mouse events, and a taken colour has to say whose it is.
                  <HoverTip
                    key={c.key}
                    text={
                      owner !== undefined
                        ? t("staffColor.takenBy", { name: owner })
                        : colorName(c.key)
                    }
                    className="flex justify-center"
                  >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    disabled={owner !== undefined}
                    aria-label={
                      owner !== undefined
                        ? `${colorName(c.key)}, ${t("staffColor.takenBy", { name: owner })}`
                        : colorName(c.key)
                    }
                    onClick={() => {
                      close();
                      if (selected) return;
                      void setColor({ staffId, color: c.key })
                        .then((result) =>
                          toast(
                            result.ok
                              ? t("common.saved")
                              : result.code === "color-taken"
                                ? t("staffColor.takenError")
                                : t("common.error"),
                          ),
                        )
                        .catch(() => toast(t("common.error")));
                    }}
                    className="mx-auto flex h-7 w-7 items-center justify-center rounded-full transition-shadow hover:ring-2 hover:ring-[var(--muted)] hover:ring-offset-2 hover:ring-offset-[var(--card)] disabled:pointer-events-none disabled:opacity-30 disabled:hover:ring-0"
                    style={{ backgroundColor: staffSwatch(c.key), color: c.fg }}
                  >
                    {selected && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                  </HoverTip>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
