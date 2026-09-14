import type { Metadata } from "next";

export const ODDSFRONT_URL = "https://oddsfront.com";
export const SOCIAL_PREVIEW_PATH = "/brand/oddsfront-social-preview-v3.png";
export const SOCIAL_PREVIEW_URL = `${ODDSFRONT_URL}${SOCIAL_PREVIEW_PATH}`;
export const APP_ICON_PATH = "/brand/oddsfront-icon-v1.svg";
export const APPLE_ICON_PATH = "/brand/oddsfront-apple-touch-icon-v1.png";
export const BRAND_COLOR = "#6366F1";

const TITLE = "Global Conflict Map & Prediction Market Odds | OddsFront";
const DESCRIPTION =
  "Track live geopolitical prediction market odds on an interactive world map, with verified news and probability changes.";
const SOCIAL_DESCRIPTION =
  "Follow live geopolitical prediction market odds, verified world news, and probability changes on OddsFront.";

export function buildOddsFrontSocialMetadata(path: string): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    openGraph: {
      type: "website",
      locale: "en_US",
      url: path,
      siteName: "OddsFront",
      title: TITLE,
      description: SOCIAL_DESCRIPTION,
      images: [
        {
          url: SOCIAL_PREVIEW_PATH,
          width: 1200,
          height: 630,
          alt: "OddsFront — live conflict and geopolitics prediction market map",
          type: "image/png",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: SOCIAL_DESCRIPTION,
      images: [SOCIAL_PREVIEW_PATH],
    },
  };
}
