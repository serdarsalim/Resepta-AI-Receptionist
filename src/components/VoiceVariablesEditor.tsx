"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { keyFromLabel } from "../../convex/lib/keys";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { InfoTip } from "./InfoTip";
import { CheckSwitch } from "./CheckSwitch";
import { Sheet } from "./Sheet";
import { AutoGrowTextarea } from "./AutoGrowTextarea";

// Chromeless text cells and fixed grid tracks, ported from Nudge's variables
// table (RetellPromptEditor). Bordering every cell made the table read as
// boxes before words; text cells now go quiet until hover or focus, while
// the two CONTROLS a row carries — the name picker and the type popover —
// stay boxed, because a control you are going to click has to look
// clickable.
const CELL_CLASS =
  "w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs outline-none transition-colors hover:border-[var(--border)] focus:border-[var(--accent)] focus:bg-[var(--background)]";

// One set of column tracks for every row — name · type · description
// (breathes) · remove. Type sits SECOND, beside the name: the two short
// structural facts group together and the description takes every remaining
// pixel, because it is the instruction the analysis model follows and the
// part actually worth reading. items-START so a wrapped description keeps
// its neighbours aligned to its first line.
const VAR_GRID =
  "group grid grid-cols-[11rem_8.5rem_minmax(14rem,1fr)_1.75rem] items-start gap-x-2";
// The matrix: name · type · description · two switch tracks.
const MATRIX_GRID =
  "grid grid-cols-[11rem_8.5rem_minmax(12rem,1fr)_2.5rem] items-start gap-x-2";

function RemoveX() {
  return (
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
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

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
    | "customer_email"
    | "customer_language"
    | "next_appointment"
    | "contact_field";
  beforeValue?: string;
  beforeFieldId?: string;
  duringMode: "none" | "if_missing" | "confirm";
  afterCall: boolean;
  // "customer" writes the customer's own name or email — columns on the
  // record, not entries in its custom map, so contactFieldId cannot reach
  // them. See convex/schema.ts for why the third case exists.
  destination: "call" | "contact" | "customer";
  contactFieldId?: string;
  customerField?: "firstName" | "lastName" | "email";
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


export type VoiceContactField = {
  id: string;
  key: string;
  label: string;
  type: "text" | "select" | "number" | "date";
  options: string[];
  voice: boolean;
  // The capture config lives ON the field since 2026-08-25 (the full merge
  // with the Contact fields Voice column): the extractor's instruction and
  // the confirm-first flag. deriveCaptureRows in retellAgent.ts reads the
  // same two at publish time, so this editor and the publish can only ever
  // say the same thing.
  voiceDescription: string;
  voiceConfirm: boolean;
  voiceVisible: boolean;
};

// Every key the runtime provides on its own. Derived from the real lists
// (labels resolve to their translation keys here — only the .key matters), so
// this can never drift from what the runtime actually sends.
const PROVIDED_VARIABLE_KEYS = new Set(
  [
    ...builtinVoiceVariables((key) => key as never),
    ...injectedVoiceContext((key) => key as never),
  ].map((variable) => variable.key),
);

// Context rows inject and capture nothing; they are all a caller may still
// AUTHOR per agent. Everything the agent collects is derived from the org's
// contact fields at publish time, so capture rows no longer live in the
// draft at all.
export function isContextRow(row: VoiceVariable): boolean {
  return row.duringMode === "none" && !row.afterCall;
}

// The identity columns the agent asks for automatically while they are
// unlocked. Mirrors deriveCaptureRows in retellAgent.ts row for row — the
// editor renders this list, publish derives from the same lock set, and
// voiceLockedIdentity is the single opt-out both read.
const IDENTITY_CAPTURE = [
  { lock: "firstname", labelKey: "customers.firstName", descKey: "voiceVariables.descFirstName" },
  { lock: "lastname", labelKey: "customers.lastName", descKey: "voiceVariables.descLastName" },
  { lock: "email", labelKey: "customers.email", descKey: "voiceVariables.descEmail" },
] as const;

// The context the runtime injects on every call without any configuration.
// One list, exported so the @ picker in the instructions and the Variables
// table show the SAME variables — two surfaces disagreeing about what a
// variable is was the confusion this replaces.
// One row's worth of facts about a variable the runtime provides: the key the
// prompt speaks, the human label the pickers show, what it actually carries
// (the read-only rows' third column), and whether it is one value or a list.
export type ProvidedVariable = {
  key: string;
  label: string;
  description: string;
  kind: "text" | "list";
};

type ProvidedT = (key: TranslationKey) => string;

export function builtinVoiceVariables(t: ProvidedT): ProvidedVariable[] {
  return [
    // The SAME translation keys Business → Fields uses for its identity rows.
    // Deliberately not a second vocabulary: seeing "Customer name" in the
    // agent and "First name"/"Last name" everywhere else reads as a third
    // thing that exists nowhere, and there is no such thing.
    {
      key: "customer_first_name",
      label: t("customers.firstName"),
      description: t("voiceVariables.descFirstName"),
      kind: "text",
    },
    {
      key: "customer_last_name",
      label: t("customers.lastName"),
      description: t("voiceVariables.descLastName"),
      kind: "text",
    },
    {
      key: "customer_phone",
      label: t("voiceVariables.customerPhone"),
      description: t("voiceVariables.descPhone"),
      kind: "text",
    },
    {
      key: "customer_email",
      label: t("voiceVariables.customerEmail"),
      description: t("voiceVariables.descEmail"),
      kind: "text",
    },
    {
      key: "customer_language",
      label: t("voiceVariables.customerLanguage"),
      description: t("voiceVariables.descLanguage"),
      kind: "text",
    },
    {
      key: "next_appointment",
      label: t("voiceVariables.nextAppointment"),
      description: t("voiceVariables.descNextAppointment"),
      kind: "text",
    },
    {
      key: "business_name",
      label: t("voiceVariables.businessName"),
      description: t("voiceVariables.descBusinessName"),
      kind: "text",
    },
    {
      key: "services",
      label: t("voiceVariables.servicesList"),
      description: t("voiceVariables.descServices"),
      kind: "list",
    },
  ];
}

// Context the RUNTIME sends with every call, configured or not — the
// template's own vocabulary, over and above the adoptable built-ins. These
// were invisible in the variables table and half-surfaced as unexplained
// chips under the prompt, which read as "variables that exist nowhere"
// (Serdar, 2026-08-18). They render as read-only rows in Before the call —
// not toggles: {{now}} missing is the resolved-"yarın"-to-2025 bug, and a
// switch whose only function is breaking the agent is not a setting.
export function injectedVoiceContext(t: ProvidedT): ProvidedVariable[] {
  return [
    {
      key: "agent_name",
      label: t("voiceVariables.agentName"),
      description: t("voiceVariables.descAgentName"),
      kind: "text",
    },
    {
      key: "customer_name",
      label: t("voiceVariables.customerName"),
      description: t("voiceVariables.descCustomerName"),
      kind: "text",
    },
    {
      key: "now",
      label: t("voiceVariables.now"),
      description: t("voiceVariables.descNow"),
      kind: "text",
    },
    {
      key: "staff",
      label: t("voiceVariables.staffList"),
      description: t("voiceVariables.descStaff"),
      kind: "list",
    },
    {
      key: "contact",
      label: t("voiceVariables.customerCard"),
      description: t("voiceVariables.descContact"),
      kind: "text",
    },
    {
      key: "information",
      label: t("voiceVariables.informationList"),
      description: t("voiceVariables.descInformation"),
      kind: "list",
    },
  ];
}

// The built-ins that are columns on the customer rather than entries in its
// custom map. Phone is not among them: it is how the caller was found.
function customerFieldOf(key: string): "firstName" | "lastName" | "email" | undefined {
  return key === "customer_first_name"
    ? "firstName"
    : key === "customer_last_name"
      ? "lastName"
      : key === "customer_email"
        ? "email"
        : undefined;
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
  identityLocks,
  identityDescriptions,
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
  // org.voiceLockedIdentity, from the same read as the fields: which identity
  // columns the agent may not write, and so which auto-derived questions to
  // hide. The fills switch on an identity row writes this list.
  identityLocks: string[];
  // The owner's wording for the identity extraction instructions, org-stored
  // (identity has no contactFields row to carry one). Empty = stock wording.
  identityDescriptions: Partial<Record<"firstname" | "lastname" | "email", string>>;
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
  const updateContactField = useMutation(api.contactFields.update);
  const setIdentityLock = useMutation(api.contactFields.setIdentityLock);
  const setIdentityDescription = useMutation(api.contactFields.setIdentityDescription);
  // LIVE reads for everything the matrix renders. The contactFields/
  // identityLocks props come off the agent `read` ACTION — a snapshot — and
  // rendering the switches from a snapshot is how clicking one "did nothing"
  // until reload (Serdar, in the browser: "when i click the check mark on
  // and off it doesn't toggle" — the mutation landed, the paint never came).
  // The props stay as first-render fallback while these queries load.
  const liveFields = useQuery(api.contactFields.list, {});
  const liveIdentity = useQuery(api.contactFields.identityVoiceConfig, {});
  // Context rows only. Stored sets still hold the capture rows the last
  // publish derived (and legacy hand-authored ones); the editor filters them
  // out on the way in because they are no longer anybody's to edit here —
  // the fields ARE that configuration now.
  // Clones of provided keys are dropped on the way in, not rendered as dead
  // rows: an "İşletme adı" registry entry restates a fact every call already
  // carries, and it rendered as a stray row floating under "Alan ekle"
  // (Serdar: "why is işletme adı below alan ekle??"). Publishing the filtered
  // draft is what retires them from storage too.
  const contextRowsOf = (rows: VoiceVariable[]) =>
    rows.filter((row) => isContextRow(row) && !PROVIDED_VARIABLE_KEYS.has(row.key));
  const [draft, setDraft] = useState(() => contextRowsOf(seed ?? initial));
  // Field-side edits (description, confirm, the Voice switch itself) save to
  // the org instantly but reach Retell on the next publish. This is what
  // keeps the Publish button honest about them.
  const [fieldsTouched, setFieldsTouched] = useState(false);
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

  useEffect(() => setDraft(contextRowsOf(seed ?? initial)), [initial, seed]);

  const fieldsFromLive = useMemo(
    () =>
      liveFields?.map((field) => ({
        id: String(field._id),
        key: field.key,
        label: field.label,
        type: field.type,
        options: field.options ?? [],
        voice: field.source === "voice",
        voiceDescription: field.voiceDescription ?? "",
        voiceConfirm: field.voiceConfirm === true,
        voiceVisible: field.voiceVisible === true,
      })),
    [liveFields],
  );
  const identityLocksLive = liveIdentity?.locks ?? identityLocks;
  const identityDescriptionsLive = liveIdentity?.descriptions ?? identityDescriptions;

  const dirty = useMemo(
    () =>
      fieldsTouched ||
      JSON.stringify(draft) !== JSON.stringify(contextRowsOf(initial)),
    [draft, initial, fieldsTouched],
  );
  // Live wins; created-this-session rows cover the beat before the query
  // returns the row it just made.
  const allFields = useMemo(() => {
    const base = fieldsFromLive ?? contactFields;
    const seen = new Set(base.map((field) => field.id));
    return [...base, ...createdFields.filter((field) => !seen.has(field.id))];
  }, [fieldsFromLive, contactFields, createdFields]);
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
        { id, key: row.key, label, type: "text", options: [], voice: true, voiceDescription: "", voiceConfirm: false, voiceVisible: false },
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
  // Fills-side actions write the FIELD, not a row. They mark fieldsTouched so
  // the Publish button knows Retell is behind the org.
  const touchFields = () => setFieldsTouched(true);
  const enableFieldVoice = (field: VoiceContactField) => {
    void updateContactField({ fieldId: field.id as Id<"contactFields">, source: "voice" });
    setCreatedFields((rows) =>
      rows.map((row) => (row.id === field.id ? { ...row, voice: true } : row)),
    );
    touchFields();
  };
  const disableFieldVoice = (field: VoiceContactField) => {
    void updateContactField({ fieldId: field.id as Id<"contactFields">, source: "manual" });
    setCreatedFields((rows) =>
      rows.map((row) => (row.id === field.id ? { ...row, voice: false } : row)),
    );
    touchFields();
  };
  const createVoiceField = async (label: string) => {
    const key = keyFromLabel(label);
    if (!key) return;
    const existing = allFields.find((field) => field.key === key);
    if (existing) {
      if (!existing.voice) enableFieldVoice(existing);
      return;
    }
    try {
      const id = (await createContactField({ label, type: "text", source: "voice" })) as string;
      setCreatedFields((rows) => [
        ...rows,
        { id, key, label, type: "text", options: [], voice: true, voiceDescription: "", voiceConfirm: false, voiceVisible: false },
      ]);
      touchFields();
    } catch {
      setStatus(t("voiceVariables.fieldExists"));
    }
  };
  const unlockIdentity = (lock: "firstname" | "lastname" | "email") => {
    void setIdentityLock({ key: lock, locked: false });
    touchFields();
  };
  const lockIdentity = (lock: "firstname" | "lastname" | "email") => {
    void setIdentityLock({ key: lock, locked: true });
    touchFields();
  };

  // Call-scoped variable: named in the picker, saved with the call only.
  // Deliberately NOT a customer field — per-call answers ("reason for
  // calling") on the customer card is how a field registry rots.
  // Only the sees section offers this: a static value injected into every
  // call. (A capture row must land somewhere, so "just for this call" is not
  // offered where answers are collected.)
  const addCallOnly = (label: string) => {
    setDraft((rows) => [
      ...rows,
      {
        ...blankVariable(),
        label,
        key: keyFromLabel(label),
        duringMode: "none",
        afterCall: false,
        beforeSource: "static",
      },
    ]);
    setFocusLast(true);
  };

  // Picking a built-in ("Customer name") builds the row quick-add used to:
  // prefilled from that context, asked only when the business doesn't know it.
  //
  // A capturing name or email row defaults to writing the customer's own
  // column, because there is no other honest reading of "ask the caller their
  // name". It used to default to call-only, which is how a first-time caller
  // ended up as a record with a phone number and no name on it.

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

  const relinkRowToBuiltin = (index: number, builtin: PickerBuiltin) => {
    const customerField = customerFieldOf(builtin.key);
    const row = draft[index];
    const captures = row.duringMode !== "none" || row.afterCall;
    patch(index, {
      label: builtin.label,
      key: builtin.key,
      beforeSource: builtin.source,
      beforeFieldId: undefined,
      contactFieldId: undefined,
      ...(customerField && captures
        ? { destination: "customer" as const, customerField, type: "string" as const }
        : { destination: "call" as const, customerField: undefined }),
    });
  };

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
      const field: VoiceContactField = { id, key, label, type: "text", options: [], voice: true, voiceDescription: "", voiceConfirm: false, voiceVisible: false };
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
      setStatus(t("voiceVariables.published", { n: result.version ?? "" }));
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

  // Which group a row lives in. A Resepta variable is a LIFECYCLE, not a
  // single moment — one row can be seeded before the call, asked during it and
  // recovered from the analysis after. So the group is its most active phase,
  const isContext = isContextRow;

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

  const availableFields = voiceFields.filter(
    (field) => !draft.some((row) => row.contactFieldId === field.id || row.key === field.key),
  );
  // What the pickers offer. "Service list" stays out: it is injected context
  // with no before-source, not a value a row can hold.
  //
  // A capture row's value must land somewhere. Phone, language and business
  // name have no writable column — phone identifies the caller, language and
  // business name belong to the org — so they are never offered as questions;
  // offering "Customer phone" was how a row got created that could never say
  // where its answer went. What is offered is the built-ins that land on a
  // customer column, since asking for a first name is a real question. The
  // sees section offers no built-ins at all: everything they carry is already
  // on the always-sent rows, and adopting one there minted an editable clone
  // of a fact set elsewhere.

  // A row's own picker also lists what the row currently is, so the menu
  // always contains the current selection.
  const rowPickerFields = (row: VoiceVariable): VoiceContactField[] => {
    const own = row.contactFieldId ? fieldById.get(row.contactFieldId) : undefined;
    return own ? [own, ...availableFields] : availableFields;
  };
  // A row linked to a select field edits THAT field's options — one registry,
  // same as the Business card — instead of a private copy.
  const linkedSelectFor = (row: VoiceVariable): VoiceContactField | undefined => {
    const field = row.contactFieldId ? fieldById.get(row.contactFieldId) : undefined;
    return field?.type === "select" ? field : undefined;
  };

  const rowPickerBuiltins = (row: VoiceVariable): PickerBuiltin[] => {
    const own = builtinVoiceVariables(t).find(
      (builtin) => builtin.key === row.key && builtin.key !== "services",
    );
    return own
      ? [{ key: own.key, label: own.label, source: own.key as PickerBuiltin["source"] }]
      : [];
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h4 className="text-sm font-semibold">{t("voiceVariables.title")}</h4>
          {/* The "handed automatically" sentence rides here, not as a
              standalone paragraph over the table — explanatory copy hides
              behind the (i) (Serdar: "this should be behind (i) ... not
              standalone text again"). */}
          <InfoTip
            text={`${managed ? t("voiceVariables.hint") : t("voiceVariables.importedHint")} ${t("voiceVariables.seesHint")} ${t("voiceVariables.builtinHint")}`}
          />
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

      {/* The grid's tracks need their width; on a narrow screen the SECTION
          scrolls sideways rather than each row folding into a different
          shape — Nudge's finding, kept. Popovers are portaled to the body,
          so the overflow container cannot clip them. */}
      <div className="overflow-x-auto">
      <div className="min-w-[38rem] space-y-4">
        {/* ONE MATRIX (Serdar's sketch: "name | type | description | agent
            can see | agent fills in"). The two sections it replaces had
            already collapsed three phase headings into two questions; this
            collapses the two questions into two switch columns on one row
            per field, which is where it was always heading — the config IS
            the Contact fields table, so it should read as a table.

            Sees and fills are not independent: fills implies sees (the
            stored value is injected so a repeat caller is not re-asked), so
            the sees switch renders checked and disabled while fills is on.
            Sees WITHOUT fills is the one new state: a staff-curated field
            the agent can read back but never asks about (voiceVisible; read
            at ring time, so it needs no publish).

            During-vs-post is deliberately NOT a third column. Post-call
            extraction only fills what the mid-call ask missed — one
            behaviour with a retry, not two decisions. */}
        <div className={`${MATRIX_GRID} mb-1 px-0 text-[10px] font-medium text-[var(--muted)]`}>
          <span className="px-2">{t("voiceVariables.label")}</span>
          <span className="px-2">{t("voiceVariables.type")}</span>
          <span className="px-2">{t("voiceVariables.description")}</span>
          <span className="text-right">{t("voiceVariables.colAgent")}</span>
        </div>
        <div className="space-y-1.5">
          {IDENTITY_CAPTURE.map((column) => (
            <MatrixRow
              key={column.lock}
              label={t(column.labelKey)}
              typeLabel={t("voiceVariables.text")}
              description={identityDescriptionsLive[column.lock] ?? t(column.descKey)}
              editableDescription
              on={!identityLocksLive.includes(column.lock)}
              onToggle={(next) =>
                next ? unlockIdentity(column.lock) : lockIdentity(column.lock)
              }
              onDescription={(text) => {
                void setIdentityDescription({ key: column.lock, text });
                touchFields();
              }}
            />
          ))}
          {allFields.map((field) => (
            <MatrixRow
              key={field.id}
              label={field.label}
              typeLabel={
                t(
                  field.type === "select"
                    ? "fields.type.select"
                    : field.type === "number"
                      ? "fields.type.number"
                      : field.type === "date"
                        ? "fields.type.date"
                        : "fields.type.text",
                ) +
                (field.type === "select" && field.options.length > 0
                  ? ` · ${field.options.length}`
                  : "")
              }
              description={field.voiceDescription}
              editableDescription={field.voice}
              options={field.type === "select" ? field.options : null}
              onOptions={(next) => {
                void updateContactField({
                  fieldId: field.id as Id<"contactFields">,
                  options: next,
                });
                setCreatedFields((rows) =>
                  rows.map((row) =>
                    row.id === field.id ? { ...row, options: next } : row,
                  ),
                );
                touchFields();
              }}
              on={field.voice}
              onToggle={(next) =>
                next ? enableFieldVoice(field) : disableFieldVoice(field)
              }
              onDescription={(text) => {
                void updateContactField({
                  fieldId: field.id as Id<"contactFields">,
                  voiceDescription: text,
                });
                setCreatedFields((rows) =>
                  rows.map((row) =>
                    row.id === field.id ? { ...row, voiceDescription: text } : row,
                  ),
                );
                touchFields();
              }}
            />
          ))}
          <VariablePicker
            addLabel={t("fields.add")}
            fields={[]}
            builtins={[]}
            onField={() => undefined}
            onBuiltin={() => undefined}
            onCreate={(label) => void createVoiceField(label)}
            onCallOnly={(label) => addCallOnly(label)}
            allowCallOnly={false}
          />
        </div>

        {/* Legacy static/context rows, HEADINGLESS and with no add link. The
            block wore a "What the agent sees" heading plus "+ Add default"
            and Serdar flagged it on sight ("why do i have this additional
            field below again"). A static default is a fixed value injected
            into the prompt — which is just prompt text with extra steps, so
            the way to add one is to write it in the prompt. Existing rows
            keep rendering so nothing published disappears silently, and the
            ✕ retires them. When the org has none, nothing renders — no empty
            frame. */}
        {draft.filter((row) => isContext(row)).length > 0 && (
          <div className="mt-4">
            <div className="space-y-1.5">
              {draft
                .map((row, index) => ({ row, index }))
                .filter(({ row }) => isContext(row))
                .map(({ row, index }) => {
                  return (
                    <VariableRow
                      key={index}
                      row={row}
                      displayLabel={
                        (row.contactFieldId
                          ? fieldById.get(row.contactFieldId)?.label
                          : undefined) ?? row.label
                      }
                      fields={voiceFields}
                      pickerFields={rowPickerFields(row)}
                      pickerBuiltins={rowPickerBuiltins(row)}
                      linkedSelect={linkedSelectFor(row)}
                      onSetFieldOptions={(options) => {
                        if (row.contactFieldId)
                          void updateContactField({
                            fieldId: row.contactFieldId as Id<"contactFields">,
                            options,
                          });
                      }}
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
                      allowCallOnly={row.duringMode === "none" && !row.afterCall}
                      onFocused={() => setFocusLast(false)}
                      onChange={(next) => patch(index, next)}
                      onRemove={() => removeAt(index)}
                    />
                  );
                })}
            </div>
          </div>
        )}

        {/* No foot row. Nudge pins its analysis presets here (call_summary,
            call_successful), and the port kept them — but the owner's read
            was "what's that for", twice, and a row whose reason lives in a
            tooltip is a row that failed. The summary and outcome still
            arrive on every call; the call card is where they already
            explain themselves. */}
      </div>
      </div>

      {confirmRemove !== null && (() => {
        const removingLabel =
          draft[confirmRemove]?.label || draft[confirmRemove]?.key || "";
        return (
        <Sheet
          // Substituted, not printed. The string carries {name} and both the
          // title and the button below used it raw, so the dialog asked the
          // reader to "Remove {name}" while the sentence between them named
          // the actual variable.
          title={t("voiceVariables.remove", { name: removingLabel })}
          onClose={() => setConfirmRemove(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted)]">
              {t("voiceVariables.removeBody", { name: removingLabel })}
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
                // Ghost + red text, no border. Same rule as the test button in
                // VoiceAgentPage: the border belongs to the Sheet around this,
                // not to the control inside it.
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-[var(--muted-bg)]"
              >
                {t("voiceVariables.remove", { name: removingLabel })}
              </button>
            </div>
          </div>
        </Sheet>
        );
      })()}
    </div>
  );
}

// A variable that Resepta knows about, offered by the picker. Built-ins map
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
// A select's type cell: reads "Select · n", opens its options in place. The
// same one-registry rule as everything else on the matrix — these are the
// FIELD's options, shared with the Business price list's editor and with the
// booking page, and the published enum rebuilds from them on the next
// publish.
function SelectOptionsCell({
  typeLabel,
  options,
  onSave,
}: {
  typeLabel: string;
  options: string[];
  onSave: (next: string[]) => void;
}) {
  const { t } = useLanguage();
  const { triggerRef, panelRef, pos, open, toggle, close } = useAnchoredPanel(240, 300, "left");
  const [rows, setRows] = useState<string[]>(options);
  useEffect(() => setRows(options), [options]);
  const commit = () => {
    const next = [...new Set(rows.map((row) => row.trim()).filter(Boolean))];
    if (JSON.stringify(next) !== JSON.stringify(options)) onSave(next);
    close();
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? commit() : toggle())}
        className="rounded text-xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
      >
        {typeLabel} ▾
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
            className="fixed z-50 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-lg"
          >
            <div className="space-y-1">
              {rows.map((choice, index) => (
                <div key={index} className="flex items-center gap-1">
                  <input
                    value={choice}
                    autoFocus={choice === "" && index === rows.length - 1}
                    onChange={(e) =>
                      setRows(rows.map((c, j) => (j === index ? e.target.value : c)))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commit();
                      }
                    }}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setRows(rows.filter((_, j) => j !== index))}
                    aria-label={t("common.delete")}
                    className="shrink-0 rounded p-1 text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    <RemoveX />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRows([...rows, ""])}
              className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-[var(--accent)] hover:bg-[var(--muted-bg)]"
            >
              + {t("voiceVariables.choice")}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}


// One row of the matrix: label · type · instruction · ONE switch. It briefly
// carried two switch columns (sees / fills) plus a confirm chip, and Serdar
// dismantled each on contact with reality: the implied-sees check read as
// "not seen" ("you need to understand i'm human — if i see born in as not
// toggled i assume it's not being seen"), the two columns collapsed ("if we
// can see something we can fill in too"), and the confirm chip was "absolutely
// stupid... confusing". On = the agent knows the field and fills it. Off = it
// does not. Two visual states, nothing else to decode.
// Old note, for the record: identity columns and org fields share it: label,
// type, the extractor's instruction, then the two switches. Every control
// writes the FIELD (or the identity lock) — no draft, no publish of its own,
// no way to disagree with the Contact fields table.
//
// The description drafts locally and commits on blur, the same discipline as
// every autosaving text input here: typing must not fight the round-trip.
function MatrixRow({
  label,
  typeLabel,
  description,
  options,
  onOptions,
  editableDescription,
  on,
  onToggle,
  onDescription,
}: {
  label: string;
  typeLabel: string;
  description: string;
  options?: string[] | null;
  onOptions?: (next: string[]) => void;
  editableDescription: boolean;
  on: boolean;
  onToggle: (next: boolean) => void;
  onDescription?: (text: string) => void;
}) {
  const { t } = useLanguage();
  const [text, setText] = useState(description);
  useEffect(() => setText(description), [description]);
  return (
    <div className={`${MATRIX_GRID} group`}>
      <span
        className={`block min-w-0 truncate px-2 py-1 text-xs ${
          on ? "text-[var(--foreground)]" : "text-[var(--muted)]"
        }`}
      >
        {label}
      </span>
      <span className="flex flex-col items-start px-2 py-1">
        {options && onOptions ? (
          <SelectOptionsCell typeLabel={typeLabel} options={options} onSave={onOptions} />
        ) : (
          <span className="text-xs text-[var(--muted)]">{typeLabel}</span>
        )}
      </span>
      {on && editableDescription && onDescription ? (
        <AutoGrowTextarea
          value={text}
          rows={1}
          placeholder={t("voiceVariables.description")}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            if (text.trim() !== description) onDescription(text.trim());
          }}
          className={CELL_CLASS}
        />
      ) : (
        <span className="truncate px-2 py-1 text-xs text-[var(--muted)]">
          {on ? description : ""}
        </span>
      )}
      <span className="flex justify-end pt-0.5">
        <CheckSwitch on={on} onChange={onToggle} label={label} />
      </span>
    </div>
  );
}

function VariablePicker({
  current,
  title,
  addLabel,
  fields,
  builtins,
  onField,
  onBuiltin,
  onCreate,
  onCallOnly,
  allowCallOnly,
}: {
  // undefined renders the "+ Add variable" link; a string renders a row's
  // name cell (empty string = unnamed row).
  current?: string;
  // The human label behind a key shown mono — tooltip only, so the cell
  // itself stays exactly what the prompt speaks.
  title?: string;
  // The add-link's text. The before group says "+ Add default" (Nudge's
  // word for pre-call context), the capture groups say "+ Add variable".
  addLabel?: string;
  fields: VoiceContactField[];
  builtins: PickerBuiltin[];
  onField: (field: VoiceContactField) => void;
  onBuiltin: (builtin: PickerBuiltin) => void;
  onCreate: (label: string) => void;
  onCallOnly: (label: string) => void;
  // False on anything that captures an answer: "just for this call" is a
  // valid home for context, not for something the caller said.
  allowCallOnly: boolean;
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
        // The name cell reads like Nudge's: monospace key, chromeless until
        // hover says it is clickable. The caret only shows on hover for the
        // same reason the border does — at rest the table is text.
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          title={title}
          className={`${CELL_CLASS} flex items-center justify-between gap-1 text-left font-mono`}
        >
          <span className={`truncate ${current ? "" : "text-[var(--muted)]"}`}>
            {current || t("voiceVariables.label")}
          </span>
          <span
            aria-hidden
            className="shrink-0 text-[10px] text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100"
          >
            ▾
          </span>
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          className="mt-1.5 rounded-md border border-transparent px-2 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--muted-bg)]"
        >
          {addLabel ?? t("voiceVariables.addRow")}
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
                + {t("voiceVariables.pickerCreate", { name: trimmed })}
              </button>
            )}
            {trimmed && allowCallOnly && (
              <button
                type="button"
                onClick={() => pick(() => onCallOnly(trimmed))}
                className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)]"
              >
                {t("voiceVariables.pickerCallOnly", { name: trimmed })}
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
  linkedSelect,
  onSetFieldOptions,
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
  allowCallOnly,
}: {
  row: VoiceVariable;
  displayLabel: string;
  fields: VoiceContactField[];
  pickerFields: VoiceContactField[];
  pickerBuiltins: PickerBuiltin[];
  linkedSelect: VoiceContactField | undefined;
  onSetFieldOptions: (options: string[]) => void;
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
  allowCallOnly: boolean;
}) {
  const { t } = useLanguage();
  const { triggerRef, panelRef, pos, open, toggle } = useAnchoredPanel(300, 420, "right");

  // Raw for editing — a just-added empty choice must survive its own render —
  // filtered only for the count the trigger shows. A linked select's options
  // live on the customer field (the same registry the Business card edits);
  // the row's copy mirrors them for the draft.
  const rawChoices = linkedSelect ? linkedSelect.options : row.choices ?? [];
  const setChoices = (next: string[]) => {
    if (linkedSelect) onSetFieldOptions(next);
    onChange({ choices: next });
  };
  const optionValues = rawChoices.filter((choice) => choice.trim());
  const typeLabel =
    row.type === "enum"
      ? `${t("voiceVariables.options")} · ${optionValues.length}`
      : row.type === "number"
        ? t("voiceVariables.number")
        : row.type === "boolean"
          ? t("voiceVariables.yesNo")
          : t("voiceVariables.text");

  return (
    <div className={VAR_GRID}>
      {/* The name is a selection, not free text. Clicking it re-points the
          row at another customer field, a built-in, a newly created field or
          a call-only name — identity always moves as one piece. Shown as the
          KEY, monospace, exactly what the prompt and the analysis speak; the
          human label rides in the tooltip and in the picker's own list. */}
      <VariablePicker
        current={row.key || displayLabel}
        title={displayLabel}
        fields={pickerFields}
        builtins={pickerBuiltins}
        onField={onPickField}
        onBuiltin={onPickBuiltin}
        onCreate={onCreateField}
        onCallOnly={onRename}
        allowCallOnly={allowCallOnly}
      />
      {/* Boxed while the text cells beside it go chromeless: a picker is a
          control you are going to click, so it has to look clickable; a name
          or a description is text you mostly read. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
      >
        <span className="truncate">{typeLabel}</span>
        <span aria-hidden className="text-[10px]">▾</span>
      </button>
      <AutoGrowTextarea
        value={row.description}
        onChange={(e) => onChange({ description: e.target.value })}
        // Rows arrive named from the picker; the description is what's left.
        autoFocus={autoFocus}
        onFocus={onFocused}
        placeholder={t("voiceVariables.description")}
        className={CELL_CLASS}
      />
      {/* Hover-only from sm up; always visible below sm, where there is no
          hover to reveal it. Opacity rather than hidden so the track keeps
          its width and the row cannot shift under the pointer. */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("voiceVariables.remove", { name: displayLabel })}
        className="mt-1 justify-self-end rounded p-1 text-[var(--muted)] opacity-100 transition-opacity hover:text-[var(--foreground)] focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
      >
        <RemoveX />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
            className="fixed z-50 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-lg"
          >
            {/* Nudge's TypePicker, structure and reasoning both: the type is
                a LIST you pick from, not a <select> the OS paints its own
                way; a list's choices are managed right here rather than in a
                separate editor; and the capture PHASE is not asked — the
                group a row sits under states it, and each group has its own
                add link. Moving a row between groups is delete-and-re-add,
                the cost Nudge accepted for the same clarity. */}
            {/* One row, four segments (Serdar's call): the type is a small
                closed choice and a vertical list gave it a column's worth of
                gravity. Selected segment wears the card surface. */}
            <div className="grid grid-cols-4 gap-0.5 rounded-md bg-[var(--muted-bg)] p-0.5">
              {(
                [
                  ["string", t("voiceVariables.text")],
                  ["number", t("voiceVariables.number")],
                  ["boolean", t("voiceVariables.yesNo")],
                  ["enum", t("voiceVariables.options")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="option"
                  aria-selected={row.type === value}
                  onClick={() => onChange({ type: value })}
                  className={`truncate rounded px-1.5 py-1 text-center text-[11px] transition-colors ${
                    row.type === value
                      ? "bg-[var(--card)] font-medium shadow-sm"
                      : "text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Confirm-first is the one thing the group cannot express: a
                variant of during-call capture, not a phase of its own. */}
            {supportsLive && row.duringMode !== "none" && (
              <div className="mt-1 border-t border-[var(--border)] pt-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={row.duringMode === "confirm"}
                  onClick={() =>
                    onChange({
                      duringMode: row.duringMode === "confirm" ? "if_missing" : "confirm",
                    })
                  }
                  className={`block w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--muted-bg)] ${
                    row.duringMode === "confirm"
                      ? "bg-[var(--muted-bg)] font-medium"
                      : "text-[var(--muted)]"
                  }`}
                >
                  {row.duringMode === "confirm" ? "✓ " : ""}
                  {t("voiceVariables.confirm")}
                </button>
              </div>
            )}

            {row.type === "enum" && (
              <div className="mt-1 border-t border-[var(--border)] pt-1">
                <div className="px-2 py-1 text-[11px] font-medium text-[var(--muted)]">
                  {t("voiceVariables.options")}
                </div>
                <div className="space-y-1 px-1">
                  {rawChoices.map((choice, index) => (
                    <div key={index} className="flex items-center gap-1">
                      <input
                        value={choice}
                        autoFocus={choice === "" && index === rawChoices.length - 1}
                        onChange={(e) =>
                          setChoices(
                            rawChoices.map((c, j) => (j === index ? e.target.value : c)),
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            setChoices([...rawChoices, ""]);
                          }
                        }}
                        placeholder={t("voiceVariables.choice")}
                        className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setChoices(rawChoices.filter((_, j) => j !== index))
                        }
                        aria-label={t("voiceVariables.removeChoice")}
                        className="rounded p-1 text-[var(--muted)] hover:text-[var(--foreground)]"
                      >
                        <RemoveX />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setChoices([...rawChoices, ""])}
                  className="mt-1 px-2 py-1 text-xs text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--foreground)]"
                >
                  {t("voiceVariables.addChoice")}
                </button>
              </div>
            )}

            {/* A context row (Before the call group) captures nothing, so
                the capture facts — where to pre-fill from, where the answer
                lands, whether it is required — are questions with no
                referent there (Serdar: "what do you mean saved to call
                only?!"). Its popover carries only the static value when the
                row is a typed default. */}
            {(!allowCallOnly || row.beforeSource === "static") && (
            <div className="mt-1 space-y-2 border-t border-[var(--border)] px-0.5 pb-1 pt-2">
            {!allowCallOnly && (
            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="shrink-0 font-medium">
                {t("voiceVariables.source")}
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
                <option value="customer_first_name">{t("customers.firstName")}</option>
                <option value="customer_last_name">{t("customers.lastName")}</option>
                <option value="customer_phone">{t("voiceVariables.customerPhone")}</option>
                <option value="customer_email">{t("voiceVariables.customerEmail")}</option>
                <option value="customer_language">{t("voiceVariables.customerLanguage")}</option>
                <option value="next_appointment">{t("voiceVariables.nextAppointment")}</option>
                {fields.map((field) => (
                  <option key={field.id} value={`field:${field.id}`}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>
            )}

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

            {!allowCallOnly && (
            <>
            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="shrink-0 font-medium">
                {t("voiceVariables.savedTo")}
              </span>
              <select
                value={
                  row.destination === "customer" && row.customerField
                    ? `customer:${row.customerField}`
                    : row.destination === "contact" && row.contactFieldId
                      ? `field:${row.contactFieldId}`
                      : "call"
                }
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "new") {
                    onLinkCustomer();
                    return;
                  }
                  if (value.startsWith("customer:")) {
                    // Forced to text: a name is not one of four options, and
                    // the publish validator refuses the pairing anyway. Doing
                    // it here beats a save that fails on a rule the person
                    // cannot see from this row.
                    onChange({
                      destination: "customer",
                      customerField: value.slice(9) as "firstName" | "lastName" | "email",
                      contactFieldId: undefined,
                      type: "string",
                    });
                    return;
                  }
                  onChange(
                    value === "call"
                      ? { destination: "call", contactFieldId: undefined, customerField: undefined }
                      : {
                          destination: "contact",
                          contactFieldId: value.slice(6),
                          customerField: undefined,
                        },
                  );
                }}
                className="w-40 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
              >
                {/* An answer must land somewhere. "Call only" survives solely
                    for rows that capture nothing (pre-call context), and a
                    legacy capture row still pointing at "call" sees a
                    disabled "choose where to save" it cannot re-pick —
                    visible debt, not an offer. */}
                {row.duringMode === "none" && !row.afterCall ? (
                  <option value="call">{t("voiceVariables.callOnly")}</option>
                ) : (
                  row.destination === "call" && (
                    <option value="call" disabled>
                      {t("voiceVariables.choosePlace")}
                    </option>
                  )
                )}
                {/* The customer's own columns, named exactly as Business →
                    Fields names them. Offered on every row, not just the
                    built-in ones: plenty of agents call it caller_name, and
                    the label says where the value lands either way. */}
                <option value="customer:firstName">{t("customers.firstName")}</option>
                <option value="customer:lastName">{t("customers.lastName")}</option>
                <option value="customer:email">{t("customers.email")}</option>
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
            </>
            )}

            </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
