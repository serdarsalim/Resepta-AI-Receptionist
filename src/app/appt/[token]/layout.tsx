import type { Metadata } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { UNLISTED } from "@/lib/seo";

// Same call as /book/<slug>'s layout, and it matters more here: this page is
// only ever opened from a link inside a message the salon sent. A tab wearing
// our mark and our name, one tap from their message, is the product
// interrupting a conversation the customer was having with their barber.
//
// Reuses `manage` rather than a lean twin of `brand`: the token is the only
// key that resolves an appointment, the page itself calls this same query a
// moment later, and inventing a second token-reading endpoint on an
// unauthenticated surface is a second thing to get the scoping right on.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return UNLISTED;
  const appointment = await new ConvexHttpClient(url)
    .query(api.booking.manage, { token })
    .catch(() => null);
  if (!appointment?.orgName) return UNLISTED;
  return {
    ...UNLISTED,
    title: appointment.orgName,
    ...(appointment.logoUrl ? { icons: { icon: appointment.logoUrl } } : {}),
  };
}

export default function ManageAppointmentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
