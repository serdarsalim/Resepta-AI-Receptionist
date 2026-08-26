// The outbound attachment library.
//
// Inbound media already works: the webhook pulls it out of Meta into Convex
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
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// A price list or a treatment brochure does not fit in the image budget, and
// it does not need to: a document is never re-encoded on the way through, so
// the only cost is storage and the customer's download. Still capped, because
// the salon photographing forty pages into one PDF is a real thing.
const MAX_DOC_BYTES = 5 * 1024 * 1024;

// The three image types WhatsApp renders, and nothing else.
const ALLOWED_IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Documents → the extension the recipient sees. The map doubles as the
// allow-list: a type absent from it cannot be uploaded, so adding a format is
// one line and never a check that happens to pass.
export const DOC_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
};

// The filename the customer sees on their phone. Asset names may or may not
// carry their extension (an upload keeps the original filename; a rename
// usually drops it), so this guarantees exactly one honest suffix — without
// it, WhatsApp shows a document called "Fiyat listesi" that no phone knows how
// to open.
export function fileNameForAsset(name: string, contentType: string): string {
  const ext = DOC_EXTENSIONS[contentType];
  if (!ext) return name;
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

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
    const isImage = ALLOWED_IMAGES.has(contentType);
    const isDoc = contentType in DOC_EXTENSIONS;
    if (!isImage && !isDoc) {
      // The blob is dropped rather than left orphaned: nothing references it,
      // and storage nobody can see is storage nobody will ever clean up.
      await ctx.storage.delete(args.storageId);
      throw new Error("unsupported-type");
    }
    if (meta.size > (isImage ? MAX_IMAGE_BYTES : MAX_DOC_BYTES)) {
      await ctx.storage.delete(args.storageId);
      throw new Error("too-large");
    }

    return await ctx.db.insert("mediaAssets", {
      orgId,
      storageId: args.storageId,
      name: args.name.trim().slice(0, 120) || (isDoc ? "document" : "image"),
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
      contentType: v.string(),
      // Documents only, null for an image. Resolved here rather than in the
      // picker so the send path and the thumbnail agree on one string.
      fileName: v.union(v.string(), v.null()),
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
        contentType: row.contentType,
        fileName:
          row.contentType in DOC_EXTENSIONS
            ? fileNameForAsset(row.name, row.contentType)
            : null,
      })),
    );
  },
});

// Refused while any message still shows the file. A sent message is a record
// of what the customer received, and deleting the bytes out from under it
// turns that record into a broken image or a dead link — which reads as the
// app losing data, because it is.
export const remove = mutation({
  args: { assetId: v.id("mediaAssets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.orgId !== orgId) throw new Error("not-found");

    // Exact, not a sample: indexed on the storage id, so a file sent two
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
