import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";
import { legalContactEmail } from "@/lib/legalContact";

export const metadata: Metadata = {
  title: "Kullanım koşulları | Resepta",
  description: "Resepta'yı kullanırken geçerli olan koşullar.",
  alternates: { canonical: "/terms" },
};

// Per request, for the same reason as /privacy: the contact address is an
// operator setting read from Convex (src/lib/legalContact.ts).
export const dynamic = "force-dynamic";

export default async function TermsPage() {
  return <LegalDocument kind="terms" contactEmail={await legalContactEmail()} />;
}
