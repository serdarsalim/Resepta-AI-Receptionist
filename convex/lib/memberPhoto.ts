// A team member's picture, ONE resolver for every place a member's face
// shows (P33, Nudge df492c1c / 867f90d6): the sidebar's account row, the
// Account page and the signature on a note. The order:
//   1. the photo they uploaded in THIS business (memberships.photoStorageId)
//   2. their Google sign-in picture (users.image)
//   3. nothing: the caller draws initials
//
// Per membership, not per login: a person who works in two businesses is a
// member of each, and what one business stores about its people stays in
// that business (the sharing rule in team.ts gives other businesses ids and
// roles, never names or faces). It also puts the blob under an org-scoped row,
// so deleting the business or removing the member takes the file with it.
// A leaf: types only from other modules.

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// The browser squares and shrinks the upload first (a 512px JPEG, tens of
// KB); this is the ceiling the server holds whatever arrives.
export const MAX_PHOTO_BYTES = 1024 * 1024;
export const PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);

/** The photo uploaded on this membership, or null. */
export async function uploadedMemberPhoto(
  ctx: QueryCtx,
  membership: Doc<"memberships"> | null,
): Promise<string | null> {
  return membership?.photoStorageId
    ? await ctx.storage.getUrl(membership.photoStorageId)
    : null;
}

/** The face for this person in this business: their upload, else Google's
 *  picture, else null. A platform operator working inside a business has no
 *  membership there and falls through to their Google picture. */
export async function memberPhoto(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  user: Doc<"users"> | null,
): Promise<string | null> {
  if (!user) return null;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_org", (q) => q.eq("userId", user._id).eq("orgId", orgId))
    .unique();
  return (await uploadedMemberPhoto(ctx, membership)) ?? user.image ?? null;
}
