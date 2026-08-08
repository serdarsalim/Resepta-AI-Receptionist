import type { Metadata } from "next";
import { UNLISTED } from "@/lib/seo";

// The manage page is one customer's appointment, reachable by anyone holding
// the token. robots.txt already disallows /appt/ so a well-behaved crawler
// never gets here; this is the second lock, for the ones that are not.
export const metadata: Metadata = UNLISTED;

export default function ManageAppointmentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
