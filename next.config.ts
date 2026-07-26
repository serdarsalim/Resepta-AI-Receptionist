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
  // The request form is the one exception, because being embedded in a
  // salon's own website is the entire point of it. It carries no session and
  // no customer data: it collects, it does not display. That is what makes it
  // safe to let anybody frame, and why the exception is scoped to /r/ rather
  // than loosened globally.
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
        source: "/r/:slug*",
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
