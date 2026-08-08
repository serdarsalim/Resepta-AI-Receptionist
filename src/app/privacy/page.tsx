import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";

export const metadata: Metadata = {
  title: "Gizlilik politikası | Resepta",
  description: "Resepta'nın hangi verileri tuttuğunu ve kimlerle paylaştığını anlatır.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <LegalDocument kind="privacy" />;
}
