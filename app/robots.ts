import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/global-conflict-map-preview"] },
    host: "https://oddsfront.com",
    sitemap: ["https://oddsfront.com/sitemap.xml", "https://oddsfront.com/news-sitemap.xml"],
  };
}
