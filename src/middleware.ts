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
const isPublicPage = createRouteMatcher(["/r/(.*)"]);

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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
