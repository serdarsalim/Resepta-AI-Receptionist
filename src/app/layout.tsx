import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { LanguageProvider } from "@/lib/LanguageProvider";
import { ToastProvider } from "@/lib/ToastProvider";
import { NO_FOUC_SCRIPT } from "@/lib/theme";
import { DEFAULT_TITLE } from "@/lib/brand";
import { APEX_ORIGIN } from "@/lib/hosts";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";
import "./globals.css";
// Country flags are flag-icons CSS sprites, never Unicode flag emoji: Windows
// Chrome has no flag glyphs and renders those as the bare letters "TR".
import "flag-icons/css/flag-icons.min.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

// Next's default viewport is width=device-width,initial-scale=1 and nothing
// else, which is fine until you ask for a safe-area inset: env(safe-area-inset-*)
// reads 0 on iOS unless the page opts into drawing under the notch and the home
// indicator. The app's bottom tab bar is pinned to the foot of a 100dvh column,
// so without viewport-fit=cover its labels sit under the indicator on every
// iPhone since the X.
export const viewport: Viewport = {
  viewportFit: "cover",
};

export const metadata: Metadata = {
  // The signed-in app replaces this with the workspace's own name; see
  // lib/brand.ts. This is what everyone else reads.
  title: DEFAULT_TITLE,
  description:
    "Resepta connects calls, customer records, appointments, confirmations and reminders in one front desk for appointment businesses.",
  applicationName: "Resepta",
  category: "business",
  metadataBase: new URL(APEX_ORIGIN),
  // Relative, so metadataBase stays the single place the origin is written.
  //
  // Inherited by every route that does not set its own `alternates`, which is
  // the behaviour /privacy, /terms, /help and /demo each override with theirs.
  // The three "use client" public pages cannot override anything, so they get
  // a server layout carrying UNLISTED from src/lib/seo.ts instead.
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Resepta",
    title: DEFAULT_TITLE,
    description:
      "The call becomes a booking. The follow-up stays connected in one front desk for appointment businesses.",
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description:
      "Calls, bookings, customer context and follow-up in one connected front desk.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ConvexAuthNextjsServerProvider>
      {/* The server render has to use the default for the markup to match on
          hydration; LanguageProvider corrects this attribute once it knows what
          the visitor actually reads. Taking the value from i18n.ts rather than
          writing "tr" twice keeps the two from drifting apart. */}
      <html
        lang={DEFAULT_LANGUAGE}
        suppressHydrationWarning
        className={`${geistSans.variable} h-full`}
      >
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
