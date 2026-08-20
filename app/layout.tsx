import type { Metadata, Viewport } from "next";

import { DeferredAnalytics } from "@/features/deferred-analytics";

import {
  APP_ICON_PATH,
  buildOddsFrontSocialMetadata,
  ODDSFRONT_URL,
  SOCIAL_PREVIEW_URL,
} from "@/lib/oddsfront-site";

import "./globals.css";

export const metadata: Metadata = {
  ...buildOddsFrontSocialMetadata("/global-conflict-map"),
  metadataBase: new URL(ODDSFRONT_URL),
  applicationName: "OddsFront",
  alternates: {
    canonical: "/global-conflict-map",
  },
  icons: {
    icon: [
      {
        url: APP_ICON_PATH,
        type: "image/svg+xml",
        sizes: "any",
      },
    ],
    shortcut: [
      {
        url: APP_ICON_PATH,
        type: "image/svg+xml",
        sizes: "any",
      },
    ],
    apple: [
      {
        url: APP_ICON_PATH,
        type: "image/svg+xml",
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
        <link
          rel="preload"
          href="/maps/world-lite-v1.svg"
          as="image"
          type="image/svg+xml"
          media="(max-width: 720px)"
          fetchPriority="high"
        />
      </head>
      <body>
        {children}
        {process.env.NODE_ENV === "production" ? <DeferredAnalytics /> : null}
      </body>
    </html>
  );
}
