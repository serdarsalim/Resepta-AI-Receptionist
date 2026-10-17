// The address of one customer's record (P12 of the Nudge port). It carries the
// business as well as the customer: one person can work for several
// businesses, and a bare customer id would ask whichever one happens to be
// active about somebody it has never heard of. AppHome reads both on load and
// switches business first when it has to (and the person belongs to it).

export function customerHref(customerId: string, orgId: string): string {
  const params = new URLSearchParams({ tab: "customers", customer: customerId, org: orgId });
  return `/?${params.toString()}`;
}

// A click that asks for a new tab: cmd or ctrl, or the middle button.
export function wantsNewTab(event: { metaKey: boolean; ctrlKey: boolean; button?: number }): boolean {
  return event.metaKey || event.ctrlKey || event.button === 1;
}
