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

export async function requirePlatformAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("not-signed-in");
  const user = await ctx.db.get(userId);
  if (!user?.email) throw new Error("not-platform-admin");
  const emails = allowlist();
  // Empty allowlist denies everyone. See the header.
  if (emails.size === 0) throw new Error("not-platform-admin");
  if (!emails.has(user.email.toLowerCase())) throw new Error("not-platform-admin");
  return user;
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
