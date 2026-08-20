"use client";

import { usePaginatedQuery } from "convex/react";
import { Fragment, useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatDateTime } from "@/lib/datetime";
import { resolveSiteUrl } from "@/lib/siteUrl";
import { useQuery } from "convex/react";
import { CallDetail, CallOutcomePill } from "./CallDetail";
import { VoiceAgentPage } from "./VoiceAgentPage";
import { VoiceCard } from "./VoiceCard";
import { KnowledgeCard } from "./KnowledgeCard";
import { FieldsCard, ServiceKeysCard } from "./BusinessView";

// The voice agent's own sidebar destination. Two sections: the agents and the
// calls themselves, including recording, transcript and summary. The provider
// stays an implementation detail; hearing yesterday's call never means opening
// another product.

// Knowledge joins the strip this view already had rather than getting a
// container of its own. It is what the agent KNOWS beyond the structured
// tables, so it belongs beside the agent that reads it — it spent its first
// life under Business, which is a fact-about-the-salon container, and that is
// the same scavenger hunt the Hours comment in BusinessView describes.
//
// Fields joined the strip on 2026-08-12 after three wrong homes. Contact fields
// are what the agent COLLECTS the way knowledge is what it KNOWS, so the two
// sit together here. The objection that killed the first attempt still stands
// on paper (the agent is one consumer among forms, campaigns, email, wa, mcp
// and the contact record) and it loses force as the chat, WhatsApp and email
// agents ship: chatAgentTemplate already reads knowledge, and this row goes
// multi-channel when they land.
//
// What it is NOT: buried at the foot of the Customers column picker, which is
// where it briefly lived. Fields ARE those columns, so the rule about rare
// actions fit the letter and missed the point. Defining what you store about a
// customer is a SETUP surface, one of the first things a new business touches,
// and a setup surface hidden inside a dropdown labelled "Columns" is not
// findable by the person who needs it most.
type VoiceSection = "agents" | "calls" | "knowledge" | "fields";

function fmtDuration(sec: number | null): string {
  if (sec === null) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function CallHistory() {
  const { t, language } = useLanguage();
  const { results, status, loadMore } = usePaginatedQuery(
    api.calls.list,
    {},
    { initialNumItems: 25 },
  );
  const [open, setOpen] = useState<string | null>(null);

  type CallRow = {
    _id: string;
    startedAt: number;
    direction: "inbound" | "outbound";
    fromNumber: string | null;
    durationSec: number | null;
    outcome: string | null;
    summary: string | null;
    transcript: string | null;
    recordingUrl: string | null;
    collected: Record<string, unknown> | null;
    disconnectionReason: string | null;
    billedMicroUsd: number | null;
    customerName: string | null;
  };
  const calls = results as CallRow[];

  if (status !== "LoadingFirstPage" && calls.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{t("settings.voiceNoCalls")}</p>;
  }

  return (
    <div className="space-y-2">
      {/* The table frames itself; a card around it was a border around a
          border. */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">{t("calls.caller")}</th>
                <th className="px-3 py-2 font-medium">{t("calls.when")}</th>
                <th className="px-3 py-2 font-medium">{t("calls.duration")}</th>
                <th className="px-3 py-2 font-medium">{t("calls.outcome")}</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const isOpen = open === c._id;
                return (
                  <Fragment key={c._id}>
                    <tr
                      onClick={() => setOpen(isOpen ? null : c._id)}
                      className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted-bg)]"
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-medium">
                        {/* fromNumber holds the CUSTOMER'S leg either way
                            (schema.ts); the arrow is what says the agent
                            dialled out, without a fifth column. */}
                        {c.direction === "outbound" && (
                          <span aria-hidden className="mr-1 text-xs text-[var(--muted)]">
                            ↗
                          </span>
                        )}
                        {c.customerName || c.fromNumber || t("calls.unknown")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--muted-strong)]">
                        {/* The org's format, not the browser's: a Turkish
                            salon was reading "7/26/2026, 8:42:26 PM". */}
                        {formatDateTime(c.startedAt, language)}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--muted-strong)]">
                        {fmtDuration(c.durationSec)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <CallOutcomePill outcome={c.outcome} />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-[var(--border)] bg-[var(--muted-bg)]">
                        <td colSpan={4} className="px-3 pb-4 pt-2">
                          <CallDetail call={c} contactName={c.customerName} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
      </div>

      {status === "CanLoadMore" && (
        <button
          type="button"
          onClick={() => loadMore(25)}
          className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
        >
          {t("calls.loadMore")}
        </button>
      )}
      {(status === "LoadingFirstPage" || status === "LoadingMore") && (
        <p className="animate-pulse text-sm text-[var(--muted)]">{t("common.loading")}</p>
      )}
    </div>
  );
}

export function VoiceView() {
  const { t } = useLanguage();
  const [section, setSection] = useState<VoiceSection>("agents");
  // The open agent lives in the URL, the same way the tab does: a page you can
  // link a colleague to, and a refresh that comes back to the prompt you were
  // editing rather than the list. Read after mount — initialising state from
  // window during render is a hydration mismatch.
  const [agentId, setAgentId] = useState<string | null>(null);
  const me = useQuery(api.orgs.current, {});
  const site = resolveSiteUrl();
  const isOwner = me ? me.me.role !== "staff" : false;

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("agent");
    if (wanted) setAgentId(wanted);
  }, []);

  // replaceState, not push: opening an agent from the list is a drill-in, and
  // filling the back stack with every agent glanced at makes Back stop meaning
  // "the page before this one". The header's own back arrow is the way out.
  const openAgent = (next: string | null) => {
    setAgentId(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("agent", next);
    else url.searchParams.delete("agent");
    window.history.replaceState(null, "", url);
  };

  if (agentId) {
    return <VoiceAgentPage agentId={agentId} onBack={() => openAgent(null)} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 page-stack">
      {/* Underline tabs, ported from Vercel and measured off it rather than
          eyeballed. The strip this replaced put a filled accent pill next to
          plain grey text, which is two different KINDS of control in one row:
          the selected item read as a button and the rest read as labels.

          Active is DARKER PLUS AN UNDERLINE, never bolder. Vercel keeps weight
          at 400 across both states and so do we, because a weight change
          reflows the strip every time you switch tabs and "nothing shifts" is
          a standing rule. Idle is --muted-strong (#4d4d4d), which is what
          Vercel uses here too; hover lifts it to --foreground.

          The hairline belongs to the STRIP and each tab overlaps it with
          -mb-px, so the active underline replaces that segment of the rule
          instead of sitting under it. */}
      <div className="flex flex-wrap items-center gap-5 border-b border-[var(--border)]">
        {(
          [
            { id: "agents" as const, label: t("voice.agents") },
            { id: "calls" as const, label: t("settings.voiceCalls") },
            { id: "knowledge" as const, label: t("knowledge.section") },
            { id: "fields" as const, label: t("fields.title") },
          ] as { id: VoiceSection; label: string }[]
        ).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setSection(entry.id)}
            aria-current={section === entry.id ? "page" : undefined}
            className={`-mb-px border-b-2 px-0.5 py-2.5 text-sm transition-colors ${
              section === entry.id
                ? "border-[var(--foreground)] text-[var(--foreground)]"
                : "border-transparent text-[var(--muted-strong)] hover:text-[var(--foreground)]"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {section === "agents" && (
        <VoiceCard isOwner={isOwner} site={site} onOpenAgent={openAgent} />
      )}
      {section === "calls" && <CallHistory />}
      {section === "knowledge" && <KnowledgeCard isOwner={isOwner} />}
      {/* Service keys ride under the contact fields: this tab is the agent's
          vocabulary — everything it knows by key — and a service's key is the
          same species of plumbing as a field's. The Services tab itself shows
          none of this; its reader is deciding prices, not addresses. */}
      {section === "fields" && (
        <div className="space-y-4">
          <FieldsCard isOwner={isOwner} />
          <ServiceKeysCard isOwner={isOwner} />
        </div>
      )}
    </div>
  );
}
