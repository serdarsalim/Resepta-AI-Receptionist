"use client";

import { useState } from "react";

// The identity mark, one implementation. Ported from Nudge's Avatar
// (2026-10-13). Here its first home is the account menu, which drew the same
// circle twice by hand (the sidebar row's and the collapsed rail's) with its
// own initials helper beside them. The customer record's notes are signed
// rows wearing it since P12 (2026-10-17). Nudge's machine tone and glyphs for
// unsigned notes were not taken: a note here with no person on it is the
// customer's own (the booking page), and it wears their initials.

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
  image,
  size = "sm",
  className = "",
}: {
  name?: string | null;
  email?: string | null;
  // The person's photo, the Google profile picture stored at sign-in (Nudge
  // d43bac8d). The initials stay underneath as the fallback: a URL that 404s
  // or is blocked drops back to them instead of leaving a broken-image box.
  image?: string | null;
  size?: AvatarSize;
  // State from a group the circle sits in (the account button's hover ring).
  // Appended, never geometry.
  className?: string;
}) {
  // The src that failed, not a boolean: a new photo after a fresh sign-in
  // gets its own chance instead of inheriting the old one's failure.
  const [failed, setFailed] = useState<string | null>(null);
  const src = image?.trim() || null;
  if (src && failed !== src) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- a remote
         avatar, not worth routing through the image optimiser */
      <img
        src={src}
        alt=""
        aria-hidden
        // Google's photo host refuses some cross-site requests that carry a
        // Referer; without this the picture can fail on our own domain.
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className={`shrink-0 select-none rounded-full object-cover ring-1 ring-[var(--border)] ${BOX[size]} ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`flex shrink-0 select-none items-center justify-center rounded-full bg-[var(--muted-bg)] font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)] ${BOX[size]} ${className}`}
    >
      {initialsFrom(name, email)}
    </span>
  );
}
