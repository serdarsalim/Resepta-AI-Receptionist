"use client";

import { useAction, useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
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

function keyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
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
  contactFields,
  onPublished,
}: {
  agentId: string;
  version: number | null;
  engineType: string | null;
  managed: boolean;
  initial: VoiceVariable[];
  contactFields: VoiceContactField[];
  onPublished: () => void;
}) {
  const { t } = useLanguage();
  const publishVariables = useAction(api.retellAgent.publishVariables);
  const createContactField = useMutation(api.contactFields.create);
  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<VoiceVariable>(blankVariable);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [previous, setPrevious] = useState<VoiceVariable[] | null>(null);
  // Quick add: a row that appears under the header, not a sheet. Name plus
  // one decision (customer card or not); everything else gets the defaults
  // and the full sheet stays one click away on the row.
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickToCustomer, setQuickToCustomer] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const quickRef = useRef<HTMLInputElement>(null);
  // Customer fields created from quick add, so their labels resolve before
  // the parent reloads. Reloading here would reset the unpublished draft.
  const [createdFields, setCreatedFields] = useState<VoiceContactField[]>([]);

  useEffect(() => setDraft(initial), [initial]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);
  const allFields = useMemo(
    () => [...contactFields, ...createdFields],
    [contactFields, createdFields],
  );
  const voiceFields = allFields.filter((field) => field.voice);
  const fieldById = new Map(allFields.map((field) => [field.id, field]));
  const supportsLive = engineType === "retell-llm";

  const quickAdd = async () => {
    const label = quickName.trim();
    if (!label) return;
    const key = keyFromLabel(label);
    if (!key) return;
    setQuickError(null);
    if (draft.some((row) => row.key === key)) {
      setQuickError(t("voiceVariables.fieldExists"));
      return;
    }
    let contactFieldId: string | undefined;
    if (quickToCustomer) {
      // An already-configured voice field with this key is the same intent —
      // link it instead of failing on the duplicate.
      const existing = voiceFields.find((field) => field.key === key);
      if (existing) {
        contactFieldId = existing.id;
      } else {
        try {
          contactFieldId = (await createContactField({
            label,
            type: "text",
            source: "voice",
          })) as string;
          setCreatedFields((rows) => [
            ...rows,
            { id: contactFieldId!, key, label, type: "text", options: [], voice: true },
          ]);
        } catch {
          setQuickError(t("voiceVariables.fieldExists"));
          return;
        }
      }
    }
    setDraft((rows) => [
      ...rows,
      {
        ...blankVariable(),
        key,
        label,
        destination: contactFieldId ? "contact" : "call",
        contactFieldId,
      },
    ]);
    setQuickName("");
    quickRef.current?.focus();
  };

  const beforeLabel = (row: VoiceVariable) => {
    switch (row.beforeSource) {
      case "static":
        return row.beforeValue || t("voiceVariables.defaultValue");
      case "business_name":
        return t("voiceVariables.businessName");
      case "customer_name":
        return t("voiceVariables.customerName");
      case "customer_phone":
        return t("voiceVariables.customerPhone");
      case "customer_language":
        return t("voiceVariables.customerLanguage");
      case "next_appointment":
        return t("voiceVariables.nextAppointment");
      case "contact_field":
        return row.beforeFieldId
          ? fieldById.get(row.beforeFieldId)?.label ?? ""
          : "";
      default:
        return "";
    }
  };

  const duringLabel = (row: VoiceVariable) =>
    row.duringMode === "if_missing"
      ? t("voiceVariables.askMissing")
      : row.duringMode === "confirm"
        ? t("voiceVariables.confirm")
        : "";

  // A voice-enabled customer field the org configured in Business becomes a
  // capture row here in one click, pre-linked to its field.
  const adoptField = (field: VoiceContactField) => {
    setDraft((rows) => [
      ...rows,
      {
        ...blankVariable(),
        key: field.key,
        label: field.label,
        type: field.type === "select" ? "enum" : field.type === "number" ? "number" : "string",
        choices: field.type === "select" ? field.options : undefined,
        destination: "contact",
        contactFieldId: field.id,
      },
    ]);
  };

  const openEdit = (index: number) => {
    setForm({ ...draft[index], choices: draft[index].choices?.slice() });
    setEditing(index);
  };

  const applyForm = () => {
    const next = {
      ...form,
      label: form.label.trim(),
      key: form.key.trim(),
      description: form.description.trim(),
      choices:
        form.type === "enum"
          ? [...new Set((form.choices ?? []).map((choice) => choice.trim()).filter(Boolean))]
          : undefined,
    };
    if (!next.label || !next.key) return;
    setDraft((rows) =>
      editing === "new"
        ? [...rows, next]
        : rows.map((row, index) => (index === editing ? next : row)),
    );
    setEditing(null);
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

  const destinationValue =
    form.destination === "contact" && form.contactFieldId
      ? `field:${form.contactFieldId}`
      : "call";
  const beforeValue =
    form.beforeSource === "contact_field" && form.beforeFieldId
      ? `field:${form.beforeFieldId}`
      : form.beforeSource;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h4 className="text-xs font-medium">{t("voiceVariables.title")}</h4>
          <InfoTip
            text={`${managed ? t("voiceVariables.hint") : t("voiceVariables.importedHint")} ${t("voiceVariables.builtinHint")}`}
          />
          <span className="text-xs text-[var(--muted)]">{draft.length || ""}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setQuickOpen((open) => !open);
            setQuickError(null);
            requestAnimationFrame(() => quickRef.current?.focus());
          }}
          className="h-8 rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-fg)]"
        >
          {t("voiceVariables.add")}
        </button>
      </div>

      {quickOpen && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--muted-bg)] p-2">
          <input
            ref={quickRef}
            value={quickName}
            onChange={(event) => setQuickName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void quickAdd();
              if (event.key === "Escape") setQuickOpen(false);
            }}
            placeholder={t("voiceVariables.label")}
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
          />
          <label className="inline-flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={quickToCustomer}
              onChange={(event) => setQuickToCustomer(event.target.checked)}
              className="accent-[var(--accent)]"
            />
            {t("voiceVariables.saveToCustomer")}
          </label>
          <button
            type="button"
            disabled={!quickName.trim()}
            onClick={() => void quickAdd()}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-40"
          >
            {t("common.add")}
          </button>
          {quickError && (
            <span className="text-xs text-amber-700 dark:text-amber-400">{quickError}</span>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-[var(--table-header-bg)] text-left text-xs text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">{t("voiceVariables.variable")}</th>
              <th className="px-3 py-2 font-medium">{t("voiceDetail.before")}</th>
              <th className="px-3 py-2 font-medium">{t("voiceDetail.during")}</th>
              <th className="px-3 py-2 font-medium">{t("voiceDetail.after")}</th>
              <th className="px-3 py-2 font-medium">{t("voiceVariables.savedTo")}</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {/* Built-ins first: always present, never editable, so the list
                here matches the @ picker exactly. A registry row with the
                same key replaces its built-in. */}
            {builtinVoiceVariables(t)
              .filter((builtin) => !draft.some((row) => row.key === builtin.key))
              .map((builtin) => (
                <tr key={`builtin:${builtin.key}`} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 text-[var(--muted)]">
                    {builtin.label}
                    <code className="ml-2 text-[10px]">{builtin.key}</code>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted)]">
                    {t("voiceVariables.builtin")}
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted)]">
                    {t("voiceVariables.callOnly")}
                  </td>
                  <td className="px-2 py-2" />
                </tr>
              ))}
            {/* Voice-enabled customer fields the agent doesn't capture yet.
                Configured in Business, offered here: the owner who just added
                a field must find it where variables live, with one click to
                start collecting it. */}
            {voiceFields
              .filter(
                (field) =>
                  !draft.some(
                    (row) => row.contactFieldId === field.id || row.key === field.key,
                  ),
              )
              .map((field) => (
                <tr key={`field:${field.id}`} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 text-[var(--muted)]">
                    {field.label}
                    <code className="ml-2 text-[10px]">{field.key}</code>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted)]">
                    {t("voiceVariables.customerCard")}
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted)]">
                    {field.label}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => adoptField(field)}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--muted-bg)]"
                    >
                      {t("voiceVariables.use")}
                    </button>
                  </td>
                </tr>
              ))}
            {/* No empty state: the built-ins above mean the list is never
                empty, and "no variables yet" over a list of variables lies. */}
            {draft.map((row, index) => (
                <tr key={`${row.key}:${index}`} className="group border-t border-[var(--border)]">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => openEdit(index)}
                      className="text-left font-medium underline-offset-2 hover:underline"
                    >
                      {row.label}
                    </button>
                    <code className="ml-2 text-[10px] text-[var(--muted)]">{row.key}</code>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted)]">
                    {beforeLabel(row)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted)]">
                    {duringLabel(row)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted)]">
                    {row.afterCall ? t("voiceVariables.extract") : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted)]">
                    {row.destination === "contact" && row.contactFieldId
                      ? fieldById.get(row.contactFieldId)?.label ?? ""
                      : t("voiceVariables.callOnly")}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      aria-label={t("voiceVariables.remove").replace("{name}", row.label)}
                      onClick={() => setDraft((rows) => rows.filter((_, i) => i !== index))}
                      className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] opacity-0 hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex min-h-8 items-center justify-end gap-2">
        {status && <span className="mr-auto text-xs text-[var(--muted)]">{status}</span>}
        {previous && !dirty && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void publish(previous, false)}
            className="rounded-lg px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
          >
            {t("voiceDetail.undo")}
          </button>
        )}
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() => void publish(draft, true)}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] disabled:opacity-40"
        >
          {t("voiceVariables.publish")}
        </button>
      </div>

      {editing !== null && (
        <Sheet
          title={editing === "new" ? t("voiceVariables.add") : t("voiceVariables.edit")}
          hint={t("voiceVariables.editHint")}
          onClose={() => setEditing(null)}
        >
          <div className="space-y-3">
            {/* A destination is a choice only when the business has allowed
                the phone agent to edit at least one customer field. A select
                with a single option is a question the sheet asks nobody; the
                hint below the form says how to unlock real destinations. */}
            {voiceFields.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium">{t("voiceVariables.savedTo")}</span>
              <select
                value={destinationValue}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "call") {
                    setForm((row) => ({ ...row, destination: "call", contactFieldId: undefined }));
                    return;
                  }
                  const field = fieldById.get(value.slice(6));
                  if (!field) return;
                  setForm((row) => ({
                    ...row,
                    destination: "contact",
                    contactFieldId: field.id,
                    key: field.key,
                    label: field.label,
                    type:
                      field.type === "select"
                        ? "enum"
                        : field.type === "number"
                          ? "number"
                          : "string",
                    choices: field.type === "select" ? field.options : undefined,
                  }));
                }}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
              >
                <option value="call">{t("voiceVariables.callOnly")}</option>
                {voiceFields.map((field) => (
                  <option key={field.id} value={`field:${field.id}`}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium">{t("voiceVariables.label")}</span>
                <input
                  data-sheet-autofocus
                  value={form.label}
                  disabled={form.destination === "contact"}
                  onChange={(event) => {
                    const label = event.target.value;
                    setForm((row) => ({
                      ...row,
                      label,
                      key: editing === "new" ? keyFromLabel(label) : row.key,
                    }));
                  }}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium">{t("voiceVariables.key")}</span>
                <input
                  value={form.key}
                  disabled={form.destination === "contact"}
                  onChange={(event) => setForm((row) => ({ ...row, key: keyFromLabel(event.target.value) }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-xs disabled:opacity-60"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium">{t("voiceVariables.description")}</span>
              <input
                value={form.description}
                onChange={(event) => setForm((row) => ({ ...row, description: event.target.value }))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium">{t("voiceVariables.type")}</span>
              <select
                value={form.type}
                disabled={form.destination === "contact"}
                onChange={(event) =>
                  setForm((row) => ({
                    ...row,
                    type: event.target.value as VoiceVariable["type"],
                    choices: event.target.value === "enum" ? row.choices ?? [] : undefined,
                  }))
                }
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm disabled:opacity-60"
              >
                <option value="string">{t("voiceVariables.text")}</option>
                <option value="number">{t("voiceVariables.number")}</option>
                <option value="boolean">{t("voiceVariables.yesNo")}</option>
                <option value="enum">{t("voiceVariables.options")}</option>
              </select>
            </label>
            {form.type === "enum" && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium">{t("voiceVariables.choices")}</span>
                <input
                  value={(form.choices ?? []).join(", ")}
                  disabled={form.destination === "contact"}
                  onChange={(event) =>
                    setForm((row) => ({ ...row, choices: event.target.value.split(",") }))
                  }
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm disabled:opacity-60"
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium">{t("voiceDetail.before")}</span>
                <select
                  value={beforeValue}
                  disabled={!supportsLive}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value.startsWith("field:")) {
                      setForm((row) => ({
                        ...row,
                        beforeSource: "contact_field",
                        beforeFieldId: value.slice(6),
                      }));
                    } else {
                      setForm((row) => ({
                        ...row,
                        beforeSource: value as VoiceVariable["beforeSource"],
                        beforeFieldId: undefined,
                      }));
                    }
                  }}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm disabled:opacity-60"
                >
                  <option value="none">{t("voiceVariables.none")}</option>
                  <option value="static">{t("voiceVariables.defaultValue")}</option>
                  <option value="business_name">{t("voiceVariables.businessName")}</option>
                  <option value="customer_name">{t("voiceVariables.customerName")}</option>
                  <option value="customer_phone">{t("voiceVariables.customerPhone")}</option>
                  <option value="customer_language">{t("voiceVariables.customerLanguage")}</option>
                  <option value="next_appointment">{t("voiceVariables.nextAppointment")}</option>
                  {contactFields.map((field) => (
                    <option key={field.id} value={`field:${field.id}`}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium">{t("voiceDetail.during")}</span>
                <select
                  value={form.duringMode}
                  disabled={!supportsLive}
                  onChange={(event) =>
                    setForm((row) => ({
                      ...row,
                      duringMode: event.target.value as VoiceVariable["duringMode"],
                    }))
                  }
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm disabled:opacity-60"
                >
                  <option value="none">{t("voiceVariables.none")}</option>
                  <option value="if_missing">{t("voiceVariables.askMissing")}</option>
                  <option value="confirm">{t("voiceVariables.confirm")}</option>
                </select>
              </label>
            </div>
            {form.beforeSource === "static" && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium">{t("voiceVariables.defaultValue")}</span>
                <input
                  value={form.beforeValue ?? ""}
                  onChange={(event) => setForm((row) => ({ ...row, beforeValue: event.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
                />
              </label>
            )}

            <div className="flex items-center gap-4 text-xs">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.afterCall}
                  onChange={(event) => setForm((row) => ({ ...row, afterCall: event.target.checked }))}
                  className="accent-[var(--accent)]"
                />
                {t("voiceVariables.afterFallback")}
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.required}
                  onChange={(event) => setForm((row) => ({ ...row, required: event.target.checked }))}
                  className="accent-[var(--accent)]"
                />
                {t("voiceVariables.required")}
              </label>
            </div>

            {voiceFields.length === 0 && (
              <p className="text-xs text-[var(--muted)]">
                {t("voiceVariables.noFieldsHint")}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--muted-bg)]"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={!form.label.trim() || !form.key.trim()}
                onClick={applyForm}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-40"
              >
                {editing === "new" ? t("common.add") : t("voiceVariables.done")}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
