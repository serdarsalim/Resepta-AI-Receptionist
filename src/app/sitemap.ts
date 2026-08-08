import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import {
  APEX_ORIGIN,
  DEMO_HOST,
  DEMO_ORIGIN,
  DOCS_HOST,
  DOCS_ORIGIN,
  hostFromHeader,
} from "@/lib/hosts";
import { LEGAL_UPDATED_ISO } from "@/lib/legal";

// One deployment, three domains, three different sitemaps. Each host lists
// only the pages that canonicalise to it, which is why the apex sitemap has no
// /help or /demo in it: those pages exist on mahlas.xyz, but they point their
// canonical at docs. and demo. respectively, and a sitemap that contradicts a
// canonical is a sitemap Google ignores.
//
// lastModified is the only one of the three optional fields worth setting.
// Google has said outright that it ignores changefreq and priority, and reads
// lastmod to decide whether a recrawl is worth the fetch — so this file used to
// carry the two hints nobody reads and omit the one they do.
//
// These dates are maintained by hand, and that is the honest option: nothing at
// runtime knows when a React component's copy last changed, and a build
// timestamp would announce that every page changed on every deploy, which is
// how a site teaches Google to stop trusting its lastmod. Bump the entry when
// you change the copy behind it. The legal pages are the exception and read
// their date from the document itself, so they cannot drift from what the page
// prints.
const LANDING_UPDATED = "2026-08-05";
const HELP_UPDATED = "2026-08-05";
const DEMO_UPDATED = "2026-08-05";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const requestHeaders = await headers();
  const host = hostFromHeader(requestHeaders.get("host"));

  if (host === DOCS_HOST) {
    return [{ url: DOCS_ORIGIN, lastModified: HELP_UPDATED }];
  }

  if (host === DEMO_HOST) {
    return [{ url: DEMO_ORIGIN, lastModified: DEMO_UPDATED }];
  }

  return [
    { url: APEX_ORIGIN, lastModified: LANDING_UPDATED },
    { url: `${APEX_ORIGIN}/privacy`, lastModified: LEGAL_UPDATED_ISO },
    { url: `${APEX_ORIGIN}/terms`, lastModified: LEGAL_UPDATED_ISO },
  ];
}
