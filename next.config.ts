import type { NextConfig } from "next";

const CANONICAL_ORIGIN = "https://oddsfront.com";
const REDIRECT_HOSTS = [
  "www.oddsfront.com",
  "oddsfront.vercel.app",
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

    return canonicalHostRedirects;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders],
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
