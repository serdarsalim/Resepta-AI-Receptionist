import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
// Only the pure allowlist check, never requirePlatformAdmin. See that file's
// header for why this single import is the rule rather than an exception to it.
import { emailIsPlatformAdmin } from "./platformAuth";

type Ctx = QueryCtx | MutationCtx;

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("not-signed-in");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("not-signed-in");
  return user;
}

// True when this caller is a platform operator currently working inside a
// tenant. Both halves are required and the order is not cosmetic: the column
// says which org, the ALLOWLIST says whether the column counts for anything.
//
// This is the one place in the codebase where an org is resolved without a
// memberships row, so it is worth being explicit about why it is not a hole.
// A membership would have been the easier build, and it is the worse one: a
// row in the same database every org-scoped mutation can write, visible in the
// salon's own People list, and still sitting there in six months because
// somebody forgot to leave. This grant is exactly as strong as an env var, it
// evaporates the moment the address comes off PLATFORM_ADMIN_EMAILS, and no
// amount of application-level bugs can mint one — writing actingAsOrgId onto
// a user row buys nothing at all unless that user is already on the allowlist.
export function actingAsOrg(user: Doc<"users">): Id<"orgs"> | null {
  if (!user.actingAsOrgId) return null;
  if (!emailIsPlatformAdmin(user.email)) return null;
  return user.actingAsOrgId;
}

// The gate every org-scoped function goes through — and since workspaces
// (2026-07-25) the only place membership is verified. users.orgId is the
// ACTIVE workspace; access requires a memberships row for it. A stale active
// org (revoked membership) falls back to the first remaining membership.
export async function requireOrg(
  ctx: Ctx,
): Promise<{ user: Doc<"users">; orgId: Id<"orgs">; role: "owner" | "staff" }> {
  const user = await requireUser(ctx);
  // Checked FIRST, so it beats the active workspace rather than racing it: an
  // operator with their own salon has a perfectly valid membership of their
  // own org, and resolving to that while they believe they are inside a
  // client's would write their edits into the wrong business.
  //
  // Role is owner because the operator is here to fix something, and a
  // read-only impersonation answers none of the calls that prompt one.
  const acting = actingAsOrg(user);
  if (acting) {
    const org = await ctx.db.get(acting);
    if (org) return { user, orgId: acting, role: "owner" };
    // Org deleted underneath them. Fall through to their own memberships
    // rather than throwing, so the app still loads and they can get out.
  }
  if (user.orgId) {
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", user._id).eq("orgId", user.orgId!),
      )
      .unique();
    if (membership) return { user, orgId: membership.orgId, role: membership.role };
  }
  const fallback = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .first();
  if (!fallback) throw new Error("no-org");
  return { user, orgId: fallback.orgId, role: fallback.role };
}

// Owner-only gate for org configuration: Settings mutations, WhatsApp
// credentials, invites. Staff read the org and work the appointments; they
// don't reshape the business.
export async function requireOwner(
  ctx: Ctx,
): Promise<{ user: Doc<"users">; orgId: Id<"orgs"> }> {
  const { user, orgId, role } = await requireOrg(ctx);
  if (role !== "owner") throw new Error("owner-only");
  return { user, orgId };
}

// E.164 or it doesn't exist (Nudge convention). Normalizes separators, rejects
// anything without a dial code.
export function assertE164(raw: string): string {
  const phone = raw.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error("phone-must-be-e164");
  return phone;
}
