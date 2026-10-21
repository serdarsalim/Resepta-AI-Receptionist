"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { VoicePicker } from "./VoicePicker";
import { InfoTip } from "./InfoTip";
import { useConfirm } from "./ConfirmDialog";
import { buttonClass, fieldClass } from "./Control";
import { EditorSaveBar } from "./EditorSaveBar";
import { AgentVersionHistory } from "./AgentVersionHistory";
import { AgentBrowserTest } from "./AgentBrowserTest";
import { AGENT_PANE_CARD } from "./AgentTestsLog";
import { PromptEditor } from "./PromptEditor";
import { Toggle } from "./Toggle";
import { useHeaderTrail } from "@/lib/headerTrail";
import { usesOpener, type AgentOpeners } from "../../convex/lib/opener";
import {
  VoiceVariablesEditor,
  builtinVoiceVariables,
  injectedVoiceContext,
  type VoiceContactField,
  type VoiceEditorSaveState,
  type VoiceVariable,
} from "./VoiceVariablesEditor";

// Everything about one voice agent that couples to this salon's data: the
// prompt it speaks from, the variables it uses before/during/after a call,
// whether its webhook actually reaches us, and a way to hear it.
//
// Voice, latency and interruption stay in Retell — those are audio engineering
// and nobody edits them because a customer said something. The prompt is the
// opposite: it changes weekly, and walking to another product to change one
// sentence is the friction this removes.
//
// A PAGE, not a sheet. It was a centred modal with the prompt, the variables
// grid and a test-call box crammed into a 55vh scroller, so the prompt — the
// thing people actually come here to edit — got about eight visible lines and
// its Save button lived below two folds. On a page the prompt gets room, and
// Save moves to the header where it is reachable from any scroll position.
//
// ONE COLUMN, no tabs: instructions → opening line → voice → variables. That
// is the order a call happens in, and it is the whole agent on one screen. It
// was briefly two tabs, which made the first screen a lone giant textarea over
// dead space and hid the variables behind a pill nobody clicked — a page that
// looks empty reads as a page that isn't finished.
//
// One Publish covers everything, and it is ONE provider version (P7 of the
// Nudge port, 2026-10-17): the prompt, the opening line, the voice, the
// variables and the voicemail answer go to publishAgent together, land on the
// agent's draft and go live with a note naming what changed. It used to be two
// publishes, variables then prompt, which doubled the history and briefly let
// a caller hear one half without the other. The version number beside the
// prompt's heading opens the history, and Restore loads an older version's
// words back here as unsaved edits.
//
// Unsaved work SURVIVES leaving. There was a leave-guard dialog here that
// threw the draft away on confirm, which is the wrong trade: a half-written
// prompt is real work, and losing it to a mis-click is worse than the thing
// the guard protected against. The amber Unsaved mark was already doing that
// job — nothing on this page can be mistaken for live while it is showing.

type Detail = {
  agentId: string;
  name: string;
  version: number | null;
  // The latest version is an unpublished draft at the provider.
  isDraft: boolean;
  // What callers hear; equals `version` unless a draft sits above it.
  liveVersion: number | null;
  voicemail: Voicemail;
  voiceId: string | null;
  voices: {
    id: string;
    name: string;
    gender: string;
    accent: string;
    previewUrl: string | null;
  }[];
  language: string | null;
  engineType: string | null;
  llmId: string | null;
  lines: { number: string; nickname: string; agentId: string | null }[];
  inboundNumber: string | null;
  prompt: { general: string; beginMessage: string } | null;
  personaName: string | null;
  openers: AgentOpeners | null;
  canEndCall: boolean;
  webhook: {
    expected: string | null;
    actual: string | null;
    wired: boolean;
    pointsElsewhere: boolean;
  };
  signatureRejectedAt: number | null;
  template: { synced: number | null; current: number; behind: boolean };
  variableConfig: {
    managed: boolean;
    items: VoiceVariable[];
  };
  contactFields: VoiceContactField[];
  voiceLockedIdentity?: string[];
  voiceIdentityDescriptions?: Partial<Record<"firstname" | "lastname" | "email", string>>;
};

type Voicemail = {
  action: "off" | "hangup" | "static_text" | "prompt";
  text?: string;
};

const VOICEMAIL_OPTIONS: { value: Voicemail["action"]; key: TranslationKey }[] = [
  { value: "hangup", key: "voiceDetail.voicemailHangup" },
  { value: "static_text", key: "voiceDetail.voicemailStatic" },
  { value: "prompt", key: "voiceDetail.voicemailPrompt" },
  { value: "off", key: "voiceDetail.voicemailOff" },
];

const leavesMessage = (vm: Voicemail) =>
  vm.action === "static_text" || vm.action === "prompt";

const sameVoicemail = (a: Voicemail, b: Voicemail) =>
  a.action === b.action && (!leavesMessage(a) || (a.text ?? "") === (b.text ?? ""));

// The unsaved draft, per agent, on this browser. Deliberately NOT on the
// server: an unpublished prompt is one person's thinking-in-progress, and
// syncing it would mean a colleague opening the agent and finding text nobody
// decided to ship yet.
type StoredDraft = {
  prompt?: string;
  begin?: string;
  voice?: string;
  persona?: string;
  openers?: Openers;
  voicemail?: Voicemail;
  rows?: VoiceVariable[];
};

// The four first sentences as the page edits them (P34, lib/opener): every
// one a string, so a field never flips between controlled and not.
type Openers = Required<AgentOpeners>;
const OPENER_FIELDS = ["cold", "followUp", "missed", "inbound"] as const;
const OPENER_LABELS: Record<
  (typeof OPENER_FIELDS)[number],
  { label: TranslationKey; hint: TranslationKey }
> = {
  cold: { label: "voiceDetail.openerCold", hint: "voiceDetail.openerColdHint" },
  followUp: { label: "voiceDetail.openerFollowUp", hint: "voiceDetail.openerFollowUpHint" },
  missed: { label: "voiceDetail.openerMissed", hint: "voiceDetail.openerMissedHint" },
  inbound: { label: "voiceDetail.openerInbound", hint: "voiceDetail.openerInboundHint" },
};
const openersOf = (stored: AgentOpeners | null | undefined): Openers => ({
  cold: stored?.cold ?? "",
  followUp: stored?.followUp ?? "",
  missed: stored?.missed ?? "",
  inbound: stored?.inbound ?? "",
});
const sameOpeners = (a: Openers, b: Openers) =>
  OPENER_FIELDS.every((key) => a[key].trim() === b[key].trim());

// The page's two tabs (P35). The parameter is exported so the list clears it
// when it closes an agent.
type AgentTab = "setup" | "testing";
export const AGENT_TAB_PARAM = "agentTab";
const AGENT_TABS: { id: AgentTab; label: TranslationKey }[] = [
  { id: "setup", label: "voiceDetail.tabSetup" },
  { id: "testing", label: "voiceDetail.tabTesting" },
];

const draftKey = (agentId: string) => `randevu.agentDraft.${agentId}`;

function readDraft(agentId: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(agentId));
    return raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    // Corrupt or unavailable storage must not take the editor down with it.
    return null;
  }
}

function writeDraft(agentId: string, draft: StoredDraft) {
  try {
    window.localStorage.setItem(draftKey(agentId), JSON.stringify(draft));
  } catch {
    // Private mode, or the quota. The editor still works, it just forgets.
  }
}

function clearDraft(agentId: string) {
  try {
    window.localStorage.removeItem(draftKey(agentId));
  } catch {
    // Nothing to do — the draft was never the source of truth.
  }
}

// Opening an editor refuses for four reasons that are ABOUT something, and
// every one of them used to arrive as "could not be updated, please try
// again" — a message that names no cause and asks for a retry that cannot
// work. no-such-agent is the one seen in production (Serdar, 2026-08-26):
// the agent has no row under the business being acted as, so retrying it
// forever was the only path the UI offered.
//
// Substring match, not equality: retellAgent.editorContext throws prose for
// three of these, and requireOwner's code arrives wrapped in Convex's own
// "Uncaught Error:" framing. Anything unmatched keeps the generic message,
// which is still the right words for a provider having a bad minute.
const LOAD_ERRORS: [string, TranslationKey][] = [
  ["no-such-agent", "settings.voiceAgentMissing"],
  ["demo workspace", "settings.voiceDemoWorkspace"],
  ["No Retell API key", "settings.voiceNoKey"],
  ["owner-only", "settings.voiceOwnerOnly"],
];

function loadErrorKey(error: unknown): TranslationKey {
  const raw = error instanceof Error ? error.message : String(error);
  return (
    LOAD_ERRORS.find(([code]) => raw.includes(code))?.[1] ??
    "settings.voiceActionFailed"
  );
}

export function VoiceAgentPage({
  agentId,
  onBack,
}: {
  agentId: string;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const read = useAction(api.retellAgent.read);
  const publishAgent = useAction(api.retellAgent.publishAgent);
  const publishDraft = useAction(api.retellAgent.publishDraft);
  const discardDraft = useAction(api.retellAgent.discardDraft);
  const listVersions = useAction(api.retellAgent.listVersions);
  const readVersion = useAction(api.retellAgent.readVersion);
  const wireWebhook = useAction(api.retellAgent.wireWebhook);
  const syncTemplate = useAction(api.retellAgent.syncTemplate);
  const setAgentPersona = useMutation(api.retell.setAgentPersona);
  const setAgentOpeners = useMutation(api.retell.setAgentOpeners);
  const setEndCallEnabled = useAction(api.retellAgent.setEndCallEnabled);
  const attachLine = useAction(api.retellAgent.attachLine);
  const renameAgent = useAction(api.retellAgent.renameAgent);
  // null = not editing. The title IS the rename control: a name is identity,
  // and identity edits belong on the thing itself (Serdar asked for the
  // click-the-title edit twice in one evening).
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // Deleting lives HERE, at the foot of the editor, not as an × on the list
  // row — a destructive control needs the context of what it destroys
  // (Serdar, 2026-08-18; the table's Disconnect icon moved in). It is the
  // same disconnect as ever: the link goes, the provider agent survives.
  const disconnect = useMutation(api.retell.disconnect);
  const connectedRows = useQuery(api.retell.list, {});
  const connectedRow = connectedRows?.find((row) => row.retellAgentId === agentId);
  const [confirmDelete, confirmDeleteDialog] = useConfirm();

  const [detail, setDetail] = useState<Detail | null>(null);
  // The title bar names the agent and leads back to the list (P25): this page
  // draws no back button of its own.
  useHeaderTrail({ title: detail?.name ?? t("settings.voiceAgent"), back: onBack });
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [begin, setBegin] = useState("");
  const [persona, setPersona] = useState("");
  const [openers, setOpeners] = useState<Openers>(openersOf(null));
  const [voice, setVoice] = useState("");
  const [voicemail, setVoicemail] = useState<Voicemail>({ action: "hangup" });
  // Only one preview plays at a time — clicking down the list otherwise leaves
  // four voices talking over each other.
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // A note that belongs beside unsaved edits (a restored version, a message
  // that still needs its words). `status` hides while the page is dirty,
  // because "Published v5" beside Unsaved would be stale.
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Setup or Testing (P35, Nudge 71c43cf). Both panes stay MOUNTED and the
  // idle one is only hidden: the editor holds the edits a test stages, and a
  // call in progress must survive a look at the prompt. The tab rides the URL
  // beside ?agent= (Nudge d56fd95), so a reload comes back to it; read after
  // mount for the same hydration reason VoiceView reads ?agent=.
  const [tab, setTab] = useState<AgentTab>("setup");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get(AGENT_TAB_PARAM) === "testing") {
      setTab("testing");
    }
  }, []);
  const chooseTab = (next: AgentTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "testing") url.searchParams.set(AGENT_TAB_PARAM, "testing");
    else url.searchParams.delete(AGENT_TAB_PARAM);
    window.history.replaceState(null, "", url);
  };
  // The line dropdown writes straight to the provider — no Save, because it
  // isn't part of the draft the prompt and variables share. It gets its own
  // in-flight and failed states, and the reload restores the real binding if
  // the provider refuses.
  const [assigning, setAssigning] = useState(false);
  const [lineError, setLineError] = useState(false);
  // Mirrored out of the variables editor so the header can save it too.
  const [varsState, setVarsState] = useState<VoiceEditorSaveState | null>(null);
  // Rows recovered from a stored draft, handed to the editor as its seed.
  const [seed, setSeed] = useState<VoiceVariable[] | null>(null);
  // Until the first read lands there is nothing to compare a draft against,
  // and writing one would persist empty strings over real work.
  const [restored, setRestored] = useState(false);

  const load = useCallback(() => {
    setError(null);
    void read({ agentId })
      .then((d) => {
        const detail = d as Detail;
        setDetail(detail);
        setDraft(detail.prompt?.general ?? "");
        setBegin(detail.prompt?.beginMessage ?? "");
        setVoice(detail.voiceId ?? "");
        setVoicemail(detail.voicemail);
        setPersona(detail.personaName ?? "");
        setOpeners(openersOf(detail.openers));
        // A draft left behind on this browser wins over what the server says,
        // because it is the newer intent. The amber Unsaved mark keeps it honest
        // about not being live.
        const stored = readDraft(agentId);
        if (stored) {
          if (stored.prompt !== undefined) setDraft(stored.prompt);
          if (stored.begin !== undefined) setBegin(stored.begin);
          if (stored.voice !== undefined) setVoice(stored.voice);
          if (stored.persona !== undefined) setPersona(stored.persona);
          if (stored.openers !== undefined) setOpeners(openersOf(stored.openers));
          if (stored.voicemail !== undefined) setVoicemail(stored.voicemail);
          setSeed(stored.rows ?? null);
        }
        setRestored(true);
      })
      .catch((err) => setError(t(loadErrorKey(err))));
  }, [read, agentId, t]);

  useEffect(() => load(), [load]);

  // Stop a preview that is still talking when the page goes away.
  useEffect(
    () => () => {
      previewRef.current?.pause();
      previewRef.current = null;
    },
    [],
  );

  // useCallback: the editor publishes its state from an effect, so a handler
  // with a new identity each render would re-run that effect forever.
  const onVarsSaveState = useCallback((s: VoiceEditorSaveState) => setVarsState(s), []);

  const voiceDirty = !!detail && voice !== (detail.voiceId ?? "");
  const personaDirty = !!detail && persona.trim() !== (detail.personaName ?? "");
  const openersDirty = !!detail && !sameOpeners(openers, openersOf(detail.openers));
  const voicemailDirty = !!detail && !sameVoicemail(voicemail, detail.voicemail);
  const instructionsDirty = !!detail?.prompt && draft !== detail.prompt.general;
  const openingDirty = !!detail?.prompt && begin !== detail.prompt.beginMessage;
  const promptDirty =
    instructionsDirty ||
    openingDirty ||
    voiceDirty ||
    personaDirty ||
    openersDirty ||
    voicemailDirty;
  const dirty = promptDirty || !!varsState?.dirty;
  // A draft at the provider the page did not make in this session: a publish
  // that stopped half way, or an edit from the provider's console.
  const providerDraft = !!detail?.isDraft;
  const saving = busy || !!varsState?.busy;

  // The draft follows the edits. Leaving the page, closing the tab or coming
  // back tomorrow all find the work where it was left — losing typed work to a
  // mis-click is worse than the thing a leave-guard was protecting against,
  // and the amber Unsaved mark already stops a draft being mistaken for live.
  useEffect(() => {
    if (!restored) return;
    if (dirty) {
      writeDraft(agentId, {
        prompt: draft,
        begin,
        voice,
        persona,
        openers,
        voicemail,
        rows: varsState?.rows,
      });
    } else {
      clearDraft(agentId);
    }
  }, [restored, dirty, agentId, draft, begin, voice, persona, openers, voicemail, varsState?.rows]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(label);
    try {
      await fn();
    } catch {
      setStatus(t("settings.voiceActionFailed"));
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  // The edit set the provider takes, shared by Publish and the browser
  // test's stage, so a test hears exactly what Publish would put live.
  const editArgs = () => ({
    agentId,
    ...(detail?.version !== null && detail?.version !== undefined
      ? { baseVersion: detail.version }
      : {}),
    ...(instructionsDirty ? { generalPrompt: draft } : {}),
    ...(openingDirty ? { beginMessage: begin } : {}),
    // Only when it changed: an unchanged voice sent every time would ride
    // a restore back over a voice somebody picked since.
    ...(voiceDirty ? { voiceId: voice } : {}),
    ...(voicemailDirty ? { voicemail } : {}),
    ...(varsState?.dirty
      ? {
          variables: varsState.rows.map((row) => ({
            ...row,
            beforeFieldId: row.beforeFieldId as Id<"contactFields"> | undefined,
            contactFieldId: row.contactFieldId as Id<"contactFields"> | undefined,
          })),
        }
      : {}),
  });

  // Everything the provider holds, as ONE version. The note names what
  // changed, in the business's language, so the history reads as a changelog.
  const savePrompt = () => {
    if (voicemailDirty && leavesMessage(voicemail) && !voicemail.text?.trim()) {
      setNotice(t("voiceDetail.voicemailTextMissing"));
      return;
    }
    setNotice(null);
    const varsDirty = !!varsState?.dirty;
    const changed = [
      instructionsDirty && t("voiceDetail.noteInstructions"),
      openingDirty && t("voiceDetail.noteOpening"),
      voiceDirty && t("voiceDetail.noteVoice"),
      varsDirty && t("voiceDetail.noteVariables"),
      voicemailDirty && t("voiceDetail.noteVoicemail"),
    ].filter((part): part is string => typeof part === "string");
    if (changed.length === 0) return;
    void run(t("voiceDetail.publishing"), async () => {
      const res = await publishAgent({
        ...editArgs(),
        versionNote: { title: changed.join(", ") },
      });
      setSeed(null);
      clearDraft(agentId);
      setStatus(t("voiceDetail.published", { n: res.version }));
      load();
    });
  };

  const providerChanges =
    instructionsDirty || openingDirty || voiceDirty || voicemailDirty || !!varsState?.dirty;

  const saveAll = () => {
    // Separate from the provider publish on purpose: the name and the first
    // sentences never go to the provider, so they must not ride a publish
    // that could fail, and they must still save when nothing else changed.
    // Saved BEFORE the publish, which reads them for the opener's fallback.
    const ours: Promise<unknown>[] = [];
    if (personaDirty) {
      ours.push(setAgentPersona({ retellAgentId: agentId, personaName: persona.trim() }));
    }
    if (openersDirty) {
      ours.push(setAgentOpeners({ retellAgentId: agentId, openers }));
    }
    const saved = Promise.all(ours);
    if (providerChanges) {
      void saved.then(savePrompt).catch(() => setError(t("forms.failed")));
      return;
    }
    if (ours.length > 0) {
      void saved
        .then(() => {
          clearDraft(agentId);
          load();
        })
        .catch(() => setError(t("forms.failed")));
      return;
    }
    // Nothing of ours to send, but a draft is waiting at the provider.
    if (providerDraft) {
      void run(t("voiceDetail.publishing"), async () => {
        const res = await publishDraft({ agentId });
        setStatus(t("voiceDetail.published", { n: res.version }));
        load();
      });
    }
  };

  // The only way work is thrown away, and it takes a deliberate click. A
  // draft at the provider goes too, so the page and what callers hear agree.
  const discardAll = () => {
    setSeed(null);
    varsState?.discard();
    setDraft(detail?.prompt?.general ?? "");
    setBegin(detail?.prompt?.beginMessage ?? "");
    setVoice(detail?.voiceId ?? "");
    setPersona(detail?.personaName ?? "");
    setOpeners(openersOf(detail?.openers));
    if (detail) setVoicemail(detail.voicemail);
    clearDraft(agentId);
    setStatus(null);
    setNotice(null);
    if (providerDraft) {
      setBusy(true);
      void discardDraft({ agentId })
        .then(() => load())
        .catch((err: unknown) => {
          setStatus(
            err instanceof Error && err.message.includes("never-published")
              ? t("voiceDetail.neverPublished")
              : t("settings.voiceActionFailed"),
          );
        })
        .finally(() => setBusy(false));
    }
  };

  // An older version's words, back in the editor as unsaved edits. Publish
  // is still the only way they reach a caller.
  const restoreVersion = (version: number) =>
    void run(t("common.loading"), async () => {
      const words = await readVersion({ agentId, version });
      if (words.generalPrompt !== null) setDraft(words.generalPrompt);
      if (words.beginMessage !== null) setBegin(words.beginMessage);
      if (words.voiceId) setVoice(words.voiceId);
      setNotice(t("voiceDetail.restored", { n: version }));
    });

  const loadVersions = useCallback(() => listVersions({ agentId }), [listVersions, agentId]);

  // The browser test hears what is on screen: the page's edits go onto the
  // provider's draft (nothing goes live) and the test dials that version. A
  // draft already waiting there is dialled as it stands.
  const stageForTest = async (): Promise<number | null> => {
    if (providerChanges) {
      const res = await publishAgent({ ...editArgs(), stage: true });
      // The page now reads the draft back, so its edits stop reading as
      // unsaved and the save bar says a draft is waiting.
      load();
      return res.version;
    }
    return providerDraft ? (detail?.version ?? null) : null;
  };

  // Binding a line is immediate and unrelated to the draft: it changes which
  // phone rings this agent, not what the agent says. Riding Save would mean an
  // unsaved prompt held the phone number hostage.
  //
  // ATTACHING, never moving. This select carried assignLine's move semantics,
  // and picking a second line here silently released the agent's first one at
  // the provider — live, 18 Aug 2026, the salon's main line stopped ringing.
  // Picking a number now ADDS it to this agent in both directions; taking a
  // line away lives in the agents table's per-direction pickers, where
  // removal looks like removal.
  const chooseLine = (number: string) => {
    setAssigning(true);
    setLineError(false);
    void attachLine({ agentId, number, direction: "inbound" })
      .then(() => attachLine({ agentId, number, direction: "outbound" }))
      .then(() => load())
      .catch(() => setLineError(true))
      .finally(() => setAssigning(false));
  };

  // The registry's rows plus the built-ins the runtime always injects
  // (customer, business, next appointment, services). A registry row with the
  // same key wins, mirroring the injection's precedence. Shared by the prompt
  // and the opening line so the @ picker offers the same list in both.
  const promptVariables = useMemo(() => {
    const rows = (detail?.variableConfig.items ?? []).map((row) => ({
      key: row.key,
      label: row.label,
    }));
    const seen = new Set(rows.map((row) => row.key));
    // The runtime's own tokens too, or the editor amber-flags the template's
    // core vocabulary ({{now}}, {{contact}}…) as typos — half the strip under
    // the prompt was that false alarm.
    return [
      ...rows,
      ...builtinVoiceVariables(t).filter((row) => !seen.has(row.key)),
      ...injectedVoiceContext(t).filter((row) => !seen.has(row.key)),
    ];
  }, [detail, t]);

  // The openers' picker: everything the opening line offers, plus {{when}},
  // which only means something inside an opener (lib/opener).
  const openerVariables = useMemo(
    () => [...promptVariables, { key: "when", label: t("voiceVariables.when") }],
    [promptVariables, t],
  );
  const anyOpener = OPENER_FIELDS.some((key) => openers[key].trim());

  // The state the save bars name: unsaved edits on this page, or a draft at
  // the provider callers do not hear yet, by its version when it has one.
  const draftState = dirty
    ? t("voiceDetail.unsaved")
    : detail?.version !== null && detail?.version !== undefined
      ? t("voiceDetail.draftVersion", { n: detail.version })
      : t("voiceDetail.draftPending");
  const draftStateTitle = dirty
    ? t("voiceDetail.unsavedHint")
    : t("voiceDetail.draftPendingHint");

  // What the browser test calls each variable: the rows as they stand on
  // screen (saved or not), then the built-ins.
  const variableLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const row of promptVariables) labels[row.key] = row.label;
    for (const row of varsState?.rows ?? []) if (row.key && row.label) labels[row.key] = row.label;
    return labels;
  }, [promptVariables, varsState?.rows]);

  // Not from the backend: the backend would have to pick a language. Which of
  // the two unsupported shapes this is, the client can tell from engineType.
  const unsupported = !detail
    ? null
    : detail.engineType === "conversation-flow"
      ? t("voiceDetail.flowAgent")
      : detail.prompt
        ? null
        : t("voiceDetail.noPrompt");

  return (
    <>
      {/* Wider than the rest of Voice agent on purpose: the variables grid is
          six columns and the prompt is prose. At the list's width the grid
          horizontally scrolled on every visit. */}
      <div className="mx-auto max-w-4xl space-y-4 page-stack">
        {/* The header carries the agent's name, which is where it is renamed,
            and every action that applies to the whole agent. The way back is
            the title bar's breadcrumb (P25). It stays put while the prompt
            scrolls under it. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Left-aligned since Back moved to the title bar: centring was only
              there to stop the name reading as Back's second line. */}
          <h2 className="min-w-0 flex-1 text-lg font-semibold">
            {nameDraft === null ? (
              <button
                type="button"
                disabled={!detail || saving}
                onClick={() => detail && setNameDraft(detail.name)}
                title={t("voiceDetail.renameHint")}
                className="-ml-2 max-w-full truncate rounded-lg px-2 py-0.5 hover:bg-[var(--muted-bg)] disabled:hover:bg-transparent"
              >
                {detail?.name ?? t("settings.voiceAgent")}
              </button>
            ) : (
              <input
                autoFocus
                value={nameDraft}
                maxLength={80}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setNameDraft(null);
                }}
                onBlur={() => {
                  const next = (nameDraft ?? "").trim();
                  const current = detail?.name ?? "";
                  setNameDraft(null);
                  if (!next || next === current) return;
                  void run(t("common.saving"), async () => {
                    await renameAgent({ agentId, name: next });
                    load();
                  });
                }}
                className="-ml-2 w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 text-lg font-semibold"
              />
            )}
          </h2>
          {lineError && (
            <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">
              {t("voiceDetail.lineFailed")}
            </span>
          )}
          {/* Which phone rings this agent, next to the button that makes it
              ring. The list already had this control per row, but by the time
              you are editing the agent the list is two clicks behind you — and
              "why didn't my test number reach it" is answered right here.
              Options are every line on the account, not just the free ones:
              picking one another agent holds MOVES it, which is the whole
              point when you are switching which agent answers. */}
          {detail && (
            <select
              value={detail.inboundNumber ?? ""}
              disabled={assigning || saving}
              title={t("settings.inboundNumber")}
              aria-label={t("settings.inboundNumber")}
              onChange={(e) => {
                if (e.target.value) chooseLine(e.target.value);
              }}
              // w-auto is load-bearing: globals.css gives every select
              // width:100% in the base layer, so a select without it eats its
              // whole flex line and drops Test call to the next row. The
              // scale's sm field, the height of the save bar beside it.
              className={`${fieldClass("sm")} w-auto shrink-0 text-[var(--muted)]`}
            >
              {/* No "None": with attach semantics an empty pick means
                  nothing, and detaching lives in the agents table where it
                  reads as removal. */}
              {/* The number, never the nickname. A nickname is what someone
                  called the line at the provider, and prepending it pushed the
                  number itself out of a control this narrow — leaving "austrian
                  number · +435…", which answers nothing. */}
              {detail.lines.map((line) => (
                <option key={line.number} value={line.number}>
                  {line.number}
                </option>
              ))}
            </select>
          )}
          {/* No Test call button here any more: the Testing tab below is where
              an agent is tried (P35), and the header keeps only what applies
              to the whole agent on either tab. */}
        </div>

        {/* Underlined tabs, VoiceView's (AGENTS.md "Tabs are underlined"):
            darker plus an underline, never bolder, so switching reflows
            nothing. The save state rides the strip's trailing edge on both
            tabs (Nudge, 2026-09-20: "publish, draft, all these buttons
            should be in the same row as Setup and Testing"), so a draft a
            test staged is published or discarded from where you are. Said
            out loud rather than implied by an enabled button: an edited
            prompt looks live, and the agent is still answering the phone
            with the version the provider has. On a phone the state takes a
            line of its own ABOVE the tabs, so the rule stays under them. */}
        <div className="flex flex-col-reverse gap-y-2 border-b border-[var(--border)] sm:flex-row sm:items-end sm:justify-between sm:gap-x-4">
          <div className="-mb-px flex items-end gap-5">
            {AGENT_TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => chooseTab(entry.id)}
                aria-current={tab === entry.id ? "page" : undefined}
                className={`border-b-2 px-0.5 py-2.5 text-sm transition-colors ${
                  tab === entry.id
                    ? "border-[var(--foreground)] text-[var(--foreground)]"
                    : "border-transparent text-[var(--muted-strong)] hover:text-[var(--foreground)]"
                }`}
              >
                {t(entry.label)}
              </button>
            ))}
          </div>
          {(notice || (status && !dirty && !providerDraft) || dirty || providerDraft) && (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 sm:pb-1.5">
              {notice && (
                <span className="text-xs text-amber-700 dark:text-amber-400">{notice}</span>
              )}
              {status && !dirty && !providerDraft && (
                <span className="text-xs text-[var(--muted)]">{status}</span>
              )}
              {(dirty || providerDraft) && (
                <>
                  {/* On a phone the sentence leads the line and the two
                      buttons wrap under it, right-aligned: the bar alone
                      does not shrink, and pushed past the left edge it cut
                      the sentence in half. */}
                  <span
                    title={draftStateTitle}
                    className="mr-auto inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 sm:hidden dark:text-amber-400"
                  >
                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    {draftState}
                  </span>
                  <div className="ml-auto">
                    <EditorSaveBar
                      status={draftState}
                      statusTitle={draftStateTitle}
                      statusFromSm
                      onDiscard={discardAll}
                      discardLabel={t("voiceDetail.discard")}
                      onSave={saveAll}
                      saveLabel={saving ? t("voiceDetail.publishing") : t("voiceDetail.publish")}
                      busy={saving}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}
        {!detail && !error && (
          <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
        )}

        {detail && (
          <div hidden={tab !== "setup"} className={`space-y-5 ${AGENT_PANE_CARD}`}>
            {/* One quiet line, not a slab. It only appears when the plumbing is
                actually broken, and a boxed amber warning the height of a
                paragraph made a fixable config detail the loudest thing on a
                page about what the agent says. */}
            {/* Ranked above the wiring line and shown even when the URL is
                correct: a rejected signature means calls are reaching us and
                being turned away, which is worse than a webhook that was never
                pointed here. No Fix button — the repair is pasting the right
                key in the operator console, not something this page can do. */}
            {detail.signatureRejectedAt !== null && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                <span>{t("voiceDetail.signatureRejected")}</span>
                <InfoTip text={t("voiceDetail.signatureRejectedHint")} />
              </div>
            )}

            {!detail.webhook.wired && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                <span>
                  {detail.webhook.pointsElsewhere
                    ? t("voiceDetail.webhookElsewhere")
                    : t("voiceDetail.webhookMissing")}
                </span>
                <InfoTip text={t("voiceDetail.webhookHint")} />
                <button
                  type="button"
                  disabled={saving || !detail.webhook.expected}
                  onClick={() =>
                    void run(t("voiceDetail.wiring"), async () => {
                      await wireWebhook({ agentId });
                      setStatus(t("voiceDetail.wired"));
                      load();
                    })
                  }
                  className="rounded-lg border border-current px-2 py-0.5 font-medium hover:bg-amber-500/10 disabled:opacity-50"
                >
                  {t("voiceDetail.webhookFix")}
                </button>
              </div>
            )}

            {/* A full banner, deliberately louder than the quiet warning
                lines above it. The webhook line earned its whisper because it
                describes standing config; this is a one-click action that
                deletes itself, and Serdar's finding was that as a grey line
                he had to be told it existed. Loud is fine for something that
                appears once per template generation and then vanishes.
                The body text explains what clicking changes and ends on the
                one reassurance that unblocks the click: the owner's own
                instructions are not touched. */}
            {detail.template.behind && (
              <div className="rounded-lg border border-amber-300/60 bg-amber-500/10 px-4 py-3 dark:border-amber-500/30">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                      {t("voiceDetail.templateBehind")}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-800/90 dark:text-amber-300/90">
                      {t("voiceDetail.templateBehindHint")}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void run(t("voiceDetail.templateUpdating"), async () => {
                        await syncTemplate({ agentId });
                        setStatus(t("voiceDetail.templateUpdated"));
                        load();
                      })
                    }
                    className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
                  >
                    {t("voiceDetail.templateUpdate")}
                  </button>
                </div>
              </div>
            )}

            {unsupported ? (
              <p className="text-sm text-[var(--muted)]">{unsupported}</p>
            ) : (
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <h4 className="text-xs font-medium">{t("voiceDetail.prompt")}</h4>
                  <InfoTip text={t("voiceDetail.promptHint")} />
                  {detail.version !== null && (
                    <AgentVersionHistory
                      version={detail.version}
                      liveVersion={detail.liveVersion}
                      draft={detail.isDraft}
                      load={loadVersions}
                      onRestore={restoreVersion}
                      disabled={saving}
                    />
                  )}
                </div>
                <PromptEditor value={draft} onChange={setDraft} variables={promptVariables} />
                <label className="mt-3 block">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                    {t("voiceDetail.opening")}
                    <InfoTip text={t("voiceDetail.openingHint")} />
                  </span>
                  {/* The same editor as the prompt, in single-line mode: the
                      opening line is where {{customer_name}} matters most, and
                      it deserves the same @ picker and the same pills. It
                      wraps and grows rather than scrolling, because an opening
                      line is a spoken sentence and often two. */}
                  <PromptEditor
                    value={begin}
                    onChange={setBegin}
                    variables={promptVariables}
                    singleLine
                  />
                </label>

                {/* The first sentence, chosen while the phone rings (P34,
                    lib/opener): four of the business's own sentences, said
                    where the opening line has {{opener}}. Resepta's, like the
                    persona below: they ride Save but never the provider, so
                    a change reaches the next call with no new version. */}
                {OPENER_FIELDS.map((key) => (
                  <label key={key} className="mt-2 block">
                    <span className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                      {t(OPENER_LABELS[key].label)}
                      <InfoTip text={t(OPENER_LABELS[key].hint)} />
                    </span>
                    <PromptEditor
                      value={openers[key]}
                      onChange={(value) => setOpeners((current) => ({ ...current, [key]: value }))}
                      variables={openerVariables}
                      singleLine
                    />
                  </label>
                ))}
                {/* A state the owner must act on, so it stays visible: these
                    sentences are written and the opening line never says
                    them. Reserved line height, so typing the first one does
                    not push the page down. */}
                <div className="mt-1.5 flex min-h-7 items-center gap-2">
                  {anyOpener && !usesOpener(begin) && (
                    <>
                      <span className="text-xs text-amber-700 dark:text-amber-400">
                        {t("voiceDetail.openerUnused")}
                      </span>
                      <button
                        type="button"
                        onClick={() => setBegin((current) => `${current.trimEnd()} {{opener}}`.trim())}
                        className={buttonClass("ghost", "xs")}
                      >
                        {t("voiceDetail.openerUse")}
                      </button>
                    </>
                  )}
                </div>

                {/* Her name, beside the voice she says it in — the two
                    together are who the caller thinks they are talking to.
                    Rides the same Save, though it alone never reaches the
                    provider: it is injected as {{agent_name}} while the phone
                    rings, so renaming her takes effect on the next call with
                    no republish. */}
                {/* Its own switch, not part of the draft. Turning it on edits
                    the response engine at the provider and publishes, so it
                    cannot wait behind an unsaved prompt — the same reasoning
                    the phone line dropdown above runs on. */}
                {/* One quiet two-column grid — label left, control right,
                    controls sized to their content, never to the card
                    (Serdar: a full-width name input read as a form field
                    waiting for an essay, and the toggle flung to the far
                    edge lost its label). Persona and voice ride Save;
                    canEndCall stays its own switch — it edits the response
                    engine at the provider and publishes, so it cannot wait
                    behind an unsaved prompt. */}
                <div className="mt-3 grid grid-cols-[max-content_minmax(0,20rem)] items-center gap-x-6 gap-y-2.5">
                  <label
                    htmlFor="agent-persona"
                    className="flex items-center gap-1.5 text-xs font-medium"
                  >
                    {t("voiceDetail.persona")}
                    <InfoTip text={t("voiceDetail.personaHint")} />
                  </label>
                  <input
                    id="agent-persona"
                    value={persona}
                    onChange={(event) => setPersona(event.target.value)}
                    maxLength={40}
                    placeholder={t("voiceDetail.personaPlaceholder")}
                    className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs"
                  />

                  <label
                    htmlFor="agent-voice"
                    className="flex items-center gap-1.5 text-xs font-medium"
                  >
                    {t("voiceDetail.voice")}
                    <InfoTip text={t("voiceDetail.voiceHint")} />
                  </label>
                  <div className="min-w-0 flex-1">
                    <VoicePicker
                      size="sm"
                      value={voice}
                      voices={detail.voices}
                      onChange={setVoice}
                    />
                  </div>

                  {/* One dropdown naming every answer (Nudge 8782af94). Rides
                      Publish like the voice: it is part of how the agent
                      behaves on a call, and the version note says so. */}
                  <label
                    htmlFor="agent-voicemail"
                    className="flex items-center gap-1.5 self-start pt-1.5 text-xs font-medium"
                  >
                    {t("voiceDetail.voicemail")}
                    <InfoTip text={t("voiceDetail.voicemailHint")} />
                  </label>
                  <div className="min-w-0 space-y-2">
                    <select
                      id="agent-voicemail"
                      value={voicemail.action}
                      onChange={(event) =>
                        setVoicemail({
                          action: event.target.value as Voicemail["action"],
                          text: voicemail.text,
                        })
                      }
                      className={`${fieldClass("sm")} w-full`}
                    >
                      {VOICEMAIL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(option.key)}
                        </option>
                      ))}
                    </select>
                    {leavesMessage(voicemail) && (
                      <textarea
                        value={voicemail.text ?? ""}
                        onChange={(event) =>
                          setVoicemail({ action: voicemail.action, text: event.target.value })
                        }
                        rows={3}
                        maxLength={600}
                        placeholder={
                          voicemail.action === "static_text"
                            ? t("voiceDetail.voicemailStaticPlaceholder")
                            : t("voiceDetail.voicemailPromptPlaceholder")
                        }
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
                      />
                    )}
                  </div>

                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    {t("voiceDetail.canEndCall")}
                    <InfoTip text={t("voiceDetail.canEndCallHint")} />
                  </span>
                  <span className="justify-self-start">
                    <Toggle
                      checked={detail.canEndCall}
                      disabled={saving}
                      label={t("voiceDetail.canEndCall")}
                      onChange={(next) =>
                        void run(t("common.saving"), async () => {
                          await setEndCallEnabled({ agentId, enabled: next });
                          load();
                        })
                      }
                    />
                  </span>
                </div>

              </div>
            )}

            {/* The variables the prompt above refers to, on the same screen as
                the prompt. The @-picker reaches them by label; a tab between
                the two meant checking a variable's name cost a click and lost
                your place in the prompt. */}
            <div className="border-t border-[var(--border)] pt-4">
              <VoiceVariablesEditor
                agentId={agentId}
                version={detail.version}
                engineType={detail.engineType}
                managed={detail.variableConfig.managed}
                initial={detail.variableConfig.items}
                seed={seed}
                contactFields={detail.contactFields}
                identityLocks={detail.voiceLockedIdentity ?? []}
                identityDescriptions={detail.voiceIdentityDescriptions ?? {}}
                onPublished={load}
                onSaveStateChange={onVarsSaveState}
              />
            </div>

            {/* The editor's foot, mirroring Nudge's bottom Publish: after a
                long scroll through prompt and variables, the way out should
                not be back at the top. Delete sits left, apart from the pair
                that saves work — destructive and constructive controls do not
                share a corner. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
              {connectedRow && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    void (async () => {
                      const ok = await confirmDelete({
                        title: t("settings.voiceDisconnectConfirm", { name: detail.name }),
                        confirmLabel: t("settings.voiceDisconnect"),
                      });
                      if (!ok) return;
                      await disconnect({ agentId: connectedRow._id });
                      onBack();
                    })();
                  }}
                  className={buttonClass("danger", "sm")}
                >
                  {t("settings.voiceDisconnect")}
                </button>
              )}
              {/* The same bar as the header's, at the foot a long scroll ends
                  on. Publish stays here when there is nothing to publish,
                  disabled: the foot of the form is where people look for
                  it. */}
              <div className="ml-auto">
                <EditorSaveBar
                  status={dirty || providerDraft ? draftState : null}
                  statusTitle={draftStateTitle}
                  onDiscard={dirty || providerDraft ? discardAll : undefined}
                  discardLabel={t("voiceDetail.discard")}
                  onSave={saveAll}
                  saveLabel={saving ? t("voiceDetail.publishing") : t("voiceDetail.publish")}
                  saveDisabled={!dirty && !providerDraft}
                  busy={saving}
                />
              </div>
            </div>
          </div>
        )}

        {/* Testing (P35; redone on Nudge's 2026-10-21): the Call setup card
            and Test results under it, each a card of its own. Mounted from
            the first render and only hidden on Setup, so a call in progress
            keeps talking while the prompt is open; it reads nothing until
            the tab is first shown. */}
        {detail && (
          <div hidden={tab !== "testing"}>
            <AgentBrowserTest
              agentId={agentId}
              agentName={detail.name}
              active={tab === "testing"}
              hasEdits={providerChanges || providerDraft}
              stage={stageForTest}
              beginMessage={begin}
              openers={openers}
              promptText={draft}
              labels={variableLabels}
              phoneTestStale={dirty || providerDraft}
            />
          </div>
        )}
      </div>
      {confirmDeleteDialog}

    </>
  );
}
