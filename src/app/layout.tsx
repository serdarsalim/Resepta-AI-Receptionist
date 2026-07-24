import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { LanguageProvider } from "@/lib/LanguageProvider";
import "./globals.css";

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
          <ConvexClientProvider>
            <LanguageProvider>{children}</LanguageProvider>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
