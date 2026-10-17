"use client";

// One line of text, asked for in the app's own dialog rather than the
// browser's. window.prompt was doing this in the email editor (the link
// button), and it announces itself as "localhost:3006 says" in a grey box the
// product cannot style or translate (Nudge 541748dc, P26). Built on Sheet for
// the same reasons ConfirmDialog is: the backdrop, Escape for the topmost
// dialog only, and focus landing in the field.

import { useState } from "react";
import { Sheet } from "./Sheet";
import { useLanguage } from "@/lib/LanguageProvider";

export function InputDialog({
  title,
  initialValue = "",
  placeholder,
  submitLabel,
  // A second, quieter way out that is not Cancel: the link dialog's Remove
  // link. Hidden when not given.
  extra,
  onSubmit,
  onCancel,
}: {
  title: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  extra?: { label: string; onClick: () => void };
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState(initialValue);
  return (
    <Sheet title={title} onClose={onCancel}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <input
          data-sheet-autofocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => event.target.select()}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        <div className="mt-4 flex items-center gap-2">
          {extra && (
            <button
              type="button"
              onClick={extra.onClick}
              className="rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-[var(--muted-bg)] dark:text-red-400"
            >
              {extra.label}
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
          >
            {submitLabel ?? t("common.save")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
