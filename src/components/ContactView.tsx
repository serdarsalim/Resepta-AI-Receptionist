"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useLanguage } from "@/lib/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/datetime";
import { Toggle } from "./Toggle";

const STATUS_KEY: Record<string, TranslationKey> = {
  scheduled: "status.scheduled",
  confirmed: "status.confirmed",
  cancelled: "status.cancelled",
  completed: "status.completed",
  no_show: "status.no_show",
};

const SESSION_WINDOW_MS = 24 * 3600_000;

// Contact profile, Nudge's ContactView pattern: properties on the left,
// the conversation on the right.
export function ContactView({
  customerId,
  onClose,
}: {
  customerId: Id<"customers">;
  onClose: () => void;
}) {
  const { t, language } = useLanguage();
  const customer = useQuery(api.customers.get, { customerId });
  const fields = useQuery(api.contactFields.list, {});
  const appointments = useQuery(api.appointments.listForCustomer, { customerId });
  const messages = useQuery(api.messages.listForCustomer, { customerId });
  const updateCustomer = useMutation(api.customers.update);
  const setCustomValue = useMutation(api.customers.setCustomValue);
  const sendSession = useAction(api.wa.sendSession);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const thread = [...(messages ?? [])].reverse();
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [thread.length]);

  if (customer === null) {
    return <p className="text-sm text-[var(--muted)]">{t("customers.none")}</p>;
  }
  if (!customer) {
    return <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>;
  }

  const windowOpen =
    !!customer.lastInboundAt && Date.now() - customer.lastInboundAt < SESSION_WINDOW_MS;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={onClose}
          className="rounded-md border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          ←
        </button>
        <h2 className="min-w-0 truncate text-base font-semibold">
          {`${customer.firstName} ${customer.lastName ?? ""}`.trim()}
        </h2>
        <span className="text-sm text-[var(--muted)]">{customer.phone}</span>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[20rem_1fr]">
        {/* Left: properties */}
        <div className="thin-scroll min-h-0 space-y-4 overflow-y-auto pr-1">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="space-y-3">
              <label className="block text-sm">
                {t("customers.firstName")}
                <input
                  className="mt-1"
                  defaultValue={customer.firstName}
                  onBlur={(e) =>
                    void updateCustomer({ customerId, firstName: e.target.value })
                  }
                />
              </label>
              <label className="block text-sm">
                {t("customers.lastName")}
                <input
                  className="mt-1"
                  defaultValue={customer.lastName ?? ""}
                  onBlur={(e) =>
                    void updateCustomer({ customerId, lastName: e.target.value })
                  }
                />
              </label>
              <label className="block text-sm">
                {t("customers.phone")}
                <input
                  className="mt-1"
                  defaultValue={customer.phone}
                  onBlur={(e) =>
                    void updateCustomer({ customerId, phone: e.target.value })
                  }
                />
              </label>
              <label className="block text-sm">
                {t("customers.email")}
                <input
                  className="mt-1"
                  defaultValue={customer.email ?? ""}
                  onBlur={(e) =>
                    void updateCustomer({ customerId, email: e.target.value })
                  }
                />
              </label>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>{t("customers.consent")}</span>
                <Toggle
                  checked={customer.consentAt !== undefined}
                  onChange={(next) => void updateCustomer({ customerId, consent: next })}
                />
              </div>
            </div>
          </section>

          {(fields ?? []).length > 0 && (
            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <h3 className="mb-2 text-sm font-semibold">{t("fields.title")}</h3>
              <div className="space-y-3">
                {(fields ?? []).map((field) => {
                  const value = customer.custom?.[field.key] ?? "";
                  const commit = (next: string) =>
                    void setCustomValue({ customerId, key: field.key, value: next });
                  return (
                    <label key={field._id} className="block text-sm">
                      {field.label}
                      {field.type === "select" ? (
                        <select
                          className="mt-1"
                          defaultValue={value}
                          onChange={(e) => commit(e.target.value)}
                        >
                          <option value="">—</option>
                          {(field.options ?? []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="mt-1"
                          type={
                            field.type === "number"
                              ? "number"
                              : field.type === "date"
                                ? "date"
                                : "text"
                          }
                          defaultValue={value}
                          onBlur={(e) => commit(e.target.value)}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="mb-2 text-sm font-semibold">{t("appointments.title")}</h3>
            {appointments === undefined && (
              <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
            )}
            {appointments?.length === 0 && (
              <p className="text-sm text-[var(--muted)]">{t("appointments.none")}</p>
            )}
            <ul className="divide-y divide-[var(--border)]">
              {(appointments ?? []).map((appointment) => (
                <li key={appointment._id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {formatDateTime(appointment.startAt, language)}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {[appointment.serviceName, appointment.staffName]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {t(STATUS_KEY[appointment.status])}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Right: conversation */}
        <div className="flex min-h-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div ref={threadRef} className="thin-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
            {messages === undefined && (
              <p className="text-sm text-[var(--muted)]">{t("common.loading")}</p>
            )}
            {messages?.length === 0 && (
              <p className="text-sm text-[var(--muted)]">{t("messages.none")}</p>
            )}
            {thread.map((message) => (
              <div
                key={message._id}
                className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                  message.direction === "out"
                    ? "ml-auto bg-[var(--brand-soft)]"
                    : "bg-[var(--muted-bg)]"
                }`}
              >
                {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
                <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                  {formatDateTime(message._creationTime, language)}
                  {message.direction === "out" && ` · ${message.status}`}
                  {message.error && ` · ${message.error}`}
                </p>
              </div>
            ))}
          </div>
          <form
            className="flex items-end gap-2 border-t border-[var(--border)] p-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const formEl = event.currentTarget;
              const body = String(new FormData(formEl).get("body") ?? "");
              if (!body.trim()) return;
              setSending(true);
              setSendError(null);
              const result = await sendSession({ customerId, body });
              setSending(false);
              if (result.ok) formEl.reset();
              else setSendError(result.reason ?? "error");
            }}
          >
            <textarea
              name="body"
              rows={2}
              placeholder={windowOpen ? t("contact.typeMessage") : t("contact.sessionClosed")}
              disabled={!windowOpen || sending}
              className="flex-1 resize-none"
            />
            <button
              type="submit"
              disabled={!windowOpen || sending}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
            >
              {t("contact.send")}
            </button>
          </form>
          {sendError && (
            <p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400">{sendError}</p>
          )}
        </div>
      </div>
    </div>
  );
}
