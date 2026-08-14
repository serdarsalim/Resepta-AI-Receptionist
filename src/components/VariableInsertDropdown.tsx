"use client";

// Searchable "Insert variable" dropdown, ported from Nudge. The vocabulary is
// the SOURCE OF TRUTH, never a hardcoded list: every org-defined contact
// field from the Fields tab (api.contactFields.list — the same registry the
// voice agent and the contact page read), plus the appointment facts that are
// not contact fields (business name, date, service, staff). A token this menu
// offers is a token renderTokens resolves, because both sides read the same
// registry.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { foldSearch } from "@/lib/useTableState";

export function VariableInsertDropdown({
  onInsert,
}: {
  onInsert: (token: string) => void;
}) {
  const { t } = useLanguage();
  const fields = useQuery(api.contactFields.list, {}) ?? [];
  // Appointment facts, by their canonical token names (lib/renderTokens).
  // Token NAMES are English, always, in all three interfaces. The label
  // beside each one is what translates. A token is a piece of stored text
  // inside a message body: if the name followed the interface language, a
  // body written in one language would read as a broken token the day the
  // interface switched, since the stored string cannot be right in three
  // languages at once. (The Turkish and German aliases in lib/renderTokens
  // stay valid forever — bodies already written with them keep working.)
  const builtIns = [
    { key: "business", label: t("vars.business") },
    { key: "date", label: t("vars.date") },
    { key: "service", label: t("vars.service") },
    { key: "pricelist", label: t("vars.priceList") },
    { key: "price", label: t("vars.price") },
    { key: "staff", label: t("vars.staff") },
    // The org's own booking link and public number (orgs.bookingUrl /
    // orgs.publicPhone) — "book here" and "call us" in any template.
    { key: "booking_link", label: t("vars.bookingLink") },
    { key: "phone", label: t("vars.phone") },
    // This appointment's own reschedule/cancel page. Resolves only in
    // appointment-lifecycle messages; empty elsewhere.
    { key: "manage_link", label: t("vars.manageLink") },
  ];
  // Two groups, and the order matters. These behave differently: a built-in
  // is filled from the appointment or the business and is therefore almost
  // always there, while a contact field is filled from THIS customer's record
  // and is empty for anyone who never answered it. One flat list put "Your
  // favorite color" above "Appointment date" and read as one undifferentiated
  // vocabulary, which is how a template ends up quietly missing a line.
  const custom = fields.map((field) => ({ key: field.key, label: field.label }));
  const groups = [
    { title: t("editor.varsBuiltIn"), items: builtIns },
    ...(custom.length > 0
      ? [{ title: t("editor.varsCustom"), items: custom }]
      : []),
  ];

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = foldSearch(filter.trim());
  const match = (v: { key: string; label: string }) =>
    !q || foldSearch(v.label).includes(q) || foldSearch(v.key).includes(q);
  const shownGroups = groups
    .map((group) => ({ ...group, items: group.items.filter(match) }))
    .filter((group) => group.items.length > 0);
  // Enter takes the first hit across the groups, in the order they render.
  const shown = shownGroups.flatMap((group) => group.items);

  const pick = (key: string) => {
    onInsert(`[${key}]`);
    setOpen(false);
    setFilter("");
  };

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
      >
        {t("editor.insertVariable")}
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-60 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
          <div className="p-1.5">
            <input
              ref={inputRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && shown.length > 0) pick(shown[0].key);
              }}
              placeholder={t("editor.searchVariables")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs focus:outline-none"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto pb-1">
            {shownGroups.map((group) => (
              <li key={group.title}>
                {/* Only worth a heading when there is something to tell apart:
                    an org with no contact fields of its own gets one list and
                    no label over it. */}
                {shownGroups.length > 1 && (
                  <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
                    {group.title}
                  </div>
                )}
                <ul>
                  {group.items.map((v) => (
                    <li key={v.key}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          // mousedown (not click) so the textarea's selection
                          // isn't lost before the insert lands at the cursor.
                          e.preventDefault();
                          pick(v.key);
                        }}
                        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--muted-bg)]"
                      >
                        <span className="truncate">{v.label}</span>
                        <span className="shrink-0 font-mono text-[10px] text-[var(--muted)]">
                          [{v.key}]
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-2.5 py-1.5 text-xs text-[var(--muted)]">
                {t("editor.noVariableMatch")}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
