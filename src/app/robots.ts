import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { hostFromHeader, originForHost } from "@/lib/hosts";

// Crawl policy. The disallow list is the part worth reading.
//
// /appt/ is a bearer capability, not a page. The token in the URL is the whole
// permission to view, move or cancel one appointment
// (src/app/appt/[token]/page.tsx), and those links go out over WhatsApp. A URL
// that has been fetched once lives in somebody's log forever, so keeping
// crawlers from fetching it at all is worth more here than the usual
// preference for noindex. The route carries a noindex too, for anything that
// ignores this file.
//
// /e/ is the same kind of thing: the open pixel and the unsubscribe page from
// customer email (forwarded by src/proxy.ts), each keyed by a per-message
// token. Nothing there is a page anyone should find, and an unsubscribe token
// in a crawler's log is one customer's opt-out in a stranger's hands. The
// unsubscribe page also sends a noindex header.
//
// /admin has no trailing slash on purpose. robots.txt matches literal
// prefixes: "/admin/" would cover /admin/<orgId> and quietly let a crawler
// through to /admin itself, which is the page.
//
// /r/ and /book/ are deliberately absent. They hold no secret, and both carry
// a noindex — which a crawler can only act on if it is allowed to fetch the
// page and read it. Disallowing them would preserve exactly the indexing they
// are trying to prevent.
//
// /api/ guards nothing today; there is no app/api directory and the backend is
// Convex. It stays as the cheap half of a decision nobody should have to make
// again when the first route handler lands.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();
  const origin = originForHost(hostFromHeader(requestHeaders.get("host")));

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/appt/", "/e/", "/signin"],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
