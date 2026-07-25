"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { useLanguage } from "@/lib/LanguageProvider";
import { Card } from "./Card";
import { Toggle } from "./Toggle";
import { InlineEditValue } from "./RecordField";

// Workspace setup: how this business is SHAPED. Who works here, what it
// sells, and what a customer record holds. Settings next door is the other
// half, the connections and the sending rules.
//
// Nudge splits the same way (its Workspace setup tab holds fields and
// categories while Settings holds accounts and channels), and the split is
// what keeps a salon owner from hunting through one long scroll.
export function WorkspaceSetupView() {
  const { t } = useLanguage();
  const settings = useQuery(api.orgs.current, {});
  if (!settings) return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  // The backend enforces this too (requireOwner); the fieldsets are honest UI.
  const isOwner = settings.me.role !== "staff";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {!isOwner && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--muted-bg)] px-3 py-2 text-xs text-[var(--muted)]">
          {t("settings.ownerOnly")}
        </p>
      )}
      <TeamCard isOwner={isOwner} />
      <ServicesCard isOwner={isOwner} />
      <FieldsCard isOwner={isOwner} />
    </div>
  );
}

function TeamCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const team = useQuery(api.team.overview, {});
  const invite = useMutation(api.team.invite);
  const revokeInvite = useMutation(api.team.revokeInvite);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title={t("team.title")} tip={t("team.inviteHint")}>
      {team === undefined ? (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y divide-[var(--border)]">
            {team.members.map((member) => (
              <li key={member._id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="truncate font-medium">
                    {member.name || member.email}
                    {member.isMe && (
                      <span className="ml-1 text-xs text-[var(--muted)]">
                        ({t("team.you")})
                      </span>
                    )}
                  </span>
                  {member.name && member.email && (
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {member.email}
                    </span>
                  )}
                </span>
                <span className="rounded-full bg-[var(--muted-bg)] px-2 py-0.5 text-xs text-[var(--muted)]">
                  {member.role === "staff" ? t("role.staff") : t("role.owner")}
                </span>
              </li>
            ))}
            {team.pending.map((pendingInvite) => (
              <li key={pendingInvite._id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="truncate text-[var(--muted)]">{pendingInvite.email}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {t("team.pending")} ·{" "}
                    {pendingInvite.role === "staff" ? t("role.staff") : t("role.owner")}
                  </span>
                </span>
                {isOwner && (
                  <button
                    className="rounded-md px-2 py-1 text-xs text-red-600 transition-colors hover:bg-[var(--muted-bg)] dark:text-red-400"
                    onClick={() => void revokeInvite({ inviteId: pendingInvite._id })}
                  >
                    {t("team.revoke")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isOwner && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const formEl = event.currentTarget;
                const form = new FormData(formEl);
                setError(null);
                try {
                  await invite({
                    email: String(form.get("email") ?? ""),
                    role: form.get("role") === "owner" ? "owner" : "staff",
                  });
                  formEl.reset();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "error");
                }
              }}
            >
              <input
                name="email"
                type="email"
                required
                placeholder="ornek@gmail.com"
                className="w-56"
              />
              <select name="role" defaultValue="staff" className="w-auto">
                <option value="staff">{t("role.staff")}</option>
                <option value="owner">{t("role.owner")}</option>
              </select>
              <button
                type="submit"
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
              >
                {t("team.invite")}
              </button>
              {error && (
                <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

// Services are what the salon sells, and the duration is what sizes the block
// on the calendar, so an empty list is not a cosmetic gap: bookings have
// nothing to pick and every appointment falls back to 30 minutes.
function ServicesCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const services = useQuery(api.services.list, {});
  const create = useMutation(api.services.create);
  const update = useMutation(api.services.update);
  const remove = useMutation(api.services.remove);
  const [adding, setAdding] = useState(false);

  const rows = [...(services ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Card title={t("services.title")} tip={t("services.hint")} disabled={!isOwner}>
      {services === undefined ? (
        <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
      ) : (
        <div className="space-y-2">
          {rows.length > 0 && (
            // Column headers label their columns, so a row of toggles is never
            // an unlabelled switch.
            <div className="grid grid-cols-[1fr_7rem_4rem_4rem] items-center gap-2 px-1 text-xs text-[var(--muted)]">
              <span>{t("services.name")}</span>
              <span>{t("services.duration")}</span>
              <span>{t("services.active")}</span>
              <span />
            </div>
          )}
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((service) => (
              <li
                key={service._id}
                className="group grid grid-cols-[1fr_7rem_4rem_4rem] items-center gap-2 py-1.5 text-sm"
              >
                <InlineEditValue
                  value={service.name}
                  onSave={(next) =>
                    next && update({ serviceId: service._id, name: next })
                  }
                />
                <span className="flex items-center gap-0.5">
                  <InlineEditValue
                    value={String(service.durationMinutes)}
                    type="number"
                    compact
                    onSave={(next) =>
                      Number(next) > 0 &&
                      update({ serviceId: service._id, durationMinutes: Number(next) })
                    }
                  />
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {t("services.minutes")}
                  </span>
                </span>
                <Toggle
                  checked={service.active}
                  label={t("services.active")}
                  onChange={(next) =>
                    void update({ serviceId: service._id, active: next })
                  }
                />
                <button
                  onClick={() => void remove({ serviceId: service._id })}
                  className="justify-self-end rounded-md px-2 py-1 text-xs text-red-600 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 dark:text-red-400"
                >
                  {t("common.delete")}
                </button>
              </li>
            ))}
          </ul>

          {/* Inline row, not a modal: click add, type, Enter saves. */}
          {adding ? (
            <form
              className="flex flex-wrap items-end gap-2 pt-1"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const name = String(form.get("name") ?? "").trim();
                if (!name) return setAdding(false);
                await create({
                  name,
                  durationMinutes: Number(form.get("durationMinutes")) || 30,
                });
                setAdding(false);
              }}
            >
              <label className="block text-sm">
                {t("services.name")}
                <input name="name" required autoFocus className="mt-1 block w-56" />
              </label>
              <label className="block text-sm">
                {t("services.duration")}
                <input
                  name="durationMinutes"
                  type="number"
                  min={5}
                  step={5}
                  defaultValue={30}
                  className="mt-1 block w-24"
                />
              </label>
              <button
                type="submit"
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
              >
                {t("common.add")}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              >
                {t("common.cancel")}
              </button>
            </form>
          ) : (
            isOwner && (
              <button
                onClick={() => setAdding(true)}
                className="rounded-md px-2 py-1 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
              >
                + {t("services.add")}
              </button>
            )
          )}
        </div>
      )}
    </Card>
  );
}

function FieldsCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useLanguage();
  const fields = useQuery(api.contactFields.list, {});
  const createField = useMutation(api.contactFields.create);
  const removeField = useMutation(api.contactFields.remove);
  const [type, setType] = useState<"text" | "select" | "number" | "date">("text");
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title={t("fields.title")} tip={t("fields.hint")} disabled={!isOwner}>
      <ul className="mb-3 divide-y divide-[var(--border)]">
        {(fields ?? []).map((field) => (
          <li key={field._id} className="group flex items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{field.label}</span>
              <span className="ml-2 text-xs text-[var(--muted)]">
                {t(`fields.type.${field.type}` as "fields.type.text")}
                {field.options?.length ? ` · ${field.options.join(", ")}` : ""}
              </span>
            </span>
            {isOwner && (
              <button
                className="rounded-md px-2 py-1 text-xs text-red-600 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 dark:text-red-400"
                onClick={() => void removeField({ fieldId: field._id })}
              >
                {t("common.delete")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const formEl = event.currentTarget;
            const form = new FormData(formEl);
            setError(null);
            try {
              await createField({
                label: String(form.get("label") ?? ""),
                type,
                options:
                  type === "select"
                    ? String(form.get("options") ?? "")
                        .split(",")
                        .map((o) => o.trim())
                        .filter(Boolean)
                    : undefined,
              });
              formEl.reset();
            } catch (err) {
              setError(err instanceof Error ? err.message : "error");
            }
          }}
        >
          <label className="block text-sm">
            {t("fields.label")}
            <input name="label" required className="mt-1 block w-44" />
          </label>
          <label className="block text-sm">
            {t("fields.typeLabel")}
            <select
              className="mt-1 block w-auto"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="text">{t("fields.type.text")}</option>
              <option value="select">{t("fields.type.select")}</option>
              <option value="number">{t("fields.type.number")}</option>
              <option value="date">{t("fields.type.date")}</option>
            </select>
          </label>
          {type === "select" && (
            <label className="block text-sm">
              {t("fields.options")}
              <input name="options" className="mt-1 block w-56" />
            </label>
          )}
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
          >
            {t("fields.add")}
          </button>
          {error && <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>}
        </form>
      )}
    </Card>
  );
}
