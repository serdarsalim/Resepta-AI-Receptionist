"use client";

import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { formatDateTimeWithWeekday } from "@/lib/datetime";
import { buttonClass, fieldClass } from "./Control";
import { CustomerPickField, type PickedCustomer } from "./CustomerPickField";

// The owner's test chat with the WhatsApp assistant (P9b of the Nudge port,
// after Nudge's ChatAgentTesting). They write as one of their customers; each
// line goes to chatAgent.simulateTurn with the conversation so far, and the
// assistant's answer comes back with what it WOULD have changed. Nothing is
// sent and nothing changes, and the conversation lives only here: closing the
// sheet forgets it.
//
// A customer is required: the assistant reads that person's card, their
// appointments and their language, which is most of what makes an answer
// right or wrong.

type Turn = FunctionReturnType<typeof api.chatAgent.simulateTurn>;
type Line =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; changes: Turn["changes"]; timezone: string };

const ERRORS: Record<string, TranslationKey> = {
  "demo-org": "chatSim.errorDemo",
  "llm-not-configured": "chatSim.errorNoModel",
  "model-unpriced": "chatSim.errorNoModel",
  "budget-exhausted": "chatSim.errorBudget",
  "org-suspended": "chatSim.errorSuspended",
  "platform-kill-switch": "chatSim.errorSuspended",
  "chat-agent-not-selected": "chatSim.errorNotSelected",
};

export function ChatSimulator({
  onBusyChange,
  onClose,
}: {
  onBusyChange?: (busy: boolean) => void;
  // A sheet holding a conversation will not close on Escape (it is typed
  // work), so the way out lives here.
  onClose: () => void;
}) {
  const { t, language } = useLanguage();
  const simulate = useAction(api.chatAgent.simulateTurn);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => onBusyChange?.(busy || lines.length > 0), [busy, lines.length, onBusyChange]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length, busy]);

  const send = () => {
    const said = text.trim();
    if (!customer || !said || busy) return;
    const next: Line[] = [...lines, { role: "user", text: said }];
    setLines(next);
    setText("");
    setError(null);
    setBusy(true);
    void simulate({
      customerId: customer.id,
      history: next.map((line) => ({ role: line.role, text: line.text })),
    })
      .then((turn) => {
        if (turn.reply) {
          setLines((current) => [
            ...current,
            {
              role: "assistant",
              text: turn.reply ?? "",
              changes: turn.changes,
              timezone: turn.timezone,
            },
          ]);
        } else {
          setError(t(ERRORS[turn.error ?? ""] ?? "chatSim.errorGeneric"));
        }
      })
      .catch(() => setError(t("chatSim.errorGeneric")))
      .finally(() => setBusy(false));
  };

  const changeText = (change: Turn["changes"][number], timezone: string) => {
    const when = (ms: number) => formatDateTimeWithWeekday(ms, language, timezone);
    const services = (list?: string[]) => (list?.length ? ` · ${list.join(", ")}` : "");
    switch (change.kind) {
      case "book":
        return (
          (change.asap ? t("chatSim.bookAsap") : t("chatSim.book", { when: when(change.at) })) +
          services(change.services)
        );
      case "move":
        return (
          t("chatSim.move", { from: when(change.from), to: when(change.to) }) +
          services(change.services)
        );
      case "cancel":
        return t("chatSim.cancel", { when: when(change.at) }) + services(change.services);
      case "save":
        return t("chatSim.save", { fields: change.labels.join(", ") });
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">{t("chatSim.hint")}</p>
      <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4">
        <span className="text-xs font-medium">{t("chatSim.chatAs")}</span>
        <div className="min-w-0">
          <CustomerPickField
            value={customer}
            onChange={(next) => {
              // Another person is another conversation.
              setCustomer(next);
              setLines([]);
              setError(null);
            }}
            disabled={busy}
            placeholder={t("agentTest.searchCustomer")}
            clearLabel={t("chatSim.reset")}
          />
        </div>
      </div>

      {/* A conversation, so bubbles: the owner's lines as the customer on the
          right, the assistant's on the left with what it would change. */}
      <div className="thin-scroll h-72 space-y-2 overflow-y-auto rounded-lg bg-[var(--muted-bg)] p-3">
        {!customer && (
          <p className="text-xs text-[var(--muted)]">{t("chatSim.pickFirst")}</p>
        )}
        {lines.map((line, index) =>
          line.role === "user" ? (
            <div key={index} className="flex justify-end">
              <p className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent-fg)]">
                {line.text}
              </p>
            </div>
          ) : (
            <div key={index} className="flex flex-col items-start gap-1">
              <p className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-[var(--card)] px-3 py-1.5 text-sm">
                {line.text}
              </p>
              {line.changes.map((change, changeIndex) => (
                <p
                  key={changeIndex}
                  className="max-w-[80%] text-xs text-emerald-700 dark:text-emerald-400"
                >
                  {changeText(change, line.timezone)}
                </p>
              ))}
            </div>
          ),
        )}
        {busy && <p className="text-xs text-[var(--muted)]">{t("chatSim.thinking")}</p>}
        <div ref={endRef} />
      </div>

      {error && <p className="text-xs text-amber-700 dark:text-amber-400">{error}</p>}

      <div className="flex items-center gap-2">
        <input
          value={text}
          disabled={!customer || busy}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={t("chatSim.placeholder")}
          className={`${fieldClass("sm")} min-w-0 flex-1`}
        />
        <button
          type="button"
          disabled={!customer || busy || !text.trim()}
          onClick={send}
          className={buttonClass("primary", "sm")}
        >
          {t("chatSim.send")}
        </button>
      </div>
      <div className="flex justify-end gap-2">
        {lines.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setLines([]);
              setError(null);
            }}
            className={buttonClass("quiet", "sm")}
          >
            {t("chatSim.reset")}
          </button>
        )}
        <button type="button" onClick={onClose} className={buttonClass("quiet", "sm")}>
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
