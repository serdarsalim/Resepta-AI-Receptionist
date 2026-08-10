"use client";

// The operator's fleet view. NOT a salon-facing surface.
//
// Resepta is one Convex deployment serving every org, so this can be a route
// in the app itself rather than the separate control-plane project Nudge needs
// — there, each tenant has its own backend and nothing inside one of them can
// see the others. A second project here would need its own auth and its own
// deploy just to read this same database.
//
// Access is an env allowlist checked in the backend (convex/lib/platformAuth),
// never an org role: the owner of a salon is not the operator of the platform.
// Everything on this page comes from convex/platform.ts, the one file allowed
// to read across orgs.
//
// Deliberately English-only while the app is Turkish-first. The dictionary in
// lib/i18n exists so SALON staff read the product in their own language; this
// page has exactly one reader and translating it would mean maintaining a
// second copy of every operational term for nobody.

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { ago, Count, Row, Section, SecretRow, Setup } from "./parts";

export default function AdminPage() {
  // Asked FIRST, and fleet is skipped until it comes back true. platform.fleet
  // throws for anyone not on the allowlist, and a thrown query surfaces as an
  // error boundary rather than a value — so a salon owner who guessed the URL
  // would get a crash instead of an answer. This turns that into a sentence.
  const allowed = useQuery(api.platform.amPlatformAdmin, {});
  const fleet = useQuery(api.platform.fleet, allowed ? {} : "skip");
  const deployment = useQuery(api.platform.deploymentHealth, allowed ? {} : "skip");
  const mail = useQuery(api.platformConfig.status, allowed ? {} : "skip");
  const setConfig = useMutation(api.platformConfig.set);
  const router = useRouter();

  if (allowed === undefined) {
    return (
      <main className="mx-auto max-w-6xl p-6 text-sm text-[var(--muted)]">Loading…</main>
    );
  }
  // 404, not "you may not". Explaining the refusal told a salon owner that an
  // operator console exists and invited them to ask for a login to it; the
  // honest answer to someone who is not an operator is that this address is
  // not a page. Same reason a private repo 404s rather than 403s.
  if (!allowed) notFound();
  if (fleet === undefined) {
    return (
      <main className="mx-auto max-w-6xl p-6 text-sm text-[var(--muted)]">Loading…</main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Fleet</h1>
        <p className="text-xs text-[var(--muted)]">
          {fleet.length} {fleet.length === 1 ? "org" : "orgs"} · noisiest first
        </p>
      </header>

      {/* One line for the whole deployment. Email is operator plumbing that
          arrives for every org at once, so a missing key is one fact stated
          once — not a column that would say the same thing on every row. */}
      {deployment && !deployment.emailLane && (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          No email lane on this deployment, so nothing sends by email for any
          org — reminders, invites and your own failure alerts included. Set the
          Resend key below.
        </p>
      )}

      {/* Who else can see this page. Printed because the answer lives in an
          env var on the Convex deployment, which means the only way to check
          it was to go and read the deployment — and the question ("wait, which
          address is the operator here?") comes up while you are already
          looking at this page. There is no add button on purpose: the list is
          out of the app's reach by design, and that is what makes it safe.
          See convex/lib/platformAuth.ts. */}
      {deployment && deployment.platformAdmins.length > 0 && (
        <p className="mb-4 text-xs text-[var(--muted)]">
          Platform admins: {deployment.platformAdmins.join(" · ")}
          <span className="ml-2 opacity-70">
            — set with{" "}
            <code className="font-mono">npx convex env set PLATFORM_ADMIN_EMAILS</code>
          </span>
        </p>
      )}

      {fleet.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No orgs on this deployment yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--table-header-bg)] text-left text-xs text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Business</th>
                <th className="px-3 py-2 font-medium">Setup</th>
                <th className="px-3 py-2 font-medium" title="Failed sends, last 24h">
                  Failed
                </th>
                <th
                  className="px-3 py-2 font-medium"
                  title="Retries exhausted — nothing will pick these up"
                >
                  Gave up
                </th>
                <th className="px-3 py-2 font-medium" title="Waiting on a retry">
                  Retrying
                </th>
                <th
                  className="px-3 py-2 font-medium"
                  title="Claimed for sending and never reported back"
                >
                  Stuck
                </th>
                <th className="px-3 py-2 font-medium">Upcoming</th>
                <th className="px-3 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((org) => (
                // A row opens the tenant's own page. This used to expand in
                // place, which was fine for a failure list and stopped being
                // fine once the row had to hold every credential the salon
                // owns. The name is a real link as well as the row being
                // clickable, so middle-click and keyboard both work.
                <tr
                  key={org.orgId}
                  onClick={() => router.push(`/admin/${org.orgId}`)}
                  className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--row-hover-bg)]"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/${org.orgId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium hover:underline"
                    >
                      {org.name}
                    </Link>
                    <div className="text-xs text-[var(--muted)]">
                      {org.members} {org.members === 1 ? "member" : "members"} · {org.timezone}
                      {org.calcomConnected ? " · cal.com" : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <Setup org={org} />
                  </td>
                  <td className="px-3 py-2">
                    <Count value={org.failed24h} tone="warn" capped={org.capped} />
                  </td>
                  <td className="px-3 py-2">
                    <Count value={org.deadLettered24h} tone="bad" />
                  </td>
                  <td className="px-3 py-2">
                    <Count value={org.retrying} tone="plain" />
                  </td>
                  <td className="px-3 py-2">
                    <Count value={org.stuck} tone="bad" />
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[var(--muted)]">
                    {org.upcomingAppointments}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[var(--muted)]">
                    {ago(org.lastActivityAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Deployment settings, below the fleet because the fleet is why the
          operator opened this page. One Resend account serves every salon —
          that is what lets a salon send mail without owning a domain — so it
          is configured here rather than per tenant, and rather than in an env
          var only a terminal can reach. */}
      {mail && (
        <div className="mt-6">
          <Section
            title="Email (Resend)"
            description="One account and one verified domain for the whole deployment. Every salon sends from it unless they set a domain of their own."
          >
            <SecretRow
              label="API key"
              hint={
                mail.fromEnv.apiKey
                  ? "Currently coming from the RESEND_API_KEY env var. Saving here overrides it."
                  : undefined
              }
              masked={mail.apiKey}
              onSave={(value) => setConfig({ key: "resendApiKey", value })}
            />
            <Row
              label="Sending domain"
              hint="Verified in Resend. Carries every org's incoming address and the noreply sender."
              current={mail.domain}
              placeholder="mail.example.com"
              onSave={(value) => setConfig({ key: "resendInboundDomain", value })}
            />
            <SecretRow
              label="Inbound webhook secret"
              hint="Signs Resend's email.received calls. Only needed for replies landing in the Inbox."
              masked={mail.webhookSecret}
              onSave={(value) => setConfig({ key: "resendWebhookSecret", value })}
            />
            <Row
              label="Product name"
              hint="How invites and alerts sign themselves. Not what customers see — salon mail carries the salon's name."
              current={mail.productName}
              placeholder="Resepta"
              onSave={(value) => setConfig({ key: "productName", value })}
            />
          </Section>
        </div>
      )}
    </main>
  );
}
