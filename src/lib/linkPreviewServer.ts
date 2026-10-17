// The server half of a pasted link's preview (P27; lib/linkPreview has the
// words): what the business's page holds, and the Open Graph tags that say
// so. Read by the /book and /appt layouts' generateMetadata, which is what a
// chat app's crawler sees, and by the card route.
//
// Everything here falls back rather than throws: a preview that fails must
// leave the page itself working, and a crawler that gets a 500 caches the
// failure.

import type { Metadata } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import {
  apptPreview,
  bookPreview,
  cardVersion,
  type ApptPreviewInput,
  type BookPreviewInput,
  type PreviewModel,
} from "@/lib/linkPreview";

type HeaderBag = { get(name: string): string | null };

function client(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  return url ? new ConvexHttpClient(url) : null;
}

/** The address the request came in on. A booking link is minted on whatever
 *  origin the owner's app runs at (BusinessView reads window.location), and
 *  a crawler needs an absolute https URL to the picture on that same origin;
 *  metadataBase names the marketing apex, which serves none of this. */
export function requestOrigin(h: HeaderBag): string | null {
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (!host) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = (h.get("x-forwarded-proto") ?? (local ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}

export type BrandRow = {
  orgName: string;
  logoUrl: string | null;
  language: string;
  services: BookPreviewInput["services"] | null;
  address: string | null;
};

/** The business behind a slug, or null when no business has it. `services`
 *  is null while its booking page is switched off. */
export async function loadBrand(slug: string): Promise<BrandRow | null> {
  try {
    return (await client()?.query(api.booking.brand, { slug })) ?? null;
  } catch {
    return null;
  }
}

export type ManageBrandRow = ApptPreviewInput & { slug: string | null };

export async function loadManageBrand(token: string): Promise<ManageBrandRow | null> {
  try {
    return (await client()?.query(api.booking.manageBrand, { token })) ?? null;
  } catch {
    return null;
  }
}

/** The booking page's preview, or null when the page is switched off. */
export function bookModel(brand: BrandRow): PreviewModel | null {
  if (!brand.services) return null;
  return bookPreview({ ...brand, services: brand.services });
}

function previewMetadata(model: PreviewModel, pageUrl: string | null, imageUrl: string | null): Metadata {
  const images = imageUrl
    ? [{ url: imageUrl, width: 1200, height: 630, alt: model.title, type: "image/png" }]
    : undefined;
  return {
    description: model.description,
    openGraph: {
      type: "website",
      title: model.title,
      description: model.description,
      ...(pageUrl ? { url: pageUrl } : {}),
      siteName: model.siteName,
      locale: model.language === "tr" ? "tr_TR" : model.language === "de" ? "de_DE" : "en_US",
      ...(images ? { images } : {}),
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title: model.title,
      description: model.description,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
  };
}

const enc = encodeURIComponent;

/** /book/<slug>: the business, what it offers, where it is. */
export function bookMetadata(h: HeaderBag, slug: string, model: PreviewModel): Metadata {
  const origin = requestOrigin(h);
  const path = `/book/${enc(slug)}`;
  return previewMetadata(
    model,
    origin ? `${origin}${path}` : null,
    origin ? `${origin}${path}/og.png?v=${cardVersion(model)}` : null,
  );
}

/** /appt/<token>: the business and a neutral line. No page URL (it would be
 *  the token), and the picture is the business's, drawn under its slug. */
export function apptMetadata(h: HeaderBag, brand: ManageBrandRow): Metadata {
  const origin = requestOrigin(h);
  const model = apptPreview(brand);
  const image =
    origin && brand.slug
      ? `${origin}/book/${enc(brand.slug)}/og.png?for=appt&v=${cardVersion(model)}`
      : null;
  return previewMetadata(model, null, image);
}
