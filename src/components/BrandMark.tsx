// The product mark: Nudge's chevrons on --logo red (see AppShell's OrgMark
// comment for why red, not --brand green). Shared by the landing header, the
// sign-in dialog and the /signin page so the glyph can never drift.
export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg bg-[var(--logo)] ${
        small ? "h-7 w-7" : "h-8 w-8"
      }`}
    >
      <svg viewBox="0 0 24 24" className={small ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true">
        <path
          d="M4 6l6 6-6 6M13 6l6 6-6 6"
          fill="none"
          stroke="#fff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
