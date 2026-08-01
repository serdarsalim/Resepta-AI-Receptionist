"use client";

import { useAction, useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { InfoTip } from "./InfoTip";
import { Sheet } from "./Sheet";

export type VoiceVariable = {
  key: string;
  label: string;
  description: string;
  type: "string" | "number" | "boolean" | "enum";
  choices?: string[];
  required: boolean;
  beforeSource:
    | "none"
    | "static"
    | "business_name"
    | "customer_name"
    | "customer_phone"
    | "customer_language"
    | "next_appointment"
    | "contact_field";
  beforeValue?: string;
  beforeFieldId?: string;
  duringMode: "none" | "if_missing" | "confirm";
  afterCall: boolean;
  destination: "call" | "contact";
  contactFieldId?: string;
};

// What the page header needs to render Save/Discard on this editor's behalf.
export type VoiceEditorSaveState = {
  dirty: boolean;
  busy: boolean;
  // The rows as they stand, so the page can persist the draft. The editor
  // still owns the editing; it just stops being the only place the work
  // exists.
  rows: VoiceVariable[];
  save: () => void;
  discard: () => void;
};

// Where in the call a variable is captured. A row is grouped by its most
// active phase; the popover's picker is what moves it.
type Phase = "before" | "during" | "after";

export type VoiceContactField = {
  id: string;
  key: string;
  label: string;
  type: "text" | "select" | "number" | "date";
  options: string[];
  voice: boolean;
};

// The context the runtime injects on every call without any configuration.
// One list, exported so the @ picker in the instructions and the Variables
// table show the SAME variables — two surfaces disagreeing about what a
// variable is was the confusion this replaces.
export function builtinVoiceVariables(
  t: (
    key:
      | "voiceVariables.customerName"
      | "voiceVariables.customerPhone"
      | "voiceVariables.customerLanguage"
      | "voiceVariables.nextAppointment"
      | "voiceVariables.businessName"
      | "voiceVariables.servicesList",
  ) => string,
): { key: string; label: string }[] {
  return [
    { key: "customer_name", label: t("voiceVariables.customerName") },
    { key: "customer_phone", label: t("voiceVariables.customerPhone") },
    { key: "customer_language", label: t("voiceVariables.customerLanguage") },
    { key: "next_appointment", label: t("voiceVariables.nextAppointment") },
    { key: "business_name", label: t("voiceVariables.businessName") },
    { key: "services", label: t("voiceVariables.servicesList") },
  ];
}

// Turkish letters fold BEFORE lowercasing: "İ".toLowerCase() is "i" plus a
// combining dot (U+0307) that the class above can't match, which is how
// "İstenen hizmet" once became i_stenen_hizmet. The NFD strip catches any
// other combining mark the same way.
function keyFromLabel(label: string): string {
  return label
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function blankVariable(): VoiceVariable {
  return {
    key: "",
    label: "",
    description: "",
    type: "string",
    required: false,
    beforeSource: "none",
    duringMode: "if_missing",
    afterCall: true,
    destination: "call",
  };
}

export function VoiceVariablesEditor({
  agentId,
  version,
  engineType,
  managed,
  initial,
  seed,
  contactFields,
  onPublished,
  onSaveStateChange,
}: {
  agentId: string;
  version: number | null;
  engineType: string | null;
  managed: boolean;
  initial: VoiceVariable[];
  // Rows recovered from a stored draft. Seeds the editor instead of `initial`
  // while keeping `initial` as the server truth that dirty is measured
  // against, so a restored draft still reports itself as unsaved.
  seed?: VoiceVariable[] | null;
  contactFields: VoiceContactField[];
  onPublished: () => void;
  // Lets the page header own Save and Discard for the whole agent. The editor
  // still holds the draft — it just stops being the only place the save button
  // exists, because on a tall page that button is below the fold and unsaved
  // work is how it gets abandoned.
  onSaveStateChange?: (state: VoiceEditorSaveState) => void;
}) {
  const { t } = useLanguage();
  const publishVariables = useAction(api.retellAgent.publishVariables);
  const createContactField = useMutation(api.contactFields.create);
  const [draft, setDraft] = useState(seed ?? initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [previous, setPrevious] = useState<VoiceVariable[] | null>(null);
  // Deleting a row that has work in it asks first; see removeAt.
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  // Set when "+ Add variable" appends a row, so the caret lands in the new
  // row's name field instead of leaving an empty row for someone to find.
  const [focusLast, setFocusLast] = useState(false);
  // Customer fields created from a row's Saved-to picker, so their labels
  // resolve before the parent reloads. Reloading here would reset the
  // unpublished draft.
  const [createdFields, setCreatedFields] = useState<VoiceContactField[]>([]);

  useEffect(() => setDraft(seed ?? initial), [initial, seed]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);
  const allFields = useMemo(
    () => [...contactFields, ...createdFields],
    [contactFields, createdFields],
  );
  const voiceFields = allFields.filter((field) => field.voice);
  const fieldById = new Map(allFields.map((field) => [field.id, field]));
  const supportsLive = engineType === "retell-llm";

  // A key that is already live in Retell must not follow a label edit —
  // renaming it orphans every answer already collected under the old name.
  const publishedKeys = useMemo(
    () => new Set(initial.map((row) => row.key)),
    [initial],
  );


  // "Also save this onto the customer card" — the one thing quick-add could do
  // that a row could not, brought onto the row itself. Only offered when the
  // key still follows the label: publishVariables requires the customer
  // field's key to equal the variable's, and a hand-adopted key (customer_name
  // on a row labelled "Müşteri adı") would create a field that can never link.
  const linkToCustomer = async (index: number) => {
    const row = draft[index];
    const label = row.label.trim();
    if (!label || !row.key) return;
    const existing = voiceFields.find((field) => field.key === row.key);
    if (existing) {
      patch(index, { destination: "contact", contactFieldId: existing.id });
      return;
    }
    try {
      const id = (await createContactField({
        label,
        type: "text",
        source: "voice",
      })) as string;
      setCreatedFields((rows) => [
        ...rows,
        { id, key: row.key, label, type: "text", options: [], voice: true },
      ]);
      patch(index, { destination: "contact", contactFieldId: id });
    } catch {
      setStatus(t("voiceVariables.fieldExists"));
    }
  };

  // A voice-enabled customer field becomes a capture row in one click,
  // pre-linked to its field AND pre-wired for the repeat caller: the stored
  // value is injected before the call and the agent only asks when it is
  // missing. Without the prefill, every adopted field re-interrogated people
  // the business already knew.
  const adoptField = (field: VoiceContactField, phase: Phase = "during") => {
    const base: VoiceVariable = {
      ...blankVariable(),
      key: field.key,
      label: field.label,
      type: field.type === "select" ? "enum" : field.type === "number" ? "number" : "string",
      choices: field.type === "select" ? field.options : undefined,
      destination: "contact",
      contactFieldId: field.id,
    };
    const row: VoiceVariable =
      phase === "before"
        ? // Context only: read the stored value into the call, capture nothing.
          {
            ...base,
            duringMode: "none",
            afterCall: false,
            beforeSource: "contact_field",
            beforeFieldId: field.id,
            destination: "call",
            contactFieldId: undefined,
          }
        : phase === "after"
          ? { ...base, duringMode: "none", afterCall: true }
          : {
              ...base,
              beforeSource: "contact_field",
              beforeFieldId: field.id,
            };
    setDraft((rows) => [...rows, row]);
    setFocusLast(true);
  };

  // The picker's "create" action: the field lands in Business → Services &
  // fields at the same moment it becomes a row here, so the two registries
  // cannot drift apart. If the label folds to a key an unclaimed voice field
  // already owns, adopt that field instead of failing on the collision.
  const createFieldAndAdopt = async (label: string, phase: Phase) => {
    const key = keyFromLabel(label);
    if (!key) return;
    const existing = voiceFields.find((field) => field.key === key);
    if (existing) {
      adoptField(existing, phase);
      return;
    }
    try {
      const id = (await createContactField({
        label,
        type: "text",
        source: "voice",
      })) as string;
      const field: VoiceContactField = { id, key, label, type: "text", options: [], voice: true };
      setCreatedFields((rows) => [...rows, field]);
      adoptField(field, phase);
    } catch {
      setStatus(t("voiceVariables.fieldExists"));
    }
  };

  // Call-scoped variable: named in the picker, saved with the call only.
  // Deliberately NOT a customer field — per-call answers ("reason for
  // calling") on the customer card is how a field registry rots.
  const addCallOnly = (label: string, phase: Phase) => {
    setDraft((rows) => [
      ...rows,
      {
        ...blankVariable(),
        label,
        key: keyFromLabel(label),
        duringMode: phase === "during" ? "if_missing" : "none",
        afterCall: phase !== "before",
        beforeSource: phase === "before" ? "static" : "none",
      },
    ]);
    setFocusLast(true);
  };

  // Picking a built-in ("Customer name") builds the row quick-add used to:
  // prefilled from that context, asked only when the business doesn't know it.
  const adoptBuiltin = (builtin: PickerBuiltin, phase: Phase) => {
    setDraft((rows) => [
      ...rows,
      {
        ...blankVariable(),
        label: builtin.label,
        key: builtin.key,
        beforeSource: builtin.source,
        duringMode: phase === "during" ? "if_missing" : "none",
        afterCall: phase === "after",
      },
    ]);
    setFocusLast(true);
  };

  // Name-cell re-points: clicking a row's name and choosing something else
  // redefines what the row is. Identity fields move together — label, key,
  // type, link, prefill — so a row can never claim a field's key while
  // pointing its data elsewhere.
  const relinkRow = (index: number, field: VoiceContactField) =>
    patch(index, {
      label: field.label,
      key: field.key,
      type: field.type === "select" ? "enum" : field.type === "number" ? "number" : "string",
      choices: field.type === "select" ? field.options : undefined,
      destination: "contact",
      contactFieldId: field.id,
      beforeSource: "contact_field",
      beforeFieldId: field.id,
    });

  const relinkRowToBuiltin = (index: number, builtin: PickerBuiltin) =>
    patch(index, {
      label: builtin.label,
      key: builtin.key,
      beforeSource: builtin.source,
      beforeFieldId: undefined,
      destination: "call",
      contactFieldId: undefined,
    });

  const renameRowCallOnly = (index: number, label: string) => {
    const row = draft[index];
    patch(index, {
      label,
      // A published key never follows a rename; unpublished ones do.
      key: publishedKeys.has(row.key) ? row.key : keyFromLabel(label),
      destination: "call",
      contactFieldId: undefined,
      ...(row.beforeSource === "contact_field"
        ? {
            // A before-only row stripped of its field source would be used at
            // no phase, which publish rejects; static keeps it a before row.
            beforeSource:
              row.duringMode === "none" && !row.afterCall
                ? ("static" as const)
                : ("none" as const),
            beforeFieldId: undefined,
          }
        : {}),
    });
  };

  const createFieldForRow = async (index: number, label: string) => {
    const key = keyFromLabel(label);
    if (!key) return;
    const existing = voiceFields.find((field) => field.key === key);
    if (existing) {
      relinkRow(index, existing);
      return;
    }
    try {
      const id = (await createContactField({
        label,
        type: "text",
        source: "voice",
      })) as string;
      const field: VoiceContactField = { id, key, label, type: "text", options: [], voice: true };
      setCreatedFields((rows) => [...rows, field]);
      relinkRow(index, field);
    } catch {
      setStatus(t("voiceVariables.fieldExists"));
    }
  };

  const publish = async (rows: VoiceVariable[], keepUndo: boolean) => {
    setBusy(true);
    setStatus(t("voiceVariables.publishing"));
    try {
      const result = await publishVariables({
        agentId,
        ...(version !== null ? { baseVersion: version } : {}),
        variables: rows.map((row) => ({
          ...row,
          beforeFieldId: row.beforeFieldId as Id<"contactFields"> | undefined,
          contactFieldId: row.contactFieldId as Id<"contactFields"> | undefined,
        })),
      });
      if (keepUndo) setPrevious(initial.map((row) => ({ ...row })));
      else setPrevious(null);
      setStatus(t("voiceVariables.published").replace("{n}", String(result.version ?? "")));
      onPublished();
    } catch {
      setStatus(t("settings.voiceActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  // Save and Discard have to act on the draft as it stands when the header
  // button is clicked, not as it stood when the effect ran. A ref holds the
  // live closures; the effect then depends only on the two flags the header
  // actually renders from, instead of re-firing every keystroke.
  const liveRef = useRef({ publish, draft, initial });
  useEffect(() => {
    liveRef.current = { publish, draft, initial };
  });
  useEffect(() => {
    onSaveStateChange?.({
      dirty,
      busy,
      rows: draft,
      save: () => void liveRef.current.publish(liveRef.current.draft, true),
      discard: () => setDraft(liveRef.current.initial),
    });
  }, [dirty, busy, draft, onSaveStateChange]);

  // Which group a row lives in. A Randevu variable is a LIFECYCLE, not a
  // single moment — one row can be seeded before the call, asked during it and
  // recovered from the analysis after. So the group is its most active phase,
  // and the phase picker in the Type popover is what moves it between groups.
  // The other phases stay visible on the row as small tags rather than as
  // three extra columns nobody could edit inline at this width.
  const phaseOf = (row: VoiceVariable): Phase =>
    row.duringMode !== "none" ? "during" : row.afterCall ? "after" : "before";

  const patch = (index: number, next: Partial<VoiceVariable>) =>
    setDraft((rows) => rows.map((row, i) => (i === index ? { ...row, ...next } : row)));

  const removeAt = (index: number) => {
    const row = draft[index];
    // A blank row is a mis-click; a filled one is work. Only the second asks.
    if (row.label.trim() || row.description.trim()) {
      setConfirmRemove(index);
      return;
    }
    setDraft((rows) => rows.filter((_, i) => i !== index));
  };

  const groups: { id: Phase; title: string; tip: string }[] = [
    {
      id: "before",
      title: t("voiceDetail.before"),
      tip: t("voiceDetail.beforeHint"),
    },
    {
      id: "during",
      title: t("voiceDetail.during"),
      tip: t("voiceDetail.duringHint"),
    },
    { id: "after", title: t("voiceDetail.after"), tip: t("voiceDetail.afterHint") },
  ];

  // Built-ins and the org's voice-enabled customer fields that no row captures
  // yet. Not editable — they are context the runtime always injects, or a
  // field configured in Business — so they sit under their own quiet heading
  // instead of pretending to be rows you can type in.
  const availableBuiltins = builtinVoiceVariables(t).filter(
    (builtin) => !draft.some((row) => row.key === builtin.key),
  );
  const availableFields = voiceFields.filter(
    (field) => !draft.some((row) => row.contactFieldId === field.id || row.key === field.key),
  );
  // What the pickers offer. "Service list" stays out: it is injected context
  // with no before-source, not a value a row can hold.
  const pickerBuiltins: PickerBuiltin[] = availableBuiltins
    .filter((builtin) => builtin.key !== "services")
    .map((builtin) => ({
      key: builtin.key,
      label: builtin.label,
      source: builtin.key as PickerBuiltin["source"],
    }));
  // A row's own picker also lists what the row currently is, so the menu
  // always contains the current selection.
  const rowPickerFields = (row: VoiceVariable): VoiceContactField[] => {
    const own = row.contactFieldId ? fieldById.get(row.contactFieldId) : undefined;
    return own ? [own, ...availableFields] : availableFields;
  };
  const rowPickerBuiltins = (row: VoiceVariable): PickerBuiltin[] => {
    const own = builtinVoiceVariables(t).find(
      (builtin) => builtin.key === row.key && builtin.key !== "services",
    );
    return own
      ? [{ key: own.key, label: own.label, source: own.key as PickerBuiltin["source"] }, ...pickerBuiltins]
      : pickerBuiltins;
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h4 className="text-sm font-semibold">{t("voiceVariables.title")}</h4>
          <InfoTip
            text={`${managed ? t("voiceVariables.hint") : t("voiceVariables.importedHint")} ${t("voiceVariables.builtinHint")}`}
          />
          <span className="text-xs text-[var(--muted)]">{draft.length || ""}</span>
        </div>
        {status && <span className="text-xs text-[var(--muted)]">{status}</span>}
        {previous && !dirty && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void publish(previous, false)}
            className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
          >
            {t("voiceDetail.undo")}
          </button>
        )}
        {!onSaveStateChange && (
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() => void publish(draft, true)}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-40"
          >
            {t("voiceVariables.publish")}
          </button>
        )}
      </div>

      <div className="space-y-4">
        {groups.map((group) => {
          const rows = draft
            .map((row, index) => ({ row, index }))
            .filter(({ row }) => phaseOf(row) === group.id);
          return (
            <div key={group.id}>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
                {group.title}
                <InfoTip text={group.tip} />
              </div>
              <div className="space-y-1">
                {rows.map(({ row, index }) => (
                  <VariableRow
                    key={index}
                    row={row}
                    // A linked row shows the field's CURRENT label: renaming
                    // the field in Business renames it here without touching
                    // the stored row, because the key is the identity.
                    displayLabel={
                      (row.contactFieldId
                        ? fieldById.get(row.contactFieldId)?.label
                        : undefined) ?? row.label
                    }
                    fields={voiceFields}
                    pickerFields={rowPickerFields(row)}
                    pickerBuiltins={rowPickerBuiltins(row)}
                    supportsLive={supportsLive}
                    autoFocus={focusLast && index === draft.length - 1}
                    canLinkCustomer={
                      row.key === keyFromLabel(row.label) &&
                      !voiceFields.some((field) => field.key === row.key)
                    }
                    onLinkCustomer={() => void linkToCustomer(index)}
                    onPickField={(field) => relinkRow(index, field)}
                    onPickBuiltin={(builtin) => relinkRowToBuiltin(index, builtin)}
                    onCreateField={(label) => void createFieldForRow(index, label)}
                    onRename={(label) => renameRowCallOnly(index, label)}
                    onFocused={() => setFocusLast(false)}
                    onChange={(next) => patch(index, next)}
                    onRemove={() => removeAt(index)}
                  />
                ))}
                <VariablePicker
                  fields={availableFields}
                  builtins={pickerBuiltins}
                  onField={(field) => adoptField(field, group.id)}
                  onBuiltin={(builtin) => adoptBuiltin(builtin, group.id)}
                  onCreate={(label) => void createFieldAndAdopt(label, group.id)}
                  onCallOnly={(label) => addCallOnly(label, group.id)}
                />
              </div>
            </div>
          );
        })}

        {(availableBuiltins.length > 0 || availableFields.length > 0) && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
              {t("voiceVariables.alwaysAvailable")}
              <InfoTip text={t("voiceVariables.builtinHint")} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableBuiltins.map((builtin) => (
                <span
                  key={builtin.key}
                  title={builtin.key}
                  className="rounded-lg bg-[var(--muted-bg)] px-2 py-1 text-xs text-[var(--muted)]"
                >
                  {builtin.label}
                </span>
              ))}
              {/* A field the org already configured in Business becomes a
                  capture row in one click — it must be findable where
                  variables live, not only where it was created. */}
              {availableFields.map((field) => (
                <button
                  key={field.id}
                  type="button"
                  onClick={() => adoptField(field)}
                  title={t("voiceVariables.customerCard")}
                  className="rounded-lg border border-dashed border-[var(--border)] px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--muted-bg)]"
                >
                  + {field.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {confirmRemove !== null && (
        <Sheet
          title={t("voiceVariables.remove")}
          onClose={() => setConfirmRemove(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted)]">
              {t("voiceVariables.removeBody").replace(
                "{name}",
                draft[confirmRemove]?.label || draft[confirmRemove]?.key || "",
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemove(null)}
                className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft((rows) => rows.filter((_, i) => i !== confirmRemove));
                  setConfirmRemove(null);
                }}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-[var(--muted-bg)]"
              >
                {t("voiceVariables.remove")}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// A variable that Randevu knows about, offered by the picker. Built-ins map
// to their before-call source so picking "Customer name" builds the same row
// quick-add used to.
type PickerBuiltin = {
  key: string;
  label: string;
  source: VoiceVariable["beforeSource"];
};

// THE variable selector. It is both the "+ Add variable" control and every
// row's name cell — a variable's name is a choice from what the business
// knows (customer fields, built-in context), or an explicit new thing, never
// silent free text. That is the CRM-property-picker contract: one registry,
// referenced everywhere, created inline, and a row can always be re-pointed
// by clicking its name.
function VariablePicker({
  current,
  fields,
  builtins,
  onField,
  onBuiltin,
  onCreate,
  onCallOnly,
}: {
  // undefined renders the "+ Add variable" link; a string renders a row's
  // name cell (empty string = unnamed row).
  current?: string;
  fields: VoiceContactField[];
  builtins: PickerBuiltin[];
  onField: (field: VoiceContactField) => void;
  onBuiltin: (builtin: PickerBuiltin) => void;
  onCreate: (label: string) => void;
  onCallOnly: (label: string) => void;
}) {
  const { t } = useLanguage();
  const isName = current !== undefined;
  const { triggerRef, panelRef, pos, open, toggle, close } = useAnchoredPanel(300, 380, "left");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  const fieldMatches = trimmed
    ? fields.filter(
        (field) =>
          field.label.toLowerCase().includes(needle) ||
          field.key.includes(keyFromLabel(trimmed)),
      )
    : fields;
  const builtinMatches = trimmed
    ? builtins.filter(
        (builtin) =>
          builtin.label.toLowerCase().includes(needle) ||
          builtin.key.includes(keyFromLabel(trimmed)),
      )
    : builtins;
  // An unclaimed field already owning this exact key makes "create" a
  // guaranteed collision; adopting it is the only outcome that works.
  const exactMatch = trimmed ? fields.find((field) => field.key === keyFromLabel(trimmed)) : undefined;

  const pick = (action: () => void) => {
    action();
    close();
  };

  const optionClass =
    "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[var(--muted-bg)]";
  const headingClass = "px-2 pt-1.5 pb-0.5 text-[10px] font-medium text-[var(--muted)]";

  return (
    <>
      {isName ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          className="flex w-full items-center justify-between gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-left text-xs"
        >
          <span className={`truncate ${current ? "" : "text-[var(--muted)]"}`}>
            {current || t("voiceVariables.label")}
          </span>
          <span aria-hidden className="shrink-0 text-[10px] text-[var(--muted)]">
            ▾
          </span>
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          className="text-xs text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--foreground)]"
        >
          {t("voiceVariables.addRow")}
        </button>
      )}
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
            className="fixed z-50 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-lg"
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (fieldMatches[0]) pick(() => onField(fieldMatches[0]));
                else if (builtinMatches[0]) pick(() => onBuiltin(builtinMatches[0]));
                else if (trimmed) pick(() => onCreate(trimmed));
              }}
              placeholder={t("voiceVariables.pickerSearch")}
              className="mb-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
            />
            <div className="max-h-64 overflow-y-auto">
              {fieldMatches.length > 0 && (
                <div className={headingClass}>{t("voiceVariables.customerCard")}</div>
              )}
              {fieldMatches.map((field) => (
                <button
                  key={field.id}
                  type="button"
                  onClick={() => pick(() => onField(field))}
                  className={optionClass}
                >
                  <span className="min-w-0 truncate">{field.label}</span>
                  <code className="shrink-0 text-[10px] text-[var(--muted)]">{field.key}</code>
                </button>
              ))}
              {builtinMatches.length > 0 && (
                <div className={headingClass}>{t("voiceVariables.alwaysAvailable")}</div>
              )}
              {builtinMatches.map((builtin) => (
                <button
                  key={builtin.key}
                  type="button"
                  onClick={() => pick(() => onBuiltin(builtin))}
                  className={optionClass}
                >
                  <span className="min-w-0 truncate">{builtin.label}</span>
                  <code className="shrink-0 text-[10px] text-[var(--muted)]">{builtin.key}</code>
                </button>
              ))}
            </div>
            {trimmed && !exactMatch && (
              <button
                type="button"
                onClick={() => pick(() => onCreate(trimmed))}
                title={t("voiceVariables.pickerCreateHint")}
                className="w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-[var(--accent)] hover:bg-[var(--muted-bg)]"
              >
                + {t("voiceVariables.pickerCreate").replace("{name}", trimmed)}
              </button>
            )}
            {trimmed && (
              <button
                type="button"
                onClick={() => pick(() => onCallOnly(trimmed))}
                className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
              >
                {t("voiceVariables.pickerCallOnly").replace("{name}", trimmed)}
              </button>
            )}
            {!trimmed && fieldMatches.length === 0 && builtinMatches.length === 0 && (
              <div className="px-2 py-1.5 text-[11px] text-[var(--muted)]">
                {t("voiceVariables.pickerEmpty")}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

// One variable, editable where it sits. Label and description are plain
// inputs; everything with a fixed set of answers — type, choices, which phases
// it is captured in, where the answer lands — is behind the one popover, which
// is what keeps the row to a width that fits the card.
function VariableRow({
  row,
  displayLabel,
  fields,
  pickerFields,
  pickerBuiltins,
  supportsLive,
  autoFocus,
  canLinkCustomer,
  onFocused,
  onChange,
  onRemove,
  onLinkCustomer,
  onPickField,
  onPickBuiltin,
  onCreateField,
  onRename,
}: {
  row: VoiceVariable;
  displayLabel: string;
  fields: VoiceContactField[];
  pickerFields: VoiceContactField[];
  pickerBuiltins: PickerBuiltin[];
  supportsLive: boolean;
  autoFocus: boolean;
  canLinkCustomer: boolean;
  onFocused: () => void;
  onChange: (next: Partial<VoiceVariable>) => void;
  onRemove: () => void;
  onLinkCustomer: () => void;
  onPickField: (field: VoiceContactField) => void;
  onPickBuiltin: (builtin: PickerBuiltin) => void;
  onCreateField: (label: string) => void;
  onRename: (label: string) => void;
}) {
  const { t } = useLanguage();
  const { triggerRef, panelRef, pos, open, toggle, close } = useAnchoredPanel(300, 420, "right");
  const descriptionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    // Rows arrive named from the picker; the description is what's left.
    descriptionRef.current?.focus();
    onFocused();
  }, [autoFocus, onFocused]);

  const typeLabel =
    row.type === "enum"
      ? `${t("voiceVariables.options")} · ${row.choices?.filter((c) => c.trim()).length ?? 0}`
      : row.type === "number"
        ? t("voiceVariables.number")
        : row.type === "boolean"
          ? t("voiceVariables.yesNo")
          : t("voiceVariables.text");

  return (
    <div className="flex items-center gap-1.5">
      {/* The name is a selection, not free text. Clicking it re-points the
          row at another customer field, a built-in, a newly created field or
          a call-only name — identity always moves as one piece. */}
      <div className="w-48 shrink-0">
        <VariablePicker
          current={displayLabel}
          fields={pickerFields}
          builtins={pickerBuiltins}
          onField={onPickField}
          onBuiltin={onPickBuiltin}
          onCreate={onCreateField}
          onCallOnly={onRename}
        />
      </div>
      <input
        ref={descriptionRef}
        value={row.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder={t("voiceVariables.description")}
        className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
      />
      {/* Fixed width: the trigger is a select in behaviour, and a select
          whose width follows its value gives every row a different edge. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="flex w-[7.5rem] shrink-0 items-center justify-between gap-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <span className="truncate">{typeLabel}</span>
        <span aria-hidden className="text-[10px]">▾</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        title={t("voiceVariables.remove")}
        className="shrink-0 rounded-lg px-1.5 py-1.5 text-xs text-[var(--muted)] hover:text-red-600"
      >
        ✕
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
            className="fixed z-50 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-lg"
          >
            {/* Label left, control right: six stacked label-above-control
                blocks made the popover twice as tall as its content. */}
            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="shrink-0 font-medium">{t("voiceVariables.type")}</span>
              <select
                value={row.type}
                onChange={(e) =>
                  onChange({ type: e.target.value as VoiceVariable["type"] })
                }
                className="w-40 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
              >
                <option value="string">{t("voiceVariables.text")}</option>
                <option value="number">{t("voiceVariables.number")}</option>
                <option value="boolean">{t("voiceVariables.yesNo")}</option>
                <option value="enum">{t("voiceVariables.options")}</option>
              </select>
            </label>

            {row.type === "enum" && (
              <div className="space-y-1">
                {(row.choices ?? []).map((choice, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <input
                      value={choice}
                      autoFocus={choice === "" && index === (row.choices?.length ?? 0) - 1}
                      onChange={(e) =>
                        onChange({
                          choices: (row.choices ?? []).map((c, i) =>
                            i === index ? e.target.value : c,
                          ),
                        })
                      }
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || !choice.trim()) return;
                        e.preventDefault();
                        onChange({ choices: [...(row.choices ?? []), ""] });
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        onChange({ choices: (row.choices ?? []).filter((_, i) => i !== index) })
                      }
                      className="shrink-0 rounded-lg px-1.5 py-1 text-xs text-[var(--muted)] hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => onChange({ choices: [...(row.choices ?? []), ""] })}
                  className="text-xs text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--foreground)]"
                >
                  {t("voiceVariables.addOption")}
                </button>
              </div>
            )}

            {/* The capture phase. Changing it moves the row to that group,
                which is the only way to move a row between them. */}
            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="shrink-0 font-medium">
                {t("voiceVariables.capturedWhen")}
              </span>
              <select
                value={row.duringMode !== "none" ? row.duringMode : row.afterCall ? "after" : "before"}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === "before") {
                    onChange({
                      duringMode: "none",
                      afterCall: false,
                      beforeSource: row.beforeSource === "none" ? "static" : row.beforeSource,
                    });
                  } else if (next === "after") {
                    onChange({ duringMode: "none", afterCall: true });
                  } else {
                    onChange({
                      duringMode: next as VoiceVariable["duringMode"],
                      afterCall: true,
                    });
                  }
                }}
                className="w-40 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
              >
                <option value="before">{t("voiceDetail.before")}</option>
                {supportsLive && (
                  <option value="if_missing">{t("voiceVariables.askMissing")}</option>
                )}
                {supportsLive && <option value="confirm">{t("voiceVariables.confirm")}</option>}
                <option value="after">{t("voiceVariables.extract")}</option>
              </select>
            </label>

            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="shrink-0 font-medium">
                {t("voiceDetail.before")}
              </span>
              <select
                value={
                  row.beforeSource === "contact_field" && row.beforeFieldId
                    ? `field:${row.beforeFieldId}`
                    : row.beforeSource
                }
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.startsWith("field:")) {
                    onChange({
                      beforeSource: "contact_field",
                      beforeFieldId: value.slice(6),
                    });
                  } else {
                    onChange({
                      beforeSource: value as VoiceVariable["beforeSource"],
                      beforeFieldId: undefined,
                    });
                  }
                }}
                className="w-40 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
              >
                <option value="none">{t("voiceVariables.none")}</option>
                <option value="static">{t("voiceVariables.defaultValue")}</option>
                <option value="business_name">{t("voiceVariables.businessName")}</option>
                <option value="customer_name">{t("voiceVariables.customerName")}</option>
                <option value="customer_phone">{t("voiceVariables.customerPhone")}</option>
                <option value="customer_language">{t("voiceVariables.customerLanguage")}</option>
                <option value="next_appointment">{t("voiceVariables.nextAppointment")}</option>
                {fields.map((field) => (
                  <option key={field.id} value={`field:${field.id}`}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>

            {row.beforeSource === "static" && (
              <label className="flex items-center justify-between gap-3 text-xs">
                <span className="shrink-0 font-medium">
                  {t("voiceVariables.defaultValue")}
                </span>
                <input
                  value={row.beforeValue ?? ""}
                  onChange={(e) => onChange({ beforeValue: e.target.value })}
                  className="w-40 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
                />
              </label>
            )}

            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="shrink-0 font-medium">
                {t("voiceVariables.savedTo")}
              </span>
              <select
                value={
                  row.destination === "contact" && row.contactFieldId
                    ? `field:${row.contactFieldId}`
                    : "call"
                }
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "new") {
                    onLinkCustomer();
                    return;
                  }
                  onChange(
                    value === "call"
                      ? { destination: "call", contactFieldId: undefined }
                      : { destination: "contact", contactFieldId: value.slice(6) },
                  );
                }}
                className="w-40 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
              >
                <option value="call">{t("voiceVariables.callOnly")}</option>
                {/* Only a field whose key matches — the publish validator
                    rejects any other pairing, so offering it would be a
                    choice that always fails. */}
                {fields
                  .filter((field) => field.key === row.key)
                  .map((field) => (
                    <option key={field.id} value={`field:${field.id}`}>
                      {field.label}
                    </option>
                  ))}
                {canLinkCustomer && (
                  <option value="new">{t("voiceVariables.saveToCustomer")}</option>
                )}
              </select>
            </label>
            {fields.length === 0 && (
              <span className="block text-[11px] text-[var(--muted)]">
                {t("voiceVariables.noFieldsHint")}
              </span>
            )}

            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="shrink-0 font-medium">{t("voiceVariables.required")}</span>
              <input
                type="checkbox"
                checked={row.required}
                onChange={(e) => onChange({ required: e.target.checked })}
                className="accent-[var(--accent)]"
              />
            </label>

            <div className="flex justify-between">
              <code className="self-center text-[10px] text-[var(--muted)]">{row.key}</code>
              <button
                type="button"
                onClick={close}
                className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
              >
                {t("voiceVariables.done")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
