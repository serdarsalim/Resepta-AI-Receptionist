import type { Metadata } from "next";
import { DemoEntry } from "@/components/DemoEntry";
import { DEMO_ORIGIN } from "@/lib/hosts";

export const metadata: Metadata = {
  title: "Mahlas demo",
  description:
    "Explore Mahlas with a fictional appointment business. No signup and no real messages.",
  alternates: { canonical: DEMO_ORIGIN },
};

export default function DemoPage() {
  return <DemoEntry />;
}
