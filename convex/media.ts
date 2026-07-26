// The outbound image library.
//
// Inbound images already work: the webhook pulls them out of Meta into Convex
// storage because Meta's own media URLs are short-lived and token-gated, so a
// link would be a broken image by the next morning (see wa.downloadInboundMedia).
// This is the other direction — the salon sending a price list or a
// before-and-after — and it is a LIBRARY rather than an upload-per-message
// because the same price list goes out forty times.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrg } from "./lib/orgAuth";

// Meta accepts images up to 5 MB on the Cloud API. Capped lower here on
// purpose: a salon photographing a price list on a modern phone produces a
// 4 MB file that looks identical at 800 KB, and every byte is paid for twice —
// once in storage and once in the customer's mobile data. The upload UI should
// say the limit rather than letting someone wait through a failed upload.
const MAX_BYTES = 2 * 1024 * 1024;

// WhatsApp renders these three and nothing else. A PDF price list is a
// legitimate thing to want to send, but it goes as a document with its own
// payload shape, so it belongs in a separate change rather than being smuggled
// in behind a content-type check that happens to pass.
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    // Org membership is the gate. Not owner-only: a stylist who takes the
    // photo of the finished colour is exactly who should be able to upload it.
    await requireOrg(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// Called after the browser has PUT the bytes. Validates what actually landed
// rather than trusting what the client said it was uploading — the upload URL
// accepts anything, so this is the only place the limits are real.
export const register = mutation({
  args: {
    storageId: v.id("_storage"),
    name: v.string(),
  },
  returns: v.id("mediaAssets"),
  handler: async (ctx, args) => {
    const { orgId, user } = await requireOrg(ctx);
    const meta = await ctx.storage.getMetadata(args.storageId);
    if (!meta) throw new Error("upload-missing");

    const contentType = meta.contentType ?? "";
    if (!ALLOWED.has(contentType)) {
      // The blob is dropped rather than left orphaned: nothing references it,
      // and storage nobody can see is storage nobody will ever clean up.
      await ctx.storage.delete(args.storageId);
      throw new Error("unsupported-type");
    }
    if (meta.size > MAX_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error("too-large");
    }

    return await ctx.db.insert("mediaAssets", {
      orgId,
      storageId: args.storageId,
      name: args.name.trim().slice(0, 120) || "image",
      contentType,
      size: meta.size,
      uploadedBy: user._id,
    });
  },
});

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("mediaAssets"),
      name: v.string(),
      size: v.number(),
      url: v.union(v.string(), v.null()),
      storageId: v.id("_storage"),
    }),
  ),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("mediaAssets")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(100);
    return await Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        name: row.name,
        size: row.size,
        url: await ctx.storage.getUrl(row.storageId),
        storageId: row.storageId,
      })),
    );
  },
});

// Refused while any message still shows the image. A sent message is a record
// of what the customer received, and deleting the bytes out from under it
// turns that record into a broken image — which reads as the app losing data,
// because it is.
export const remove = mutation({
  args: { assetId: v.id("mediaAssets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.orgId !== orgId) throw new Error("not-found");

    // Exact, not a sample: indexed on the storage id, so an image sent two
    // years ago protects itself as well as one sent this morning.
    const used = await ctx.db
      .query("messages")
      .withIndex("by_media", (q) => q.eq("mediaStorageId", asset.storageId))
      .first();
    if (used) throw new Error("in-use");

    await ctx.storage.delete(asset.storageId);
    await ctx.db.delete(args.assetId);
    return null;
  },
});
