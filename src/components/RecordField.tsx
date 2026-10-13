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

// Two tiers, not one. The label and the value used to render at the same size
// in the same weight, which is a form's grammar, not a record's: on a form you
// read the question, on a record you read the ANSWER and glance left to see
// what it answers. Nudge's numbers, measured off its live DOM rather than
// eyeballed — 11px muted-strong label against a text-xs foreground value.
//
// The label track is WIDER than Nudge's, not narrower, and the smaller type is
// why it can be. Our labels are org-authored questions ("what is your best
// friends favorite restaurant?"), not CRM property names, so they are the half
// of the row that runs long — while the values are a first name and a phone
// number and leave most of their column empty. A 6.5rem track broke that
// question across three lines to protect space nothing was using.
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
    <div className="grid grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)] items-start gap-x-3">
      <div className="flex items-center gap-1.5 pt-1 text-[11px] leading-snug text-[var(--muted-strong)]">
        <span className="min-w-0 break-words">{label}</span>
        {hint && <InfoTip text={hint} />}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// FieldGroup lived here and is gone (2026-08-25). It drew a labelled divider
// between groups of fields on the contact record, and the record stopped
// having groups: "From calls" split them by which door a value arrived
// through, and "Contact fields" named a category every row on the page already
// belonged to. One continuous list needs no heading, so nothing calls this.

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
  clearable = true,
  dense,
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
  // Whether the picklist offers a blank row. It exists to CLEAR a value, so it
  // belongs on an org field somebody filled in by mistake — and not on a value
  // the record always has. An appointment is always in some status, and the
  // blank option there is a way to hand the server a status it will reject.
  clearable?: boolean;
  // The record card's tier. A value on a contact record sits one step below the
  // same control on a settings screen, because a record is a list you SCAN and a
  // settings row is a question you answer. Opt-in rather than the default, so
  // Business, Reminders and Account keep the size they were built at.
  dense?: boolean;
  onSave: (value: string) => unknown;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const size = dense ? "text-xs" : "text-sm";

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
      <span className={`block animate-pulse px-2 py-1 ${size} text-[var(--muted)]`}>
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
        className={`group/iv flex min-w-0 items-center gap-1 rounded-md py-1 text-left ${size} transition-colors hover:bg-[var(--muted-bg)] ${
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
        className={`px-2 py-1 ${size}`}
      >
        {clearable && <option value="" />}
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
      // compact takes its container below sm — a focused field renders at 16px
      // there (globals.css, the iOS zoom rule), and in the service row the
      // container is a fixed grid track, which is the width that was reasoned
      // about. From sm it is 96px: it spent years at 80, which held every
      // duration and then clipped "5600.00" the moment a price ran to five
      // figures, because a number input also spends ~16px on its spinner.
      className={`px-2 py-1 ${size} ${compact ? "max-sm:w-full sm:w-24" : ""}`}
    />
  );
}
