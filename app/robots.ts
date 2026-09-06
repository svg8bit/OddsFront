import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    host: "https://oddsfront.com",
    sitemap: "https://oddsfront.com/sitemap.xml",
  };
}
