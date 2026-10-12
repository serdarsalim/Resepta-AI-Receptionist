import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

// The contact address /privacy and /terms print, read per request on the
// server. It is an operator setting (/admin → Platform → Legal pages), so it
// cannot live in src/lib/legal.ts: a constant there needed a deploy to change
// and sat empty, which left the pages promising answers with no address to
// write to.
//
// Read on the server rather than with useQuery so the address is in the HTML
// itself. Google's and Meta's reviewers fetch these pages anonymously and are
// not guaranteed to run the client bundle.
//
// Never throws: a Convex hiccup costs the contact sentences, not the policy.
// The pages already know how to read without an address (LegalDocument).
export async function legalContactEmail(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return await new ConvexHttpClient(url)
    .query(api.platformConfig.legalContact, {})
    .catch(() => null);
}
