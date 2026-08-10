import type { Metadata } from "next";

export const ODDSFRONT_URL = "https://oddsfront.com";
export const SOCIAL_PREVIEW_PATH = "/brand/oddsfront-social-preview-v1.png";
export const SOCIAL_PREVIEW_URL = `${ODDSFRONT_URL}${SOCIAL_PREVIEW_PATH}`;
export const APP_ICON_PATH = "/brand/dropsbot-app-icon-v4.svg";

const TITLE = "OddsFront · Global Conflict Prediction Map";
const DESCRIPTION =
  "Live map for tracking active conflict and geopolitics prediction markets.";
const SOCIAL_DESCRIPTION =
  "Track live conflict and geopolitics prediction markets on the OddsFront world map.";

export function buildOddsFrontSocialMetadata(path: string): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    openGraph: {
      type: "website",
      locale: "en_US",
      url: path,
      siteName: "OddsFront by DropsBot",
      title: TITLE,
      description: SOCIAL_DESCRIPTION,
      images: [
        {
          url: SOCIAL_PREVIEW_PATH,
          width: 1920,
          height: 1079,
          alt: "OddsFront interactive conflict and geopolitics prediction market map",
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
