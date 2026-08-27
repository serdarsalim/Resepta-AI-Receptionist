import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// The registration document a number request is made of, and the one body
// that files it.
//
// There are two doors onto numberRequests and they must not drift: the
// business uploading its own document (numberRequests.submit) and the
// operator filing one that arrived some other way (platform.fileNumberRequest
// — a client who emailed the PDF, or handed it over on a sales visit). Same
// limits, same replace rule, same row shape, so a document filed by the
// operator is indistinguishable from one the owner uploaded except where the
// difference is the point: `viaOperator`.

// A registration document is a scan or an export: PDF from the registry,
// photo from a phone. Bigger than the image library's cap because a
// multi-page registry PDF is legitimately a few megabytes.
export const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function fileRegistrationDocument(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    storageId: Id<"_storage">;
    fileName: string;
    // The operator filed this on the business's behalf. Recorded because the
    // two are not the same compliance fact: one is the business attesting
    // through its own login, the other is us saying we saw the document. A
    // later reader must be able to tell which happened, and the file itself
    // cannot say. Named to match activityLog.viaOperator, which draws the
    // same line for the same reason.
    viaOperator?: boolean;
  },
): Promise<void> {
  // Validates what actually LANDED rather than trusting the client
  // (media.ts doctrine). The browser checks the same two things first so the
  // common mistake is caught before the bytes go up, but this is where the
  // limits are real.
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

  // REPLACES any previous request that has not been approved: one live
  // request per org, and re-uploading after a denial is the expected
  // correction path. An approved request is settled history and stays.
  const existing = await ctx.db
    .query("numberRequests")
    .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
    .collect();
  for (const row of existing) {
    if (row.status === "approved") continue;
    await ctx.storage.delete(row.storageId);
    await ctx.db.delete(row._id);
  }

  await ctx.db.insert("numberRequests", {
    orgId: args.orgId,
    storageId: args.storageId,
    fileName: args.fileName.trim().slice(0, 120) || "document",
    contentType,
    size: meta.size,
    // Pending even when the operator files it. Uploading a document and
    // accepting it are two different acts, and the accept is the one the
    // business is told about — landing it approved would announce a decision
    // nobody had made yet. The Accept button sits directly under the upload,
    // so vouching for a document you already read stays one click.
    status: "pending",
    createdAt: Date.now(),
    ...(args.viaOperator ? { viaOperator: true } : {}),
  });
}
