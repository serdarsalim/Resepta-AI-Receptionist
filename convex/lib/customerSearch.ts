// The customers' search text (P13 of the Nudge port, Nudge's searchText).
//
// customers.quickSearch used to read EVERY customer of the org on each
// keystroke and filter in JavaScript, because Convex cannot fold "Ayşe" into
// "ayse" inside a query. That is a read proportional to the whole book, re-run
// on every write to any customer (AGENTS.md, bandwidth). Now the folded text
// lives on the row (`customers.searchText`) under a search index filtered by
// orgId, and a search reads only matches.
//
// THE INVARIANT, same standing as noteMessage and syncAppointmentSchedule:
// any mutation that inserts a customer or changes a first name, last name,
// phone or email calls `syncCustomerSearch` after it. `customers:backfillSearch`
// repairs a write path that forgot, and is idempotent.

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// The fold quickSearch always used, so a search finds what it found before:
// Turkish dotted and dotless i, German sharp s, then any accent dropped.
export function foldSearch(value: string): string {
  return value
    .replace(/[İIı]/g, "i")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// A number is typed three ways: with its country code, in its national form,
// or as the last digits someone remembers. Each is a token, so a prefix search
// on any of them lands.
function phoneTokens(phone: string | undefined): string[] {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const short = digits.length > 10 ? digits.slice(-10) : digits;
  return Array.from(new Set([digits, short, `0${short}`]));
}

export function customerSearchText(customer: {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
}): string {
  const parts = [
    customer.firstName ?? "",
    customer.lastName ?? "",
    customer.email ?? "",
    // The address's local part and domain as words too: "ayse@" and
    // "gmail" both find somebody.
    ...(customer.email ? customer.email.split(/[@.]/) : []),
    ...phoneTokens(customer.phone),
  ];
  return foldSearch(parts.filter(Boolean).join(" ")).slice(0, 2000);
}

// Recompute one customer's search text from the row as it now stands. Cheap
// enough to call after every identity write: one read, and a write only when
// the text changed. A customer being deleted gets none, so a search never
// finds the blank row (lib/customerDeletion).
export async function syncCustomerSearch(
  ctx: Pick<MutationCtx, "db">,
  customerId: Id<"customers">,
): Promise<void> {
  const customer = await ctx.db.get(customerId);
  if (!customer) return;
  const next = customer.deletingAt !== undefined ? undefined : customerSearchText(customer);
  if (customer.searchText === next) return;
  await ctx.db.patch(customerId, { searchText: next });
}
