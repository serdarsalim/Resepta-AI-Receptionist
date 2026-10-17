import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Forgets one signature everywhere it is somebody's default (P28). A business
// has a handful of members, so reading its memberships is the cheap way to
// find who picked it; there is no index on the field to keep in step.
export async function clearSignatureDefaults(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  signatureId: Id<"emailSignatures">,
  exceptUserId?: Id<"users">,
): Promise<void> {
  const members = await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  for (const member of members) {
    if (member.emailSignatureId === signatureId && member.userId !== exceptUserId) {
      await ctx.db.patch(member._id, { emailSignatureId: undefined });
    }
  }
}

// A person leaving a business takes their signatures with them, shared ones
// included: a shared sign-off naming somebody who no longer works there is
// exactly the mail nobody wants to send. Colleagues who picked one fall back
// to none.
export async function removeSignaturesOf(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  userId: Id<"users">,
): Promise<void> {
  const rows = await ctx.db
    .query("emailSignatures")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .collect();
  for (const row of rows) {
    await clearSignatureDefaults(ctx, orgId, row._id);
    await ctx.db.delete(row._id);
  }
}
