// The three hostnames this one deployment answers on, and the only place they
// are spelled out.
//
// One Vercel project serves all three. Which one a request arrived on decides
// what the proxy rewrites (src/proxy.ts), which sitemap gets built
// (src/app/sitemap.ts) and which origin robots.txt advertises
// (src/app/robots.ts). Those three files each used to carry their own copy of
// this table in a slightly different shape, which meant renaming a domain was
// three edits with no error if you missed one — robots.txt would just keep
// pointing crawlers at a sitemap that no longer existed.

export const APEX_HOST = "resepta.xyz";
export const DOCS_HOST = "docs.resepta.xyz";
export const DEMO_HOST = "demo.resepta.xyz";

export const APEX_ORIGIN = `https://${APEX_HOST}`;
export const DOCS_ORIGIN = `https://${DOCS_HOST}`;
export const DEMO_ORIGIN = `https://${DEMO_HOST}`;

// The Host header carries the port in local development and nothing useful
// anywhere else, so it is cut before comparison.
export function hostFromHeader(value: string | null | undefined): string | null {
  return value?.split(":")[0] ?? null;
}

// Anything unrecognised is the apex: preview deployments, localhost, and a
// spoofed Host header all land here. Falling back rather than echoing the
// request's own host is deliberate — it means no request can talk this
// deployment into advertising a domain we do not own.
export function originForHost(host: string | null): string {
  if (host === DOCS_HOST) return DOCS_ORIGIN;
  if (host === DEMO_HOST) return DEMO_ORIGIN;
  return APEX_ORIGIN;
}
