// The org's public handle — the last segment of its booking page URL,
// /book/<slug> — and the rule that it FOLLOWS THE BUSINESS NAME.
//
// Rename the business and the page renames with it (Serdar, 2026-08-20).
// The cost is real and worth naming: the moment the slug moves, every link
// already shared stops opening — the URL sitting in a sent reminder, the one
// in an Instagram bio, the QR code taped to the counter. It is allowed anyway
// because the alternative shipped worse. The slug used to be minted once, from
// whatever the name happened to be the day the booking switch went on, and
// never re-derived; a salon that renamed itself was left advertising a
// business that no longer exists in every link it sends, permanently, with
// nothing on screen offering a way out.
//
// The rule that makes following the name safe: the NAME is unique across orgs,
// and this slug is where that gets enforced. Two salons cannot both be
// "Güzellik Salonu", because two salons cannot both own /book/guzellik-salonu.
// Uniqueness is checked on the SLUG rather than the raw name on purpose —
// "Güzellik Salonu" and "Guzellik Salonu" are different strings that would
// land on the same page, and the page is the thing that can only have one
// owner.

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Turkish letters fold to their ASCII neighbours rather than vanishing:
// "güzellik" has to survive as "guzellik", not "g-zellik".
//
// A deliberate second copy of lib/inboundAddress's slugger rather than a
// shared one. That string is a mail routing key and this one is a URL segment;
// the day either needs a rule the other must not have — a length cap, a
// reserved word, a punctuation allowance — a shared function is a change that
// silently moves both.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[ıİ]/g, "i")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Does this slug still express this name? True for the exact derivation and
// for the numbered variants assignPublicSlug hands out on a clash, so a legacy
// "guzellik-salonu-2" is not read as drift and re-derived on every save.
//
// Exists to keep the sync in orgs.update CHEAP. Healing drift means calling
// assignPublicSlug, which reads the whole orgs table — paying that on every
// settings save would put every org row into that mutation's conflict set, so
// one salon saving its opening hours would race every other salon's save. A
// string compare answers "nothing to do" for free, which is the answer almost
// every time.
export function slugMatchesName(slug: string | undefined, name: string): boolean {
  const base = slugify(name);
  if (!base || !slug) return false;
  if (slug === base) return true;
  if (!slug.startsWith(`${base}-`)) return false;
  return /^\d+$/.test(slug.slice(base.length + 1));
}

// The owner typed a name. Throws on a clash rather than quietly handing them
// "guzellik-salonu-2" — the same call resolveInboundAddress makes, for the
// same reason: a handle the salon never chose is one nobody ever tells them
// about, and here it would also be a page whose address disagrees with the
// sign above the door.
//
// Returns null, rather than throwing, for a name that slugs to nothing — a
// name written entirely in a script this slugger folds away. Refusing it would
// bar the business from being named at all, which is a much worse failure than
// a booking link that stays where it was.
export async function resolvePublicSlug(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  name: string,
): Promise<string | null> {
  const slug = slugify(name);
  if (!slug) return null;
  // Indexed (schema orgs.by_public_slug). .first() rather than .unique():
  // legacy rows minted before this rule can already collide, and the answer to
  // "is this address free" is the same either way — .unique() would throw on a
  // save that is not the one at fault.
  const clash = await ctx.db
    .query("orgs")
    .withIndex("by_public_slug", (q) => q.eq("publicSlug", slug))
    .first();
  if (clash && clash._id !== orgId) throw new Error("name-taken");
  return slug;
}

// The same derivation for the machine rather than a person: takes the next
// free variant instead of refusing. Exactly assignInboundAddress's split, and
// for the same reason — the org being backfilled did not choose this moment
// and cannot be asked to pick another name.
//
// Two callers: booking.enable, for an org that predates the link following the
// name, and orgs.update's backfill for the same. Both are filling a blank, not
// honouring a rename.
export async function assignPublicSlug(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  name: string,
): Promise<string> {
  // "resepta" only when the name slugs to nothing at all; every real name
  // reaches here with something.
  const base = slugify(name) || "resepta";
  const taken = new Set(
    (await ctx.db.query("orgs").collect())
      .filter((other) => other._id !== orgId)
      .map((other) => other.publicSlug),
  );
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  return slug;
}
