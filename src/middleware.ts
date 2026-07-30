import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignInPage = createRouteMatcher(["/signin"]);

// The public request form. Whoever opens /r/<slug> is a customer of the salon,
// not a user of this product — they have no account and never will, and the
// page is designed to be embedded in the salon's own website. Sending them to
// a Google sign-in screen breaks the feature outright.
//
// Safe to leave unauthenticated because the BACKEND is what enforces this, not
// the route: every function the page calls (convex/forms.ts `publicForm` and
// `submit`) is keyed by the org's public slug rather than by requireOrg, and
// publishes only the business name and its active service names — no prices,
// no counts, no customer data. A slug whose form is switched off is
// indistinguishable from one that does not exist.
//
// Anything added to this matcher must clear the same bar. A route is public
// when the functions behind it are public; making one reachable without
// checking that is how a tenancy boundary gets deleted by a routing change.
//
// /privacy and /terms clear that bar the easy way: they call no Convex
// functions at all. Their content is static prose from src/lib/legal.ts. They
// have to be public for a harder reason than politeness, though. Google's OAuth
// consent screen and Meta's app review both fetch these URLs anonymously, and a
// redirect to /signin reads to them as a missing policy.
//
// `/` joins them because it is now the landing page for anyone signed out. It
// clears the bar differently from the others: the route is public but the APP
// still is not. src/app/page.tsx renders marketing copy under <Unauthenticated>
// and the real thing under <Authenticated>, and every Convex function behind
// the app half still goes through requireOrg. Letting the request past this
// redirect exposes a page, not a tenant.
const isPublicPage = createRouteMatcher(["/r/(.*)", "/privacy", "/terms", "/"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  // First, and before the auth lookup: a stranger loading an embedded form
  // should not pay for a session check that cannot change the answer. This
  // also means a signed-in owner previewing their own form sees the form,
  // rather than being bounced to the app.
  if (isPublicPage(request)) return;

  const isAuthed = await convexAuth.isAuthenticated();
  if (isSignInPage(request) && isAuthed) {
    return nextjsMiddlewareRedirect(request, "/");
  }
  if (!isSignInPage(request) && !isAuthed) {
    return nextjsMiddlewareRedirect(request, "/signin");
  }
});

// icon.svg sits here for the same reason favicon.ico always did, and leaving it
// out cost a working favicon. src/app/icon.svg is a route like any other, so the
// auth check caught it and answered the browser's icon request with a 307 to
// /signin. Chrome asked for an image, got a redirect to an HTML page, and drew
// the default globe. Anything Next serves from app/ as an asset convention
// (icon, apple-icon, opengraph-image) belongs on this list.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|opengraph-image).*)"],
};
