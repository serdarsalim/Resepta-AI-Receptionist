import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// An unnamed org is a DRAFT, not a business (Serdar, 2026-08-23): the name is
// saved last in onboarding precisely so that finishing the wizard is the
// commit point. This is the matching rollback — it erases a draft as if "Add
// business" was never clicked, and it is what makes the create-first wizard
// behave like create-on-finish without buffering five steps client-side.
//
// The name gate is also what keeps this cascade BOUNDED. An unnamed org has
// never run orgs.update's auto-provisioning, so no Retell agent, no phone
// number, no waAccounts row and no customer exists; everything it can hold is
// what founding seeded plus what the wizard's pre-name steps write. Callers
// decide the politics (who may discard, where the person lands afterwards);
// this function refuses anything that is not a draft and deletes the rest.
export async function discardDraftOrg(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
): Promise<void> {
  const org = await ctx.db.get(orgId);
  if (!org) return;
  if (org.name !== "") throw new Error("not-a-draft");
  // Belt and braces: the demo org is named, so this cannot hit — but the demo
  // org is also the one org whose accidental deletion would take a public
  // surface down, so it earns its own refusal.
  if (org.demoMode) throw new Error("not-a-draft");

  // Founding seeds (lib/foundOrg): rules, template drafts, the trial credit.
  for (const row of await ctx.db
    .query("messageRules")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db
    .query("waTemplates")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db
    .query("walletTopups")
    .withIndex("by_org_at", (q) => q.eq("orgId", orgId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  // What the wizard's pre-name steps can have written: preset services and
  // fields, knowledge blocks, a number request (whose uploaded document is a
  // storage blob that would otherwise leak), and activity rows.
  for (const row of await ctx.db
    .query("services")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db
    .query("contactFields")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db
    .query("knowledge")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db
    .query("numberRequests")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect()) {
    await ctx.storage.delete(row.storageId).catch(() => {});
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db
    .query("activityLog")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect()) {
    // A photo set before the draft was discarded (P33) goes with it.
    if (row.photoStorageId) await ctx.storage.delete(row.photoStorageId);
    await ctx.db.delete(row._id);
  }
  await ctx.db.delete(orgId);
}

// True when nothing beyond the founding seeds has been written — no wizard
// progress. acceptInvite uses this to tell "the empty org sign-in minted on
// the way in" from "a draft somebody actually started", because it discards
// the first silently and must never touch the second.
export async function draftIsUntouched(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
): Promise<boolean> {
  for (const table of [
    "services",
    "contactFields",
    "knowledge",
    "numberRequests",
  ] as const) {
    const row = await ctx.db
      .query(table)
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (row) return false;
  }
  return true;
}
