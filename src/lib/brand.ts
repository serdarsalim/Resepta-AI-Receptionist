// The strings that name the product in a browser tab. They live here rather
// than inline in layout.tsx because the signed-in app rewrites the title to
// lead with the WORKSPACE, and it has to be able to put the original back
// without keeping a second copy of it that drifts.
//
// layout.tsx is a server component that pulls in the Convex auth provider;
// importing it from a client component to reach one constant would drag all of
// that across the boundary. A plain module is the whole fix.

export const PRODUCT_NAME = "Randevu";

// The public tab title: what a visitor who has never signed in should read.
export const DEFAULT_TITLE = `${PRODUCT_NAME} — calls, bookings and customer follow-up`;

// The signed-in tab title. Business first, because that is the half a tab
// strip still shows once it truncates, and an operator with three salons open
// is choosing between businesses rather than between products. The favicon
// stays Randevu's for the opposite reason: the mark is how they find the app
// among thirty tabs, so it has to be the constant.
export function workspaceTitle(name: string): string {
  const workspace = name.trim();
  return workspace ? `${workspace} — ${PRODUCT_NAME}` : DEFAULT_TITLE;
}
