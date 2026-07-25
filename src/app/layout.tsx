import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { LanguageProvider } from "@/lib/LanguageProvider";
import { NO_FOUC_SCRIPT } from "@/lib/theme";
import "./globals.css";
// Country flags are flag-icons CSS sprites, never Unicode flag emoji: Windows
// Chrome has no flag glyphs and renders those as the bare letters "TR".
import "flag-icons/css/flag-icons.min.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Randevu",
  description: "WhatsApp appointment reminders for small businesses",
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
            <LanguageProvider>{children}</LanguageProvider>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
