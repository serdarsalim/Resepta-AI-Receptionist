import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";

export const metadata: Metadata = {
  title: "Kullanım koşulları | Randevu",
  description: "Randevu'yu kullanırken geçerli olan koşullar.",
};

export default function TermsPage() {
  return <LegalDocument kind="terms" />;
}
