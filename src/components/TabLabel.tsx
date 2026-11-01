// One underlined tab, shared by every strip (AGENTS.md, "Tabs are underlined,
// never pills"). The open tab is semibold in the ink colour, idle tabs
// regular in --muted-strong (Serdar, 2026-11-01, after Nudge). A bold word is
// wider, so the label reserves its bold width up front (.tab-label in
// globals.css) and a click moves nothing along the strip.

export function tabClass(active: boolean, extra = ""): string {
  return `-mb-px border-b-2 px-0.5 py-2.5 text-sm transition-colors ${extra} ${
    active
      ? "border-[var(--foreground)] font-semibold text-[var(--foreground)]"
      : "border-transparent font-normal text-[var(--muted-strong)] hover:text-[var(--foreground)]"
  }`;
}

export function TabLabel({ text }: { text: string }) {
  return (
    <span className="tab-label" data-label={text}>
      <span className="truncate">{text}</span>
    </span>
  );
}
