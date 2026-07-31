// Where this deployment's HTTP actions live — the base for every URL a customer
// is told to paste into somebody else's dashboard (Retell functions, the
// call-ended webhook, the cal.com webhook).
//
// Derived by swapping .convex.cloud → .convex.site, which works in the cloud and
// quietly fails on a local backend where the two are PORTS and not domains.
// NEXT_PUBLIC_CONVEX_SITE_URL states it outright, so prefer it.
//
// The reason this is a shared helper and not two copies: the copies existed, in
// SettingsView and BusinessView, and a production build shipped
// "http://127.0.0.1:3213/retell/functions" onto a page whose whole purpose is
// to be copied into Retell. A URL nobody outside this laptop can reach is worse
// than no URL, because it looks like it worked.

export type SiteUrl = {
  url: string;
  /** Points at this machine — useless to any external service. */
  isLocal: boolean;
  /** Local URL while the page itself is served from somewhere else. Always a
   *  misconfiguration: a deployed app cannot hand out a loopback address. */
  isMisconfigured: boolean;
};

const LOCAL_HOST = /^(https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:|\/|$)/i;

export function resolveSiteUrl(): SiteUrl {
  const url =
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
    (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(
      ".convex.cloud",
      ".convex.site",
    );

  const isLocal = LOCAL_HOST.test(url);
  // A local site URL is perfectly normal while developing — the browser is on
  // localhost too. It is only wrong when the page came from somewhere else,
  // which is exactly the deployed case nobody notices until a client follows
  // the instructions and nothing fires.
  const pageIsLocal =
    typeof window !== "undefined" ? LOCAL_HOST.test(window.location.origin) : true;

  return { url, isLocal, isMisconfigured: isLocal && !pageIsLocal };
}
