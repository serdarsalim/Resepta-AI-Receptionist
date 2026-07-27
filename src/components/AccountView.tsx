"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { LANGUAGES } from "@/lib/i18n";
import { useToast } from "@/lib/ToastProvider";
import { Card } from "./Card";
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

export function AccountView() {
  const { t } = useLanguage();
  const profile = useQuery(api.users.myProfile, {});
  const saveProfile = useMutation(api.users.setMyProfile);
  const toast = useToast();

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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
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
  );
}
