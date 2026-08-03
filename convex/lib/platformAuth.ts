// The gate for functions that read ACROSS orgs.
//
// ── READ THIS BEFORE USING IT ───────────────────────────────────────────────
//
// Every other query and mutation in this codebase goes through requireOrg and
// is scoped to one business. That invariant is the product's security model:
// an unscoped read is one salon seeing another salon's customers.
//
// This file deliberately breaks it, for exactly one caller — the platform
// operator looking at the fleet. So it is separate from orgAuth.ts, named so
// nobody reaches for it by accident, and every function that uses it lives in
// convex/platform.ts and nowhere else. If you find yourself importing this
// into a file a salon's browser can reach, stop: you want requireOrg.
//
// ── THE ONE AMENDMENT TO THAT RULE ──────────────────────────────────────────
//
// `emailIsPlatformAdmin` below — and ONLY that function — is also imported by
// lib/orgAuth.ts and lib/activity.ts, to support an operator working inside a
// tenant (users.actingAsOrgId). That is not a leak in the rule, it is the rule
// applied: acting as a tenant is a cross-org capability, so the thing that
// authorises it has to be the env allowlist rather than anything a salon's own
// mutations could reach. Putting the check anywhere else would have meant a
// database column deciding who can read every business on the deployment.
//
// It takes an email and touches no database, precisely so importing it cannot
// widen anyone's read scope. requirePlatformAdmin and isPlatformAdmin stay
// confined to convex/platform.ts. Do not add a third caller without the same
// argument.
//
// ── WHY AN ENV ALLOWLIST AND NOT A FLAG ON THE USER ROW ─────────────────────
//
// A `platformAdmin: true` column would be a row in the same database every
// org-scoped mutation can write. One missing scope check anywhere in the app
// turns into full cross-tenant read access. An env var cannot be escalated
// into by any amount of application-level bugs — changing who is a platform
// admin means deploying a config change, which is the point.
//
//   npx convex env set PLATFORM_ADMIN_EMAILS "you@example.com,ops@example.com"
//
// Unset means NOBODY is a platform admin and every function here throws. That
// is the correct default: a deployment where the operator forgot to configure
// this should expose nothing, not everything.

import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

function allowlist(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

// The whole check, as a pure function of an address. No ctx, no database read,
// so a caller that holds a user row already can ask without a second lookup —
// and so importing it (see the header amendment) cannot widen a read scope.
// Empty allowlist denies everyone; that default is deliberate.
export function emailIsPlatformAdmin(email: string | undefined): boolean {
  if (!email) return false;
  const emails = allowlist();
  if (emails.size === 0) return false;
  return emails.has(email.toLowerCase());
}

// The allowlist itself, for the operator console to PRINT. Read-only on
// purpose and read-only forever: there is no setter here and there must not be
// one, because the whole argument above is that this list lives somewhere no
// mutation can reach. Showing it is not the risk — the risk was ever letting
// the app write it. Callers must gate on requirePlatformAdmin first; an
// operator seeing the operator list is not a disclosure, everyone else seeing
// it is.
export function platformAdminEmails(): string[] {
  return [...allowlist()].sort();
}

export async function requirePlatformAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("not-signed-in");
  const user = await ctx.db.get(userId);
  if (!emailIsPlatformAdmin(user?.email)) throw new Error("not-platform-admin");
  return user!;
}

// Whether the signed-in user may see the admin area at all — for the UI, which
// needs to decide whether to render a link rather than to catch a throw.
// Returns false instead of throwing precisely because every user calls it.
export async function isPlatformAdmin(ctx: Ctx): Promise<boolean> {
  try {
    await requirePlatformAdmin(ctx);
    return true;
  } catch {
    return false;
  }
}
