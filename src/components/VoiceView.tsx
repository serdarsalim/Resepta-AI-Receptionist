"use client";

import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { resolveSiteUrl } from "@/lib/siteUrl";
import { useQuery } from "convex/react";
import { Card } from "./Card";
import { VoiceCard } from "./VoiceCard";

// The phone agent's own sidebar destination. Settings is where a salon
// configures things once; the phone rings every day. Two sections: the agents
// (moved out of Settings) and the calls themselves — recording, transcript,
// summary — so hearing yesterday's call never means opening Retell.

type VoiceSection = "agents" | "calls";

function fmtDuration(sec: number | null): string {
  if (sec === null) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function CallHistory() {
  const { t } = useLanguage();
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
    customerName: string | null;
  };
  const calls = results as CallRow[];

  if (status !== "LoadingFirstPage" && calls.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{t("settings.voiceNoCalls")}</p>;
  }

  return (
    <div className="space-y-2">
      {calls.map((c) => {
        const isOpen = open === c._id;
        return (
          <Card key={c._id}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : c._id)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left"
            >
              <span className="text-sm font-medium">
                {c.customerName || c.fromNumber || t("calls.unknown")}
              </span>
              <span className="text-xs text-[var(--muted)]">
                {new Date(c.startedAt).toLocaleString()}
              </span>
              {c.durationSec !== null && (
                <span className="text-xs text-[var(--muted)]">
                  {fmtDuration(c.durationSec)}
                </span>
              )}
              {c.outcome && (
                <span className="ml-auto rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
                  {c.outcome}
                </span>
              )}
            </button>

            {isOpen && (
              <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
                {c.recordingUrl && (
                  <div>
                    <div className="mb-1 text-xs font-medium">{t("calls.recording")}</div>
                    <audio controls src={c.recordingUrl} className="h-9 w-full" />
                  </div>
                )}
                {c.summary && (
                  <div>
                    <div className="mb-1 text-xs font-medium">{t("calls.summary")}</div>
                    <p className="text-sm text-[var(--muted)]">{c.summary}</p>
                  </div>
                )}
                {c.transcript && (
                  <div>
                    <div className="mb-1 text-xs font-medium">{t("calls.transcript")}</div>
                    <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--muted-bg)] p-3 font-sans text-xs leading-relaxed">
                      {c.transcript}
                    </pre>
                  </div>
                )}
                {!c.recordingUrl && !c.summary && !c.transcript && (
                  <p className="text-xs text-[var(--muted)]">{t("calls.nothingCaptured")}</p>
                )}
              </div>
            )}
          </Card>
        );
      })}

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
  const me = useQuery(api.orgs.current, {});
  const site = resolveSiteUrl();
  const isOwner = me ? me.me.role !== "staff" : false;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-1">
        {(
          [
            { id: "agents" as const, label: t("voice.agents") },
            { id: "calls" as const, label: t("settings.voiceCalls") },
          ] as { id: VoiceSection; label: string }[]
        ).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setSection(entry.id)}
            aria-current={section === entry.id ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              section === entry.id
                ? "bg-[var(--accent)] font-medium text-[var(--accent-fg)]"
                : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {section === "agents" && <VoiceCard isOwner={isOwner} site={site} />}
      {section === "calls" && <CallHistory />}
    </div>
  );
}
