"use client";

import { useEffect, useRef, useState } from "react";
import { InfoTip } from "./InfoTip";

// Record fields, ported from Nudge's ContactView (StackedField +
// InlineEditValue). A record page shows VALUES, not a form: the value reads as
// plain text, hover reveals the affordance, click swaps in the real control
// already focused. Enter commits, Escape reverts, blur saves.
//
// Ported with one correction: Nudge's group heading is uppercase, which is out
// of the design language. Sentence case here.

export function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(6rem,7.5rem)_minmax(0,1fr)] items-start gap-x-2">
      <div className="flex items-center gap-1.5 pt-1 text-sm leading-snug text-[var(--muted)]">
        <span className="min-w-0 break-words">{label}</span>
        {hint && <InfoTip text={hint} />}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// `hint` is where a group earns an explanation without spending a paragraph on
// it: the (i) sits inside the heading's own gap-2 row, so the copy is one hover
// away and the visible line stays a heading.
// `action` sits after the rule, at the right edge, for the one control that
// belongs to a whole group rather than to any row in it. It goes there rather
// than under the list because a group you can add to should say so before you
// have read to the bottom of it, and an empty group has no bottom to read to.
export function FieldGroup({
  label,
  hint,
  action,
}: {
  label: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <span className="text-sm font-medium">{label}</span>
      {hint && <InfoTip text={hint} />}
      <span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
      {action}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function InlineEditValue({
  value,
  options,
  labelFor,
  type = "text",
  placeholder,
  compact,
  onSave,
}: {
  value: string;
  // null → free text; array → picklist.
  options?: string[] | null;
  // Display name for a picklist value, when the stored value is a slug the
  // reader should never see ("owner" → "Yönetici").
  labelFor?: (value: string) => string;
  type?: "text" | "number" | "date" | "email" | "tel";
  placeholder?: string;
  // Shrink-to-fit instead of filling its column. For values that read as one
  // token with what follows them ("45" + "min"), where a full-width control
  // would strand the unit on the far side of the row.
  compact?: boolean;
  onSave: (value: string) => unknown;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    selectRef.current?.focus();
    inputRef.current?.focus();
  }, [editing]);

  const commit = async (next: string) => {
    setEditing(false);
    if (next.trim() === value.trim()) return;
    setSaving(true);
    try {
      await onSave(next.trim());
    } finally {
      setSaving(false);
    }
  };

  if (saving) {
    // Same box as the value it replaces, so the row never resizes mid-save.
    return (
      <span className="block animate-pulse px-2 py-1 text-sm text-[var(--muted)]">
        {value}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        // -mx-2 + px-2: the value stays flush with the label grid while the
        // hover wash bleeds outward instead of indenting the text.
        className={`group/iv flex min-w-0 items-center gap-1 rounded-md py-1 text-left text-sm transition-colors hover:bg-[var(--muted-bg)] ${
          compact
            ? "px-1"
            : "-mx-2 w-[calc(100%+1rem)] justify-between gap-2 px-2"
        }`}
      >
        <span className={`min-w-0 break-words ${value ? "" : "text-[var(--muted)]"}`}>
          {(value && labelFor ? labelFor(value) : value) || placeholder || ""}
        </span>
        <span className="shrink-0 text-[var(--muted)] opacity-0 transition-opacity group-hover/iv:opacity-100 group-focus-visible/iv:opacity-100">
          {options ? <ChevronIcon /> : <PencilIcon />}
        </span>
      </button>
    );
  }

  if (options) {
    const merged = value && !options.includes(value) ? [value, ...options] : options;
    return (
      <select
        ref={selectRef}
        defaultValue={value}
        onChange={(e) => void commit(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        className="px-2 py-1 text-sm"
      >
        <option value="" />
        {merged.map((option) => (
          <option key={option} value={option}>
            {labelFor ? labelFor(option) : option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      ref={inputRef}
      type={type}
      defaultValue={value}
      onBlur={(e) => void commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
      className={`px-2 py-1 text-sm ${compact ? "w-20" : ""}`}
    />
  );
}
