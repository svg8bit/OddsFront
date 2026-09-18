import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { LocaleProvider } from "@/components/locale-provider";
import { localeDirection } from "@/lib/news/locale";
import type { Locale } from "@/lib/news/types";
import {
  APP_ICON_PATH,
  APPLE_ICON_PATH,
  buildOddsFrontSocialMetadata,
  ODDSFRONT_URL,
} from "@/lib/oddsfront-site";

export const ROOT_METADATA: Metadata = {
  ...buildOddsFrontSocialMetadata("/global-conflict-map"),
  metadataBase: new URL(ODDSFRONT_URL),
  applicationName: "HomoLudens",
  creator: "HomoLudens",
  publisher: "HomoLudens",
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
  appleWebApp: { title: "HomoLudens", capable: false },
  alternates: { canonical: "/global-conflict-map" },
  icons: {
    icon: [
      { url: APP_ICON_PATH, type: "image/svg+xml", sizes: "any" },
    ],
    shortcut: [{ url: APP_ICON_PATH, type: "image/svg+xml" }],
    apple: [{ url: APPLE_ICON_PATH, type: "image/svg+xml" }],
  },
};

export const ROOT_VIEWPORT: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020a16",
};

export function RootDocument({
  children,
  locale = "en",
  fixedLocale = locale !== "en",
}: Readonly<{ children: React.ReactNode; locale?: Locale; fixedLocale?: boolean }>) {
  const organization = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${ODDSFRONT_URL}/#organization`, name: "HomoLudens", url: ODDSFRONT_URL, logo: { "@type": "ImageObject", url: `${ODDSFRONT_URL}${APP_ICON_PATH}` } },
      { "@type": "WebSite", "@id": `${ODDSFRONT_URL}/#website`, name: "HomoLudens", url: ODDSFRONT_URL, publisher: { "@id": `${ODDSFRONT_URL}/#organization` }, inLanguage: locale },
    ],
  };
  return (
    <html lang={locale} dir={localeDirection(locale)}>
      {/* This component is the document shell shared by both root layouts. */}
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <head>
        <link rel="mask-icon" href={APP_ICON_PATH} color="#111827" />
        <link rel="preload" href="/fonts/inter-ui-latin-v1.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization).replace(/</g, "\\u003c") }} />
        <LocaleProvider fixedLocale={fixedLocale ? locale : undefined}>{children}</LocaleProvider>
        {process.env.NODE_ENV === "production" ? <Analytics mode="production" /> : null}
      </body>
    </html>
  );
}
