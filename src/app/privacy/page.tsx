import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";

export const metadata: Metadata = {
  title: "Gizlilik politikası | Mahlas",
  description: "Mahlas'ın hangi verileri tuttuğunu ve kimlerle paylaştığını anlatır.",
};

export default function PrivacyPage() {
  return <LegalDocument kind="privacy" />;
}
