import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  APP_ICON_PATH,
  APPLE_ICON_PATH,
  buildOddsFrontSocialMetadata,
  ODDSFRONT_URL,
} from "@/lib/oddsfront-site";

import "./globals.css";
import { LocaleProvider } from "@/components/locale-provider";

export const metadata: Metadata = {
  ...buildOddsFrontSocialMetadata("/global-conflict-map"),
  metadataBase: new URL(ODDSFRONT_URL),
  applicationName: "OddsFront",
  creator: "OddsFront",
  publisher: "OddsFront",
  category: "news",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
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
        url: "/brand/oddsfront-favicon-48-v1.png?v=2",
        type: "image/png",
        sizes: "48x48",
      },
      {
        url: "/brand/oddsfront-favicon-96-v1.png?v=2",
        type: "image/png",
        sizes: "96x96",
      },
      {
        url: `${APP_ICON_PATH}?v=2`,
        type: "image/svg+xml",
        sizes: "any",
      },
    ],
    shortcut: [
      {
        url: "/favicon.ico?v=oddsfront-2",
        type: "image/x-icon",
      },
    ],
    apple: [
      {
        url: `${APPLE_ICON_PATH}?v=2`,
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
  const organization = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${ODDSFRONT_URL}/#organization`, name: "OddsFront", url: ODDSFRONT_URL, logo: { "@type": "ImageObject", url: `${ODDSFRONT_URL}/brand/oddsfront-app-512-v1.png`, width: 512, height: 512 }, sameAs: ["https://t.me/oddsfront"] },
      { "@type": "WebSite", "@id": `${ODDSFRONT_URL}/#website`, name: "OddsFront", url: ODDSFRONT_URL, publisher: { "@id": `${ODDSFRONT_URL}/#organization` }, inLanguage: "en" },
    ],
  };
  return (
    <html lang="en">
      <head>
        <link rel="mask-icon" href="/brand/oddsfront-pinned-tab-v1.svg?v=2" color="#6366F1" />
        <link rel="preload" href="/fonts/inter-ui-latin-v1.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization).replace(/</g, "\\u003c") }} />
        <LocaleProvider>{children}</LocaleProvider>
        {process.env.NODE_ENV === "production" ? (
          <Analytics mode="production" />
        ) : null}
      </body>
    </html>
  );
}
