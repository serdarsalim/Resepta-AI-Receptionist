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

// The gate every org-scoped function goes through. Also the only place the
// caller→org mapping is resolved, so a query can't accidentally take orgId as
// a client-supplied argument.
export async function requireOrg(
  ctx: Ctx,
): Promise<{ user: Doc<"users">; orgId: Id<"orgs"> }> {
  const user = await requireUser(ctx);
  if (!user.orgId) throw new Error("no-org");
  return { user, orgId: user.orgId };
}

// E.164 or it doesn't exist (Nudge convention). Normalizes separators, rejects
// anything without a dial code.
export function assertE164(raw: string): string {
  const phone = raw.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error("phone-must-be-e164");
  return phone;
}
