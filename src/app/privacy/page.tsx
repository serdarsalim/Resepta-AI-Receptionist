import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";
import { legalContactEmail } from "@/lib/legalContact";

export const metadata: Metadata = {
  title: "Gizlilik politikası | Resepta",
  description: "Resepta'nın hangi verileri tuttuğunu ve kimlerle paylaştığını anlatır.",
  alternates: { canonical: "/privacy" },
};

// Rendered per request, not at build: the contact address is an operator
// setting (src/lib/legalContact.ts), and a change in /admin has to reach this
// page without a deploy.
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  return <LegalDocument kind="privacy" contactEmail={await legalContactEmail()} />;
}
