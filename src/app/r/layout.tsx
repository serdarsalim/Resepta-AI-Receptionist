import type { Metadata } from "next";
import { UNLISTED } from "@/lib/seo";

// The request form is built to be embedded in the salon's own website, so a
// bare copy of it competing with that page in search results helps nobody —
// least of all the salon, which would be outranked by its own form.
export const metadata: Metadata = UNLISTED;

export default function RequestFormLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
