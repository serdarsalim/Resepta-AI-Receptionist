import type { Metadata } from "next";
import { HelpCenter } from "@/components/HelpCenter";
import { DOCS_ORIGIN } from "@/lib/hosts";

export const metadata: Metadata = {
  title: "Help Center | Resepta",
  description:
    "Learn how to set up Resepta, manage appointments and customers, configure the phone agent, and automate customer messages.",
  // Absolute, unlike /privacy and /terms: this page is served on the apex too,
  // and both copies should consolidate onto the docs origin.
  alternates: { canonical: DOCS_ORIGIN },
};

export default function HelpPage() {
  return <HelpCenter />;
}
