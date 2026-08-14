"use client";

// The "when empty, print…" boxes under a message body. Ported from Nudge.
//
// A [token] whose value is blank for this customer renders as nothing, and
// renderTokens tidies the punctuation around the hole so the sentence still
// reads — which is the right behaviour on a real send and also the reason the
// loss is invisible. "Your appointment with [staff]" quietly becomes "Your
// appointment with", and nobody finds out until a customer asks.
//
// The fallback is authored HERE, beside the sentence it repairs, because the
// wording is EDITORIAL: what reads correctly in place depends on the sentence
// and on this template's language. That is also why it lives on the template
// rather than on the field — one field, many sentences, different words.
//
// Rows are derived from the body itself: the tokens actually used, in the
// order used. An unknown token gets no row on purpose — renderTokens leaves an
// unrecognised [token] literal, so a typo stays visible instead of being
// quietly answered by a default meant for something else.

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { InfoTip } from "./InfoTip";

export type VariableDefault = { key: string; value: string };

// Every token mentioned across the given bodies, deduped, first-seen order.
export function tokensIn(...bodies: (string | undefined)[]): string[] {
  const seen: string[] = [];
  for (const body of bodies) {
    if (!body) continue;
    for (const match of body.matchAll(/\[([^\]\n]{1,32})\]/g)) {
      const key = match[1].trim().toLowerCase();
      if (key && !seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

export function VariableDefaultsEditor({
  bodies,
  defaults,
  onChange,
  disabled,
}: {
  bodies: (string | undefined)[];
  defaults: VariableDefault[];
  onChange: (next: VariableDefault[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const fields = useQuery(api.contactFields.list, {}) ?? [];

  // ── ONLY TOKENS THAT CAN HONESTLY BE BLANK ─────────────────────────────
  //
  // A fallback is worth authoring where the value varies per customer or per
  // booking AND can legitimately be missing. Everything else is either always
  // there or is configuration, and offering a row for those teaches the wrong
  // lesson — that the way to fix a missing booking link is to write a
  // sentence about not having one, rather than to go and set the link.
  //
  // Excluded and why:
  //   [business]                  the org always has a name; it cannot be blank
  //   [date]                      every appointment-lifecycle send has a time
  //   [booking_link] / [phone]    org CONFIG. Blank means "go set it" — those
  //                               two now live in Business settings
  //   [manage_link]               structural: present on lifecycle sends,
  //                               absent everywhere else, never per-customer
  //   [name]                      renderTokens tidies the greeting when it is
  //                               blank ("Hello [name]!" → "Hello!"), so the
  //                               sentence already survives without help
  //
  // What is left is the honest list: the org's own contact fields, which are
  // blank for anyone who never answered them, and the three booking facts a
  // real appointment can genuinely lack.
  const labels = new Map<string, string>([
    ["service", t("vars.service")],
    ["pricelist", t("vars.priceList")],
    ["fiyatlistesi", t("vars.priceList")],
    ["price", t("vars.price")],
    ["staff", t("vars.staff")],
    ...fields.map((field) => [field.key, field.label] as [string, string]),
  ]);

  const rows = tokensIn(...bodies).filter((key) => labels.has(key));
  if (rows.length === 0) return null;

  const valueOf = (key: string) =>
    defaults.find((entry) => entry.key === key)?.value ?? "";
  const setValue = (key: string, value: string) => {
    const rest = defaults.filter((entry) => entry.key !== key);
    onChange(value.trim() ? [...rest, { key, value: value.trim() }] : rest);
  };

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-sm font-medium">{t("editor.varDefaults")}</span>
        <InfoTip text={t("editor.varDefaultsHint")} />
      </div>
      <div className="space-y-1">
        {rows.map((key) => (
          <div key={key} className="flex items-center gap-2">
            {/* A label wearing the app's token pill, not an input: the key is
                fixed by what you wrote in the body. The fixed width keeps the
                arrows in a column. */}
            <span className="w-44 shrink-0">
              <span
                className="inline-block max-w-full truncate rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                title={labels.get(key) ?? key}
              >
                [{key}]
              </span>
            </span>
            <span aria-hidden className="text-[var(--muted)]">
              →
            </span>
            <input
              // Uncontrolled with a blur save, like every other field in this
              // app: a controlled box fights the typist on each keystroke.
              key={`${key}:${valueOf(key)}`}
              defaultValue={valueOf(key)}
              placeholder={t("editor.varDefaultsPlaceholder")}
              aria-label={`${labels.get(key) ?? key} — ${t("editor.varDefaults")}`}
              onBlur={(e) => {
                if (e.target.value.trim() !== valueOf(key).trim()) {
                  setValue(key, e.target.value);
                }
              }}
              className="w-56 min-w-0 flex-1 text-xs"
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}
