// A caller who never said their name is still somebody: show their number
// where the name goes, as the Inbox always has. Callers grey it with
// `hasCustomerName` so a number never reads as a name.
type Named = { firstName?: string; lastName?: string; phone?: string };

export function hasCustomerName(customer: Named): boolean {
  return `${customer.firstName ?? ""}${customer.lastName ?? ""}`.trim() !== "";
}

export function customerName(customer: Named): string {
  const name = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim();
  return name || customer.phone || "";
}
