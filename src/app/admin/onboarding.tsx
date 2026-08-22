"use client";

// The onboarding verticals, in the operator console.
//
// ── WHAT THIS IS AND IS NOT ─────────────────────────────────────────────────
//
// It is NOT the catalogue moving into the database. The catalogue lives in
// convex/lib/industryPresets.ts and keeps living there (Serdar, 2026-08-22):
// prose curated in three languages wants review, diffs and a revert, and a
// settings page has none of those. What this page is for is the other half —
// seeing what we actually support without opening a file, fixing a wrong
// duration or a bad Turkish word in the ten seconds it deserves, and parking a
// vertical we are not ready to offer yet.
//
// So an edit here writes an OVERRIDE row and the page says so, in the list and
// again in the editor. "Revert to code" is one click, and "Copy as TypeScript"
// emits the literal to paste back into the module — which is the intended end
// of an edit's life, not an afterthought. An override that nobody ports is a
// vertical the next catalogue commit silently stops improving, and the Edited
// chip is the reminder.
//
// English-only, like the rest of /admin: one reader, and translating an
// operator surface means maintaining a second copy of every term for nobody.
// The CONTENT is trilingual because the businesses reading it are.

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useConfirm } from "@/components/ConfirmDialog";
import { ago } from "./parts";
import type { Search } from "@/lib/useTableState";

const LANGS = ["tr", "en", "de"] as const;
type Lang = (typeof LANGS)[number];
const LANG_LABEL: Record<Lang, string> = {
  tr: "Türkçe",
  en: "English",
  de: "Deutsch",
};

const FIELD_TYPES = ["text", "select", "number", "date"] as const;
type FieldType = (typeof FIELD_TYPES)[number];

type Localised = { tr: string; en: string; de: string };
type LocalisedList = { tr: string[]; en: string[]; de: string[] };
type DraftService = { name: Localised; durationMinutes: number };
// Options are held as one comma-separated string per language, not as arrays.
// Editing an array through a joined input eats the comma the moment it is
// typed; splitting once at save is the version that lets somebody type.
type DraftField = {
  key: string;
  label: Localised;
  type: FieldType;
  options: Localised;
};
type Draft = {
  key: string;
  name: Localised;
  services: DraftService[];
  fields: DraftField[];
  active: boolean;
};

const EMPTY: Localised = { tr: "", en: "", de: "" };

const splitOptions = (raw: string) =>
  raw
    .split(",")
    .map((option) => option.trim())
    .filter(Boolean);

const fieldOptions = (field: DraftField): LocalisedList | undefined =>
  field.type === "select"
    ? {
        tr: splitOptions(field.options.tr),
        en: splitOptions(field.options.en),
        de: splitOptions(field.options.de),
      }
    : undefined;

// The server refuses rather than silently repairing (convex/industryPresets
// validate), so every code it can throw needs a sentence here. An unmapped
// code would surface as a raw error string, which is why the fallback prints
// it rather than swallowing it.
const SAVE_ERRORS: Record<string, string> = {
  "bad-key": "The key must be lowercase letters, digits and underscores, starting with a letter.",
  "name-incomplete": "The vertical needs a name in all three languages.",
  "service-name-incomplete": "Every service needs a name in all three languages.",
  "service-name-unkeyable": "A service name has no letters or digits to key on.",
  "service-duplicate": "Two services share a name.",
  "bad-duration": "A duration must be a whole number of minutes between 5 and 1440.",
  "bad-field-key": "A field key must be lowercase letters, digits and underscores, starting with a letter.",
  "reserved-field-key": "That field key already belongs to the customer record.",
  "field-duplicate": "Two fields share a key.",
  "field-label-incomplete": "Every field needs a label in all three languages.",
  "select-needs-options": "A choice field needs options in all three languages.",
};

function saveError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const code = Object.keys(SAVE_ERRORS).find((entry) => raw.includes(entry));
  return code ? SAVE_ERRORS[code] : raw;
}

// ---- The TypeScript emitter ----

const quote = (value: string) => JSON.stringify(value);
const localiseLiteral = (value: Localised) =>
  `{ tr: ${quote(value.tr)}, en: ${quote(value.en)}, de: ${quote(value.de)} }`;

// The literal as convex/lib/industryPresets.ts would have written it, indented
// to sit inside INDUSTRY_PRESETS. Deliberately verbatim to that file's shape,
// including `source: "voice"` — which is not stored (every preset field is
// voice-sourced) and has to be put back on the way out.
function asTypeScript(draft: Draft): string {
  const services = draft.services
    .map(
      (service) =>
        `      { name: ${localiseLiteral(service.name)}, durationMinutes: ${service.durationMinutes} },`,
    )
    .join("\n");
  const fields = draft.fields
    .map((field) => {
      const list = fieldOptions(field);
      const options = list
        ? `        options: {\n${LANGS.map(
            (lang) => `          ${lang}: [${list[lang].map(quote).join(", ")}],`,
          ).join("\n")}\n        },\n`
        : "";
      return (
        `      {\n` +
        `        key: ${quote(field.key)},\n` +
        `        label: ${localiseLiteral(field.label)},\n` +
        `        type: ${quote(field.type)},\n` +
        options +
        `        source: "voice",\n` +
        `      },`
      );
    })
    .join("\n");
  return (
    `  ${draft.key}: {\n` +
    `    name: ${localiseLiteral(draft.name)},\n` +
    `    services: [\n${services}${services ? "\n" : ""}    ],\n` +
    `    fields: [\n${fields}${fields ? "\n" : ""}    ],\n` +
    `  },\n`
  );
}

// ---- Small shared pieces ----

function Chip({ tone, children }: { tone: "code" | "edited" | "custom" | "off"; children: React.ReactNode }) {
  const tones = {
    code: "text-[var(--muted)]",
    // Amber, the console's existing "this needs you eventually" colour — a
    // tint plus an inset ring, never a fill with a border over it.
    edited: "bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400",
    custom: "bg-violet-500/10 text-violet-700 ring-1 ring-inset ring-violet-500/25 dark:text-violet-400",
    off: "bg-[var(--muted-bg)] text-[var(--muted-strong)]",
  };
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  mono,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  readOnly?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      className={`w-full min-w-0 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-sm ${
        mono ? "font-mono text-xs" : ""
      } ${readOnly ? "text-[var(--muted)]" : ""}`}
    />
  );
}

function Ghost({
  onClick,
  children,
  tone,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: "danger";
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-lg px-2 py-1 text-xs transition-colors hover:bg-[var(--muted-bg)] ${
        tone === "danger"
          ? "text-red-600 hover:bg-red-500/10 dark:text-red-400"
          : "text-[var(--muted-strong)] hover:text-[var(--foreground)]"
      }`}
    >
      {children}
    </button>
  );
}

// ---- The editor ----

// What the server hands back for one vertical, plus where it came from.
type AdminPreset = {
  key: string;
  name: Localised;
  services: { name: Localised; durationMinutes: number }[];
  fields: {
    key: string;
    label: Localised;
    type: FieldType;
    options?: LocalisedList;
  }[];
  active: boolean;
  inCode: boolean;
  edited: boolean;
  updatedAt: number | null;
  updatedBy: string | null;
};

function toDraft(preset: AdminPreset): Draft {
  return {
    key: preset.key,
    name: { ...preset.name },
    services: preset.services.map((service) => ({
      name: { ...service.name },
      durationMinutes: service.durationMinutes,
    })),
    fields: preset.fields.map((field) => ({
      key: field.key,
      label: { ...field.label },
      type: field.type,
      options: field.options
        ? {
            tr: field.options.tr.join(", "),
            en: field.options.en.join(", "),
            de: field.options.de.join(", "),
          }
        : { ...EMPTY },
    })),
    active: preset.active,
  };
}

// Three inputs, one per language, side by side — not a language switcher above
// one input. The switcher is fewer pixels and it is how a vertical ends up
// live in Turkish and blank in German: the missing translation is off-screen
// at the moment you would have noticed it.
function TriInput({
  value,
  onChange,
}: {
  value: Localised;
  onChange: (value: Localised) => void;
}) {
  return (
    <>
      {LANGS.map((lang) => (
        <Input
          key={lang}
          value={value[lang]}
          onChange={(next) => onChange({ ...value, [lang]: next })}
        />
      ))}
    </>
  );
}

function LangHeadings({ before, after }: { before?: string[]; after?: string[] }) {
  return (
    <>
      {(before ?? []).map((label) => (
        <div key={label} className="text-xs font-medium text-[var(--muted-strong)]">
          {label}
        </div>
      ))}
      {LANGS.map((lang) => (
        <div key={lang} className="text-xs font-medium text-[var(--muted-strong)]">
          {LANG_LABEL[lang]}
        </div>
      ))}
      {(after ?? []).map((label) => (
        <div key={label} className="text-xs font-medium text-[var(--muted-strong)]">
          {label}
        </div>
      ))}
    </>
  );
}

function Editor({
  preset,
  isNew,
  onClose,
}: {
  preset: AdminPreset;
  isNew: boolean;
  onClose: () => void;
}) {
  const save = useMutation(api.industryPresets.save);
  const reset = useMutation(api.industryPresets.reset);
  const [confirm, confirmDialog] = useConfirm();
  const [draft, setDraft] = useState<Draft>(() => toDraft(preset));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const patch = (next: Partial<Draft>) => {
    setDraft((prev) => ({ ...prev, ...next }));
    setError(null);
  };

  const commit = async () => {
    setSaving(true);
    try {
      await save({
        key: draft.key.trim(),
        name: draft.name,
        services: draft.services,
        fields: draft.fields.map((field) => ({
          key: field.key.trim(),
          label: field.label,
          type: field.type,
          options: fieldOptions(field),
        })),
        active: draft.active,
      });
      onClose();
    } catch (caught) {
      setError(saveError(caught));
    } finally {
      setSaving(false);
    }
  };

  // One mutation, two honest labels. Dropping the row restores the code module
  // for a vertical that has one and removes the vertical outright for one that
  // does not, and the button has to say which of those it is about to do.
  const discard = async () => {
    const ok = await confirm({
      title: preset.inCode
        ? `Revert ${preset.name.en} to code?`
        : `Delete ${preset.name.en}?`,
      body: preset.inCode
        ? "The vertical goes back to what convex/lib/industryPresets.ts says. Businesses already onboarded keep everything they were seeded — a preset is copied at onboarding, never linked."
        : "This vertical only exists in the database, so it goes for good. Businesses already on it keep everything they were seeded, and their reset-to-defaults will stop working until somebody adds the vertical back.",
      confirmLabel: preset.inCode ? "Revert to code" : "Delete",
    });
    if (!ok) return;
    await reset({ key: preset.key });
    onClose();
  };

  const copy = async () => {
    await navigator.clipboard.writeText(asTypeScript(draft));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="space-y-4">
      {confirmDialog}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Ghost onClick={onClose}>← All verticals</Ghost>
          <span className="font-mono text-xs text-[var(--muted)]">{preset.key}</span>
          {!isNew && preset.edited && <Chip tone="edited">Edited</Chip>}
          {!isNew && !preset.inCode && <Chip tone="custom">Custom</Chip>}
        </div>
        <div className="flex items-center gap-1">
          <Ghost onClick={() => void copy()}>
            {copied ? "Copied" : "Copy as TypeScript"}
          </Ghost>
          {!isNew && (
            <Ghost onClick={() => void discard()} tone="danger">
              {preset.inCode ? "Revert to code" : "Delete vertical"}
            </Ghost>
          )}
          <button
            type="button"
            onClick={() => void commit()}
            disabled={saving}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Said in the editor as well as the list, because this is where somebody
          is about to create the drift and the list is behind them. */}
      {preset.inCode && (
        <p className="text-xs text-[var(--muted)]">
          Saving writes an override row. This vertical stops taking catalogue
          improvements from convex/lib/industryPresets.ts until it is reverted —
          copy the TypeScript into that file and revert to close the loop.
        </p>
      )}

      <section className="rounded-lg bg-[var(--card)] p-3 shadow-[var(--card-shadow)] sm:p-4">
        <h2 className="text-sm font-semibold">Vertical</h2>
        <div className="mt-3 grid grid-cols-[minmax(0,10rem)_repeat(3,minmax(0,1fr))] items-center gap-x-3 gap-y-2">
          <LangHeadings before={["Key"]} />
          <Input
            value={draft.key}
            onChange={(key) => patch({ key })}
            placeholder="pet_clinic"
            mono
            // The key is the address orgs.industry stores and the code module
            // binds to. Renaming one would orphan every business already on it,
            // so it is typed once, at creation, and fixed after.
            {...(isNew ? {} : { readOnly: true })}
          />
          <TriInput value={draft.name} onChange={(name) => patch({ name })} />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => patch({ active: e.target.checked })}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span>Offered in the onboarding wizard</span>
          <span className="text-xs text-[var(--muted)]">
            Off keeps it working for the businesses already on it.
          </span>
        </label>
      </section>

      <section className="rounded-lg bg-[var(--card)] p-3 shadow-[var(--card-shadow)] sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Services</h2>
          <span className="text-xs text-[var(--muted)]">
            No prices, deliberately — a guessed price is a claim about the business.
          </span>
        </div>
        {draft.services.length > 0 && (
          <div className="mt-3 grid grid-cols-[repeat(3,minmax(0,1fr))_5rem_1.75rem] items-center gap-x-3 gap-y-2">
            <LangHeadings after={["Minutes", ""]} />
            {draft.services.map((service, index) => (
              <ServiceRow
                key={index}
                service={service}
                onChange={(next) =>
                  patch({
                    services: draft.services.map((entry, i) =>
                      i === index ? next : entry,
                    ),
                  })
                }
                onRemove={() =>
                  patch({ services: draft.services.filter((_, i) => i !== index) })
                }
              />
            ))}
          </div>
        )}
        <div className="mt-3">
          <Ghost
            onClick={() =>
              patch({
                services: [
                  ...draft.services,
                  { name: { ...EMPTY }, durationMinutes: 30 },
                ],
              })
            }
          >
            + Add service
          </Ghost>
        </div>
      </section>

      <section className="rounded-lg bg-[var(--card)] p-3 shadow-[var(--card-shadow)] sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Contact fields</h2>
          <span className="text-xs text-[var(--muted)]">
            Every one is collected by the phone agent. This is what makes the
            agent sound like this vertical.
          </span>
        </div>
        {draft.fields.length > 0 && (
          <div className="mt-3 space-y-3">
            {draft.fields.map((field, index) => (
              <FieldRow
                key={index}
                field={field}
                onChange={(next) =>
                  patch({
                    fields: draft.fields.map((entry, i) =>
                      i === index ? next : entry,
                    ),
                  })
                }
                onRemove={() =>
                  patch({ fields: draft.fields.filter((_, i) => i !== index) })
                }
              />
            ))}
          </div>
        )}
        <div className="mt-3">
          <Ghost
            onClick={() =>
              patch({
                fields: [
                  ...draft.fields,
                  { key: "", label: { ...EMPTY }, type: "text", options: { ...EMPTY } },
                ],
              })
            }
          >
            + Add field
          </Ghost>
        </div>
      </section>
    </div>
  );
}

function ServiceRow({
  service,
  onChange,
  onRemove,
}: {
  service: DraftService;
  onChange: (service: DraftService) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <TriInput
        value={service.name}
        onChange={(name) => onChange({ ...service, name })}
      />
      <input
        type="number"
        min={5}
        max={1440}
        value={service.durationMinutes}
        onChange={(e) =>
          onChange({ ...service, durationMinutes: Number(e.target.value) })
        }
        className="w-full min-w-0 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-sm tabular-nums"
      />
      <Ghost onClick={onRemove} tone="danger" title="Remove service">
        ✕
      </Ghost>
    </>
  );
}

function FieldRow({
  field,
  onChange,
  onRemove,
}: {
  field: DraftField;
  onChange: (field: DraftField) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg bg-[var(--muted-bg)]/50 p-2.5">
      <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,7rem)_repeat(3,minmax(0,1fr))_1.75rem] items-center gap-x-3 gap-y-2">
        <LangHeadings before={["Key", "Type"]} after={[""]} />
        <Input
          value={field.key}
          onChange={(key) => onChange({ ...field, key })}
          placeholder="plate_number"
          mono
        />
        <select
          value={field.type}
          onChange={(e) => onChange({ ...field, type: e.target.value as FieldType })}
          className="w-full min-w-0 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
        >
          {FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <TriInput value={field.label} onChange={(label) => onChange({ ...field, label })} />
        <Ghost onClick={onRemove} tone="danger" title="Remove field">
          ✕
        </Ghost>
      </div>
      {/* Only a choice field has options, and only then does the row earn a
          second line. Rendering it always turned every text field into a
          two-line block with an empty half. */}
      {field.type === "select" && (
        <div className="mt-2 grid grid-cols-[minmax(0,16rem)_repeat(3,minmax(0,1fr))_1.75rem] items-center gap-x-3">
          <div className="text-xs text-[var(--muted)]">Options, comma separated</div>
          <TriInput
            value={field.options}
            onChange={(options) => onChange({ ...field, options })}
          />
          <div />
        </div>
      )}
    </div>
  );
}

// ---- The list ----

const BLANK: AdminPreset = {
  key: "",
  name: { ...EMPTY },
  services: [],
  fields: [],
  // A vertical drafted for later starts OFF. The reason to add one before it
  // is ready is that it is not ready, and a half-filled vertical in the live
  // wizard would seed a business three blank services.
  active: false,
  inCode: false,
  edited: false,
  updatedAt: null,
  updatedBy: null,
};

export function OnboardingTab({ search }: { search: Search }) {
  const presets = useQuery(api.industryPresets.all, {});
  const setActive = useMutation(api.industryPresets.setActive);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const shown = useMemo(
    () =>
      (presets ?? []).filter((preset) =>
        search.matches(preset.key, preset.name.en, preset.name.tr, preset.name.de),
      ),
    [presets, search],
  );

  if (presets === undefined) {
    return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  }

  if (adding) {
    return <Editor preset={BLANK} isNew onClose={() => setAdding(false)} />;
  }

  const editing = presets.find((preset) => preset.key === open);
  if (editing) {
    // Keyed on the vertical so switching rows rebuilds the draft rather than
    // carrying the previous vertical's services into it.
    return (
      <Editor
        key={editing.key}
        preset={editing}
        isNew={false}
        onClose={() => setOpen(null)}
      />
    );
  }

  const drifted = presets.filter((preset) => preset.edited).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">
          What a business can pick during onboarding, and the services and
          contact fields each one seeds. The catalogue lives in{" "}
          <code className="font-mono">convex/lib/industryPresets.ts</code> —
          editing here lays a row over it for this deployment.
        </p>
        <Ghost onClick={() => setAdding(true)}>+ Add vertical</Ghost>
      </div>

      {drifted > 0 && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
          {drifted === 1 ? "One vertical is" : `${drifted} verticals are`} edited
          away from the code module, so catalogue improvements no longer reach{" "}
          {drifted === 1 ? "it" : "them"}. Copy the TypeScript into
          convex/lib/industryPresets.ts and revert to close the loop.
        </p>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No vertical matches that.</p>
      ) : (
        <div className="overflow-hidden rounded-lg bg-[var(--card)] shadow-[var(--card-shadow)]">
          <div className="thin-scroll overflow-x-auto overscroll-x-contain">
            <table className="w-full text-sm">
              <thead className="text-left text-xs">
                <tr>
                  <th className="px-3 pb-2 pt-3.5 font-semibold">Vertical</th>
                  <th className="px-3 pb-2 pt-3.5 font-semibold">Key</th>
                  <th
                    className="px-3 pb-2 pt-3.5 font-semibold"
                    title="Seeded into the price list at onboarding"
                  >
                    Services
                  </th>
                  <th
                    className="px-3 pb-2 pt-3.5 font-semibold"
                    title="Seeded onto the customer record, and collected by the phone agent"
                  >
                    Fields
                  </th>
                  <th className="px-3 pb-2 pt-3.5 font-semibold">Source</th>
                  <th className="px-3 pb-2 pt-3.5 font-semibold">Offered</th>
                  <th className="px-3 pb-2 pt-3.5 font-semibold">Edited</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((preset) => (
                  <tr
                    key={preset.key}
                    onClick={() => setOpen(preset.key)}
                    className="cursor-pointer border-t border-[var(--table-divider)] hover:bg-[var(--row-hover-bg)]"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{preset.name.en}</div>
                      {/* The other two languages under the English name: this
                          page's job is answering "what do we support", and a
                          vertical we support in one language is a fact the row
                          has to be able to state. */}
                      <div className="text-xs text-[var(--muted)]">
                        {preset.name.tr || "—"} · {preset.name.de || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--muted-strong)]">
                      {preset.key}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-[var(--muted-strong)]">
                      {preset.services.length || <span className="text-[var(--muted)]">—</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-[var(--muted-strong)]">
                      {preset.fields.length || <span className="text-[var(--muted)]">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {preset.inCode ? (
                        <Chip tone="code">In code</Chip>
                      ) : (
                        <Chip tone="custom">Database only</Chip>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {/* The toggle is on the row because turning a vertical off
                          is the one thing here that needs no editor, and making
                          it a trip through Save would mean four clicks to hide
                          a vertical for a week. */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void setActive({ key: preset.key, active: !preset.active });
                        }}
                        className="rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-[var(--muted-bg)]"
                      >
                        {preset.active ? (
                          <span className="text-[var(--muted-strong)]">Yes</span>
                        ) : (
                          <Chip tone="off">Off</Chip>
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      {preset.edited ? (
                        <>
                          <Chip tone="edited">Edited</Chip>
                          <div className="mt-0.5 text-xs text-[var(--muted)]">
                            {ago(preset.updatedAt ?? undefined)}
                            {preset.updatedBy ? ` · ${preset.updatedBy}` : ""}
                          </div>
                        </>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
