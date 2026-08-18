"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import { api } from "../../convex/_generated/api";
import { useConfirm } from "./ConfirmDialog";
import { useLanguage } from "@/lib/LanguageProvider";
import { localeFor } from "@/lib/datetime";
import { type SiteUrl } from "@/lib/siteUrl";
import { ActionTip, InfoTip } from "./InfoTip";
import { Sheet } from "./Sheet";
import { Toggle } from "./Toggle";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { CheckMark, ITEM_CLASS, PANEL_CLASS } from "./DataTable";


// The roster comes from the org's OWN Retell account (convex/retell.ts
// listAgents), so this is a live call and not a query — there is nothing
// mirrored into our tables to subscribe to. Deliberate: a cached list is how
// you end up wiring an agent that was renamed or deleted in the provider.
//
// Two lists meet on this card and they answer different questions. `connected`
// (api.retell.list) is what this salon has wired up and is the thing calls
// route through. `roster` is everything sitting in their Retell account. An
// agent in the roster and not in `connected` is one they could turn on; the
// reverse is one whose row outlived the agent it named.
type Roster = {
  configured: boolean;
  error: string | null;
  agents: {
    id: string;
    name: string;
    languages: string[];
    collects: string[];
    webhookUrl: string | null;
    ownedHere: boolean;
  }[];
  phoneNumbers: {
    number: string;
    nickname: string;
    inboundAgentId: string | null;
    outboundAgentId: string | null;
    agentId: string | null;
  }[];
  voices: {
    id: string;
    name: string;
    gender: string;
    accent: string;
    previewUrl: string | null;
  }[];
  hiddenAgentIds: string[];
  agentSource: "randevu" | "account";
};

type CreateLanguage = "tr-TR" | "en-US" | "de-DE";

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-spin" : undefined}
      aria-hidden
    >
      <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
      <path d="M21 21v-5h-5" />
    </svg>
  );
}

function humanizeField(name: string): string {
  const words = name.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

function languageLabel(tag: string, locale: string, multiple: string): string {
  if (tag === "multi") return multiple;
  try {
    const [language, region] = tag.split("-");
    const languageName = new Intl.DisplayNames([locale], { type: "language" }).of(language);
    if (!region) return languageName ?? tag;
    const regionName = new Intl.DisplayNames([locale], { type: "region" }).of(region);
    return `${languageName ?? language} (${regionName ?? region})`;
  } catch {
    return tag;
  }
}

// One direction's numbers for one agent: a trigger that reads like an input
// and an anchored checkbox panel over every line on the account. The native
// <select> this replaces could neither show multiple selections nor render as
// anything but the OS popup. Toggling a number another agent holds MOVES it,
// the same steal the old single-select always did — the ✓ simply shows where
// it is now.
function LineMultiSelect({
  numbers,
  selected,
  disabled,
  placeholder,
  label,
  emptyLabel,
  onToggle,
}: {
  numbers: string[];
  selected: string[];
  disabled: boolean;
  placeholder: string;
  // Names the control for screen readers; the column header names it for
  // everyone else.
  label: string;
  // Shown in the panel when the account has no numbers at all.
  emptyLabel: string;
  onToggle: (number: string, next: boolean) => void;
}) {
  const { triggerRef, panelRef, pos, open, toggle } = useAnchoredPanel(224, 264);
  // A held line the account no longer lists still renders (and can be
  // unchecked), so the row shows the truth rather than silently dropping it.
  const options = [...new Set([...numbers, ...selected])];
  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0]
        : `${selected[0]} +${selected.length - 1}`;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        className="flex w-full min-w-36 items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-left text-xs disabled:opacity-60"
      >
        <span className={`truncate ${selected.length === 0 ? "text-[var(--muted)]" : ""}`}>
          {summary}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
          className="shrink-0 text-[var(--muted)]"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", maxHeight: 264, ...pos }}
            className={`${PANEL_CLASS} text-xs`}
          >
            {options.length === 0 && (
              <div className="px-2.5 py-1.5 text-[var(--muted)]">{emptyLabel}</div>
            )}
            {options.map((number) => {
              const on = selected.includes(number);
              return (
                <button
                  key={number}
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggle(number, !on)}
                  className={`${ITEM_CLASS} disabled:opacity-60`}
                >
                  <CheckMark on={on} />
                  <span className="truncate">{number}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

export function VoiceCard({
  isOwner,
  site,
  onOpenAgent,
}: {
  isOwner: boolean;
  site: SiteUrl;
  // The agent opens as a page now, not a sheet from inside this card, so the
  // parent owns which agent is open (and puts it in the URL).
  onOpenAgent: (agentId: string) => void;
}) {
  const { t, language } = useLanguage();
  const connected = useQuery(api.retell.list, {});
  const callStats = useQuery(api.retell.agentCallStats, {});
  const callHealth = useQuery(api.voiceEvents.health, {});
  const activeProvisioning = useQuery(
    api.voiceProvisioning.active,
    isOwner ? {} : "skip",
  );
  const connect = useMutation(api.retell.connect);
  const disconnect = useMutation(api.retell.disconnect);
  const [confirm, confirmDialog] = useConfirm();
  const update = useMutation(api.retell.update);
  const listAgents = useAction(api.retell.listAgents);
  const wireWebhook = useAction(api.retellAgent.wireWebhook);
  const attachLine = useAction(api.retellAgent.attachLine);
  const detachLine = useAction(api.retellAgent.detachLine);
  // The reactive copy of the provider's routing (agentLines). Chips render
  // from THIS, not from the roster snapshot: attach/detach update it in the
  // same mutation that records the provider's acceptance, so the row changes
  // the moment the change is real — no refetch of the whole roster.
  const orgLines = useQuery(api.retell.orgLines, {});
  const createAgent = useAction(api.retellAgent.createAgent);
  const setAgentArchived = useMutation(api.retell.setAgentArchived);
  const [wiring, setWiring] = useState<string | null>(null);
  // The line dropdown talks to the provider, so it has in-flight and failed
  // states like Fix does; the reactive list restores the stored truth if the
  // provider rejects the change.
  const [assigningLine, setAssigningLine] = useState<string | null>(null);
  const [lineErrorId, setLineErrorId] = useState<string | null>(null);
  // Fix can fail (provider down, key revoked mid-session). Swallowing that
  // rejection made the button look dead — the exact bug that hid the
  // unique()-crash in prod. Whatever goes wrong renders in the notice row.
  const [wireError, setWireError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<"create" | "connect">("create");
  const [createName, setCreateName] = useState("");
  const [createLanguage, setCreateLanguage] = useState<CreateLanguage>("en-US");
  const [createVoiceId, setCreateVoiceId] = useState("");
  const [createLine, setCreateLine] = useState("");
  const [createRequestId, setCreateRequestId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    void listAgents({})
      .then(setRoster)
      .finally(() => setLoading(false));
  }, [listAgents]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!adding || !activeProvisioning) return;
    setAddMode("create");
    setCreateRequestId(activeProvisioning.requestId);
    setCreateName(activeProvisioning.name);
    setCreateLanguage(activeProvisioning.language);
    setCreateVoiceId(activeProvisioning.voiceId);
    setCreateLine(activeProvisioning.inboundNumber ?? "");
  }, [adding, activeProvisioning]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  if (connected === undefined) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }

  const inRoster = (id: string) => roster?.agents.find((a) => a.id === id) ?? null;
  // What every connected agent's webhook should say. Null on a misconfigured
  // deployment — no point flagging rows against a URL that is itself wrong.
  const expectedHook = site.isMisconfigured ? null : `${site.url}/retell/call-ended`;
  const connectedIds = new Set(connected.map((row) => row.retellAgentId));
  const hidden = new Set(roster?.hiddenAgentIds ?? []);
  // Ownership narrows the PICKER and nothing else. A connected agent that
  // predates tagging keeps its row, its details and its webhook check; what
  // this decides is which agents you may newly connect. On "randevu" that is
  // only the ones Resepta made for this business — the rest belong to whoever
  // else shares the Retell workspace, and offering them was how one salon got
  // shown another's agents.
  const ownedOnly = (roster?.agentSource ?? "randevu") === "randevu";
  const offerable = (a: { id: string; ownedHere: boolean }) =>
    !connectedIds.has(a.id) && (!ownedOnly || a.ownedHere);
  const available = (roster?.agents ?? []).filter(
    (a) => offerable(a) && !hidden.has(a.id),
  );
  const archived = (roster?.agents ?? []).filter(
    (a) => offerable(a) && hidden.has(a.id),
  );
  const pickerRows = [
    ...available.map((agent) => ({ agent, archived: false })),
    ...(showArchived ? archived.map((agent) => ({ agent, archived: true })) : []),
  ];
  const pickerHasLines = pickerRows.some(({ agent }) =>
    roster?.phoneNumbers.some((number) => number.agentId === agent.id),
  );
  const displayLocale = localeFor(language);
  const availableLines = (roster?.phoneNumbers ?? []).filter((number) => !number.agentId);
  const canCreate = Boolean((roster?.voices.length ?? 0) > 0 || activeProvisioning);
  const canConnect = available.length + archived.length > 0;
  const provisioningReady = !isOwner || activeProvisioning !== undefined;
  const selectedVoice = roster?.voices.find((voice) => voice.id === createVoiceId) ?? null;
  const setupWorking = creating || activeProvisioning?.working === true;
  const createFieldsLocked = setupWorking || Boolean(activeProvisioning?.agentId);
  const createMessage = createError
    ? createError
    : activeProvisioning?.status === "failed"
      ? activeProvisioning.agentId
        ? t("voiceCreate.resume")
        : t("voiceCreate.failed")
      : setupWorking
        ? t("voiceCreate.creating")
        : null;

  const closeAdd = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPreviewingVoice(null);
    setAdding(false);
  };

  const openAdd = () => {
    setCreateError(null);
    if (activeProvisioning) {
      setAddMode("create");
      setCreateRequestId(activeProvisioning.requestId);
      setCreateName(activeProvisioning.name);
      setCreateLanguage(activeProvisioning.language);
      setCreateVoiceId(activeProvisioning.voiceId);
      setCreateLine(activeProvisioning.inboundNumber ?? "");
    } else {
      const preferredLanguage: CreateLanguage =
        language === "tr" ? "tr-TR" : language === "de" ? "de-DE" : "en-US";
      setAddMode(canCreate ? "create" : "connect");
      setCreateRequestId(crypto.randomUUID());
      setCreateName(t("voiceCreate.defaultName"));
      setCreateLanguage(preferredLanguage);
      setCreateVoiceId(
        roster?.voices.find((voice) => voice.name.toLocaleLowerCase() === "cimo")?.id ??
          roster?.voices[0]?.id ??
          "",
      );
      setCreateLine("");
    }
    setAdding(true);
  };

  const previewVoice = (voiceId: string, url: string) => {
    if (previewingVoice === voiceId) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPreviewingVoice(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    setPreviewingVoice(voiceId);
    audio.addEventListener("ended", () => setPreviewingVoice(null), { once: true });
    void audio.play().catch(() => setPreviewingVoice(null));
  };

  const submitCreate = async () => {
    if (!createName.trim() || !createVoiceId || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const requestId = createRequestId || crypto.randomUUID();
      setCreateRequestId(requestId);
      const result = await createAgent({
        requestId,
        name: createName,
        language: createLanguage,
        voiceId: createVoiceId,
        inboundNumber: createLine || undefined,
      });
      if (result.status === "working") {
        setCreateError(t("voiceCreate.inProgress"));
        return;
      }
      closeAdd();
      load();
      if (result.agentId) onOpenAgent(result.agentId);
    } catch {
      setCreateError(t("voiceCreate.failed"));
    } finally {
      setCreating(false);
    }
  };

  // Connecting adopts whatever number Retell already has bound to that agent,
  // so inboundNumber stops being hand-typed into agreement with the provider.
  const add = async (agentId: string) => {
    const bound = roster?.phoneNumbers.find((n) => n.agentId === agentId)?.number;
    closeAdd();
    setWiring(agentId);
    setWireError(null);
    try {
      await connect({
        retellAgentId: agentId,
        inboundNumber: bound,
        name: roster?.agents.find((a) => a.id === agentId)?.name,
      });
      // One operation from the owner's point of view: adding an agent also
      // connects call results, pre-call context and the Resepta runtime tools.
      await wireWebhook({ agentId });
      load();
    } catch {
      setWireError(t("settings.voiceActionFailed"));
    } finally {
      setWiring(null);
    }
  };

  const status = !roster
    ? null
    : roster.configured
      ? null
      : roster.error
        ? t("settings.voiceUnreachable")
        : t("settings.voiceNotProvisioned");

  const agentActions = (
    <>
      {/* Adding opens a sheet. A permanent picker under the table would be a
          question the page asks on every visit to pay for a task done once. */}
      <button
        type="button"
        onClick={openAdd}
        disabled={
          !roster?.configured ||
          !provisioningReady ||
          (!canCreate && !canConnect)
        }
        className="h-8 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-40"
      >
        {t("settings.voiceConnect")}
      </button>
      <button
        type="button"
        onClick={load}
        disabled={loading}
        aria-label={t("settings.voiceRefresh")}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] disabled:opacity-50"
      >
        <RefreshIcon spinning={loading} />
      </button>
    </>
  );

  return (
    // Not a Card: the table is the main actor and frames itself. The fieldset
    // is the one job the card chrome was doing — staff see all of this
    // read-only — and it stays, invisible (min-w-0 per Card's own lesson).
    <fieldset disabled={!isOwner} className={`min-w-0 ${!isOwner ? "opacity-70" : ""}`}>
      {confirmDialog}
      <div className="mb-2 flex items-center justify-end gap-1">{agentActions}</div>

      {connected.length > 0 && (
        <div className="mb-3 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
          {/* min-w-full, not w-full. w-full pins the table to the container and
              the cells overflow it anyway — the Enabled toggle and the
              disconnect button were clipped at the card edge with nothing to
              grab. min-w-full lets the table size to its content so the
              overflow-x-auto above actually has something to scroll. */}
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">{t("settings.voiceAgent")}</th>
                <th className="px-3 py-2 font-medium">{t("settings.inboundNumber")}</th>
                {/* Separate column because it is a separate fact: who a line
                    RINGS and who it dials AS may be different agents, and a
                    campaign org cares about the second without the first. */}
                <th className="px-3 py-2 font-medium">{t("settings.outboundNumber")}</th>
                <th className="px-2 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">
                    {t("settings.voiceEnabled")}
                    <InfoTip text={t("settings.voiceEnabledHint")} />
                  </span>
                </th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {connected.map((row) => {
                const agent = inRoster(row.retellAgentId);
                const wired = Boolean(
                  agent && expectedHook && agent.webhookUrl === expectedHook,
                );
                const health = callHealth?.find(
                  (item) => item.retellAgentId === row.retellAgentId,
                );
                const connectionNeedsFix = Boolean(
                  agent &&
                    expectedHook &&
                    (!wired || health?.runtimeConnected === false),
                );
                return (
                  <Fragment key={row._id}>
                  <tr className="group border-t border-[var(--border)]">
                    {/* An agent the account no longer lists still gets an honest
                        native label. Provider identifiers belong in platform
                        admin, never in the salon-facing product. */}
                    <td className="whitespace-nowrap px-3 py-2">
                      {/* The name opens the agent itself — prompt, webhook,
                          variables, test call. A ghost row opens too: the
                          detail is where you find out what the id points at. */}
                      <button
                        type="button"
                        onClick={() => onOpenAgent(row.retellAgentId)}
                        className="underline-offset-2 hover:underline"
                      >
                        {agent ? (
                          agent.name
                        ) : (
                          <span className="text-xs text-amber-600 dark:text-amber-400">
                            {t("settings.voiceUnavailable")}
                          </span>
                        )}
                      </button>
                      {/* The nudge pattern: everything that is information
                          rather than a control lives one expand away — the
                          collected fields, when it was connected, how much it
                          has worked. */}
                      <button
                        type="button"
                        onClick={() =>
                          setOpenInfo(openInfo === row.retellAgentId ? null : row.retellAgentId)
                        }
                        className="ml-2 text-xs text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--foreground)]"
                      >
                        {agent && agent.collects.length > 0
                          ? t("settings.voiceCollectsCount").replace(
                              "{n}",
                              String(agent.collects.length),
                            )
                          : t("settings.voiceDetails")}
                      </button>
                    </td>
                    {/* The agent's lines, one multi-select per DIRECTION
                        (retellAgent.attachLine/detachLine). The checkmarks
                        read the reactive agentLines copy; the options are the
                        account's real numbers, never free text — free text
                        here was how inboundNumber drifted out of agreement
                        with Retell. */}
                    {(["inbound", "outbound"] as const).map((direction) => (
                      <td key={direction} className="px-3 py-2">
                        <LineMultiSelect
                          numbers={(roster?.phoneNumbers ?? []).map((n) => n.number)}
                          selected={(orgLines ?? [])
                            .filter(
                              (line) =>
                                (direction === "inbound"
                                  ? line.inboundAgentId
                                  : line.outboundAgentId) === row.retellAgentId,
                            )
                            .map((line) => line.number)}
                          disabled={assigningLine === row.retellAgentId}
                          placeholder={t("settings.voiceAddNumber")}
                          label={t(
                            direction === "inbound"
                              ? "settings.inboundNumber"
                              : "settings.outboundNumber",
                          )}
                          emptyLabel={t("settings.voiceNoNumber")}
                          onToggle={(number, next) => {
                            setAssigningLine(row.retellAgentId);
                            setLineErrorId(null);
                            void (next ? attachLine : detachLine)({
                              agentId: row.retellAgentId,
                              number,
                              direction,
                            })
                              .catch(() => setLineErrorId(row.retellAgentId))
                              .finally(() => setAssigningLine(null));
                          }}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <Toggle
                        checked={row.enabled}
                        onChange={(next) => void update({ agentId: row._id, enabled: next })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ActionTip
                        label={t("settings.voiceDisconnect")}
                        className="transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                        onClick={() => {
                          // An icon button has no label to slow the hand down,
                          // so the confirm carries the reassurance: the agent
                          // itself survives, only the link goes. Which is
                          // exactly the wording window.confirm cannot deliver —
                          // its buttons stay OK and Cancel and it prefixes the
                          // origin — so this was arguing for a dialog it was
                          // not using.
                          const name = agent?.name ?? t("settings.voiceUnavailable");
                          void (async () => {
                            const ok = await confirm({
                              title: t("settings.voiceDisconnectConfirm").replace(
                                "{name}",
                                name,
                              ),
                              confirmLabel: t("settings.voiceDisconnect"),
                            });
                            if (ok) await disconnect({ agentId: row._id });
                          })();
                        }}
                      >
                        ✕
                      </ActionTip>
                    </td>
                  </tr>
                  {openInfo === row.retellAgentId && (
                    <tr className="bg-[var(--muted-bg)]">
                      <td colSpan={5} className="px-3 pb-3 pt-1">
                        <div className="grid gap-4 text-xs sm:grid-cols-2">
                          <div>
                            <div className="mb-1 font-medium">
                              {t("settings.voiceCollects")}
                            </div>
                            {agent && agent.collects.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {agent.collects.map((c) => (
                                  <span
                                    key={c}
                                    className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-0.5"
                                  >
                                    {c.replace(/_/g, " ")}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[var(--muted)]">—</span>
                            )}
                          </div>
                          <div className="space-y-1 text-[var(--muted)]">
                            <div className="font-medium text-[var(--foreground)]">
                              {t("settings.voiceCalls")}
                            </div>
                            {(() => {
                              const s = callStats?.[row.retellAgentId];
                              if (!s || s.total === 0)
                                return <div>{t("settings.voiceNoCalls")}</div>;
                              return (
                                <>
                                  <div>
                                    {t("settings.voiceStatToday").replace(
                                      "{n}",
                                      String(s.today),
                                    )}
                                    {" · "}
                                    {t("settings.voiceStatTotal").replace(
                                      "{n}",
                                      String(s.total),
                                    )}
                                  </div>
                                  {s.lastAt !== null && (
                                    <div>
                                      {t("settings.voiceStatLast").replace(
                                        "{when}",
                                        new Date(s.lastAt).toLocaleString(),
                                      )}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                            <div>
                              {t("settings.voiceConnectedAt").replace(
                                "{date}",
                                new Date(row.connectedAt).toLocaleDateString(),
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {/* Connection and delivery health, said as symptoms. Raw
                      provider errors stay in platform admin; the owner gets
                      either one safe Fix or an honest data warning. */}
                  {(connectionNeedsFix ||
                    health?.needsAttention ||
                    lineErrorId === row.retellAgentId) && (
                    <tr className="border-t border-[var(--border)] bg-amber-50 dark:bg-amber-950/30">
                      <td colSpan={5} className="px-3 py-2">
                        <span className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                          {connectionNeedsFix && (
                            <span>
                              {wired
                                ? t("settings.voiceNotFullyConnected")
                                : t("settings.voiceNotReceiving")}
                            </span>
                          )}
                          {health?.needsAttention && (
                            <span>{t("settings.voiceUpdateIncomplete")}</span>
                          )}
                          {lineErrorId === row.retellAgentId && (
                            <span>{t("settings.voiceActionFailed")}</span>
                          )}
                          {connectionNeedsFix &&
                            (wiring === row.retellAgentId ? (
                              <span className="animate-pulse">{t("voiceDetail.wiring")}</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setWiring(row.retellAgentId);
                                  setWireError(null);
                                  void wireWebhook({ agentId: row.retellAgentId })
                                    .then(() => load())
                                    .catch(() => setWireError(t("settings.voiceActionFailed")))
                                    .finally(() => setWiring(null));
                                }}
                                className="rounded-lg px-2 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-950/60"
                              >
                                {t("settings.voiceFix")}
                              </button>
                            ))}
                          {wireError && wiring === null && <span>{wireError}</span>}
                        </span>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Reserved whether or not it says anything, so refreshing into an error
          does not push the buttons out from under the pointer. */}
      <p className="min-h-[1.25rem] text-sm text-[var(--muted)]">
        {status}
        {roster?.configured &&
        connected.length === 0 &&
        available.length === 0 &&
        !canCreate
          ? t("settings.voiceNoAgents")
          : null}
      </p>


      {adding && (
        <Sheet
          title={t("settings.voiceConnect")}
          hint={t("settings.voiceConnectHint")}
          wide
          onClose={closeAdd}
        >
          {canCreate && canConnect && !activeProvisioning && (
            <div
              role="tablist"
              className="mb-4 inline-flex rounded-lg bg-[var(--muted-bg)] p-1 text-xs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={addMode === "create"}
                onClick={() => setAddMode("create")}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  addMode === "create"
                    ? "bg-[var(--card)] shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {t("voiceCreate.new")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={addMode === "connect"}
                onClick={() => setAddMode("connect")}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  addMode === "connect"
                    ? "bg-[var(--card)] shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {t("voiceCreate.existing")}
              </button>
            </div>
          )}

          <div className="min-h-[18rem]">
            {addMode === "create" && canCreate ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitCreate();
                }}
                className="flex min-h-[18rem] flex-col"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium">
                      {t("voiceCreate.name")}
                    </span>
                    <input
                      data-sheet-autofocus
                      value={createName}
                      maxLength={80}
                      disabled={createFieldsLocked}
                      onChange={(event) => setCreateName(event.target.value)}
                      className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-base outline-none focus:border-[var(--accent)] disabled:opacity-60 sm:text-sm"
                    />
                  </label>

                  <label>
                    <span className="mb-1 block text-xs font-medium">
                      {t("settings.voiceLanguage")}
                    </span>
                    <select
                      value={createLanguage}
                      disabled={createFieldsLocked}
                      onChange={(event) =>
                        setCreateLanguage(event.target.value as CreateLanguage)
                      }
                      className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-base outline-none focus:border-[var(--accent)] disabled:opacity-60 sm:text-sm"
                    >
                      <option value="tr-TR">Türkçe</option>
                      <option value="en-US">English</option>
                      <option value="de-DE">Deutsch</option>
                    </select>
                  </label>

                  <div>
                    <label
                      htmlFor="voice-create-voice"
                      className="mb-1 block text-xs font-medium"
                    >
                      {t("voiceCreate.voice")}
                    </label>
                    <span className="flex items-center gap-1">
                      <select
                        id="voice-create-voice"
                        value={createVoiceId}
                        disabled={createFieldsLocked}
                        onChange={(event) => {
                          audioRef.current?.pause();
                          setPreviewingVoice(null);
                          setCreateVoiceId(event.target.value);
                        }}
                        className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-base outline-none focus:border-[var(--accent)] disabled:opacity-60 sm:text-sm"
                      >
                        {(roster?.voices ?? []).map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {[voice.name, voice.accent, voice.gender]
                              .filter(Boolean)
                              .join(" · ")}
                          </option>
                        ))}
                        {createVoiceId &&
                          !roster?.voices.some((voice) => voice.id === createVoiceId) && (
                            <option value={createVoiceId}>{t("voiceCreate.savedVoice")}</option>
                          )}
                      </select>
                      {selectedVoice?.previewUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            previewVoice(selectedVoice.id, selectedVoice.previewUrl!)
                          }
                          aria-label={
                            previewingVoice === selectedVoice.id
                              ? t("voiceCreate.stopPreview")
                              : t("voiceCreate.preview")
                          }
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                        >
                          {previewingVoice === selectedVoice.id ? "■" : "▶"}
                        </button>
                      )}
                    </span>
                  </div>

                  <div className="sm:col-span-2">
                    <span className="mb-1 flex items-center gap-1">
                      <label htmlFor="voice-create-line" className="text-xs font-medium">
                      {t("settings.voiceLine")}
                      </label>
                      <InfoTip text={t("voiceCreate.lineHint")} />
                    </span>
                    <select
                      id="voice-create-line"
                      value={createLine}
                      disabled={createFieldsLocked}
                      onChange={(event) => setCreateLine(event.target.value)}
                      className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-base outline-none focus:border-[var(--accent)] disabled:opacity-60 sm:text-sm"
                    >
                      <option value="">{t("voiceCreate.noLine")}</option>
                      {availableLines.map((line) => (
                        <option key={line.number} value={line.number}>
                          {line.nickname === line.number
                            ? line.number
                            : `${line.nickname} · ${line.number}`}
                        </option>
                      ))}
                      {createLine &&
                        !availableLines.some((line) => line.number === createLine) && (
                          <option value={createLine}>{createLine}</option>
                      )}
                    </select>
                  </div>
                </div>

                <div className="mt-auto pt-6">
                  <p className="min-h-5 text-xs text-[var(--muted)]" aria-live="polite">
                    {createMessage}
                  </p>
                  <div className="mt-2 flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={closeAdd}
                      className="h-9 rounded-lg px-3 text-sm text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="submit"
                      disabled={
                        setupWorking || !createName.trim() || !createVoiceId
                      }
                      className="h-9 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-40"
                    >
                      {setupWorking
                        ? t("voiceCreate.creating")
                        : activeProvisioning?.status === "failed"
                          ? t("voiceCreate.retry")
                          : t("voiceCreate.submit")}
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className="text-left text-xs">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t("settings.voiceAgent")}</th>
                        <th className="px-3 py-2 font-medium">{t("settings.voiceLanguage")}</th>
                        <th className="px-3 py-2 font-medium">{t("settings.voiceCollects")}</th>
                        {pickerHasLines && (
                          <th className="px-3 py-2 font-medium">{t("settings.voiceLine")}</th>
                        )}
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {pickerRows.map(({ agent, archived: isArchived }) => {
                        const line = roster?.phoneNumbers.find(
                          (number) => number.agentId === agent.id,
                        );
                        return (
                          <tr
                            key={agent.id}
                            className={`group/pick border-t border-[var(--border)] ${
                              isArchived ? "text-[var(--muted)]" : ""
                            }`}
                          >
                            <td className="whitespace-nowrap px-3 py-2 font-medium">
                              {agent.name}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted-strong)]">
                              {agent.languages
                                .map((tag) =>
                                  languageLabel(
                                    tag,
                                    displayLocale,
                                    t("settings.voiceMultipleLanguages"),
                                  ),
                                )
                                .join(", ")}
                            </td>
                            <td className="max-w-xs px-3 py-2 text-xs text-[var(--muted-strong)]">
                              {agent.collects.length > 0 && (
                                <span className="inline-flex items-center gap-2">
                                  {t("settings.voiceCollectsCount").replace(
                                    "{n}",
                                    String(agent.collects.length),
                                  )}
                                  <InfoTip
                                    text={agent.collects.map(humanizeField).join("\n")}
                                    placement="above"
                                  />
                                </span>
                              )}
                            </td>
                            {pickerHasLines && (
                              <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted-strong)]">
                                {line
                                  ? line.nickname === line.number
                                    ? line.number
                                    : `${line.nickname} · ${line.number}`
                                  : ""}
                              </td>
                            )}
                            <td className="whitespace-nowrap px-3 py-2 text-right">
                              {isArchived ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void setAgentArchived({
                                      retellAgentId: agent.id,
                                      archived: false,
                                    }).then(load)
                                  }
                                  className="rounded-lg px-2 py-1 text-xs hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                                >
                                  {t("settings.voiceRestore")}
                                </button>
                              ) : (
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    data-sheet-autofocus
                                    onClick={() => void add(agent.id)}
                                    className="h-8 rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-fg)]"
                                  >
                                    {t("common.add")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void setAgentArchived({
                                        retellAgentId: agent.id,
                                        archived: true,
                                      }).then(load)
                                    }
                                    className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] focus-visible:opacity-100 group-hover/pick:opacity-100"
                                  >
                                    {t("settings.voiceArchive")}
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {archived.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowArchived((shown) => !shown)}
                    className="mt-2 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                  >
                    {showArchived
                      ? t("settings.voiceHideArchived")
                      : t("settings.voiceShowArchived").replace(
                          "{n}",
                          String(archived.length),
                        )}
                  </button>
                )}
              </>
            )}
          </div>
        </Sheet>
      )}

    </fieldset>
  );
}
