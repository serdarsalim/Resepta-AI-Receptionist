"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { Card } from "./Card";
import { RowLabel } from "./RowLabel";
import { Toggle } from "./Toggle";

// The signed-in person's own settings, reached ONLY from the avatar menu.
// Everything here is user-scoped: their name, their address, their alerts.
// Nothing on this page changes the business — org config lives in the Business
// and Settings destinations in the sidebar, because those are shared by the
// whole team and this page is not.
//
// Settings row grid, per the documented spec: label column 220-260px, label
// only, control on the right, one column on phones. Explanations hide behind
// the (i) on the label, never as a paragraph under the control.
const ROW_GRID =
  "grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-[minmax(220px,260px)_1fr] sm:items-start";

// A read-only value in the control column. Plain text, not a disabled input:
// a greyed-out box invites a click that will never do anything.
function StaticValue({ children }: { children: React.ReactNode }) {
  return <span className="block min-w-0 break-words text-sm">{children}</span>;
}

export function AccountView() {
  const { t } = useLanguage();
  const profile = useQuery(api.users.myProfile, {});
  const save = useMutation(api.users.setMyProfile);

  if (!profile) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }

  const storedName = profile.name ?? "";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <div className={ROW_GRID}>
          <RowLabel label={t("account.name")} hint={t("account.nameHint")} />
          <input
            defaultValue={storedName}
            onBlur={(e) => {
              const next = e.target.value.trim();
              // Blanking the field is almost always a slip, and an empty name
              // would leave the members list showing nobody. Put the stored
              // value back rather than saving the wipe.
              if (!next) {
                e.target.value = storedName;
                return;
              }
              if (next === storedName) return;
              void save({ name: next });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />

          <RowLabel label={t("account.email")} hint={t("account.emailHint")} />
          <StaticValue>{profile.email}</StaticValue>

          <RowLabel label={t("account.role")} />
          <StaticValue>
            {t(profile.role === "owner" ? "role.owner" : "role.staff")}
          </StaticValue>
        </div>
      </Card>

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
        </div>
      </Card>
    </div>
  );
}
