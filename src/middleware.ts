import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextResponse } from "next/server";

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
const isPublicPage = createRouteMatcher([
  "/r/(.*)",
  "/privacy",
  "/terms",
  "/help",
  "/help/(.*)",
  "/demo",
  "/",
]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  // Keep help content in the product repository so it cannot drift from the
  // shipped interface, while giving it a clean public docs origin.
  const host = request.headers.get("host")?.split(":")[0];
  if (host === "docs.mahlas.xyz" && request.nextUrl.pathname === "/") {
    const helpUrl = request.nextUrl.clone();
    helpUrl.pathname = "/help";
    return NextResponse.rewrite(helpUrl);
  }

  // The demo origin opens on a purpose-built explanation for a new visitor,
  // then becomes the real app on the same host once anonymous sign-in has
  // created the demo-only session. Keeping the session on demo.mahlas.xyz
  // prevents an owner's mahlas.xyz session from being replaced by a preview.
  if (host === "demo.mahlas.xyz" && request.nextUrl.pathname === "/") {
    const isAuthed = await convexAuth.isAuthenticated();
    if (!isAuthed) {
      const demoUrl = request.nextUrl.clone();
      demoUrl.pathname = "/demo";
      return NextResponse.rewrite(demoUrl);
    }
  }

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

// Public assets sit here for the same reason favicon.ico always did. If the auth
// check catches an image request, the browser receives a 307 to an HTML sign-in
// page and renders a broken image. The /images directory contains landing-page
// media only; it calls no backend function and carries no tenant data.
export const config = {
  matcher: ["/((?!_next/static|_next/image|images|favicon.ico|icon.svg|apple-icon.png|opengraph-image).*)"],
};
