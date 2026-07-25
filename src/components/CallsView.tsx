"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { formatDateTime } from "@/lib/datetime";

function durationLabel(seconds?: number): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CallsView() {
  const { t, language } = useLanguage();
  const calls = useQuery(api.retell.listCalls, {});

  return (
    <div className="space-y-4">
      {calls === undefined && (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      )}
      {calls?.length === 0 && (
        <p className="text-sm text-[var(--muted)]">{t("calls.none")}</p>
      )}
      {calls && calls.length > 0 && (
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
          {calls.map((call) => (
            <li key={call._id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {call.customerName ?? call.fromNumber ?? "—"}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {formatDateTime(call.startedAt, language)}
                  {call.durationSec ? ` · ${durationLabel(call.durationSec)}` : ""}
                </span>
                {call.outcome && (
                  <span className="rounded-full bg-[var(--muted-bg)] px-2 py-0.5 text-xs text-[var(--muted)]">
                    {call.outcome}
                  </span>
                )}
                {call.recordingUrl && (
                  <a
                    href={call.recordingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-xs text-[var(--accent)] hover:underline"
                  >
                    {t("calls.recording")}
                  </a>
                )}
              </div>
              {call.summary && <p className="mt-1">{call.summary}</p>}
              {call.transcript && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-[var(--muted)]">
                    {t("calls.transcript")}
                  </summary>
                  <pre className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted)]">
                    {call.transcript}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
