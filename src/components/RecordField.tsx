"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { InfoTip } from "./InfoTip";

// Record fields, ported from Nudge's ContactView (StackedField +
// InlineEditValue). A record page shows VALUES, not a form: the value reads as
// plain text, hover reveals the affordance, click swaps in the real control
// already focused. Enter commits, Escape reverts, blur saves.
//
// Since P12 (Nudge's usePropertyEditor and SearchableSelect, 2026-10-17): Tab
// saves and opens the NEXT field on the page (Shift-Tab the previous), so a
// record can be filled in one pass at the keyboard; and a picklist opens as a
// list you can type into, floating over the page, so the row never changes
// height the way a native select's box did.
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

// The editable values on the page, in document order, for Tab to walk.
const SLOT = "data-inline-edit-slot";

function openNeighbour(from: HTMLElement | null, step: 1 | -1) {
  if (!from) return;
  const slots = Array.from(document.querySelectorAll<HTMLElement>(`[${SLOT}]`));
  const at = slots.indexOf(from);
  const next = at >= 0 ? slots[at + step] : undefined;
  // After the commit re-renders the current slot back to its value.
  if (next) requestAnimationFrame(() => next.querySelector<HTMLButtonElement>("button")?.click());
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
  const inputRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLSpanElement>(null);
  const size = dense ? "text-xs" : "text-sm";

  useEffect(() => {
    if (!editing) return;
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

  const slot = (child: React.ReactNode) => (
    // display: contents, so the slot exists for Tab to find and takes no
    // part in layout: twenty-odd call sites lay this value out themselves.
    <span ref={slotRef} {...{ [SLOT]: "" }} className="contents">
      {child}
    </span>
  );

  if (saving) {
    // Same box as the value it replaces, so the row never resizes mid-save.
    return slot(
      <span className={`block animate-pulse px-2 py-1 ${size} text-[var(--muted)]`}>
        {value}
      </span>,
    );
  }

  if (!editing) {
    return slot(
      <button
        type="button"
        onClick={() => setEditing(true)}
        // -mx-2 + px-2: the value stays flush with the label grid while the
        // hover wash bleeds outward instead of indenting the text.
        // disabled (a read-only card): no wash and no pencil, so the value
        // reads as a fact rather than as a control that refuses.
        data-value
        className={`group/iv flex min-w-0 items-center gap-1 rounded-md py-1 text-left ${size} transition-colors hover:bg-[var(--muted-bg)] disabled:hover:bg-transparent ${
          compact
            ? "px-1"
            : "-mx-2 w-[calc(100%+1rem)] justify-between gap-2 px-2"
        }`}
      >
        <span className={`min-w-0 break-words ${value ? "" : "text-[var(--muted)]"}`}>
          {(value && labelFor ? labelFor(value) : value) || placeholder || ""}
        </span>
        <span className="shrink-0 text-[var(--muted)] opacity-0 transition-opacity group-hover/iv:opacity-100 group-focus-visible/iv:opacity-100 group-disabled/iv:hidden">
          {options ? <ChevronIcon /> : <PencilIcon />}
        </span>
      </button>,
    );
  }

  if (options) {
    const merged = value && !options.includes(value) ? [value, ...options] : options;
    return slot(
      <PicklistEditor
        value={value}
        options={clearable ? ["", ...merged] : merged}
        labelFor={labelFor}
        placeholder={placeholder}
        size={size}
        onPick={(next) => void commit(next)}
        onClose={() => setEditing(false)}
        onTab={(step) => {
          setEditing(false);
          openNeighbour(slotRef.current, step);
        }}
      />,
    );
  }

  return slot(
    <input
      ref={inputRef}
      type={type}
      defaultValue={value}
      onBlur={(e) => void commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
        // Save and go on to the next value, the way a spreadsheet does.
        if (e.key === "Tab") {
          e.preventDefault();
          const next = (e.target as HTMLInputElement).value;
          void commit(next);
          openNeighbour(slotRef.current, e.shiftKey ? -1 : 1);
        }
      }}
      // compact takes its container below sm — a focused field renders at 16px
      // there (globals.css, the iOS zoom rule), and in the service row the
      // container is a fixed grid track, which is the width that was reasoned
      // about. From sm it is 96px: it spent years at 80, which held every
      // duration and then clipped "5600.00" the moment a price ran to five
      // figures, because a number input also spends ~16px on its spinner.
      className={`px-2 py-1 ${size} ${compact ? "max-sm:w-full sm:w-24" : ""}`}
    />,
  );
}

// The picklist's editing state: the value's own line becomes a field you can
// type into, and the choices float under it through a portal (AGENTS.md: a
// popover never positions absolute inside a card). Arrows move, Enter picks,
// Escape leaves it as it was, Tab moves on without changing it.
function PicklistEditor({
  value,
  options,
  labelFor,
  placeholder,
  size,
  onPick,
  onClose,
  onTab,
}: {
  value: string;
  options: string[];
  labelFor?: (value: string) => string;
  placeholder?: string;
  size: string;
  onPick: (value: string) => void;
  onClose: () => void;
  onTab: (step: 1 | -1) => void;
}) {
  const label = (option: string) => (option ? (labelFor ? labelFor(option) : option) : "");
  const listId = useId();
  const [query, setQuery] = useState("");
  const { triggerRef, panelRef, pos, show } = useAnchoredPanel<HTMLInputElement>("trigger", 240);
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? options.filter((option) => option && label(option).toLocaleLowerCase().includes(needle))
    : options;
  const [active, setActive] = useState(() => Math.max(0, shown.indexOf(value)));
  const activeIndex = Math.min(active, Math.max(0, shown.length - 1));

  useEffect(() => {
    triggerRef.current?.focus();
    show();
  }, [triggerRef, show]);

  return (
    <>
      <input
        ref={triggerRef}
        value={query}
        placeholder={label(value) || placeholder || ""}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onBlur={(event) => {
          // A click in the list lands there first; it closes us itself.
          if (panelRef.current?.contains(event.relatedTarget as Node | null)) return;
          onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive(Math.min(shown.length - 1, activeIndex + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(Math.max(0, activeIndex - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (shown[activeIndex] !== undefined) onPick(shown[activeIndex]);
          } else if (event.key === "Escape") {
            onClose();
          } else if (event.key === "Tab") {
            event.preventDefault();
            onTab(event.shiftKey ? -1 : 1);
          }
        }}
        role="combobox"
        aria-expanded={pos !== null}
        aria-controls={listId}
        className={`w-full px-2 py-1 ${size}`}
      />
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
            }}
            className="menu-surface thin-scroll z-[100] max-h-60 overflow-y-auto rounded-lg py-1"
          >
            {shown.map((option, index) => (
              <button
                key={option || "__blank"}
                type="button"
                role="option"
                aria-selected={option === value}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(option)}
                onMouseEnter={() => setActive(index)}
                className={`flex min-h-7 w-full items-center px-3 py-1 text-left ${size} ${
                  index === activeIndex ? "bg-[var(--control-hover)]" : ""
                } ${option === value ? "font-medium" : ""}`}
              >
                {label(option) || <span className="text-[var(--muted)]">—</span>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
