import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { recordActivity } from "./activity";
import { isDeleting } from "./customerDeletion";
import type { TextLanguage } from "./textLanguage";

// Learning a customer's language from what they did (P30 of the Nudge port,
// Nudge 9670941f). `customers.language` unset means "the business's
// language", which is a GUESS: nobody asked them. A typed WhatsApp reply or
// what they said on an answered call is EVIDENCE, and it replaces the guess.
// A value a person set (the record's Language row, the office connector, an
// import) is never replaced, and neither is one learned earlier: the first
// evidence holds until a person changes it, so a customer who writes in two
// languages does not flip their reminders between them.
//
// One more condition Nudge does not need: the business must be able to send
// in the learned language everything it sends in its own. Sends resolve the
// template by the customer's language with no cross-language fallback, so
// learning English for a business with only Turkish wording would turn every
// reminder that reaches them today into a failure.

/** Whether every message the business sends in `from` also exists in `to`:
 *  for each kind with wording in `from`, a kind-level row in `to` with words,
 *  approved with Meta wherever the `from` row is. Campaigns are left out:
 *  they go in the owner's language, never the customer's. */
export async function orgCanSendIn(
  ctx: { db: QueryCtx["db"] },
  orgId: Id<"orgs">,
  from: string,
  to: string,
): Promise<boolean> {
  if (from === to) return true;
  const rows = await ctx.db
    .query("waTemplates")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const hasWords = (row: Doc<"waTemplates">) => Boolean(row.body?.trim() || row.bodyPreview?.trim());
  const registered = (row: Doc<"waTemplates">) => row.status === "approved" && Boolean(row.metaName);
  for (const row of rows) {
    if (row.language !== from || row.kind === "campaign") continue;
    const target = rows.find(
      (other) => other.language === to && other.kind === row.kind && other.ruleId === undefined,
    );
    if (!target) return false;
    if (hasWords(row) && !hasWords(target)) return false;
    if (registered(row) && !registered(target)) return false;
  }
  return true;
}

/** Record the language a customer showed us, when their record has none.
 *  Returns the code written, or null when nothing changed. */
export async function learnCustomerLanguage(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  language: TextLanguage | null,
): Promise<TextLanguage | null> {
  if (!language) return null;
  const customer = await ctx.db.get(customerId);
  if (!customer || isDeleting(customer) || customer.language) return null;
  const org = await ctx.db.get(customer.orgId);
  // The demo's replies are invented, and it is rebuilt nightly anyway.
  if (!org || org.demoMode === true) return null;
  if (!(await orgCanSendIn(ctx, customer.orgId, org.language, language))) return null;
  await ctx.db.patch(customerId, { language, languageLearnedAt: Date.now() });
  // Nobody at the business changed it, so the feed says the system did.
  await recordActivity(ctx, {
    orgId: customer.orgId,
    kind: "customer_updated",
    customerId,
    detail: "language",
    system: true,
  });
  return language;
}
