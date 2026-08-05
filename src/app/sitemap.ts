import type { MetadataRoute } from "next";
import { headers } from "next/headers";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host")?.split(":")[0];

  if (host === "docs.mahlas.xyz") {
    return [
      {
        url: "https://docs.mahlas.xyz",
        changeFrequency: "weekly",
        priority: 1,
      },
    ];
  }

  if (host === "demo.mahlas.xyz") {
    return [
      {
        url: "https://demo.mahlas.xyz",
        changeFrequency: "monthly",
        priority: 0.8,
      },
    ];
  }

  return [
    {
      url: "https://mahlas.xyz",
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "https://mahlas.xyz/privacy",
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: "https://mahlas.xyz/terms",
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
