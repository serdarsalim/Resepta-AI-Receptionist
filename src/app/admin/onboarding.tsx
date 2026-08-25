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
import { InfoTip } from "@/components/InfoTip";
import type { Search } from "@/lib/useTableState";
import {
  VOICE_AGENT_TEMPLATE_VERSION,
  VOICE_AGENT_MODEL,
} from "../../../convex/lib/voiceAgentTemplate";

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

// BLANK, the empty preset the "+ Add vertical" button opened, went with the
// button (Serdar, 2026-08-25). The Editor still handles isNew because the
// mutation behind it is unchanged and a future entry point can hand it a
// draft; nothing in the console does today.

export function OnboardingTab({ search }: { search: Search }) {
  const presets = useQuery(api.industryPresets.all, {});
  const prompts = useQuery(api.voicePrompts.all, {});
  const setActive = useMutation(api.industryPresets.setActive);
  const [open, setOpen] = useState<string | null>(null);
  const [openPrompt, setOpenPrompt] = useState<PromptCode | null>(null);

  const shown = useMemo(
    () =>
      (presets ?? []).filter((preset) =>
        search.matches(preset.key, preset.name.en, preset.name.tr, preset.name.de),
      ),
    [presets, search],
  );

  if (presets === undefined || prompts === undefined) {
    return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  }

  const editingPrompt = prompts.find((prompt) => prompt.language === openPrompt);
  if (editingPrompt) {
    return (
      <PromptEditor
        key={editingPrompt.language}
        prompt={editingPrompt}
        label={
          PROMPT_LANGUAGES.find((entry) => entry.code === editingPrompt.language)
            ?.label ?? editingPrompt.language
        }
        onClose={() => setOpenPrompt(null)}
      />
    );
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
        {/* No "+ Add vertical" (Serdar, 2026-08-25): verticals get added by
            editing convex/lib/industryPresets.ts with Claude, not by typing a
            blank one into a form, and the button offered the path that writes
            an override row the page then nags about reverting. */}
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
                  {/* No Key column (Serdar, 2026-08-25): the slug is an
                      internal identifier nobody reads down a list — it still
                      shows in the editor a row click opens, which is where
                      someone wiring an integration goes anyway. */}
                  <th className="px-3 pb-2 pt-3.5 font-semibold">Vertical</th>
                  {/* How many businesses picked it, in place of the services
                      and fields counts (Serdar, 2026-08-25). Those described
                      the preset's own contents — visible in the editor a row
                      click opens — and never answered the question this list
                      is for, which is whether a vertical earns its slot in
                      the wizard. */}
                  <th
                    className="px-3 pb-2 pt-3.5 font-semibold"
                    title="Businesses currently on this vertical"
                  >
                    Businesses
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
                    <td className="px-3 py-2 tabular-nums text-[var(--muted-strong)]">
                      {preset.orgs || <span className="text-[var(--muted)]">—</span>}
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

      {/* Under the verticals, because that is the order the reader needs them
          in: what a business picks, then what its agent is born saying. Not
          filtered by the header search — three rows are not a list to narrow,
          and hiding them behind a query for a vertical would be a surface the
          operator cannot find. */}
      <PromptSection prompts={prompts} onOpen={setOpenPrompt} />
    </div>
  );
}

// ---- The phone agent prompt ----
//
// Same override model as the verticals above, with one rule that has to stay
// visible in the UI because it is invisible in the data: THIS REACHES NEW
// AGENTS ONLY. An agent that exists owns its prompt — the owner edits it in
// their own editor, and retellAgent.syncTemplate deliberately sends tools and
// engine settings while never sending prompt text. An operator who edits here
// expecting the fleet to change would be wrong, so the page says so twice.
//
// Per LANGUAGE, not per vertical. A dentist and a barber get the same prompt
// on purpose: what makes an agent sound like its vertical is the services and
// contact fields injected at ring time, which is what the presets above seed.

const PROMPT_LANGUAGES = [
  { code: "tr-TR" as const, label: "Türkçe" },
  { code: "en-US" as const, label: "English" },
  { code: "de-DE" as const, label: "Deutsch" },
];

type PromptCode = (typeof PROMPT_LANGUAGES)[number]["code"];

type PromptText = {
  general: string;
  beginMessage: string;
  beginMessageNamed: string;
};

type AdminPrompt = PromptText & {
  language: PromptCode;
  edited: boolean;
  code: PromptText;
  updatedAt: number | null;
  updatedBy: string | null;
};

const PROMPT_ERRORS: Record<string, string> = {
  "prompt-empty": "The prompt cannot be empty.",
  "greeting-empty": "Both greetings are required.",
  "missing-name-token":
    "The named greeting must contain {name} — that is where the agent's name goes.",
  "stray-name-token":
    "The unnamed greeting must not contain {name}: there is no name to put in it.",
};

function promptError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const code = Object.keys(PROMPT_ERRORS).find((entry) => raw.includes(entry));
  return code ? PROMPT_ERRORS[code] : raw;
}

// The three constants as lib/voiceAgentTemplate.ts holds them, so a fix made
// here has somewhere to go. GENERAL_PROMPTS is an array of lines in the module
// and one string here, which is the same thing either side of a join.
function promptAsTypeScript(language: PromptCode, prompt: PromptText): string {
  const lines = prompt.general
    .split("\n")
    .map((line) => `    ${quote(line)},`)
    .join("\n");
  // {name} goes back to the interpolation the module's arrow function uses.
  // Backticks and ${ in the text itself would break out of the literal, so
  // both are escaped on the way.
  const named = prompt.beginMessageNamed
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${")
    .replace(/\{name\}/g, "${name}");
  return (
    `// GENERAL_PROMPTS\n` +
    `  ${quote(language)}: [\n${lines}\n  ],\n\n` +
    `// BEGIN_MESSAGES\n` +
    `  ${quote(language)}: ${quote(prompt.beginMessage)},\n\n` +
    `// BEGIN_MESSAGES_NAMED\n` +
    `  ${quote(language)}: (name) => \`${named}\`,\n`
  );
}

function PromptEditor({
  prompt,
  label,
  onClose,
}: {
  prompt: AdminPrompt;
  label: string;
  onClose: () => void;
}) {
  const save = useMutation(api.voicePrompts.save);
  const reset = useMutation(api.voicePrompts.reset);
  const [confirm, confirmDialog] = useConfirm();
  const [draft, setDraft] = useState<PromptText>({
    general: prompt.general,
    beginMessage: prompt.beginMessage,
    beginMessageNamed: prompt.beginMessageNamed,
  });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const patch = (next: Partial<PromptText>) => {
    setDraft((prev) => ({ ...prev, ...next }));
    setError(null);
  };

  const commit = async () => {
    setSaving(true);
    try {
      await save({ language: prompt.language, ...draft });
      onClose();
    } catch (caught) {
      setError(promptError(caught));
    } finally {
      setSaving(false);
    }
  };

  const revert = async () => {
    const ok = await confirm({
      title: `Revert the ${label} prompt to code?`,
      body: "New agents go back to what convex/lib/voiceAgentTemplate.ts says. Agents provisioned while the override stood keep the prompt they were born with — an agent owns its prompt from the moment it exists.",
      confirmLabel: "Revert to code",
    });
    if (!ok) return;
    await reset({ language: prompt.language });
    onClose();
  };

  const copy = async () => {
    await navigator.clipboard.writeText(promptAsTypeScript(prompt.language, draft));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="space-y-4">
      {confirmDialog}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Ghost onClick={onClose}>← Back</Ghost>
          <span className="text-sm font-medium">{label}</span>
          <span className="font-mono text-xs text-[var(--muted)]">{prompt.language}</span>
          {prompt.edited && <Chip tone="edited">Edited</Chip>}
        </div>
        <div className="flex items-center gap-1">
          <Ghost onClick={() => void copy()}>
            {copied ? "Copied" : "Copy as TypeScript"}
          </Ghost>
          {prompt.edited && (
            <Ghost onClick={() => void revert()} tone="danger">
              Revert to code
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

      {/* Stated where the edit happens, not only on the list behind it. */}
      <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
        This changes what the NEXT agent is born saying. Agents that already
        exist keep their own prompt — their owners edit it in the app, and the
        template sync never touches prompt text. Nothing you do here reaches a
        phone that is already answering.
      </p>

      <section className="rounded-lg bg-[var(--card)] p-3 shadow-[var(--card-shadow)] sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Greeting</h2>
          <span className="text-xs text-[var(--muted)]">
            {"{{business_name}}"} is filled in while the phone rings.
          </span>
        </div>
        <div className="mt-3 space-y-2">
          <label className="block">
            <div className="text-xs font-medium text-[var(--muted-strong)]">
              With no persona name
            </div>
            <div className="mt-1">
              <Input
                value={draft.beginMessage}
                onChange={(beginMessage) => patch({ beginMessage })}
              />
            </div>
          </label>
          <label className="block">
            <div className="text-xs font-medium text-[var(--muted-strong)]">
              With a persona name — {"{name}"} is substituted when the agent is created
            </div>
            <div className="mt-1">
              <Input
                value={draft.beginMessageNamed}
                onChange={(beginMessageNamed) => patch({ beginMessageNamed })}
              />
            </div>
          </label>
        </div>
      </section>

      <section className="rounded-lg bg-[var(--card)] p-3 shadow-[var(--card-shadow)] sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Prompt</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted)]">
              {draft.general.split("\n").length} lines
            </span>
            {prompt.edited && (
              <Ghost onClick={() => setShowCode((prev) => !prev)}>
                {showCode ? "Hide the code version" : "Show the code version"}
              </Ghost>
            )}
          </div>
        </div>
        {/* Monospace and a big box: this is a document, and the line breaks
            are load-bearing — the module joins its array with newlines and the
            model reads the result as sections. */}
        <textarea
          value={draft.general}
          onChange={(e) => patch({ general: e.target.value })}
          spellCheck={false}
          className="mt-3 h-[28rem] w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 font-mono text-xs leading-relaxed"
        />
        {showCode && (
          <div className="mt-3">
            <div className="text-xs font-medium text-[var(--muted-strong)]">
              convex/lib/voiceAgentTemplate.ts
            </div>
            <textarea
              value={prompt.code.general}
              readOnly
              spellCheck={false}
              className="mt-1 h-64 w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 font-mono text-xs leading-relaxed text-[var(--muted)]"
            />
          </div>
        )}
      </section>
    </div>
  );
}

function PromptSection({
  prompts,
  onOpen,
}: {
  prompts: AdminPrompt[];
  onOpen: (language: PromptCode) => void;
}) {
  const drifted = prompts.filter((prompt) => prompt.edited).length;

  return (
    <section className="rounded-lg bg-[var(--card)] p-3 shadow-[var(--card-shadow)] sm:p-4">
      {/* The explanation rides the (i), like every other card on this page
          (Serdar, 2026-08-25). Spelled out beside the title it was the widest
          thing in the header and read as a caption on the card. */}
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">What a new phone agent is born saying</h2>
        <InfoTip text="Per language, not per vertical — the services and contact fields above are what make an agent sound like its trade." />
      </div>
      <div className="mt-3 divide-y divide-[var(--table-divider)]">
        {PROMPT_LANGUAGES.map(({ code, label }) => {
          const prompt = prompts.find((entry) => entry.language === code);
          if (!prompt) return null;
          return (
            <button
              key={code}
              type="button"
              onClick={() => onOpen(code)}
              className="flex w-full items-center gap-3 py-2 text-left transition-colors hover:bg-[var(--row-hover-bg)]"
            >
              <span className="w-20 shrink-0 text-sm font-medium">{label}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">
                {prompt.beginMessage}
              </span>
              <span className="shrink-0 tabular-nums text-xs text-[var(--muted)]">
                {prompt.general.split("\n").length} lines
              </span>
              <span className="w-40 shrink-0 text-right">
                {prompt.edited ? (
                  <>
                    <Chip tone="edited">Edited</Chip>
                    <span className="ml-1 text-xs text-[var(--muted)]">
                      {ago(prompt.updatedAt ?? undefined)}
                    </span>
                  </>
                ) : (
                  <Chip tone="code">In code</Chip>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        {drifted > 0
          ? "An edited prompt reaches agents created from now on. Agents that already exist keep theirs — their owners edit it in the app, and the template sync never sends prompt text."
          : "Editing one changes what the next agent is born saying. It never changes an agent that already exists."}
      </p>

      {/* What every agent is born WITH, under what it is born SAYING (Serdar,
          2026-08-25). The greeting rows above are the per-language half; this
          is the half that is the same for a dentist in Berlin and a barber in
          Ordu, and until now it lived only in the template module's comments
          — so "can our agents hang up?" was a question you answered by
          reading TypeScript.

          Read from convex/lib/voiceAgentTemplate.ts rather than retyped: the
          module is pure (no Convex imports), so the constants are the same
          objects provisioning sends to the provider, and a knob that changes
          there changes here. Not editable, deliberately — these ride the
          template version, and a console that let one be flipped per
          deployment would fork the fleet from the code that documents it. */}
      <div className="mt-4 border-t border-[var(--table-divider)] pt-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">
            What every agent is born with
          </h3>
          <InfoTip text="The same for every vertical and every language, set by the template in convex/lib/voiceAgentTemplate.ts. Changing one is a code change and a template version bump, not a switch here — existing agents pick it up when their owner clicks update." />
          <span className="ml-auto text-xs text-[var(--muted)]">
            template v{VOICE_AGENT_TEMPLATE_VERSION}
          </span>
        </div>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {[
            [
              "Hanging up",
              "Yes, by default — the end_call tool. Never in the same turn as its own goodbye, and never in reply to a greeting. A business can switch it off in its own agent editor.",
            ],
            [
              "Voicemail",
              "Detected on an outbound call, and hung up on. It leaves no message — the words are a decision per business, so that wants a control on the agent's own page.",
            ],
            [
              "Call length",
              "Bounded only by the provider's max call duration. There is no per-call limit of our own.",
            ],
            [
              "Interruptions",
              "Answers the moment you stop (responsiveness 0.99, dynamic responsiveness off) and only stops mid-word for a real interruption (sensitivity 0.4). Backchannels while you talk.",
            ],
            [
              "What it can do",
              "Check availability, book, find, cancel and reschedule, and save what the caller tells it about themselves.",
            ],
            ["Engine", `${VOICE_AGENT_MODEL}, priority inference, temperature 0.1.`],
          ].map(([term, detail]) => (
            <div key={term}>
              <dt className="text-xs font-medium">{term}</dt>
              <dd className="text-xs text-[var(--muted)]">{detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
