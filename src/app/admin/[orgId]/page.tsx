"use client";

// One tenant's setup, in one place.
//
// This is the onboarding surface: everything an operator installs when a salon
// is wired up, and almost nothing they look at afterwards. It is deliberately
// NOT a mirror of the salon's own Settings. The split we hold to is config
// versus operation — the credentials, the webhooks and the provider accounts
// are installed once by whoever does the setup, while the reminders, the
// message wording and the daily work stay in the salon's own app where they
// belong. A field that appears on both screens is a bug in one of them.
//
// Secrets are shown masked and re-pasted to change. Nothing here reads a
// credential back to the browser; see convex/connections.ts for why.

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Connections, Failures } from "../parts";

// Label left, control right, current value underneath as a hint. Autosave on
// blur, no Save button, matching the app's own settings conventions.
function Row({
  label,
  hint,
  current,
  placeholder,
  onSave,
}: {
  label: string;
  hint?: string;
  current?: string | null;
  placeholder?: string;
  onSave: (value: string) => unknown;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-[var(--muted)]">{hint}</div>}
      </div>
      <div className="min-w-0">
        <input
          value={draft ?? current ?? ""}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft === null || draft === (current ?? "")) return;
            void onSave(draft);
            setDraft(null);
          }}
          placeholder={placeholder}
          className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
        />
      </div>
    </div>
  );
}

// A secret already installed shows its tail and an empty box. Typing replaces
// it; leaving it blank keeps what is there. An input pre-filled with a masked
// string would submit the mask as the new value the first time somebody
// tabbed through it.
function SecretRow({
  label,
  hint,
  masked,
  onSave,
}: {
  label: string;
  hint?: string;
  masked?: string | null;
  onSave: (value: string) => unknown;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 py-2 sm:grid-cols-[minmax(180px,220px)_minmax(0,26rem)] sm:items-center">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-[var(--muted)]">{hint}</div>}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-24 shrink-0 font-mono text-xs text-[var(--muted)]">
          {masked ?? "not set"}
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const value = draft.trim();
            if (!value) return;
            void onSave(value);
            setDraft("");
          }}
          placeholder={masked ? "replace…" : "paste…"}
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-sm"
        />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </section>
  );
}

export default function TenantPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId as Id<"orgs">;
  const allowed = useQuery(api.platform.amPlatformAdmin, {});
  const detail = useQuery(api.platform.orgDetail, allowed ? { orgId } : "skip");
  const setOrgConfig = useMutation(api.platform.setOrgConfig);
  const setWaAccount = useMutation(api.platform.setWaAccount);
  const actAs = useMutation(api.platform.actAs);
  const router = useRouter();

  if (allowed === undefined) {
    return <main className="mx-auto max-w-4xl p-6 text-sm text-[var(--muted)]">Loading…</main>;
  }
  if (!allowed) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          This page is for platform operators. Your own settings live in the app.
        </p>
      </main>
    );
  }
  if (detail === undefined) {
    return <main className="mx-auto max-w-4xl p-6 text-sm text-[var(--muted)]">Loading…</main>;
  }
  if (detail === null) {
    return <main className="mx-auto max-w-4xl p-6 text-sm">No such business.</main>;
  }

  const org = (patch: Omit<Parameters<typeof setOrgConfig>[0], "orgId">) =>
    setOrgConfig({ ...patch, orgId });
  // Every WhatsApp write carries phoneNumberId because it is the row's
  // identity, not an optional field: the webhook resolves an org by it.
  const wa = (patch: { phoneNumberId?: string; wabaId?: string; accessToken?: string; displayNumber?: string }) =>
    setWaAccount({
      orgId,
      phoneNumberId: patch.phoneNumberId ?? detail.wa?.phoneNumberId ?? "",
      wabaId: patch.wabaId,
      accessToken: patch.accessToken,
      displayNumber: patch.displayNumber,
    });

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <Link href="/admin" className="text-xs text-[var(--muted)] hover:underline">
          ← Fleet
        </Link>
        <h1 className="mt-1 text-lg font-semibold">
          {detail.name}
          {detail.demoMode && (
            <span className="ml-2 rounded-lg bg-[var(--muted-bg)] px-2 py-0.5 text-xs font-normal text-[var(--muted)]">
              demo
            </span>
          )}
        </h1>
        <p className="text-xs text-[var(--muted)]">
          {detail.timezone} · {detail.language} · {detail.agents.length}{" "}
          {detail.agents.length === 1 ? "agent" : "agents"}
        </p>
        {/* Everything below this line is config the operator installs. This
            button is for the rest: the things that only exist inside the
            product, where the fix is three taps in their own Appointments
            screen and no amount of admin fields would have reached it. */}
        <button
          type="button"
          onClick={() => {
            void actAs({ orgId }).then(() => router.push("/"));
          }}
          className="mt-2 rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--muted-bg)]"
        >
          Work in this account as Autotakt
        </button>
      </header>

      <Section title="Voice">
        {/* The Retell key. Each client has their own account, so this is the
            one field that decides whose agents the salon's own Settings will
            list back to them. */}
        <Connections orgId={orgId} />
        {detail.agents.length === 0 ? (
          <p className="py-2 text-xs text-[var(--muted)]">
            No agents connected. The salon picks theirs in Settings once the key is in.
          </p>
        ) : (
          detail.agents.map((agent) => (
            <div
              key={agent.retellAgentId}
              className="flex flex-wrap items-center gap-x-3 py-2 text-xs"
            >
              <span className="font-mono">{agent.retellAgentId}</span>
              <span className="text-[var(--muted)]">{agent.inboundNumber ?? "no number"}</span>
              <span className={agent.enabled ? "text-[var(--muted)]" : "text-amber-600 dark:text-amber-400"}>
                {agent.enabled ? "on" : "off"}
              </span>
            </div>
          ))
        )}
      </Section>

      <Section title="WhatsApp">
        <Row
          label="Phone number ID"
          hint="Meta's phone_number_id. Inbound resolves the org by this."
          current={detail.wa?.phoneNumberId}
          placeholder="123456789012345"
          onSave={(value) => wa({ phoneNumberId: value })}
        />
        <Row
          label="WABA ID"
          current={detail.wa?.wabaId}
          onSave={(value) => wa({ wabaId: value })}
        />
        <Row
          label="Display number"
          hint="What the salon sees. Cosmetic."
          current={detail.wa?.displayNumber}
          placeholder="+905321234567"
          onSave={(value) => wa({ displayNumber: value })}
        />
        <SecretRow
          label="Access token"
          masked={detail.wa?.accessToken}
          onSave={(value) => wa({ accessToken: value })}
        />
      </Section>

      <Section title="Bookings">
        <SecretRow
          label="cal.com API key"
          masked={detail.calcomApiKey}
          onSave={(value) => org({ calcomApiKey: value })}
        />
        <Row
          label="Event type ID"
          current={detail.calcomEventTypeId}
          onSave={(value) => org({ calcomEventTypeId: value })}
        />
        <div className="py-2">
          <div className="text-sm font-medium">Webhook URL</div>
          <div className="text-xs text-[var(--muted)]">
            {/* cal.com's payload carries no tenant identity, so the org is
                resolved from this token in the path. It is generated, not
                typed, which is why this is text and not a field. */}
            {detail.calcomWebhookToken
              ? `/calcom/webhook/${detail.calcomWebhookToken}`
              : "No token generated yet."}
          </div>
        </div>
      </Section>

      <Section title="Email">
        <Row
          label="From address"
          hint="Domain must be verified in Resend or sends are rejected."
          current={detail.emailFrom}
          placeholder="info@salonunuz.com"
          onSave={(value) => org({ emailFrom: value })}
        />
        <Row
          label="Inbound address"
          hint="Local part only. Replies land here."
          current={detail.inboundAddress}
          placeholder="guzellik"
          onSave={(value) => org({ inboundAddress: value })}
        />
      </Section>

      <Section title="Recent failures">
        <Failures orgId={orgId} />
      </Section>
    </main>
  );
}
