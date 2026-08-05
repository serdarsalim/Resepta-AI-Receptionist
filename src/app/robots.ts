import type { MetadataRoute } from "next";
import { headers } from "next/headers";

function originForHost(host: string | null) {
  if (host === "docs.mahlas.xyz") return "https://docs.mahlas.xyz";
  if (host === "demo.mahlas.xyz") return "https://demo.mahlas.xyz";
  return "https://mahlas.xyz";
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host")?.split(":")[0] ?? null;
  const origin = originForHost(host);

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/api/", "/signin"],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
