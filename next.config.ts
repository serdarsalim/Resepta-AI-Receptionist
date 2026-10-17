import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev-tools bubble sits bottom-left, exactly on top of the
  // sidebar's Settings entry, which is where the QA passes keep happening.
  // Dev-only UI either way — nothing here affects a production build.
  devIndicators: false,

  // Framing policy, and it is a security control rather than a preference.
  //
  // The APP must never be framable. A salon owner's session lives in this tab,
  // and a page that can be layered under an invisible overlay is a page whose
  // buttons a stranger can get clicked — cancel the appointment, delete the
  // customer. Default deny.
  //
  // The framed booking page is the one exception (P29), because being
  // embedded in a business's own website is the entire point of it. It
  // carries no session and no customer data: it shows what the business
  // publishes and collects a booking, it displays nobody. That is what makes
  // it safe to let anybody frame, and why the exception is scoped to
  // /book/<slug>/embed rather than loosened globally: the plain booking page,
  // the manage page and the app stay unframeable. (The request form at /r/
  // held this exception until it was retired on 2026-08-19.)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/book/:slug/embed",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          // X-Frame-Options has no "allow any origin" value and an older
          // browser reading a leftover DENY would blank the embed, so it is
          // cleared here rather than overridden.
          { key: "X-Frame-Options", value: "" },
        ],
      },
    ];
  },
};

export default nextConfig;
