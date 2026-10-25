import type { NextConfig } from "next";

const CANONICAL_ORIGIN = "https://oddsfront.com";
// Keep in sync with LOCALES in lib/news/types.ts (lower-cased URL segments).
const NEWS_LOCALE_SEGMENTS = "en|zh|ko|vi|de|es|pt-br|fr|ru|uk|fa|he";
const REDIRECT_HOSTS = [
  "www.oddsfront.com",
  "oddsfront.vercel.app",
  "oddsfront-sevas-projects-78158da5.vercel.app",
  "oddsfront-git-main-sevas-projects-78158da5.vercel.app",
  "dropsradar.vercel.app",
  "dropsradar-sevas-projects-78158da5.vercel.app",
  "dropsradar-svg8bit-sevas-projects-78158da5.vercel.app",
  "dropsbot-global-conflict-map.vercel.app",
] as const;

const scriptSources = [
  "'self'",
  "'unsafe-inline'",
  "'wasm-unsafe-eval'",
  "https://va.vercel-scripts.com",
];

if (process.env.NODE_ENV !== "production") {
  scriptSources.push("'unsafe-eval'");
}

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSources.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://tiles.openfreemap.org https://vitals.vercel-insights.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  process.env.NODE_ENV === "production" ? "upgrade-insecure-requests" : "",
]
  .filter(Boolean)
  .join("; ");

// The Telegram Mini App (/tg) runs inside Telegram (an iframe on web.telegram.org) and talks to
// Polymarket, TON Connect wallets and Telegram's own script, so it gets its own, wider policy.
const miniAppContentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${[...scriptSources, "https://telegram.org"].join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  process.env.NODE_ENV === "production" ? "upgrade-insecure-requests" : "",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
] as const;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  outputFileTracingIncludes: {
    "/social/news/[locale]/[slug]": [
      "./public/fonts/*.ttf",
      "./public/brand/oddsfront-social-preview-v3.png",
      "./public/brand/oddsfront-social-overlay-v1.png",
      "./public/brand/oddsfront-social-background-v1.png",
    ],
  },
  async rewrites() {
    return {
      beforeFiles: [{
        source: "/maps/fonts/unicode-v1/:range.pbf",
        destination: "/maps/fonts/unicode-v1/:range.pbf.gz",
      },{
        source: "/maps/fonts/inter-medium-v1/:range.pbf",
        destination: "/maps/fonts/inter-medium-v1/:range.pbf.gz",
      }],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    const canonicalHostRedirects = REDIRECT_HOSTS.map((host) => ({
      source: "/:path*",
      has: [
        {
          type: "host" as const,
          value: host,
        },
      ],
      destination: `${CANONICAL_ORIGIN}/:path*`,
      permanent: true,
    }));

    // Canonical and legacy news redirects live at the routing layer, so no
    // function runs for them and the ISR pages never call permanentRedirect()
    // (an ISR-cached page redirect emits a duplicated Location header in
    // Next 16.3). Requests that still carry `?lang=` are left to proxy.ts,
    // which rewrites the language and drops the parameter in one hop.
    const noLanguageQuery = [{ type: "query" as const, key: "lang" }];
    const newsRedirects = [
      // English listings have no language prefix.
      { source: "/en/news", destination: "/news" },
      { source: "/en/news/:country([a-z]{2})", destination: "/news/:country" },
      // "world" is the unfiltered listing.
      { source: "/news/world", destination: "/news" },
      { source: `/:locale(${NEWS_LOCALE_SEGMENTS})/news/world`, destination: "/:locale/news" },
      // Archive page 1 is /news/archive itself.
      { source: "/news/archive/1", destination: "/news/archive" },
      // Legacy article URLs: country segment, or no language segment at all.
      { source: "/news/:country(world|[a-z]{2})/:slug", destination: "/en/news/:slug" },
      { source: `/:locale(${NEWS_LOCALE_SEGMENTS})/news/:country(world|[a-z]{2})/:slug`, destination: "/:locale/news/:slug" },
      {
        source: "/news/:slug((?!(?:about|archive|topic|rss\\.xml|world|[a-z]{2})(?:/|$))[a-z0-9]+(?:-[a-z0-9]+)*)",
        destination: "/en/news/:slug",
      },
    ].map((redirect) => ({ ...redirect, missing: noLanguageQuery, permanent: true }));

    return [
      {
        source: "/global-conflict-map",
        destination: CANONICAL_ORIGIN,
        permanent: true,
      },
      ...newsRedirects,
      ...canonicalHostRedirects,
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders],
      },
      {
        // Later entries win for the same header key.
        source: "/tg",
        headers: [
          { key: "Content-Security-Policy", value: miniAppContentSecurityPolicy },
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Cross-Origin-Opener-Policy", value: "unsafe-none" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        // TON wallets read the app manifest from their own origins.
        source: "/tonconnect-manifest.json",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
      {
        source: "/maps/:path*",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800",
          },
        ],
      },
      {
        source: "/maps/fonts/inter-medium-v1/:range.pbf",
        headers: [
          { key: "Content-Encoding", value: "gzip" },
          { key: "Content-Type", value: "application/x-protobuf" },
        ],
      },
      { source: "/maps/fonts/unicode-v1/:range.pbf", headers: [
        { key: "Content-Encoding", value: "gzip" },
        { key: "Content-Type", value: "application/x-protobuf" },
      ] },
      {
        source: "/vendor/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/fonts/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/brand/:path*",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
