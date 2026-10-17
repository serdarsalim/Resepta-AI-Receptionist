// The app's one filter pill: the round chips above a list or a feed that
// choose what it shows. The Inbox's All / Unread / Pinned, the conversation's
// channel pills and a bulk run's answer chips all take their classes from
// here, so the three cannot drift into three treatments of one idea again
// (P21, Nudge's FilterPill).
//
// Selected is a FILL and nothing else, WhatsApp Web's way (Nudge a868cc38):
// the old accent outline plus accent semibold text read as a button rather
// than a chosen state. The border goes transparent, not away, so the pill
// keeps its size, and the weight matches idle so the label never widens on
// select (nothing shifts under the pointer).
//
// Idle hover tints the fill (Nudge af43925b): a text colour change alone was
// too faint to say "this is clickable". The explicit --card background stays
// for the reason FeedFilterPills gave: these sit on tinted panes, and an
// unfilled pill there is a ring around a piece of the background.
//
// The height is FIXED so a pill holding only a glyph and one holding a word
// line up. "sm" is the denser row under a bulk run, same height, smaller type.
export function filterPillClass(active: boolean, size: "md" | "sm" = "md"): string {
  const base = `inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-2.5 transition-colors ${
    size === "sm" ? "text-xs" : "text-sm"
  }`;
  if (active) {
    return `${base} border-transparent bg-[color-mix(in_srgb,var(--accent)_16%,var(--card))] font-medium text-[var(--foreground)] dark:bg-[color-mix(in_srgb,var(--accent)_24%,var(--card))]`;
  }
  return `${base} border-[var(--border)] bg-[var(--card)] font-medium text-[var(--foreground)]/75 hover:bg-[color-mix(in_srgb,var(--foreground)_7%,var(--card))] hover:text-[var(--foreground)]`;
}
