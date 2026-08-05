import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { LanguageProvider } from "@/lib/LanguageProvider";
import { ToastProvider } from "@/lib/ToastProvider";
import { NO_FOUC_SCRIPT } from "@/lib/theme";
import { DEFAULT_TITLE } from "@/lib/brand";
import "./globals.css";
// Country flags are flag-icons CSS sprites, never Unicode flag emoji: Windows
// Chrome has no flag glyphs and renders those as the bare letters "TR".
import "flag-icons/css/flag-icons.min.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  // The signed-in app replaces this with the workspace's own name; see
  // lib/brand.ts. This is what everyone else reads.
  title: DEFAULT_TITLE,
  description:
    "Mahlas answers calls, books appointments and keeps customers informed in one connected workflow.",
  metadataBase: new URL("https://mahlas.xyz"),
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="tr" suppressHydrationWarning className={`${geistSans.variable} h-full`}>
        <body className="min-h-full antialiased">
          {/* Correct .dark class before hydration — no theme flash. */}
          <script dangerouslySetInnerHTML={{ __html: NO_FOUC_SCRIPT }} />
          <ConvexClientProvider>
            {/* Inside LanguageProvider: every toast is a translated string. */}
            <LanguageProvider>
              <ToastProvider>{children}</ToastProvider>
            </LanguageProvider>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
