"use client";

import { useEffect, useRef, useState } from "react";
import { CountryCodeSelect, FlagByIso } from "./CountryCodeSelect";
import { absorbInternational, joinPhone, phoneCountry, splitPhone } from "@/lib/phone";
import { useDetectedDialCode } from "@/lib/useDialCode";
import { useLanguage } from "@/lib/LanguageProvider";
import type { Language } from "@/lib/i18n";

// Phone entry, ported from Nudge (ContactView's PhoneEditValue and
// AddContactModal's split pair). Two components, one rule.
//
// `PhoneField` is the record-page value: reads as flag + plain text, hover
// reveals the pencil, click splits it into [country ▾][national number]. Same
// grammar as InlineEditValue in RecordField.tsx.
//
// `PhoneInput` is the add-form control, so a number cannot be created without a
// dial code in the first place. Fixing numbers only on the record page would let
// every new customer in with a bare one.
//
// Two rules, and they are not in tension: a country code is MANDATORY for a
// number that exists, and clearing the field entirely is always allowed. The
// thing we refuse is a half-number, digits with no country, because that is what
// silently breaks WhatsApp dispatch and call routing downstream. The backend
// agrees (convex/lib/orgAuth.ts assertE164 throws on anything but E.164), so
// without this the salon owner would get a raw "phone-must-be-e164" instead.

// Strings live here rather than in src/lib/i18n.ts because that dictionary is
// owned elsewhere right now. Same shape as its entries, typed against the same
// Language union, so adding a language column there breaks this file too and
// these lift straight in when the file is free.
const COPY: Record<string, Record<Language, string>> = {
  needCountry: {
    tr: "Bir ülke seçin. Ülke kodu olmayan numaraya mesaj gönderilemez, arama yapılamaz.",
    en: "Pick a country. Without a dial code the number cannot be messaged or called.",
    de: "Wählen Sie ein Land. Ohne Ländervorwahl kann die Nummer weder angeschrieben noch angerufen werden.",
  },
  needCountryForm: {
    tr: "Numara için bir ülke seçin, ya da numarayı boş bırakın.",
    en: "Pick a country for this number, or leave the number blank.",
    de: "Wählen Sie ein Land für diese Nummer, oder lassen Sie die Nummer leer.",
  },
  remove: {
    tr: "Telefon numarasını kaldır",
    en: "Remove phone number",
    de: "Telefonnummer entfernen",
  },
  number: { tr: "Telefon numarası", en: "Phone number", de: "Telefonnummer" },
};

const NATIONAL_PLACEHOLDER = "532 123 45 67";

// Typing keeps spaces and dashes so a number can be entered the way it is read
// out loud; joinPhone strips them on the way to storage.
const cleanNational = (raw: string) => raw.replace(/[^\d\s-]/g, "");

// One handler for both components. A number arriving with its country attached
// — typed "+90…", or pasted "0090…" the way it is dialled from abroad — splits
// itself: the code goes to the picker, the rest stays in the box. Anything
// ordinary falls through to the plain clean.
function applyNationalInput(
  raw: string,
  setCode: (next: string) => void,
  setNational: (next: string) => void,
) {
  const absorbed = absorbInternational(raw);
  if (absorbed) {
    setCode(absorbed.code);
    setNational(cleanNational(absorbed.national));
    return;
  }
  setNational(cleanNational(raw));
}

const nationalCls =
  "min-w-[9rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-base";

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}

export function PhoneField({
  value,
  dense,
  onSave,
}: {
  value: string;
  // The record card's tier, matching InlineEditValue's own `dense`. This field
  // sits in the same column as those values and has to read at the same size.
  dense?: boolean;
  onSave: (value: string) => unknown;
}) {
  const { language } = useLanguage();
  const size = dense ? "text-xs" : "text-sm";
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState("");
  const [national, setNational] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // phoneCountry only resolves a leading "+" plus a real dial code, so a value
  // that merely starts with a digit can never sprout a flag.
  const country = phoneCountry(value);

  const open = () => {
    const parts = splitPhone(value);
    setCode(parts.code ? `+${parts.code}` : "");
    setNational(parts.national);
    setEditing(true);
  };
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Digits with no country is the one state we will not store. Empty is fine,
  // that is a delete, and it is the whole point of the remove button.
  const missingCode = national.trim() !== "" && !code;

  const commit = async () => {
    if (missingCode) return; // stay open; the hint says why
    const next = joinPhone(code, national);
    setEditing(false);
    if (next === value.trim()) return;
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setEditing(false);
    if (!value.trim()) return;
    setSaving(true);
    try {
      await onSave("");
    } finally {
      setSaving(false);
    }
  };

  if (saving) {
    // Same box as the value it replaces, so the row never resizes mid-save.
    return (
      <span className={`block animate-pulse px-2 py-1 ${size} text-[var(--muted)]`}>{value}</span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        // -mx-2 + px-2: the value stays flush with the label grid while the
        // hover wash bleeds outward instead of indenting the text.
        className={`group/iv -mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1 text-left ${size} transition-colors hover:bg-[var(--muted-bg)]`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {country && <FlagByIso iso={country.iso} label={country.label} />}
          {/* Blank, not a dash: an empty phone is a real state and a
              placeholder glyph is the noise the blank was meant to cut. */}
          <span className="min-w-0 break-words">{value}</span>
        </span>
        <span className="shrink-0 text-[var(--muted)] opacity-0 transition-opacity group-hover/iv:opacity-100 group-focus-visible/iv:opacity-100">
          <PencilIcon />
        </span>
      </button>
    );
  }

  return (
    <div
      // Commit when focus leaves the whole group, not the input: moving from
      // the number to the country picker must not count as finishing.
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        void commit();
      }}
    >
      {/* Wraps rather than squeezes. The record card's value column is narrow,
          and flag + dial code + a 10-digit national number + remove do not fit
          on one line there. Given a min width the input drops to its own line
          when it has to, and stays inline wherever there is room. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <CountryCodeSelect variant="flag" value={code} onChange={setCode} />
        <input
          ref={inputRef}
          type="tel"
          inputMode="tel"
          aria-label={COPY.number[language]}
          value={national}
          onChange={(e) => applyNationalInput(e.target.value, setCode, setNational)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder={NATIONAL_PLACEHOLDER}
          className={nationalCls}
        />
        {!!value && (
          <button
            type="button"
            onClick={() => void clear()}
            className="shrink-0 rounded-md px-1.5 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-red-600 dark:hover:text-red-400"
            aria-label={COPY.remove[language]}
          >
            <TrashIcon />
          </button>
        )}
      </div>
      {missingCode && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          {COPY.needCountry[language]}
        </p>
      )}
    </div>
  );
}

// Add-form control. Owns its own two halves and publishes the joined E.164
// through a hidden input, so a FormData-driven form keeps reading one `phone`
// field and the call site stays a one-line swap.
export function PhoneInput({
  name = "phone",
  id,
  required,
  className,
  defaultValue,
  autoFocus,
}: {
  name?: string;
  // Point the row's <label htmlFor> at the number box rather than letting the
  // browser bind it to the country trigger, which would open the picker.
  id?: string;
  required?: boolean;
  className?: string;
  // An E.164 number to start from — the booking page's device memory. Read
  // once at mount, and it wins over geo detection: the code it carries is a
  // fact about this person, where the lookup is a guess about their network.
  defaultValue?: string;
  autoFocus?: boolean;
}) {
  const { language } = useLanguage();
  const [code, setCode] = useState(() => {
    const parts = defaultValue ? splitPhone(defaultValue) : null;
    return parts?.code ? `+${parts.code}` : "";
  });
  const [national, setNational] = useState(
    () => (defaultValue ? splitPhone(defaultValue).national : ""),
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const missingCode = national.trim() !== "" && !code;

  // Start on the visitor's own country instead of an empty picker: a Turkish
  // salon should not pick Türkiye every single time. Applied ONCE, and only
  // while the field is still untouched — a geo lookup landing late must never
  // overwrite a code somebody already chose or typed. Detection failing leaves
  // the picker empty on purpose; a wrong dial code looks answered.
  const detectedCode = useDetectedDialCode();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !detectedCode) return;
    if (code || national) {
      seeded.current = true; // user got there first
      return;
    }
    seeded.current = true;
    setCode(detectedCode);
  }, [detectedCode, code, national]);

  // Blocks the native submit without a native bubble: the message below the
  // control is the humanised version, and setCustomValidity's default bubble
  // would say the same thing twice in the browser's voice.
  useEffect(() => {
    inputRef.current?.setCustomValidity(missingCode ? COPY.needCountryForm[language] : "");
  }, [missingCode, language]);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        <CountryCodeSelect variant="flag" value={code} onChange={setCode} />
        <input
          ref={inputRef}
          id={id}
          type="tel"
          inputMode="tel"
          required={required}
          autoFocus={autoFocus}
          aria-label={COPY.number[language]}
          value={national}
          onChange={(e) => applyNationalInput(e.target.value, setCode, setNational)}
          onInvalid={(e) => {
            if (missingCode) e.preventDefault();
          }}
          placeholder={NATIONAL_PLACEHOLDER}
          className={nationalCls}
        />
      </div>
      <input type="hidden" name={name} value={joinPhone(code, national)} />
      {missingCode && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          {COPY.needCountryForm[language]}
        </p>
      )}
    </div>
  );
}
