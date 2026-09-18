import type { Metadata } from "next";

export const SITE_NAME = "HomoLudens";
export const SITE_TAGLINE = "The world, priced in probability.";

function siteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (configured && /^https:\/\//i.test(configured)) return configured;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const ODDSFRONT_URL = siteOrigin();
export const SOCIAL_PREVIEW_PATH = "/brand/homoludens-social.svg";
export const SOCIAL_PREVIEW_URL = `${ODDSFRONT_URL}${SOCIAL_PREVIEW_PATH}`;
export const APP_ICON_PATH = "/brand/homoludens-mark.svg";
export const APPLE_ICON_PATH = APP_ICON_PATH;
export const BRAND_COLOR = "#111827";

const TITLE = "HomoLudens · News, priced in probability";
const DESCRIPTION = "Trending world news connected to live prediction-market probabilities.";
const SOCIAL_DESCRIPTION = "Politics, geopolitics, technology, health, crypto, internet culture and major global events — with relevant live prediction markets.";

export function buildOddsFrontSocialMetadata(path: string): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    openGraph: {
      type: "website", locale: "en_US", url: path, siteName: SITE_NAME,
      title: TITLE, description: SOCIAL_DESCRIPTION,
      images: [{ url: SOCIAL_PREVIEW_PATH, width: 1200, height: 630, alt: "HomoLudens — the world, priced in probability", type: "image/svg+xml" }],
    },
    twitter: { card: "summary_large_image", title: TITLE, description: SOCIAL_DESCRIPTION, images: [SOCIAL_PREVIEW_PATH] },
  };
}
