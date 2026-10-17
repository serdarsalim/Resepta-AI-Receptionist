import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextResponse } from "next/server";
import { DEMO_HOST, DOCS_HOST, hostFromHeader } from "@/lib/hosts";
import { resolveSiteUrl } from "@/lib/siteUrl";

const isSignInPage = createRouteMatcher(["/signin"]);

// The links inside customer email: the open pixel (/e/o/<token>), the
// unsubscribe page (/e/u/<token>) and a library image placed in the body
// (/e/i/<assetId>, P26). They are minted on this app's own origin
// (SITE_URL, convex/lib/email.ts emailLinkOrigin) so a mail never shows a bare
// *.convex.site address, and forwarded here to the Convex routes of the same
// name (convex/http.ts), which hold all the logic. A rewrite, not a redirect:
// the reader's address bar keeps our domain, and the unsubscribe page's form
// posts back to the same path. Method, headers and body travel with it, so
// a mail client's one-click POST (RFC 8058) arrives as it was sent. Mail sent
// before 2026-10-13 points at convex.site directly, which still answers.
//
// Exactly one token segment, nothing after it: this forwards three routes,
// not a prefix of the backend.
const EMAIL_LINK = /^\/e\/[oui]\/[^/]+$/;

function emailLinkTarget(pathname: string): URL | null {
  if (!EMAIL_LINK.test(pathname)) return null;
  const { url } = resolveSiteUrl();
  return url ? new URL(pathname, url) : null;
}

// The public pages. Whoever opens /book/<slug> is a customer of the salon, not
// a user of this product — they have no account and never will. Sending them
// to a Google sign-in screen breaks the feature outright.
//
// Safe to leave unauthenticated because the BACKEND is what enforces this, not
// the route: every function these pages call is keyed by the org's public slug
// (or an appointment's manage token) rather than by requireOrg, and publishes
// only the business name and its active service names — no prices, no counts,
// no customer data. A slug whose page is switched off is indistinguishable
// from one that does not exist.
//
// Anything added to this matcher must clear the same bar. A route is public
// when the functions behind it are public; making one reachable without
// checking that is how a tenancy boundary gets deleted by a routing change.
//
// /privacy and /terms clear it the easy way. Their prose is static, from
// src/lib/legal.ts, and the one Convex function they call,
// platformConfig.legalContact, returns the contact address the operator chose
// to publish on them and nothing else: no tenant, no customer, no other
// setting. They have to be public for a harder reason than politeness, though.
// Google's OAuth consent screen and Meta's app review both fetch these URLs
// anonymously, and a redirect to /signin reads to them as a missing policy.
//
// `/` was on this list while it was the landing page for anyone signed out. It
// came off on 2026-08-24, when marketing moved to its own repo at the apex and
// this deployment became app.resepta.xyz: `/` is the app and nothing else, so
// it is exactly as public as /inbox is, which is to say not. The redirect at
// the foot of this file is now the ONLY thing deciding what a stranger sees
// there, which is one rule in one place rather than a route excused here and
// re-checked in the page.
//
// The demo host is unaffected: demo.resepta.xyz/ is REWRITTEN to /demo above,
// and a rewrite returns before this matcher is consulted.
// /book/<slug> and /appt/<token> both shipped without being added here — which
// meant the booking page an owner shares and the manage link we send over
// WhatsApp (convex/wa.ts) both bounced the customer to a Google sign-in
// screen. Neither audience has an account.
//
// The functions behind them are keyed to what the visitor was given:
// convex/booking.ts `page`, `slots` and `book` take the org's public slug;
// `manage`, `reschedule` and `cancel` take the appointment's manage token and
// nothing else. The token IS the permission, scoped to one appointment, so a
// stranger who guesses one gets that appointment and no other. `enable`, the
// owner-side toggle in the same file, takes neither and stays behind requireOrg
// where it belongs.
const isPublicPage = createRouteMatcher([
  "/book/(.*)",
  "/appt/(.*)",
  "/privacy",
  "/terms",
  "/help",
  "/help/(.*)",
  "/demo",
]);

// Keep this as Next 16's named proxy export. Its Node-runtime loader has a
// separate default-export interop path, and a bad module shape there surfaces
// only as the opaque `adapterFn is not a function` request-time crash.
export const proxy = convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  // First of all, on every host: a mail client loading a pixel has no
  // session, needs none, and must not be bounced to /signin. The token is
  // the whole permission, checked by the Convex route.
  const emailLink = emailLinkTarget(request.nextUrl.pathname);
  if (emailLink) return NextResponse.rewrite(emailLink);

  // Keep help content in the product repository so it cannot drift from the
  // shipped interface, while giving it a clean public docs origin.
  const host = hostFromHeader(request.headers.get("host"));
  if (host === DOCS_HOST && request.nextUrl.pathname === "/") {
    const helpUrl = request.nextUrl.clone();
    helpUrl.pathname = "/help";
    return NextResponse.rewrite(helpUrl);
  }

  // The demo origin opens on a purpose-built explanation for a new visitor,
  // then becomes the real app on the same host once anonymous sign-in has
  // created the demo-only session. Keeping the session on demo.resepta.xyz
  // prevents an owner's resepta.xyz session from being replaced by a preview.
  if (host === DEMO_HOST && request.nextUrl.pathname === "/") {
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
}, {
  // Stay signed in across a browser restart (P18, Nudge ee5537f0). Without a
  // maxAge the auth cookies are session cookies, gone when the browser
  // closes although the session behind them is still valid; 30 days matches
  // Convex Auth's own refresh-token inactivity window. Signing out still
  // ends it at once.
  cookieConfig: { maxAge: 30 * 24 * 60 * 60 },
});

// Public assets sit here for the same reason favicon.ico always did. If the auth
// check catches an image request, the browser receives a 307 to an HTML sign-in
// page and renders a broken image. The /images directory contains landing-page
// media only; it calls no backend function and carries no tenant data.
//
// /embed.js (P29) is the loader a business pastes into its own website to
// frame its booking page: a static file in public/ that reads no backend and
// carries nothing of any business.
//
// Every dot here is escaped, because this string is compiled to a regex and an
// unescaped one matches any character: `favicon.ico` was also excusing
// /faviconXico from the auth check. Nothing routes there, so nothing leaked —
// but the exclusion list should name paths, not patterns that happen to
// contain them.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|images|favicon\\.ico|icon\\.svg|apple-icon\\.png|opengraph-image|robots\\.txt|sitemap\\.xml|embed\\.js).*)",
  ],
};
