import type { Metadata, Viewport } from "next";
import { Inter, Nunito, Roboto } from "next/font/google";
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

// The app's face (P31, Nudge d55ab896): Inter, on every page, the public
// booking, manage, help and legal pages included. It replaced Geist, which
// loaded the latin subset only, so ş, ğ, ı and İ fell back to another font in
// the middle of a Turkish word; Inter carries latin-ext. Two faces, each with
// a job, and never a third: this one, and Roboto below for the conversations.
const appSans = Inter({
  variable: "--font-app-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

// The COMMS face: Roboto, as WhatsApp Web ships it (Nudge measured it). Worn
// through .chat-font in globals.css by the Inbox list and its pills, the whole
// conversation pane on every channel tab, and the docked email window, so a
// person reads and writes every message in one face. Not preloaded: most
// pages never open a conversation.
const chatSans = Roboto({
  variable: "--font-chat",
  subsets: ["latin", "latin-ext"],
  weight: "variable",
  display: "swap",
  preload: false,
});

// The wordmark's face, and ONLY the wordmark's. resepta.xyz sets Nunito on
// <html> and runs the entire marketing site in it; here it is scoped to the
// six letters of the signature, because the product's reading face is Inter
// and swapping every table, form and message thread to a rounded display sans
// is a different decision from making the brand mark match its own website.
//
// One weight, 800, which is what the marketing lockup wears
// (`text-xl font-extrabold tracking-tight`). Naming the weight rather than
// omitting it ships the static cut instead of the whole variable range, so the
// signature costs one small file rather than an axis nothing here animates.
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["800"],
});

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
        className={`${appSans.variable} ${nunito.variable} ${chatSans.variable} h-full`}
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
