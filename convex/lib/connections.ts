// Per-org integration credentials.
//
// ── THE ONE DIFFERENCE FROM NUDGE ───────────────────────────────────────────
//
// This is a port of Nudge's convex/lib/connections.ts, and it deliberately
// drops that file's central feature. Nudge resolves a field as "connections
// row first, legacy env var second", which is safe there because Nudge is
// instance-per-tenant: the deployment IS the customer, so the env var can only
// ever be that customer's own key.
//
// Randevu is one deployment for every salon. Here the same fallback means an
// org that has not been configured yet quietly resolves to whatever key the
// deployment happens to hold, which is some OTHER business's provider account.
// It would list their agents, and (once anything writes) act as them. That is
// the same class of bug as an unscoped query, just harder to see, because the
// broken case looks like a working one.
//
// So: no fallback. A missing row means not configured, and every caller has to
// handle that state. Callers that want an env default want requireOrg instead.
//
// Works from any Convex function type: queries and mutations read the table
// directly; actions have no ctx.db and go through the internal query in
// convex/connections.ts.

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

// Drives both resolution and the operator's Connections UI. Adding a provider
// here is what makes it configurable; nothing reads a credential that is not
// declared.
export const CONNECTION_SPECS: {
  provider: string;
  label: string;
  fields: { field: string; label: string; secret: boolean }[];
}[] = [
  {
    provider: "retell",
    label: "Retell",
    fields: [{ field: "apiKey", label: "API key", secret: true }],
  },
];

export function connectionSpec(provider: string) {
  return CONNECTION_SPECS.find((s) => s.provider === provider) ?? null;
}

// The resolver. Returns null when the org has no row — never a shared default.
export async function connectionField(
  ctx: Ctx,
  orgId: Id<"orgs">,
  provider: string,
  field: string,
): Promise<string | null> {
  const row = await ctx.db
    .query("connections")
    .withIndex("by_org_provider_field", (q) =>
      q.eq("orgId", orgId).eq("provider", provider).eq("field", field),
    )
    .unique();
  const value = row?.value.trim();
  return value ? value : null;
}

// What the fleet console may show about a secret: enough to recognise it and
// to tell set from unset, never enough to use it. Reading a key back to a
// browser would make one compromised operator session equal to every client's
// provider account, and the operator created these accounts — they do not need
// the app to recite the value. See convex/connections.ts `fleetStatus`.
export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "····";
  return `····${trimmed.slice(-4)}`;
}
