import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev-tools bubble sits bottom-left, exactly on top of the
  // sidebar's Settings entry, which is where the QA passes keep happening.
  // Dev-only UI either way — nothing here affects a production build.
  devIndicators: false,
};

export default nextConfig;
