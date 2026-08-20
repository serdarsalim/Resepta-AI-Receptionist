import type { Metadata } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { UNLISTED } from "@/lib/seo";

// The tab wears the SALON, not us: their name as the title, their logo as the
// favicon. A customer taps this link inside a WhatsApp reminder and is looking
// for their barber — a tab reading "Resepta | AI front desk for appointment
// businesses" beside our red chevron tells them nothing about whose page they
// have open, and among twenty tabs on a phone it is unfindable.
//
// SERVER metadata, not a document.title effect. React owns the <title> and the
// icon <link>s it renders from metadata, so a client-side write is reverted the
// next time the tree reconciles — which on this page is every time the Convex
// query updates. The effect version shipped for about ten minutes and lost to
// exactly that.
//
// The round trip buys a second thing worth having: a booking link pasted into
// WhatsApp or Instagram now unfurls as the salon, because the crawler reads
// this instead of the client render it never runs.
//
// UNLISTED still applies — same reasoning as before, a link an owner hands out
// rather than a page anyone should find in a search.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return UNLISTED;
  // Never throws the page away over a title. A Convex hiccup here would
  // otherwise 500 a booking page that renders perfectly well without one.
  const brand = await new ConvexHttpClient(url)
    .query(api.booking.brand, { slug })
    .catch(() => null);
  if (!brand?.orgName) return UNLISTED;
  return {
    ...UNLISTED,
    // The name ALONE. A tab strip truncates from the right, so a " — Resepta"
    // suffix costs the customer the only half that identifies the page while
    // buying us a credit nobody reads.
    title: brand.orgName,
    openGraph: { title: brand.orgName, images: brand.logoUrl ? [brand.logoUrl] : undefined },
    ...(brand.logoUrl ? { icons: { icon: brand.logoUrl } } : {}),
  };
}

export default function BookingSlugLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
