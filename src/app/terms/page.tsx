import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";

export const metadata: Metadata = {
  title: "Kullanım koşulları | Mahlas",
  description: "Mahlas'ı kullanırken geçerli olan koşullar.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalDocument kind="terms" />;
}
