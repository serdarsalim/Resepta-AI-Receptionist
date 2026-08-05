import type { Metadata } from "next";
import { HelpCenter } from "@/components/HelpCenter";

export const metadata: Metadata = {
  title: "Help Center | Mahlas",
  description:
    "Learn how to set up Mahlas, manage appointments and customers, configure the phone agent, and automate customer messages.",
  alternates: { canonical: "https://docs.mahlas.xyz" },
};

export default function HelpPage() {
  return <HelpCenter />;
}
