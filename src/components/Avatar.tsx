"use client";

// The identity mark, one implementation. Ported from Nudge's Avatar
// (2026-10-13). Here its first home is the account menu, which drew the same
// circle twice by hand (the sidebar row's and the collapsed rail's) with its
// own initials helper beside them. The notes in the customer record become
// signed rows in a later phase (P12 in docs/nudge-port-plan.md) and will wear
// the same circle; Nudge's machine tone and glyphs for unsigned notes come
// with them, not before.

// First letter of the first and the last word of the name, Google's way, so
// "Ayşe Nur Yılmaz" is AY. No name: the first letter of the address.
function initialsFrom(name?: string | null, email?: string | null): string {
  const source = (name ?? "").trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }
  return (email ?? "?").trim().charAt(0).toUpperCase() || "?";
}

// The account menu's two: the sidebar row's circle and the collapsed rail's.
export type AvatarSize = "sm" | "md";

const BOX: Record<AvatarSize, string> = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-8 w-8 text-xs",
};

export function Avatar({
  name,
  email,
  size = "sm",
  className = "",
}: {
  name?: string | null;
  email?: string | null;
  size?: AvatarSize;
  // State from a group the circle sits in (the account button's hover ring).
  // Appended, never geometry.
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 select-none items-center justify-center rounded-full bg-[var(--muted-bg)] font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)] ${BOX[size]} ${className}`}
    >
      {initialsFrom(name, email)}
    </span>
  );
}
