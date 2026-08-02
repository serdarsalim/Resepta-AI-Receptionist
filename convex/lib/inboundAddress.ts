// The local part of an org's incoming email address, and the one rule that
// makes it safe.
//
// This string is a ROUTING KEY, not a label: `orgByInboundAddress` resolves an
// inbound reply to a tenant by matching on it, taking the first row that
// matches. So two orgs sharing one — even differing only in case or a stray
// space — means one salon reads the other salon's customer mail. That is the
// whole reason both the slugging and the uniqueness check exist, and why they
// live here rather than inline: there are TWO write paths (the owner's
// Business page and the operator's admin console), and for a while only one of
// them enforced either rule.

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Anything that is not a-z0-9- would bounce mail rather than route it, so the
// input is slugged rather than trusted. Turkish letters fold to their ASCII
// neighbours instead of vanishing: "güzellik" has to survive as "guzellik",
// not "g-zellik".
export function slugifyInboundAddress(raw: string): string {
  return raw
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

// Slug it, then refuse it if another org already answers to it. Throws rather
// than returning a result, because every caller's correct response to a clash
// is to abandon the write — silently picking "guzellik-2" would hand a salon
// an address they never chose and never tell them.
//
// Scanned rather than indexed for the same reason orgByInboundAddress scans:
// one row per paying business is a small table, and this runs when somebody
// edits a settings field.
export async function resolveInboundAddress(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  raw: string,
): Promise<string> {
  const slug = slugifyInboundAddress(raw);
  if (!slug) throw new Error("address-required");
  const clash = (await ctx.db.query("orgs").collect()).find(
    (other) => other._id !== orgId && other.inboundAddress === slug,
  );
  if (clash) throw new Error("address-taken");
  return slug;
}
