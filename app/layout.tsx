import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  APP_ICON_PATH,
  APPLE_ICON_PATH,
  BRAND_COLOR,
  buildOddsFrontSocialMetadata,
  ODDSFRONT_URL,
  SOCIAL_PREVIEW_URL,
} from "@/lib/oddsfront-site";

import "./globals.css";

export const metadata: Metadata = {
  ...buildOddsFrontSocialMetadata("/global-conflict-map"),
  metadataBase: new URL(ODDSFRONT_URL),
  applicationName: "OddsFront",
  manifest: "/site.webmanifest",
  appleWebApp: {
    title: "OddsFront",
    capable: false,
  },
  alternates: {
    canonical: "/global-conflict-map",
  },
  icons: {
    icon: [
      {
        url: "/brand/oddsfront-favicon-48-v1.png",
        type: "image/png",
        sizes: "48x48",
      },
      {
        url: "/brand/oddsfront-favicon-96-v1.png",
        type: "image/png",
        sizes: "96x96",
      },
      {
        url: APP_ICON_PATH,
        type: "image/svg+xml",
        sizes: "any",
      },
    ],
    shortcut: [
      {
        url: "/favicon.ico?v=oddsfront-1",
        type: "image/x-icon",
      },
    ],
    apple: [
      {
        url: APPLE_ICON_PATH,
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020a16",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta property="og:image:secure_url" content={SOCIAL_PREVIEW_URL} />
        <link rel="image_src" href={SOCIAL_PREVIEW_URL} />
        <link rel="mask-icon" href="/brand/oddsfront-pinned-tab-v1.svg" color={BRAND_COLOR} />
      </head>
      <body>
        {children}
        {process.env.NODE_ENV === "production" ? (
          <Analytics mode="production" />
        ) : null}
      </body>
    </html>
  );
}
