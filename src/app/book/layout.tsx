import type { Metadata } from "next";
import { UNLISTED } from "@/lib/seo";

// Same reasoning as the request form at /r: the booking page is a link an
// owner hands to a customer, not a page anyone should arrive at from a search.
// It is left crawlable in robots.txt on purpose — a crawler has to be allowed
// to fetch the page before it can read this noindex.
export const metadata: Metadata = UNLISTED;

export default function BookingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
