import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("not-signed-in");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("not-signed-in");
  return user;
}

// The gate every org-scoped function goes through — and since workspaces
// (2026-07-25) the only place membership is verified. users.orgId is the
// ACTIVE workspace; access requires a memberships row for it. A stale active
// org (revoked membership) falls back to the first remaining membership.
export async function requireOrg(
  ctx: Ctx,
): Promise<{ user: Doc<"users">; orgId: Id<"orgs">; role: "owner" | "staff" }> {
  const user = await requireUser(ctx);
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
