// The salon's side of number provisioning: upload the company registration
// document, see where the request stands. The operator's side — reading the
// document across orgs and approving or denying — lives in platform.ts,
// where every operator surface lives.
//
// Regulators require proof of business registration before a number can be
// provisioned (mandatory in Türkiye; the DACH and UK flows ride the same
// door). The product's promise is a number within 24 hours of the document
// arriving, and the request row is what makes that promise inspectable.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./lib/orgAuth";
import { recordActivity } from "./lib/activity";
import { fileRegistrationDocument } from "./lib/numberDocument";

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    // Owner-only, unlike the image library: a registration document is the
    // business's legal identity, not a photo of a haircut.
    await requireOwner(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// Called after the browser has POSTed the bytes. The validation, the replace
// rule and the row shape live in lib/numberDocument so the operator's door
// (platform.fileNumberRequest) files an identical document.
export const submit = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    await fileRegistrationDocument(ctx, {
      orgId,
      storageId: args.storageId,
      fileName: args.fileName,
    });
    await recordActivity(ctx, {
      orgId,
      kind: "settings_changed",
      detail: "number provisioning document uploaded",
    });
    return null;
  },
});

// The org's newest request, for the wizard step and the Voice tab card.
// Owner-only resolved as null rather than thrown, like every money-adjacent
// read: staff simply see no card.
export const mine = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      status: v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("denied"),
      ),
      fileName: v.string(),
      note: v.union(v.string(), v.null()),
      createdAt: v.number(),
      decidedAt: v.union(v.number(), v.null()),
      // The owner's own document, readable back. platform.orgNumberRequests
      // has handed the operator this URL since the feature shipped and this
      // query returned only the file's NAME, so the one party who cannot open
      // the registration document was the business that uploaded it — with no
      // way to check which file they sent, or to re-read it while a request
      // sat pending. requireOwner already gates this query, and the row is
      // resolved from the caller's own org.
      url: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const auth = await requireOwner(ctx).catch(() => null);
    if (!auth) return null;
    const rows = await ctx.db
      .query("numberRequests")
      .withIndex("by_org", (q) => q.eq("orgId", auth.orgId))
      .order("desc")
      .take(1);
    const row = rows[0];
    if (!row) return null;
    return {
      status: row.status,
      fileName: row.fileName,
      note: row.note ?? null,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt ?? null,
      url: await ctx.storage.getUrl(row.storageId),
    };
  },
});
