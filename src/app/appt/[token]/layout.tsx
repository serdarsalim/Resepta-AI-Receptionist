import type { Metadata } from "next";
import { headers } from "next/headers";
import { UNLISTED } from "@/lib/seo";
import { apptMetadata, loadManageBrand } from "@/lib/linkPreviewServer";

// Same call as /book/<slug>'s layout, and it matters more here: this page is
// only ever opened from a link inside a message the salon sent. A tab wearing
// our mark and our name, one tap from their message, is the product
// interrupting a conversation the customer was having with their barber.
//
// Reads `booking.manageBrand`, not `manage` (P27): the link preview needs the
// business's public slug to draw its card under, which the page itself must
// not be handed, and nothing about the appointment, which a forwarded link's
// preview must not show. Both go through the same `appointmentByToken`, so
// the token is resolved and scoped in one place either way.
//
// The preview names the business and nobody else (lib/linkPreview). Its page
// URL is left out, since that URL is the token, and its picture lives at
// /book/<slug>/og.png?for=appt for the same reason. robots.txt still keeps
// well-behaved crawlers off /appt/ entirely; a chat app that fetches it
// anyway gets only this.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const brand = await loadManageBrand(token);
  if (!brand?.orgName) return UNLISTED;
  return {
    ...UNLISTED,
    title: brand.orgName,
    ...apptMetadata(await headers(), brand),
    ...(brand.logoUrl ? { icons: { icon: brand.logoUrl } } : {}),
  };
}

export default function ManageAppointmentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
