import type { Metadata } from "next";
import { DemoEntry } from "@/components/DemoEntry";

export const metadata: Metadata = {
  title: "Mahlas demo",
  description:
    "Explore Mahlas with a fictional appointment business. No signup and no real messages.",
  alternates: { canonical: "https://demo.mahlas.xyz" },
};

export default function DemoPage() {
  return <DemoEntry />;
}
