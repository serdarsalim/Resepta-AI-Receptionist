"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useHeaderSearch } from "@/lib/HeaderSearch";
import { useLanguage } from "@/lib/LanguageProvider";
import { LANGUAGES, type TranslationKey } from "@/lib/i18n";
import { resolveSiteUrl } from "@/lib/siteUrl";
import { useToast } from "@/lib/ToastProvider";
import { Card } from "./Card";
import { McpCard } from "./McpCard";
import { InlineEditValue } from "./RecordField";
import { ROW_GRID, RowLabel } from "./RowLabel";
import { Toggle } from "./Toggle";

// The signed-in person's own settings, reached ONLY from the avatar menu.
// Everything here is user-scoped: their name, their address, their alerts.
// Nothing on this page changes the business — org config lives in the Business
// and Settings destinations in the sidebar, because those are shared by the
// whole team and this page is not.
//
// Rows use the shared ROW_GRID from RowLabel: label column 220-260px, label
// only, control on the right, one column on phones. Explanations hide behind
// the (i) on the label, never as a paragraph under the control.

// A read-only value in the control column. Plain text, not a disabled input:
// a greyed-out box invites a click that will never do anything.
function StaticValue({ children }: { children: React.ReactNode }) {
  return <span className="block min-w-0 break-words text-sm">{children}</span>;
}

// Which card each row lives on. Hand-maintained for the same reason Business's
// index is: the rows are spread across three card bodies with no runtime
// register to enumerate, so add a line when you add a row. Forgetting costs one
// unfindable name and nothing else. Never index a key that is not in i18n.ts.
const SEARCH_INDEX: { card: AccountCard; key: TranslationKey }[] = [
  { card: "profile", key: "account.name" },
  { card: "profile", key: "account.email" },
  { card: "profile", key: "account.role" },
  { card: "profile", key: "account.language" },
  { card: "notifications", key: "account.notifications" },
  { card: "notifications", key: "account.notifyInbound" },
  { card: "notifications", key: "account.notifyFailed" },
  { card: "notifications", key: "account.notifyNewContact" },
  { card: "ai", key: "settings.ai" },
  { card: "ai", key: "mcp.endpoint" },
];

type AccountCard = "profile" | "notifications" | "ai";

const CARD_LABEL: Record<AccountCard, TranslationKey> = {
  profile: "account.title",
  notifications: "account.notifications",
  ai: "settings.ai",
};

export function AccountView() {
  const { t } = useLanguage();
  const profile = useQuery(api.users.myProfile, {});
  const saveProfile = useMutation(api.users.setMyProfile);
  const toast = useToast();
  // Claims the header's box, the same corner Business, Customers and Inbox use.
  // Account took the ✕'s place here: the header holds one control on the right,
  // and this page now runs past the fold, so a way to jump down it beats a way
  // to close it that the sidebar already provides.
  const search = useHeaderSearch(t("common.search"));
  // Scrolled to rather than switched to, because unlike Business's sections all
  // three cards live on one page. The answer to "where is that setting" is a
  // position, not a different pane.
  const cardRefs = useRef<Record<AccountCard, HTMLDivElement | null>>({
    profile: null,
    notifications: null,
    ai: null,
  });
  // Held in state and consumed by an effect rather than scrolled inline on the
  // click. Clearing the query unmounts the results list and remounts the cards,
  // so at click time every ref is null and there is nothing to scroll to yet. A
  // requestAnimationFrame is not enough either: one frame does not cover
  // React's re-render plus the ref callbacks. An effect runs after both, by
  // definition, which is the only timing that is actually guaranteed.
  const [pendingScroll, setPendingScroll] = useState<AccountCard | null>(null);
  useEffect(() => {
    if (!pendingScroll) return;
    // No behavior: "smooth". It silently does nothing on this shell's `main`
    // (verified: same call scrolls 0 to 109 with the default, and stays at 0
    // with smooth), so asking for it buys an animation that never runs and
    // costs the scroll that does. Instant is also the honest answer here, since
    // the reader asked to be taken somewhere.
    cardRefs.current[pendingScroll]?.scrollIntoView({ block: "start" });
    setPendingScroll(null);
  }, [pendingScroll]);

  // Every write on this page goes through here, so there is no way to add a
  // field that saves silently. Autosave is right and it is also invisible —
  // people who grew up with Save buttons do not trust a screen that says
  // nothing back.
  const save = async (patch: Parameters<typeof saveProfile>[0]) => {
    await saveProfile(patch);
    toast(t("common.saved"));
  };

  if (!profile) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }

  const storedName = profile.name ?? "";

  const hits = search.active
    ? SEARCH_INDEX.filter((entry) => search.matches(t(entry.key)))
    : [];

  // Same grammar as Business: searching replaces the body with a list of places
  // to go, and picking one clears the query, because the search is done the
  // moment it has taken you somewhere. The difference is where it takes you.
  if (search.active) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 page-stack">
        {hits.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("table.noMatches")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            {hits.map((entry, i) => (
              <button
                key={`${entry.card}:${entry.key}`}
                type="button"
                onClick={() => {
                  search.setQuery("");
                  setPendingScroll(entry.card);
                }}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--muted-bg)] ${
                  i > 0 ? "border-t border-[var(--border)]" : ""
                }`}
              >
                <span className="text-sm">{t(entry.key)}</span>
                <span className="shrink-0 text-xs text-[var(--muted)]">
                  {t(CARD_LABEL[entry.card])}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 page-stack">
      <div ref={(node) => void (cardRefs.current.profile = node)}>
      <Card>
        <div className={ROW_GRID}>
          {/* Values, not a form. Same pattern the contact record uses: read as
              text, click to edit, commit on blur or Enter. A row of permanently
              open input boxes reads as work waiting to be done, and this page
              is mostly things you look at once. */}
          <RowLabel label={t("account.name")} hint={t("account.nameHint")} />
          <InlineEditValue
            value={storedName}
            onSave={(next) => {
              // Blanking the field is almost always a slip, and an empty name
              // would leave the members list showing nobody.
              if (!next || next === storedName) return;
              return save({ name: next });
            }}
          />

          <RowLabel label={t("account.email")} hint={t("account.emailHint")} />
          <StaticValue>{profile.email}</StaticValue>

          <RowLabel label={t("account.role")} />
          <StaticValue>
            {t(profile.role === "owner" ? "role.owner" : "role.staff")}
          </StaticValue>

          {/* "App language", not "Your language": in a business whose other
              language setting decides what tongue customers are written in,
              "your language" reads as the one you speak. This one only changes
              what YOU see, and the label should be the thing that says so. */}
          <RowLabel
            label={t("account.language")}
            hint={t("account.languageHint")}
          />
          <InlineEditValue
            value={profile.language}
            options={LANGUAGES.map((entry) => entry.code)}
            labelFor={(code) =>
              LANGUAGES.find((entry) => entry.code === code)?.label ?? code
            }
            onSave={(next) => next && save({ language: next })}
          />
        </div>
      </Card>
      </div>

      <div ref={(node) => void (cardRefs.current.notifications = node)}>
      <Card title={t("account.notifications")}>
        <div className={ROW_GRID}>
          <RowLabel
            label={t("account.notifyInbound")}
            hint={t("account.notifyInboundHint")}
          />
          <Toggle
            checked={profile.notifyInbound}
            label={t("account.notifyInbound")}
            onChange={(next) => void save({ notifyInbound: next })}
          />

          <RowLabel
            label={t("account.notifyFailed")}
            hint={t("account.notifyFailedHint")}
          />
          <Toggle
            checked={profile.notifyFailedSend}
            label={t("account.notifyFailed")}
            onChange={(next) => void save({ notifyFailedSend: next })}
          />

          <RowLabel
            label={t("account.notifyNewContact")}
            hint={t("account.notifyNewContactHint")}
          />
          <Toggle
            checked={profile.notifyNewContact}
            label={t("account.notifyNewContact")}
            onChange={(next) => void save({ notifyNewContact: next })}
          />
        </div>
      </Card>
      </div>

      {/* Moved here from Business (2026-08-12). An MCP key is per PERSON, not
          per salon: McpCard is deliberately outside the owner-only fieldset,
          a stylist mints and revokes their own, and only an owner can revoke
          somebody else's. Filed under Business it read as salon configuration
          that an owner administers, which is the opposite of how it works.
          This page is the one that means "me, in this workspace". */}
      <div ref={(node) => void (cardRefs.current.ai = node)}>
        <McpCard site={resolveSiteUrl()} />
      </div>
    </div>
  );
}
