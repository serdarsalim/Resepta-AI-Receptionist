// Ported from Nudge (P15) as is.
// Where the caret is ON SCREEN, via a throwaway mirror of the field. Same
// trick as the tinted mirror behind the text, for a different consumer: an "@"
// menu has to open AT the caret, and a textarea exposes no coordinates for it.
//
// The mirror must copy every property that affects wrapping, or the menu lands
// on the wrong line. It cannot reuse the tinted mirror — that one is styled for
// display and does not carry a marker at the caret offset.
export function caretViewportPos(el: HTMLTextAreaElement | HTMLInputElement): {
  left: number;
  top: number;
} {
  const style = window.getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const prop of [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "boxSizing",
  ] as const) {
    mirror.style[prop] = style[prop];
  }
  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.width = `${el.clientWidth}px`;
  mirror.textContent = el.value.slice(0, el.selectionStart ?? 0);
  const marker = document.createElement("span");
  // A zero-width space: it has a position but no advance width of its own.
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const box = el.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || 18;
  const left = box.left + marker.offsetLeft - el.scrollLeft;
  const top = box.top + marker.offsetTop - el.scrollTop + lineHeight;
  mirror.remove();
  // Clamped so a caret at the far right or the last line still gets a menu
  // that is fully on screen.
  return {
    left: Math.min(Math.max(8, left), window.innerWidth - AT_MENU_W - 8),
    top: Math.min(Math.max(8, top), window.innerHeight - 200),
  };
}

// The width the clamp above reserves, and the width the menu is drawn at. One
// number: a menu wider than the clamp knows about hangs off the right edge.
export const AT_MENU_W = 260;
