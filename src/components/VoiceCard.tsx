"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState, Fragment } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { type SiteUrl } from "@/lib/siteUrl";
import { ActionTip, InfoTip } from "./InfoTip";
import { Sheet } from "./Sheet";
import { Toggle } from "./Toggle";
import { VoiceAgentDetail } from "./VoiceAgentDetail";


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
  agents: { id: string; name: string; collects: string[]; webhookUrl: string | null }[];
  phoneNumbers: { number: string; nickname: string; agentId: string | null }[];
  hiddenAgentIds: string[];
};

export function VoiceCard({ isOwner, site }: { isOwner: boolean; site: SiteUrl }) {
  const { t } = useLanguage();
  const connected = useQuery(api.retell.list, {});
  const callStats = useQuery(api.retell.agentCallStats, {});
  const connect = useMutation(api.retell.connect);
  const disconnect = useMutation(api.retell.disconnect);
  const update = useMutation(api.retell.update);
  const listAgents = useAction(api.retell.listAgents);
  const wireWebhook = useAction(api.retellAgent.wireWebhook);
  const setAgentArchived = useMutation(api.retell.setAgentArchived);
  const [wiring, setWiring] = useState<string | null>(null);
  // Fix can fail (provider down, key revoked mid-session). Swallowing that
  // rejection made the button look dead — the exact bug that hid the
  // unique()-crash in prod. Whatever goes wrong renders in the notice row.
  const [wireError, setWireError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    void listAgents({})
      .then(setRoster)
      .finally(() => setLoading(false));
  }, [listAgents]);

  useEffect(() => load(), [load]);

  if (connected === undefined) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }

  const inRoster = (id: string) => roster?.agents.find((a) => a.id === id) ?? null;
  // What every connected agent's webhook should say. Null on a misconfigured
  // deployment — no point flagging rows against a URL that is itself wrong.
  const expectedHook = site.isMisconfigured ? null : `${site.url}/retell/call-ended`;
  const connectedIds = new Set(connected.map((row) => row.retellAgentId));
  const hidden = new Set(roster?.hiddenAgentIds ?? []);
  const available = (roster?.agents ?? []).filter(
    (a) => !connectedIds.has(a.id) && !hidden.has(a.id),
  );
  const archived = (roster?.agents ?? []).filter(
    (a) => !connectedIds.has(a.id) && hidden.has(a.id),
  );

  // Connecting adopts whatever number Retell already has bound to that agent,
  // so inboundNumber stops being hand-typed into agreement with the provider.
  const add = (agentId: string) => {
    const bound = roster?.phoneNumbers.find((n) => n.agentId === agentId)?.number;
    void connect({ retellAgentId: agentId, inboundNumber: bound });
    setAdding(false);
  };

  const status = !roster
    ? null
    : roster.configured
      ? null
      : roster.error
        ? t("settings.voiceUnreachable")
        : t("settings.voiceNotProvisioned");

  return (
    // Not a Card: the table is the main actor and frames itself. The fieldset
    // is the one job the card chrome was doing — staff see all of this
    // read-only — and it stays, invisible (min-w-0 per Card's own lesson).
    <fieldset disabled={!isOwner} className={`min-w-0 ${!isOwner ? "opacity-70" : ""}`}>
      {connected.length > 0 && (
        <div className="mb-3 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
          {/* min-w-full, not w-full. w-full pins the table to the container and
              the cells overflow it anyway — the Enabled toggle and the
              disconnect button were clipped at the card edge with nothing to
              grab. min-w-full lets the table size to its content so the
              overflow-x-auto above actually has something to scroll. */}
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--table-header-bg)] text-left text-xs text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">{t("settings.voiceAgent")}</th>
                <th className="px-3 py-2 font-medium">{t("settings.inboundNumber")}</th>
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
                return (
                  <Fragment key={row._id}>
                  <tr className="group border-t border-[var(--border)]">
                    {/* An agent the account no longer lists — renamed, deleted,
                        or a key repointed at a different Retell account. Show
                        the raw id rather than a blank cell: calls still route
                        to it, so silence here would read as "nothing wired". */}
                    <td className="whitespace-nowrap px-3 py-2">
                      {/* The name opens the agent itself — prompt, webhook,
                          variables, test call. A ghost row opens too: the
                          detail is where you find out what the id points at. */}
                      <button
                        type="button"
                        onClick={() => setDetailId(row.retellAgentId)}
                        className="underline-offset-2 hover:underline"
                      >
                        {agent ? (
                          agent.name
                        ) : (
                          <span className="font-mono text-xs text-amber-600 dark:text-amber-400">
                            {row.retellAgentId}
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
                    <td className="px-3 py-2">
                      {/* The account's real numbers, not a text field. Free
                          text here was how inboundNumber drifted out of
                          agreement with Retell — and an empty field rendered
                          its placeholder in a way that read as a value. */}
                      <select
                        value={row.inboundNumber ?? ""}
                        onChange={(e) =>
                          void update({ agentId: row._id, inboundNumber: e.target.value })
                        }
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
                      >
                        <option value="">{t("settings.voiceNoNumber")}</option>
                        {(roster?.phoneNumbers ?? []).map((n) => (
                          <option key={n.number} value={n.number}>
                            {n.number}
                          </option>
                        ))}
                        {/* A stored number the account no longer lists still
                            renders, so the row shows the truth rather than
                            silently snapping to None. */}
                        {row.inboundNumber &&
                          !roster?.phoneNumbers.some((n) => n.number === row.inboundNumber) && (
                            <option value={row.inboundNumber}>{row.inboundNumber}</option>
                          )}
                      </select>
                    </td>
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
                          // itself survives, only the link goes.
                          const name = agent?.name ?? row.retellAgentId;
                          if (
                            window.confirm(
                              t("settings.voiceDisconnectConfirm").replace("{name}", name),
                            )
                          ) {
                            void disconnect({ agentId: row._id });
                          }
                        }}
                      >
                        ✕
                      </ActionTip>
                    </td>
                  </tr>
                  {openInfo === row.retellAgentId && (
                    <tr className="bg-[var(--muted-bg)]">
                      <td colSpan={4} className="px-3 pb-3 pt-1">
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
                  {/* Broken plumbing, said as a symptom. The owner reads
                      "results are not arriving" and presses Fix; the word
                      webhook stays our problem. */}
                  {agent && expectedHook && !wired && (
                    <tr className="border-t border-[var(--border)] bg-amber-50 dark:bg-amber-950/30">
                      <td colSpan={4} className="px-3 py-2">
                        <span className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                          {t("settings.voiceNotReceiving")}
                          {wiring === row.retellAgentId ? (
                            <span className="animate-pulse">{t("voiceDetail.wiring")}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setWiring(row.retellAgentId);
                                setWireError(null);
                                void wireWebhook({ agentId: row.retellAgentId })
                                  .then(() => load())
                                  .catch((e: Error) => setWireError(e.message))
                                  .finally(() => setWiring(null));
                              }}
                              className="rounded-lg border border-amber-300 px-2 py-0.5 font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-950/60"
                            >
                              {t("settings.voiceFix")}
                            </button>
                          )}
                          {wireError && wiring === null && (
                            <code className="text-[11px] opacity-70">{wireError}</code>
                          )}
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
        {roster?.error && <code className="ml-2 text-xs opacity-60">{roster.error}</code>}
        {roster?.configured && connected.length === 0 && available.length === 0
          ? t("settings.voiceNoAgents")
          : null}
      </p>

      <div className="mt-2 flex items-center gap-1">
        {/* Adding opens a sheet. A permanent picker under the table would be a
            question the page asks on every visit to pay for a task done once. */}
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={available.length === 0}
          className="rounded-lg px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--muted-bg)] disabled:opacity-40"
        >
          {t("settings.voiceConnect")}
        </button>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--muted-bg)] disabled:opacity-50"
        >
          {t("settings.voiceRefresh")}
        </button>
      </div>

      {detailId && <VoiceAgentDetail agentId={detailId} onClose={() => setDetailId(null)} />}

      {adding && (
        <Sheet title={t("settings.voiceConnect")} onClose={() => setAdding(false)}>
          <div className="space-y-1">
            {available.map((agent) => (
              <div key={agent.id} className="group/pick flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => add(agent.id)}
                  className="block min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--muted-bg)]"
                >
                  <div className="font-medium">{agent.name}</div>
                  {agent.collects.length > 0 && (
                    <div className="text-xs text-[var(--muted)]">{agent.collects.join(", ")}</div>
                  )}
                </button>
                {/* Our bookkeeping, not Retell's: the agent survives, it just
                    stops cluttering this picker. */}
                <button
                  type="button"
                  onClick={() =>
                    void setAgentArchived({ retellAgentId: agent.id, archived: true }).then(
                      load,
                    )
                  }
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)] focus-visible:opacity-100 group-hover/pick:opacity-100"
                >
                  {t("settings.voiceArchive")}
                </button>
              </div>
            ))}
            {archived.length > 0 && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowArchived((s) => !s)}
                  className="rounded-lg px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  {showArchived
                    ? t("settings.voiceHideArchived")
                    : t("settings.voiceShowArchived").replace("{n}", String(archived.length))}
                </button>
                {showArchived &&
                  archived.map((agent) => (
                    <div
                      key={agent.id}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-[var(--muted)]"
                    >
                      <span className="truncate">{agent.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          void setAgentArchived({
                            retellAgentId: agent.id,
                            archived: false,
                          }).then(load)
                        }
                        className="shrink-0 rounded-lg px-2 py-1 text-xs hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
                      >
                        {t("settings.voiceRestore")}
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </Sheet>
      )}

    </fieldset>
  );
}
