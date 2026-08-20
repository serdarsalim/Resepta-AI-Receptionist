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

// A registration document is a scan or an export: PDF from the registry,
// photo from a phone. Bigger than the image library's cap because a
// multi-page registry PDF is legitimately a few megabytes.
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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

// Called after the browser has POSTed the bytes. Validates what actually
// landed rather than trusting the client (media.ts doctrine), and REPLACES
// any previous request that has not been approved: one live request per org,
// and re-uploading after a denial is the expected correction path. An
// approved request is settled history and stays.
export const submit = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOwner(ctx);
    const meta = await ctx.storage.getMetadata(args.storageId);
    if (!meta) throw new Error("upload-missing");
    const contentType = meta.contentType ?? "";
    if (!ALLOWED.has(contentType)) {
      await ctx.storage.delete(args.storageId);
      throw new Error("unsupported-type");
    }
    if (meta.size > MAX_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error("too-large");
    }

    const existing = await ctx.db
      .query("numberRequests")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    for (const row of existing) {
      if (row.status === "approved") continue;
      await ctx.storage.delete(row.storageId);
      await ctx.db.delete(row._id);
    }

    await ctx.db.insert("numberRequests", {
      orgId,
      storageId: args.storageId,
      fileName: args.fileName.trim().slice(0, 120) || "document",
      contentType,
      size: meta.size,
      status: "pending",
      createdAt: Date.now(),
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
    };
  },
});
