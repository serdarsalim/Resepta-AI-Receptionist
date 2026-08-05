import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";

export const metadata: Metadata = {
  title: "Kullanım koşulları | Mahlas",
  description: "Mahlas'ı kullanırken geçerli olan koşullar.",
};

export default function TermsPage() {
  return <LegalDocument kind="terms" />;
}
