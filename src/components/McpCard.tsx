"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useConfirm } from "./ConfirmDialog";
import { useLanguage } from "@/lib/LanguageProvider";
import { type SiteUrl } from "@/lib/siteUrl";
import { ActionTip, InfoTip } from "./InfoTip";
import { Card } from "./Card";

// Connect Claude or ChatGPT to this workspace. The backend (mcpKeys) was
// self-serve from the start; this card is what makes that true in practice —
// before it, minting a key took a CLI command only the operator knew existed.
//
// Deliberately NOT wrapped in the owner-only fieldset: keys are per person.
// A stylist mints their own and can revoke their own; only an owner can
// revoke someone else's, and the backend enforces both.

export function McpCard({ site }: { site: SiteUrl }) {
  const { t } = useLanguage();
  const keys = useQuery(api.mcpKeys.list, {});
  const create = useMutation(api.mcpKeys.create);
  const revoke = useMutation(api.mcpKeys.revoke);
  const [confirm, confirmDialog] = useConfirm();

  // The raw key exists in the browser only inside this state, only until the
  // section unmounts. list() serves masked tails; there is no read-it-back.
  const [minted, setMinted] = useState<{ key: string; client: "claude" | "chatgpt" } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // The one refusal this card can hit: an operator inside a tenant. Said out
  // loud, because the alternative was a button that appeared to work and
  // handed back a key that never would.
  const [refused, setRefused] = useState(false);

  const endpoint = site.isMisconfigured ? null : `${site.url}/mcp`;

  const copy = (what: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const mint = (client: "claude" | "chatgpt") => {
    setBusy(true);
    setRefused(false);
    void create({ client })
      .then((key) => setMinted({ key, client }))
      .catch(() => setRefused(true))
      .finally(() => setBusy(false));
  };

  const when = (ms: number) => new Date(ms).toLocaleDateString();

  // Titled since the move to Account: in Business the chip strip named this
  // card, and here it is the third card in a stack with nothing to name it.
  // The intro moved onto the title's (i) at the same time, which is where
  // explanatory copy belongs. A two-line paragraph at the top of a card is the
  // verbose card intro the design language rules out.
  return (
    <Card title={t("settings.ai")} tip={t("mcp.intro")}>
      {confirmDialog}
      {/* pb-2 on top of Card's own p-4. This card ends in a list of bordered
          key rows rather than a form control, and a bordered row landing 16px
          off the card's own border reads as two edges crowding each other.
          Local to this card, not pushed into Card, because every other card
          ends in an input where p-4 is right. */}
      <div className="space-y-4 pb-2">
        {refused && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            {t("mcp.actingAsCannotMint")}
          </p>
        )}

        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
            {t("mcp.endpoint")}
            <InfoTip text={t("mcp.endpointHint")} />
          </div>
          {endpoint ? (
            <button
              type="button"
              onClick={() => copy("endpoint", endpoint)}
              title={t("settings.formEmbedCopy")}
              className="block w-full overflow-x-auto rounded-lg bg-[var(--muted-bg)] px-2 py-1.5 text-left font-mono text-xs hover:opacity-80"
            >
              {copied === "endpoint" ? t("common.copied") : endpoint}
            </button>
          ) : (
            <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              {t("settings.voiceEndpointsBroken")}
            </p>
          )}
        </div>

        {minted ? (
          <div className="space-y-2 rounded-lg border border-[var(--accent)] p-3">
            <p className="text-xs font-medium">{t("mcp.keyOnce")}</p>
            <button
              type="button"
              onClick={() => copy("key", minted.key)}
              className="block w-full overflow-x-auto rounded-lg bg-[var(--muted-bg)] px-2 py-1.5 text-left font-mono text-xs hover:opacity-80"
            >
              {copied === "key" ? t("common.copied") : minted.key}
            </button>
            <p className="text-xs text-[var(--muted)]">
              {minted.client === "claude"
                ? t("mcp.instructionsClaude")
                : t("mcp.instructionsChatgpt")}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !endpoint}
              onClick={() => mint("claude")}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {t("mcp.connectClaude")}
            </button>
            <button
              type="button"
              disabled={busy || !endpoint}
              onClick={() => mint("chatgpt")}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--muted-bg)] disabled:opacity-40"
            >
              {t("mcp.connectChatgpt")}
            </button>
          </div>
        )}

        <div className="space-y-1">
          {(keys ?? []).length === 0 && (
            <p className="text-xs text-[var(--muted)]">{t("mcp.none")}</p>
          )}
          {(keys ?? []).map((k) => (
            <div
              key={k._id}
              className={`flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs ${
                k.revoked ? "opacity-50" : ""
              }`}
            >
              <span className="font-medium">{k.name}</span>
              <code className="text-[var(--muted)]">{k.masked}</code>
              <span className="text-[var(--muted)]">{k.ownerName}</span>
              <span className="ml-auto whitespace-nowrap text-[var(--muted)]">
                {k.revoked
                  ? t("mcp.revoked")
                  : k.lastUsedAt
                    ? t("mcp.lastUsed").replace("{when}", when(k.lastUsedAt))
                    : t("mcp.neverUsed")}
              </span>
              {!k.revoked && (
                <ActionTip
                  label={t("mcp.revoke")}
                  onClick={() => {
                    void (async () => {
                      const ok = await confirm({
                        title: t("mcp.revokeConfirm").replace("{name}", k.name),
                        confirmLabel: t("mcp.revoke"),
                      });
                      if (ok) await revoke({ id: k._id });
                    })();
                  }}
                >
                  ✕
                </ActionTip>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
