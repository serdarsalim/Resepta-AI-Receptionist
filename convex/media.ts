// The outbound attachment library.
//
// Inbound media already works: the webhook pulls it out of Meta into Convex
// storage because Meta's own media URLs are short-lived and token-gated, so a
// link would be a broken image by the next morning (see wa.downloadInboundMedia).
// This is the other direction — the salon sending a price list or a
// before-and-after — and it is a LIBRARY rather than an upload-per-message
// because the same price list goes out forty times.

import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
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

// The two video containers Cloud API takes (H.264 + AAC inside). Capped at
// Meta's own 16 MB send ceiling: a video the library accepts but WhatsApp
// refuses to carry would be a tile that can never be sent.
const ALLOWED_VIDEOS = new Set(["video/mp4", "video/3gpp"]);
const MAX_VIDEO_BYTES = 16 * 1024 * 1024;

// Documents → the extension the recipient sees. The map doubles as the
// allow-list: a type absent from it cannot be uploaded, so adding a format is
// one line and never a check that happens to pass.
export const DOC_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  // PowerPoint and plain text (P14, Nudge 57bd2d2a): all three are document
  // types the Cloud API carries.
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
  "text/plain": "txt",
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

// What the library hands the browser for one asset. register returns the
// same shape as list, so a composer that just uploaded a pasted image can
// attach it without waiting for the list to come round.
const assetView = v.object({
  _id: v.id("mediaAssets"),
  name: v.string(),
  size: v.number(),
  url: v.union(v.string(), v.null()),
  storageId: v.id("_storage"),
  contentType: v.string(),
  // Documents only, null for an image or a video. Resolved here rather than
  // in the picker so the send path and the tile agree on one string.
  fileName: v.union(v.string(), v.null()),
});

async function viewOf(ctx: QueryCtx, row: Doc<"mediaAssets">) {
  return {
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
  };
}

// Called after the browser has PUT the bytes. Validates what actually landed
// rather than trusting what the client said it was uploading — the upload URL
// accepts anything, so this is the only place the limits are real.
//
// Same bytes, same asset: when this business's library already holds a file
// with this hash, the new blob is deleted and the existing row comes back
// (`deduped`), moved to the front. Scoped by org: another business holding
// the same file is not a twin, and naming it would say what they keep.
export const register = mutation({
  args: {
    storageId: v.id("_storage"),
    name: v.string(),
  },
  returns: v.object({ asset: assetView, deduped: v.boolean() }),
  handler: async (ctx, args) => {
    const { orgId, user } = await requireOrg(ctx);
    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) throw new Error("upload-missing");

    const contentType = meta.contentType ?? "";
    const isImage = ALLOWED_IMAGES.has(contentType);
    const isVideo = ALLOWED_VIDEOS.has(contentType);
    const isDoc = contentType in DOC_EXTENSIONS;
    if (!isImage && !isVideo && !isDoc) {
      // The blob is dropped rather than left orphaned: nothing references it,
      // and storage nobody can see is storage nobody will ever clean up.
      await ctx.storage.delete(args.storageId);
      throw new Error("unsupported-type");
    }
    const cap = isImage
      ? MAX_IMAGE_BYTES
      : isVideo
        ? MAX_VIDEO_BYTES
        : MAX_DOC_BYTES;
    if (meta.size > cap) {
      await ctx.storage.delete(args.storageId);
      throw new Error("too-large");
    }

    const now = Date.now();
    const twin = meta.sha256
      ? await ctx.db
          .query("mediaAssets")
          .withIndex("by_org_sha256", (q) =>
            q.eq("orgId", orgId).eq("sha256", meta.sha256),
          )
          .first()
      : null;
    // A twin whose own blob is gone is no twin: reusing it would hand back
    // an asset with nothing behind it.
    const twinBlob = twin ? await ctx.db.system.get(twin.storageId) : null;
    if (twin && twinBlob && twin.storageId !== args.storageId) {
      await ctx.storage.delete(args.storageId);
      await ctx.db.patch(twin._id, { lastUsedAt: now });
      return { asset: await viewOf(ctx, twin), deduped: true };
    }

    const assetId = await ctx.db.insert("mediaAssets", {
      orgId,
      storageId: args.storageId,
      name:
        args.name.trim().slice(0, 120) ||
        (isDoc ? "document" : isVideo ? "video" : "image"),
      contentType,
      size: meta.size,
      uploadedBy: user._id,
      sha256: meta.sha256,
      lastUsedAt: now,
    });
    const row = await ctx.db.get(assetId);
    return { asset: await viewOf(ctx, row!), deduped: false };
  },
});

// The library, most recently used first. A business's library is a few
// dozen files; the newest 200 by upload are read and re-sorted by use.
export const list = query({
  args: {},
  returns: v.array(assetView),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("mediaAssets")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(200);
    rows.sort(
      (a, b) =>
        (b.lastUsedAt ?? b._creationTime) - (a.lastUsedAt ?? a._creationTime),
    );
    return await Promise.all(rows.map((row) => viewOf(ctx, row)));
  },
});

// Picking an asset moves it to the front of the library.
export const touch = mutation({
  args: { assetId: v.id("mediaAssets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.orgId !== orgId) return null;
    await ctx.db.patch(args.assetId, { lastUsedAt: Date.now() });
    return null;
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
    // An image placed inside one of this business's email templates (P26):
    // deleting it would break that picture in every mail the template sends
    // from now on. A business holds a few dozen template rows, read whole.
    // Mail already sent is not checked (its bodies are not indexed by asset).
    const ref = `/e/i/${asset._id}`;
    const templates = await ctx.db
      .query("waTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .take(500);
    if (templates.some((row) => row.bodyHtml?.includes(ref))) {
      throw new Error("in-use");
    }

    await ctx.storage.delete(asset.storageId);
    await ctx.db.delete(args.assetId);
    return null;
  },
});

// A library image placed INSIDE an email body (P26, the editor's Insert
// photo). The body carries `/e/i/<assetId>`, on the app's own origin like the
// open pixel and the unsubscribe link (lib/email.emailLinkOrigin), and the
// route in http.ts streams the bytes from here. Keyed on the asset, never on a
// storage id: only what a business put in its own library is reachable, and
// only its images, so a customer's inbound photo (also in storage) is not.
// No auth, as with the pixel: an email client loads it anonymously, and the
// asset id is the capability.
export const emailImage = internalQuery({
  args: { assetId: v.string() },
  returns: v.union(
    v.object({ storageId: v.id("_storage"), contentType: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("mediaAssets", args.assetId);
    if (!id) return null;
    const asset = await ctx.db.get(id);
    if (!asset || !ALLOWED_IMAGES.has(asset.contentType)) return null;
    return { storageId: asset.storageId, contentType: asset.contentType };
  },
});
